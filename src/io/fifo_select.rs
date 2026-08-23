//! macOS: readiness of a named pipe (FIFO), which kqueue cannot report.
//!
//! XNU's `EVFILT_READ` filter for a FIFO vnode (`filt_vnode_common`) fires only
//! while bytes are buffered, and `poll(2)` is built on it; the last writer's
//! close wakes neither. `select(2)` goes through the FIFO's socket and does
//! wake for it (`soreadable()` includes `SS_CANTRCVMORE`). `pipe(2)` pipes have
//! their own filter, which reports `EV_EOF`.
//!
//! One thread per process blocks in `select` on every armed FIFO. A readable one
//! is disarmed (one-shot) and delivered into the owning kqueue as an
//! `EVFILT_USER` event carrying the poll's `udata`, so that kqueue dispatches it
//! like any other event. Delivery and `disarm` take the same lock.

use bun_sys::{self as sys, Fd, FdExt as _};
use bun_threading::{Guarded, Mutex};

/// Set in the low 24 `fflags` bits of a delivered event.
pub(crate) const NOTE_FIFO_READABLE: u32 = 0x1;

struct Armed {
    /// Unique per registration: a delivery is for the registration `select`
    /// observed, not for whatever owns the fd number by the time it runs.
    id: u64,
    fd: Fd,
    kqueue: Fd,
    udata: u64,
    generation: u64,
}

#[derive(Default)]
struct Registry {
    entries: Vec<Armed>,
    next_id: u64,
}

struct Watcher {
    armed: Guarded<Registry>,
    /// Self-pipe: a byte written here makes the thread leave `select` and
    /// rebuild its set.
    wake_read: Fd,
    wake_write: Fd,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.wake_read.close();
        self.wake_write.close();
    }
}

static WATCHER: std::sync::OnceLock<&'static Watcher> = std::sync::OnceLock::new();
static INIT: Mutex = Mutex::new();

fn watcher() -> sys::Result<&'static Watcher> {
    if let Some(watcher) = WATCHER.get() {
        return Ok(watcher);
    }
    let _init = INIT.lock_guard();
    if let Some(watcher) = WATCHER.get() {
        return Ok(watcher);
    }
    let watcher_ptr = bun_core::heap::into_raw(Box::new(Watcher::init()?));
    // SAFETY: just allocated and exclusively owned; published only on Ok.
    let watcher: &'static Watcher = unsafe { &*watcher_ptr };
    let spawned = std::thread::Builder::new()
        .stack_size(1024 * 1024)
        .spawn(move || run(watcher));
    if spawned.is_err() {
        // SAFETY: the thread never started and the watcher was never published.
        drop(unsafe { bun_core::heap::take(watcher_ptr) });
        return Err(sys::Error::from_code(sys::E::ENOMEM, sys::Tag::select));
    }
    let _ = WATCHER.set(watcher);
    Ok(watcher)
}

impl Watcher {
    fn init() -> sys::Result<Watcher> {
        let [wake_read, wake_write] = sys::pipe()?;
        for fd in [wake_read, wake_write] {
            if let Err(err) = sys::set_close_on_exec(fd).and_then(|()| sys::set_nonblocking(fd)) {
                wake_read.close();
                wake_write.close();
                return Err(err);
            }
        }
        Ok(Watcher {
            armed: Guarded::new(Registry::default()),
            wake_read,
            wake_write,
        })
    }

    fn wake(&self) {
        // A byte already in the pipe (EAGAIN) wakes the thread just as well.
        let _ = sys::write(self.wake_write, &[0u8]);
    }

    fn drain_wake(&self) {
        let mut buf = [0u8; 64];
        while let Ok(n) = sys::read(self.wake_read, &mut buf) {
            if n < buf.len() {
                break;
            }
        }
    }

    /// Disarms registration `id`, if it is still there, and delivers it.
    fn deliver(&self, id: u64) {
        let mut armed = self.armed.lock();
        if let Some(index) = armed.entries.iter().position(|a| a.id == id) {
            // Under the lock, so an owner that unregisters afterwards finds the
            // knote to delete.
            armed.entries.swap_remove(index).deliver();
        }
    }

    /// Drops every registration that `keep` rejects without delivering, as a
    /// kqueue drops the knotes of a closed fd. Returns whether there was one.
    fn forget(&self, keep: impl Fn(&Armed) -> bool) -> bool {
        let mut armed = self.armed.lock();
        let before = armed.entries.len();
        armed.entries.retain(keep);
        armed.entries.len() != before
    }
}

impl Armed {
    fn deliver(&self) {
        use sys::darwin::{EV, EVFILT, NOTE, kevent64, kevent64_s};
        let change = kevent64_s {
            ident: u64::try_from(self.fd.native()).expect("int cast"),
            filter: EVFILT::USER,
            flags: EV::ADD | EV::ONESHOT,
            fflags: NOTE::TRIGGER | NOTE_FIFO_READABLE,
            data: 0,
            udata: self.udata,
            ext: [self.generation, 0],
        };
        // SAFETY: FFI syscall; `change` is a stack-local valid for the call,
        // and with no eventlist the call does not wait.
        let rc = unsafe {
            kevent64(
                self.kqueue.native(),
                &raw const change,
                1,
                core::ptr::null_mut(),
                0,
                0,
                core::ptr::null(),
            )
        };
        sys::syslog!(
            "fifo_select: deliver({}) to kqueue {} = {}",
            self.fd,
            self.kqueue,
            rc
        );
    }
}

/// Waits for `fd` to be readable or at EOF; the result arrives in `kqueue` as
/// an `EVFILT_USER` event with `ident == fd`, `udata`, and `NOTE_FIFO_READABLE`
/// in `fflags`. Arming again replaces the registration, as kqueue does.
pub(crate) fn arm(kqueue: Fd, fd: Fd, udata: u64, generation: u64) -> sys::Result<()> {
    let watcher = watcher()?;
    {
        let mut armed = watcher.armed.lock();
        let id = armed.next_id;
        armed.next_id += 1;
        let entry = Armed {
            id,
            fd,
            kqueue,
            udata,
            generation,
        };
        match armed
            .entries
            .iter_mut()
            .find(|a| a.fd == fd && a.kqueue == kqueue)
        {
            Some(existing) => *existing = entry,
            None => armed.entries.push(entry),
        }
    }
    watcher.wake();
    Ok(())
}

/// Drops every registration that would deliver into `kqueue`. Call before the
/// kqueue is closed, so nothing is ever delivered into a reused descriptor.
pub(crate) fn forget_kqueue(kqueue: Fd) {
    let Some(watcher) = WATCHER.get() else {
        return;
    };
    if watcher.forget(|a| a.kqueue != kqueue) {
        watcher.wake();
    }
}

/// Stops waiting on `fd` for `kqueue`. Call before the fd is closed.
pub(crate) fn disarm(kqueue: Fd, fd: Fd) {
    let Some(watcher) = WATCHER.get() else {
        return;
    };
    let removed = {
        let mut armed = watcher.armed.lock();
        match armed
            .entries
            .iter()
            .position(|a| a.fd == fd && a.kqueue == kqueue)
        {
            Some(index) => {
                armed.entries.swap_remove(index);
                true
            }
            None => false,
        }
    };
    if removed {
        watcher.wake();
    }
}

fn set_bit(set: &mut [u32], fd: Fd) {
    let index = fd.native() as usize;
    set[index / 32] |= 1 << (index % 32);
}

fn is_set(set: &[u32], fd: Fd) -> bool {
    let index = fd.native() as usize;
    set[index / 32] & (1 << (index % 32)) != 0
}

fn run(watcher: &'static Watcher) {
    bun_core::Output::Source::configure_named_thread(bun_core::ZStr::from_static(
        b"FIFO Watcher\0",
    ));
    // The registrations this round waits for, as (fd, id).
    let mut watched: Vec<(Fd, u64)> = Vec::new();
    let mut set: Vec<u32> = Vec::new();
    loop {
        watched.clear();
        watched.extend(watcher.armed.lock().entries.iter().map(|a| (a.fd, a.id)));
        let max_fd = watched
            .iter()
            .map(|(fd, _)| fd.native())
            .max()
            .unwrap_or(0)
            .max(watcher.wake_read.native()) as usize;
        set.clear();
        set.resize(max_fd / 32 + 1, 0);
        set_bit(&mut set, watcher.wake_read);
        for (fd, _) in &watched {
            set_bit(&mut set, *fd);
        }

        match sys::select_readable(&mut set) {
            Ok(_) => {}
            Err(err) => match err.get_errno() {
                sys::E::EINTR | sys::E::EAGAIN => continue,
                errno => {
                    sys::syslog!(
                        "fifo_select: select failed: {}",
                        <&'static str>::from(errno)
                    );
                    // An fd closed behind its owner's back. A live fd is never
                    // delivered without readiness: a blocking read would stall
                    // the owner's loop.
                    let mut forgot = false;
                    for (fd, _) in &watched {
                        if sys::get_fcntl_flags(*fd).is_err() {
                            forgot |= watcher.forget(|a| a.fd != *fd);
                        }
                    }
                    if !forgot {
                        std::thread::sleep(core::time::Duration::from_millis(10));
                    }
                    continue;
                }
            },
        }

        if is_set(&set, watcher.wake_read) {
            watcher.drain_wake();
        }
        for (fd, id) in &watched {
            if is_set(&set, *fd) {
                watcher.deliver(*id);
            }
        }
    }
}

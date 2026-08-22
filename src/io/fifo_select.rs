//! macOS: readiness of a named pipe (FIFO), which kqueue cannot report.
//!
//! XNU attaches a FIFO's `EVFILT_READ` knote to the vnode (`vn_kqfilter`), and
//! `filt_vnode_common` activates it only while bytes are buffered. The last
//! writer closing never wakes it, and `poll(2)` is built on the same filter, so
//! a reader parked in the loop's kqueue after draining the pipe never learns
//! about EOF. `select(2)` goes through the FIFO's socket (`fifo_select` ->
//! `soo_select`), whose readable test includes `SS_CANTRCVMORE`: it wakes for
//! data and for the last writer's close. `pipe(2)` pipes are not affected
//! (their own filter reports `EV_EOF`); they `fstat` with `st_dev == 0`, a
//! named pipe with the device of the filesystem it lives on.
//!
//! One thread per process blocks in `select` on every armed FIFO. A FIFO that
//! becomes readable is disarmed (one-shot, like the `EV_DISPATCH` kqueue
//! registration it stands in for) and its `FilePoll` is delivered into the
//! owning loop's kqueue as an `EVFILT_USER` event, so it reaches
//! `FilePoll::on_kqueue_event` like any other readiness event. `unregister`
//! removes the armed entry before the owner closes the fd; that removal and the
//! delivery take the same lock, so a poll that is gone is never delivered.

use bun_sys::{self as sys, Fd, FdExt as _};
use bun_threading::{Guarded, Mutex};

struct Armed {
    fd: Fd,
    /// The owning loop's kqueue.
    kqueue: Fd,
    /// `Pollable::init(poll).ptr()`: the `udata` the loop dispatches on.
    udata: u64,
    generation: u64,
}

struct Watcher {
    armed: Guarded<Vec<Armed>>,
    /// Self-pipe. `arm`/`disarm` write a byte so the thread leaves `select`
    /// and rebuilds its set.
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
    // Owning raw pointer first, shared view second: the spawn error arm
    // reclaims through `watcher_ptr`, which must not come from a shared reference.
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
            armed: Guarded::new(Vec::new()),
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

    /// Disarms every registration of `fd` and delivers each to its loop.
    /// Returns whether there was one.
    fn deliver(&self, fd: Fd) -> bool {
        let mut armed = self.armed.lock();
        let mut delivered = false;
        while let Some(index) = armed.iter().position(|a| a.fd == fd) {
            let entry = armed.swap_remove(index);
            // Still under the lock: an `unregister` that runs after this has
            // the knote to delete, one that ran before took the entry away.
            entry.deliver();
            delivered = true;
        }
        delivered
    }
}

impl Armed {
    fn deliver(&self) {
        use sys::darwin::{EV, EVFILT, NOTE, kevent64, kevent64_s};
        let change = kevent64_s {
            ident: u64::try_from(self.fd.native()).expect("int cast"),
            filter: EVFILT::USER,
            flags: EV::ADD | EV::ONESHOT,
            fflags: NOTE::TRIGGER,
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

/// Waits for `fd` (a named pipe) to be readable or at EOF on behalf of the
/// `FilePoll` behind `udata`; the result arrives in `kqueue` as an
/// `EVFILT_USER` event with `ident == fd`. Arming an fd that `kqueue` already
/// has armed replaces that registration, as kqueue does for one `ident`.
pub(crate) fn arm(kqueue: Fd, fd: Fd, udata: u64, generation: u64) -> sys::Result<()> {
    let watcher = watcher()?;
    {
        let mut armed = watcher.armed.lock();
        let entry = Armed {
            fd,
            kqueue,
            udata,
            generation,
        };
        match armed.iter_mut().find(|a| a.fd == fd && a.kqueue == kqueue) {
            Some(existing) => *existing = entry,
            None => armed.push(entry),
        }
    }
    watcher.wake();
    Ok(())
}

/// Stops waiting on `fd` for `kqueue`. Call before the fd is closed: a close
/// on XNU wakes a `select` that includes the fd, and the thread must not put
/// it back.
pub(crate) fn disarm(kqueue: Fd, fd: Fd) {
    let Some(watcher) = WATCHER.get() else {
        return;
    };
    let removed = {
        let mut armed = watcher.armed.lock();
        match armed.iter().position(|a| a.fd == fd && a.kqueue == kqueue) {
            Some(index) => {
                armed.swap_remove(index);
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
    let mut fds: Vec<Fd> = Vec::new();
    let mut set: Vec<u32> = Vec::new();
    loop {
        fds.clear();
        fds.push(watcher.wake_read);
        for entry in watcher.armed.lock().iter() {
            if !fds.contains(&entry.fd) {
                fds.push(entry.fd);
            }
        }
        let max_fd = fds.iter().map(|fd| fd.native()).max().unwrap_or(0) as usize;
        set.clear();
        set.resize(max_fd / 32 + 1, 0);
        for fd in &fds {
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
                    // An fd closed behind its owner's back is the one way a set
                    // of live registrations fails. Deliver those, so the
                    // owner's read reports the error instead of waiting
                    // forever; never deliver a live fd that is not readable,
                    // since the owner's read on a blocking FIFO would then
                    // block the loop. With nothing to deliver, back off
                    // instead of spinning on a failure we cannot explain.
                    let mut delivered = false;
                    for fd in &fds[1..] {
                        if sys::get_fcntl_flags(*fd).is_err() {
                            delivered |= watcher.deliver(*fd);
                        }
                    }
                    if !delivered {
                        std::thread::sleep(core::time::Duration::from_millis(10));
                    }
                    continue;
                }
            },
        }

        if is_set(&set, watcher.wake_read) {
            watcher.drain_wake();
        }
        for fd in &fds[1..] {
            if is_set(&set, *fd) {
                watcher.deliver(*fd);
            }
        }
    }
}

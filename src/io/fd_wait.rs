//! One thread waits on its own epoll or kqueue for the pipes, sockets and ttys of all work pool jobs.

use core::ffi::c_int;
use core::marker::PhantomPinned;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU8, Ordering};

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_sys::linux::EPOLL;
use bun_sys::{self as sys, E, Fd, FdExt as _};
use bun_threading::{Link, UnboundedQueue, WorkPool, WorkPoolTask};

use crate::Waker;

bun_core::define_scoped_log!(log, FdWait, hidden);

#[derive(Clone, Copy)]
pub enum Interest {
    Readable,
    Writable,
}

impl Interest {
    fn syscall(self) -> sys::Tag {
        match self {
            Interest::Readable => sys::Tag::read,
            Interest::Writable => sys::Tag::write,
        }
    }
}

/// What a job reads or writes.
pub struct JobFd {
    fd: Fd,
    owned: bool,
    registered: bool,
}

impl JobFd {
    #[inline]
    pub fn borrowed(fd: Fd) -> Self {
        Self {
            fd,
            owned: false,
            registered: false,
        }
    }

    #[inline]
    pub fn opened(file: sys::File) -> Self {
        Self {
            fd: file.into_raw(),
            owned: true,
            registered: false,
        }
    }

    #[inline]
    pub fn get(&self) -> Fd {
        self.fd
    }
}

impl Drop for JobFd {
    #[inline]
    fn drop(&mut self) {
        // epoll keeps a one-shot entry that has fired.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if self.registered
            && let Some(watcher) = WATCHER.get()
        {
            watcher.remove(self.fd);
        }
        if self.owned {
            let _ = self.fd.close_allowing_bad_file_descriptor(None);
        }
    }
}

/// Who has the job.
#[derive(Clone, Copy)]
#[repr(u8)]
enum State {
    /// The work pool.
    Running,
    /// The IO thread, in its queue.
    Queued,
    /// The IO thread, which has asked the kernel.
    Armed,
    /// Final. Whoever had the job still has it, and ends it instead of passing it on.
    Cancelled,
}

struct Owner(AtomicU8);

impl Owner {
    const fn new() -> Self {
        Self(AtomicU8::new(State::Running as u8))
    }

    /// `false`: cancelled.
    fn pass(&self, from: State, to: State) -> bool {
        let seen =
            self.0
                .compare_exchange(from as u8, to as u8, Ordering::SeqCst, Ordering::SeqCst);
        debug_assert!(seen.is_ok() || seen == Err(State::Cancelled as u8));
        seen.is_ok()
    }

    /// `true`: it was armed, so nothing else will make the IO thread look at the job.
    fn cancel(&self) -> bool {
        self.0.swap(State::Cancelled as u8, Ordering::SeqCst) == State::Armed as u8
    }

    #[inline]
    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst) == State::Cancelled as u8
    }
}

/// A field of the job.
pub struct FdWait {
    next: Link<FdWait>,
    task: WorkPoolTask,
    owner: Owner,
    interest: Interest,
    /// From `park` to `unpark`. Otherwise `Fd::INVALID`, which the kernel refuses.
    parked: JobFd,
    /// Why the wait ended without `parked` being ready.
    failed: Option<sys::Error>,
    /// Other threads use the job, and free it, while the frames that parked it return.
    _pin: PhantomPinned,
}

bun_threading::intrusive_work_task!(FdWait, task);

// SAFETY: always the same field.
unsafe impl bun_threading::Linked for FdWait {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const Link<Self> {
        // SAFETY: fn contract.
        unsafe { &raw const (*item).next }
    }
}

impl FdWait {
    /// The pool calls `resume` once after each `park` that succeeds.
    pub fn new(interest: Interest, resume: unsafe fn(*mut WorkPoolTask)) -> Self {
        Self {
            next: Link::new(),
            task: WorkPoolTask {
                node: Default::default(),
                callback: resume,
            },
            owner: Owner::new(),
            interest,
            parked: JobFd::borrowed(Fd::INVALID),
            failed: None,
            _pin: PhantomPinned,
        }
    }

    /// SAFETY: the caller has the job. After `Ok` nothing uses or moves it until `resume`, or closes `fd` while another descriptor shares its description: epoll could not remove the entry.
    pub unsafe fn park(this: *mut Self, fd: JobFd) -> sys::Result<()> {
        let watcher = Watcher::start()?;
        // SAFETY: fn contract. The IO thread gets the job from the queue, `cancel` keeps to `owner` until it is armed.
        unsafe {
            if !(*this).owner.pass(State::Running, State::Queued) {
                return Err((*this).cancelled());
            }
            (*this).parked = fd;
            watcher.submit(this);
        }
        Ok(())
    }

    /// Pool thread, in `resume`.
    pub fn unpark(&mut self) -> sys::Result<JobFd> {
        let fd = core::mem::replace(&mut self.parked, JobFd::borrowed(Fd::INVALID));
        self.failed.take().map_or(Ok(fd), Err)
    }

    #[inline]
    pub fn check_cancelled(&self) -> sys::Result<()> {
        if self.owner.is_cancelled() {
            return Err(self.cancelled());
        }
        Ok(())
    }

    #[cold]
    fn cancelled(&self) -> sys::Error {
        sys::Error::from_code(E::ECANCELED, self.interest.syscall())
    }

    /// Ends the wait and every later one, from any thread. SAFETY: `this` is live.
    pub unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. An armed job is in no queue, and once cancelled only the queue ends it.
        unsafe {
            if (*this).owner.cancel()
                && let Some(watcher) = WATCHER.get()
            {
                watcher.submit(this);
            }
        }
    }

    /// SAFETY: IO thread. It armed `this` and has not given it back since.
    unsafe fn wake(this: *mut Self, failed: Option<sys::Error>) {
        // SAFETY: fn contract. A cancelled job is queued again, and `tick` ends it from there.
        unsafe {
            if (*this).owner.pass(State::Armed, State::Running) {
                (*this).failed = failed;
                WorkPool::schedule(&raw mut (*this).task);
            }
        }
    }
}

struct Watcher {
    pending: UnboundedQueue<FdWait>,
    waker: Waker,
    /// On macOS the waker is a kqueue already.
    #[cfg(not(target_os = "macos"))]
    poller: sys::File,
}

static WATCHER: bun_core::Once<Watcher> = bun_core::Once::new();
static IS_RUNNING: AtomicBool = AtomicBool::new(false);
static INIT_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

impl Watcher {
    /// Starts the IO thread on first use. If that fails, the next call retries.
    fn start() -> sys::Result<&'static Self> {
        if IS_RUNNING.load(Ordering::Acquire)
            && let Some(this) = WATCHER.get()
        {
            return Ok(this);
        }
        let _guard = INIT_LOCK.lock_guard();
        let this = match WATCHER.get() {
            Some(this) => this,
            None => {
                let watcher = Self::init()?;
                WATCHER.get_or_init(|| watcher)
            }
        };
        if !IS_RUNNING.load(Ordering::Relaxed) {
            std::thread::Builder::new()
                .stack_size(1024 * 1024 * 2)
                .spawn(|| this.tick())
                .map_err(|err| {
                    sys::Error::from_code_int(
                        err.raw_os_error().unwrap_or(libc::EAGAIN),
                        sys::Tag::pthread_create,
                    )
                })?;
            IS_RUNNING.store(true, Ordering::Release);
        }
        Ok(this)
    }

    fn init() -> sys::Result<Self> {
        let waker = Waker::init().map_err(|err| {
            let errno = match err {
                crate::Error::Sys(errno) => errno,
                _ => E::ENOMEM,
            };
            sys::Error::from_code(errno, sys::Tag::open)
        })?;
        Ok(Self {
            pending: UnboundedQueue::new(),
            #[cfg(not(target_os = "macos"))]
            poller: Self::create_poller(&waker)?,
            waker,
        })
    }

    /// SAFETY: `wait` is in no queue, and is live until the IO thread gives it to the pool.
    unsafe fn submit(&self, wait: *mut FdWait) {
        // SAFETY: fn contract.
        self.pending.push(unsafe { NonNull::new_unchecked(wait) });
        self.waker.wake();
    }

    fn tick(&self) {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("IO Watcher"));

        loop {
            let mut changes = Changes::new();
            let mut pending = self.pending.pop_batch().iterator();
            while let Some(wait) = NonNull::new(pending.next()).map(NonNull::as_ptr) {
                // SAFETY: only this thread gives a parked job to the pool, and `park` requires what `remove` needs.
                unsafe {
                    let interest = (*wait).interest;
                    let fd = &mut (*wait).parked;
                    if (*wait).owner.pass(State::Queued, State::Armed) {
                        match changes.add(self, fd, interest, wait) {
                            Ok(()) => fd.registered = true,
                            Err(err) => FdWait::wake(wait, Some(err)),
                        }
                    } else {
                        if core::mem::take(&mut fd.registered) {
                            changes.remove(self, fd.fd, interest);
                        }
                        (*wait).failed = Some((*wait).cancelled());
                        WorkPool::schedule(&raw mut (*wait).task);
                    }
                }
            }
            changes.wait(self);
        }
    }
}

// ─── epoll ───────────────────────────────────────────────────────────────────

/// epoll applies each change at once.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Changes;

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Watcher {
    fn create_poller(waker: &Waker) -> sys::Result<sys::File> {
        let raw = crate::safe_c::epoll_create1(libc::EPOLL_CLOEXEC);
        if raw < 0 {
            return Err(sys::Error::from_code(
                sys::get_errno(raw),
                sys::Tag::epoll_create1,
            ));
        }
        let poller = sys::File::from_fd(Fd::from_native(raw));
        let events = EPOLL::IN | EPOLL::ET | EPOLL::ERR | EPOLL::HUP;
        let no_job = core::ptr::null_mut();
        epoll_ctl(&poller, EPOLL::CTL_ADD, waker.get_fd(), events, no_job)?;
        Ok(poller)
    }

    fn remove(&self, fd: Fd) {
        let _ = sys::linux::epoll_ctl_del(self.poller.fd().native(), fd.native());
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn epoll_ctl(
    poller: &sys::File,
    op: c_int,
    fd: Fd,
    events: u32,
    wait: *mut FdWait,
) -> sys::Result<()> {
    let mut event = libc::epoll_event {
        events,
        u64: wait as u64,
    };
    // SAFETY: the kernel copies `event` and does not follow `wait`.
    let rc = unsafe { libc::epoll_ctl(poller.fd().native(), op, fd.native(), &raw mut event) };
    match sys::get_errno(rc) {
        E::SUCCESS => Ok(()),
        err => Err(sys::Error::from_code(err, sys::Tag::epoll_ctl)),
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Changes {
    fn new() -> Self {
        Self
    }

    /// SAFETY: `wait` is live until it is reported or removed.
    unsafe fn add(
        &mut self,
        watcher: &Watcher,
        fd: &JobFd,
        interest: Interest,
        wait: *mut FdWait,
    ) -> sys::Result<()> {
        log!("register({})", fd.fd);
        let interest = match interest {
            Interest::Readable => EPOLL::IN,
            Interest::Writable => EPOLL::OUT,
        };
        let events = interest | EPOLL::HUP | EPOLL::ERR | EPOLL::ONESHOT;
        let op = if fd.registered {
            EPOLL::CTL_MOD
        } else {
            EPOLL::CTL_ADD
        };
        epoll_ctl(&watcher.poller, op, fd.fd, events, wait)
    }

    fn remove(&mut self, watcher: &Watcher, fd: Fd, _: Interest) {
        watcher.remove(fd);
    }

    fn wait(self, watcher: &Watcher) {
        let mut events: [libc::epoll_event; 256] = [bun_core::ffi::zeroed(); 256];
        // SAFETY: `events` is writable for its length.
        let rc = unsafe {
            libc::epoll_wait(
                watcher.poller.fd().native(),
                events.as_mut_ptr(),
                events.len() as c_int,
                i32::MAX,
            )
        };
        match sys::get_errno(rc) {
            E::EINTR => return,
            E::SUCCESS => {}
            e => bun_core::Output::panic(format_args!("epoll_wait: {:?}", e)),
        }

        // The waker is edge-triggered: no need to read its counter.
        for event in events[..rc as usize].iter().filter(|it| it.u64 != 0) {
            let wait = event.u64 as *mut FdWait;
            // SAFETY: one-shot, and `park` requires what it takes to remove the entry of a job that left.
            unsafe {
                let failed = (event.events & EPOLL::ERR != 0)
                    .then(|| pending_error((*wait).parked.fd, (*wait).interest));
                FdWait::wake(wait, failed);
            }
        }
    }
}

/// EPOLLERR carries no errno, and reading SO_ERROR would clear it on the caller's socket.
#[cfg(any(target_os = "linux", target_os = "android"))]
#[cold]
fn pending_error(fd: Fd, interest: Interest) -> sys::Error {
    if matches!(interest, Interest::Writable)
        && sys::fstat(fd).is_ok_and(|stat| sys::S::ISFIFO(stat.st_mode as _))
    {
        sys::Error::from_code(E::EPIPE, sys::Tag::write)
    } else {
        sys::Error::from_code(E::SUCCESS, sys::Tag::epoll_ctl)
    }
}

// ─── kqueue ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "freebsd")]
type KEvent = libc::kevent;
#[cfg(target_os = "macos")]
type KEvent = libc::kevent64_s;

/// kqueue applies them in the call that waits.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Changes(Vec<KEvent>);

#[cfg(target_os = "freebsd")]
impl Watcher {
    fn create_poller(waker: &Waker) -> sys::Result<sys::File> {
        let kq = crate::safe_c::kqueue();
        if kq < 0 {
            return Err(sys::Error::from_code(sys::get_errno(kq), sys::Tag::kqueue));
        }
        let poller = sys::File::from_fd(Fd::from_native(kq));
        // Edge-triggered: no need to read the eventfd.
        let mut change: KEvent = bun_core::ffi::zeroed();
        change.ident = usize::try_from(waker.get_fd().native()).expect("int cast");
        change.filter = libc::EVFILT_READ;
        change.flags = libc::EV_ADD | libc::EV_CLEAR;
        // SAFETY: one change, no events. `Changes::wait` skips an event without data.
        let rc = unsafe {
            libc::kevent(
                kq,
                &raw const change,
                1,
                core::ptr::null_mut(),
                0,
                core::ptr::null(),
            )
        };
        match sys::get_errno(rc) {
            E::SUCCESS => Ok(poller),
            err => Err(sys::Error::from_code(err, sys::Tag::kevent)),
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Changes {
    fn new() -> Self {
        Self(Vec::with_capacity(256))
    }

    fn push(&mut self, fd: Fd, interest: Interest, flags: u16, wait: *mut FdWait) {
        let mut change: KEvent = bun_core::ffi::zeroed();
        change.ident = fd.native() as _;
        change.filter = match interest {
            Interest::Readable => libc::EVFILT_READ,
            Interest::Writable => libc::EVFILT_WRITE,
        };
        change.flags = flags;
        change.udata = wait as usize as _;
        self.0.push(change);
    }

    /// SAFETY: `wait` is live until it is reported or removed.
    unsafe fn add(
        &mut self,
        _: &Watcher,
        fd: &JobFd,
        interest: Interest,
        wait: *mut FdWait,
    ) -> sys::Result<()> {
        log!("register({})", fd.fd);
        let flags = libc::EV_ADD | libc::EV_ONESHOT;
        self.push(fd.fd, interest, flags, wait);
        Ok(())
    }

    /// No data: the job may be gone when the kernel answers with ENOENT or EBADF.
    fn remove(&mut self, _: &Watcher, fd: Fd, interest: Interest) {
        self.push(fd, interest, libc::EV_DELETE, core::ptr::null_mut());
    }

    fn wait(self, watcher: &Watcher) {
        let mut events = self.0;
        let changes = c_int::try_from(events.len()).expect("int cast");
        let capacity = c_int::try_from(events.capacity()).expect("int cast");
        let list = events.as_mut_ptr();
        let forever = core::ptr::null();
        // SAFETY: (both) the kernel reads `changes` entries, then writes up to `capacity` over them.
        #[cfg(target_os = "freebsd")]
        let rc = unsafe {
            let kq = watcher.poller.fd().native();
            libc::kevent(kq, list, changes, list, capacity, forever)
        };
        // SAFETY: as above.
        #[cfg(target_os = "macos")]
        let rc = unsafe {
            let kq = watcher.waker.get_fd().native();
            libc::kevent64(kq, list, changes, list, capacity, 0, forever)
        };
        match sys::get_errno(rc) {
            E::EINTR => return,
            E::SUCCESS => {}
            e => {
                bun_core::Output::panic(format_args!("kevent failed: {}", <&'static str>::from(e)))
            }
        }
        // SAFETY: the kernel wrote that many.
        unsafe { events.set_len(rc as usize) };

        for event in &events {
            #[cfg(target_os = "macos")]
            if event.filter == libc::EVFILT_MACHPORT {
                continue;
            }
            let wait = event.udata as usize as *mut FdWait;
            if wait.is_null() {
                continue;
            }
            // A change that failed: xnu adds EV_ERROR to its flags, FreeBSD replaces them.
            let failed = (event.flags & libc::EV_ERROR != 0)
                .then(|| sys::Error::from_code_int(event.data as c_int, sys::Tag::kevent));
            // SAFETY: one-shot, and EV_DELETE or close() removed the entry of a job that left.
            unsafe { FdWait::wake(wait, failed) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_queues_only_an_armed_job_and_is_final() {
        for from in [State::Running, State::Queued, State::Armed] {
            let owner = Owner(AtomicU8::new(from as u8));
            assert_eq!(owner.cancel(), matches!(from, State::Armed));
            assert!(!owner.cancel());
            assert!(!owner.pass(from, State::Running));
            assert!(owner.is_cancelled());
        }
    }

    #[test]
    fn a_wait_that_cancel_races_ends_once() {
        for _ in 0..64 {
            let owner = Owner::new();
            std::thread::scope(|scope| {
                let queued_again = scope.spawn(|| owner.cancel());
                let ended = !owner.pass(State::Running, State::Queued)
                    || !owner.pass(State::Queued, State::Armed)
                    || owner.pass(State::Armed, State::Running);
                assert_ne!(ended, queued_again.join().unwrap());
            });
        }
    }
}

//! One thread waits on its own epoll or kqueue for the pipes, sockets and ttys of all work pool jobs.

use core::ops::DerefMut;
use core::sync::atomic::{AtomicU64, Ordering};
use std::collections::BTreeMap;

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_sys::linux::EPOLL;
use bun_sys::{self as sys, E, Fd, FdExt as _};
use bun_threading::Guarded;
#[cfg(not(all(test, target_os = "linux")))]
use bun_threading::WorkPool;
#[cfg(all(test, target_os = "linux"))]
use tests::WorkPool;

bun_core::define_scoped_log!(log, FdWait, hidden);

#[derive(Clone, Copy)]
pub enum Interest {
    Readable,
    Writable,
}

impl Interest {
    #[cold]
    pub fn cancelled(self) -> sys::Error {
        let syscall = match self {
            Interest::Readable => sys::Tag::read,
            Interest::Writable => sys::Tag::write,
        };
        sys::Error::from_code(E::ECANCELED, syscall)
    }
}

/// What a job reads or writes.
pub enum JobFd {
    Borrowed(Fd),
    Opened(Fd),
}

impl JobFd {
    #[inline]
    pub fn opened(file: sys::File) -> Self {
        Self::Opened(file.into_raw())
    }

    #[inline]
    pub fn get(&self) -> Fd {
        let (Self::Borrowed(fd) | Self::Opened(fd)) = *self;
        fd
    }
}

impl Drop for JobFd {
    #[inline]
    fn drop(&mut self) {
        if let Self::Opened(fd) = *self {
            let _ = fd.close_allowing_bad_file_descriptor(None);
        }
    }
}

/// What the kernel has in place of an address, one for each job. An epoll entry outlives its job if
/// script closes the descriptor while a duplicate is open: it can no longer be removed.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key(u64);

impl Key {
    #[inline]
    pub fn next() -> (Self, Canceller) {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        // Only has to be unique.
        let key = Self(NEXT.fetch_add(1, Ordering::Relaxed));
        (key, Canceller::Live(key))
    }

    /// Locks the part of the table that has the slot.
    fn slots(self) -> impl DerefMut<Target = Slots> {
        static TABLE: [Guarded<Slots>; 16] = [const { Guarded::new(Slots::new()) }; 16];
        TABLE[self.0 as usize % TABLE.len()].lock()
    }
}

/// Keep it until the job has ended.
pub enum Canceller {
    #[non_exhaustive]
    Live(Key),
    Cancelled(Tombstone),
}

impl Canceller {
    /// Ends the wait and every later one.
    pub fn cancel(&mut self) {
        if let Self::Live(key) = *self {
            *self = Self::Cancelled(Tombstone::place(key));
        }
    }
}

/// Owns a `Slot::Cancelled`.
pub struct Tombstone(Key);

impl Tombstone {
    fn place(key: Key) -> Self {
        let previous = key.slots().insert(key, Slot::Cancelled);
        if let Some(Slot::Armed(interest, fd, resume)) = previous {
            let fd = fd.disarm(interest);
            FdWait { key, interest, fd }.queue(resume);
        }
        Self(key)
    }
}

impl Drop for Tombstone {
    fn drop(&mut self) {
        self.0.slots().remove(&self.0);
    }
}

/// The descriptor of a job that is not armed.
pub struct FdWait {
    key: Key,
    interest: Interest,
    fd: Idle,
}

impl FdWait {
    #[inline]
    pub fn new(key: Key, interest: Interest, fd: JobFd) -> Self {
        let fd = Idle::new(fd);
        Self { key, interest, fd }
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd.get()
    }

    pub fn check_cancelled(&self) -> sys::Result<()> {
        match self.key.slots().get(&self.key) {
            Some(Slot::Cancelled) => Err(self.interest.cancelled()),
            _ => Ok(()),
        }
    }

    /// Pool thread. `resume` is called once, on the pool. The descriptor is closed before an `Err`.
    pub fn park(self, resume: impl FnOnce(sys::Result<Self>) + Send + 'static) {
        match self.check_cancelled() {
            Ok(()) => self.queue(Box::new(resume)),
            Err(err) => self.fail(err, resume),
        }
    }

    /// On this thread: the pool may have no other.
    fn fail(self, err: sys::Error, resume: impl FnOnce(sys::Result<Self>)) {
        drop(self);
        resume(Err(err));
    }

    fn queue(self, resume: Resume) {
        let mut io = IO.lock();
        match io.poller() {
            Ok(poller) => {
                io.queue.push((self, resume));
                drop(io);
                poller.wake();
            }
            // Only from `park`: an armed job had a poller.
            Err(err) => {
                drop(io);
                self.fail(err, resume);
            }
        }
    }

    /// IO thread. Under the lock, so that `cancel` cannot close the descriptor first.
    fn arm(self, poller: Poller, resume: Resume) {
        let Self { key, interest, fd } = self;
        let mut slots = key.slots();
        let armed = match slots.get(&key) {
            Some(Slot::Cancelled) => Err((fd.forget(), interest.cancelled())),
            _ => fd.arm(poller, interest, key),
        };
        match armed {
            Ok(fd) => drop(slots.insert(key, Slot::Armed(interest, fd, resume))),
            Err((fd, err)) => {
                drop(slots);
                Self { key, interest, fd }.wake(Err(err), resume);
            }
        }
    }

    fn wake(self, outcome: sys::Result<()>, resume: Resume) {
        let woken = (self, outcome, resume);
        bun_core::handle_oom(WorkPool::go(woken, |(wait, outcome, resume)| {
            resume(outcome.map(|()| wait))
        }));
    }
}

type Resume = Box<dyn FnOnce(sys::Result<FdWait>) + Send>;

/// A failure hands the descriptor back: the pool closes it.
type Arming = Result<Armed, (Idle, sys::Error)>;

/// A job without a slot is on the pool, in the queue, or has ended.
enum Slot {
    Armed(Interest, Armed, Resume),
    Cancelled,
}

type Slots = BTreeMap<Key, Slot>;

/// IO thread: the kernel reported `key`.
fn fire(key: Key, outcome: impl FnOnce(Fd, Interest) -> sys::Result<()>) {
    let mut slots = key.slots();
    match slots.remove(&key) {
        Some(Slot::Armed(interest, fd, resume)) => {
            drop(slots);
            let fd = fd.fired();
            let outcome = outcome(fd.get(), interest);
            FdWait { key, interest, fd }.wake(outcome, resume);
        }
        Some(Slot::Cancelled) => drop(slots.insert(key, Slot::Cancelled)),
        None => {}
    }
}

type Queue = Vec<(FdWait, Resume)>;

struct Io {
    /// From the first wait on.
    poller: Option<Poller>,
    /// Arming from the pool costs a busy pipe a third of its speed: the job then wakes too late.
    queue: Queue,
}

static IO: Guarded<Io> = Guarded::new(Io {
    poller: None,
    queue: Queue::new(),
});

impl Io {
    /// If starting fails, the next call retries.
    fn poller(&mut self) -> sys::Result<Poller> {
        Ok(match self.poller {
            Some(poller) => poller,
            None => *self.poller.insert(Poller::start()?),
        })
    }
}

/// Never closed.
#[derive(Clone, Copy)]
struct Poller([Fd; POLLER_FDS]);

impl Poller {
    fn arm_queued(self, jobs: &mut Queue) {
        core::mem::swap(jobs, &mut IO.lock().queue);
        for (wait, resume) in jobs.drain(..) {
            wait.arm(self, resume);
        }
    }

    #[cfg(not(all(test, target_os = "linux")))]
    #[cold]
    fn start() -> sys::Result<Self> {
        let files = Self::create()?;
        let poller = Self(files.each_ref().map(sys::File::fd));
        poller.add_waker()?;
        std::thread::Builder::new()
            .stack_size(1024 * 1024 * 2)
            .spawn(move || {
                bun_core::Output::Source::configure_named_thread(bun_core::zstr!("IO Watcher"));
                poller.wait()
            })
            .map_err(|err| {
                sys::Error::from_code_int(
                    err.raw_os_error().unwrap_or(libc::EAGAIN),
                    sys::Tag::pthread_create,
                )
            })?;
        Ok(Self(files.map(sys::File::into_raw)))
    }
}

// ─── epoll ───────────────────────────────────────────────────────────────────

#[cfg(any(target_os = "linux", target_os = "android"))]
const POLLER_FDS: usize = 2;

/// epoll keeps a one-shot entry that has fired.
#[cfg(any(target_os = "linux", target_os = "android"))]
enum Idle {
    New(JobFd),
    Fired(Armed),
}

#[cfg(any(target_os = "linux", target_os = "android"))]
struct Armed {
    /// Dropped first.
    _entry: Entry,
    fd: JobFd,
}

/// A second job on the descriptor gets EEXIST, and so has none to remove.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Entry(Poller, Fd);

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Drop for Entry {
    fn drop(&mut self) {
        self.0.remove(self.1);
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Idle {
    #[inline]
    fn new(fd: JobFd) -> Self {
        Self::New(fd)
    }

    #[inline]
    fn get(&self) -> Fd {
        let (Self::New(fd) | Self::Fired(Armed { fd, .. })) = self;
        fd.get()
    }

    fn arm(self, poller: Poller, interest: Interest, key: Key) -> Arming {
        log!("register({})", self.get());
        let interest = match interest {
            Interest::Readable => EPOLL::IN,
            Interest::Writable => EPOLL::OUT,
        };
        let events = interest | EPOLL::HUP | EPOLL::ERR | EPOLL::ONESHOT;
        let op = match self {
            Self::New(_) => EPOLL::CTL_ADD,
            Self::Fired(_) => EPOLL::CTL_MOD,
        };
        match (poller.ctl(op, self.get(), events, key), self) {
            (Err(err), this) => Err((this.forget(), err)),
            (Ok(()), Self::Fired(armed)) => Ok(armed),
            (Ok(()), Self::New(fd)) => Ok(Armed {
                _entry: Entry(poller, fd.get()),
                fd,
            }),
        }
    }

    /// Does not leave the entry to the pool: the next job on the descriptor may be faster.
    fn forget(self) -> Self {
        let (Self::New(fd) | Self::Fired(Armed { fd, .. })) = self;
        Self::New(fd)
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Armed {
    /// Leaves it to `Idle::forget`, on the IO thread.
    fn disarm(self, _: Interest) -> Idle {
        self.fired()
    }

    fn fired(self) -> Idle {
        Idle::Fired(self)
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Poller {
    fn create() -> sys::Result<[sys::File; POLLER_FDS]> {
        let waker = sys::File::from_fd(sys::eventfd(0, 0)?);
        let raw = crate::safe_c::epoll_create1(libc::EPOLL_CLOEXEC);
        match sys::get_errno(raw) {
            E::SUCCESS => Ok([sys::File::from_fd(Fd::from_native(raw)), waker]),
            err => Err(sys::Error::from_code(err, sys::Tag::epoll_create1)),
        }
    }
}

#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
impl Poller {
    /// Edge-triggered: no need to read its counter. No job has its key.
    fn add_waker(self) -> sys::Result<()> {
        let [_, waker] = self.0;
        self.ctl(EPOLL::CTL_ADD, waker, EPOLL::IN | EPOLL::ET, Key::next().0)
    }

    fn wake(self) {
        let [_, waker] = self.0;
        let _ = sys::write(waker, &1u64.to_ne_bytes());
    }

    fn ctl(self, op: i32, fd: Fd, events: u32, key: Key) -> sys::Result<()> {
        let ([epoll, _], event) = (self.0, libc::epoll_event { events, u64: key.0 });
        // SAFETY: `wait` does not take the data for an address.
        let rc = unsafe { sys::linux::epoll_ctl(epoll.native(), op, fd.native(), &event) };
        match sys::get_errno(rc) {
            E::SUCCESS => Ok(()),
            err => Err(sys::Error::from_code(err, sys::Tag::epoll_ctl)),
        }
    }

    fn remove(self, fd: Fd) {
        let [epoll, _] = self.0;
        let _ = sys::linux::epoll_ctl_del(epoll.native(), fd.native());
    }

    fn wait(self) {
        let [epoll, _] = self.0;
        let mut events: [libc::epoll_event; 256] = [bun_core::ffi::zeroed(); 256];
        let mut jobs = Queue::new();
        loop {
            self.arm_queued(&mut jobs);
            // SAFETY: `events` is writable for its length.
            let rc = unsafe {
                libc::epoll_wait(epoll.native(), events.as_mut_ptr(), events.len() as _, -1)
            };
            match sys::get_errno(rc) {
                E::EINTR => continue,
                E::SUCCESS => {}
                e => bun_core::Output::panic(format_args!("epoll_wait: {:?}", e)),
            }
            for event in &events[..rc as usize] {
                fire(Key(event.u64), |fd, interest| {
                    match event.events & EPOLL::ERR {
                        0 => Ok(()),
                        _ => Err(pending_error(fd, interest)),
                    }
                });
            }
        }
    }
}

/// EPOLLERR carries no errno, and reading SO_ERROR would clear it on the caller's socket.
#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
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

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const POLLER_FDS: usize = 1;

/// kqueue deletes a one-shot entry when it reports it.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Idle(JobFd);

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Armed {
    poller: Poller,
    fd: JobFd,
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Idle {
    #[inline]
    fn new(fd: JobFd) -> Self {
        Self(fd)
    }

    #[inline]
    fn get(&self) -> Fd {
        self.0.get()
    }

    fn arm(self, poller: Poller, interest: Interest, key: Key) -> Arming {
        log!("register({})", self.get());
        match poller.change(&self.0, interest, libc::EV_ADD | libc::EV_ONESHOT, key.0) {
            Ok(_) => Ok(Armed { poller, fd: self.0 }),
            Err(err) => Err((self, err)),
        }
    }

    fn forget(self) -> Self {
        self
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Armed {
    fn disarm(self, interest: Interest) -> Idle {
        // Fails if the entry was just reported, or if script closed the descriptor.
        let _ = (self.poller).change(&self.fd, interest, libc::EV_DELETE, 0);
        self.fired()
    }

    fn fired(self) -> Idle {
        Idle(self.fd)
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Poller {
    fn create() -> sys::Result<[sys::File; POLLER_FDS]> {
        match sys::kqueue() {
            Ok(kqueue) => Ok([sys::File::from_fd(kqueue)]),
            // Like `sys::eventfd`.
            Err(err) => Err(sys::Error::from_code(err.get_errno(), sys::Tag::open)),
        }
    }

    fn add_waker(self) -> sys::Result<usize> {
        self.kevent(0, libc::EVFILT_USER, libc::EV_ADD | libc::EV_CLEAR, 0, 0)
    }

    fn wake(self) {
        let _ = self.kevent(0, libc::EVFILT_USER, 0, libc::NOTE_TRIGGER, 0);
    }

    fn change(self, fd: &JobFd, interest: Interest, flags: u16, udata: u64) -> sys::Result<usize> {
        let filter = match interest {
            Interest::Readable => libc::EVFILT_READ,
            Interest::Writable => libc::EVFILT_WRITE,
        };
        self.kevent(fd.get().native() as _, filter, flags, 0, udata)
    }

    fn kevent(
        self,
        ident: usize,
        filter: i16,
        flags: u16,
        fflags: u32,
        udata: u64,
    ) -> sys::Result<usize> {
        let [kqueue] = self.0;
        let mut change: libc::kevent = bun_core::ffi::zeroed();
        (change.ident, change.filter) = (ident, filter);
        (change.flags, change.fflags) = (flags, fflags);
        change.udata = core::ptr::without_provenance_mut(udata as usize);
        // Without room for events, kevent() does not wait and reports a failed change in errno.
        // SAFETY: `wait` does not take `udata` for an address.
        let changed = unsafe { sys::kevent(kqueue, &[change], &mut [], None) };
        // Script must not see `kqueue` in the error.
        changed.map_err(|err| sys::Error::from_code(err.get_errno(), sys::Tag::kevent))
    }

    fn wait(self) {
        let [kqueue] = self.0;
        let mut events: [libc::kevent; 256] = [bun_core::ffi::zeroed(); 256];
        let mut jobs = Queue::new();
        loop {
            self.arm_queued(&mut jobs);
            let count = sys::kevent_wait(kqueue, &mut events, None)
                .unwrap_or_else(|err| bun_core::Output::panic(format_args!("{err}")));
            for event in &events[..count] {
                if event.filter != libc::EVFILT_USER {
                    fire(Key(event.udata.addr() as u64), |_, _| Ok(()));
                }
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::cell::RefCell;
    use std::sync::mpsc;

    use super::*;

    /// The entries of the fake epoll, by descriptor.
    static ENTRIES: Guarded<BTreeMap<i32, Key>> = Guarded::new(BTreeMap::new());

    static IO_THREAD: Guarded<()> = Guarded::new(());

    impl Poller {
        pub(super) fn start() -> sys::Result<Self> {
            Ok(Self(Self::create()?.map(sys::File::into_raw)))
        }

        /// Does what the IO thread would.
        pub(super) fn wake(self) {
            let io_thread = IO_THREAD.lock();
            self.arm_queued(&mut Vec::new());
            drop(io_thread);
            WorkPool::run();
        }

        pub(super) fn ctl(self, op: i32, fd: Fd, _: u32, key: Key) -> sys::Result<()> {
            assert!(self.0[0].is_valid());
            let known = ENTRIES.lock().contains_key(&fd.native());
            if known == (op == EPOLL::CTL_ADD) {
                let err = if known { E::EEXIST } else { E::ENOENT };
                return Err(sys::Error::from_code(err, sys::Tag::epoll_ctl));
            }
            ENTRIES.lock().insert(fd.native(), key);
            Ok(())
        }

        pub(super) fn remove(self, fd: Fd) {
            ENTRIES.lock().remove(&fd.native());
        }
    }

    thread_local! {
        static SCHEDULED: RefCell<Vec<Box<dyn FnOnce()>>> = RefCell::default();
    }

    pub(super) struct WorkPool;

    impl WorkPool {
        pub(super) fn go<C: 'static>(context: C, run: fn(C)) -> Result<(), bun_core::AllocError> {
            SCHEDULED.with_borrow_mut(|tasks| tasks.push(Box::new(move || run(context))));
            Ok(())
        }

        /// What this thread has scheduled.
        fn run() {
            SCHEDULED.take().into_iter().for_each(|task| task());
        }
    }

    fn entry(fd: i32) -> Option<Key> {
        ENTRIES.lock().get(&fd).copied()
    }

    fn ready(key: Key) {
        fire(key, |_, _| Ok(()));
        WorkPool::run();
    }

    fn new(fd: i32) -> (FdWait, Canceller) {
        let (key, canceller) = Key::next();
        let fd = JobFd::Borrowed(Fd::from_native(fd));
        (FdWait::new(key, Interest::Readable, fd), canceller)
    }

    /// Parks `times` times, then reports how it ended. The channel closes when the job is freed.
    fn job(wait: FdWait, times: Box<u32>, ended: mpsc::Sender<E>) {
        let key = wait.key;
        wait.park(move |woken| {
            let errno = match (woken, *times) {
                (Ok(_), 1) => E::SUCCESS,
                (Ok(wait), more) => return job(wait, Box::new(more - 1), ended),
                (Err(err), _) => err.get_errno(),
            };
            assert!(!ENTRIES.lock().values().any(|entry| *entry == key));
            ended.send(errno).unwrap();
        });
    }

    fn park(wait: FdWait, times: u32) -> mpsc::Receiver<E> {
        let (sender, ended) = mpsc::channel();
        job(wait, Box::new(times), sender);
        ended
    }

    fn all(ended: mpsc::Receiver<E>) -> Vec<E> {
        ended.iter().collect()
    }

    #[test]
    fn each_event_ends_one_wait() {
        let (wait, _canceller) = new(1000);
        let key = wait.key;
        let ended = park(wait, 2);
        ready(key);
        assert_eq!(ended.try_recv(), Err(mpsc::TryRecvError::Empty));
        ready(key);
        ready(key);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn cancel_ends_a_wait_and_every_later_one() {
        let (wait, mut canceller) = new(1001);
        let key = wait.key;
        let ended = park(wait, 1);
        canceller.cancel();
        assert!(entry(1001).is_none());
        canceller.cancel();
        ready(key);
        assert_eq!(all(ended), [E::ECANCELED]);

        let (wait, mut canceller) = new(1001);
        let key = wait.key;
        assert!(wait.check_cancelled().is_ok());
        let ended = park(wait, 2);
        fire(key, |_, _| Ok(()));
        canceller.cancel();
        ready(key);
        assert_eq!(all(ended), [E::ECANCELED]);
        let fd = JobFd::Borrowed(Fd::from_native(1001));
        assert!((FdWait::new(key, Interest::Readable, fd).check_cancelled()).is_err());
        drop(canceller);
        assert!(!key.slots().contains_key(&key));
    }

    #[test]
    fn a_job_that_is_cancelled_on_the_pool_ends_there() {
        let (wait, mut canceller) = new(1007);
        canceller.cancel();
        let _io_thread = IO_THREAD.lock();
        assert_eq!(all(park(wait, 1)), [E::ECANCELED]);
    }

    #[test]
    fn a_queued_job_that_is_cancelled_makes_room_for_the_next() {
        let ((first, mut canceller), (second, _second)) = (new(1004), new(1004));
        let keys = (first.key, second.key);
        let until_queued = |key| {
            while !IO.lock().queue.iter().any(|(wait, _)| wait.key == key) {
                std::thread::yield_now();
            }
        };
        let first = park(first, 2);
        let io_thread = IO_THREAD.lock();
        let second = std::thread::scope(|scope| {
            scope.spawn(|| ready(keys.0));
            until_queued(keys.0);
            canceller.cancel();
            let second = scope.spawn(|| park(second, 1));
            until_queued(keys.1);
            drop(io_thread);
            second.join().unwrap()
        });
        ready(keys.1);
        assert_eq!(all(first), [E::ECANCELED]);
        assert_eq!(all(second), [E::SUCCESS]);
    }

    #[test]
    fn an_error_event_ends_the_job() {
        let (wait, _canceller) = new(1005);
        let key = wait.key;
        let ended = park(wait, 2);
        fire(key, |_, _| {
            Err(sys::Error::from_code(E::EPIPE, sys::Tag::write))
        });
        WorkPool::run();
        assert_eq!(all(ended), [E::EPIPE]);
    }

    #[test]
    fn a_second_job_leaves_the_entry_of_the_first() {
        let ((first, _first), (second, _second)) = (new(1002), new(1002));
        let key = first.key;
        let ended = park(first, 1);
        assert_eq!(all(park(second, 1)), [E::EEXIST]);
        assert!(entry(1002) == Some(key));
        ready(key);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_job_whose_descriptor_was_reused_leaves_the_entry_of_the_next() {
        let ((first, _first), (second, _second)) = (new(1006), new(1006));
        let keys = (first.key, second.key);
        let (sender, idle) = mpsc::channel();
        first.park(move |woken| sender.send(woken.ok()).unwrap());
        ready(keys.0);
        ENTRIES.lock().remove(&1006);
        let poller = IO.lock().poller().ok().unwrap();
        let first = idle.recv().unwrap().unwrap();
        first.arm(poller, Box::new(|woken| assert!(woken.is_err())));
        second.arm(poller, Box::new(|woken| assert!(woken.is_ok())));
        WorkPool::run();
        assert!(entry(1006) == Some(keys.1));
        ready(keys.1);
    }

    #[test]
    fn a_job_that_cancel_races_ends_once() {
        for _ in 0..32 {
            let (wait, mut canceller) = new(1003);
            let key = wait.key;
            let ended = std::thread::scope(|scope| {
                scope.spawn(|| (canceller.cancel(), WorkPool::run()));
                scope.spawn(|| (0..3).for_each(|_| ready(key)));
                park(wait, 2)
            });
            assert!(matches!(all(ended)[..], [E::SUCCESS | E::ECANCELED]));
            drop(canceller);
            assert!(!key.slots().contains_key(&key));
        }
    }
}

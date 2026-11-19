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
        // The entry goes now: the next job on the descriptor may be faster than the pool.
        let (interest, fd, resume) = match previous {
            Some(Slot::Queued(job)) => (job.interest, job.fd.forget(), job.resume),
            Some(Slot::Armed(job)) => (job.interest, job.fd.disarm(job.interest), job.resume),
            Some(Slot::Cancelled) | None => return Self(key),
        };
        FdWait { key, interest, fd }.wake(Err(interest.cancelled()), resume);
        Self(key)
    }
}

impl Drop for Tombstone {
    fn drop(&mut self) {
        self.0.slots().remove(&self.0);
    }
}

/// The descriptor of a job that is on the pool.
pub struct FdWait {
    key: Key,
    interest: Interest,
    fd: Idle,
}

impl FdWait {
    #[inline]
    pub fn new(key: Key, interest: Interest, fd: JobFd) -> Self {
        let fd = Idle::New(fd);
        Self { key, interest, fd }
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd.get()
    }

    pub fn check_cancelled(&self) -> sys::Result<()> {
        match self.key.slots().contains_key(&self.key) {
            true => Err(self.interest.cancelled()),
            false => Ok(()),
        }
    }

    /// Pool thread. `resume` is called once, on the pool. The descriptor is closed before an `Err`.
    pub fn park(self, resume: impl FnOnce(sys::Result<Self>) + Send + 'static) {
        let Self { key, interest, fd } = self;
        let resume: Resume = Box::new(resume);
        let mut slots = key.slots();
        let queued = match slots.contains_key(&key) {
            true => Err(interest.cancelled()),
            false => Poller::queue(key),
        };
        match queued {
            Ok(poller) => {
                let job = Parked {
                    interest,
                    fd,
                    resume,
                };
                slots.insert(key, Slot::Queued(job));
                drop(slots);
                poller.wake();
            }
            Err(err) => {
                drop((slots, fd));
                resume(Err(err));
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

struct Parked<Fd> {
    interest: Interest,
    fd: Fd,
    resume: Resume,
}

/// A job without a slot is on the pool, or has ended.
enum Slot {
    /// Arming from the pool costs a busy pipe a third of its speed: the job then wakes too late.
    Queued(Parked<Idle>),
    Armed(Parked<Armed>),
    Cancelled,
}

type Slots = BTreeMap<Key, Slot>;

/// IO thread. Under the lock, so that `cancel` cannot close the descriptor first.
fn arm(poller: Poller, key: Key) {
    let mut slots = key.slots();
    match slots.remove(&key) {
        Some(Slot::Queued(job)) => match job.fd.arm(poller, job.interest, key) {
            Ok(fd) => {
                let (interest, resume) = (job.interest, job.resume);
                let job = Parked {
                    interest,
                    fd,
                    resume,
                };
                slots.insert(key, Slot::Armed(job));
            }
            Err(err) => {
                drop(slots);
                let failed = (err, job.resume);
                bun_core::handle_oom(WorkPool::go(failed, |(err, resume)| resume(Err(err))));
            }
        },
        Some(cancelled) => drop(slots.insert(key, cancelled)),
        None => {}
    }
}

/// IO thread: the kernel reported `key`.
fn fire(key: Key, outcome: impl FnOnce(Fd, Interest) -> sys::Result<()>) {
    let mut slots = key.slots();
    match slots.remove(&key) {
        Some(Slot::Armed(job)) => {
            drop(slots);
            let (interest, fd) = (job.interest, job.fd.fired());
            let outcome = outcome(fd.get(), interest);
            FdWait { key, interest, fd }.wake(outcome, job.resume);
        }
        Some(cancelled) => drop(slots.insert(key, cancelled)),
        None => {}
    }
}

/// Never closed.
#[derive(Clone, Copy)]
struct Poller([Fd; POLLER_FDS]);

/// The IO thread, from the first wait on, and what it has to arm.
static IO: Guarded<(Option<Poller>, Vec<Key>)> = Guarded::new((None, Vec::new()));

impl Poller {
    /// If starting fails, the next call retries.
    fn queue(key: Key) -> sys::Result<Self> {
        let (started, queue) = &mut *IO.lock();
        let poller = match *started {
            Some(poller) => poller,
            None => *started.insert(Self::start()?),
        };
        queue.push(key);
        Ok(poller)
    }

    fn arm_queued(self, keys: &mut Vec<Key>) {
        core::mem::swap(keys, &mut IO.lock().1);
        keys.drain(..).for_each(|key| arm(self, key));
    }

    #[cfg(not(all(test, target_os = "linux")))]
    #[cold]
    fn start() -> sys::Result<Self> {
        let files = Self::create()?;
        let poller = Self(files.each_ref().map(sys::File::fd));
        // A key without a job.
        poller.add_waker(Key::next().0)?;
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

/// epoll, eventfd.
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
    fn get(&self) -> Fd {
        let (Self::New(fd) | Self::Fired(Armed { fd, .. })) = self;
        fd.get()
    }

    fn arm(self, poller: Poller, interest: Interest, key: Key) -> sys::Result<Armed> {
        log!("register({})", self.get());
        let interest = match interest {
            Interest::Readable => EPOLL::IN,
            Interest::Writable => EPOLL::OUT,
        };
        let events = interest | EPOLL::HUP | EPOLL::ERR | EPOLL::ONESHOT;
        match self {
            Self::New(fd) => {
                poller.ctl(EPOLL::CTL_ADD, fd.get(), events, key)?;
                let _entry = Entry(poller, fd.get());
                Ok(Armed { _entry, fd })
            }
            Self::Fired(armed) => {
                poller.ctl(EPOLL::CTL_MOD, armed.fd.get(), events, key)?;
                Ok(armed)
            }
        }
    }

    fn forget(self) -> Self {
        let (Self::New(fd) | Self::Fired(Armed { fd, .. })) = self;
        Self::New(fd)
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Armed {
    fn disarm(self, _: Interest) -> Idle {
        self.fired().forget()
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
    /// Edge-triggered: no need to read its counter.
    fn add_waker(self, key: Key) -> sys::Result<()> {
        self.ctl(EPOLL::CTL_ADD, self.0[1], EPOLL::IN | EPOLL::ET, key)
    }

    fn wake(self) {
        let _ = sys::write(self.0[1], &1u64.to_ne_bytes());
    }

    fn ctl(self, op: i32, fd: Fd, events: u32, key: Key) -> sys::Result<()> {
        let event = libc::epoll_event { events, u64: key.0 };
        // SAFETY: `wait` does not take the data for an address.
        let rc = unsafe { sys::linux::epoll_ctl(self.0[0].native(), op, fd.native(), &event) };
        match sys::get_errno(rc) {
            E::SUCCESS => Ok(()),
            err => Err(sys::Error::from_code(err, sys::Tag::epoll_ctl)),
        }
    }

    fn remove(self, fd: Fd) {
        let _ = sys::linux::epoll_ctl_del(self.0[0].native(), fd.native());
    }

    fn wait(self) {
        let mut events: [libc::epoll_event; 256] = [bun_core::ffi::zeroed(); 256];
        let mut keys = Vec::new();
        loop {
            self.arm_queued(&mut keys);
            // SAFETY: `events` is writable for its length.
            let rc = unsafe {
                libc::epoll_wait(
                    self.0[0].native(),
                    events.as_mut_ptr(),
                    events.len() as _,
                    -1,
                )
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
enum Idle {
    New(JobFd),
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Armed {
    poller: Poller,
    fd: JobFd,
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Idle {
    #[inline]
    fn get(&self) -> Fd {
        let Self::New(fd) = self;
        fd.get()
    }

    fn arm(self, poller: Poller, interest: Interest, key: Key) -> sys::Result<Armed> {
        log!("register({})", self.get());
        let Self::New(fd) = self;
        poller.change(&fd, interest, libc::EV_ADD | libc::EV_ONESHOT, key.0)?;
        Ok(Armed { poller, fd })
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
        Idle::New(self.fd)
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Poller {
    fn create() -> sys::Result<[sys::File; POLLER_FDS]> {
        Ok([sys::File::from_fd(sys::kqueue()?)])
    }

    fn add_waker(self, key: Key) -> sys::Result<usize> {
        let flags = libc::EV_ADD | libc::EV_CLEAR;
        self.kevent(0, libc::EVFILT_USER, flags, 0, key.0)
    }

    fn wake(self) {
        // This overwrites `udata`.
        let _ = self.kevent(0, libc::EVFILT_USER, 0, libc::NOTE_TRIGGER, Key::next().0.0);
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
        let mut change: libc::kevent = bun_core::ffi::zeroed();
        (change.ident, change.filter) = (ident, filter);
        (change.flags, change.fflags) = (flags, fflags);
        change.udata = core::ptr::without_provenance_mut(udata as usize);
        // Without room for events, kevent() does not wait and reports a failed change in errno.
        // SAFETY: `wait` does not take `udata` for an address.
        unsafe { sys::kevent(self.0[0], &[change], &mut [], None) }
    }

    fn wait(self) {
        let mut events: [libc::kevent; 256] = [bun_core::ffi::zeroed(); 256];
        let mut keys = Vec::new();
        loop {
            self.arm_queued(&mut keys);
            let count = sys::kevent_wait(self.0[0], &mut events, None)
                .unwrap_or_else(|err| bun_core::Output::panic(format_args!("{err}")));
            for event in &events[..count] {
                fire(Key(event.udata.addr() as u64), |_, _| Ok(()));
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
    fn cancel_ends_a_job_that_is_not_armed_yet() {
        let (wait, mut canceller) = new(1004);
        let key = wait.key;
        let ended = park(wait, 2);
        let io_thread = IO_THREAD.lock();
        std::thread::scope(|scope| {
            scope.spawn(|| ready(key));
            while !matches!(key.slots().get(&key), Some(Slot::Queued(_))) {
                std::thread::yield_now();
            }
            canceller.cancel();
            assert!(entry(1004).is_none());
            drop(io_thread);
        });
        WorkPool::run();
        assert_eq!(all(ended), [E::ECANCELED]);
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

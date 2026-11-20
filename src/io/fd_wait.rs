//! One thread waits on its own epoll or kqueue for the pipes, sockets and ttys of all work pool jobs.

use core::ops::DerefMut;
use core::sync::atomic::{AtomicU64, Ordering};
use std::collections::{BTreeMap, btree_map};

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_sys::linux::EPOLL;
use bun_sys::{self as sys, E, Fd, FdExt as _};
use bun_threading::Guarded;
#[cfg(not(all(test, target_os = "linux")))]
use bun_threading::WorkPool;
#[cfg(all(test, target_os = "linux"))]
use tests::{WorkPool, epoll_ctl};

use crate::Waker;

bun_core::define_scoped_log!(log, Loop, visible);

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
    const NO_JOB: Self = Self(0);

    #[inline]
    pub fn next() -> (Self, Canceller) {
        static NEXT: AtomicU64 = AtomicU64::new(Key::NO_JOB.0 + 1);
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
            let (poller, fd) = (fd.poller(), Idle::WasArmed(fd));
            FdWait { key, interest, fd }.queue(poller, resume);
        }
        Self(key)
    }
}

impl Drop for Tombstone {
    fn drop(&mut self) {
        self.0.slots().remove(&self.0);
    }
}

/// The descriptor of a job that is not in the table.
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

    /// The job is here, so only a tombstone can have its slot.
    fn check_cancelled(&self) -> sys::Result<()> {
        match self.key.slots().contains_key(&self.key) {
            true => Err(self.interest.cancelled()),
            false => Ok(()),
        }
    }

    /// Pool thread. `resume` is called once, on the pool. The descriptor is closed before an `Err`.
    pub fn park(self, resume: impl FnOnce(sys::Result<Self>) + Send + 'static) {
        let poller = IO.lock().poller();
        match poller.and_then(|poller| self.check_cancelled().map(|()| poller)) {
            Ok(poller) => self.queue(poller, Box::new(resume)),
            // On this thread: the pool may have no other.
            Err(err) => {
                drop(self);
                resume(Err(err));
            }
        }
    }

    fn queue(self, poller: Poller, resume: Resume) {
        IO.lock().queue.push((self, resume));
        poller.wake();
    }

    /// IO thread. The kernel may take its time, so not under the lock that `cancel` takes.
    fn arm(self, changes: &mut Changes, resume: Resume) {
        let cancelled = self.check_cancelled();
        let Self { key, interest, fd } = self;
        let armed = match cancelled {
            Ok(()) => changes.add(fd, interest, key),
            Err(err) => Err((changes.remove(fd, interest), err)),
        };
        let fd = match armed {
            Ok(fd) => fd,
            Err((fd, err)) => return Self::new(key, interest, fd).wake(Err(err), resume),
        };
        let mut slots = key.slots();
        match slots.entry(key) {
            btree_map::Entry::Vacant(slot) => {
                slot.insert(Slot::Armed(interest, fd, resume));
            }
            // Cancelled meanwhile.
            btree_map::Entry::Occupied(_) => {
                drop(slots);
                let fd = changes.remove(Idle::WasArmed(fd), interest);
                Self::new(key, interest, fd).wake(Err(interest.cancelled()), resume);
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

enum Idle {
    New(JobFd),
    WasArmed(Armed),
}

impl Idle {
    #[inline]
    fn get(&self) -> Fd {
        let (Self::New(fd) | Self::WasArmed(Armed { fd, .. })) = self;
        fd.get()
    }
}

/// A failure hands the descriptor back: the pool closes it.
type Arming = Result<Armed, (JobFd, sys::Error)>;

/// A job without a slot is on the pool, in the queue, or has ended.
enum Slot {
    Armed(Interest, Armed, Resume),
    Cancelled,
}

type Slots = BTreeMap<Key, Slot>;

/// IO thread: the kernel reported `key`.
fn fire(key: Key, outcome: sys::Result<()>) {
    let mut slots = key.slots();
    match slots.remove(&key) {
        Some(Slot::Armed(interest, fd, resume)) => {
            drop(slots);
            let fd = Idle::WasArmed(fd);
            FdWait { key, interest, fd }.wake(outcome, resume);
        }
        Some(Slot::Cancelled) => drop(slots.insert(key, Slot::Cancelled)),
        None => {}
    }
}

type Queue = Vec<(FdWait, Resume)>;

enum Thread {
    /// Until the first wait.
    Missing,
    NotSpawned(Poller),
    Running(Poller),
}

struct Io {
    thread: Thread,
    /// Arming from the pool costs a busy pipe a third of its speed: the job then wakes too late.
    queue: Queue,
}

static IO: Guarded<Io> = Guarded::new(Io {
    thread: Thread::Missing,
    queue: Queue::new(),
});

impl Io {
    /// If starting fails, the next call retries.
    fn poller(&mut self) -> sys::Result<Poller> {
        let poller = match self.thread {
            Thread::Missing => Poller::new()?,
            Thread::NotSpawned(poller) => poller,
            Thread::Running(poller) => return Ok(poller),
        };
        self.thread = Thread::NotSpawned(poller);
        poller.spawn()?;
        self.thread = Thread::Running(poller);
        Ok(poller)
    }
}

/// Never closed.
#[derive(Clone, Copy)]
struct Poller {
    fd: Fd,
    waker: &'static Waker,
}

impl Changes {
    fn arm_queued(&mut self, jobs: &mut Queue) {
        core::mem::swap(jobs, &mut IO.lock().queue);
        for (wait, resume) in jobs.drain(..) {
            wait.arm(self, resume);
        }
    }
}

impl Poller {
    #[cold]
    fn new() -> sys::Result<Self> {
        let waker = Waker::init().map_err(|err| {
            let errno = match err {
                crate::Error::Sys(errno) => errno,
                _ => E::ENOMEM,
            };
            sys::Error::from_code(errno, sys::Tag::open)
        })?;
        let fd = Self::watch(&waker)?;
        let waker = Box::leak(Box::new(waker));
        Ok(Self { fd, waker })
    }

    #[cfg(not(all(test, target_os = "linux")))]
    fn wake(self) {
        self.waker.wake();
    }

    #[cfg(not(all(test, target_os = "linux")))]
    #[cold]
    fn spawn(self) -> sys::Result<()> {
        std::thread::Builder::new()
            .stack_size(1024 * 1024 * 2)
            .spawn(move || {
                bun_core::Output::Source::configure_named_thread(bun_core::zstr!("IO Watcher"));
                self.wait()
            })
            .map(drop)
            .map_err(|err| {
                sys::Error::from_code_int(
                    err.raw_os_error().unwrap_or(libc::EAGAIN),
                    sys::Tag::pthread_create,
                )
            })
    }
}

// ─── epoll ───────────────────────────────────────────────────────────────────

/// IO thread. Applied at once.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Changes(Poller);

/// epoll keeps a one-shot entry that has fired.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Armed {
    /// Dropped first.
    entry: Entry,
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
impl Armed {
    fn poller(&self) -> Poller {
        self.entry.0
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Changes {
    fn add(&mut self, fd: Idle, interest: Interest, key: Key) -> Arming {
        log!("register({})", fd.get());
        let events = match interest {
            Interest::Readable => EPOLL::IN,
            Interest::Writable => EPOLL::OUT,
        };
        let op = match fd {
            Idle::New(_) => EPOLL::CTL_ADD,
            Idle::WasArmed(_) => EPOLL::CTL_MOD,
        };
        let Self(poller) = *self;
        let added = epoll_ctl(poller.fd, op, fd.get(), events | EPOLL::ONESHOT, key);
        match (added, fd) {
            (Err(err), fd) => Err((self.remove(fd, interest), err)),
            (Ok(()), Idle::WasArmed(armed)) => Ok(armed),
            (Ok(()), Idle::New(fd)) => Ok(Armed {
                entry: Entry(poller, fd.get()),
                fd,
            }),
        }
    }

    /// Does not leave the entry to the pool: the next job on the descriptor may be faster.
    fn remove(&mut self, fd: Idle, _: Interest) -> JobFd {
        let (Idle::New(fd) | Idle::WasArmed(Armed { fd, .. })) = fd;
        fd
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Poller {
    fn watch(waker: &Waker) -> sys::Result<Fd> {
        let raw = crate::safe_c::epoll_create1(libc::EPOLL_CLOEXEC);
        let epoll = match sys::get_errno(raw) {
            E::SUCCESS => sys::File::from_fd(Fd::from_native(raw)),
            err => return Err(sys::Error::from_code(err, sys::Tag::epoll_create1)),
        };
        // Edge-triggered: no need to read its counter.
        let (events, key) = (EPOLL::IN | EPOLL::ET, Key::NO_JOB);
        epoll_ctl(epoll.fd(), EPOLL::CTL_ADD, waker.get_fd(), events, key)?;
        Ok(epoll.into_raw())
    }
}

#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
fn epoll_ctl(epoll: Fd, op: i32, fd: Fd, events: u32, key: Key) -> sys::Result<()> {
    let events = events | EPOLL::HUP | EPOLL::ERR;
    let event = libc::epoll_event { events, u64: key.0 };
    // SAFETY: `wait` does not take the data for an address.
    let rc = unsafe { sys::linux::epoll_ctl(epoll.native(), op, fd.native(), &event) };
    match sys::get_errno(rc) {
        E::SUCCESS => Ok(()),
        err => Err(sys::Error::from_code(err, sys::Tag::epoll_ctl)),
    }
}

#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
impl Poller {
    fn remove(self, fd: Fd) {
        let _ = sys::linux::epoll_ctl_del(self.fd.native(), fd.native());
    }

    fn wait(self) {
        let mut events: [libc::epoll_event; 256] = [bun_core::ffi::zeroed(); 256];
        let mut jobs = Queue::new();
        loop {
            Changes(self).arm_queued(&mut jobs);
            // SAFETY: `events` is writable for its length.
            let rc = unsafe {
                libc::epoll_wait(self.fd.native(), events.as_mut_ptr(), events.len() as _, -1)
            };
            match sys::get_errno(rc) {
                E::EINTR => continue,
                E::SUCCESS => {}
                e => bun_core::Output::panic(format_args!("epoll_wait: {:?}", e)),
            }
            for event in &events[..rc as usize] {
                // EPOLLERR carries no errno, and reading SO_ERROR would clear it on the caller's socket.
                let outcome = match event.events & EPOLL::ERR {
                    0 => Ok(()),
                    _ => Err(sys::Error::from_code(E::SUCCESS, sys::Tag::epoll_ctl)),
                };
                fire(Key(event.u64), outcome);
            }
        }
    }
}

// ─── kqueue ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "freebsd")]
type KEvent = libc::kevent;
#[cfg(target_os = "macos")]
type KEvent = libc::kevent64_s;

/// IO thread. Applied by the next wait, which reports a failure as an event.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Changes(Poller, Vec<KEvent>);

/// kqueue deletes a one-shot entry when it reports it.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Armed {
    poller: Poller,
    fd: JobFd,
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Armed {
    fn poller(&self) -> Poller {
        self.poller
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Changes {
    fn add(&mut self, fd: Idle, interest: Interest, key: Key) -> Arming {
        log!("register({})", fd.get());
        let (Idle::New(fd) | Idle::WasArmed(Armed { fd, .. })) = fd;
        let flags = libc::EV_ADD | libc::EV_ONESHOT;
        self.1.push(change(fd.get(), interest, flags, key));
        Ok(Armed { poller: self.0, fd })
    }

    /// By descriptor: after a report, this can be the entry of another job.
    fn remove(&mut self, fd: Idle, interest: Interest) -> JobFd {
        match fd {
            Idle::New(fd) => fd,
            Idle::WasArmed(Armed { fd, .. }) => {
                (self.1).push(change(fd.get(), interest, libc::EV_DELETE, Key::NO_JOB));
                fd
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
fn change(fd: Fd, interest: Interest, flags: u16, key: Key) -> KEvent {
    let mut change: KEvent = bun_core::ffi::zeroed();
    change.ident = fd.native() as _;
    change.filter = match interest {
        Interest::Readable => libc::EVFILT_READ,
        Interest::Writable => libc::EVFILT_WRITE,
    };
    change.flags = flags;
    change.udata = key.0 as _;
    change
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
fn kevent(kqueue: Fd, changes: &[KEvent], events: &mut [KEvent]) -> sys::Result<usize> {
    #[cfg(target_os = "macos")]
    // SAFETY: `wait` does not take `udata` for an address.
    let rc = unsafe { sys::darwin::kevent64(kqueue.native(), changes, events, 0, None) };
    #[cfg(target_os = "freebsd")]
    // SAFETY: as above, and the slices are valid for their lengths. `sys::kevent` would repeat the changes.
    let rc = unsafe {
        libc::kevent(
            kqueue.native(),
            changes.as_ptr(),
            changes.len() as _,
            events.as_mut_ptr(),
            events.len() as _,
            core::ptr::null(),
        )
    };
    match sys::get_errno(rc) {
        E::SUCCESS => Ok(rc as usize),
        // In the wait, after the changes.
        E::EINTR => Ok(0),
        err => Err(sys::Error::from_code(err, sys::Tag::kevent)),
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Poller {
    /// The waker has a kqueue of its own, and no `udata` in it.
    #[cfg(target_os = "macos")]
    fn watch(waker: &Waker) -> sys::Result<Fd> {
        Ok(waker.get_fd())
    }

    #[cfg(target_os = "freebsd")]
    fn watch(waker: &Waker) -> sys::Result<Fd> {
        let kqueue = sys::File::from_fd(sys::kqueue()?);
        // Edge-triggered: no need to read its counter.
        let flags = libc::EV_ADD | libc::EV_CLEAR;
        let add = change(waker.get_fd(), Interest::Readable, flags, Key::NO_JOB);
        kevent(kqueue.fd(), &[add], &mut [])?;
        Ok(kqueue.into_raw())
    }

    fn wait(self) {
        let mut events = Vec::new();
        let mut jobs = Queue::new();
        loop {
            let mut changes = Changes(self, Vec::new());
            changes.arm_queued(&mut jobs);
            // Room for a failure of each change.
            events.resize(changes.1.len().max(256), bun_core::ffi::zeroed());
            events.shrink_to_fit();
            let count = kevent(self.fd, &changes.1, &mut events)
                .unwrap_or_else(|err| bun_core::Output::panic(format_args!("{err}")));
            for event in &events[..count] {
                let outcome = match event.flags & libc::EV_ERROR {
                    0 => Ok(()),
                    _ => Err(sys::Error::from_code_int(event.data as _, sys::Tag::kevent)),
                };
                fire(Key(event.udata as u64), outcome);
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::sync::mpsc;

    use super::*;

    /// The entries of the fake epoll, by descriptor.
    static ENTRIES: Guarded<BTreeMap<i32, Key>> = Guarded::new(BTreeMap::new());

    static IO_THREAD: Guarded<()> = Guarded::new(());

    impl Poller {
        pub(super) fn spawn(self) -> sys::Result<()> {
            Ok(())
        }

        /// Does what the IO thread would.
        pub(super) fn wake(self) {
            self.waker.wake();
            let io_thread = IO_THREAD.lock();
            Changes(self).arm_queued(&mut Vec::new());
            drop(io_thread);
            WorkPool::run();
        }

        pub(super) fn remove(self, fd: Fd) {
            ENTRIES.lock().remove(&fd.native());
        }
    }

    pub(super) fn epoll_ctl(_: Fd, op: i32, fd: Fd, _: u32, key: Key) -> sys::Result<()> {
        if let Some(mut canceller) = CANCELS_IN_CTL.take() {
            canceller.cancel();
            CANCELLED_IN_CTL.set(Some(canceller));
        }
        let known = ENTRIES.lock().contains_key(&fd.native());
        if known == (op == EPOLL::CTL_ADD) {
            let err = if known { E::EEXIST } else { E::ENOENT };
            return Err(sys::Error::from_code(err, sys::Tag::epoll_ctl));
        }
        ENTRIES.lock().insert(fd.native(), key);
        Ok(())
    }

    thread_local! {
        static SCHEDULED: RefCell<Vec<Box<dyn FnOnce()>>> = RefCell::default();
        static CANCELS_IN_CTL: Cell<Option<Canceller>> = Cell::default();
        static CANCELLED_IN_CTL: Cell<Option<Canceller>> = Cell::default();
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
        fire(key, Ok(()));
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
        let ended = park(wait, 2);
        fire(key, Ok(()));
        canceller.cancel();
        ready(key);
        assert_eq!(all(ended), [E::ECANCELED]);
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
    fn a_job_is_cancelled_while_the_kernel_adds_its_entry() {
        let (wait, canceller) = new(1008);
        let changes = &mut Changes(IO.lock().poller().ok().unwrap());
        CANCELS_IN_CTL.set(Some(canceller));
        let (sender, ended) = mpsc::channel();
        let resume = move |woken: sys::Result<FdWait>| sender.send(woken.err()).unwrap();
        wait.arm(changes, Box::new(resume));
        assert!(entry(1008).is_none());
        WorkPool::run();
        assert_eq!(ended.recv().unwrap().unwrap().get_errno(), E::ECANCELED);
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
        fire(key, Err(sys::Error::from_code(E::EPIPE, sys::Tag::write)));
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
        let changes = &mut Changes(IO.lock().poller().ok().unwrap());
        let first = idle.recv().unwrap().unwrap();
        first.arm(changes, Box::new(|woken| assert!(woken.is_err())));
        second.arm(changes, Box::new(|woken| assert!(woken.is_ok())));
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

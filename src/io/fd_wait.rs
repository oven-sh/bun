//! One thread waits on its own epoll or kqueue for the pipes, sockets and ttys of all work pool jobs.

use core::ops::DerefMut;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::collections::{BTreeMap, btree_map};

use bun_core::heap;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_sys::linux::EPOLL;
use bun_sys::{self as sys, E, Fd, FdExt as _};
#[cfg(not(all(test, target_os = "linux")))]
use bun_threading::WorkPool;
use bun_threading::{Guarded, Link, Linked, UnboundedQueue};
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

/// Keeps the pool off the table, which the IO thread writes at each wait.
static TOMBSTONES: AtomicUsize = AtomicUsize::new(0);

impl Tombstone {
    fn place(key: Key) -> Self {
        TOMBSTONES.fetch_add(1, Ordering::SeqCst);
        let previous = key.slots().insert(key, Slot::Cancelled);
        if let Some(Slot::Armed(armed)) = previous {
            armed.poller.request(Request::Disarm(key, armed));
        }
        Self(key)
    }
}

impl Drop for Tombstone {
    fn drop(&mut self) {
        self.0.slots().remove(&self.0);
        TOMBSTONES.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The descriptor of a job that is not in the table.
pub struct FdWait {
    key: Key,
    interest: Interest,
    /// From an earlier wait. Dropped before `fd`.
    entry: Option<Entry>,
    fd: JobFd,
}

impl FdWait {
    #[inline]
    pub fn new(key: Key, interest: Interest, fd: JobFd) -> Self {
        Self {
            key,
            interest,
            entry: None,
            fd,
        }
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd.get()
    }

    /// The job is here, so only a tombstone can have its slot.
    fn check_cancelled(&self) -> sys::Result<()> {
        match TOMBSTONES.load(Ordering::SeqCst) != 0 && self.key.slots().contains_key(&self.key) {
            true => Err(self.interest.cancelled()),
            false => Ok(()),
        }
    }

    /// Pool thread. `resume` is called once, on the pool. The descriptor is closed before an `Err`.
    pub fn park(self, resume: impl FnOnce(sys::Result<Self>) + Send + 'static) {
        match Poller::running().and_then(|poller| self.check_cancelled().map(|()| poller)) {
            Ok(poller) => poller.request(Request::Arm(self, Box::new(resume))),
            // On this thread: the pool may have no other.
            Err(err) => {
                drop(self);
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

/// What the table has of a job that waits.
struct Armed {
    poller: &'static Poller,
    interest: Interest,
    fd: JobFd,
    resume: Resume,
}

/// A job without a slot is on the pool, in the queue, or has ended.
enum Slot {
    Armed(Armed),
    Cancelled,
}

type Slots = BTreeMap<Key, Slot>;

enum Request {
    Arm(FdWait, Resume),
    /// `cancel` took it out of the table.
    Disarm(Key, Armed),
}

/// Arming from the pool costs a busy pipe a third of its speed: the job then wakes too late.
struct Queue<T: Send>(UnboundedQueue<Queued<T>>);

struct Queued<T> {
    next: Link<Self>,
    item: T,
}

// SAFETY: always the same field.
unsafe impl<T> Linked for Queued<T> {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const Link<Self> {
        // SAFETY: fn contract.
        unsafe { &raw const (*item).next }
    }
}

impl<T: Send> Queue<T> {
    fn push(&self, item: T) {
        let next = Link::new();
        self.0.push(heap::alloc_nn(Queued { next, item }));
    }

    /// IO thread.
    fn take(&self) -> impl Iterator<Item = T> {
        let mut batch = self.0.pop_batch().iterator();
        core::iter::from_fn(move || {
            let queued = NonNull::new(batch.next())?;
            // SAFETY: `push` allocated it, and a batch yields it once.
            Some(unsafe { heap::take(queued.as_ptr()) }.item)
        })
    }
}

/// Never closed.
struct Poller {
    /// The epoll or kqueue.
    watcher: Fd,
    waker: Waker,
    queue: Queue<Request>,
}

impl IoThread {
    fn run_queue(&mut self) {
        for request in self.poller.queue.take() {
            match request {
                Request::Arm(wait, resume) => self.arm(wait, resume),
                Request::Disarm(key, armed) => {
                    let (wait, resume) = self.unpark(key, armed);
                    self.end_cancelled(wait, resume);
                }
            }
        }
    }

    fn arm(&mut self, wait: FdWait, resume: Resume) {
        let (key, interest, number) = (wait.key, wait.interest, wait.fd());
        let mut slots = key.slots();
        let btree_map::Entry::Vacant(slot) = slots.entry(key) else {
            drop(slots);
            return self.end_cancelled(wait, resume);
        };
        slot.insert(Slot::Armed(Armed {
            poller: self.poller,
            interest,
            fd: wait.fd,
            resume,
        }));
        // The kernel may take its time. Only this thread gives the descriptor to the pool to close.
        drop(slots);
        if let Err(err) = self.add(wait.entry, number, interest, key) {
            self.fire(key, Err(err));
        }
    }

    /// The kernel reported `key`.
    fn fire(&mut self, key: Key, outcome: sys::Result<()>) {
        let mut slots = key.slots();
        match slots.remove(&key) {
            Some(Slot::Armed(armed)) => {
                drop(slots);
                let (wait, resume) = self.unpark(key, armed);
                wait.wake(outcome, resume);
            }
            Some(Slot::Cancelled) => drop(slots.insert(key, Slot::Cancelled)),
            None => {}
        }
    }

    fn unpark(&mut self, key: Key, armed: Armed) -> (FdWait, Resume) {
        let wait = FdWait {
            key,
            interest: armed.interest,
            entry: self.take_entry(key),
            fd: armed.fd,
        };
        (wait, armed.resume)
    }

    /// Does not leave the entry to the pool: the next job on the descriptor may be faster.
    fn end_cancelled(&mut self, mut wait: FdWait, resume: Resume) {
        if let Some(entry) = wait.entry.take() {
            self.remove(entry, wait.fd(), wait.interest);
        }
        let cancelled = wait.interest.cancelled();
        wait.wake(Err(cancelled), resume);
    }
}

static RUNNING: bun_core::Once<&'static Poller> = bun_core::Once::new();

impl Poller {
    fn running() -> sys::Result<&'static Self> {
        RUNNING.get().copied().map_or_else(Self::start, Ok)
    }

    /// If it fails, the next call retries.
    #[cold]
    fn start() -> sys::Result<&'static Self> {
        static MADE: Guarded<Option<&'static Poller>> = Guarded::new(None);
        let mut made = MADE.lock();
        if let Some(running) = RUNNING.get() {
            return Ok(running);
        }
        let poller = match *made {
            Some(poller) => poller,
            None => made.insert(Self::new()?),
        };
        poller.spawn()?;
        Ok(RUNNING.get_or_init(|| poller))
    }

    fn new() -> sys::Result<&'static Self> {
        let waker = Waker::init().map_err(|err| {
            let errno = match err {
                crate::Error::Sys(errno) => errno,
                _ => E::ENOMEM,
            };
            sys::Error::from_code(errno, sys::Tag::open)
        })?;
        let watcher = Self::watch(&waker)?;
        Ok(Box::leak(Box::new(Self {
            watcher,
            waker,
            queue: Queue(UnboundedQueue::default()),
        })))
    }

    fn request(&self, request: Request) {
        self.queue.push(request);
        self.wake();
    }

    #[cfg(not(all(test, target_os = "linux")))]
    fn wake(&self) {
        self.waker.wake();
    }

    #[cfg(not(all(test, target_os = "linux")))]
    fn spawn(&'static self) -> sys::Result<()> {
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

#[cfg(any(target_os = "linux", target_os = "android"))]
struct IoThread {
    poller: &'static Poller,
    /// Of the armed jobs, and of those that wait to be disarmed.
    entries: BTreeMap<Key, Entry>,
}

/// epoll keeps a one-shot entry that has fired. A second job on the descriptor gets EEXIST, and so
/// has none to remove.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Entry(&'static Poller, Fd);

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Drop for Entry {
    fn drop(&mut self) {
        self.0.remove(self.1);
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl IoThread {
    fn new(poller: &'static Poller) -> Self {
        let entries = BTreeMap::new();
        Self { poller, entries }
    }

    /// A failure removes `entry`.
    fn add(
        &mut self,
        entry: Option<Entry>,
        fd: Fd,
        interest: Interest,
        key: Key,
    ) -> sys::Result<()> {
        log!("register({})", fd);
        let events = match interest {
            Interest::Readable => EPOLL::IN,
            Interest::Writable => EPOLL::OUT,
        } | EPOLL::ONESHOT;
        let op = match entry {
            None => EPOLL::CTL_ADD,
            Some(_) => EPOLL::CTL_MOD,
        };
        epoll_ctl(self.poller.watcher, op, fd, events, key)?;
        let entry = entry.unwrap_or_else(|| Entry(self.poller, fd));
        self.entries.insert(key, entry);
        Ok(())
    }

    fn take_entry(&mut self, key: Key) -> Option<Entry> {
        self.entries.remove(&key)
    }

    fn remove(&mut self, entry: Entry, _: Fd, _: Interest) {
        drop(entry);
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
    let mut event = libc::epoll_event { events, u64: key.0 };
    // SAFETY: `wait` does not take the data for an address.
    let rc = unsafe { libc::epoll_ctl(epoll.native(), op, fd.native(), &raw mut event) };
    match sys::get_errno(rc) {
        E::SUCCESS => Ok(()),
        err => Err(sys::Error::from_code(err, sys::Tag::epoll_ctl)),
    }
}

#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
impl Poller {
    fn remove(&self, fd: Fd) {
        let (epoll, no_event) = (self.watcher.native(), core::ptr::null_mut());
        // SAFETY: CTL_DEL does not read the event.
        unsafe { libc::epoll_ctl(epoll, libc::EPOLL_CTL_DEL, fd.native(), no_event) };
    }

    fn wait(&'static self) {
        let mut events: [libc::epoll_event; 256] = [bun_core::ffi::zeroed(); 256];
        let mut thread = IoThread::new(self);
        loop {
            thread.run_queue();
            // SAFETY: `events` is writable for its length.
            let rc = unsafe {
                libc::epoll_wait(
                    self.watcher.native(),
                    events.as_mut_ptr(),
                    events.len() as _,
                    i32::MAX,
                )
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
                thread.fire(Key(event.u64), outcome);
            }
        }
    }
}

// ─── kqueue ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "freebsd")]
type KEvent = libc::kevent;
#[cfg(target_os = "macos")]
type KEvent = libc::kevent64_s;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct IoThread {
    poller: &'static Poller,
    /// Applied by the next wait, which reports a failure as an event.
    changes: Vec<KEvent>,
}

/// kqueue deletes a one-shot entry when it reports it.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Entry;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl IoThread {
    fn add(&mut self, _: Option<Entry>, fd: Fd, interest: Interest, key: Key) -> sys::Result<()> {
        log!("register({})", fd);
        let flags = libc::EV_ADD | libc::EV_ONESHOT;
        self.changes.push(change(fd, interest, flags, key));
        Ok(())
    }

    fn take_entry(&mut self, _: Key) -> Option<Entry> {
        Some(Entry)
    }

    /// By descriptor: after a report, this can be the entry of another job.
    fn remove(&mut self, _: Entry, fd: Fd, interest: Interest) {
        (self.changes).push(change(fd, interest, libc::EV_DELETE, Key::NO_JOB));
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

    fn wait(&'static self) {
        let mut events = Vec::new();
        loop {
            let (poller, changes) = (self, Vec::new());
            let mut thread = IoThread { poller, changes };
            thread.run_queue();
            // Room for a failure of each change.
            events.resize(thread.changes.len().max(256), bun_core::ffi::zeroed());
            events.shrink_to_fit();
            let count = kevent(self.watcher, &thread.changes, &mut events).unwrap_or_else(|err| {
                let name = <&'static str>::from(err.get_errno());
                bun_core::Output::panic(format_args!("kevent failed: {name}"))
            });
            for event in &events[..count] {
                let outcome = match event.flags & libc::EV_ERROR {
                    0 => Ok(()),
                    _ => Err(sys::Error::from_code_int(event.data as _, sys::Tag::kevent)),
                };
                thread.fire(Key(event.udata as u64), outcome);
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use std::sync::mpsc;

    use super::*;

    /// The entries of the fake epoll, by descriptor.
    static ENTRIES: Guarded<BTreeMap<i32, Key>> = Guarded::new(BTreeMap::new());

    static IO_THREAD: Guarded<Option<IoThread>> = Guarded::new(None);

    fn on_io_thread(run: impl FnOnce(&mut IoThread)) {
        let poller = Poller::running().ok().unwrap();
        run(IO_THREAD
            .lock()
            .get_or_insert_with(|| IoThread::new(poller)));
    }

    /// Does what the IO thread would.
    fn tick() {
        on_io_thread(|thread| thread.run_queue());
        WorkPool::run();
    }

    /// Requests stay in the queue.
    fn while_busy<T>(run: impl FnOnce() -> T) -> T {
        IS_BUSY.set(true);
        let result = run();
        IS_BUSY.set(false);
        result
    }

    impl Poller {
        pub(super) fn spawn(&self) -> sys::Result<()> {
            Ok(())
        }

        pub(super) fn wake(&self) {
            self.waker.wake();
            if !IS_BUSY.get() {
                tick();
            }
        }

        pub(super) fn remove(&self, fd: Fd) {
            ENTRIES.lock().remove(&fd.native());
        }
    }

    pub(super) fn epoll_ctl(_: Fd, op: i32, fd: Fd, _: u32, key: Key) -> sys::Result<()> {
        if let Some(meanwhile) = DURING_CTL.take() {
            while_busy(meanwhile);
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
        static DURING_CTL: Cell<Option<Box<dyn FnOnce()>>> = Cell::default();
        static IS_BUSY: Cell<bool> = Cell::default();
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

    fn fire(key: Key, outcome: sys::Result<()>) {
        on_io_thread(|thread| thread.fire(key, outcome));
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

    /// Parks a job on `fd` and cancels it between `before` and `after`, while the kernel adds its entry.
    fn cancel_in_ctl(fd: i32, before: impl FnOnce() + 'static, after: impl FnOnce() + 'static) {
        let (wait, canceller) = new(fd);
        let canceller = Rc::new(RefCell::new(canceller));
        let shared = Rc::clone(&canceller);
        let (sender, ended) = mpsc::channel();
        let resume = move |woken: sys::Result<FdWait>| {
            sender.send(woken.err().unwrap().get_errno()).unwrap();
        };
        on_io_thread(|thread| {
            DURING_CTL.set(Some(Box::new(move || {
                before();
                shared.borrow_mut().cancel();
                after();
            })));
            thread.arm(wait, Box::new(resume));
        });
        tick();
        assert_eq!(all(ended), [E::ECANCELED]);
    }

    #[test]
    fn a_cancel_keeps_its_place_in_the_queue_while_the_kernel_adds_the_entry() {
        let (sender, ended) = mpsc::channel();
        let (earlier, _earlier) = new(1008);
        cancel_in_ctl(1008, move || job(earlier, Box::new(1), sender), || {});
        assert_eq!(all(ended), [E::EEXIST]);
        assert!(entry(1008).is_none());

        let (sender, ended) = mpsc::channel();
        let (later, _later) = new(1008);
        let key = later.key;
        cancel_in_ctl(1008, || {}, move || job(later, Box::new(1), sender));
        assert!(entry(1008) == Some(key));
        ready(key);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_job_that_is_cancelled_while_the_kernel_refuses_it_leaves_the_entry_of_the_first() {
        let (first, _first) = new(1009);
        let key = first.key;
        let ended = park(first, 1);
        cancel_in_ctl(1009, || {}, || {});
        assert!(entry(1009) == Some(key));
        ready(key);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_queued_job_that_is_cancelled_makes_room_for_the_next() {
        let ((first, mut canceller), (second, _second)) = (new(1004), new(1004));
        let keys = (first.key, second.key);
        let first = park(first, 2);
        let second = while_busy(|| {
            ready(keys.0);
            canceller.cancel();
            park(second, 1)
        });
        tick();
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
        let first = idle.recv().unwrap().unwrap();
        on_io_thread(|thread| {
            thread.arm(first, Box::new(|woken| assert!(woken.is_err())));
            thread.arm(second, Box::new(|woken| assert!(woken.is_ok())));
        });
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

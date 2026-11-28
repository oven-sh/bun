//! One thread waits on its own epoll or kqueue for the pipes, sockets and ttys of all work pool jobs.

use core::cell::UnsafeCell;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering::SeqCst};

use bun_collections::hashbrown::{HashMap, hash_map};
use bun_ptr::IntrusivePtr;
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_sys::linux::EPOLL;
use bun_sys::{self as sys, E, Fd, FdExt as _};
use bun_threading::{Guarded, Link, UnboundedQueue};
use rustc_hash::FxBuildHasher;
#[cfg(all(test, target_os = "linux"))]
use tests::{epoll_ctl, epoll_del};

use crate::Waker;

bun_core::define_scoped_log!(log, FdWait, hidden);

#[derive(Clone, Copy, Debug)]
pub enum Interest {
    Readable,
    Writable,
}

impl Interest {
    #[cold]
    fn cancelled(self) -> sys::Error {
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
    Opened(Opened),
}

/// Script can close any descriptor by its number.
pub struct Opened(Fd);

impl JobFd {
    #[inline]
    pub fn opened(file: sys::File) -> Self {
        Self::Opened(Opened(file.into_raw()))
    }

    #[inline]
    pub fn get(&self) -> Fd {
        let (Self::Borrowed(fd) | Self::Opened(Opened(fd))) = *self;
        fd
    }
}

impl Drop for Opened {
    #[inline]
    fn drop(&mut self) {
        let _ = self.0.close_allowing_bad_file_descriptor(None);
    }
}

/// The descriptor of a job, and what the kernel has of it.
pub struct FdWait {
    interest: Interest,
    /// From an earlier wait. Dropped before `fd`.
    entry: Option<Entry>,
    fd: JobFd,
}

impl FdWait {
    #[inline]
    pub fn new(interest: Interest, fd: JobFd) -> Self {
        let entry = None;
        Self {
            interest,
            entry,
            fd,
        }
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd.get()
    }
}

/// A job that has left the pool.
///
/// # Safety
/// `parking` always gives the same one, which no other live `Waiter` gives, and which stays where
/// it is for as long as this value lives. `wait` does not borrow it.
pub unsafe trait Waiter: Send + Sized + 'static {
    fn parking(&self) -> &Parking<Self>;
    fn wait(&mut self) -> &mut FdWait;
    /// IO thread. Gives the job back to the pool.
    fn wake(self, outcome: sys::Result<()>);
}

/// What a job shares with the thread that can cancel it. What `cancel` writes comes first, next to
/// what the canceller has just read of the job.
#[repr(C)]
pub struct Parking<J: Waiter> {
    armed: Armed<J>,
    next: Link<Self>,
    /// Written by the owner of the job, then by the IO thread when it has left the queue.
    request: UnsafeCell<Request<J>>,
}

enum Request<J> {
    /// Arming from the pool costs a busy pipe a third of its speed: the job then wakes too late.
    Arm(J),
    Disarm(Key),
}

// SAFETY: `request` has one user at a time. The queue, `armed` and handing the job on order them.
unsafe impl<J: Waiter> Sync for Parking<J> {}

bun_core::intrusive_field!([J: Waiter] Parking<J>, next: Link<Self>);

/// From the owner of the job, or from whoever got the poller out of `armed`.
struct Sent<J: Waiter>(*const Parking<J>);

// SAFETY: as `&Parking<J>`.
unsafe impl<J: Waiter> Send for Sent<J> {}

// SAFETY: there is one at a time, and meanwhile the job is in the request or in the table.
unsafe impl<J: Waiter> IntrusivePtr for Sent<J> {
    type Target = Parking<J>;

    fn into_raw(self) -> *mut Parking<J> {
        self.0.cast_mut()
    }

    unsafe fn from_raw(ptr: *mut Parking<J>) -> Self {
        Self(ptr)
    }
}

impl<J: Waiter> Default for Parking<J> {
    #[inline]
    fn default() -> Self {
        Self {
            armed: Armed(AtomicPtr::new(Armed::EMPTY)),
            next: Link::new(),
            request: UnsafeCell::new(Request::Disarm(Key::NO_JOB)),
        }
    }
}

impl<J: Waiter> Parking<J> {
    /// Ends the wait and every later one.
    #[inline]
    pub fn cancel(&self) {
        if let Some(poller) = self.armed.close() {
            poller.send(NonNull::from(self));
        }
    }

    #[inline]
    pub fn check_cancelled(&self, wait: &FdWait) -> sys::Result<()> {
        match self.armed.is_closed() {
            true => Err(wait.interest.cancelled()),
            false => Ok(()),
        }
    }
}

/// Has the poller while the job is in its table. The event and the cancel both want to end the
/// wait: the one that gets the poller out does. Closed is final.
struct Armed<J: Waiter>(AtomicPtr<Poller<J>>);

impl<J: Waiter> Armed<J> {
    const EMPTY: *mut Poller<J> = ptr::null_mut();
    const CLOSED: *mut Poller<J> = ptr::without_provenance_mut(1);

    #[must_use]
    fn put(&self, poller: &'static Poller<J>) -> bool {
        self.exchange(Self::EMPTY, ptr::from_ref(poller).cast_mut())
    }

    #[must_use]
    fn take(&self, poller: &'static Poller<J>) -> bool {
        self.exchange(ptr::from_ref(poller).cast_mut(), Self::EMPTY)
    }

    fn exchange(&self, old: *mut Poller<J>, new: *mut Poller<J>) -> bool {
        self.0.compare_exchange(old, new, SeqCst, SeqCst).is_ok()
    }

    fn close(&self) -> Option<&'static Poller<J>> {
        let old = Some(self.0.swap(Self::CLOSED, SeqCst)).filter(|&old| old != Self::CLOSED)?;
        // SAFETY: null, or from `put`.
        unsafe { old.as_ref() }
    }

    fn is_closed(&self) -> bool {
        self.0.load(SeqCst) == Self::CLOSED
    }
}

/// What the kernel has in place of an address, one for each wait. An epoll entry outlives its job if
/// script closes the descriptor while a duplicate is open: it can no longer be removed.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Key(u64);

impl Key {
    const NO_JOB: Self = Self(0);
}

/// Never closed.
pub struct Poller<J: Waiter> {
    /// The epoll or kqueue.
    watcher: Fd,
    waker: Waker,
    queue: UnboundedQueue<Sent<J>>,
}

impl<J: Waiter> Poller<J> {
    /// Pool thread. [`Waiter::wake`] follows, once.
    pub fn park(&self, job: J) {
        let parking = NonNull::from(job.parking());
        // SAFETY: a job is not given out while its `Parking` is armed or in the queue.
        unsafe { *parking.as_ref().request.get() = Request::Arm(job) };
        self.send(parking);
    }

    fn send(&self, parking: NonNull<Parking<J>>) {
        self.queue.push(Sent(parking.as_ptr()));
        self.wake();
    }

    fn new() -> sys::Result<&'static Self> {
        let waker = Waker::init().map_err(|err| {
            let errno = match err {
                crate::Error::Sys(errno) => errno,
                _ => E::ENOMEM,
            };
            sys::Error::from_code(errno, sys::Tag::open)
        })?;
        let watcher = watch_waker(&waker)?;
        Ok(Box::leak(Box::new(Self {
            watcher,
            waker,
            queue: UnboundedQueue::default(),
        })))
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
                IoThread::new(self).wait()
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

/// Starts the thread for the first job that waits.
pub struct LazyPoller<J: Waiter> {
    running: bun_core::Once<&'static Poller<J>>,
    made: Guarded<Option<&'static Poller<J>>>,
}

impl<J: Waiter> LazyPoller<J> {
    pub const fn new() -> Self {
        Self {
            running: bun_core::Once::new(),
            made: Guarded::new(None),
        }
    }

    /// Pool thread. Refuses a job that is cancelled.
    pub fn admit(&self, parking: &Parking<J>, wait: &FdWait) -> sys::Result<&'static Poller<J>> {
        let poller = (self.running.get().copied()).map_or_else(|| self.start(), Ok)?;
        parking.check_cancelled(wait).map(|()| poller)
    }

    /// If it fails, the next call retries.
    #[cold]
    fn start(&self) -> sys::Result<&'static Poller<J>> {
        let mut made = self.made.lock();
        if let Some(running) = self.running.get() {
            return Ok(running);
        }
        let poller = match *made {
            Some(poller) => poller,
            None => made.insert(Poller::new()?),
        };
        poller.spawn()?;
        Ok(self.running.get_or_init(|| poller))
    }
}

struct IoThread<J: Waiter> {
    poller: &'static Poller<J>,
    kernel: Kernel,
    last: Key,
    armed: HashMap<Key, J, FxBuildHasher>,
}

impl<J: Waiter> IoThread<J> {
    /// What 512 buckets hold.
    const KEPT: usize = 512 / 8 * 7;

    fn new(poller: &'static Poller<J>) -> Self {
        Self {
            poller,
            kernel: Kernel::new(poller.watcher),
            last: Key::NO_JOB,
            armed: HashMap::default(),
        }
    }

    fn run_queue(&mut self) {
        for Sent(parking) in self.poller.queue.pop_batch() {
            self.last.0 += 1;
            let key = self.last;
            // SAFETY: its job is in the request or in the table, so it is live and this thread's.
            match unsafe { (*parking).request.get().replace(Request::Disarm(key)) } {
                Request::Arm(mut job) => {
                    log!("arm({}, {:?})", job.wait().fd(), job.wait().interest);
                    if !job.parking().armed.put(self.poller) {
                        debug_assert!(job.parking().armed.is_closed());
                        self.end_cancelled(job);
                        continue;
                    }
                    let added = self.kernel.add(job.wait(), key);
                    self.armed.insert(key, job);
                    if let Err(err) = added {
                        self.fire(key, |_| Err(err));
                    }
                }
                Request::Disarm(armed) => {
                    debug_assert!(self.armed.contains_key(&armed));
                    if let Some(job) = self.armed.remove(&armed) {
                        self.end_cancelled(job);
                    }
                }
            }
        }
        // With room to spare, so that going back and forth over a limit rebuilds it once.
        (self.armed).shrink_to((self.armed.len() * 4).max(Self::KEPT));
    }

    /// The kernel reported `key`. If `cancel` was faster, its request ends the wait.
    fn fire(&mut self, key: Key, outcome: impl FnOnce(&FdWait) -> sys::Result<()>) {
        if let hash_map::Entry::Occupied(found) = self.armed.entry(key)
            && found.get().parking().armed.take(self.poller)
        {
            let mut job = found.remove();
            let outcome = outcome(job.wait());
            Self::wake(job, outcome);
        }
    }

    /// Does not leave the entry to the pool: the next job on the descriptor may be faster.
    fn end_cancelled(&mut self, mut job: J) {
        self.kernel.remove(job.wait());
        let cancelled = job.wait().interest.cancelled();
        Self::wake(job, Err(cancelled));
    }

    fn wake(mut job: J, outcome: sys::Result<()>) {
        log!(
            "wake({}) = {:?}",
            job.wait().fd(),
            outcome.as_ref().map_err(sys::Error::get_errno)
        );
        job.wake(outcome);
    }
}

// ─── epoll ───────────────────────────────────────────────────────────────────

#[cfg(any(target_os = "linux", target_os = "android"))]
struct Kernel {
    epoll: Fd,
}

/// epoll keeps a one-shot entry that has fired. A second job on the descriptor gets EEXIST, and so
/// has none to remove.
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Entry {
    epoll: Fd,
    fd: Fd,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Drop for Entry {
    fn drop(&mut self) {
        epoll_del(self.epoll, self.fd);
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Kernel {
    fn new(epoll: Fd) -> Self {
        Self { epoll }
    }

    fn add(&mut self, wait: &mut FdWait, key: Key) -> sys::Result<()> {
        let (epoll, fd) = (self.epoll, wait.fd());
        let events = match wait.interest {
            Interest::Readable => EPOLL::IN,
            Interest::Writable => EPOLL::OUT,
        } | EPOLL::ONESHOT;
        // A failure removes it.
        let entry = wait.entry.take();
        let op = match entry {
            None => EPOLL::CTL_ADD,
            Some(_) => EPOLL::CTL_MOD,
        };
        epoll_ctl(epoll, op, fd, events, key)?;
        wait.entry = Some(entry.unwrap_or_else(|| Entry { epoll, fd }));
        Ok(())
    }

    fn remove(&mut self, wait: &mut FdWait) {
        wait.entry = None;
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn watch_waker(waker: &Waker) -> sys::Result<Fd> {
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
fn epoll_del(epoll: Fd, fd: Fd) {
    let no_event = ptr::null_mut();
    // SAFETY: CTL_DEL does not read the event.
    unsafe { libc::epoll_ctl(epoll.native(), libc::EPOLL_CTL_DEL, fd.native(), no_event) };
}

#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
impl<J: Waiter> IoThread<J> {
    fn wait(mut self) {
        let mut events: [libc::epoll_event; 256] = [bun_core::ffi::zeroed(); 256];
        loop {
            self.run_queue();
            // SAFETY: `events` is writable for its length.
            let rc = unsafe {
                libc::epoll_wait(
                    self.kernel.epoll.native(),
                    events.as_mut_ptr(),
                    events.len() as _,
                    i32::MAX,
                )
            };
            match sys::get_errno(rc) {
                E::EINTR => continue,
                E::SUCCESS => log!("epoll_wait({}) = {}", self.kernel.epoll, rc),
                e => bun_core::Output::panic(format_args!("epoll_wait: {:?}", e)),
            }
            for event in &events[..rc as usize] {
                self.fire(Key(event.u64), |wait| match event.events & EPOLL::ERR {
                    0 => Ok(()),
                    _ => Err(pending_error(wait)),
                });
            }
        }
    }
}

/// EPOLLERR carries no errno, and reading SO_ERROR would clear it on the caller's socket.
#[cfg(any(all(not(test), target_os = "linux"), target_os = "android"))]
#[cold]
fn pending_error(wait: &FdWait) -> sys::Error {
    if matches!(wait.interest, Interest::Writable)
        && sys::fstat(wait.fd()).is_ok_and(|stat| sys::S::ISFIFO(stat.st_mode as _))
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

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Kernel {
    kqueue: Fd,
    /// Applied by the next wait, which reports a failure as an event.
    changes: Vec<KEvent>,
}

/// kqueue deletes a one-shot entry when it reports it.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
struct Entry;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Kernel {
    fn new(kqueue: Fd) -> Self {
        let changes = Vec::new();
        Self { kqueue, changes }
    }

    fn add(&mut self, wait: &mut FdWait, key: Key) -> sys::Result<()> {
        let flags = libc::EV_ADD | libc::EV_ONESHOT;
        (self.changes).push(change(wait.fd(), wait.interest, flags, key));
        wait.entry = Some(Entry);
        Ok(())
    }

    /// By descriptor: after a report, this can be the entry of another job.
    fn remove(&mut self, wait: &mut FdWait) {
        if let Some(Entry) = wait.entry.take() {
            let (fd, flags) = (wait.fd(), libc::EV_DELETE);
            (self.changes).push(change(fd, wait.interest, flags, Key::NO_JOB));
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
            ptr::null(),
        )
    };
    match sys::get_errno(rc) {
        E::SUCCESS => Ok(rc as usize),
        err => Err(sys::Error::from_code(err, sys::Tag::kevent)),
    }
}

/// The waker has a kqueue of its own, and no `udata` in it.
#[cfg(target_os = "macos")]
fn watch_waker(waker: &Waker) -> sys::Result<Fd> {
    Ok(waker.get_fd())
}

#[cfg(target_os = "freebsd")]
fn watch_waker(waker: &Waker) -> sys::Result<Fd> {
    let kqueue = sys::File::from_fd(sys::kqueue()?);
    // Edge-triggered: no need to read its counter.
    let flags = libc::EV_ADD | libc::EV_CLEAR;
    let add = change(waker.get_fd(), Interest::Readable, flags, Key::NO_JOB);
    kevent(kqueue.fd(), &[add], &mut [])?;
    Ok(kqueue.into_raw())
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl<J: Waiter> IoThread<J> {
    fn wait(mut self) {
        let mut events = Vec::new();
        loop {
            self.run_queue();
            let Kernel { kqueue, changes } = &mut self.kernel;
            // Room for a failure of each change.
            events.resize(changes.capacity().max(256), bun_core::ffi::zeroed());
            events.shrink_to_fit();
            let count = match kevent(*kqueue, changes, &mut events).map_err(|it| it.get_errno()) {
                Ok(count) => count,
                // In the wait, after the changes.
                Err(E::EINTR) => 0,
                Err(e) => {
                    bun_core::Output::panic(format_args!("kevent failed: {}", <&str>::from(e)))
                }
            };
            changes.clear();
            changes.shrink_to(256);
            for event in &events[..count] {
                let outcome = match event.flags & libc::EV_ERROR {
                    0 => Ok(()),
                    _ => Err(sys::Error::from_code_int(event.data as _, sys::Tag::kevent)),
                };
                self.fire(Key(event.udata as u64), |_| outcome);
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;
    use std::sync::{Arc, mpsc};

    use super::*;

    /// The entries of the fake epoll, by descriptor.
    static ENTRIES: Guarded<BTreeMap<i32, Key>> = Guarded::new(BTreeMap::new());
    static POLLER: LazyPoller<Job> = LazyPoller::new();
    static IO_THREAD: Guarded<Option<IoThread<Job>>> = Guarded::new(None);
    /// The tests share a queue.
    static ALONE: Guarded<()> = Guarded::new(());

    thread_local! {
        static POOL: RefCell<Vec<(Job, sys::Result<()>)>> = RefCell::default();
        static DURING_CTL: Cell<Option<Box<dyn FnOnce()>>> = Cell::default();
        static IS_BUSY: Cell<bool> = Cell::default();
    }

    impl<J: Waiter> Poller<J> {
        pub(super) fn spawn(&self) -> sys::Result<()> {
            Ok(())
        }

        pub(super) fn wake(&self) {
            self.waker.wake();
            if !IS_BUSY.get() {
                tick();
            }
        }
    }

    pub(super) fn epoll_del(_: Fd, fd: Fd) {
        ENTRIES.lock().remove(&fd.native());
    }

    pub(super) fn epoll_ctl(_: Fd, op: i32, fd: Fd, _: u32, key: Key) -> sys::Result<()> {
        if let Some(meanwhile) = DURING_CTL.take() {
            meanwhile();
        }
        let known = ENTRIES.lock().contains_key(&fd.native());
        if known == (op == EPOLL::CTL_ADD) {
            let err = if known { E::EEXIST } else { E::ENOENT };
            return Err(sys::Error::from_code(err, sys::Tag::epoll_ctl));
        }
        ENTRIES.lock().insert(fd.native(), key);
        Ok(())
    }

    fn on_io_thread(run: impl FnOnce(&mut IoThread<Job>)) {
        let poller = POLLER.start().ok().unwrap();
        let mut thread = IO_THREAD.lock();
        while_busy(|| run(thread.get_or_insert_with(|| IoThread::new(poller))));
    }

    fn tick() {
        on_io_thread(IoThread::run_queue);
        run_pool();
    }

    /// Requests stay in the queue.
    fn while_busy<T>(run: impl FnOnce() -> T) -> T {
        let was_busy = IS_BUSY.replace(true);
        let result = run();
        IS_BUSY.set(was_busy);
        result
    }

    /// What this thread has woken.
    fn run_pool() {
        for (mut job, outcome) in POOL.take() {
            job.waits -= 1;
            match outcome {
                Ok(()) if job.waits > 0 => job.park(),
                Ok(()) => job.end(E::SUCCESS),
                Err(err) => job.end(err.get_errno()),
            }
        }
    }

    fn entry(fd: i32) -> Option<Key> {
        ENTRIES.lock().get(&fd).copied()
    }

    fn fire(key: Key, outcome: sys::Result<()>) {
        on_io_thread(|thread| thread.fire(key, |_| outcome));
    }

    fn ready(fd: i32) {
        if let Some(key) = entry(fd) {
            fire(key, Ok(()));
        }
        run_pool();
    }

    struct Job {
        parking: Arc<Parking<Job>>,
        wait: FdWait,
        waits: u32,
        ended: mpsc::Sender<E>,
    }

    // SAFETY: the other `Arc` only cancels, and `wait` is outside of it.
    unsafe impl Waiter for Job {
        fn parking(&self) -> &Parking<Self> {
            &self.parking
        }

        fn wait(&mut self) -> &mut FdWait {
            &mut self.wait
        }

        fn wake(self, outcome: sys::Result<()>) {
            POOL.with_borrow_mut(|pool| pool.push((self, outcome)));
        }
    }

    impl Job {
        fn park(self) {
            match POLLER.admit(&self.parking, &self.wait) {
                Ok(poller) => poller.park(self),
                Err(err) => self.end(err.get_errno()),
            }
        }

        fn end(self, errno: E) {
            drop(self.wait);
            self.ended.send(errno).unwrap();
        }
    }

    /// The job waits `waits` times, then reports how it ended. The channel closes when it is freed.
    fn job(fd: i32, waits: u32) -> (impl FnOnce(), Arc<Parking<Job>>, mpsc::Receiver<E>) {
        let (parking, (ended, receiver)) = (Arc::<Parking<Job>>::default(), mpsc::channel());
        let job = Job {
            parking: Arc::clone(&parking),
            wait: FdWait::new(Interest::Readable, JobFd::Borrowed(Fd::from_native(fd))),
            waits,
            ended,
        };
        (move || job.park(), parking, receiver)
    }

    fn park(fd: i32, waits: u32) -> (Arc<Parking<Job>>, mpsc::Receiver<E>) {
        let (park, parking, ended) = job(fd, waits);
        park();
        (parking, ended)
    }

    fn all(ended: mpsc::Receiver<E>) -> Vec<E> {
        ended.iter().collect()
    }

    #[test]
    fn each_event_ends_one_wait() {
        let _alone = ALONE.lock();
        let (_, ended) = park(1000, 2);
        let first = entry(1000).unwrap();
        ready(1000);
        fire(first, Ok(()));
        run_pool();
        assert_eq!(ended.try_recv(), Err(mpsc::TryRecvError::Empty));
        ready(1000);
        assert!(entry(1000).is_none());
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn cancel_ends_a_wait_and_every_later_one() {
        let _alone = ALONE.lock();
        let (parking, ended) = park(1001, 1);
        parking.cancel();
        assert!(entry(1001).is_none());
        parking.cancel();
        assert_eq!(all(ended), [E::ECANCELED]);

        let (parking, ended) = park(1001, 2);
        fire(entry(1001).unwrap(), Ok(()));
        parking.cancel();
        run_pool();
        assert!(entry(1001).is_none());
        assert_eq!(all(ended), [E::ECANCELED]);
    }

    #[test]
    fn an_event_leaves_a_cancelled_job_to_the_queue() {
        let _alone = ALONE.lock();
        let (parking, ended) = park(1010, 1);
        while_busy(|| parking.cancel());
        ready(1010);
        assert_eq!(ended.try_recv(), Err(mpsc::TryRecvError::Empty));
        tick();
        assert_eq!(all(ended), [E::ECANCELED]);
    }

    #[test]
    fn a_job_that_is_cancelled_on_the_pool_ends_there() {
        let _alone = ALONE.lock();
        let (park, parking, ended) = job(1007, 1);
        parking.cancel();
        while_busy(park);
        assert_eq!(all(ended), [E::ECANCELED]);
    }

    /// Parks a job on `fd` and cancels it between `before` and `after`, while the kernel adds its entry.
    fn cancel_in_ctl(fd: i32, before: impl FnOnce() + 'static, after: impl FnOnce() + 'static) {
        let (park, parking, ended) = job(fd, 1);
        POLLER.start().ok().unwrap();
        DURING_CTL.set(Some(Box::new(move || {
            before();
            parking.cancel();
            after();
        })));
        park();
        tick();
        assert_eq!(all(ended), [E::ECANCELED]);
    }

    #[test]
    fn a_cancel_keeps_its_place_in_the_queue_while_the_kernel_adds_the_entry() {
        let _alone = ALONE.lock();
        let (earlier, _, ended) = job(1008, 1);
        cancel_in_ctl(1008, earlier, || {});
        assert_eq!(all(ended), [E::EEXIST]);
        assert!(entry(1008).is_none());

        let (later, _, ended) = job(1008, 1);
        cancel_in_ctl(1008, || {}, later);
        ready(1008);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_job_that_is_cancelled_while_the_kernel_refuses_it_leaves_the_entry_of_the_first() {
        let _alone = ALONE.lock();
        let (_, ended) = park(1009, 1);
        cancel_in_ctl(1009, || {}, || {});
        ready(1009);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_queued_job_that_is_cancelled_makes_room_for_the_next() {
        let _alone = ALONE.lock();
        let (parking, first) = park(1004, 2);
        let (_, second) = while_busy(|| {
            ready(1004);
            parking.cancel();
            park(1004, 1)
        });
        tick();
        ready(1004);
        assert_eq!(all(first), [E::ECANCELED]);
        assert_eq!(all(second), [E::SUCCESS]);
    }

    #[test]
    fn an_error_event_ends_the_job() {
        let _alone = ALONE.lock();
        let (_, ended) = park(1005, 2);
        let err = sys::Error::from_code(E::EPIPE, sys::Tag::write);
        fire(entry(1005).unwrap(), Err(err));
        run_pool();
        assert!(entry(1005).is_none());
        assert_eq!(all(ended), [E::EPIPE]);
    }

    #[test]
    fn a_second_job_leaves_the_entry_of_the_first() {
        let _alone = ALONE.lock();
        let (_, ended) = park(1002, 1);
        assert_eq!(all(park(1002, 1).1), [E::EEXIST]);
        ready(1002);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_job_whose_descriptor_was_reused_leaves_the_entry_of_the_next() {
        let _alone = ALONE.lock();
        let (_, first) = park(1006, 2);
        let (_, second) = while_busy(|| {
            ready(1006);
            ENTRIES.lock().remove(&1006);
            park(1006, 1)
        });
        tick();
        ready(1006);
        assert_eq!(all(first), [E::ENOENT]);
        assert_eq!(all(second), [E::SUCCESS]);
    }

    #[test]
    fn the_table_shrinks_around_the_jobs_that_wait() {
        let _alone = ALONE.lock();
        let buckets = || {
            tick();
            let size = IO_THREAD.lock().as_ref().unwrap().armed.allocation_size();
            size / (size_of::<(Key, Job)>() + 1)
        };
        let ended: Vec<_> = (2000..2113).map(|fd| park(fd, 1).1).collect();
        on_io_thread(|thread| thread.armed.reserve(2000));
        assert_eq!(buckets(), 1024);
        ready(2112);
        assert_eq!(buckets(), 512);
        (2001..2112).for_each(ready);
        assert_eq!(buckets(), 512);
        ready(2000);
        assert!(ended.into_iter().all(|it| all(it) == [E::SUCCESS]));
    }

    #[test]
    fn the_waker_wakes_no_job() {
        let _alone = ALONE.lock();
        *IO_THREAD.lock() = None;
        let (_, ended) = park(1011, 1);
        fire(Key::NO_JOB, Ok(()));
        run_pool();
        assert_eq!(ended.try_recv(), Err(mpsc::TryRecvError::Empty));
        ready(1011);
        assert_eq!(all(ended), [E::SUCCESS]);
    }

    #[test]
    fn a_job_that_cancel_races_ends_once() {
        let _alone = ALONE.lock();
        for _ in 0..32 {
            let (park, parking, ended) = job(1003, 2);
            std::thread::scope(|scope| {
                scope.spawn(|| parking.cancel());
                scope.spawn(|| (0..3).for_each(|_| ready(1003)));
                park();
            });
            assert!(matches!(all(ended)[..], [E::SUCCESS | E::ECANCELED]));
        }
    }
}

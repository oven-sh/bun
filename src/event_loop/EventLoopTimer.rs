use core::cell::Cell;
use core::marker::{ConstParamTy, PhantomData, PhantomPinned};
use core::pin::Pin;
use core::ptr::NonNull;

use bun_core::{Timespec, container_of};
use bun_io::heap::{self, HeapNode, Intrusive};
use bun_ptr::{RefCounted, RefPtr};

const NS_PER_MS: i64 = bun_core::time::NS_PER_MS as i64;

unsafe extern "Rust" {
    /// The [`TimerHeaps`] of this thread. Defined in `bun_runtime::jsc_hooks`.
    safe fn __bun_timer_heaps() -> &'static TimerHeaps;
}

/// The heap node inside an [`OwnedTimer`] or a [`RefCountedTimer`].
pub struct EventLoopTimer {
    /// The absolute time to fire this timer next.
    next: Cell<Timespec>,
    heap: heap::IntrusiveField<EventLoopTimer>,
    /// Breaks ties between JS timers with equal deadlines, so that refreshing a timer makes it fire after its peers.
    epoch: Cell<u32>,
    tag: Tag,
    state: Cell<State>,
    /// A `setTimeout()` without a delay in `bun test`. Its deadline is 1 ms away, as in Node, so its place among the
    /// timers is Node's. An event loop that would sleep until then runs it at once.
    pub is_due_when_idle: Cell<bool>,
    _pin: PhantomPinned,
}

const _: () = assert!(size_of::<EventLoopTimer>() == 48);

#[derive(Copy, Clone, Eq, PartialEq)]
enum State {
    /// Never in a heap, and not known to be pinned.
    New,
    Active(Clock),
    /// Pinned, and in no heap.
    Inactive,
}

/// Which heap of [`TimerHeaps`] a timer waits in.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Clock {
    Real,
    Fake,
}

impl EventLoopTimer {
    fn init_paused(tag: Tag) -> Self {
        Self {
            next: Cell::new(Timespec::EPOCH),
            heap: heap::IntrusiveField::default(),
            epoch: Cell::new(0),
            tag,
            state: Cell::new(State::New),
            is_due_when_idle: Cell::new(false),
            _pin: PhantomPinned,
        }
    }

    /// The deadline of the latest insert.
    pub fn next(&self) -> Timespec {
        self.next.get()
    }

    /// `None` unless the timer is in a heap.
    pub fn clock(&self) -> Option<Clock> {
        match self.state.get() {
            State::Active(clock) => Some(clock),
            State::New | State::Inactive => None,
        }
    }

    /// Whether the timer is in a heap.
    pub fn is_active(&self) -> bool {
        self.clock().is_some()
    }

    /// Whether the timer was neither inserted nor [pinned](OwnedTimer::mark_pinned) yet.
    pub fn is_new(&self) -> bool {
        self.state.get() == State::New
    }
}

impl HeapNode for EventLoopTimer {
    #[inline]
    fn heap(&self) -> &heap::IntrusiveField<Self> {
        &self.heap
    }

    fn less(&self, other: &Self) -> bool {
        let (a, b) = (self, other);
        let sec_order = a.next.get().sec.cmp(&b.next.get().sec);
        if sec_order != core::cmp::Ordering::Equal {
            return sec_order == core::cmp::Ordering::Less;
        }

        // collapse sub-millisecond precision for JavaScript timers
        let mut a_ns = a.next.get().nsec;
        let mut b_ns = b.next.get().nsec;
        if a.tag.is_js_timer() {
            a_ns = NS_PER_MS * (a_ns / NS_PER_MS);
        }
        if b.tag.is_js_timer() {
            b_ns = NS_PER_MS * (b_ns / NS_PER_MS);
        }

        let order = a_ns.cmp(&b_ns);
        if order == core::cmp::Ordering::Equal {
            // Only a fake `setImmediate` is ever in a heap. It runs before timeouts due at the same instant.
            if (a.tag == Tag::ImmediateObject) != (b.tag == Tag::ImmediateObject) {
                return a.tag == Tag::ImmediateObject;
            }
            if a.tag.is_js_timer() && b.tag.is_js_timer() {
                // We expect that the epoch will overflow sometimes.
                // If it does, we would ideally like timers with an epoch from before the
                // overflow to be sorted *before* timers with an epoch from after the overflow
                // (even though their epoch will be numerically *larger*).
                //
                // Wrapping subtraction gives us a distance that is consistent even if one
                // epoch has overflowed and the other hasn't. If the distance from a to b is
                // small, it's likely that b is really newer than a, so we consider a less than
                // b. If the distance from a to b is large (greater than half the u32 range),
                // it's more likely that b is older than a so the true distance is from b to a.
                return b.epoch.get().wrapping_sub(a.epoch.get()) < u32::MAX / 2;
            }
        }
        order == core::cmp::Ordering::Less
    }
}

/// `Self` is the timer that `O` embeds.
///
/// # Safety
/// Only `impl_timer_owner!` implements this, once per tag: `bun_runtime::dispatch` infers `O` in the arm of each tag.
pub unsafe trait OwnedBy<O> {
    /// `offset_of!(O, <field>)`.
    const OFFSET: usize;
}

/// A timer that is armed while its owner is pinned, and leaves the heap when it drops.
#[repr(transparent)]
pub struct OwnedTimer<const TAG: Tag>(EventLoopTimer);

impl<const TAG: Tag> OwnedTimer<TAG> {
    pub fn init_paused() -> Self {
        Self(EventLoopTimer::init_paused(TAG))
    }

    /// Enables [`timer_ref`](Self::timer_ref), for an owner whose methods arm the timer through a plain reference.
    pub fn mark_pinned<O>(owner: Pin<&O>)
    where
        Self: OwnedBy<O>,
    {
        let timer = TimerRef::from_pin(owner);
        if timer.node().is_new() {
            timer.node().state.set(State::Inactive);
        }
    }

    /// Panics if the owner has not been seen pinned.
    pub fn timer_ref(&self) -> TimerRef<'_> {
        assert!(!self.is_new(), "the owner of the timer is not pinned");
        TimerRef(NonNull::from(&self.0), PhantomData)
    }

    pub fn disarm(&self) {
        if self.is_active() {
            __bun_timer_heaps().remove(self);
        }
    }
}

impl<const TAG: Tag> core::ops::Deref for OwnedTimer<TAG> {
    type Target = EventLoopTimer;

    fn deref(&self) -> &EventLoopTimer {
        &self.0
    }
}

impl<const TAG: Tag> Drop for OwnedTimer<TAG> {
    fn drop(&mut self) {
        self.disarm();
    }
}

/// A timer on whose owner the heap holds a ref while it is armed.
#[repr(transparent)]
pub struct RefCountedTimer<const TAG: Tag>(EventLoopTimer);

impl<const TAG: Tag> RefCountedTimer<TAG> {
    pub fn init_paused() -> Self {
        Self(EventLoopTimer::init_paused(TAG))
    }

    /// Returns the ref that the heap held, if the timer was armed.
    #[must_use]
    pub fn disarm<O: RefCounted>(&self) -> Option<RefPtr<O>>
    where
        Self: OwnedBy<O>,
    {
        if !self.is_active() {
            return None;
        }
        let node = __bun_timer_heaps().remove(self)?.node;
        Some(Popped { node, tag: TAG }.into_owner_ref())
    }
}

impl<const TAG: Tag> core::ops::Deref for RefCountedTimer<TAG> {
    type Target = EventLoopTimer;

    fn deref(&self) -> &EventLoopTimer {
        &self.0
    }
}

/// A timer that a heap can link: it is the field of the owner of its tag, and does not move or drop while linked.
#[must_use]
pub struct TimerRef<'a>(NonNull<EventLoopTimer>, PhantomData<&'a EventLoopTimer>);

impl<'a> TimerRef<'a> {
    pub fn from_pin<const TAG: Tag, O>(owner: Pin<&'a O>) -> Self
    where
        OwnedTimer<TAG>: OwnedBy<O>,
    {
        // SAFETY: a field of `owner`.
        let timer = unsafe { NonNull::from(owner.get_ref()).byte_add(OwnedTimer::<TAG>::OFFSET) };
        Self(timer.cast(), PhantomData)
    }

    /// The heap takes over the ref. The timer is not armed, or the ref that the heap holds leaks.
    pub fn from_ref_ptr<const TAG: Tag, O: RefCounted>(owner: RefPtr<O>) -> Self
    where
        RefCountedTimer<TAG>: OwnedBy<O>,
    {
        // SAFETY: a field of `owner`, which the ref keeps live.
        let timer = unsafe {
            owner
                .into_non_null()
                .byte_add(RefCountedTimer::<TAG>::OFFSET)
        };
        let this = Self(timer.cast(), PhantomData);
        debug_assert!(!this.node().is_active());
        this
    }

    fn node(&self) -> &EventLoopTimer {
        // SAFETY: the owner is borrowed for `'a`, or `self` has a ref on it.
        unsafe { self.0.as_ref() }
    }

    fn into_raw(self) -> *mut EventLoopTimer {
        self.0.as_ptr()
    }
}

/// A timer that has left its heap. For a [`RefCountedTimer`] it has the heap's ref, which leaks if this is dropped.
#[must_use]
pub struct Popped {
    node: NonNull<EventLoopTimer>,
    tag: Tag,
}

impl Popped {
    pub fn tag(&self) -> Tag {
        self.tag
    }

    /// Panics unless `TAG` is [`tag`](Self::tag).
    pub fn into_owner_ref<const TAG: Tag, O: RefCounted>(self) -> RefPtr<O>
    where
        RefCountedTimer<TAG>: OwnedBy<O>,
    {
        assert!(self.tag == TAG);
        // SAFETY: `TimerRef::from_ref_ptr` is the only way into a heap for this tag, and `O` its only owner.
        unsafe {
            RefPtr::from_raw(container_of(
                self.node.as_ptr(),
                RefCountedTimer::<TAG>::OFFSET,
            ))
        }
    }

    /// The pinned owner, which was live when the timer left the heap. Panics unless `TAG` is [`tag`](Self::tag).
    pub fn into_owner_ptr<const TAG: Tag, O>(self) -> *mut O
    where
        OwnedTimer<TAG>: OwnedBy<O>,
    {
        assert!(self.tag == TAG);
        self.node
            .as_ptr()
            .wrapping_byte_sub(OwnedTimer::<TAG>::OFFSET)
            .cast()
    }
}

/// A `RefPtr<bun_runtime::timer::ImmediateObject>`, for a crate that cannot name that type. The ref leaks if this is dropped.
#[must_use]
pub struct ImmediateTask(NonNull<()>);

impl ImmediateTask {
    pub fn new<O: RefCounted>(owner: RefPtr<O>) -> Self
    where
        RefCountedTimer<{ Tag::ImmediateObject }>: OwnedBy<O>,
    {
        Self(owner.into_non_null().cast())
    }

    pub fn into_owner_ref<O: RefCounted>(self) -> RefPtr<O>
    where
        RefCountedTimer<{ Tag::ImmediateObject }>: OwnedBy<O>,
    {
        // SAFETY: the ref that `new` took over, and `O` is the only owner of the tag.
        unsafe { RefPtr::from_raw(self.0.as_ptr().cast()) }
    }
}

/// Every node in it came from a [`TimerRef`], so it is live. No public method returns a reference to one.
pub struct TimerHeap(Intrusive<EventLoopTimer>);

impl TimerHeap {
    fn first(&self) -> Option<&EventLoopTimer> {
        // SAFETY: a node in the heap is live.
        unsafe { self.0.peek().as_ref() }
    }

    fn for_each(&self, f: impl FnMut(*mut EventLoopTimer)) {
        // SAFETY: a node in the heap is live. No caller's `f` changes a heap.
        unsafe { self.0.for_each(f) }
    }

    /// # Safety
    /// `node` is in this heap.
    unsafe fn remove(&self, node: &EventLoopTimer) -> Popped {
        // SAFETY: fn contract.
        let linked = unsafe { self.0.remove(core::ptr::from_ref(node).cast_mut()) };
        node.state.set(State::Inactive);
        Popped {
            // SAFETY: the address of `node`.
            node: unsafe { NonNull::new_unchecked(linked) },
            tag: node.tag,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.0.peek().is_null()
    }

    pub fn delete_min(&self) -> Option<Popped> {
        let first = self.first()?;
        // SAFETY: a node in the heap is live.
        let node = NonNull::new(unsafe { self.0.delete_min() })?;
        first.state.set(State::Inactive);
        Some(Popped {
            node,
            tag: first.tag,
        })
    }

    pub fn first_deadline(&self) -> Option<Timespec> {
        self.first().map(EventLoopTimer::next)
    }

    /// See [`EventLoopTimer::is_due_when_idle`].
    pub fn is_first_due_when_idle(&self) -> bool {
        self.first()
            .is_some_and(|first| first.is_due_when_idle.get())
    }

    pub fn last_deadline(&self) -> Option<Timespec> {
        // SAFETY: a node in the heap is live.
        unsafe { self.0.find_max().as_ref() }.map(EventLoopTimer::next)
    }

    pub fn has_immediate(&self) -> bool {
        self.first_immediate().is_some()
    }

    pub fn delete_first_immediate(&self) -> Option<Popped> {
        let first = self.first_immediate()?;
        // SAFETY: just found in this heap.
        Some(unsafe { self.remove(first) })
    }

    /// Only a faked `setImmediate` puts an `ImmediateObject` in a heap.
    fn first_immediate(&self) -> Option<&EventLoopTimer> {
        let root = self.first()?;
        if root.tag == Tag::ImmediateObject {
            return Some(root);
        }
        let mut first = None;
        self.for_each(|node| {
            // SAFETY: a node in the heap is live.
            let node = unsafe { &*node };
            if node.tag == Tag::ImmediateObject && first.is_none_or(|first| node.less(first)) {
                first = Some(node);
            }
        });
        first
    }

    pub fn has_program_timer(&self) -> bool {
        // SAFETY: a node in the heap is live.
        unsafe { self.0.any(|node| !(*node).tag.is_housekeeping()) }
    }

    pub fn count(&self) -> usize {
        // SAFETY: a node in the heap is live.
        unsafe { self.0.count() }
    }
}

std::thread_local! {
    static HAS_TIMER_HEAPS: Cell<bool> = const { Cell::new(false) };
}

/// One per thread, so the state of a timer says which heap it is in.
pub struct TimerHeaps {
    real: TimerHeap,
    fake: TimerHeap,
    /// Incremented when timers are scheduled or rescheduled. See [`EventLoopTimer::epoch`].
    epoch: Cell<u32>,
}

impl TimerHeaps {
    /// Panics if this thread has one.
    ///
    /// # Safety
    /// While a timer is in it, `__bun_timer_heaps` returns it on this thread.
    pub unsafe fn init() -> Self {
        assert!(
            !HAS_TIMER_HEAPS.replace(true),
            "this thread already has TimerHeaps"
        );
        Self {
            real: TimerHeap(Intrusive::default()),
            fake: TimerHeap(Intrusive::default()),
            epoch: Cell::new(0),
        }
    }

    pub fn real(&self) -> &TimerHeap {
        &self.real
    }

    /// The timers that `jest.useFakeTimers()` has captured.
    pub fn fake(&self) -> &TimerHeap {
        &self.fake
    }

    fn heap(&self, clock: Clock) -> &TimerHeap {
        match clock {
            Clock::Real => &self.real,
            Clock::Fake => &self.fake,
        }
    }

    /// Removes `timer` if necessary, then inserts it at `time`.
    pub fn update(&self, timer: TimerRef<'_>, time: &Timespec, clock: Clock) {
        let node = timer.node();
        debug_assert!(clock == Clock::Real || node.tag.allow_fake_timers());
        self.remove(node);
        let epoch = self.epoch.get().wrapping_add(1);
        self.epoch.set(epoch);
        node.epoch.set(epoch);
        node.next.set(*time);
        node.state.set(State::Active(clock));
        // SAFETY: in no heap, and see `TimerRef`.
        unsafe { self.heap(clock).0.insert(timer.into_raw()) };
    }

    fn remove(&self, node: &EventLoopTimer) -> Option<Popped> {
        let heap = self.heap(node.clock()?);
        // SAFETY: a node is neither `Send` nor `Sync`, so it was inserted on this thread, whose heaps these are.
        Some(unsafe { heap.remove(node) })
    }

    fn for_each_with_tag(&self, tag: Tag, mut f: impl FnMut(*mut EventLoopTimer)) {
        for heap in [&self.real, &self.fake] {
            heap.for_each(|node| {
                // SAFETY: a node in the heap is live.
                if unsafe { (*node).tag } == tag {
                    f(node);
                }
            });
        }
    }

    /// A new ref on the owner of each armed timer with this tag.
    pub fn owner_refs<const TAG: Tag, O: RefCounted>(&self) -> Vec<RefPtr<O>>
    where
        RefCountedTimer<TAG>: OwnedBy<O>,
    {
        let mut owners = Vec::new();
        self.for_each_with_tag(TAG, |node| {
            // SAFETY: the heap holds a ref, as in `Popped::into_owner_ref`.
            owners.push(unsafe {
                RefPtr::init_ref(container_of(node, RefCountedTimer::<TAG>::OFFSET))
            });
        });
        owners
    }

    /// The owner of each armed timer with this tag.
    pub fn owner_ptrs<const TAG: Tag, O>(&self) -> Vec<*mut O>
    where
        OwnedTimer<TAG>: OwnedBy<O>,
    {
        let mut owners = Vec::new();
        self.for_each_with_tag(TAG, |node| {
            owners.push(node.wrapping_byte_sub(OwnedTimer::<TAG>::OFFSET).cast());
        });
        owners
    }
}

impl Drop for TimerHeaps {
    fn drop(&mut self) {
        while self.real.delete_min().is_some() {}
        while self.fake.delete_min().is_some() {}
        HAS_TIMER_HEAPS.set(false);
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, ConstParamTy, strum::IntoStaticStr)]
pub enum Tag {
    TimeoutObject,
    ImmediateObject,
    StatWatcherScheduler,
    UpgradedDuplex,
    DNSResolver,
    DnsSdConnection,
    WindowsNamedPipe,
    PostgresSQLConnectionTimeout,
    PostgresSQLConnectionMaxLifetime,
    MySQLConnectionTimeout,
    MySQLConnectionMaxLifetime,
    ValkeyConnectionTimeout,
    ValkeyConnectionReconnect,
    SubprocessTimeout,
    DevServerSweepSourceMaps,
    DevServerMemoryVisualizerTick,
    AbortSignalTimeout,
    DateHeaderTimer,
    BunTest,
    EventLoopDelayMonitor,
    CronJob,
    GcRepeating,
    QuicEndpoint,
    FakeTimersTick,
    ViWait,
    /// An N-API addon's `uv_timer_t` (POSIX, where Bun emulates libuv).
    UvTimer,
    WorkerWaitsForRoom,
}

impl Tag {
    /// Whether `jest.useFakeTimers()` can capture this timer. Only timers a
    /// program schedules itself are faked; runtime-internal timeouts stay on
    /// the real clock, as in Jest. A fakeable owner has a release arm in
    /// `FakeTimers::clear`; every other owner arms with `ForceRealTime`, the
    /// clock the real heap is drained against.
    fn allow_fake_timers(self) -> bool {
        matches!(
            self,
            Tag::TimeoutObject | Tag::ImmediateObject | Tag::AbortSignalTimeout | Tag::CronJob
        )
    }

    /// Created by `set{Immediate,Timeout,Interval}` or `AbortSignal.timeout()`.
    fn is_js_timer(self) -> bool {
        matches!(
            self,
            Tag::TimeoutObject | Tag::ImmediateObject | Tag::AbortSignalTimeout
        )
    }

    /// The tag of a [`RefCountedTimer`], not of an [`OwnedTimer`].
    pub const fn is_ref_counted(self) -> bool {
        matches!(
            self,
            Tag::TimeoutObject
                | Tag::ImmediateObject
                | Tag::StatWatcherScheduler
                | Tag::DNSResolver
                | Tag::ValkeyConnectionTimeout
                | Tag::ValkeyConnectionReconnect
                | Tag::SubprocessTimeout
                | Tag::CronJob
                | Tag::WorkerWaitsForRoom
        )
    }

    /// Runtime-internal timers that never settle anything the program waits on.
    fn is_housekeeping(self) -> bool {
        match self {
            Tag::DevServerSweepSourceMaps
            | Tag::DevServerMemoryVisualizerTick
            | Tag::DateHeaderTimer
            | Tag::BunTest
            | Tag::EventLoopDelayMonitor
            | Tag::GcRepeating => true,
            Tag::TimeoutObject
            | Tag::ImmediateObject
            | Tag::StatWatcherScheduler
            | Tag::UpgradedDuplex
            | Tag::DNSResolver
            | Tag::DnsSdConnection
            | Tag::WindowsNamedPipe
            | Tag::PostgresSQLConnectionTimeout
            | Tag::PostgresSQLConnectionMaxLifetime
            | Tag::MySQLConnectionTimeout
            | Tag::MySQLConnectionMaxLifetime
            | Tag::ValkeyConnectionTimeout
            | Tag::ValkeyConnectionReconnect
            | Tag::SubprocessTimeout
            | Tag::AbortSignalTimeout
            | Tag::CronJob
            | Tag::QuicEndpoint
            | Tag::FakeTimersTick
            | Tag::ViWait
            | Tag::UvTimer
            | Tag::WorkerWaitsForRoom => false,
        }
    }
}

/// Makes `$Owner` the owner of the tag of each timer field.
///
/// A `Drop` impl could move an [`OwnedTimer`], so `drop` names a `fn(&Self)` to run.
///
/// ```ignore
/// impl_timer_owner!(CronJob; event_loop_timer: RefCountedTimer<CronJob>);
/// impl_timer_owner!(ViWait; timer: OwnedTimer<ViWait>);
/// impl_timer_owner!(QuicEndpoint, drop = Self::release_native; event_loop_timer: OwnedTimer<QuicEndpoint>);
/// impl_timer_owner!(JSMySQLConnection; (timers: Timers).timer: OwnedTimer<MySQLConnectionTimeout>);
/// ```
///
/// This compiles, and the examples below it do not:
///
/// ```no_run
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct Wait { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl_timer_owner!(Wait; timer: OwnedTimer<ViWait>);
/// let _ = Popped::into_owner_ptr::<{ Tag::ViWait }, _>;
/// ```
///
/// ```compile_fail,E0283
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct Wait { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl_timer_owner!(Wait; timer: OwnedTimer<ViWait>);
/// struct SecondOwner { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl_timer_owner!(SecondOwner; timer: OwnedTimer<ViWait>);
/// let _ = Popped::into_owner_ptr::<{ Tag::ViWait }, _>;
/// ```
///
/// ```compile_fail,E0283
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct IsUnpin { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl Unpin for IsUnpin {}
/// impl_timer_owner!(IsUnpin; timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0119
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct ImplsDrop { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl Drop for ImplsDrop { fn drop(&mut self) {} }
/// impl_timer_owner!(ImplsDrop; timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0119
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct FieldImplsDrop { inner: Inner }
/// struct Inner { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl Drop for Inner { fn drop(&mut self) {} }
/// impl_timer_owner!(FieldImplsDrop; (inner: Inner).timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0080
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// #[repr(packed)]
/// struct Packed { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl_timer_owner!(Packed; timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0308
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct Boxed { timer: Box<OwnedTimer<{ Tag::ViWait }>> }
/// impl_timer_owner!(Boxed; timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0308
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct OtherTag { timer: OwnedTimer<{ Tag::UvTimer }> }
/// impl_timer_owner!(OtherTag; timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0080
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct TagIsRefCounted { timer: OwnedTimer<{ Tag::CronJob }> }
/// impl_timer_owner!(TagIsRefCounted; timer: OwnedTimer<CronJob>);
/// ```
///
/// ```compile_fail,E0080
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct TagIsNotRefCounted { timer: RefCountedTimer<{ Tag::ViWait }> }
/// impl_timer_owner!(TagIsNotRefCounted; timer: RefCountedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0637
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct Borrows<'a> { timer: OwnedTimer<{ Tag::ViWait }>, name: &'a str }
/// impl_timer_owner!(Borrows<'_>; timer: OwnedTimer<ViWait>);
/// ```
///
/// ```compile_fail,E0277
/// # use bun_event_loop::{EventLoopTimer::*, impl_timer_owner};
/// struct NotPinned { timer: OwnedTimer<{ Tag::ViWait }> }
/// impl_timer_owner!(NotPinned; timer: OwnedTimer<ViWait>);
/// fn arm(owner: &NotPinned) -> TimerRef<'_> { TimerRef::from_pin(core::pin::Pin::new(owner)) }
/// ```
#[macro_export]
macro_rules! impl_timer_owner {
    (@aligned_field $Owner:ty; $Field:ty; $($field:ident).+) => {
        const _: fn(&$Owner) -> *const $Field = |owner| &raw const owner.$($field).+;
        const _: () = ::core::assert!(
            ::core::mem::align_of::<$Owner>() >= ::core::mem::align_of::<$Field>()
                && ::core::mem::offset_of!($Owner, $($field).+) % ::core::mem::align_of::<$Field>() == 0
        );
    };
    (@must_not_impl_drop $T:ty) => {
        const _: () = {
            trait MustNotImplDrop {}
            impl<T: ::core::ops::Drop> MustNotImplDrop for T {}
            impl MustNotImplDrop for $T {}
        };
    };
    (unsafe @impl $Owner:ty; $Timer:ty; $($field:ident).+) => {
        $crate::impl_timer_owner!(@aligned_field $Owner; $Timer; $($field).+);
        // SAFETY: an aligned field of that type, and see the trait.
        unsafe impl $crate::EventLoopTimer::OwnedBy<$Owner> for $Timer
        where
            $Owner: 'static,
        {
            const OFFSET: usize = ::core::mem::offset_of!($Owner, $($field).+);
        }
    };
    (unsafe $Owner:ty; $($(($outer:ident: $Outer:ty).)? $field:ident: OwnedTimer<$tag:ident>),+ $(,)?) => {
        const _: fn() = || {
            trait AmbiguousIfUnpin<A> {
                fn check() {}
            }
            impl<T> AmbiguousIfUnpin<()> for T {}
            impl<T: ::core::marker::Unpin> AmbiguousIfUnpin<u8> for T {}
            <$Owner as AmbiguousIfUnpin<_>>::check();
        };
        $(
            $(
                $crate::impl_timer_owner!(@aligned_field $Owner; $Outer; $outer);
                $crate::impl_timer_owner!(@aligned_field $Outer;
                    $crate::EventLoopTimer::OwnedTimer<{ $crate::EventLoopTimer::Tag::$tag }>; $field);
                $crate::impl_timer_owner!(@must_not_impl_drop $Outer);
            )?
            const _: () = ::core::assert!(!$crate::EventLoopTimer::Tag::$tag.is_ref_counted());
            $crate::impl_timer_owner!(unsafe @impl $Owner;
                $crate::EventLoopTimer::OwnedTimer<{ $crate::EventLoopTimer::Tag::$tag }>; $($outer.)? $field);
        )+
    };
    ($Owner:ty; $($field:ident: RefCountedTimer<$tag:ident>),+ $(,)?) => {
        $(
            const _: () = ::core::assert!($crate::EventLoopTimer::Tag::$tag.is_ref_counted());
            $crate::impl_timer_owner!(unsafe @impl $Owner;
                $crate::EventLoopTimer::RefCountedTimer<{ $crate::EventLoopTimer::Tag::$tag }>; $field);
        )+
    };
    ($Owner:ty, drop = $drop:path; $($fields:tt)+) => {
        impl ::core::ops::Drop for $Owner {
            fn drop(&mut self) {
                $drop(&*self);
            }
        }
        $crate::impl_timer_owner!(unsafe $Owner; $($fields)+);
    };
    ($Owner:ty; $($fields:tt)+) => {
        $crate::impl_timer_owner!(@must_not_impl_drop $Owner);
        $crate::impl_timer_owner!(unsafe $Owner; $($fields)+);
    };
}

/// `setTimeout` / `setInterval` / `setImmediate` discriminant stored in the
/// `Flags` bitfield (2 bits).
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind {
    SetTimeout = 0,
    SetInterval = 1,
    SetImmediate = 2,
}

impl Kind {
    /// Returns the [`KindBig`] that [`ID`](Timer::ID) packs into the `u64` async-id.
    #[inline]
    pub fn big(self) -> KindBig {
        match self {
            Kind::SetTimeout => KindBig::SetTimeout,
            Kind::SetInterval => KindBig::SetInterval,
            Kind::SetImmediate => KindBig::SetImmediate,
        }
    }
}

/// Same variants as [`Kind`]. Stored in the two low bits of the `u64` async-id.
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum KindBig {
    SetTimeout = 0,
    SetInterval = 1,
    SetImmediate = 2,
}

impl From<Kind> for KindBig {
    #[inline]
    fn from(k: Kind) -> Self {
        k.big()
    }
}

/// Packed per-JS-timer state in a `u8`. Layout (LSB→MSB):
///   fake:1, kind:u2, has_cleared_timer:1, is_keeping_event_loop_alive:1,
///   has_accessed_primitive:1, has_js_ref:1, in_callback:1
///
/// Used by `TimeoutObject` / `ImmediateObject`.
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct TimerFlags(u8);

impl Default for TimerFlags {
    fn default() -> Self {
        // has_js_ref=true, everything else 0
        Self(Self::HAS_JS_REF)
    }
}

impl TimerFlags {
    const FAKE: u8 = 1 << 0;
    const KIND_SHIFT: u8 = 1;
    const KIND_MASK: u8 = 0b11 << Self::KIND_SHIFT;
    const HAS_CLEARED_TIMER: u8 = 1 << 3;
    const IS_KEEPING_EVENT_LOOP_ALIVE: u8 = 1 << 4;
    const HAS_ACCESSED_PRIMITIVE: u8 = 1 << 5;
    const HAS_JS_REF: u8 = 1 << 6;
    const IN_CALLBACK: u8 = 1 << 7;

    /// Created by a function `jest.useFakeTimers()` installed, so it always arms on the fake clock and heap.
    #[inline]
    pub fn fake(self) -> bool {
        self.0 & Self::FAKE != 0
    }
    #[inline]
    pub fn set_fake(&mut self, v: bool) {
        if v {
            self.0 |= Self::FAKE
        } else {
            self.0 &= !Self::FAKE
        }
    }
    /// Kind does not include AbortSignal's timeout since it has no
    /// corresponding ID callback.
    #[inline]
    pub fn kind(self) -> Kind {
        // stored value always written via set_kind (range 0..=2)
        match (self.0 & Self::KIND_MASK) >> Self::KIND_SHIFT {
            0 => Kind::SetTimeout,
            1 => Kind::SetInterval,
            2 => Kind::SetImmediate,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub fn set_kind(&mut self, k: Kind) {
        self.0 = (self.0 & !Self::KIND_MASK) | ((k as u8) << Self::KIND_SHIFT);
    }
    /// We do not allow the timer to be refreshed after clearInterval/clearTimeout.
    #[inline]
    pub fn has_cleared_timer(self) -> bool {
        self.0 & Self::HAS_CLEARED_TIMER != 0
    }
    #[inline]
    pub fn set_has_cleared_timer(&mut self, v: bool) {
        if v {
            self.0 |= Self::HAS_CLEARED_TIMER
        } else {
            self.0 &= !Self::HAS_CLEARED_TIMER
        }
    }
    #[inline]
    pub fn is_keeping_event_loop_alive(self) -> bool {
        self.0 & Self::IS_KEEPING_EVENT_LOOP_ALIVE != 0
    }
    #[inline]
    pub fn set_is_keeping_event_loop_alive(&mut self, v: bool) {
        if v {
            self.0 |= Self::IS_KEEPING_EVENT_LOOP_ALIVE
        } else {
            self.0 &= !Self::IS_KEEPING_EVENT_LOOP_ALIVE
        }
    }
    /// If they never access the timer by integer, don't create a hashmap entry.
    #[inline]
    pub fn has_accessed_primitive(self) -> bool {
        self.0 & Self::HAS_ACCESSED_PRIMITIVE != 0
    }
    #[inline]
    pub fn set_has_accessed_primitive(&mut self, v: bool) {
        if v {
            self.0 |= Self::HAS_ACCESSED_PRIMITIVE
        } else {
            self.0 &= !Self::HAS_ACCESSED_PRIMITIVE
        }
    }
    #[inline]
    pub fn has_js_ref(self) -> bool {
        self.0 & Self::HAS_JS_REF != 0
    }
    #[inline]
    pub fn set_has_js_ref(&mut self, v: bool) {
        if v {
            self.0 |= Self::HAS_JS_REF
        } else {
            self.0 &= !Self::HAS_JS_REF
        }
    }
    /// Set to `true` only during execution of the JavaScript function so that
    /// `_destroyed` can be false during the callback even though the timer has left the heap.
    #[inline]
    pub fn in_callback(self) -> bool {
        self.0 & Self::IN_CALLBACK != 0
    }
    #[inline]
    pub fn set_in_callback(&mut self, v: bool) {
        if v {
            self.0 |= Self::IN_CALLBACK
        } else {
            self.0 &= !Self::IN_CALLBACK
        }
    }
}

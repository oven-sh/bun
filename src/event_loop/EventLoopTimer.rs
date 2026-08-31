// LAYERING: re-export `bun_core::Timespec` so every embedder of
// `EventLoopTimer.next` agrees on the type (was a local stub with the same
// `{sec,nsec}` layout, which forced higher tiers — `bun_runtime`, `bun_sql_jsc`
// — to convert at every assignment and risked silent layout drift).
use Timespec as timespec;
pub use bun_core::Timespec;

use core::ptr::NonNull;

use bun_ptr::JsCell;

// Re-export so higher tiers see the *same* type they pass to
// `bun_io::heap::Intrusive<EventLoopTimer, _>` (a zero-sized local stub
// would make the real pairing-heap unusable — orphan rule blocks
// `impl HeapNode for EventLoopTimer` anywhere but here).
pub use bun_io::heap::IntrusiveField;

const NS_PER_MS: i64 = bun_core::time::NS_PER_MS as i64;

// ─── Hot-dispatch (link-time) ───────────────────────────────────────────────
// `EventLoopTimer` is per-tick hot. Low tier (this crate) keeps `Tag` + the
// intrusive heap node; the `match tag { … container_of … }` dispatch lives in
// `bun_runtime::dispatch` because it names ~20 high-tier container types.
//
// PERF: `__bun_js_timer_epoch` sits on the
// heap-compare path. Consider denormalizing `epoch` into `EventLoopTimer`
// to drop the cross-crate call if profiling shows it matters.
unsafe extern "Rust" {
    /// Returns the JS-timer epoch (TimerObjectInternals.flags.epoch) for
    /// TimeoutObject/ImmediateObject/AbortSignalTimeout, else `None`.
    /// Defined in `bun_runtime::dispatch`.
    ///
    /// SAFETY (genuine FFI precondition — NOT a `safe fn` candidate): impl
    /// recovers the parent struct via `container_of` keyed on `tag`; `t` must
    /// be the `event_loop_timer` field of that container (tag invariant).
    fn __bun_js_timer_epoch(tag: Tag, t: *const EventLoopTimer) -> Option<u32>;
}
// ────────────────────────────────────────────────────────────────────────────

pub struct EventLoopTimer {
    /// The absolute time to fire this timer next.
    pub next: timespec,
    pub state: State,
    /// Fixed at construction: the dispatch `container_of` is keyed on it.
    tag: Tag,
    /// Internal heap links; written only by [`TimerHeap`].
    heap: IntrusiveField<EventLoopTimer>,
    /// Which [`TimerHeap`] this slot is linked into; written only by [`TimerHeap`].
    in_heap: InHeap,
}

impl bun_io::heap::HeapNode for EventLoopTimer {
    #[inline]
    fn heap(&self) -> &IntrusiveField<Self> {
        &self.heap
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Default, Debug)]
pub enum InHeap {
    #[default]
    None,
    Regular,
    Fake,
    Wtf,
}

impl EventLoopTimer {
    pub fn init_paused(tag: Tag) -> Self {
        Self::new(tag, State::PENDING, timespec::EPOCH)
    }

    pub fn new(tag: Tag, state: State, next: timespec) -> Self {
        Self {
            next,
            state,
            tag,
            heap: IntrusiveField::default(),
            in_heap: InHeap::None,
        }
    }

    #[inline]
    pub fn tag(&self) -> Tag {
        self.tag
    }

    #[inline]
    pub fn in_heap(&self) -> InHeap {
        self.in_heap
    }

    pub fn less(_: (), a: &Self, b: &Self) -> bool {
        let sec_order = a.next.sec.cmp(&b.next.sec);
        if sec_order != core::cmp::Ordering::Equal {
            return sec_order == core::cmp::Ordering::Less;
        }

        // collapse sub-millisecond precision for JavaScript timers
        let maybe_a_epoch = a.js_timer_epoch();
        let maybe_b_epoch = b.js_timer_epoch();
        let mut a_ns = a.next.nsec;
        let mut b_ns = b.next.nsec;
        if maybe_a_epoch.is_some() {
            a_ns = NS_PER_MS * (a_ns / NS_PER_MS);
        }
        if maybe_b_epoch.is_some() {
            b_ns = NS_PER_MS * (b_ns / NS_PER_MS);
        }

        let order = a_ns.cmp(&b_ns);
        if order == core::cmp::Ordering::Equal {
            if let Some(a_epoch) = maybe_a_epoch {
                if let Some(b_epoch) = maybe_b_epoch {
                    // We expect that the epoch will overflow sometimes.
                    // If it does, we would ideally like timers with an epoch from before the
                    // overflow to be sorted *before* timers with an epoch from after the overflow
                    // (even though their epoch will be numerically *larger*).
                    //
                    // Wrapping subtraction gives us a distance that is consistent even if one
                    // epoch has overflowed and the other hasn't. If the distance from a to b is
                    // small, it's likely that b is really newer than a, so we consider a less than
                    // b. If the distance from a to b is large (greater than half the u25 range),
                    // it's more likely that b is older than a so the true distance is from b to a.
                    //
                    // The epoch is logically a u25, stored in a wider int,
                    // so we mask the wrapping_sub result to 25 bits to wrap mod 2^25.
                    // (`TimerFlags::epoch`/`set_epoch` below mask to 25 bits on both read
                    // and write, so both operands here are already < 2^25.)
                    const U25_MAX: u32 = (1 << 25) - 1;
                    return (b_epoch.wrapping_sub(a_epoch) & U25_MAX) < U25_MAX / 2;
                }
            }
        }
        order == core::cmp::Ordering::Less
    }

    /// If self was created by set{Immediate,Timeout,Interval}, return its
    /// JS-timer epoch (used for stable ordering of equal-deadline timers).
    ///
    /// The container_of dispatch into
    /// `TimeoutObject`/`ImmediateObject`/`AbortSignalTimeout` (all tier-6
    /// runtime types) lives in
    /// `bun_runtime::dispatch::__bun_js_timer_epoch` (link-time extern).
    /// Returns `None` for non-JS timer tags.
    #[inline]
    pub(crate) fn js_timer_epoch(&self) -> Option<u32> {
        // SAFETY: `self` is a live timer; the extern impl reads `tag` and
        // recovers the container via `offset_of` (`TimerOwner` tag contract).
        unsafe { __bun_js_timer_epoch(self.tag, self) }
    }
}

// ─── TimerOwner / TimerRef / TimerHeap ──────────────────────────────────────

/// A type that embeds one or more [`EventLoopTimer`] slots and lends them to a
/// [`TimerHeap`]. Emitted by [`impl_timer_owner!`]; invoking that macro is the
/// owner's assertion of this contract.
///
/// # Safety
/// The implementor guarantees, for every slot of `Self` it constructs:
/// - the slot is created with the [`Tag`] whose `bun_runtime::dispatch` arm
///   names `Self` and that field, so the tag→container recovery is an
///   identity (the tag cannot change after construction);
/// - every teardown path of a `Self` unlinks its slots before the value is
///   dropped, freed, or moved.
///
/// The remaining obligation is the holder's, as for [`bun_ptr::BackRef`]: a
/// `Self` whose slot is linked must be kept alive and in place by whoever owns
/// it (a JS wrapper's ref, a `Box` owned by C++, a field of the per-thread
/// timer state, …) until it is unlinked.
pub unsafe trait TimerOwner {}

/// Handle to an [`EventLoopTimer`] slot embedded in a live [`TimerOwner`]; the
/// currency of [`TimerHeap`] and `bun_runtime::timer::All`.
///
/// Like [`bun_ptr::BackRef`], validity is an obligation rather than a borrow:
/// a `TimerRef` is usable while its slot is linked, for the duration of the
/// owner's own call that passed it (arm/disarm), or of the dispatch that
/// popped it (fire, until the owner's handler returns). Do not retain one past
/// those points. It exposes the slot's deadline and state but neither its tag
/// nor its heap links, which only construction and [`TimerHeap`] write.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct TimerRef(NonNull<JsCell<EventLoopTimer>>);

impl TimerRef {
    /// Re-derive `slot` (a field of `*owner`) from `owner`'s address so the
    /// handle carries whole-owner provenance for the dispatch `container_of`.
    #[inline]
    fn project<O: ?Sized>(owner: *const O, owner_size: usize, slot: *const EventLoopTimer) -> Self {
        let offset = (slot as usize).wrapping_sub(owner.cast::<u8>() as usize);
        assert!(
            offset.saturating_add(core::mem::size_of::<EventLoopTimer>()) <= owner_size,
            "TimerRef: slot is not a field of its owner"
        );
        // `slot`'s own address (so already aligned), re-derived from `owner`.
        #[allow(clippy::cast_ptr_alignment)]
        let p = owner
            .cast::<u8>()
            .wrapping_add(offset)
            .cast::<JsCell<EventLoopTimer>>()
            .cast_mut();
        // SAFETY: `p` addresses a field of `*owner` (checked above), so it is non-null.
        TimerRef(unsafe { NonNull::new_unchecked(p) })
    }

    /// `owner`'s `slot` (which must be a field of `*owner`).
    #[inline]
    pub fn new<O: TimerOwner + ?Sized>(owner: &O, slot: fn(&O) -> &JsCell<EventLoopTimer>) -> Self {
        let cell: *const JsCell<EventLoopTimer> = slot(owner);
        Self::project(owner, core::mem::size_of_val(owner), cell.cast())
    }

    /// [`new`](Self::new) for owners that hold the slot as a bare field.
    #[inline]
    pub fn from_mut<O: TimerOwner + ?Sized>(
        owner: &mut O,
        slot: fn(&mut O) -> &mut EventLoopTimer,
    ) -> Self {
        let owner_size = core::mem::size_of_val(owner);
        let cell: *const EventLoopTimer = slot(owner);
        Self::project(core::ptr::from_mut(owner), owner_size, cell)
    }

    /// # Safety
    /// `slot` is an [`EventLoopTimer`] slot of a live [`TimerOwner`] (or is
    /// otherwise pinned, unlinked before it is freed, and tagged for its
    /// container), with provenance over that container.
    #[inline]
    pub unsafe fn from_raw(slot: *mut EventLoopTimer) -> Self {
        debug_assert!(!slot.is_null());
        // SAFETY: non-null per contract; `JsCell<T>` is `repr(transparent)` over `T`.
        TimerRef(unsafe { NonNull::new_unchecked(slot.cast()) })
    }

    /// The slot's address, for the `container_of` dispatch and identity checks.
    #[inline]
    pub fn as_ptr(self) -> *mut EventLoopTimer {
        self.0.as_ptr().cast()
    }

    #[inline]
    fn cell(&self) -> &JsCell<EventLoopTimer> {
        // SAFETY: `TimerOwner` / holder contract — the slot's owner is alive
        // while this handle is in use (see the type docs for when that is).
        unsafe { self.0.as_ref() }
    }

    #[inline]
    pub fn tag(self) -> Tag {
        self.cell().get().tag
    }
    #[inline]
    pub fn state(self) -> State {
        self.cell().get().state
    }
    #[inline]
    pub fn set_state(self, state: State) {
        self.cell().with_mut(|t| t.state = state);
    }
    #[inline]
    pub fn next(self) -> timespec {
        self.cell().get().next
    }
    #[inline]
    pub fn set_next(self, next: timespec) {
        self.cell().with_mut(|t| t.next = next);
    }
    #[inline]
    pub fn in_heap(self) -> InHeap {
        self.cell().get().in_heap
    }
}

#[derive(Default)]
pub struct TimerOrder;

impl bun_io::heap::HeapContext<EventLoopTimer> for TimerOrder {
    #[inline]
    fn less(&self, a: &EventLoopTimer, b: &EventLoopTimer) -> bool {
        EventLoopTimer::less((), a, b)
    }
}

/// Pairing heap of [`EventLoopTimer`] slots, ordered by deadline (then JS
/// epoch). Holds no ownership: each linked slot is kept alive by its
/// [`TimerOwner`]. The heap is the only writer of a slot's links and
/// [`InHeap`] membership, so `insert`/`remove` can refuse a slot that is
/// already linked / not linked here instead of corrupting the structure.
pub struct TimerHeap {
    heap: bun_io::heap::Intrusive<EventLoopTimer, TimerOrder>,
    kind: InHeap,
}

impl TimerHeap {
    pub fn new(kind: InHeap) -> Self {
        debug_assert!(kind != InHeap::None);
        Self {
            heap: Default::default(),
            kind,
        }
    }

    #[inline]
    fn wrap(t: *mut EventLoopTimer) -> Option<TimerRef> {
        // SAFETY: every node in the heap came from a `TimerRef` (`insert`).
        (!t.is_null()).then(|| unsafe { TimerRef::from_raw(t) })
    }

    #[inline]
    pub fn peek(&self) -> Option<TimerRef> {
        Self::wrap(self.heap.peek())
    }

    /// Link `t`. A slot that is already in a heap is left where it is.
    #[inline]
    pub fn insert(&self, t: TimerRef) {
        let cell = t.cell();
        if cell.get().in_heap != InHeap::None {
            debug_assert!(
                false,
                "TimerHeap::insert: slot already in {:?}",
                cell.get().in_heap
            );
            return;
        }
        cell.with_mut(|t| t.in_heap = self.kind);
        // SAFETY: unlinked (checked above); the `TimerOwner` / holder contract
        // keeps the slot live and in place until it is unlinked again.
        unsafe { self.heap.insert(t.as_ptr()) }
    }

    /// Unlink `t`. A slot that is not in this heap is left alone.
    #[inline]
    pub fn remove(&self, t: TimerRef) {
        let cell = t.cell();
        if cell.get().in_heap != self.kind {
            debug_assert!(
                false,
                "TimerHeap::remove: slot is in {:?}",
                cell.get().in_heap
            );
            return;
        }
        // SAFETY: `t` is live (`TimerOwner` contract) and linked into this heap
        // (only `insert` sets `in_heap` to `self.kind`).
        unsafe { self.heap.remove(t.as_ptr()) };
        cell.with_mut(|t| t.in_heap = InHeap::None);
    }

    #[inline]
    pub fn delete_min(&self) -> Option<TimerRef> {
        let t = Self::wrap(self.heap.delete_min())?;
        t.cell().with_mut(|t| t.in_heap = InHeap::None);
        Some(t)
    }

    /// O(N).
    #[inline]
    pub fn find_max(&self) -> Option<TimerRef> {
        Self::wrap(self.heap.find_max())
    }

    /// O(N).
    #[inline]
    pub fn count(&self) -> usize {
        self.heap.count()
    }

    /// Every linked slot, in no particular order.
    pub fn to_vec(&self) -> Vec<TimerRef> {
        let mut out = Vec::new();
        // SAFETY: as `wrap` — visited nodes are linked, hence from a `TimerRef`.
        self.heap
            .for_each(|t| out.push(unsafe { TimerRef::from_raw(t) }));
        out
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Tag {
    TimeoutObject,
    ImmediateObject,
    StatWatcherScheduler,
    UpgradedDuplex,
    DNSResolver,
    DnsSdConnection,
    WindowsNamedPipe,
    WTFTimer,
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
}

impl Tag {
    /// Whether `jest.useFakeTimers()` captures this timer. Only timers a
    /// program schedules itself are faked; runtime-internal timeouts stay on
    /// the real clock, as in Jest. A fakeable owner arms with
    /// `AllowMockedTime` and has a release arm in `FakeTimers::clear`; every
    /// other owner arms with `ForceRealTime`, the clock the real heap is
    /// drained against.
    pub fn allow_fake_timers(self) -> bool {
        matches!(
            self,
            Tag::TimeoutObject | Tag::AbortSignalTimeout | Tag::CronJob
        )
    }
}

/// Stamp out one `unsafe fn $method(*const EventLoopTimer) -> *mut Self` per
/// `(method => field)` pair: each recovers the embedding owner from a pointer
/// to the named intrusive [`EventLoopTimer`] slot (typed container_of), and
/// marks `$Owner` as a [`TimerOwner`] — **invoking this macro asserts that
/// trait's contract** for the named slots.
///
/// The accessor layer exists only as a cross-crate visibility shim: the
/// `fire_timer` tag-dispatch in `bun_runtime` cannot name private timer
/// fields on owners defined elsewhere, so each owner exports a named thunk per
/// slot. The input is `*const` (so `*mut` / `&mut` / `&` all coerce at the
/// call site); the field may be a bare `EventLoopTimer` or any
/// `#[repr(transparent)]` wrapper such as `JsCell<EventLoopTimer>` — the
/// underlying `from_field_ptr!` infers the field type.
///
/// ```ignore
/// bun_event_loop::impl_timer_owner!(JSValkeyClient;
///     from_timer_ptr => timer,
///     from_reconnect_timer_ptr => reconnect_timer,
/// );
/// ```
#[macro_export]
macro_rules! impl_timer_owner {
    ($Owner:ty; $($method:ident => $field:ident),+ $(,)?) => {
        // SAFETY: asserted by the invoker — see the macro docs.
        unsafe impl $crate::EventLoopTimer::TimerOwner for $Owner {}
        impl $Owner {
            $(
                /// Recover `*mut Self` from a pointer to its intrusive
                #[doc = concat!("`", stringify!($field), "` [`EventLoopTimer`] slot.")]
                /// # Safety
                #[doc = concat!("`t` must point at the `", stringify!($field), "` field of a live `Self`.")]
                #[inline]
                pub unsafe fn $method(
                    t: *const $crate::EventLoopTimer::EventLoopTimer,
                ) -> *mut Self {
                    // SAFETY: caller contract — `t` addresses `Self.$field`
                    // with whole-`Self` provenance.
                    unsafe { ::bun_core::from_field_ptr!(Self, $field, t) }
                }
            )+
        }
    };
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum State {
    /// The timer is waiting to be enabled.
    #[default]
    PENDING,

    /// The timer is active and will fire at the next time.
    ACTIVE,

    /// The timer has been cancelled and will not fire.
    CANCELLED,

    /// The timer has fired and the callback has been called.
    FIRED,
}

// ──────────────────────────────────────────────────────────────────────────
// `TimerObjectInternals.Flags` + `Kind` — moved DOWN from `bun_runtime::timer`
// (LAYERING: `bun_jsc::AbortSignal::Timeout` embeds `Flags` for the heap-order
// epoch tiebreak; `bun_runtime` depends on `bun_jsc`, so the field type must
// live in a crate both can see. Pure data — no high-tier deps.)
// ──────────────────────────────────────────────────────────────────────────

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
    /// Widen to the `u32`-repr [`KindBig`] used in [`ID`](Timer::ID) so the
    /// `{i32, u32}` pair `bitcast`s to a `u64` async-id.
    #[inline]
    pub fn big(self) -> KindBig {
        match self {
            Kind::SetTimeout => KindBig::SetTimeout,
            Kind::SetInterval => KindBig::SetInterval,
            Kind::SetImmediate => KindBig::SetImmediate,
        }
    }
}

/// Same variants as [`Kind`] but `#[repr(u32)]` so `ID { i32, KindBig }`
/// is exactly one pointer / `u64`.
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

/// Packed per-JS-timer state in a `u32`. Layout (LSB→MSB):
///   epoch:u25, kind:u2, has_cleared_timer:1, is_keeping_event_loop_alive:1,
///   has_accessed_primitive:1, has_js_ref:1, in_callback:1
///
/// Used by `TimeoutObject` / `ImmediateObject` / `AbortSignal::Timeout`.
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct TimerFlags(u32);

impl Default for TimerFlags {
    fn default() -> Self {
        // has_js_ref=true, everything else 0
        Self(1 << 30)
    }
}

impl TimerFlags {
    const EPOCH_MASK: u32 = (1 << 25) - 1;
    const KIND_SHIFT: u32 = 25;
    const KIND_MASK: u32 = 0b11 << Self::KIND_SHIFT;
    const HAS_CLEARED_TIMER: u32 = 1 << 27;
    const IS_KEEPING_EVENT_LOOP_ALIVE: u32 = 1 << 28;
    const HAS_ACCESSED_PRIMITIVE: u32 = 1 << 29;
    const HAS_JS_REF: u32 = 1 << 30;
    const IN_CALLBACK: u32 = 1 << 31;

    /// Whenever a timer is inserted into the heap (creation or refresh), the
    /// global epoch is incremented and the new epoch is set on the timer. For
    /// JS timers, the epoch breaks ties between equal-deadline timers so that
    /// refreshing a timer makes it fire after its peers (Node.js semantics).
    #[inline]
    pub fn epoch(self) -> u32 {
        self.0 & Self::EPOCH_MASK
    }
    #[inline]
    pub fn set_epoch(&mut self, v: u32) {
        self.0 = (self.0 & !Self::EPOCH_MASK) | (v & Self::EPOCH_MASK);
    }
    /// Kind does not include AbortSignal's timeout since it has no
    /// corresponding ID callback.
    #[inline]
    pub fn kind(self) -> Kind {
        // stored value always written via set_kind (range 0..=2)
        match ((self.0 & Self::KIND_MASK) >> Self::KIND_SHIFT) as u8 {
            0 => Kind::SetTimeout,
            1 => Kind::SetInterval,
            2 => Kind::SetImmediate,
            _ => unreachable!(),
        }
    }
    #[inline]
    pub fn set_kind(&mut self, k: Kind) {
        self.0 = (self.0 & !Self::KIND_MASK) | ((k as u32) << Self::KIND_SHIFT);
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
    /// `_destroyed` can be false during the callback even though `state` will
    /// be `FIRED`.
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

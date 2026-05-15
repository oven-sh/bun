use core::ffi::c_void;
use core::ptr::NonNull;

// LAYERING: re-export `bun_core::Timespec` so every embedder of
// `EventLoopTimer.next` agrees on the type (was a local stub with the same
// `{sec,nsec}` layout, which forced higher tiers — `bun_runtime`, `bun_sql_jsc`
// — to convert at every assignment and risked silent layout drift).
use Timespec as timespec;
pub use bun_core::Timespec;

// Re-export so higher tiers see the *same* type they pass to
// `bun_io::heap::Intrusive<EventLoopTimer, _>` (was a zero-sized local stub
// in B-1, which made the real pairing-heap unusable — orphan rule blocked
// `impl HeapNode for EventLoopTimer` anywhere but here).
pub use bun_io::heap::IntrusiveField;

const NS_PER_MS: i64 = bun_core::time::NS_PER_MS as i64;

// ─── Hot-dispatch (link-time) ───────────────────────────────────────────────
// `EventLoopTimer` is per-tick hot. Low tier (this crate) keeps `Tag` + the
// intrusive heap node; the `match tag { … container_of … }` dispatch lives in
// `bun_runtime::dispatch` because it names ~20 high-tier container types.
//
// LAYERING: Zig has no crate split here — `EventLoopTimer.fire` calls each
// container directly. Rather than a runtime-registered fn-ptr (init-order
// hazard), the bodies are declared `extern "Rust"` and defined `#[no_mangle]`
// in `bun_runtime`; the linker resolves them. No `AtomicPtr`, no registration.
//
// PERF(port): was inline switch — `__bun_js_timer_epoch` sits on the
// heap-compare path. Phase B should denormalize `epoch` into `EventLoopTimer`
// to drop the cross-crate call if profiling shows it matters.
unsafe extern "Rust" {
    /// Runtime owns the tag→variant `match`; `vm` is an erased
    /// `*mut VirtualMachine`. Defined in `bun_runtime::dispatch`.
    ///
    /// SAFETY (genuine FFI precondition — NOT a `safe fn` candidate): impl
    /// derefs `t`/`now`, recovers the tier-6 container via `container_of`
    /// keyed on `(*t).tag`, and may free that container. Caller must pass a
    /// live timer just popped from `All.timers` and must not touch `t` after.
    fn __bun_fire_timer(t: *mut EventLoopTimer, now: *const timespec, vm: *mut ());
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
    pub tag: Tag,
    /// Internal heap fields.
    pub heap: IntrusiveField<EventLoopTimer>,
    pub in_heap: InHeap,
}

// Duck-typed `.heap` field access for `bun_io::heap::Intrusive`. Implemented
// here (the defining crate) so higher tiers can instantiate
// `Intrusive<EventLoopTimer, _>` without hitting the orphan rule.
impl bun_io::heap::HeapNode for EventLoopTimer {
    #[inline]
    fn heap(&mut self) -> &mut IntrusiveField<Self> {
        &mut self.heap
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum InHeap {
    #[default]
    None,
    Regular,
    Fake,
}

impl EventLoopTimer {
    pub fn init_paused(tag: Tag) -> Self {
        Self {
            next: timespec::EPOCH,
            state: State::PENDING,
            tag,
            heap: IntrusiveField::default(),
            in_heap: InHeap::None,
        }
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
                    // Zig epoch is `u25` so `-%` wraps mod 2^25. Rust stores it in a wider int,
                    // so we mask the wrapping_sub result to 25 bits to preserve that semantics.
                    // TODO(port): confirm Rust `epoch` field is masked to 25 bits on write too.
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
    /// PORT NOTE (b0): Zig `jsTimerInternalsFlags` did `@fieldParentPtr` into
    /// `TimeoutObject`/`ImmediateObject`/`AbortSignalTimeout` (all tier-6
    /// runtime types). The container_of dispatch lives in
    /// `bun_runtime::dispatch::__bun_js_timer_epoch` (link-time extern).
    /// Returns `None` for non-JS timer tags.
    #[inline]
    pub fn js_timer_epoch(&self) -> Option<u32> {
        // SAFETY: `self` is a live timer; the extern impl reads `tag` and
        // recovers the container via `offset_of`.
        unsafe { __bun_js_timer_epoch(self.tag, self) }
    }

    fn ns(&self) -> u64 {
        self.next.ns()
    }

    /// Fire the timer's callback.
    ///
    /// PORT NOTE (b0): the `match self.tag { … container_of … }` body was
    /// hot-dispatch over ~20 tier-6 variant types (Subprocess, DevServer,
    /// PostgresSQLConnection, …). That match lives in
    /// `bun_runtime::dispatch::__bun_fire_timer` (link-time extern). `vm` is
    /// the erased `*mut VirtualMachine`.
    ///
    /// PORT NOTE (noalias re-entrancy): takes `this: *mut Self`, NOT
    /// `&mut self`. `__bun_fire_timer` dispatches via container_of into a
    /// tier-6 timer object whose JS callback can re-enter and re-derive a
    /// `&mut EventLoopTimer` to *this same node* (e.g. `clearTimeout()` →
    /// `vm.timer.remove()` mutates `(*this).state`/`heap`). A live `&mut self`
    /// across that FFI call lets LLVM `noalias` dead-store the re-entrant
    /// write. Both callers (`drain_timers`, `get_timeout`) already hold a raw
    /// `*mut EventLoopTimer` popped from the heap — pass it directly.
    ///
    /// # Safety
    /// `this` is a live timer just popped from `All.timers`; `now` is the
    /// snapshot taken by `All::next`; `vm` is the per-thread VM. The handler
    /// may free the container — caller must not touch `this` after.
    pub unsafe fn fire(
        this: *mut Self,
        now: &timespec,
        vm: *mut (), /* SAFETY: erased *mut VirtualMachine */
    ) {
        // SAFETY: per fn contract.
        unsafe { __bun_fire_timer(this, now, vm) };
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Tag {
    TimerCallback,
    TimeoutObject,
    ImmediateObject,
    StatWatcherScheduler,
    UpgradedDuplex,
    DNSResolver,
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
}

impl Tag {
    // TODO(port): Zig `pub fn Type(comptime T: Tag) type` returns a type at comptime.
    // Rust has no value→type mapping. All call sites (`jsTimerInternalsFlags`, `fire`)
    // have been manually expanded above. If a generic mapping is needed in Phase B,
    // consider a trait `TagType<const T: Tag> { type Out; }` with per-variant impls.

    pub fn allow_fake_timers(self) -> bool {
        match self {
            Tag::WTFTimer // internal
            | Tag::BunTest // for test timeouts
            | Tag::EventLoopDelayMonitor // probably important
            | Tag::StatWatcherScheduler
            | Tag::CronJob // calendar-anchored to real wall clock
            => false,
            _ => true,
        }
    }
}

// PORT NOTE: `UnreachableTimer` in Zig only existed to give `Tag.Type()` a value for
// `WindowsNamedPipe` on non-Windows. With `fire()` expanded by hand, the non-Windows
// arm handles this inline (see above). Kept here for parity.
struct UnreachableTimer {
    event_loop_timer: EventLoopTimer,
}
impl UnreachableTimer {
    #[allow(dead_code)]
    fn callback(_: &mut UnreachableTimer, _: &mut UnreachableTimer) {
        // PORT NOTE: `bun.Environment.ci_assert` → `debug_assertions` (no `ci_assert` Cargo
        // feature in bun_event_loop; see ptr/ref_count.rs / runtime/timer/mod.rs for precedent).
        #[cfg(debug_assertions)]
        debug_assert!(false);
    }
}

pub struct TimerCallback {
    pub callback: fn(*mut TimerCallback),
    // TODO(port): lifetime — opaque user ctx, no init/deinit found in src/event_loop/
    pub ctx: Option<NonNull<c_void>>,
    pub event_loop_timer: EventLoopTimer,
}

/// Stamp out one `unsafe fn $method(*const EventLoopTimer) -> *mut Self` per
/// `(method => field)` pair: each recovers the embedding owner from a pointer
/// to the named intrusive [`EventLoopTimer`] slot — Rust's typed analogue of
/// Zig's inline `@fieldParentPtr("$field", t)`.
///
/// The accessor layer exists only as a cross-crate visibility shim: the
/// `__bun_fire_timer` tag-dispatch in `bun_runtime` cannot name private timer
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

crate::impl_timer_owner!(TimerCallback; from_timer_ptr => event_loop_timer);

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
/// `Flags` bitfield. Zig: `enum(u2)`.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind {
    SetTimeout = 0,
    SetInterval = 1,
    SetImmediate = 2,
}

impl Kind {
    /// Widen to the `u32`-repr [`KindBig`] used in [`ID`](Timer::ID) so the
    /// `{i32, u32}` pair `bitcast`s to a `u64` async-id. Zig: `Kind.big()`.
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
/// is exactly one pointer / `u64`. Zig: `Kind.Big = enum(u32)`.
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

/// Packed per-JS-timer state. Zig: `packed struct(u32)`. Layout (LSB→MSB):
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

// ported from: src/event_loop/EventLoopTimer.zig

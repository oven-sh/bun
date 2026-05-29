use core::ffi::c_void;
use core::ptr::NonNull;

use Timespec as timespec;
pub use bun_core::Timespec;

pub use bun_io::heap::IntrusiveField;

const NS_PER_MS: i64 = bun_core::time::NS_PER_MS as i64;

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
                    const U25_MAX: u32 = (1 << 25) - 1;
                    return (b_epoch.wrapping_sub(a_epoch) & U25_MAX) < U25_MAX / 2;
                }
            }
        }
        order == core::cmp::Ordering::Less
    }

    #[inline]
    pub fn js_timer_epoch(&self) -> Option<u32> {
        // SAFETY: `self` is a live timer; the extern impl reads `tag` and
        // recovers the container via `offset_of`.
        unsafe { __bun_js_timer_epoch(self.tag, self) }
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

pub struct TimerCallback {
    pub callback: fn(*mut TimerCallback),
    // TODO(port): lifetime — opaque user ctx, no init/deinit found in src/event_loop/
    pub ctx: Option<NonNull<c_void>>,
    pub event_loop_timer: EventLoopTimer,
}

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

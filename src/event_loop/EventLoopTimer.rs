use core::cell::Cell;

use bun_core::Timespec;
use bun_io::heap::{HeapNode, IntrusiveField};

const NS_PER_MS: i64 = bun_core::time::NS_PER_MS as i64;

unsafe extern "Rust" {
    /// Defined in `bun_runtime::jsc_hooks`.
    safe fn __bun_remove_timer(timer: &EventLoopTimer);
}

// `repr(C)` keeps `next` at offset 0: its address is the node's.
#[repr(C)]
pub struct EventLoopTimer {
    /// The absolute time to fire this timer next.
    pub next: Cell<Timespec>,
    heap: IntrusiveField<EventLoopTimer>,
    pub tag: Tag,
    pub state: Cell<State>,
    /// What `next` is measured on, and so which heap links the node.
    pub clock: Cell<Clock>,
    /// A `setTimeout()` without a delay in `bun test`. Its deadline is 1 ms away, as in Node, so its place among the
    /// timers is Node's. An event loop that would sleep until then runs it at once.
    pub is_due_when_idle: Cell<bool>,
    /// Set by every insert. Orders JS timers that are due in the same millisecond.
    pub epoch: Cell<u32>,
}

const _: () = assert!(size_of::<EventLoopTimer>() == 48);

impl HeapNode for EventLoopTimer {
    #[inline]
    fn heap(&self) -> &IntrusiveField<Self> {
        &self.heap
    }

    #[inline]
    fn less(&self, other: &Self) -> bool {
        let (a, b) = (self.next.get(), other.next.get());
        if a.sec != b.sec {
            return a.sec < b.sec;
        }
        let (a_is_js, b_is_js) = (self.tag.is_js_timer(), other.tag.is_js_timer());
        let whole_ms = |nsec: i64| NS_PER_MS * (nsec / NS_PER_MS);
        let a_ns = if a_is_js { whole_ms(a.nsec) } else { a.nsec };
        let b_ns = if b_is_js { whole_ms(b.nsec) } else { b.nsec };
        if a_ns != b_ns {
            return a_ns < b_ns;
        }
        // Only a fake `setImmediate` is ever in a heap. It runs before timeouts due at the same instant.
        if (self.tag == Tag::ImmediateObject) != (other.tag == Tag::ImmediateObject) {
            return self.tag == Tag::ImmediateObject;
        }
        // The epoch wraps: the earlier one is less than half the range behind.
        a_is_js && b_is_js && other.epoch.get().wrapping_sub(self.epoch.get()) < u32::MAX / 2
    }
}

/// An [`EventLoopTimer`] that leaves the heap when it drops.
#[repr(transparent)]
pub struct OwnedTimer(EventLoopTimer);

impl OwnedTimer {
    pub fn init_paused(tag: Tag) -> Self {
        Self(EventLoopTimer::init_paused(tag))
    }

    /// The pointer to link, with the provenance of `this`.
    pub const fn node(this: *const Self) -> *const EventLoopTimer {
        this.cast()
    }
}

impl core::ops::Deref for OwnedTimer {
    type Target = EventLoopTimer;

    fn deref(&self) -> &EventLoopTimer {
        &self.0
    }
}

impl Drop for OwnedTimer {
    fn drop(&mut self) {
        self.disarm();
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Clock {
    Real,
    /// `jest.useFakeTimers()`
    Fake,
}

impl EventLoopTimer {
    pub fn init_paused(tag: Tag) -> Self {
        Self {
            next: Cell::new(Timespec::EPOCH),
            state: Cell::new(State::PENDING),
            tag,
            heap: IntrusiveField::default(),
            clock: Cell::new(Clock::Real),
            is_due_when_idle: Cell::new(false),
            epoch: Cell::new(0),
        }
    }

    /// Unlinks an armed timer from the heap of this thread's VM. A `WTFTimer` is in another.
    pub fn disarm(&self) {
        if self.state.get() == State::ACTIVE {
            __bun_remove_timer(self);
        }
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
    FakeTimersTick,
    ViWait,
    /// An N-API addon's `uv_timer_t` (POSIX, where Bun emulates libuv).
    UvTimer,
    WorkerWaitsForRoom,
}

impl Tag {
    /// Due to the millisecond, and within one in the order of arming.
    #[inline]
    pub fn is_js_timer(self) -> bool {
        matches!(
            self,
            Tag::TimeoutObject | Tag::ImmediateObject | Tag::AbortSignalTimeout
        )
    }

    /// Runtime-internal timers that never settle anything the program waits on.
    pub fn is_housekeeping(self) -> bool {
        match self {
            Tag::WTFTimer
            | Tag::DevServerSweepSourceMaps
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

/// Stamp out one `unsafe fn $method(*const EventLoopTimer) -> *mut Self` per
/// `(method => field)` pair: each recovers the embedding owner from a pointer
/// to the named intrusive [`EventLoopTimer`] slot (typed container_of).
///
/// The accessor layer exists only as a cross-crate visibility shim: the
/// `fire_timer` tag-dispatch in `bun_runtime` cannot name private timer
/// fields on owners defined elsewhere, so each owner exports a named thunk per
/// slot. The input is `*const` (so `*mut` / `&mut` / `&` all coerce at the
/// call site); the field may be a bare `EventLoopTimer` or any
/// wrapper that starts with one, and may be
/// a field of a field (`timers.timer`).
///
/// ```ignore
/// bun_event_loop::impl_timer_owner!(JSMySQLConnection;
///     from_timer_ptr => timers.timer,
///     from_max_lifetime_timer_ptr => timers.max_lifetime_timer,
/// );
/// ```
#[macro_export]
macro_rules! impl_timer_owner {
    ($Owner:ty; $($method:ident => $($field:ident).+),+ $(,)?) => {
        impl $Owner {
            $(
                /// Recover `*mut Self` from a pointer to its intrusive
                #[doc = concat!("`", stringify!($($field).+), "` [`EventLoopTimer`] slot.")]
                /// # Safety
                #[doc = concat!("`t` must point at the `", stringify!($($field).+), "` field of a live `Self`.")]
                #[inline]
                pub unsafe fn $method(
                    t: *const $crate::EventLoopTimer::EventLoopTimer,
                ) -> *mut Self {
                    // SAFETY: caller contract — `t` addresses `Self.$field`
                    // with whole-`Self` provenance.
                    unsafe { ::bun_core::container_of(t, ::core::mem::offset_of!(Self, $($field).+)) }
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

    /// The timer is linked into a heap.
    ACTIVE,

    /// The timer has been cancelled and will not fire.
    CANCELLED,

    /// The heap has popped the timer.
    FIRED,
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_io::heap::Intrusive;

    const NS_PER_S: i64 = 1000 * NS_PER_MS;

    impl EventLoopTimer {
        fn due_at_ns(self, ns: i64) -> Self {
            let (sec, nsec) = (ns / NS_PER_S, ns % NS_PER_S);
            self.next.set(Timespec { sec, nsec });
            self
        }

        fn in_epoch(self, epoch: u32) -> Self {
            self.epoch.set(epoch);
            self
        }
    }

    fn armed_first(tag: Tag) -> EventLoopTimer {
        EventLoopTimer::init_paused(tag).in_epoch(1)
    }

    fn armed_second(tag: Tag) -> EventLoopTimer {
        EventLoopTimer::init_paused(tag).in_epoch(2)
    }

    #[track_caller]
    fn assert_fires_in_order(first: &EventLoopTimer, second: &EventLoopTimer) {
        assert_eq!((first.less(second), second.less(first)), (true, false));
    }

    #[test]
    fn the_earlier_deadline_is_first() {
        for tag in [Tag::TimeoutObject, Tag::BunTest] {
            for boundary in [NS_PER_MS, NS_PER_S] {
                assert_fires_in_order(
                    &armed_second(tag).due_at_ns(boundary - 1),
                    &armed_first(tag).due_at_ns(boundary),
                );
            }
        }
        assert_fires_in_order(
            &armed_second(Tag::TimeoutObject).due_at_ns(0),
            &armed_first(Tag::ImmediateObject).due_at_ns(NS_PER_MS),
        );
    }

    #[test]
    fn only_js_deadlines_are_cut_to_the_millisecond() {
        assert_fires_in_order(
            &armed_second(Tag::BunTest).due_at_ns(1),
            &armed_first(Tag::BunTest).due_at_ns(2),
        );
        assert_fires_in_order(
            &armed_second(Tag::TimeoutObject).due_at_ns(NS_PER_MS - 1),
            &armed_first(Tag::BunTest).due_at_ns(1),
        );
    }

    #[test]
    fn an_immediate_wins_a_tie() {
        for tag in [Tag::TimeoutObject, Tag::AbortSignalTimeout, Tag::CronJob] {
            assert_fires_in_order(&armed_second(Tag::ImmediateObject), &armed_first(tag));
        }
    }

    #[test]
    fn js_timers_tie_in_the_order_of_arming() {
        for epoch in [0, u32::MAX] {
            for armed_between in [1, 1 << 23, 1 << 24, (1 << 31) - 2] {
                assert_fires_in_order(
                    &armed_first(Tag::TimeoutObject).due_at_ns(5).in_epoch(epoch),
                    &armed_second(Tag::AbortSignalTimeout)
                        .in_epoch(epoch.wrapping_add(armed_between)),
                );
            }
        }
    }

    #[test]
    fn a_js_timer_and_another_timer_tie_in_no_order() {
        let (js, other) = (armed_first(Tag::TimeoutObject), armed_second(Tag::CronJob));
        assert_eq!((js.less(&other), other.less(&js)), (false, false));
    }

    #[test]
    fn iter_visits_what_is_linked_and_pops_are_ordered() {
        let mut seed = 1u32;
        let mut random = move |below: usize| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 8) as usize % below
        };
        let nodes: Vec<_> = (0..40)
            .map(|i| armed_first(Tag::TimeoutObject).in_epoch(i))
            .map(|node| node.due_at_ns(random(4) as i64 * NS_PER_S))
            .collect();
        let heap = Intrusive::<EventLoopTimer>::default();
        // SAFETY: `nodes` outlives `heap`, and `state` says which of them are linked.
        unsafe {
            for _ in 0..200 {
                let node = &nodes[random(nodes.len())];
                let ptr = core::ptr::from_ref(node).cast_mut();
                if node.state.get() != State::ACTIVE {
                    heap.insert(ptr);
                    node.state.set(State::ACTIVE);
                } else if random(2) == 0 {
                    heap.remove(ptr);
                    node.state.set(State::CANCELLED);
                } else if random(2) == 0 {
                    (*heap.delete_min()).state.set(State::FIRED);
                }
                let mut visited: Vec<_> = heap.iter().map(|node| (*node).epoch.get()).collect();
                visited.sort_unstable();
                let linked = nodes
                    .iter()
                    .filter(|node| node.state.get() == State::ACTIVE);
                assert!(linked.map(|node| node.epoch.get()).eq(visited));
            }
            let popped: Vec<_> = core::iter::from_fn(|| heap.delete_min().as_ref()).collect();
            assert!(popped.len() > 1 && popped.is_sorted_by(|a, b| a.less(b)));
        }
    }
}

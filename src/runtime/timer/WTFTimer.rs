//! `WTFTimer` — a timer created by WTF (WebKit) code and invoked by Bun's
//! event loop. Backs `WTF::RunLoop::TimerBase` on the Bun runloop.

use core::cell::Cell;
use core::marker::PhantomPinned;
use core::pin::Pin;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};
use std::sync::Arc;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::heap::{HeapNode, Intrusive, IntrusiveField};
use bun_ptr::AliasableBox;
use bun_threading::Guarded;
use bun_threading::guarded::GuardedLock;

use crate::jsc::virtual_machine::VirtualMachine;

const NS_PER_S: i64 = bun_core::time::NS_PER_S as i64;

bun_opaque::opaque_ffi! {
    /// This is `WTF::RunLoop::TimerBase` from WebKit — opaque FFI handle.
    pub(crate) struct RunLoopTimer;
}

impl RunLoopTimer {
    /// Takes `NonNull` (not `&self`) so callers holding the raw FFI handle
    /// don't need an `unsafe { as_ref() }` just to forward it — `NonNull<T>`
    /// is ABI-identical to `*mut T` and the extern is `safe fn`.
    #[inline]
    fn fire(this: NonNull<RunLoopTimer>) {
        WTFTimer__fire(this)
    }
}

/// A timer created by WTF code and invoked by Bun's event loop. Any thread can arm it, and it can outlive its VM.
pub(crate) struct WTFTimer {
    // FFI handle into WebKit's RunLoop::TimerBase; owned by C++.
    run_loop_timer: NonNull<RunLoopTimer>,
    timers: Arc<Guarded<WTFTimerHeap>>,
    /// `Some` while in `timers`, whose lock guards this and `heap`.
    next: Cell<Option<Timespec>>,
    heap: IntrusiveField<WTFTimer>,
    // Backref into `vm.eventLoop().imminent_gc_timer`. Low tier stores
    // `AtomicPtr<()>` (PORTING.md §Dispatch); `self` is cast to `*mut ()` at
    // each compare_exchange (the hook in `dispatch.rs` casts back to
    // `*mut WTFTimer`).
    imminent: bun_ptr::BackRef<AtomicPtr<()>>,
    _pin: PhantomPinned,
}

impl HeapNode for WTFTimer {
    fn heap(&self) -> &IntrusiveField<Self> {
        &self.heap
    }

    fn less(&self, other: &Self) -> bool {
        matches!((self.next.get(), other.next.get()), (Some(a), Some(b)) if b.greater(&a))
    }
}

/// The armed [`WTFTimer`]s of a VM.
pub(super) struct WTFTimerHeap {
    /// Each is pinned, and leaves when it drops.
    timers: Intrusive<WTFTimer>,
    /// The event loop that `WTFTimer::imminent` points into goes with the VM.
    pub(super) is_vm_gone: bool,
    #[cfg(windows)]
    js_thread: std::thread::ThreadId,
}

// SAFETY: its lock guards `next` and `heap` of each timer. The only VM state that a timer reaches is `imminent`, see `is_vm_gone`.
unsafe impl Send for WTFTimerHeap {}

impl WTFTimerHeap {
    pub(super) fn init() -> Self {
        Self {
            timers: Intrusive::default(),
            is_vm_gone: false,
            #[cfg(windows)]
            js_thread: std::thread::current().id(),
        }
    }

    fn first(&self) -> Option<&WTFTimer> {
        // SAFETY: see the field. Dropping the timer waits for the lock that this borrow holds.
        unsafe { self.timers.peek().as_ref() }
    }

    #[cfg(windows)]
    pub(super) fn first_deadline(&self) -> Option<Timespec> {
        self.first()?.next.get()
    }

    /// Fires the timers that are due, and returns the next deadline.
    pub(super) fn drain_due(
        this: &Guarded<Self>,
        maybe_now: &mut Option<Timespec>,
    ) -> Option<Timespec> {
        loop {
            let run_loop_timer = {
                let heap = this.lock();
                let first = heap.first()?;
                let next = first.next.get()?;
                let now = *maybe_now
                    .get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
                if next.greater(&now) {
                    return Some(next);
                }
                // SAFETY: see `WTFTimerHeap::timers`.
                unsafe { heap.timers.delete_min() };
                first.next.set(None);
                first.clear_imminent();
                first.run_loop_timer
            };
            RunLoopTimer::fire(run_loop_timer);
        }
    }
}

impl WTFTimer {
    fn arm(self: Pin<&Self>, time: Timespec) {
        let heap = self.lock_and_cancel();
        self.next.set(Some(time));
        // SAFETY: not in the heap. It is pinned, and `drop` disarms it.
        unsafe { heap.timers.insert(ptr::from_ref(self.get_ref()).cast_mut()) };
        #[cfg(windows)]
        if !heap.is_vm_gone && heap.js_thread == std::thread::current().id() {
            drop(heap);
            crate::jsc_hooks::timer_all().ensure_uv_timer();
        }
    }

    fn lock_and_disarm(&self) -> GuardedLock<'_, WTFTimerHeap> {
        let heap = self.timers.lock();
        if self.next.get().is_some() {
            // SAFETY: `next` says that it is in the heap.
            unsafe { heap.timers.remove(ptr::from_ref(self).cast_mut()) };
            self.next.set(None);
        }
        heap
    }

    fn lock_and_cancel(&self) -> GuardedLock<'_, WTFTimerHeap> {
        let heap = self.lock_and_disarm();
        if !heap.is_vm_gone {
            self.clear_imminent();
        }
        heap
    }

    fn as_opaque(&self) -> *mut () {
        ptr::from_ref(self).cast_mut().cast()
    }

    /// Only if this timer was the one that set it.
    fn clear_imminent(&self) {
        let _ = self.imminent.compare_exchange(
            self.as_opaque(),
            ptr::null_mut(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    /// Fire the underlying `RunLoop::TimerBase`,
    /// removing `self` from the timer heap first if it's currently scheduled.
    /// Reached from `bun_jsc::event_loop` via `__bun_run_wtf_timer`
    /// (definer in [`crate::dispatch`]).
    ///
    /// # Safety
    /// `this` was published by [`WTFTimer::update`] into
    /// `imminent_gc_timer` and remains live until it fires, which may free it.
    pub(crate) unsafe fn run(this: *const Self) {
        // SAFETY: per fn contract — `this` is live.
        let run_loop_timer = unsafe {
            drop((*this).lock_and_disarm());
            (*this).run_loop_timer
        };
        RunLoopTimer::fire(run_loop_timer);
    }

    #[bun_uws::uws_callback(export = "WTFTimer__isActive", no_catch)]
    pub(crate) fn is_active(&self) -> bool {
        let heap = self.timers.lock();
        self.next.get().is_some()
            || (!heap.is_vm_gone && self.imminent.load(Ordering::SeqCst) == self.as_opaque())
    }

    #[bun_uws::uws_callback(export = "WTFTimer__secondsUntilTimer", no_catch)]
    pub(crate) fn seconds_until_timer(&self) -> f64 {
        let _heap = self.timers.lock();
        if let Some(next) = self.next.get() {
            let until = next.duration(&Timespec::now(TimespecMockMode::ForceRealTime));
            let sec = until.sec as f64;
            let nsec = until.nsec as f64;
            return sec + nsec / NS_PER_S as f64;
        }
        f64::INFINITY
    }

    /// # Safety
    /// Unless `seconds` is positive, the `VirtualMachine` that the timer was created in is not freed yet.
    unsafe fn update(self: Pin<&Self>, seconds: f64) {
        // There's only one of these per VM, and each VM has its own imminent_gc_timer.
        // Only set imminent if it's not already set to avoid overwriting another timer.
        if seconds.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
            let _ = self.imminent.compare_exchange(
                ptr::null_mut(),
                self.as_opaque(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            );
            return;
        }

        // seconds can be +inf: JSC's GC scheduler divides by gcTimeSlice, which is 0 whenever
        // bytes*deathRate truncates to 0. Other WTF::RunLoop backends saturate Seconds→int;
        // do the same so the float→int cast below can't overflow.
        let clamped = seconds.min(i32::MAX as f64);

        let ipart = clamped.trunc();
        let fpart = clamped - ipart;
        let mut interval = Timespec::now(TimespecMockMode::ForceRealTime);
        interval.sec += ipart as i64;
        interval.nsec += (fpart * NS_PER_S as f64) as i64;
        if interval.nsec >= NS_PER_S {
            interval.sec += 1;
            interval.nsec -= NS_PER_S;
        }

        self.arm(interval);
    }

    #[bun_uws::uws_callback(export = "WTFTimer__cancel", no_catch)]
    pub(crate) fn cancel(&self) {
        drop(self.lock_and_cancel());
    }
}

impl Drop for WTFTimer {
    fn drop(&mut self) {
        self.cancel();
    }
}

/// A `WTF::RunLoop` timer on this thread, backed by this thread's event loop. Null when the thread has no Bun
/// `VirtualMachine` or no `RuntimeState` (a `JSC::VM` on a bundler thread generating bytecode, say): the timer then
/// never fires, which `RunLoop::TimerBase` accepts.
#[unsafe(no_mangle)]
extern "C" fn WTFTimer__create(
    run_loop_timer: NonNull<RunLoopTimer>,
) -> Option<AliasableBox<WTFTimer>> {
    let vm = VirtualMachine::get_or_null()?;
    Some(AliasableBox::new(WTFTimer {
        run_loop_timer,
        timers: Arc::clone(&crate::jsc_hooks::try_timer_all()?.wtf_timers),
        next: Cell::new(None),
        heap: IntrusiveField::default(),
        imminent: bun_ptr::BackRef::new(&vm.event_loop().imminent_gc_timer),
        _pin: PhantomPinned,
    }))
}

/// # Safety
/// As [`WTFTimer::update`].
#[unsafe(no_mangle)]
unsafe extern "C" fn WTFTimer__update(this: Pin<&WTFTimer>, seconds: f64, _repeat: bool) {
    // SAFETY: per fn contract.
    unsafe { this.update(seconds) };
}

#[unsafe(no_mangle)]
extern "C" fn WTFTimer__deinit(this: AliasableBox<WTFTimer>) {
    drop(this);
}

unsafe extern "C" {
    safe fn WTFTimer__fire(this: NonNull<RunLoopTimer>);
}

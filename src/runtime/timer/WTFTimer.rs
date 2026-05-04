use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::Timespec;
use bun_jsc::VirtualMachine;
use bun_threading::Mutex;

use crate::api::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use crate::webcore::script_execution_context::Identifier as ScriptExecutionContextIdentifier;

const NS_PER_S: i64 = 1_000_000_000;

/// This is WTF::RunLoop::TimerBase from WebKit
#[repr(C)]
pub struct RunLoopTimer {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

impl RunLoopTimer {
    pub fn fire(this: *mut RunLoopTimer) {
        // SAFETY: `this` is a valid WTF::RunLoop::TimerBase* handed to us by WebKit.
        unsafe { WTFTimer__fire(this) }
    }
}

/// A timer created by WTF code and invoked by Bun's event loop
pub struct WTFTimer {
    // TODO(port): lifetime — backref to the owning VirtualMachine; never owned here.
    vm: NonNull<VirtualMachine>,
    // FFI handle into WebKit's RunLoop::TimerBase; owned by C++.
    run_loop_timer: NonNull<RunLoopTimer>,
    event_loop_timer: EventLoopTimer,
    // TODO(port): lifetime — backref into `vm.eventLoop().imminent_gc_timer`.
    imminent: NonNull<AtomicPtr<WTFTimer>>,
    repeat: bool,
    lock: Mutex,
    script_execution_context_id: ScriptExecutionContextIdentifier,
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__runIfImminent(vm: *mut VirtualMachine) {
    // SAFETY: caller (C++) guarantees `vm` is the live VirtualMachine for this thread.
    unsafe { (*vm).event_loop().run_imminent_gc_timer() };
}

impl WTFTimer {
    pub fn run(&mut self, vm: &mut VirtualMachine) {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            vm.timer.remove(&mut self.event_loop_timer);
        }
        self.run_without_removing();
    }

    #[inline]
    fn run_without_removing(&self) {
        RunLoopTimer::fire(self.run_loop_timer.as_ptr());
    }

    pub fn update(&mut self, seconds: f64, repeat: bool) {
        // There's only one of these per VM, and each VM has its own imminent_gc_timer
        // Only set imminent if it's not already set to avoid overwriting another timer
        if !(seconds > 0.0) {
            let self_ptr = self as *mut WTFTimer;
            // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
            let _ = unsafe { self.imminent.as_ref() }
                .compare_exchange(ptr::null_mut(), self_ptr, Ordering::SeqCst, Ordering::SeqCst);
            return;
        }
        // Clear imminent if this timer was the one that set it
        let self_ptr = self as *mut WTFTimer;
        // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
        let _ = unsafe { self.imminent.as_ref() }
            .compare_exchange(self_ptr, ptr::null_mut(), Ordering::SeqCst, Ordering::SeqCst);

        // seconds can be +inf: JSC's GC scheduler divides by gcTimeSlice, which is 0 whenever
        // bytes*deathRate truncates to 0. Other WTF::RunLoop backends saturate Seconds→int;
        // do the same so the float→int cast below can't overflow.
        let clamped = seconds.min(i32::MAX as f64);

        let ipart = clamped.trunc();
        let fpart = clamped - ipart;
        // TODO(port): confirm `Timespec::now` API for the `.force_real_time` clock source.
        let mut interval = Timespec::now_force_real_time();
        interval.sec += ipart as i64;
        interval.nsec += (fpart * NS_PER_S as f64) as i64;
        if interval.nsec >= NS_PER_S {
            interval.sec += 1;
            interval.nsec -= NS_PER_S;
        }

        // SAFETY: `vm` is a backref to the VirtualMachine that owns this timer's lifetime.
        unsafe { self.vm.as_mut() }.timer.update(&mut self.event_loop_timer, &interval);
        self.repeat = repeat;
    }

    pub fn cancel(&mut self) {
        let _guard = self.lock.lock();

        if self.script_execution_context_id.valid() {
            // Only clear imminent if this timer was the one that set it
            let self_ptr = self as *mut WTFTimer;
            // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
            let _ = unsafe { self.imminent.as_ref() }
                .compare_exchange(self_ptr, ptr::null_mut(), Ordering::SeqCst, Ordering::SeqCst);

            if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
                // SAFETY: `vm` is a backref to the VirtualMachine that owns this timer's lifetime.
                unsafe { self.vm.as_mut() }.timer.remove(&mut self.event_loop_timer);
            }
        }
    }

    pub fn fire(&mut self, _now: &Timespec, _vm: &mut VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        // Only clear imminent if this timer was the one that set it
        let self_ptr = self as *mut WTFTimer;
        // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
        let _ = unsafe { self.imminent.as_ref() }
            .compare_exchange(self_ptr, ptr::null_mut(), Ordering::SeqCst, Ordering::SeqCst);
        self.run_without_removing();
    }
}

impl Drop for WTFTimer {
    fn drop(&mut self) {
        // Zig `deinit` = cancel() then bun.destroy(this); the free is handled by Box::from_raw
        // at the FFI boundary (WTFTimer__deinit).
        self.cancel();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__create(run_loop_timer: *mut RunLoopTimer) -> *mut c_void {
    if VirtualMachine::is_bundler_thread_for_bytecode_cache() {
        return ptr::null_mut();
    }

    let vm = VirtualMachine::get();

    // SAFETY: `vm` is the thread-local VirtualMachine; `run_loop_timer` is non-null per caller
    // contract; `event_loop().imminent_gc_timer` lives as long as the VM.
    let this = unsafe {
        let vm_ref = &mut *vm;
        Box::new(WTFTimer {
            vm: NonNull::new_unchecked(vm),
            imminent: NonNull::from(&vm_ref.event_loop().imminent_gc_timer),
            event_loop_timer: EventLoopTimer {
                next: Timespec {
                    sec: i64::MAX,
                    nsec: 0,
                },
                tag: EventLoopTimerTag::WTFTimer,
                state: EventLoopTimerState::CANCELLED,
                // TODO(port): EventLoopTimer may have additional defaulted fields.
                ..Default::default()
            },
            run_loop_timer: NonNull::new_unchecked(run_loop_timer),
            repeat: false,
            script_execution_context_id: ScriptExecutionContextIdentifier::from_raw(
                vm_ref.initial_script_execution_context_identifier,
            ),
            lock: Mutex::default(),
        })
    };

    Box::into_raw(this) as *mut c_void
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__update(this: *mut WTFTimer, seconds: f64, repeat: bool) {
    // SAFETY: `this` was produced by WTFTimer__create and is exclusively accessed here.
    unsafe { (*this).update(seconds, repeat) };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__deinit(this: *mut WTFTimer) {
    // SAFETY: `this` was produced by Box::into_raw in WTFTimer__create; reclaiming ownership.
    drop(unsafe { Box::from_raw(this) });
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__isActive(this: *const WTFTimer) -> bool {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    let this_ref = unsafe { &*this };
    if this_ref.event_loop_timer.state == EventLoopTimerState::ACTIVE {
        return true;
    }
    // SAFETY: `imminent` points into the VM's event loop, which outlives this timer.
    let loaded = unsafe { this_ref.imminent.as_ref() }.load(Ordering::SeqCst);
    // Zig: `(load orelse return false) == this` — null can never equal `this`, so a single
    // pointer compare suffices.
    loaded as *const WTFTimer == this
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__cancel(this: *mut WTFTimer) {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    unsafe { (*this).cancel() };
}

#[unsafe(no_mangle)]
pub extern "C" fn WTFTimer__secondsUntilTimer(this: *mut WTFTimer) -> f64 {
    // SAFETY: `this` is a live WTFTimer per caller contract.
    let this_ref = unsafe { &mut *this };
    let _guard = this_ref.lock.lock();
    if this_ref.event_loop_timer.state == EventLoopTimerState::ACTIVE {
        // TODO(port): confirm `Timespec::now` API for the `.force_real_time` clock source.
        let until = this_ref
            .event_loop_timer
            .next
            .duration(&Timespec::now_force_real_time());
        let sec = until.sec as f64;
        let nsec = until.nsec as f64;
        return sec + nsec / NS_PER_S as f64;
    }
    f64::INFINITY
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn WTFTimer__fire(this: *mut RunLoopTimer);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/WTFTimer.zig (151 lines)
//   confidence: medium
//   todos:      5
//   notes:      LIFETIMES.tsv had no rows; vm/imminent/run_loop_timer kept as NonNull backrefs. Timespec::now(.force_real_time), EventLoopTimer field init, and bun_threading::Mutex API are guessed — Phase B must verify.
// ──────────────────────────────────────────────────────────────────────────

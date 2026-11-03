//! What Python needs of the event loop: to be called when a descriptor is readable or a time has come, to turn the loop
//! while Python code waits, and to be woken. The C++ half is `src/jsc/bindings/python/BunPythonEventLoop.cpp`.

use core::ffi::{c_int, c_void};
use core::sync::atomic::Ordering;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::KeepAlive;
use bun_jsc::JSGlobalObject;
use bun_jsc::runtime_transpiler_cache::RuntimeTranspilerCache;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_options_types::global_cache::GlobalCache;

use crate::jsc_hooks::{runtime_state, runtime_state_of, timer_all_mut};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

unsafe extern "C" {
    /// Runs Python and JS code. Leaves no exception pending.
    fn Bun__Python__eventHappened(context: *mut c_void);
    /// The same.
    safe fn Bun__Python__makeCallsOwed(global: &JSGlobalObject);
}

/// Where the compiled code of the modules inside the executable is kept. The length of what was written; 0: nowhere.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__cacheDirectory(buffer: *mut u8, capacity: usize) -> usize {
    let mut path = bun_paths::path_buffer_pool::get();
    let len = RuntimeTranspilerCache::python_cache_dir(&mut path);
    if len == 0 || len > capacity {
        return 0;
    }
    // SAFETY: the caller owns `capacity` writable bytes at `buffer`.
    unsafe { core::ptr::copy_nonoverlapping(path.as_ptr(), buffer, len) };
    len
}

/// Any thread, and signal handlers.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__callsAreOwed(vm: *mut VirtualMachine) {
    // SAFETY: the VM, its state and its event loop outlive the JSC VM that calls this; `wakeup` is one async-signal-safe write.
    unsafe {
        (*runtime_state_of(vm))
            .python_calls_are_owed
            .store(true, Ordering::Release);
        (*(*vm).event_loop()).wakeup();
    }
}

/// Between turns of the event loop there is no Python code to poll for what the collector and signal handlers queue.
pub(crate) fn make_calls_owed(vm: &VirtualMachine) {
    // SAFETY: the JS thread of a VM that is running has its state.
    let are_owed = unsafe { &(*runtime_state()).python_calls_are_owed };
    if are_owed.load(Ordering::Relaxed) && are_owed.swap(false, Ordering::Acquire) {
        let _scope = vm.enter_event_loop_scope();
        Bun__Python__makeCallsOwed(vm.global());
    }
}

/// While Python imports a JavaScript module the resolver fetches nothing from a registry: a name that Python code tries to
/// import may be a module that is merely optional, or a typing error. Returns what `Bun__Python__restoreAutoInstall` takes.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__disableAutoInstall(global: &JSGlobalObject) -> u8 {
    // SAFETY: the JS thread, and nothing borrows the resolver's options across this call.
    let options = unsafe { &mut (*global.bun_vm_ptr()).transpiler.resolver.opts };
    core::mem::replace(&mut options.global_cache, GlobalCache::disable) as u8
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Python__restoreAutoInstall(global: &JSGlobalObject, previous: u8) {
    const ALL: [GlobalCache; 6] = [
        GlobalCache::allow_install,
        GlobalCache::read_only,
        GlobalCache::auto,
        GlobalCache::force,
        GlobalCache::fallback,
        GlobalCache::disable,
    ];
    let previous = ALL
        .into_iter()
        .find(|&mode| mode as u8 == previous)
        .unwrap_or(GlobalCache::disable);
    // SAFETY: as above.
    unsafe { (*global.bun_vm_ptr()).transpiler.resolver.opts.global_cache = previous };
}

/// One turn: what is ready runs, and if that was nothing, the thread sleeps until something is. False: the VM is stopping.
#[unsafe(no_mangle)]
extern "C" fn Bun__Python__turnEventLoop(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    if vm.jsc_vm().execution_forbidden()
        || !vm.script_allowed()
        || global.has_pending_termination_exception()
    {
        return false;
    }
    // SAFETY: the JS thread's event loop; nothing else borrows it across this call.
    let event_loop = unsafe { &mut *vm.event_loop() };
    event_loop.tick();
    event_loop.auto_tick_asleep();
    true
}

pub(crate) struct PythonTimer {
    pub(crate) event_loop_timer: EventLoopTimer,
    context: *mut c_void,
    keep_alive: KeepAlive,
}

impl PythonTimer {
    /// # Safety
    /// `this` is an armed timer that the heap has just popped, on the JS thread.
    pub(crate) unsafe fn on_fire(this: *mut PythonTimer, vm: &VirtualMachine) {
        // SAFETY: fn contract.
        let context = unsafe {
            (*this).event_loop_timer.state = EventLoopTimerState::FIRED;
            (*this).keep_alive.unref(vm.loop_ctx());
            (*this).context
        };
        let _scope = vm.enter_event_loop_scope();
        // SAFETY: C++ destroys the timer before it frees `context`. It may destroy `this` in the call.
        unsafe { Bun__Python__eventHappened(context) };
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Python__Timer__create(context: *mut c_void) -> *mut PythonTimer {
    bun_core::heap::into_raw(Box::new(PythonTimer {
        event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::PythonTimer),
        context,
        keep_alive: KeepAlive::init(),
    }))
}

/// Arms the timer, or arms it anew.
///
/// # Safety
/// `this` is from `Bun__Python__Timer__create`; JS thread.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Python__Timer__set(
    this: *mut PythonTimer,
    global: &JSGlobalObject,
    nanoseconds: i64,
    keeps_loop_alive: bool,
) {
    const NS_PER_S: i64 = 1_000_000_000;
    let now = Timespec::now(TimespecMockMode::ForceRealTime);
    let nanoseconds = nanoseconds.max(0);
    let nsec = now.nsec + nanoseconds % NS_PER_S;
    let due = Timespec {
        sec: now
            .sec
            .saturating_add(nanoseconds / NS_PER_S + nsec / NS_PER_S),
        nsec: nsec % NS_PER_S,
    };
    // SAFETY: fn contract.
    unsafe {
        timer_all_mut().update(&raw mut (*this).event_loop_timer, &due);
        if keeps_loop_alive {
            (*this).keep_alive.ref_(global.bun_vm().loop_ctx());
        } else {
            (*this).keep_alive.unref(global.bun_vm().loop_ctx());
        }
    }
}

/// # Safety
/// As `Bun__Python__Timer__set`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Python__Timer__cancel(this: *mut PythonTimer, global: &JSGlobalObject) {
    // SAFETY: fn contract.
    unsafe {
        let event_loop_timer = &raw mut (*this).event_loop_timer;
        if (*event_loop_timer).state == EventLoopTimerState::ACTIVE {
            timer_all_mut().remove(event_loop_timer);
        }
        (*this).keep_alive.unref(global.bun_vm().loop_ctx());
    }
}

/// # Safety
/// As `Bun__Python__Timer__set`, and `this` is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Python__Timer__destroy(this: *mut PythonTimer, global: &JSGlobalObject) {
    // SAFETY: fn contract.
    unsafe {
        Bun__Python__Timer__cancel(this, global);
        bun_core::heap::destroy(this);
    }
}

#[cfg(not(windows))]
pub(crate) use posix::FdWatcher;

#[cfg(not(windows))]
mod posix {
    use super::*;
    use bun_io::posix_event_loop::{FilePoll, Flags, Owner, poll_tag};
    use bun_sys::Fd;

    pub(crate) struct FdWatcher {
        poll: *mut FilePoll,
        context: *mut c_void,
    }

    impl FdWatcher {
        /// # Safety
        /// `this` is the owner of the poll being dispatched, on the JS thread.
        pub(crate) unsafe fn on_poll(this: *mut FdWatcher) {
            // SAFETY: fn contract.
            let context = unsafe { (*this).context };
            let _scope = VirtualMachine::get().enter_event_loop_scope();
            // SAFETY: C++ destroys the watcher before it frees `context`. It may destroy `this` in the call.
            unsafe { Bun__Python__eventHappened(context) };
        }
    }

    /// Null: the descriptor cannot be watched, and `errno` says why.
    #[unsafe(no_mangle)]
    extern "C" fn Bun__Python__FdWatcher__create(
        global: &JSGlobalObject,
        fd: c_int,
        context: *mut c_void,
        keeps_loop_alive: bool,
        errno: &mut c_int,
    ) -> *mut FdWatcher {
        let ctx = global.bun_vm().loop_ctx();
        let this = bun_core::heap::into_raw(Box::new(FdWatcher {
            poll: core::ptr::null_mut(),
            context,
        }));
        let poll = FilePoll::init(
            ctx,
            Fd::from_native(fd),
            Default::default(),
            Owner::new(poll_tag::PYTHON_FD_WATCHER, this.cast()),
        );
        // SAFETY: `poll` is the fresh hive slot, `this` the fresh box; `platform_event_loop` is the live uws loop.
        unsafe {
            (*this).poll = poll;
            if keeps_loop_alive {
                (*poll).enable_keeping_process_alive(ctx);
            }
            if let Err(error) = (*poll).register(ctx.platform_event_loop(), Flags::Readable, false)
            {
                (*poll).deinit();
                bun_core::heap::destroy(this);
                *errno = c_int::from(error.errno);
                return core::ptr::null_mut();
            }
        }
        this
    }

    /// # Safety
    /// `this` is from `Bun__Python__FdWatcher__create`; JS thread.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__Python__FdWatcher__setKeepsLoopAlive(
        this: *mut FdWatcher,
        global: &JSGlobalObject,
        keeps_loop_alive: bool,
    ) {
        let ctx = global.bun_vm().loop_ctx();
        // SAFETY: fn contract.
        unsafe {
            if keeps_loop_alive {
                (*(*this).poll).enable_keeping_process_alive(ctx);
            } else {
                (*(*this).poll).disable_keeping_process_alive(ctx);
            }
        }
    }

    /// The descriptor must still be open.
    ///
    /// # Safety
    /// As `Bun__Python__FdWatcher__setKeepsLoopAlive`, and `this` is not used again.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn Bun__Python__FdWatcher__destroy(this: *mut FdWatcher) {
        // SAFETY: fn contract. A poll freed while it is being dispatched is only put back once the dispatch is over.
        unsafe {
            (*(*this).poll).deinit();
            bun_core::heap::destroy(this);
        }
    }
}

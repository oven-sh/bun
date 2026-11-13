//! The thread that runs every `Bun.build()` of the process, one at a time.

use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use bun_core::{Output, zstr};
use bun_io::Waker;
use bun_jsc::Ticket;
use bun_threading::Guarded;

use super::{JSBundleCompletionTask, JsSide};

type Queued = (Box<JSBundleCompletionTask>, Ticket);

struct State {
    /// `None` until the thread runs. If it fails to start, the next build tries again.
    waker: Option<&'static Waker>,
    queue: VecDeque<Queued>,
    /// The address of the `JsSide` of the build that the thread took last.
    started: usize,
}

static STATE: Guarded<State> = Guarded::new(State {
    waker: None,
    queue: VecDeque::new(),
    started: 0,
});

/// Of `State::started`, and written under the same lock.
pub(super) static CANCELLED: AtomicBool = AtomicBool::new(false);

/// The thread's uws loop, in which a build waits for its plugins.
pub(super) static UWS_LOOP: AtomicPtr<bun_uws::Loop> = AtomicPtr::new(core::ptr::null_mut());

pub(super) fn enqueue(task: Box<JSBundleCompletionTask>, ticket: Ticket) {
    // The lock also blocks other callers until the thread is created.
    let mut state = STATE.lock();
    match state.waker.map_or_else(spawn, Ok) {
        Ok(waker) => {
            state.waker = Some(waker);
            state.queue.push_back((task, ticket));
            drop(state);
            waker.wake();
        }
        Err(err) => {
            drop(state);
            task.fail_to_start(&err, &ticket);
        }
    }
}

pub(super) fn take_unstarted(js: *mut JsSide) -> Option<Queued> {
    let mut state = STATE.lock();
    let index = (state.queue.iter()).rposition(|(task, _)| task.js.as_ptr() == js)?;
    state.queue.remove(index)
}

pub(super) fn cancel_if_started(js: &JsSide) {
    let state = STATE.lock();
    if state.started != core::ptr::from_ref(js).addr() {
        return;
    }
    CANCELLED.store(true, Ordering::SeqCst);
    let uws_loop = UWS_LOOP.load(Ordering::SeqCst);
    if !uws_loop.is_null() {
        // SAFETY: the loop of a thread that never exits; wakeup is thread-safe.
        unsafe { bun_uws::us_wakeup_loop(uws_loop) };
    }
}

fn start_next() -> Option<Queued> {
    let mut state = STATE.lock();
    let next = state.queue.pop_front()?;
    state.started = next.0.js.as_ptr().addr();
    CANCELLED.store(false, Ordering::SeqCst);
    Some(next)
}

fn spawn() -> std::io::Result<&'static Waker> {
    let started = Arc::new(OnceLock::new());
    let report = Arc::clone(&started);
    std::thread::Builder::new()
        .name("Bundler".into())
        .spawn(move || {
            Output::Source::configure_named_thread(zstr!("Bundler"));
            // On Windows the waker is this thread's libuv loop, so create it here.
            let waker = Waker::init().map(|waker| &*Box::leak(Box::new(waker)));
            let _ = report.set(waker);
            drop(report);
            if let Ok(waker) = waker {
                thread_main(waker);
            }
        })?;
    started.wait().map_err(std::io::Error::other)
}

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

fn thread_main(waker: &Waker) -> ! {
    // At function scope: the loop holds its address.
    #[cfg(windows)]
    let mut timer: bun_sys::windows::libuv::Timer = bun_core::ffi::zeroed();
    #[cfg(windows)]
    {
        timer.init(bun_uws::Loop::get().uv_loop());
        timer.start(u64::MAX, u64::MAX, Some(timer_callback));
    }

    let mut generation: bun_core::Generation = 0;
    loop {
        let mut has_bundled = false;
        while let Some((task, ticket)) = start_next() {
            // Newer than the run time's directory listings, which bear 0, and an earlier build's.
            generation = generation.saturating_add(1);
            task.run(ticket, generation);
            has_bundled = true;
        }
        if has_bundled {
            bun_jsc::cached_bytecode::destroy_bytecode_cache_vm();
            bun_alloc::mimalloc::mi_collect(false);
        }

        waker.wait();
    }
}

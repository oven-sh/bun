//! The thread that runs every `Bun.build()` of the process, one at a time.

use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use bun_core::{Output, zstr};
use bun_io::Waker;
use bun_jsc::Ticket;
use bun_threading::Guarded;

use super::{BundleJs, JSBundleCompletionTask};

pub(super) struct QueuedBuild {
    pub(super) task: Box<JSBundleCompletionTask>,
    ticket: Ticket,
}

struct State {
    /// `None` until the thread runs. If it fails to start, the next build tries again.
    waker: Option<&'static Waker>,
    queue: VecDeque<QueuedBuild>,
    /// The address of the `BundleJs` of the build that the thread took last.
    last_started_addr: usize,
}

static STATE: Guarded<State> = Guarded::new(State {
    waker: None,
    queue: VecDeque::new(),
    last_started_addr: 0,
});

/// Whether the build at `last_started_addr` is cancelled. Written under `STATE`'s lock.
pub(super) static CANCELLED: AtomicBool = AtomicBool::new(false);

/// The thread's `Loop::get()`, in which the `MiniEventLoop` of a build waits for its plugins.
static UWS_LOOP: AtomicPtr<bun_uws::Loop> = AtomicPtr::new(core::ptr::null_mut());

pub(super) fn enqueue(task: Box<JSBundleCompletionTask>, ticket: Ticket) {
    // The lock also blocks other callers until the thread is created.
    let mut state = STATE.lock();
    match state.waker.map_or_else(spawn, Ok) {
        Ok(waker) => {
            state.waker = Some(waker);
            state.queue.push_back(QueuedBuild { task, ticket });
            drop(state);
            waker.wake();
        }
        Err(err) => {
            drop(state);
            task.fail_to_start(&err, &ticket);
        }
    }
}

pub(super) fn take_unstarted(js: *mut BundleJs) -> Option<QueuedBuild> {
    let mut state = STATE.lock();
    let index = (state.queue.iter()).rposition(|queued| queued.task.js.as_ptr() == js)?;
    state.queue.remove(index)
}

pub(super) fn cancel_if_started(js: &BundleJs) {
    let state = STATE.lock();
    if state.last_started_addr != core::ptr::from_ref(js).addr() {
        return;
    }
    CANCELLED.store(true, Ordering::SeqCst);
    // SAFETY: `start_next` wrote that address, after `thread_main` stored the loop. The thread
    // never exits or frees its loop, and wakeup is thread-safe.
    unsafe { bun_uws::us_wakeup_loop(UWS_LOOP.load(Ordering::SeqCst)) };
}

fn start_next() -> Option<QueuedBuild> {
    let mut state = STATE.lock();
    let next = state.queue.pop_front()?;
    state.last_started_addr = next.task.js.as_ptr().addr();
    CANCELLED.store(false, Ordering::SeqCst);
    Some(next)
}

fn spawn() -> std::io::Result<&'static Waker> {
    let waker_result = Arc::new(OnceLock::new());
    let slot = Arc::clone(&waker_result);
    std::thread::Builder::new()
        .name("Bundler".into())
        .spawn(move || {
            Output::Source::configure_named_thread(zstr!("Bundler"));
            // On Windows the waker is this thread's libuv loop, so create it here.
            let waker = Waker::init().map(|waker| &*Box::leak(Box::new(waker)));
            let _ = slot.set(waker);
            // `thread_main` never returns.
            drop(slot);
            if let Ok(waker) = waker {
                thread_main(waker);
            }
        })?;
    waker_result.wait().map_err(std::io::Error::other)
}

/// Used to keep the bundle thread from spinning on Windows
#[cfg(windows)]
extern "C" fn timer_callback(_: *mut bun_sys::windows::libuv::Timer) {}

fn thread_main(waker: &Waker) -> ! {
    let uws_loop: &bun_uws::Loop = bun_uws::Loop::get();
    UWS_LOOP.store(core::ptr::from_ref(uws_loop).cast_mut(), Ordering::SeqCst);

    // At function scope: the loop holds its address.
    #[cfg(windows)]
    let mut timer: bun_sys::windows::libuv::Timer = bun_core::ffi::zeroed();
    #[cfg(windows)]
    {
        timer.init(uws_loop.uv_loop());
        timer.start(u64::MAX, u64::MAX, Some(timer_callback));
    }

    let mut generation: bun_core::Generation = 0;
    loop {
        let mut has_bundled = false;
        while let Some(QueuedBuild { task, ticket }) = start_next() {
            // The resolver rereads a directory whose listing has a lower generation. The runtime's have 0.
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

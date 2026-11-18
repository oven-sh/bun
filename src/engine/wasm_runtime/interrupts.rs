//! How other threads get the attention of compiled code.

use core::ptr;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Trap;
use bun_threading::Guarded;

use crate::code::InstalledCode;
use crate::frames::Frame;
use crate::instance::Instance;
use crate::outcome::Outcome;
use crate::registry::{Registration, Slots};

/// Above the stack, be it compared with or without sign.
const REQUESTED: usize = isize::MAX as usize;

/// One for each store.
pub struct Interrupts {
    stack_limit: usize,
    state: Guarded<State>,
}

struct State {
    entry_limit: usize,
    /// The addresses of the words in instances that mirror it.
    mirrors: Slots<usize>,
}

/// # Safety
/// That of a word that was added and not removed.
unsafe fn write(mirror: usize, limit: usize) {
    // SAFETY: the caller's. Only compiled code reads it.
    unsafe { AtomicUsize::from_ptr(ptr::with_exposed_provenance_mut(mirror)) }
        .store(limit, Ordering::Relaxed);
}

impl Interrupts {
    pub(crate) fn new(stack_limit: usize) -> Self {
        let state = State {
            entry_limit: stack_limit,
            mirrors: Slots::default(),
        };
        Self {
            stack_limit,
            state: Guarded::new(state),
        }
    }

    /// While the answer is yes, functions that call others start with [`crate::Host::interrupt`], and polls end in
    /// [`crate::Host::must_terminate`]. The question is asked under a lock, so whoever asks last gets the answer that
    /// counts.
    pub fn update(&self, is_requested: impl FnOnce() -> bool) {
        let mut state = self.state.lock();
        let limit = match is_requested() {
            true => REQUESTED,
            false => self.stack_limit,
        };
        if core::mem::replace(&mut state.entry_limit, limit) != limit {
            // SAFETY: from the list.
            (state.mirrors.iter()).for_each(|mirror| unsafe { write(mirror, limit) });
        }
    }

    /// # Safety
    /// `word` is aligned, and valid for writes until it is removed.
    pub(crate) unsafe fn add_mirror(&self, word: *mut usize) -> Registration {
        let mut state = self.state.lock();
        // SAFETY: the caller's.
        unsafe { word.write(state.entry_limit) };
        state.mirrors.add(word.expose_provenance())
    }

    pub(crate) fn remove_mirror(&self, registration: Registration) {
        self.state.lock().mirrors.remove(registration);
    }
}

#[native_abi]
pub(crate) fn must_terminate(instance: &Instance) -> usize {
    let (host, vm) = instance.store().host();
    host.must_terminate(vm).into()
}

/// # Safety
/// For the stub with its frame at `fp`, which the prologue of a function of the instance has called.
#[native_abi]
pub(crate) unsafe fn check_entry(instance: &Instance, fp: usize) -> Outcome {
    // SAFETY: the caller's.
    let (caller, code) = unsafe {
        let caller = Frame::caller_of(fp);
        (caller, InstalledCode::running_at(caller.return_address - 1))
    };
    let store = instance.store();
    let bottom = (caller.fp).saturating_sub(code.expect("a function").frame_size());
    if bottom < store.stack_limit() {
        return Outcome::failure(Trap::StackOverflow);
    }
    store.set_top_frame(fp);
    // SAFETY: the caller's.
    unsafe { instance.engine().host().interrupt(instance) }.into()
}

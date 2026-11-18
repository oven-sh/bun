//! Promises, microtasks, generators and async functions.

mod async_context;
mod async_function;
mod async_generator;
mod async_iteration;
mod async_stack_trace;
mod combinator;
mod coroutine;
mod disposal;
mod generator;
mod jobs;
mod microtask;
mod microtask_queue;
mod promise;
mod reaction;
mod resolving;
mod synchronous_module_queue;
mod tagged_field;

use core::cell::{Cell, RefCell};
use std::rc::Weak;

pub(crate) use async_context::AsyncContextScope;
pub use async_function::{
    JsAsyncFunctionGenerator, async_return, async_throw, try_async_return_quickly,
};
pub use async_generator::JsAsyncGenerator;
pub use async_iteration::{
    AsyncIteratorRecord, JsAsyncFromSyncIterator, REQUESTED_STEP, open_async_iterator,
    request_async_step,
};
pub use combinator::PromiseCombinator;
pub use coroutine::{Coroutine, CoroutineState};
pub use disposal::get_dispose_method;
pub use generator::JsGenerator;
pub use microtask::{InternalMicrotask, QueuedTask};
pub(crate) use microtask_queue::RealmMicrotaskQueue;
pub use microtask_queue::{MicrotaskEvent, MicrotaskHooks, MicrotaskQueue, MicrotaskQueueRef};
pub use promise::{InlineReactionKind, JsPromise, PromiseStatus, is_definitely_not_thenable};
pub use reaction::{FullPromiseReaction, InternalReaction, PromiseReaction};
pub use resolving::{JsFunctionWithFields, PromiseCapability};
pub use synchronous_module_queue::SynchronousModuleQueueScope;

use crate::heap::Scope;
use crate::{CellKind, Gc, Visitor, Vm};

/// # Safety
/// A new cell that has room for a `T`, whose shape `init` has.
#[inline(always)]
unsafe fn initialize_at<T: CellKind>(address: usize, init: T::Init) -> Gc<T> {
    const { assert!(!core::mem::needs_drop::<T>()) };
    // SAFETY: the caller's.
    unsafe {
        T::initialize(core::ptr::with_exposed_provenance_mut(address), init);
        Gc::from_address(address)
    }
}

pub(crate) struct State {
    has_synchronous_module_queue: Cell<bool>,
    /// For those that have not come to their `await` yet.
    early_answers: MicrotaskQueue,
    resolver_executables: resolving::ResolverExecutables,
    queues: RefCell<Vec<Weak<MicrotaskQueue>>>,
    synchronous_module_queues: RefCell<Vec<MicrotaskQueue>>,
    last_microtask_id: Cell<u64>,
}

impl State {
    pub(crate) const OFFSET_OF_HAS_SYNCHRONOUS_MODULE_QUEUE: usize =
        core::mem::offset_of!(State, has_synchronous_module_queue);
}

impl Default for State {
    fn default() -> State {
        State {
            has_synchronous_module_queue: Cell::new(false),
            early_answers: MicrotaskQueue::new(),
            resolver_executables: Default::default(),
            queues: RefCell::default(),
            synchronous_module_queues: RefCell::default(),
            last_microtask_id: Cell::new(0),
        }
    }
}

impl crate::services::Service for State {
    fn initialize(&self, vm: &Vm) {
        vm.default_microtask_queue().register(vm);
    }

    /// Those that they were for have been terminated.
    #[inline]
    fn will_enter(&self, _: &Vm) {
        self.early_answers.clear();
    }

    fn visit(&self, visitor: &mut Visitor) {
        self.resolver_executables.visit(visitor);
        self.early_answers.visit(visitor);
        for queue in self.synchronous_module_queues.borrow().iter() {
            queue.visit(visitor);
        }
        self.queues
            .borrow_mut()
            .retain(|queue| queue.upgrade().inspect(|it| it.visit(visitor)).is_some());
    }

    fn did_collect(&self, vm: &Vm, scope: Scope) {
        if scope == Scope::Full {
            vm.default_microtask_queue().shrink();
        }
    }
}

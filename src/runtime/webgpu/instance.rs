//! How what Dawn finishes gets back to JavaScript.

use core::cell::{Cell, OnceCell, RefCell};
use core::sync::atomic::{AtomicBool, Ordering};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_collections::smallvec::SmallVec;
use bun_core::thread_id::{self, ThreadId};
use bun_dawn_sys::{self as dawn, Host as _, OwnedInstance, WorkerTask};
use bun_event_loop::{ContextId, Task, TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_jsc::bindgen::JsScope;
use bun_jsc::event_loop::TaskSource;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, JsResult, VmHandle};
use bun_threading::WorkPool;

use super::device::Device;

/// The part of an [`Instance`] that other threads have.
pub(super) struct Host {
    vm: VmHandle,
    js_thread: ThreadId,
    is_woken: AtomicBool,
}

impl Host {
    pub(super) fn is_js_thread(&self) -> bool {
        thread_id::current() == self.js_thread
    }
}

impl dawn::Host for Host {
    fn wake(self: &Arc<Self>) {
        if !self.is_woken.swap(true, Ordering::SeqCst) {
            self.vm.wake();
        }
    }

    fn post_worker_task(self: &Arc<Self>, task: WorkerTask) {
        // It compiles a pipeline, which has nothing of the VM.
        bun_core::handle_oom(WorkPool::go((Arc::clone(self), task), |(host, task)| {
            task.run();
            host.wake();
        }));
    }
}

pub(crate) struct Instance {
    host: Arc<Host>,
    dawn: OnceCell<Option<Rc<OwnedInstance>>>,
    devices: RefCell<Vec<Weak<Device>>>,
    /// Since the last [`process_events`](Self::process_events).
    new_completions: RefCell<Vec<Completion>>,
    completions: RefCell<VecDeque<Completion>>,
    /// Dawn runs once for each poll, or a script that only waits for it would starve timers and sockets.
    has_polled: Cell<bool>,
    operations: Cell<u32>,
    keep_alive: KeepAlive,
}

impl Instance {
    pub(super) fn new() -> Rc<Self> {
        let vm = VirtualMachine::get();
        let instance = Rc::new(Self {
            host: Arc::new(Host {
                vm: vm.handle(),
                js_thread: thread_id::current(),
                is_woken: AtomicBool::new(false),
            }),
            dawn: OnceCell::new(),
            devices: RefCell::default(),
            new_completions: RefCell::default(),
            completions: RefCell::default(),
            has_polled: Cell::new(false),
            operations: Cell::new(0),
            keep_alive: KeepAlive::default(),
        });
        vm.add_task_source(Rc::<Self>::downgrade(&instance));
        instance
    }

    pub(super) fn host(&self) -> &Arc<Host> {
        &self.host
    }

    pub(super) fn dawn(&self) -> Option<&Rc<OwnedInstance>> {
        let create = || OwnedInstance::new(Arc::clone(&self.host));
        self.dawn.get_or_init(create).as_ref()
    }

    pub(super) fn add_device(&self, device: &Rc<Device>) {
        self.devices.borrow_mut().push(Rc::downgrade(device));
    }

    pub(super) fn schedule(&self) {
        self.host.wake();
    }

    fn process_events(&self) {
        if let Some(Some(dawn)) = self.dawn.get() {
            dawn.process_events();
        }
        let mut devices = SmallVec::<[Rc<Device>; 2]>::new();
        self.devices.borrow_mut().retain(|device| {
            devices.extend(device.upgrade());
            device.strong_count() > 0
        });
        let results = self.new_completions.borrow().len();
        let has_results = results > 0 || !self.completions.borrow().is_empty();
        for device in devices {
            device.watch_queue(has_results);
            device.complete_events();
        }
        // A result can follow from an event: an error, or the loss of the device.
        self.new_completions.borrow_mut().rotate_left(results);
        (self.completions.borrow_mut()).extend(self.new_completions.borrow_mut().drain(..));
    }

    fn into_task(self: Rc<Self>) -> Task {
        Task::init(Rc::into_raw(self).cast_mut())
    }

    /// One completion for each task, so that microtasks run in between.
    ///
    /// SAFETY: `task` came off a queue of the VM.
    pub(crate) unsafe fn run(task: *mut Self, vm: &VirtualMachine) -> JsResult<()> {
        // SAFETY: `into_task` made it.
        let this = unsafe { Rc::from_raw(task) };
        if !vm.script_allowed() {
            this.release_operations();
            return Ok(());
        }
        if this.has_polled.take() && this.host.is_woken.swap(false, Ordering::SeqCst) {
            this.process_events();
        }

        let Some(Completion { operation, run }) = this.completions.borrow_mut().pop_front() else {
            return Ok(());
        };
        if !this.completions.borrow().is_empty() {
            vm.enqueue_task(this.into_task());
        }
        let origin = operation.origin;
        if vm.has_outlived_its_script(origin.context, origin.generation) {
            return Ok(());
        }
        let _context = vm.enter_context(origin.context);
        run(&origin.global)
    }

    /// No script runs any more. Every operation of a destroyed device ends here.
    pub(super) fn release_operations(&self) {
        self.host.is_woken.store(false, Ordering::SeqCst);
        if let Some(Some(dawn)) = self.dawn.get() {
            dawn.process_events();
        }
        drop(self.completions.take());
        drop(self.new_completions.take());
    }
}

impl TaskSource for Instance {
    fn is_ready(&self) -> bool {
        self.host.is_woken.load(Ordering::SeqCst) || !self.completions.borrow().is_empty()
    }

    fn task(self: Rc<Self>) -> Task {
        self.has_polled.set(true);
        self.into_task()
    }
}

impl Taskable for Instance {
    const TAG: TaskTag = task_tag::WebGpuProcessEvents;

    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: `into_task` made it.
        unsafe { Rc::from_raw(this) }.release_operations();
    }

    /// Each completion enters the context of its [`Operation`].
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

/// The script that started something.
#[derive(Clone, Copy)]
pub(super) struct Origin {
    /// Whoever follows it holds an object of that realm.
    pub(super) global: GlobalRef,
    context: ContextId,
    generation: u32,
}

impl Origin {
    pub(super) fn of_caller(cx: &mut JsScope<'_>) -> Self {
        let thread = cx.js_thread();
        Self {
            global: GlobalRef::new(thread.global()),
            context: thread.context().id(),
            generation: thread.vm().test_isolation_generation.get(),
        }
    }
}

/// Something that script has yet to hear of. It keeps the event loop alive.
pub(super) struct Operation {
    instance: Rc<Instance>,
    origin: Origin,
}

impl Operation {
    pub(super) fn new(instance: &Rc<Instance>, origin: Origin) -> Self {
        if instance.operations.replace(instance.operations.get() + 1) == 0 {
            instance.keep_alive.ref_(bun_io::js_vm_ctx());
        }
        instance.schedule();
        Self {
            instance: Rc::clone(instance),
            origin,
        }
    }

    /// `completion` runs in a task of its own. It holds an object of the realm it is handed.
    pub(super) fn complete(
        self,
        completion: impl FnOnce(&JSGlobalObject) -> JsResult<()> + 'static,
    ) {
        let instance = Rc::clone(&self.instance);
        instance.new_completions.borrow_mut().push(Completion {
            operation: self,
            run: Box::new(completion),
        });
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        let instance = &self.instance;
        if instance.operations.replace(instance.operations.get() - 1) == 1 {
            instance.keep_alive.unref(bun_io::js_vm_ctx());
        }
    }
}

struct Completion {
    operation: Operation,
    run: Box<dyn FnOnce(&JSGlobalObject) -> JsResult<()>>,
}

/// An [`Operation`] that ends by settling a promise.
pub(super) struct Deferred {
    operation: Operation,
    promise: JSPromiseStrong,
}

impl Deferred {
    pub(super) fn new(instance: &Rc<Instance>, cx: &mut JsScope<'_>) -> (Self, JSValue) {
        let operation = Operation::new(instance, Origin::of_caller(cx));
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        (Self { operation, promise }, value)
    }

    pub(super) fn complete(
        self,
        settle: impl FnOnce(&JSGlobalObject, &mut JSPromise) -> JsResult<()> + 'static,
    ) {
        let Self { operation, promise } = self;
        operation.complete(move |global| settle(global, promise.get()));
    }
}

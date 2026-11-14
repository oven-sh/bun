//! How what Dawn finishes gets back to JavaScript.

use core::cell::{Cell, OnceCell, RefCell};
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_collections::smallvec::SmallVec;
use bun_core::thread_id::{self, ThreadId};
use bun_dawn_sys::{self as dawn, OwnedInstance, WorkerTask};
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{ContextId, Task, TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_jsc::bindgen::JsScope;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    GlobalRef, JSGlobalObject, JSPromise, JSPromiseStrong, JSValue, JsResult, LoopKind, Posted,
    VmHandle,
};
use bun_threading::WorkPool;

use super::device::Device;

/// The part of an [`Instance`] that other threads have. As a task, it is [`Instance::process_events`].
pub(crate) struct Host {
    vm: VmHandle,
    js_thread: ThreadId,
    is_queued_on_regular_loop: AtomicBool,
    /// While a macro waits, the regular loop does not run.
    operations_of_macros: AtomicU32,
    /// Only the JS thread follows it. Null once the instance is dropped.
    instance: AtomicPtr<Instance>,
}

impl Host {
    pub(super) fn is_js_thread(&self) -> bool {
        thread_id::current() == self.js_thread
    }

    fn task(self: &Arc<Self>) -> Task {
        Task::init(Arc::into_raw(Arc::clone(self)).cast_mut())
    }

    fn post(self: &Arc<Self>, kind: LoopKind) {
        let task = self.task();
        if let Posted::Refused(refused) = self.vm.post(kind, ConcurrentTask::create(task)) {
            // SAFETY: both were made above, and no queue has them.
            unsafe {
                ConcurrentTask::release_refused(refused);
                drop(Arc::from_raw(task.ptr.cast::<Self>()));
            }
        }
    }

    /// Returns false if the task is there already.
    fn post_to_regular_loop(self: &Arc<Self>) -> bool {
        let was_queued = self.is_queued_on_regular_loop.swap(true, Ordering::SeqCst);
        if !was_queued {
            self.post(LoopKind::Regular);
        }
        !was_queued
    }

    /// SAFETY: `task` came off a queue of the VM.
    unsafe fn take_instance(task: *mut Self) -> Option<Rc<Instance>> {
        // SAFETY: `task` made it.
        let host = unsafe { Arc::from_raw(task) };
        let instance = host.instance.load(Ordering::SeqCst);
        // SAFETY: `Rc::as_ptr` of an instance that has not been dropped, on its thread.
        (!instance.is_null()).then(|| unsafe {
            Rc::increment_strong_count(instance);
            Rc::from_raw(instance)
        })
    }

    /// SAFETY: as [`take_instance`](Self::take_instance).
    pub(crate) unsafe fn run(task: *mut Self, vm: &VirtualMachine) {
        // SAFETY: forwarded.
        if let Some(instance) = unsafe { Self::take_instance(task) } {
            instance.process_events(vm);
        }
    }
}

impl Taskable for Host {
    const TAG: TaskTag = task_tag::WebGpuProcessEvents;

    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: forwarded.
        if let Some(instance) = unsafe { Self::take_instance(this) } {
            instance.release_operations();
        }
    }

    /// It runs no script.
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

impl dawn::Host for Host {
    fn wake(self: &Arc<Self>) {
        if !self.post_to_regular_loop() {
            // It may wait for the next turn of a loop that has gone to sleep.
            self.vm.wake();
        }
        if self.operations_of_macros.load(Ordering::SeqCst) > 0 {
            self.post(LoopKind::Macro);
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

/// As a task, it is [`Instance::complete_one`].
pub(crate) struct Instance {
    host: Arc<Host>,
    dawn: OnceCell<Option<Rc<OwnedInstance>>>,
    devices: RefCell<Vec<Weak<Device>>>,
    /// Since the last [`process_events`](Self::process_events).
    new_completions: RefCell<Vec<Completion>>,
    completions: RefCell<VecDeque<Completion>>,
    /// Not counting what is posted, which the regular loop takes over when the macro returns.
    is_queued_on_macro_loop: Cell<bool>,
    is_processing_events: Cell<bool>,
    operations: Cell<u32>,
    keep_alive: KeepAlive,
}

impl Instance {
    pub(super) fn new() -> Rc<Self> {
        let instance = Rc::new(Self {
            host: Arc::new(Host {
                vm: VirtualMachine::get().handle(),
                js_thread: thread_id::current(),
                is_queued_on_regular_loop: AtomicBool::new(false),
                operations_of_macros: AtomicU32::new(0),
                instance: AtomicPtr::new(ptr::null_mut()),
            }),
            dawn: OnceCell::new(),
            devices: RefCell::default(),
            new_completions: RefCell::default(),
            completions: RefCell::default(),
            is_queued_on_macro_loop: Cell::new(false),
            is_processing_events: Cell::new(false),
            operations: Cell::new(0),
            keep_alive: KeepAlive::default(),
        });
        let address = Rc::as_ptr(&instance).cast_mut();
        instance.host.instance.store(address, Ordering::SeqCst);
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

    /// Dawn runs after the event loop has polled, or a script that only waits for Dawn would starve timers and sockets.
    pub(super) fn schedule(&self) {
        self.enqueue_after_yield(VirtualMachine::get());
    }

    /// The event loop may have made up its mind to sleep.
    pub(super) fn schedule_from_finalizer(&self) {
        let vm = VirtualMachine::get();
        if self.enqueue_after_yield(vm) {
            vm.wakeup();
        }
    }

    /// Returns false if the task is there already.
    fn enqueue_after_yield(&self, vm: &VirtualMachine) -> bool {
        let was_queued = match vm.current_loop_kind() {
            LoopKind::Regular => (self.host.is_queued_on_regular_loop).swap(true, Ordering::SeqCst),
            LoopKind::Macro => {
                // The macro may return first.
                self.host.post_to_regular_loop();
                self.is_queued_on_macro_loop.replace(true)
            }
        };
        if !was_queued {
            vm.event_loop().enqueue_task_after_yield(self.host.task());
        }
        !was_queued
    }

    pub(super) fn is_processing_events(&self) -> bool {
        self.is_processing_events.get()
    }

    fn process_events(self: &Rc<Self>, vm: &VirtualMachine) {
        let kind = vm.current_loop_kind();
        match kind {
            LoopKind::Regular => {
                (self.host.is_queued_on_regular_loop).swap(false, Ordering::SeqCst);
            }
            LoopKind::Macro => {
                self.is_queued_on_macro_loop.set(false);
                self.host.post_to_regular_loop();
            }
        }
        if !vm.script_allowed() {
            return self.release_operations();
        }

        if let Some(Some(dawn)) = self.dawn.get() {
            self.is_processing_events.set(true);
            dawn.process_events();
            self.is_processing_events.set(false);
        }
        let mut devices = SmallVec::<[Rc<Device>; 2]>::new();
        self.devices.borrow_mut().retain(|device| {
            devices.extend(device.upgrade());
            device.strong_count() > 0
        });
        let results = self.new_completions.borrow().len();
        for device in devices {
            device.watch_queue();
            device.complete_events();
        }
        // A result can follow from an event: an error, or the loss of the device.
        self.new_completions.borrow_mut().rotate_left(results);
        (self.completions.borrow_mut()).extend(self.new_completions.borrow_mut().drain(..));

        if kind == LoopKind::Regular && self.next_completion(LoopKind::Macro).is_some() {
            // A macro that waits for it may start first.
            self.host.post(LoopKind::Macro);
        }
        self.enqueue_completion(vm);
    }

    /// A macro runs in the middle of the program, which it is not to continue.
    fn next_completion(&self, kind: LoopKind) -> Option<usize> {
        self.completions.borrow().iter().position(|completion| {
            kind == LoopKind::Regular || completion.operation.loop_kind() == LoopKind::Macro
        })
    }

    fn enqueue_completion(self: &Rc<Self>, vm: &VirtualMachine) {
        if self.next_completion(vm.current_loop_kind()).is_some() {
            vm.enqueue_task(Task::init(Rc::into_raw(Rc::clone(self)).cast_mut()));
            // A wake that comes while the script runs waits for this, and so for the poll.
            self.enqueue_after_yield(vm);
        }
    }

    /// One for each task, so that microtasks run in between.
    fn complete_one(self: &Rc<Self>, vm: &VirtualMachine) -> JsResult<()> {
        if !vm.script_allowed() {
            self.release_operations();
            return Ok(());
        }
        let next = self.next_completion(vm.current_loop_kind());
        let next = next.and_then(|index| self.completions.borrow_mut().remove(index));
        let Some(Completion { operation, run }) = next else {
            return Ok(());
        };
        self.enqueue_completion(vm);

        let origin = operation.origin;
        if vm.has_outlived_its_script(origin.context, origin.generation) {
            return Ok(());
        }
        let _context = vm.enter_context(origin.context);
        run(&origin.global)
    }

    /// SAFETY: `task` came off a queue of the VM.
    pub(crate) unsafe fn run(task: *mut Self, vm: &VirtualMachine) -> JsResult<()> {
        // SAFETY: `enqueue_completion` made it.
        unsafe { Rc::from_raw(task) }.complete_one(vm)
    }

    /// No script runs any more. Every operation of a destroyed device ends here.
    pub(super) fn release_operations(&self) {
        if let Some(Some(dawn)) = self.dawn.get() {
            dawn.process_events();
        }
        drop(self.completions.take());
        drop(self.new_completions.take());
    }
}

impl Taskable for Instance {
    const TAG: TaskTag = task_tag::WebGpuCompletion;

    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: `enqueue_completion` made it.
        unsafe { Rc::from_raw(this) }.release_operations();
    }

    /// Each completion enters the context of its [`Operation`].
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.host.instance.store(ptr::null_mut(), Ordering::SeqCst);
    }
}

/// The script that started something.
#[derive(Clone, Copy)]
pub(super) struct Origin {
    /// Whoever follows it holds an object of that realm.
    pub(super) global: GlobalRef,
    context: ContextId,
    generation: u32,
    loop_kind: LoopKind,
}

impl Origin {
    pub(super) fn of_caller(cx: &mut JsScope<'_>) -> Self {
        let thread = cx.js_thread();
        Self {
            global: GlobalRef::new(thread.global()),
            context: thread.context().id(),
            generation: thread.vm().test_isolation_generation.get(),
            loop_kind: thread.vm().current_loop_kind(),
        }
    }

    pub(super) fn on(self, loop_kind: LoopKind) -> Self {
        Self { loop_kind, ..self }
    }
}

/// Something that script has yet to hear of. It keeps the event loop alive.
pub(super) struct Operation {
    instance: Rc<Instance>,
    origin: Origin,
}

impl Operation {
    pub(super) fn new(instance: &Rc<Instance>, origin: Origin) -> Self {
        if origin.loop_kind == LoopKind::Macro {
            (instance.host.operations_of_macros).fetch_add(1, Ordering::SeqCst);
        }
        if instance.operations.replace(instance.operations.get() + 1) == 0 {
            instance.keep_alive.ref_(bun_io::js_vm_ctx());
        }
        instance.schedule();
        Self {
            instance: Rc::clone(instance),
            origin,
        }
    }

    pub(super) fn loop_kind(&self) -> LoopKind {
        self.origin.loop_kind
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
        if self.origin.loop_kind == LoopKind::Macro {
            (instance.host.operations_of_macros).fetch_sub(1, Ordering::SeqCst);
        }
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

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

/// The part of an [`Instance`] that other threads have. As a task, it is [`Instance::run`].
pub(crate) struct Host {
    vm: VmHandle,
    js_thread: ThreadId,
    /// By `LoopKind`.
    is_queued: [AtomicBool; 2],
    /// While a macro waits, the regular loop does not run.
    operations_of_macros: AtomicU32,
    /// Only the JS thread follows it. Null once the instance is dropped.
    instance: AtomicPtr<Instance>,
}

impl Host {
    pub(super) fn is_js_thread(&self) -> bool {
        thread_id::current() == self.js_thread
    }

    fn task_unless_queued(self: &Arc<Self>, kind: LoopKind) -> Option<Task> {
        let is_queued = self.is_queued[kind as usize].swap(true, Ordering::AcqRel);
        (!is_queued).then(|| Task::init(Arc::into_raw(Arc::clone(self)).cast_mut()))
    }

    fn post(self: &Arc<Self>, kind: LoopKind) {
        let Some(task) = self.task_unless_queued(kind) else {
            return;
        };
        if let Posted::Refused(refused) = self.vm.post(kind, ConcurrentTask::create(task)) {
            // SAFETY: both were made above, and no queue has them.
            unsafe {
                ConcurrentTask::release_refused(refused);
                drop(Arc::from_raw(task.ptr.cast::<Self>()));
            }
        }
    }

    /// SAFETY: `task` came off a queue of the VM.
    unsafe fn take_instance(task: *mut Self) -> Option<Rc<Instance>> {
        // SAFETY: `task_unless_queued` made it.
        let host = unsafe { Arc::from_raw(task) };
        let instance = host.instance.load(Ordering::Relaxed);
        // SAFETY: `Rc::as_ptr` of an instance that has not been dropped, on its thread.
        (!instance.is_null()).then(|| unsafe {
            Rc::increment_strong_count(instance);
            Rc::from_raw(instance)
        })
    }

    /// SAFETY: as [`take_instance`](Self::take_instance).
    pub(crate) unsafe fn run(task: *mut Self) -> JsResult<()> {
        // SAFETY: forwarded.
        unsafe { Self::take_instance(task) }.map_or(Ok(()), |instance| instance.run())
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

    /// Each completion enters the context of its [`Operation`].
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

impl dawn::Host for Host {
    fn wake(self: &Arc<Self>) {
        self.post(LoopKind::Regular);
        if self.operations_of_macros.load(Ordering::Acquire) > 0 {
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

type Completion = Box<dyn FnOnce(&JSGlobalObject) -> JsResult<()>>;

pub(super) struct Instance {
    host: Arc<Host>,
    dawn: OnceCell<Option<Rc<OwnedInstance>>>,
    devices: RefCell<Vec<Weak<Device>>>,
    completions: RefCell<VecDeque<(Operation, Completion)>>,
    /// How many of them run before the event loop polls again.
    batch: Cell<usize>,
    operations: Cell<u32>,
    keep_alive: RefCell<KeepAlive>,
}

impl Instance {
    pub(super) fn new() -> Rc<Self> {
        let instance = Rc::new(Self {
            host: Arc::new(Host {
                vm: VirtualMachine::get().handle(),
                js_thread: thread_id::current(),
                is_queued: Default::default(),
                operations_of_macros: AtomicU32::new(0),
                instance: AtomicPtr::new(ptr::null_mut()),
            }),
            dawn: OnceCell::new(),
            devices: RefCell::default(),
            completions: RefCell::default(),
            batch: Cell::new(0),
            operations: Cell::new(0),
            keep_alive: RefCell::default(),
        });
        let address = Rc::as_ptr(&instance).cast_mut();
        instance.host.instance.store(address, Ordering::Relaxed);
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
        let vm = VirtualMachine::get();
        let kind = vm.current_loop_kind();
        if let Some(task) = self.host.task_unless_queued(kind) {
            vm.event_loop().enqueue_task_after_yield(task);
        }
        if kind == LoopKind::Macro {
            // The macro may return first.
            self.host.post(LoopKind::Regular);
        }
    }

    /// One completion for each task, so that microtasks run in between.
    fn run(&self) -> JsResult<()> {
        let vm = VirtualMachine::get();
        let kind = vm.current_loop_kind();
        self.host.is_queued[kind as usize].swap(false, Ordering::AcqRel);
        if !vm.script_allowed() {
            self.release_operations();
            return Ok(());
        }

        if self.batch.get() == 0 {
            self.process_events();
            self.batch.set(self.completions.borrow().len());
        }
        let Some((operation, completion)) = self.completions.borrow_mut().pop_front() else {
            return Ok(());
        };
        self.batch.update(|left| left - 1);
        if self.batch.get() == 0 {
            self.schedule();
        } else if let Some(task) = self.host.task_unless_queued(kind) {
            vm.enqueue_task(task);
        }

        let origin = operation.origin;
        if vm.has_outlived_its_script(origin.context, origin.generation) {
            return Ok(());
        }
        let _context = vm.enter_context(origin.context);
        completion(&origin.global)
    }

    fn process_events(&self) {
        let Some(Some(dawn)) = self.dawn.get() else {
            return;
        };
        dawn.process_events();

        let mut devices = SmallVec::<[Rc<Device>; 2]>::new();
        self.devices.borrow_mut().retain(|device| {
            devices.extend(device.upgrade());
            device.strong_count() > 0
        });
        let results = self.completions.borrow().len();
        for device in devices {
            if device.has_to_be_polled() {
                self.schedule();
            }
            device.complete_events();
        }
        // A result can follow from an event: an error, or the loss of the device.
        self.completions.borrow_mut().rotate_left(results);
    }

    /// No script runs any more. Every operation of a destroyed device ends here.
    pub(super) fn release_operations(&self) {
        if let Some(Some(dawn)) = self.dawn.get() {
            dawn.process_events();
        }
        self.batch.set(0);
        drop(self.completions.take());
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.host.instance.store(ptr::null_mut(), Ordering::Relaxed);
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
        Self {
            global: GlobalRef::new(cx.global()),
            context: cx.js_thread().context().id(),
            generation: VirtualMachine::get().test_isolation_generation.get(),
        }
    }
}

/// Something that script has yet to hear of. It keeps the event loop alive.
pub(super) struct Operation {
    instance: Rc<Instance>,
    origin: Origin,
    is_of_macro: bool,
}

impl Operation {
    pub(super) fn new(instance: &Rc<Instance>, origin: Origin) -> Self {
        let is_of_macro = VirtualMachine::get().current_loop_kind() == LoopKind::Macro;
        if is_of_macro {
            (instance.host.operations_of_macros).fetch_add(1, Ordering::AcqRel);
        }
        if instance.operations.replace(instance.operations.get() + 1) == 0 {
            instance.keep_alive.borrow_mut().ref_(bun_io::js_vm_ctx());
        }
        instance.schedule();
        Self {
            instance: Rc::clone(instance),
            origin,
            is_of_macro,
        }
    }

    /// `completion` runs in a task of its own. It holds an object of the realm it is handed.
    pub(super) fn complete(
        self,
        completion: impl FnOnce(&JSGlobalObject) -> JsResult<()> + 'static,
    ) {
        let instance = Rc::clone(&self.instance);
        let mut completions = instance.completions.borrow_mut();
        completions.push_back((self, Box::new(completion)));
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        let instance = &self.instance;
        if self.is_of_macro {
            (instance.host.operations_of_macros).fetch_sub(1, Ordering::AcqRel);
        }
        if instance.operations.replace(instance.operations.get() - 1) == 1 {
            instance.keep_alive.borrow_mut().unref(bun_io::js_vm_ctx());
        }
    }
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

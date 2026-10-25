//! The macro thread: one thread with one VM that runs the macros called from threads that have no VM.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};
use std::collections::VecDeque;
use std::sync::Arc;

use bun_alloc::Arena;
use bun_ast::{ASTMemoryAllocator, DisableStoreReset, E, Expr, ExprData, ExprNodeList, G, Loc};
use bun_ast::{Log, Source};
use bun_bundler::options::TransformOptions;
use bun_collections::{HashMap, VecExt};
use bun_core::Output;
use bun_dotenv::Loader as DotEnvLoader;
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::virtual_machine::{InitOptions, MacroModeGuard, VirtualMachine};
use bun_jsc::{self as jsc, AnyPromise, JSInternalPromise, JSValue, Strong, VmHandle};
use bun_threading::{Guarded, ResetEvent};

use crate::Macro::{JsArgs, Macro, Run, Runner};

/// A macro call that a thread with no VM asks the macro thread to run.
pub(crate) struct Call<'a> {
    /// The resolved path of the macro's module.
    pub(crate) entry_path: &'a [u8],
    pub(crate) function_name: &'a [u8],
    /// The id that `MacroEntryPoint::generate_id` made, as text.
    pub(crate) specifier: &'a [u8],
    pub(crate) hash: i32,
    /// The context that asks has not used this macro before, so the macro's module is loaded first.
    pub(crate) load: bool,
    pub(crate) caller: Expr,
    pub(crate) source: &'a Source,
    pub(crate) log: &'a mut Log,
}

pub(crate) enum Outcome {
    /// The macro thread is stopped. It did not finish the call.
    NotRun,
    /// The macro VM did not start, or the macro's module did not load.
    LoadFailed(crate::Error),
    Failed(crate::Error),
    Value(OwnedExpr),
}

/// What the first call gives the macro VM: the options, the env and the log level of the transpiler that asks.
pub(crate) struct Seed {
    transform_options: TransformOptions,
    env: Option<Box<DotEnvLoader>>,
    log_level: bun_ast::Level,
}

// SAFETY: its fields are owned copies. Nothing else refers to them.
unsafe impl Send for Seed {}

impl Seed {
    pub(crate) fn new(
        options: &TransformOptions,
        env: *mut DotEnvLoader,
        log_level: bun_ast::Level,
    ) -> crate::Result<Seed> {
        let mut transform_options = options.clone();
        // These two describe the output of a build. The imports of a macro's module must still resolve.
        transform_options.external = Vec::new();
        transform_options.packages = None;
        // SAFETY: `env` is the loader of the transpiler that asks. It is alive, and nothing
        // writes to it while a parse runs.
        let env = match unsafe { env.as_ref() } {
            Some(env) => Some(Box::new(env.clone_loaded()?)),
            None => None,
        };
        Ok(Seed {
            transform_options,
            env,
            log_level,
        })
    }
}

enum Work {
    Call(NonNull<Call<'static>>),
    CollectGarbage,
}

/// One piece of work for the macro thread. It is on the stack of the thread that asks, which sleeps until `done`.
struct Request {
    work: Work,
    outcome: Outcome,
    done: ResetEvent,
}

#[derive(Clone, Copy)]
struct RequestPtr(NonNull<Request>);

// SAFETY: the thread that owns the request sleeps until `done` is set. Until then only the
// macro thread touches the request.
unsafe impl Send for RequestPtr {}

struct Queue {
    open: bool,
    requests: VecDeque<RequestPtr>,
}

/// What every thread knows of the macro thread.
struct MacroThread {
    vm: VmHandle,
    id: std::thread::ThreadId,
    stopping: AtomicBool,
    queue: Guarded<Queue>,
    join: Guarded<Option<std::thread::JoinHandle<()>>>,
}

enum State {
    NotStarted,
    Running(Arc<MacroThread>),
    Failed(crate::Error),
    Stopped,
}

static STATE: Guarded<State> = Guarded::new(State::NotStarted);

thread_local! {
    /// This thread asked for a macro call after its last `collect_garbage`.
    static ASKED: Cell<bool> = const { Cell::new(false) };
    /// Set on the macro thread while its loop runs.
    static RUNNING: Cell<*const Running> = const { Cell::new(core::ptr::null()) };
}

/// Runs `call` on the macro thread and blocks until it answers. The first call starts the thread with `seed`.
pub(crate) fn call(seed: impl FnOnce() -> crate::Result<Seed>, call: &mut Call<'_>) -> Outcome {
    let thread = match get_or_start(seed) {
        Ok(thread) => thread,
        Err(outcome) => return outcome,
    };
    ASKED.set(true);
    thread.ask(Work::Call(NonNull::from(call).cast()))
}

/// A thread that is done with its parse work has the macro VM collect what the thread's macro calls left there.
pub(crate) fn collect_garbage() {
    if !ASKED.replace(false) {
        return;
    }
    let thread = match &*STATE.lock() {
        State::Running(thread) => Arc::clone(thread),
        _ => return,
    };
    thread.ask(Work::CollectGarbage);
}

/// Stops the macro thread and waits until its VM is gone. No macro thread can start after this.
pub fn stop() {
    let thread = {
        let mut state = STATE.lock();
        let on_macro_thread =
            matches!(&*state, State::Running(thread) if thread.id == std::thread::current().id());
        // A macro that ends the process with `process.exit()` cannot wait for its own thread.
        if on_macro_thread {
            return;
        }
        match core::mem::replace(&mut *state, State::Stopped) {
            State::Running(thread) => thread,
            _ => return,
        }
    };
    thread.stopping.store(true, Ordering::Release);
    thread.vm.request_termination();
    let join = thread.join.lock().take();
    if let Some(join) = join {
        let _ = join.join();
    }
}

/// [`stop`] for an exit that tears down no VM. It does nothing unless `BUN_DESTRUCT_VM_ON_EXIT` is set.
pub fn stop_before_exit() {
    if bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false) {
        stop();
    }
}

/// Waits for a promise that a macro call on this thread needs. On the macro thread the other macro calls go on meanwhile.
pub(crate) fn wait_for_promise(
    vm: &VirtualMachine,
    promise: AnyPromise,
) -> Result<(), jsc::Stopped> {
    let running = RUNNING.get();
    if running.is_null() {
        return vm.as_mut().wait_for_promise(promise);
    }
    // SAFETY: `RUNNING` is set while `Running::run` is on this thread's stack, below this frame.
    let running = unsafe { &*running };
    let stack = bun_core::StackCheck::init();
    vm.event_loop_mut().wait_for_promise_and(promise, || {
        stack.is_safe_to_recurse() && running.serve(Level::Nested)
    })
}

fn get_or_start(seed: impl FnOnce() -> crate::Result<Seed>) -> Result<Arc<MacroThread>, Outcome> {
    let mut state = STATE.lock();
    match &*state {
        State::Running(thread) => return Ok(Arc::clone(thread)),
        State::Failed(e) => return Err(Outcome::LoadFailed(*e)),
        State::Stopped => return Err(Outcome::NotRun),
        State::NotStarted => {}
    }
    match seed().and_then(start) {
        Ok(thread) => {
            *state = State::Running(Arc::clone(&thread));
            Ok(thread)
        }
        Err(e) => {
            *state = State::Failed(e);
            Err(Outcome::LoadFailed(e))
        }
    }
}

#[derive(Default)]
struct Startup {
    result: Guarded<Option<crate::Result<Arc<MacroThread>>>>,
    ready: ResetEvent,
}

impl Startup {
    fn finish(&self, result: crate::Result<Arc<MacroThread>>) {
        *self.result.lock() = Some(result);
        self.ready.set();
    }
}

fn start(seed: Seed) -> crate::Result<Arc<MacroThread>> {
    let startup = Arc::new(Startup::default());
    let join = {
        let startup = Arc::clone(&startup);
        std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || run_thread(seed, &startup))
            .map_err(|_| crate::Error::Jsc(bun_jsc::CrateError::ThreadSpawnFailed))?
    };
    startup.ready.wait();
    let started = startup.result.lock().take();
    match started.expect("the macro thread sets its result before it sets `ready`") {
        Ok(thread) => {
            *thread.join.lock() = Some(join);
            Ok(thread)
        }
        Err(e) => {
            let _ = join.join();
            Err(e)
        }
    }
}

fn run_thread(seed: Seed, startup: &Startup) {
    Output::Source::configure_named_thread(bun_core::zstr!("Macros"));
    // `bun build` has not initialized JSC when its first macro runs.
    jsc::initialize(jsc::InitializeOptions::default());
    // The VM's transpiler reads the level of this log: a quiet build does not print the `.env` files it loads.
    let mut log = Box::new(Log::init());
    log.level = seed.log_level;
    let log = bun_core::heap::into_raw(log);
    let vm_ptr = match VirtualMachine::init(InitOptions {
        transform_options: seed.transform_options,
        log: NonNull::new(log),
        owned_env_loader: seed.env,
        is_main_thread: false,
        ..Default::default()
    }) {
        Ok(vm) => vm,
        Err(e) => {
            // SAFETY: `log` is the box above, and no VM took it.
            unsafe { bun_core::heap::destroy(log) };
            return startup.finish(Err(e.into()));
        }
    };
    let vm = VirtualMachine::get();
    // The thread keeps the API lock for its whole life. `teardown_and_free` ends the VM under it.
    let _api_lock = core::mem::ManuallyDrop::new(vm.jsc_vm().get_api_lock());
    // `stop` terminates this VM from another thread. A VM makes the exception for that on its own thread.
    let _ = vm.jsc_vm().termination_exception();
    let macro_mode = MacroModeGuard::new(vm_ptr);
    vm.event_loop_mut().ensure_waker();
    match vm.as_mut().transpiler.configure_defines() {
        Ok(()) => {
            let running = Running {
                thread: Arc::new(MacroThread {
                    vm: vm.handle(),
                    id: std::thread::current().id(),
                    stopping: AtomicBool::new(false),
                    queue: Guarded::new(Queue {
                        open: true,
                        requests: VecDeque::new(),
                    }),
                    join: Guarded::new(None),
                }),
                vm: vm_ptr,
                waiting: RefCell::new(Vec::new()),
                calls_since_collection: Cell::new(0),
                collect_at_loop: Cell::new(false),
            };
            RUNNING.set(&raw const running);
            startup.finish(Ok(Arc::clone(&running.thread)));
            running.run();
            RUNNING.set(core::ptr::null());
        }
        Err(e) => startup.finish(Err(e.into())),
    }
    drop(macro_mode);
    // SAFETY: `vm_ptr` is this thread's VM, and the log it got above is its own to free. This
    // thread holds its API lock, and no request that could refer to the VM is left.
    unsafe { VirtualMachine::teardown_and_free(vm_ptr) };
}

impl MacroThread {
    /// Hands `work` to the macro thread and blocks until the thread answers.
    fn ask(&self, work: Work) -> Outcome {
        let mut request = Request {
            work,
            outcome: Outcome::NotRun,
            done: ResetEvent::default(),
        };
        let request = NonNull::from(&mut request);
        {
            let mut queue = self.queue.lock();
            if !queue.open {
                return Outcome::NotRun;
            }
            queue.requests.push_back(RequestPtr(request));
        }
        self.vm.wake();
        // SAFETY: `request` is the local above. The macro thread writes `outcome` before it
        // sets `done`, and touches neither after that.
        unsafe {
            (*request.as_ptr()).done.wait();
            core::mem::replace(&mut (*request.as_ptr()).outcome, Outcome::NotRun)
        }
    }
}

/// The macro thread's own state.
struct Running {
    thread: Arc<MacroThread>,
    vm: *mut VirtualMachine,
    waiting: RefCell<Vec<Waiting>>,
    calls_since_collection: Cell<u32>,
    /// A thread asked for a collection while a macro was on this thread's stack.
    collect_at_loop: Cell<bool>,
}

/// A call whose next step waits for `promise`.
struct Waiting {
    request: RequestPtr,
    call: NonNull<Call<'static>>,
    promise: AnyPromise,
    root: Strong,
    then: Then,
}

enum Then {
    /// The promise is the load of the macro's module. The call comes next.
    Call(*mut JSInternalPromise),
    /// The promise is what the macro returned.
    Convert(JsArgs),
}

#[derive(Clone, Copy)]
enum Level {
    /// No macro is on the thread's stack.
    Loop,
    /// Under a macro call on this thread that waits for a promise.
    Nested,
}

impl Running {
    fn stopping(&self) -> bool {
        self.thread.stopping.load(Ordering::Acquire)
    }

    fn run(&self) {
        let vm = VirtualMachine::get();
        // Between calls the loop has nothing else to wait for, and `auto_tick` would return at once.
        vm.event_loop_mut().ref_keep_alive();
        while !self.stopping() {
            if self.collect_at_loop.take() {
                self.collect_garbage();
            }
            let served = self.serve(Level::Loop);
            vm.event_loop_mut().tick();
            if self.serve(Level::Loop) || served || self.stopping() {
                continue;
            }
            vm.event_loop_mut().auto_tick();
        }
        vm.event_loop_mut().unref_keep_alive();
        self.close();
    }

    /// Starts the calls that arrived and continues the calls whose promise settled. Returns whether it found any.
    fn serve(&self, level: Level) -> bool {
        let mut served = false;
        while !self.stopping() {
            if let Some(request) = self.next_request() {
                self.start(request, level);
            } else if let Some(waiting) = self.next_settled() {
                self.resume(waiting);
            } else {
                break;
            }
            served = true;
        }
        served
    }

    fn next_request(&self) -> Option<RequestPtr> {
        self.thread.queue.lock().requests.pop_front()
    }

    fn next_settled(&self) -> Option<Waiting> {
        let mut waiting = self.waiting.borrow_mut();
        let settled = |w: &Waiting| w.promise.status() != PromiseStatus::Pending;
        let at = waiting.iter().position(settled)?;
        Some(waiting.remove(at))
    }

    fn start(&self, request: RequestPtr, level: Level) {
        // SAFETY: the thread that asks sleeps until `answer`.
        match unsafe { &request.0.as_ref().work } {
            Work::Call(call) => self.load(request, *call),
            Work::CollectGarbage => {
                match level {
                    Level::Loop => self.collect_garbage(),
                    // The loop collects later. The thread that asks does not wait for that: the macro can wait for that thread.
                    Level::Nested => self.collect_at_loop.set(true),
                }
                // `collect_garbage` waits for the answer and reads no outcome.
                self.answer(request, Outcome::NotRun);
            }
        }
    }

    fn collect_garbage(&self) {
        if self.calls_since_collection.replace(0) > 0 {
            VirtualMachine::get().jsc_vm().run_gc(true);
        }
    }

    fn resume(&self, waiting: Waiting) {
        let Waiting {
            request,
            call,
            root,
            then,
            ..
        } = waiting;
        match then {
            Then::Call(loaded) => self.loaded(request, call, loaded),
            Then::Convert(args) => self.convert(request, call, root.get(), args),
        }
    }

    /// Loads the macro's module if the context that asks needs that, then calls the macro.
    fn load(&self, request: RequestPtr, call_ptr: NonNull<Call<'static>>) {
        self.calls_since_collection
            .set(self.calls_since_collection.get() + 1);
        // SAFETY: the thread that asks sleeps until `answer`.
        let call = unsafe { call_ptr.as_ref() };
        if !call.load {
            return self.call(request, call_ptr);
        }
        // SAFETY: `self.vm` is this thread's VM.
        let started = unsafe {
            (*self.vm).start_macro_entry_point(
                call.entry_path,
                call.function_name,
                call.specifier,
                call.hash,
            )
        };
        let loaded = match started {
            Ok(loaded) => loaded,
            Err(e) => return self.finish(request, Outcome::LoadFailed(e.into())),
        };
        let promise = AnyPromise::Internal(loaded);
        if promise.status() != PromiseStatus::Pending {
            return self.loaded(request, call_ptr, loaded);
        }
        let global = VirtualMachine::get().global();
        self.waiting.borrow_mut().push(Waiting {
            request,
            call: call_ptr,
            promise,
            root: Strong::create(JSValue::from_cell(loaded), global),
            then: Then::Call(loaded),
        });
    }

    fn loaded(
        &self,
        request: RequestPtr,
        call: NonNull<Call<'static>>,
        loaded: *mut JSInternalPromise,
    ) {
        match Macro::finish_load(self.vm, loaded) {
            Ok(()) => self.call(request, call),
            Err(e) => self.finish(request, Outcome::LoadFailed(e)),
        }
    }

    fn call(&self, request: RequestPtr, call_ptr: NonNull<Call<'static>>) {
        // SAFETY: the thread that asks sleeps until `answer`.
        let call = unsafe { &mut *call_ptr.as_ptr() };
        let mut log = log_like(call.log);
        let args = Runner::arguments(
            &mut log,
            call.function_name,
            call.caller,
            call.source,
            JSValue::ZERO,
        );
        hand_over(&mut log, call.log);
        let args = match args {
            Ok(args) => args,
            Err(e) => return self.finish(request, Outcome::Failed(e.into())),
        };
        let Some(result) = Run::call(call.hash, &args.args) else {
            return self.answer(request, Outcome::Value(OwnedExpr::caller()));
        };
        let vm = VirtualMachine::get();
        let returned = result.as_any_promise();
        if let Some(promise) = returned {
            // `Run::convert` reports a rejection of it. The loop of this VM would report it once more.
            promise.set_handled(vm.jsc_vm());
        }
        let Some(promise) = returned.filter(|p| p.status() == PromiseStatus::Pending) else {
            return self.convert(request, call_ptr, result, args);
        };
        let global = vm.global();
        self.waiting.borrow_mut().push(Waiting {
            request,
            call: call_ptr,
            promise,
            root: Strong::create(result, global),
            then: Then::Convert(args),
        });
    }

    fn convert(
        &self,
        request: RequestPtr,
        call_ptr: NonNull<Call<'static>>,
        result: JSValue,
        args: JsArgs,
    ) {
        // SAFETY: the thread that asks sleeps until `answer`.
        let call = unsafe { &mut *call_ptr.as_ptr() };
        let outcome = {
            // The expression is made in memory that lasts until the copy below, and is gone before the answer.
            let arena = Arena::new();
            let mut ast_memory = ASTMemoryAllocator::borrowing(&arena);
            let _ast_scope = ast_memory.enter();
            let _store_guard = DisableStoreReset::new();
            let mut log = log_like(call.log);
            let macro_ = Macro {
                vm: NonNull::new(self.vm),
                disabled: false,
            };
            let converted =
                Run::convert(&macro_, &mut log, &arena, call.caller, call.source, result);
            drop(args);
            let outcome = match converted {
                Ok(expr) => Outcome::Value(OwnedExpr::copy(&expr, &call.caller)),
                Err(e) => Outcome::Failed(e.into()),
            };
            hand_over(&mut log, call.log);
            outcome
        };
        self.finish(request, outcome);
    }

    /// [`answer`](Self::answer) for a step that ran script: an exception that the step left pending is reported first.
    fn finish(&self, request: RequestPtr, outcome: Outcome) {
        let global = VirtualMachine::get().global();
        if let Some(exception) = global.try_take_exception() {
            // SAFETY: `self.vm` is this thread's VM.
            let _ = unsafe { (*self.vm).uncaught_exception(global, exception, false) };
        }
        self.answer(request, outcome);
    }

    fn answer(&self, request: RequestPtr, outcome: Outcome) {
        // What the macro printed goes out before the thread that asked goes on.
        Output::flush();
        // SAFETY: the thread that asks reads `outcome` after `done` is set. The request can be
        // gone as soon as it is set.
        unsafe {
            (*request.0.as_ptr()).outcome = outcome;
            (*request.0.as_ptr()).done.set();
        }
    }

    /// The thread stops. No call can arrive any more, and every call without an answer gets `NotRun`.
    fn close(&self) {
        let requests = {
            let mut queue = self.thread.queue.lock();
            queue.open = false;
            core::mem::take(&mut queue.requests)
        };
        for request in requests {
            self.answer(request, Outcome::NotRun);
        }
        for waiting in self.waiting.take() {
            self.answer(waiting.request, Outcome::NotRun);
        }
    }
}

/// A log for what one step of a call reports. It is empty and has the level of `log`.
fn log_like(log: &Log) -> Log {
    let mut like = Log::init();
    like.level = log.level;
    like
}

/// Moves the messages of `from` into `to` as copies that own their text, because `from` can refer to this thread's memory.
fn hand_over(from: &mut Log, to: &mut Log) {
    if !from.msgs.is_empty() {
        from.clone_to_with_recycled(to, true);
    }
}

/// A macro's result outside of any thread's AST memory: its nodes, a parent before its children.
#[derive(Default)]
pub(crate) struct OwnedExpr {
    nodes: Vec<Node>,
    /// The text of the 8-bit string nodes, in the order of the nodes.
    bytes: Vec<u8>,
    /// The text of the UTF-16 string nodes, in the order of the nodes.
    utf16: Vec<u16>,
}

enum Node {
    /// The macro call itself: the macro left it as it is.
    Caller,
    /// An expression that holds no pointer.
    Plain(Expr),
    /// Its text is the next `len` units of `bytes`, or of `utf16`.
    String {
        loc: Loc,
        len: usize,
        is_utf16: bool,
        prefer_template: bool,
        toml_datetime: Option<E::TomlDateTimeKind>,
    },
    /// `len` items follow.
    Array(Loc, u32, ListShape),
    /// `len` properties follow. Each one is a `Property`, then its key and its value if it has them.
    Object(Loc, u32, ListShape),
    Property {
        kind: G::PropertyKind,
        flags: bun_ast::flags::PropertySet,
        has_key: bool,
        has_value: bool,
    },
    /// The array or object that was the nth to start. The macro returned one value in two places.
    Again(u32),
}

/// The fields that `E::Array` and `E::Object` have besides their list.
#[derive(Clone, Copy)]
struct ListShape {
    comma_after_spread: Loc,
    close_loc: Loc,
    is_single_line: bool,
    is_parenthesized: bool,
    was_originally_macro: bool,
}

impl OwnedExpr {
    fn caller() -> OwnedExpr {
        OwnedExpr {
            nodes: vec![Node::Caller],
            ..Default::default()
        }
    }

    /// Copies `expr`, the result of the macro call at `caller`, out of this thread's AST memory.
    fn copy(expr: &Expr, caller: &Expr) -> OwnedExpr {
        let mut copier = Copier {
            out: OwnedExpr::default(),
            started: HashMap::default(),
            caller,
        };
        copier.copy(expr);
        copier.out
    }

    /// Makes the expression in this thread's AST memory, with its text in `bump`. `None`: it is nested too deeply for this thread's stack.
    pub(crate) fn to_expr(&self, bump: &Arena, caller: Expr) -> Option<Expr> {
        let mut builder = Builder {
            nodes: self.nodes.iter(),
            bytes: &self.bytes,
            utf16: &self.utf16,
            bump,
            caller,
            started: Vec::new(),
            stack: bun_core::StackCheck::init(),
        };
        builder.build()
    }
}

struct Copier<'a> {
    out: OwnedExpr,
    /// The arrays and objects whose copy started, by address, with their position among them.
    started: HashMap<usize, u32>,
    caller: &'a Expr,
}

impl Copier<'_> {
    // The depth is what `Run` just reached on this same stack with larger frames.
    fn copy(&mut self, expr: &Expr) {
        let loc = expr.loc;
        match &expr.data {
            ExprData::ECall(call) if self.is_caller(call.as_ptr()) => {
                self.out.nodes.push(Node::Caller);
            }
            ExprData::EUndefined(_)
            | ExprData::ENull(_)
            | ExprData::EBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EMissing(_) => self.out.nodes.push(Node::Plain(*expr)),
            ExprData::EString(string) => {
                let E::EString {
                    data,
                    next,
                    end: _,
                    rope_len: _,
                    prefer_template,
                    is_utf16,
                    toml_datetime,
                } = string.get();
                debug_assert!(next.is_none(), "a macro result has no string rope");
                let len = if *is_utf16 {
                    let units = string.get().slice16();
                    self.out.utf16.extend_from_slice(units);
                    units.len()
                } else {
                    self.out.bytes.extend_from_slice(data.slice());
                    data.slice().len()
                };
                self.out.nodes.push(Node::String {
                    loc,
                    len,
                    is_utf16: *is_utf16,
                    prefer_template: *prefer_template,
                    toml_datetime: *toml_datetime,
                });
            }
            ExprData::EArray(array) => {
                if self.again(array.as_ptr() as usize) {
                    return;
                }
                let E::Array {
                    items,
                    comma_after_spread,
                    is_single_line,
                    is_parenthesized,
                    was_originally_macro,
                    close_bracket_loc,
                } = array.get();
                let shape = ListShape {
                    comma_after_spread: *comma_after_spread,
                    close_loc: *close_bracket_loc,
                    is_single_line: *is_single_line,
                    is_parenthesized: *is_parenthesized,
                    was_originally_macro: *was_originally_macro,
                };
                self.out
                    .nodes
                    .push(Node::Array(loc, items.len_u32(), shape));
                for item in items.slice() {
                    self.copy(item);
                }
            }
            ExprData::EObject(object) => {
                if self.again(object.as_ptr() as usize) {
                    return;
                }
                let E::Object {
                    properties,
                    comma_after_spread,
                    is_single_line,
                    is_parenthesized,
                    was_originally_macro,
                    close_brace_loc,
                } = object.get();
                let shape = ListShape {
                    comma_after_spread: *comma_after_spread,
                    close_loc: *close_brace_loc,
                    is_single_line: *is_single_line,
                    is_parenthesized: *is_parenthesized,
                    was_originally_macro: *was_originally_macro,
                };
                self.out
                    .nodes
                    .push(Node::Object(loc, properties.len_u32(), shape));
                for property in properties.slice() {
                    let G::Property {
                        initializer,
                        kind,
                        flags,
                        class_static_block,
                        ts_decorators,
                        key,
                        value,
                        ts_metadata: _,
                    } = property;
                    debug_assert!(
                        initializer.is_none()
                            && class_static_block.is_none()
                            && ts_decorators.is_empty(),
                        "a macro result has only plain properties"
                    );
                    self.out.nodes.push(Node::Property {
                        kind: *kind,
                        flags: *flags,
                        has_key: key.is_some(),
                        has_value: value.is_some(),
                    });
                    for part in [key, value].into_iter().flatten() {
                        self.copy(part);
                    }
                }
            }
            other => unreachable!("a macro result has no {} node", other.tag_name()),
        }
    }

    fn is_caller(&self, call: *const E::Call) -> bool {
        matches!(&self.caller.data, ExprData::ECall(caller) if core::ptr::eq(caller.as_ptr(), call))
    }

    /// Whether the array or object at `address` started before. If so, this adds a reference to it.
    fn again(&mut self, address: usize) -> bool {
        let next = self.started.len() as u32;
        let nth = *self.started.entry(address).or_insert_with(|| next);
        if nth != next {
            self.out.nodes.push(Node::Again(nth));
        }
        nth != next
    }
}

struct Builder<'a> {
    nodes: core::slice::Iter<'a, Node>,
    /// What is left of the text of the string nodes.
    bytes: &'a [u8],
    utf16: &'a [u16],
    bump: &'a Arena,
    caller: Expr,
    /// The arrays and objects that started, in order.
    started: Vec<Expr>,
    stack: bun_core::StackCheck,
}

impl Builder<'_> {
    fn build(&mut self) -> Option<Expr> {
        if !self.stack.is_safe_to_recurse() {
            return None;
        }
        Some(
            match self.nodes.next().expect("a node for every expression") {
                Node::Caller => self.caller,
                Node::Plain(expr) => *expr,
                Node::String {
                    loc,
                    len,
                    is_utf16,
                    prefer_template,
                    toml_datetime,
                } => {
                    let text = if *is_utf16 {
                        let (units, rest) = self.utf16.split_at(*len);
                        self.utf16 = rest;
                        E::EString::init_utf16(self.bump.alloc_slice_copy(units))
                    } else {
                        let (bytes, rest) = self.bytes.split_at(*len);
                        self.bytes = rest;
                        E::EString::init(self.bump.alloc_slice_copy(bytes))
                    };
                    Expr::init(
                        E::EString {
                            prefer_template: *prefer_template,
                            toml_datetime: *toml_datetime,
                            ..text
                        },
                        *loc,
                    )
                }
                Node::Array(loc, len, shape) => {
                    let expr = Expr::init(
                        E::Array {
                            items: bun_alloc::AstAlloc::vec(),
                            comma_after_spread: shape.comma_after_spread,
                            is_single_line: shape.is_single_line,
                            is_parenthesized: shape.is_parenthesized,
                            was_originally_macro: shape.was_originally_macro,
                            close_bracket_loc: shape.close_loc,
                        },
                        *loc,
                    );
                    self.started.push(expr);
                    let mut items = ExprNodeList::init_capacity(*len as usize);
                    for _ in 0..*len {
                        VecExt::append(&mut items, self.build()?);
                    }
                    if let ExprData::EArray(mut array) = expr.data {
                        array.items = items;
                    }
                    expr
                }
                Node::Object(loc, len, shape) => {
                    let expr = Expr::init(
                        E::Object {
                            properties: bun_alloc::AstAlloc::vec(),
                            comma_after_spread: shape.comma_after_spread,
                            is_single_line: shape.is_single_line,
                            is_parenthesized: shape.is_parenthesized,
                            was_originally_macro: shape.was_originally_macro,
                            close_brace_loc: shape.close_loc,
                        },
                        *loc,
                    );
                    self.started.push(expr);
                    let mut properties = G::PropertyList::init_capacity(*len as usize);
                    for _ in 0..*len {
                        let Some(Node::Property {
                            kind,
                            flags,
                            has_key,
                            has_value,
                        }) = self.nodes.next()
                        else {
                            unreachable!("a `Property` node for every property");
                        };
                        let key = if *has_key { Some(self.build()?) } else { None };
                        let value = if *has_value {
                            Some(self.build()?)
                        } else {
                            None
                        };
                        VecExt::append(
                            &mut properties,
                            G::Property {
                                kind: *kind,
                                flags: *flags,
                                key,
                                value,
                                ..Default::default()
                            },
                        );
                    }
                    if let ExprData::EObject(mut object) = expr.data {
                        object.properties = properties;
                    }
                    expr
                }
                Node::Again(nth) => self.started[*nth as usize],
                Node::Property { .. } => unreachable!("a `Property` node follows an `Object` node"),
            },
        )
    }
}

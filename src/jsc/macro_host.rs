//! The thread that runs macros, in a VM of its own. Whoever parses sleeps until it answers.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use bstr::BStr;
use bun_ast::ToJSError;
use bun_bundler::options::{Env, TransformOptions};
use bun_bundler::transpiler::MacroThread;
use bun_collections::{ArrayHashMap, AutoBitSet, HashMap, StringHashMap};
use bun_core::{Output, StringView, WTFStringImplExt as _, handle_oom};
use bun_dotenv::{Loader, Map};
use bun_event_loop::{BoxedTask, ContextId, Task, TaskTag, task_tag};
use bun_ptr::JsCell;
use bun_resolver::StandaloneModuleGraph;
use bun_threading::{Futex, Guarded};
use bun_watcher::Watcher;

use crate::ConsoleObject::formatter::Tag;
use crate::bindgen::{self, JsLocal, JsScope};
use crate::generated_bindgen::macro_host::Bun__MacroHost__onSettled;
use crate::js_promise::Status;
use crate::virtual_machine::{ExitHandler, InitOptions, VirtualMachine, runtime_hooks};
use crate::web_worker::ReservedPages;
use crate::{
    AnyPromise, BuildMessage, JSArrayIterator, JSGlobalObject, JSModuleLoader, JSPropertyIterator,
    JSPropertyIteratorOptions, JSType, JSValue, JsError, JsResult, ProtectedJSValue,
    ResolveMessage, Stopped, Strong, VmHandle, WebCore, cpp,
};

/// A macro can transpile code that calls macros, which run on a thread of their own.
const MAX_NESTED_THREADS: u8 = 8;
const MAX_NESTED_VALUES: usize = 1 << 13;

// ── what crosses threads ──────────────────────────────────────────────────

/// Makes the arguments of a call, on the macro thread.
pub type Arguments<'a> =
    dyn Fn(&JSGlobalObject) -> Result<Vec<ProtectedJSValue>, ToJSError> + Sync + 'a;

/// A part of what a macro returned. The first is the value itself, and a `u32` is the index of another.
pub enum Node {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(Box<[u16]>),
    Array(Vec<u32>),
    Object(Vec<(Box<[u8]>, u32)>),
    Blob {
        bytes: Box<[u8]>,
        content_type: Box<[u8]>,
    },
}

pub enum Failure {
    /// The error has been printed.
    Threw,
    /// The error has been printed.
    Load,
    Arguments(ToJSError),
    Message(Box<[u8]>),
}

impl Failure {
    fn message(text: core::fmt::Arguments<'_>) -> Failure {
        Failure::Message(text.to_string().into_bytes().into())
    }
}

/// A structured clone. `to_js` is named where the clone is made, so that `--trim` can remove it with that code.
pub struct CopiedValue {
    pub bytes: Box<[u8]>,
    pub to_js: fn(&[u8], &JSGlobalObject) -> JsResult<JSValue>,
}

pub struct VmOptions {
    pub transform_options: TransformOptions,
    pub env: Loader,
    pub watcher: Option<Arc<Watcher>>,
}

struct EnvEdit {
    name: Box<[u8]>,
    /// `None` deletes it.
    value: Option<Box<[u8]>>,
}

struct Call {
    specifier: Box<[u8]>,
    name: Box<[u8]>,
    /// Borrowed from the caller, which clears this before it returns.
    arguments: Guarded<Option<&'static Arguments<'static>>>,
    answer: Guarded<Option<Result<Vec<Node>, Failure>>>,
    is_over: AtomicU32,
    caller_runs_script: bool,
}

/// Wakes the caller when dropped.
struct Sleeper(Arc<Call>);

impl Drop for Sleeper {
    fn drop(&mut self) {
        let call = &*self.0;
        call.is_over.store(1, Ordering::SeqCst);
        if call.caller_runs_script {
            // SAFETY: only the address is used.
            unsafe { cpp::Bun__MacroHost__wake(call.is_over.as_ptr().cast()) };
        } else {
            Futex::wake(&call.is_over, 1);
        }
    }
}

pub struct Message(Event);

enum Event {
    Call(Sleeper),
    Env(Vec<EnvEdit>),
    Release,
    /// From the thread to itself.
    Wake,
    /// For the owner.
    Exit,
    /// For the owner.
    Ended(Arc<Shared>),
}

impl BoxedTask for Message {
    const TAG: TaskTag = task_tag::MacroHostMessage;
    fn release_unrun(self: Box<Self>) {}
    fn context(&self) -> ContextId {
        ContextId::NONE
    }
}

impl Message {
    pub fn run(self) -> JsResult<()> {
        let vm = VirtualMachine::get();
        let host = || vm.macro_host.as_deref().expect("sent to a macro thread");
        match self.0 {
            Event::Ended(shared) => vm.macro_hosts.join(&shared),
            _ if !vm.script_allowed() => {}
            Event::Call(sleeper) => return host().start_call(vm, sleeper),
            Event::Env(edits) => return edit_env_object(vm.global(), &edits),
            Event::Release => host().is_released.set(true),
            Event::Wake => host().wake_answered(),
            Event::Exit => vm.macro_hosts.exit_if_asked(vm),
        }
        Ok(())
    }
}

// ── the handle ────────────────────────────────────────────────────────────

struct Shared {
    /// The VM whose script asked for the code that calls the macros.
    owner: Option<VmHandle>,
    is_build: bool,
    refusal: Option<&'static str>,
    depth: u8,
    state: Guarded<State>,
}

struct State {
    /// Until the first call starts the thread.
    seed: Option<Seed>,
    phase: Phase,
    thread: Option<JoinHandle<()>>,
    /// What a macro passed to `process.exit()`, until the owner exits with it.
    exit_code: Option<u8>,
}

enum Phase {
    Starting(Vec<Event>),
    Running(VmHandle),
    /// Takes no events, but can be running 'exit' listeners.
    Exiting(VmHandle),
    Stopped,
}

/// What the thread takes over from its owner.
#[derive(Default)]
struct Seed {
    /// A build brings its own with the first call.
    options: Option<VmOptions>,
    /// For the `env` of a build, which decides what `process.env.NODE_ENV` is replaced with.
    env_edits: Vec<EnvEdit>,
    env_options: Option<Env>,
    graph: Option<&'static dyn StandaloneModuleGraph>,
    main: Option<Box<[u8]>>,
    argv: Box<[Box<[u8]>]>,
    smol: bool,
    no_macros: bool,
    allow_addons: Option<bool>,
    allow_ffi_cc: Option<bool>,
    dns_result_order: u8,
    runs_no_compiled_program: bool,
}

impl Shared {
    fn new(owner: Option<&VirtualMachine>, is_build: bool, seed: Seed) -> Arc<Shared> {
        let outer = owner.and_then(|vm| vm.macro_host.as_deref());
        let depth = outer.map_or(0, |host| host.shared.depth + 1);
        Arc::new(Shared {
            owner: owner.map(VirtualMachine::handle),
            is_build,
            refusal: refusal(depth),
            depth,
            state: Guarded::new(State {
                seed: Some(seed),
                phase: Phase::Starting(Vec::new()),
                thread: None,
                exit_code: None,
            }),
        })
    }

    fn start(self: &Arc<Self>, build_options: &dyn Fn() -> VmOptions) -> Result<(), Failure> {
        let mut state = self.state.lock();
        let Some(mut seed) = state.seed.take() else {
            return Ok(());
        };
        let options = seed.options.take().unwrap_or_else(|| {
            let mut options = build_options();
            // Only `bun build --watch` does something about a file that is not in the bundle.
            options.watcher.take_if(|_| self.owner.is_some());
            edit_env_map(&mut options.env.map, &seed.env_edits);
            let flags = &mut options.transform_options;
            flags.allow_addons = seed.allow_addons.or(flags.allow_addons);
            flags.allow_ffi_cc = seed.allow_ffi_cc.or(flags.allow_ffi_cc);
            options
        });
        let spawned = match ReservedPages::try_new(false) {
            None => Err(std::io::ErrorKind::OutOfMemory.into()),
            Some(pages) => {
                let start = Start {
                    shared: Arc::clone(self),
                    options,
                    seed,
                    pages,
                };
                std::thread::Builder::new()
                    .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
                    .spawn(move || start.run())
            }
        };
        match spawned {
            Ok(thread) => {
                state.thread = Some(thread);
                Ok(())
            }
            Err(err) => {
                state.phase = Phase::Stopped;
                Err(Failure::message(format_args!(
                    "Failed to start the thread that runs macros: {err}"
                )))
            }
        }
    }

    fn send(&self, event: Event) {
        match &mut self.state.lock().phase {
            Phase::Starting(queue) => queue.push(event),
            Phase::Running(handle) => drop(handle.post(Box::new(Message(event)))),
            Phase::Exiting(_) | Phase::Stopped => {}
        }
    }

    fn tell_owner(&self, event: Event) {
        if let Some(owner) = &self.owner {
            drop(owner.post(Box::new(Message(event))));
        }
    }

    /// Ends whatever the thread is running.
    fn stop(&self) {
        let mut state = self.state.lock();
        state.seed = None;
        if let Phase::Running(handle) | Phase::Exiting(handle) =
            core::mem::replace(&mut state.phase, Phase::Stopped)
        {
            handle.request_termination();
        }
    }

    fn join(&self) {
        let thread = self.state.lock().thread.take();
        if let Some(thread) = thread {
            let _ = thread.join();
        }
    }

    /// There is no thread, and there will be none.
    fn is_over(&self) -> bool {
        let state = self.state.lock();
        matches!(state.phase, Phase::Stopped) && state.thread.is_none()
    }
}

fn refusal(depth: u8) -> Option<&'static str> {
    use crate::compiled_program::{admits_unknown_javascript, compiled_program};
    if compiled_program().is_some_and(|program| !admits_unknown_javascript(program)) {
        Some(
            "Macros cannot be used in this executable, which only runs code that was compiled into it",
        )
    } else if bun_core::code_generation_from_strings()
        == bun_core::CodeGenerationFromStrings::Strict
    {
        Some("Macros cannot be used with --disallow-code-generation-from-strings=strict")
    } else if depth == MAX_NESTED_THREADS {
        Some("Macros that transpile calls of other macros are nested too deeply")
    } else {
        None
    }
}

/// What a [`MacroThread`] holds.
pub struct MacroHost(Arc<Shared>);

impl MacroHost {
    pub fn of(thread: &MacroThread) -> &MacroHost {
        thread.host(|| MacroHost(Shared::new(None, true, Seed::default())))
    }

    pub fn refusal(&self) -> Option<&'static str> {
        self.0.refusal
    }

    /// Sleeps until the macro has returned and its promises have settled.
    pub fn call(
        &self,
        specifier: &[u8],
        name: &[u8],
        arguments: &Arguments<'_>,
        build_options: &dyn Fn() -> VmOptions,
    ) -> Result<Vec<Node>, Failure> {
        self.0.start(build_options)?;
        let vm = VirtualMachine::get_or_null();
        // SAFETY: only used under the lock of `Call::arguments`, which `_lent` empties.
        let arguments = unsafe {
            core::mem::transmute::<&Arguments<'_>, &'static Arguments<'static>>(arguments)
        };
        let call = Arc::new(Call {
            specifier: specifier.into(),
            name: name.into(),
            arguments: Guarded::new(Some(arguments)),
            answer: Guarded::new(None),
            is_over: AtomicU32::new(0),
            caller_runs_script: vm.is_some(),
        });
        let _lent = scopeguard::guard(&call, |call| *call.arguments.lock() = None);
        self.0.send(Event::Call(Sleeper(Arc::clone(&call))));

        let is_over = || call.is_over.load(Ordering::SeqCst) != 0;
        match vm {
            _ if is_over() => {}
            Some(vm) => {
                let word = call.is_over.as_ptr().cast();
                // SAFETY: `call` outlives the wait, which reads the word atomically.
                if unsafe { cpp::Bun__MacroHost__wait(vm.global(), word) }.is_err() && !is_over() {
                    self.0.stop();
                }
            }
            None => {
                while !is_over() {
                    Futex::wait_forever(&call.is_over, 0);
                }
            }
        }
        // The thread is about to end the process.
        while self.0.owner.is_none() && self.0.state.lock().exit_code.is_some() {
            std::thread::park();
        }
        let answer = call.answer.lock().take();
        answer.unwrap_or_else(|| {
            Err(Failure::message(format_args!(
                "The thread that runs macros stopped before this macro finished"
            )))
        })
    }
}

impl Drop for MacroHost {
    fn drop(&mut self) {
        if self.0.state.lock().seed.is_some() {
            return self.0.stop();
        }
        self.0.send(Event::Release);
        if self.0.owner.is_none() {
            self.0.join();
        }
    }
}

// ── the owner's side ──────────────────────────────────────────────────────

#[derive(Default)]
pub(crate) struct OwnedHosts {
    program: JsCell<Option<Program>>,
    all: JsCell<Vec<Arc<Shared>>>,
}

struct Program {
    thread: MacroThread,
    /// `process.env` as the thread was last told.
    env: Map,
}

impl OwnedHosts {
    fn add(&self, vm: &VirtualMachine, seed: Seed) -> MacroThread {
        let shared = Shared::new(Some(vm), seed.options.is_none(), seed);
        if !vm.script_allowed() {
            shared.stop();
        }
        self.all.with_mut(|all| {
            all.retain(|other| !other.is_over());
            all.push(Arc::clone(&shared));
        });
        let thread = MacroThread::default();
        thread.host(|| MacroHost(shared));
        thread
    }

    fn join(&self, shared: &Arc<Shared>) {
        shared.join();
        (self.all).with_mut(|all| all.retain(|other| !Arc::ptr_eq(other, shared)));
    }

    /// The next macro starts afresh.
    pub(crate) fn release_program(&self) {
        drop(self.program.take());
    }

    /// `bun test --isolate` is done with a file.
    pub(crate) fn stop_for_next_test_file(&self, keeps_program: bool) {
        for shared in self.all.get() {
            if shared.is_build || !keeps_program {
                shared.stop();
            }
        }
    }

    pub(crate) fn stop_all(&self) {
        let all = self.all.take();
        all.iter().for_each(|shared| shared.stop());
        all.iter().for_each(|shared| shared.join());
    }

    fn exit_if_asked(&self, vm: &VirtualMachine) {
        let mut all = self.all.get().iter();
        let Some(code) = all.find_map(|it| it.state.lock().exit_code.take()) else {
            return;
        };
        vm.exit_handler.exit_code.set(code);
        ExitHandler::dispatch_on_exit(vm);
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        (hooks.process_exit)(vm.global(), vm.exit_handler.exit_code.get());
    }
}

impl Seed {
    fn of(vm: &VirtualMachine, options: Option<VmOptions>, env_edits: Vec<EnvEdit>) -> Seed {
        let transpiler = vm.transpiler.get();
        Seed {
            graph: vm.standalone_module_graph.filter(|_| options.is_some()),
            options,
            env_edits,
            env_options: Some(transpiler.options.env.clone()),
            main: vm.main().map(Box::from),
            argv: match vm.worker_ref() {
                Some(worker) => (worker.argv().iter())
                    // SAFETY: the Worker keeps its options alive.
                    .map(|&arg| unsafe { &*arg }.to_owned_slice_z().as_bytes().into())
                    .collect(),
                None => vm.argv.into(),
            },
            smol: vm.smol,
            no_macros: transpiler.options.no_macros,
            allow_addons: transpiler.options.transform_options.allow_addons,
            allow_ffi_cc: transpiler.options.transform_options.allow_ffi_cc,
            dns_result_order: vm.dns_result_order.get(),
            runs_no_compiled_program: bun_core::runs_no_compiled_program(),
        }
    }
}

impl VirtualMachine {
    /// For the code that this VM loads or transpiles. Not during a parse.
    pub fn macro_thread(&self) -> MacroThread {
        let hosts = &self.macro_hosts;
        let mut program = hosts.program.take();
        program.take_if(|program| {
            let state = MacroHost::of(&program.thread).0.state.lock();
            matches!(state.phase, Phase::Exiting(_) | Phase::Stopped)
        });
        let mut program = program.unwrap_or_else(|| {
            let transpiler = self.transpiler.get();
            let options = VmOptions {
                transform_options: (*transpiler.options.transform_options).clone(),
                env: handle_oom(self.env_loader().clone_loaded()),
                watcher: transpiler.resolver.watcher.clone(),
            };
            Program {
                env: handle_oom(options.env.map.clone_with_allocator()),
                thread: hosts.add(self, Seed::of(self, Some(options), Vec::new())),
            }
        });
        let edits = env_edits_since(self.global(), &program.env);
        if !edits.is_empty() {
            edit_env_map(&mut program.env, &edits);
            MacroHost::of(&program.thread).0.send(Event::Env(edits));
        }
        let thread = program.thread.clone();
        hosts.program.set(Some(program));
        thread
    }

    /// For one bundle.
    pub fn macro_thread_for_build(&self) -> MacroThread {
        let edits = env_edits_since(self.global(), &self.env_loader().map);
        self.macro_hosts.add(self, Seed::of(self, None, edits))
    }

    /// After a parse that ran macros for this VM. `Err`: script is being terminated.
    pub fn did_run_macros(&self) -> JsResult<()> {
        self.macro_hosts.exit_if_asked(self);
        let global = self.global();
        cpp::Bun__MacroHost__forgetWorkingDirectory(global);
        if global.vm().is_entered()
            && (global.has_pending_termination_exception() || !self.script_allowed())
        {
            return Err(Stopped.throw(global));
        }
        Ok(())
    }

    /// `process.exit()` in a macro is that of whoever the macro runs for. `false` on any other thread.
    pub fn exit_from_macro(&self, code: u8) -> bool {
        let Some(host) = self.macro_host.as_deref() else {
            return false;
        };
        if self.script_allowed() && !self.is_shutting_down() {
            self.flush_writes_for_exit();
            host.shared.state.lock().exit_code = Some(code);
            host.shared.tell_owner(Event::Exit);
            self.handle_ref().request_termination();
        }
        true
    }
}

// ── process.env ───────────────────────────────────────────────────────────

type VisitEnvVar = extern "C" fn(*mut c_void, &bun_core::String, &bun_core::String);

unsafe extern "C" {
    fn Bun__MacroHost__forEachEnvVar(
        global: &JSGlobalObject,
        context: *mut c_void,
        visit: VisitEnvVar,
    ) -> bool;
}

/// What makes `base` equal to `process.env`. Runs no script.
fn env_edits_since(global: &JSGlobalObject, base: &Map) -> Vec<EnvEdit> {
    struct Diff<'a> {
        base: &'a Map,
        seen: AutoBitSet,
        edits: Vec<EnvEdit>,
    }
    extern "C" fn visit(diff: *mut c_void, name: &bun_core::String, value: &bun_core::String) {
        // SAFETY: the `Diff` below, which nothing else uses during the call.
        let diff = unsafe { &mut *diff.cast::<Diff<'_>>() };
        let (name, value) = (name.to_utf8(), value.to_utf8());
        if let Some(index) = diff.base.map.get_index(&name) {
            diff.seen.set(index);
            if *diff.base.map.values()[index].value == *value {
                return;
            }
        }
        diff.edits.push(EnvEdit {
            name: Box::from(&*name),
            value: Some(Box::from(&*value)),
        });
    }

    let names = base.map.keys();
    let mut diff = Diff {
        base,
        seen: handle_oom(AutoBitSet::init_empty(names.len())),
        edits: Vec::new(),
    };
    // SAFETY: `visit` is only called during the call.
    if !unsafe { Bun__MacroHost__forEachEnvVar(global, (&raw mut diff).cast(), visit) } {
        return Vec::new();
    }
    for (index, name) in names.iter().enumerate() {
        if !diff.seen.is_set(index) {
            diff.edits.push(EnvEdit {
                name: name.clone(),
                value: None,
            });
        }
    }
    diff.edits
}

fn edit_env_map(map: &mut Map, edits: &[EnvEdit]) {
    for edit in edits {
        match &edit.value {
            Some(value) => handle_oom(map.put(&edit.name, value)),
            None => map.remove(&edit.name),
        }
    }
}

fn edit_env_object(global: &JSGlobalObject, edits: &[EnvEdit]) -> JsResult<()> {
    for edit in edits {
        let name = bun_core::String::clone_utf8(&edit.name);
        let value =
            (edit.value.as_deref()).map_or(bun_core::String::DEAD, bun_core::String::clone_utf8);
        // SAFETY: both outlive the call.
        unsafe { cpp::Bun__MacroHost__setEnvVar(global, &raw const name, &raw const value) }?;
    }
    Ok(())
}

// ── the thread ────────────────────────────────────────────────────────────

struct Start {
    shared: Arc<Shared>,
    options: VmOptions,
    seed: Seed,
    pages: ReservedPages,
}

impl Start {
    fn run(self) {
        let Start {
            shared,
            options,
            seed,
            pages,
        } = self;
        let VmOptions {
            transform_options,
            mut env,
            watcher,
        } = options;
        Output::Source::configure_named_thread(bun_core::zstr!("Bun Macros"));
        let pages = pages.adopt();
        bun_analytics::features::macros.fetch_add(1, Ordering::Relaxed);
        crate::initialize(Default::default());
        if seed.runs_no_compiled_program {
            crate::compiled_program::use_no_image_on_this_thread(b"");
        }

        let mut log = bun_ast::Log::init();
        let options = InitOptions {
            transform_options,
            env_loader: Some(NonNull::from(&mut env)),
            graph: seed.graph,
            smol: seed.smol,
            mini_mode: seed.smol,
            // SAFETY: `seed` outlives the VM, which is freed below.
            argv: unsafe { bun_ptr::detach_lifetime(&seed.argv) },
            macro_host: Some(Box::new(HostThread::new(Arc::clone(&shared)))),
            ..Default::default()
        };
        let mut holds_owner = false;
        match VirtualMachine::init(&raw mut log, options) {
            Ok(vm) => {
                // Never released: `exit_and_free` frees the VM, and the lock with it.
                let _lock = ManuallyDrop::new(vm.global().vm().get_api_lock());
                let host = vm.macro_host.as_deref().expect("passed to init");
                match configure(vm, &seed, shared.is_build, watcher) {
                    Ok(()) => {
                        pages.did_start();
                        host.run(vm);
                    }
                    Err(err) => report_failed_start(vm.log_mut(), err.name()),
                }
                holds_owner = host.finish();
                // SAFETY: `init` made it on this thread, which holds its lock. Other threads only have its handle.
                unsafe { VirtualMachine::exit_and_free(VirtualMachine::get_mut_ptr()) };
            }
            Err(err) => {
                report_failed_start(Some(&mut log), err.name());
                shared.stop();
            }
        }

        let Some(owner) = &shared.owner else {
            let exit_code = shared.state.lock().exit_code;
            if let Some(code) = exit_code {
                bun_core::Global::exit(u32::from(code));
            }
            return;
        };
        shared.tell_owner(Event::Ended(Arc::clone(&shared)));
        if holds_owner {
            owner.add_keep_alive(-1);
        }
    }
}

fn configure(
    vm: &VirtualMachine,
    seed: &Seed,
    is_build: bool,
    watcher: Option<Arc<Watcher>>,
) -> bun_bundler::Result<()> {
    // Other threads can only terminate a VM that has this.
    vm.jsc_vm().termination_exception();
    vm.on_unhandled_rejection.set(print_unhandled_error);
    vm.transpiler_store.enabled.set(false);
    vm.has_loaded.set(true);
    vm.set_main(seed.main.as_deref());
    vm.dns_result_order.set(seed.dns_result_order);
    vm.transpiler.with_mut(|t| {
        t.resolver.env_loader = NonNull::new(t.env);
        t.resolver.standalone_module_graph = seed.graph;
        t.resolver.watcher = watcher;
        t.options.no_macros = seed.no_macros;
        if let Some(graph) = seed.graph {
            let hooks = runtime_hooks().expect("RuntimeHooks not installed");
            // SAFETY: the graph of this executable.
            unsafe { (hooks.apply_standalone_runtime_flags)(t, graph) };
        }
        match &seed.env_options {
            Some(owners) if !is_build => {
                t.options.env = owners.clone();
                t.options.env.disable_default_env_files = true;
            }
            owners => {
                t.options.env.disable_default_env_files |=
                    (owners.as_ref()).is_some_and(|it| it.disable_default_env_files);
                t.options.target = bun_ast::Target::BunMacro;
            }
        }
        t.configure_defines()?;
        t.options.target = bun_ast::Target::BunMacro;
        Ok::<(), bun_bundler::Error>(())
    })?;
    vm.load_extra_env();
    Ok(())
}

#[cold]
fn report_failed_start(log: Option<&mut bun_ast::Log>, error_name: &str) {
    if let Some(log) = log {
        let _ = log.print(Output::error_writer());
    }
    Output::err(
        error_name,
        "Failed to start the thread that runs macros",
        (),
    );
    Output::flush();
}

/// An error that belongs to no call stops nothing.
fn print_unhandled_error(vm: &VirtualMachine, _: &JSGlobalObject, error: JSValue) {
    vm.run_error_handler(error, None);
    vm.unhandled_error_counter.set(0);
}

pub struct HostThread {
    shared: Arc<Shared>,
    modules: JsCell<StringHashMap<Module>>,
    /// By the context of the reaction that resumes them.
    suspended: JsCell<ArrayHashMap<u32, Suspended>>,
    next_id: Cell<u32>,
    answered: JsCell<Vec<Sleeper>>,
    holds_owner: Cell<bool>,
    is_released: Cell<bool>,
}

struct Module {
    promise: Strong,
    did_print_error: Cell<bool>,
}

struct Suspended {
    invocation: Invocation,
    promise: Strong,
}

struct Invocation {
    sleeper: Sleeper,
    /// `None` until the macro has been called.
    conversion: Option<Conversion>,
}

/// Why an [`Invocation`] has no result.
enum Interruption {
    Pending(AnyPromise),
    Failed(Failure),
    Js(JsError),
}

impl From<JsError> for Interruption {
    fn from(err: JsError) -> Self {
        Interruption::Js(err)
    }
}

impl From<Failure> for Interruption {
    fn from(failure: Failure) -> Self {
        Interruption::Failed(failure)
    }
}

impl HostThread {
    fn new(shared: Arc<Shared>) -> HostThread {
        HostThread {
            shared,
            modules: JsCell::default(),
            suspended: JsCell::default(),
            next_id: Cell::new(0),
            answered: JsCell::default(),
            holds_owner: Cell::new(false),
            is_released: Cell::new(false),
        }
    }

    fn run(&self, vm: &VirtualMachine) {
        {
            let mut state = self.shared.state.lock();
            let Phase::Starting(queue) = &mut state.phase else {
                return vm.handle_ref().stop();
            };
            for event in core::mem::take(queue) {
                vm.enqueue_task(Task::from_boxed(Box::new(Message(event))));
            }
            state.phase = Phase::Running(vm.handle());
        }

        let event_loop = vm.event_loop();
        loop {
            vm.tick();
            if !vm.script_allowed() || self.is_released.get() {
                return;
            }
            if !self.suspended.get().is_empty() {
                if vm.handle_ref().tickets_outstanding() == 0 && !vm.has_work_left() {
                    self.fail_suspended(vm);
                    continue;
                }
            } else if !self.shared.is_build && !has_work_in_flight(vm) {
                self.hold_owner(false);
            }
            // They run before the poll, which must not sleep on what was decided above.
            if event_loop.immediate_task_count() > 0 {
                event_loop.wakeup();
            }
            event_loop.auto_tick_asleep();
        }
    }

    /// Returns whether the owner is still held.
    fn finish(&self) -> bool {
        {
            let phase = &mut self.shared.state.lock().phase;
            *phase = match core::mem::replace(phase, Phase::Stopped) {
                Phase::Running(handle) => Phase::Exiting(handle),
                _ => Phase::Stopped,
            };
        }
        self.wake_answered();
        drop(self.suspended.take());
        drop(self.modules.take());
        self.holds_owner.get()
    }

    fn hold_owner(&self, holds: bool) {
        if let Some(owner) = &self.shared.owner
            && self.holds_owner.replace(holds) != holds
        {
            owner.add_keep_alive(if holds { 1 } else { -1 });
        }
    }

    fn start_call(&self, vm: &VirtualMachine, sleeper: Sleeper) -> JsResult<()> {
        self.wake_answered();
        self.hold_owner(true);
        cpp::Bun__MacroHost__forgetWorkingDirectory(vm.global());
        let module = self.import(vm.global(), &sleeper.0.specifier);
        let invocation = Invocation {
            sleeper,
            conversion: None,
        };
        match module {
            Ok(module) => self.advance(vm, invocation, module),
            Err(err) => {
                print_exception(vm, err)?;
                self.answer(vm, invocation.sleeper, Err(Failure::Load));
                Ok(())
            }
        }
    }

    fn import(&self, global: &JSGlobalObject, specifier: &[u8]) -> JsResult<JSValue> {
        if let Some(module) = self.modules.get().get(specifier) {
            return Ok(module.promise.get());
        }
        let promise = JSModuleLoader::import_ptr(global, &StringView::from_bytes(specifier))?;
        let promise = AnyPromise::Internal(promise.as_ptr()).as_value();
        let module = Module {
            promise: Strong::create(promise, global),
            did_print_error: Cell::new(false),
        };
        handle_oom((self.modules).with_mut(|modules| modules.put(specifier, module)));
        Ok(promise)
    }

    /// `promise`: what `invocation` cannot go on without. `Err`: the thread is being stopped.
    fn advance(
        &self,
        vm: &VirtualMachine,
        mut invocation: Invocation,
        promise: JSValue,
    ) -> JsResult<()> {
        let result = match &mut invocation.conversion {
            Some(conversion) => conversion.run(vm, promise),
            None => self
                .call_macro(vm, &invocation.sleeper.0, promise)
                .and_then(|value| (invocation.conversion.get_or_insert_default()).run(vm, value)),
        };
        let answer = match result {
            Ok(nodes) => Ok(nodes),
            Err(Interruption::Failed(failure)) => Err(failure),
            Err(Interruption::Js(err)) => {
                print_exception(vm, err)?;
                Err(Failure::Threw)
            }
            Err(Interruption::Pending(promise)) => {
                self.suspend(vm.global(), invocation, promise.as_value());
                return Ok(());
            }
        };
        self.answer(vm, invocation.sleeper, answer);
        Ok(())
    }

    fn call_macro(
        &self,
        vm: &VirtualMachine,
        call: &Call,
        module: JSValue,
    ) -> Result<JSValue, Interruption> {
        let global = vm.global();
        let module = module.as_any_promise().expect("made by import");
        let exports = match module.status() {
            Status::Pending => return Err(Interruption::Pending(module)),
            Status::Fulfilled => module.result(vm.jsc_vm()),
            Status::Rejected => {
                module.set_handled(vm.jsc_vm());
                let entry = self.modules.get().get(&*call.specifier);
                if !entry.is_some_and(|it| it.did_print_error.replace(true)) {
                    vm.run_error_handler(module.result(vm.jsc_vm()), None);
                }
                return Err(Failure::Load.into());
            }
        };
        let fail_to_load = |message: core::fmt::Arguments<'_>| {
            vm.run_error_handler(global.create_error_instance(message), None);
            Err(Failure::Load.into())
        };
        let Some(function) = exports.get_own(global, &StringView::from_bytes(&call.name))? else {
            return fail_to_load(format_args!(
                "Macro '{}' not found in '{}'",
                BStr::new(&call.name),
                BStr::new(&call.specifier)
            ));
        };
        if !function.is_callable() {
            return fail_to_load(format_args!("Macro must be a function"));
        }

        let arguments = match (*call.arguments.lock()).map(|arguments| arguments(global)) {
            Some(Ok(arguments)) => arguments,
            Some(Err(ToJSError::JSError)) => {
                return Err(crate::top_exception_scope::thrown(global).into());
            }
            Some(Err(err)) => return Err(Failure::Arguments(err).into()),
            // The caller was terminated.
            None => return Err(Failure::Threw.into()),
        };
        let values: Vec<JSValue> = arguments.iter().map(ProtectedJSValue::value).collect();
        Ok(function.call(global, JSValue::ZERO, &values)?)
    }

    fn suspend(&self, global: &JSGlobalObject, invocation: Invocation, promise: JSValue) {
        let id = self.next_id.get();
        self.next_id.set(id.wrapping_add(1));
        let suspended = Suspended {
            invocation,
            promise: Strong::create(promise, global),
        };
        (self.suspended).with_mut(|all| all.insert(id, suspended));
        promise.then2(
            global,
            JSValue::js_number(f64::from(id)),
            Bun__MacroHost__onSettled,
            Bun__MacroHost__onSettled,
        );
    }

    #[cold]
    fn fail_suspended(&self, vm: &VirtualMachine) {
        for suspended in self.suspended.take().into_entries().1 {
            let failure = Failure::message(format_args!(
                "This macro never finished: nothing is left that can settle the promise it waits for"
            ));
            self.answer(vm, suspended.invocation.sleeper, Err(failure));
        }
    }

    /// The caller wakes in a later task: by then the microtasks of the macro have run, and what it wrote is flushed.
    fn answer(&self, vm: &VirtualMachine, sleeper: Sleeper, answer: Result<Vec<Node>, Failure>) {
        *sleeper.0.answer.lock() = Some(answer);
        self.answered.with_mut(|answered| answered.push(sleeper));
        vm.enqueue_task(Task::from_boxed(Box::new(Message(Event::Wake))));
    }

    fn wake_answered(&self) {
        Output::flush();
        drop(self.answered.take());
    }
}

pub(crate) fn on_settled<'a>(
    cx: &mut JsScope<'a>,
    _: JsLocal<'a>,
    id: u32,
) -> bindgen::Result<'a, ()> {
    let vm = cx.global().bun_vm();
    let host = vm.macro_host.as_deref().expect("reacts on a macro thread");
    if let Some(suspended) = host.suspended.with_mut(|all| all.remove(&id)) {
        host.advance(vm, suspended.invocation, suspended.promise.get())?;
    }
    Ok(())
}

/// What a macro started and did not wait for, as opposed to handles and timers, which need not end.
fn has_work_in_flight(vm: &VirtualMachine) -> bool {
    // Before the queues: work posts its completion, then returns its ticket.
    let tickets = vm.handle_ref().tickets_outstanding() as usize;
    #[cfg(windows)]
    if bun_sys::windows::libuv::Loop::has_requests() {
        return true;
    }
    tickets > vm.child_workers.get().len()
        || cpp::Bun__hasDeferredWorkKeepingEventLoopAlive(vm.global())
        || !vm.event_loop().is_drained()
        || vm.event_loop().has_yield_tasks()
}

/// `Err` if it is the termination of the VM.
#[cold]
fn print_exception(vm: &VirtualMachine, err: JsError) -> JsResult<()> {
    let exception = vm.global().take_exception(err);
    if exception.is_termination_exception() {
        return Err(err);
    }
    vm.run_error_handler(exception, None);
    Ok(())
}

// ── JSValue → Node ────────────────────────────────────────────────────────

#[derive(Default)]
struct Conversion {
    nodes: Vec<Node>,
    /// By address. `roots` keeps the GC from reusing one.
    visited: HashMap<JSValue, u32>,
    roots: Vec<Strong>,
    stack: Vec<Container>,
    /// The promises that the next node is the value of.
    unwrapped: Vec<Strong>,
}

enum Container {
    Array {
        node: u32,
        items: JSArrayIterator<'static>,
    },
    Object {
        node: u32,
        properties: JSPropertyIterator<'static>,
        key: Box<[u8]>,
    },
}

impl Conversion {
    /// After [`Interruption::Pending`], call it again with that promise.
    fn run(&mut self, vm: &VirtualMachine, mut value: JSValue) -> Result<Vec<Node>, Interruption> {
        loop {
            if let Some(inner) = self.visit(vm, value)? {
                value = inner;
                continue;
            }
            value = loop {
                let next = match self.stack.last_mut() {
                    None => return Ok(core::mem::take(&mut self.nodes)),
                    Some(Container::Array { items, .. }) => items.next()?,
                    Some(Container::Object {
                        properties, key, ..
                    }) => properties.next()?.map(|(name, value)| {
                        *key = name.to_owned_slice().into();
                        value
                    }),
                };
                match next {
                    Some(value) => break value,
                    None => drop(self.stack.pop()),
                }
            };
        }
    }

    /// Returns the value to visit in place of `value`, if it wraps one.
    fn visit(
        &mut self,
        vm: &VirtualMachine,
        value: JSValue,
    ) -> Result<Option<JSValue>, Interruption> {
        let global = vm.global();
        if self.stack.len() + self.unwrapped.len() > MAX_NESTED_VALUES {
            let text = format_args!("The value returned by this macro is nested too deeply");
            return Err(Failure::message(text).into());
        }
        if value.is_cell()
            && let Some(&node) = self.visited.get(&value)
        {
            self.attach(node);
            return Ok(None);
        }
        let threw = |error: JSValue| {
            vm.run_error_handler(error, None);
            Err(Failure::Threw.into())
        };

        let node = match Tag::get(value, global)?.tag.tag() {
            Tag::Error => return threw(value),
            Tag::Undefined => Node::Undefined,
            Tag::Null => Node::Null,
            Tag::Boolean => Node::Boolean(value.to_boolean()),
            Tag::Integer | Tag::Double => Node::Number(value.as_number()),
            Tag::String => {
                let string = value.to_bun_string(global)?;
                Node::String(match string.is_utf16() {
                    true => string.utf16().into(),
                    false => string.latin1().iter().map(|&b| u16::from(b)).collect(),
                })
            }
            Tag::Promise => {
                let promise = value.as_any_promise().expect("has the tag");
                return match promise.status() {
                    Status::Pending => Err(Interruption::Pending(promise)),
                    Status::Rejected => {
                        promise.set_handled(vm.jsc_vm());
                        threw(promise.result(vm.jsc_vm()))
                    }
                    Status::Fulfilled => {
                        self.unwrapped.push(Strong::create(value, global));
                        Ok(Some(promise.result(vm.jsc_vm())))
                    }
                };
            }
            Tag::Array => {
                let items = JSArrayIterator::init(value, global)?;
                let node = self.open(global, value, Node::Array(Vec::new()));
                self.stack.push(Container::Array { node, items });
                return Ok(None);
            }
            Tag::Object => {
                let properties = JSPropertyIterator::init(
                    global,
                    value.get_object().expect("has the tag"),
                    JSPropertyIteratorOptions::new(false, true),
                )?;
                let node = self.open(global, value, Node::Object(Vec::new()));
                self.stack.push(Container::Object {
                    node,
                    properties,
                    key: Box::default(),
                });
                return Ok(None);
            }
            Tag::Private if value.js_type() == JSType::DOMWrapper => {
                let hooks = runtime_hooks().expect("RuntimeHooks not installed");
                if let Some(blob) = (hooks.body_mixin_get_blob)(value, global)? {
                    return Ok(Some(blob));
                } else if let Some(blob) = value.as_class_ref::<WebCore::Blob>() {
                    Node::Blob {
                        bytes: blob.shared_view().into(),
                        content_type: blob.content_type_slice().into(),
                    }
                } else if value.is::<ResolveMessage>() || value.is::<BuildMessage>() {
                    return threw(value);
                } else {
                    Node::String(Box::default())
                }
            }
            Tag::Private => Node::String(Box::default()),
            Tag::ToJSON | Tag::JSON => {
                return Err(Failure::message(format_args!(
                    "cannot coerce {:?} to Bun's AST. Please return a simpler type",
                    value.js_type(),
                ))
                .into());
            }
            _ => {
                return Err(Failure::message(format_args!(
                    "cannot coerce {} ({:?}) to Bun's AST. Please return a simpler type",
                    BStr::new(value.get_class_info_name().unwrap_or(b"unknown")),
                    value.js_type(),
                ))
                .into());
            }
        };
        self.add(node);
        Ok(None)
    }

    fn add(&mut self, node: Node) -> u32 {
        let index = u32::try_from(self.nodes.len()).expect("int cast");
        self.nodes.push(node);
        self.attach(index);
        index
    }

    fn open(&mut self, global: &JSGlobalObject, value: JSValue, node: Node) -> u32 {
        self.unwrapped.push(Strong::create(value, global));
        self.add(node)
    }

    fn attach(&mut self, node: u32) {
        for root in self.unwrapped.drain(..) {
            self.visited.insert(root.get(), node);
            self.roots.push(root);
        }
        match self.stack.last_mut() {
            None => {}
            Some(Container::Array { node: parent, .. }) => {
                if let Node::Array(items) = &mut self.nodes[*parent as usize] {
                    items.push(node);
                }
            }
            Some(Container::Object {
                node: parent, key, ..
            }) => {
                if let Node::Object(properties) = &mut self.nodes[*parent as usize] {
                    properties.push((core::mem::take(key), node));
                }
            }
        }
    }
}

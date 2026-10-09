//! Where the rules of `bun lint` that are written in JavaScript run: in engines, each a thread of its own with a VM. A thread
//! that lints borrows one for a file, and answers what the program asks about the file while it waits for the result.
//!
//! Nobody waits in a circle. A thread that lints waits for an engine that another one has borrowed, which gives it back without
//! waiting for a second one. An engine waits for the thread that has borrowed it, which does nothing but answer, and for its
//! JavaScript: that can need Bun's pool, on which nothing of `bun lint` runs.
//!
//! The program is `bun_lint::js_plugin::PROGRAM`: the body of a function that is given [`request`],
//! [`again`] and [`decode`], and returns the function that [`ThreadVm::call`] calls.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;

use bun_jsc::{
    self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, Strong,
    virtual_machine::VirtualMachine,
};
use bun_lint_driver::js_plugin::{Demand, Engine, PROGRAM, Serve, Vm};
use bun_threading::{Condition, Guarded};
use std::sync::Arc;
use std::thread::ThreadId;
use std::time::Instant;

bun_core::declare_scope!(lint_js, hidden);

/// The message that the program is called with, and what answers its questions meanwhile.
struct Call<'c, 's> {
    content: &'c [u8],
    serve: &'c mut Serve<'s>,
}

/// What the VM of a thread has for `bun lint`: `RuntimeState::lint`.
pub(crate) struct LintVm {
    /// What the program returns.
    handle: Strong,
    /// Set while `handle` runs.
    call: Cell<Option<NonNull<Call<'static, 'static>>>>,
    /// The last answer.
    answer: RefCell<Vec<u8>>,
}

/// Takes the call out of the VM when it is over.
struct Lent<'v>(&'v LintVm);

impl Drop for Lent<'_> {
    fn drop(&mut self) {
        self.0.call.set(None);
    }
}

unsafe extern "C" {
    fn Bun__REPL__evaluate(
        global: *const JSGlobalObject,
        source: *const u8,
        source_len: usize,
        filename: *const u8,
        filename_len: usize,
        exception: *mut JSValue,
    ) -> JSValue;
}

fn message_of(global: &JSGlobalObject, error: JSValue) -> Vec<u8> {
    match error.to_bun_string(global) {
        Ok(text) => text.to_utf8().slice().to_vec(),
        Err(_) => {
            global.clear_exception();
            b"An exception was thrown.".to_vec()
        }
    }
}

/// Copies the last answer into the `ArrayBuffer` `into`, if it fits.
fn copy_answer(global: &JSGlobalObject, state: &LintVm, into: JSValue) -> JsResult<JSValue> {
    let Some(mut buffer) = into.as_array_buffer(global) else {
        return Err(global.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    };
    let answer = state.answer.borrow();
    if let Some(start) = buffer.byte_slice_mut().get_mut(..answer.len()) {
        start.copy_from_slice(&answer);
    }
    Ok(JSValue::js_number_from_uint64(answer.len() as u64))
}

/// `request(kind, details, buffer)`
#[bun_jsc::host_fn]
fn request(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [kind, details, into] = frame.arguments_as_array::<3>();
    let state = crate::jsc_hooks::lint_vm().get();
    let Some((state, mut call)) = state.and_then(|state| Some((state, state.call.get()?))) else {
        return Err(global.throw_invalid_arguments(format_args!("No file is being linted")));
    };
    let details = details.to_bun_string(global)?;
    // SAFETY: on the stack of `ThreadVm::call`, which is below this frame and takes it out before
    // it returns. `serve` runs no JavaScript, so this is the only reference.
    let call = unsafe { call.as_mut() };
    {
        let mut answer = state.answer.borrow_mut();
        answer.clear();
        match kind.to_int32() {
            0 => answer.extend_from_slice(call.content),
            kind => (call.serve)(kind as u32, details.to_utf8().slice(), &mut answer),
        }
    }
    copy_answer(global, state, into)
}

/// `again(buffer)`
#[bun_jsc::host_fn]
fn again(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    match crate::jsc_hooks::lint_vm().get() {
        Some(state) => copy_answer(global, state, frame.argument(0)),
        None => Ok(JSValue::UNDEFINED),
    }
}

/// `decode(buffer, start, end)`
#[bun_jsc::host_fn]
fn decode(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [buffer, start, end] = frame.arguments_as_array::<3>();
    let buffer = buffer.as_array_buffer(global);
    let range = start.to_int32() as u32 as usize..end.to_int32() as u32 as usize;
    match buffer.as_ref().and_then(|it| it.byte_slice().get(range)) {
        Some(bytes) => jsc::bun_string_jsc::create_utf8_for_js(global, bytes),
        None => {
            Err(global.throw_invalid_arguments(format_args!("Expected a part of an ArrayBuffer")))
        }
    }
}

/// Runs the program in the VM of this thread, which is new.
fn start_program(vm: &VirtualMachine) -> Result<LintVm, Vec<u8>> {
    let global = vm.global();
    let mut source = b"(function (request, again, decode) {\n\
        const require = process.getBuiltinModule(\"node:module\").createRequire(process.cwd() + \"/\");\n\
        const load = specifier => import(specifier);\n"
        .to_vec();
    PROGRAM
        .iter()
        .for_each(|part| source.extend_from_slice(part.1.as_bytes()));
    source.extend_from_slice(b"\n})");
    let name = b"bun-lint-plugins.js";
    let mut exception = JSValue::UNDEFINED;
    // SAFETY: `global` is that of this thread's VM, whose lock is held, and the slices and
    // `exception` outlive the call.
    let program = unsafe {
        Bun__REPL__evaluate(
            global,
            source.as_ptr(),
            source.len(),
            name.as_ptr(),
            name.len(),
            &raw mut exception,
        )
    };
    if !exception.is_undefined() {
        return Err(message_of(global, exception));
    }
    let functions = [
        JSFunction::create(global, "request", __jsc_host_request, 3, Default::default()),
        JSFunction::create(global, "again", __jsc_host_again, 1, Default::default()),
        JSFunction::create(global, "decode", __jsc_host_decode, 3, Default::default()),
    ];
    match program.call(global, JSValue::UNDEFINED, &functions) {
        Ok(handle) => {
            bun_core::scoped_log!(lint_js, "a VM is made");
            Ok(LintVm {
                handle: Strong::create(handle, global),
                call: Cell::new(None),
                answer: RefCell::new(Vec::new()),
            })
        }
        Err(error) => Err(message_of(global, global.take_exception(error))),
    }
}

/// Makes a VM for this thread.
fn start_vm() -> Result<(), Vec<u8>> {
    bun_core::scoped_log!(lint_js, "a VM begins");
    let failed = |what: &str| {
        [
            b"Could not start JavaScript for the plugins: ",
            what.as_bytes(),
        ]
        .concat()
    };
    bun_ast::initialize_store();
    let vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
        is_main_thread: false,
        ..Default::default()
    })
    .map_err(|error| failed(error.name()))?;
    debug_assert!(core::ptr::eq(vm, VirtualMachine::get_mut_ptr()));
    let vm = VirtualMachine::get().as_mut();
    // This thread has nothing else to do meanwhile.
    vm.transpiler_store.enabled = false;
    vm.transpiler.resolver.env_loader = NonNull::new(vm.transpiler.env);
    vm.transpiler.options.env.behavior =
        bun_options_types::schema::api::DotEnvBehavior::LoadAllWithoutInlining;
    vm.transpiler
        .configure_defines()
        .map_err(|error| failed(error.name()))?;
    vm.load_extra_env_and_source_code_printer();
    vm.argv = bun_core::argv().iter().skip(1).map(Box::from).collect();
    vm.event_loop_mut().ensure_waker();
    Ok(())
}

/// What `vm`, which is that of this thread and whose lock is held, has for `bun lint`. The first time the program runs.
fn program_of(vm: &VirtualMachine) -> Result<&'static LintVm, Vec<u8>> {
    let slot = crate::jsc_hooks::lint_vm();
    match slot.get() {
        Some(state) => Ok(&**state),
        None => {
            let started = Box::new(start_program(vm)?);
            Ok(&**slot.get_or_init(|| started))
        }
    }
}

/// The VM of this thread.
struct ThreadVm;

impl Vm for ThreadVm {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        let vm = VirtualMachine::get();
        vm.run_with_api_lock(|| {
            let global = vm.global();
            let state = program_of(vm)?;
            let mut call = Call { content, serve };
            state.call.set(Some(NonNull::from(&mut call).cast()));
            let _lent = Lent(state);
            let _scope = vm.enter_event_loop_scope();
            let kind = JSValue::js_number_from_int32(kind as i32);
            let mut returned = (state.handle.get().call(global, JSValue::UNDEFINED, &[kind]))
                .map_err(|error| message_of(global, global.take_exception(error)))?;
            if let Some(promise) = returned.as_any_promise() {
                if vm.as_mut().wait_for_promise(promise).is_err() {
                    return Err(b"JavaScript was stopped.".to_vec());
                }
                returned = promise.result(global.vm());
                if promise.status() == jsc::js_promise::Status::Rejected {
                    return Err(message_of(global, returned));
                }
            }
            match returned.to_bun_string(global) {
                Ok(text) => Ok(text.to_utf8().slice().to_vec()),
                Err(error) => Err(message_of(global, global.take_exception(error))),
            }
        })
    }
}

/// With no more VMs than this, cores are left to compile and to collect garbage on while the VMs run.
const FEW_VMS: usize = 4;

/// So many files do not take more than a few VMs.
const FEW_FILES: usize = 128;

/// What a VM with a few plugins takes.
const MEMORY_OF_A_VM: usize = 384 << 20;

/// Runs the `exit` handlers of the VM of this thread, if it has one. With
/// `BUN_DESTRUCT_VM_ON_EXIT` the VM is freed too.
fn end_vm() {
    if !VirtualMachine::is_loaded() {
        return;
    }
    let vm = VirtualMachine::get();
    if !bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false) {
        let _lock = vm.global().vm().get_api_lock();
        return vm.as_mut().on_exit();
    }
    // Never released: `exit_and_free` frees the VM that it is the lock of.
    let _lock = core::mem::ManuallyDrop::new(vm.global().vm().get_api_lock());
    drop(crate::jsc_hooks::take_lint_vm());
    drop(core::mem::take(&mut vm.as_mut().argv));
    // SAFETY: made by `start_vm` on this thread, which holds its lock. Nobody else has a pointer to it.
    unsafe { VirtualMachine::exit_and_free(VirtualMachine::get_mut_ptr()) };
}

/// What an engine and the thread that has borrowed it say to each other, in turns.
#[derive(Default)]
enum Turn {
    /// It has been heard.
    #[default]
    Nothing,
    /// To the engine: [`Vm::call`].
    Call { kind: u32, content: Vec<u8> },
    /// From the engine: what the program asks for. The answer is appended to `answer`.
    Asked {
        kind: u32,
        details: Vec<u8>,
        answer: Vec<u8>,
    },
    /// To the engine.
    Answered(Vec<u8>),
    /// From the engine: what the call returns.
    Returned(Result<Vec<u8>, Vec<u8>>),
    /// To the engine: nothing is going to be asked of it any more. It returns nothing.
    End,
}

/// Where the two meet. Only one of them waits at a time.
#[derive(Default)]
struct Desk {
    turn: Guarded<Turn>,
    is_said: Condition,
}

impl Desk {
    fn say(&self, turn: Turn) {
        *self.turn.lock() = turn;
        self.is_said.notify_one();
    }

    /// Waits for what `is_for_me`.
    fn hear(&self, is_for_me: fn(&Turn) -> bool) -> Turn {
        let mut turn = self.turn.lock();
        while !is_for_me(&turn) {
            self.is_said.wait_guarded(&mut turn);
        }
        core::mem::take(&mut *turn)
    }
}

/// What all engines share.
#[derive(Default)]
struct Start {
    initialize: std::sync::Once,
    /// Whether there can be more than a few engines. Nobody knows if an engine is needed to find out.
    is_for_few: core::sync::atomic::AtomicBool,
}

impl Start {
    /// Makes a VM for this thread.
    fn start_vm(&self) -> Result<(), Vec<u8>> {
        let mut first = None;
        self.initialize.call_once(|| {
            jsc::initialize(jsc::InitializeOptions {
                vm_per_thread: !self.is_for_few.load(core::sync::atomic::Ordering::Relaxed),
                ..Default::default()
            });
            // What a process has one of, like `FileSystem::instance()`, is made when its first VM starts, and not for
            // several threads at a time.
            first = Some(start_vm().and_then(|()| {
                let vm = VirtualMachine::get();
                vm.run_with_api_lock(|| program_of(vm).map(|_| ()))
            }));
        });
        first.unwrap_or_else(start_vm)
    }
}

/// What the thread of an engine does. Nobody joins it: once its VM is freed it waits for a turn that never comes, until the
/// process exits.
fn run_engine(number: usize, start: &Start, desk: &Desk) -> ! {
    // What is still owned where the loop begins is never freed.
    {
        let name = format!("Bun Lint JS {number}\0");
        bun_core::Output::Source::configure_named_thread(bun_core::ZStr::from_slice_with_nul(
            name.as_bytes(),
        ));
    }
    let started = start.start_vm();
    loop {
        let Turn::Call { kind, content } =
            desk.hear(|turn| matches!(turn, Turn::Call { .. } | Turn::End))
        else {
            end_vm();
            desk.say(Turn::Returned(Ok(Vec::new())));
            continue;
        };
        let mut ask = |kind: u32, details: &[u8], answer: &mut Vec<u8>| {
            desk.say(Turn::Asked {
                kind,
                details: details.to_vec(),
                answer: core::mem::take(answer),
            });
            if let Turn::Answered(answered) = desk.hear(|turn| matches!(turn, Turn::Answered(_))) {
                *answer = answered;
            }
        };
        desk.say(Turn::Returned(
            started
                .clone()
                .and_then(|()| ThreadVm.call(kind, &content, &mut ask)),
        ));
    }
}

/// An engine that is borrowed.
struct Borrowed<'e> {
    engines: &'e Engines,
    at: usize,
    desk: Arc<Desk>,
    since: Instant,
    /// The size of the file that it is borrowed for.
    size: usize,
    /// A caller further up has borrowed it, and gives it back.
    is_borrowed_further_up: bool,
}

impl Vm for Borrowed<'_> {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        self.desk.say(Turn::Call {
            kind,
            content: content.to_vec(),
        });
        loop {
            match self
                .desk
                .hear(|turn| matches!(turn, Turn::Asked { .. } | Turn::Returned(_)))
            {
                Turn::Asked {
                    kind,
                    details,
                    mut answer,
                } => {
                    serve(kind, &details, &mut answer);
                    self.desk.say(Turn::Answered(answer));
                }
                Turn::Returned(returned) => return returned,
                _ => {}
            }
        }
    }
}

impl Drop for Borrowed<'_> {
    fn drop(&mut self) {
        if self.is_borrowed_further_up {
            return;
        }
        let mut state = self.engines.state.lock();
        state.borrowed.retain(|it| it.1 != self.at);
        state.idle.push(self.at);
        let started = state.all[self.at].1.take();
        drop(state);
        let since_its_start = started.map(|it| it.elapsed());
        (self.engines.demand).note(self.size, self.since.elapsed(), since_its_start);
        // Each of those that wait may wait for another one.
        self.engines.is_idle.notify_all();
    }
}

#[derive(Default)]
struct State {
    /// With when it was started, until it is given back for the first time.
    all: Vec<(Arc<Desk>, Option<Instant>)>,
    /// Which of them nobody has borrowed. The last one was given back last.
    idle: Vec<usize>,
    /// Who has borrowed which.
    borrowed: Vec<(ThreadId, usize)>,
}

/// The engines. None is started before it is needed.
#[derive(Default)]
pub(crate) struct Engines {
    start: Arc<Start>,
    demand: Demand,
    state: Guarded<State>,
    is_idle: Condition,
}

impl Engines {
    /// Ends every engine. Nothing is being linted any more.
    pub(crate) fn end_all(&self) {
        for (desk, _) in core::mem::take(&mut self.state.lock().all) {
            desk.say(Turn::End);
            desk.hear(|turn| matches!(turn, Turn::Returned(_)));
        }
    }

    /// Waits for an engine.
    fn borrow(&self, size: usize) -> Result<Borrowed<'_>, Vec<u8>> {
        let me = std::thread::current().id();
        let mut state = self.state.lock();
        // Nothing is asked of it at the moment: this thread would be waiting for the answer.
        if let Some(&(_, at)) = state.borrowed.iter().find(|it| it.0 == me) {
            return Ok(Borrowed {
                engines: self,
                at,
                desk: Arc::clone(&state.all[at].0),
                since: Instant::now(),
                size,
                is_borrowed_further_up: true,
            });
        }
        let at = loop {
            if let Some(at) = state.idle.pop() {
                break at;
            }
            if self.demand.is_worth_another(state.all.len()) {
                let (at, desk) = (state.all.len(), Arc::<Desk>::default());
                let (start, for_thread) = (Arc::clone(&self.start), Arc::clone(&desk));
                // SAFETY: no VM or JS state crosses: a number, a `Once` with a flag, and a `Desk`, whose turns are bytes. This
                // thread has no VM. The new one makes its own, and frees it itself before `end_all` returns.
                std::thread::Builder::new()
                    .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
                    .spawn(move || run_engine(at, &start, &for_thread))
                    .map_err(|_| b"Could not start a thread for the plugins.".to_vec())?;
                state.all.push((desk, Some(Instant::now())));
                break at;
            }
            self.is_idle.wait_guarded(&mut state);
        };
        state.borrowed.push((me, at));
        Ok(Borrowed {
            engines: self,
            at,
            desk: Arc::clone(&state.all[at].0),
            since: Instant::now(),
            size,
            is_borrowed_further_up: false,
        })
    }
}

impl Engine for Engines {
    fn with_vm(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        then(&mut self.borrow(size)?);
        Ok(())
    }

    fn expect(&self, files: usize, size: u64, most: usize) {
        let is_for_few = most <= FEW_VMS || files <= FEW_FILES;
        (self.start.is_for_few).store(is_for_few, core::sync::atomic::Ordering::Relaxed);
        self.demand.expect(size, most);
    }

    /// Half of the memory is for them.
    fn most_realms(&self) -> usize {
        (bun_core::get_total_memory_size() / 2 / MEMORY_OF_A_VM).max(1)
    }
}

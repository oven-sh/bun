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

use bun_core::strings;
use bun_jsc::{
    self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, Strong,
    virtual_machine::VirtualMachine,
};
use bun_lint_driver::js_plugin::{Demand, Engine, HEAVY, PROGRAM, Serve, Vm};
use bun_threading::{Condition, Guarded};
use std::sync::Arc;
use std::thread::ThreadId;

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
                // As `wait_for_promise`, which waits for ever for a promise that nothing is going to settle. Node.js ends then.
                while promise.status() == jsc::js_promise::Status::Pending {
                    vm.as_mut().event_loop_mut().tick();
                    if promise.status() != jsc::js_promise::Status::Pending {
                        break;
                    }
                    if !vm.is_event_loop_alive() {
                        return Err(
                            b"A promise is not settled, and nothing is left to wait for.".to_vec(),
                        );
                    }
                    vm.as_mut().auto_tick();
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

/// What a line of `/proc/self/cgroup` names: a directory, under which other one it is, and the file in it and in those above it
/// that has a limit. `0::/a/b` with one hierarchy, `9:memory:/a/b` with one for each controller.
#[cfg_attr(not(any(target_os = "linux", test)), expect(dead_code))]
fn group_in(line: &[u8]) -> Option<(&[u8], &'static [u8], &'static [u8])> {
    let (_, rest) = strings::split_once_char(line, b':')?;
    let (controllers, group) = strings::split_once_char(rest, b':')?;
    if controllers.is_empty() {
        return Some((group, b"/sys/fs/cgroup", b"memory.max"));
    }
    (strings::split(controllers, b",").any(|it| it == b"memory")).then_some((
        group,
        b"/sys/fs/cgroup/memory",
        b"memory.limit_in_bytes",
    ))
}

/// What such a file says. `max`: there is no limit.
fn limit_in(text: &[u8]) -> Option<usize> {
    core::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()
}

/// The least that the control groups of this process allow it: a container's limit.
#[cfg(target_os = "linux")]
fn limit_of_the_groups() -> Option<usize> {
    use bun_sys::{Fd, File};
    let groups = File::read_from(Fd::cwd(), b"/proc/self/cgroup").ok()?;
    let limits = strings::split(&groups, b"\n")
        .filter_map(group_in)
        .flat_map(|(group, root, file)| {
            let above = core::iter::successors(Some(group), |it| {
                Some(&it[..strings::last_index_of_char(it, b'/')?])
            });
            above.filter_map(move |it| {
                limit_in(&File::read_from(Fd::cwd(), &[root, it, b"/", file].concat()).ok()?)
            })
        });
    limits.min()
}

#[cfg(not(target_os = "linux"))]
fn limit_of_the_groups() -> Option<usize> {
    None
}

/// What all engines together may take: a quarter of the memory of the machine, or of the container. JavaScriptCore is told the
/// same, so what the user tells it instead goes here too.
fn memory_for_engines() -> usize {
    let said = bun_core::getenv_z(bun_core::zstr!("BUN_JSC_forceRAMSize"));
    said.and_then(limit_in).unwrap_or_else(|| {
        let machine = bun_core::get_total_memory_size();
        limit_of_the_groups().map_or(machine, |it| it.min(machine)) / 4
    })
}

/// Runs the `exit` handlers of the VM of this thread, if it has one. If it `frees`, and with
/// `BUN_DESTRUCT_VM_ON_EXIT`, the VM is freed too.
fn end_vm(frees: bool) {
    if !VirtualMachine::is_loaded() {
        return;
    }
    let vm = VirtualMachine::get();
    if !frees && !bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false) {
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
    /// To the engine: it ends now, and frees its VM. The others need the memory.
    Free,
}

/// Where the two meet. Only one of them waits at a time.
#[derive(Default)]
struct Desk {
    turn: Guarded<Turn>,
    is_said: Condition,
    /// How large the heap of the engine was after its last call.
    heap: core::sync::atomic::AtomicUsize,
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
    memory: std::sync::OnceLock<usize>,
}

impl Start {
    /// [`memory_for_engines`]
    fn memory(&self) -> usize {
        *self.memory.get_or_init(memory_for_engines)
    }

    /// Makes a VM for this thread.
    fn start_vm(&self) -> Result<(), Vec<u8>> {
        let mut first = None;
        self.initialize.call_once(|| {
            // The first regular expression of a configuration has started it as well (`bun_yarr`).
            jsc::initialize(jsc::InitializeOptions::default());
            if !self.is_for_few.load(core::sync::atomic::Ordering::Relaxed) {
                jsc::expect_vm_per_thread();
            }
            // The memory that is for the engines, by which they are counted too. With under 16 GB it goes by what the process
            // takes, which is all engines together: told all the memory of a container, six large engines went over it.
            jsc::expect_ram_size(self.memory());
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
    let mut has_answered = false;
    loop {
        let heard = desk.hear(|turn| matches!(turn, Turn::Call { .. } | Turn::End | Turn::Free));
        let Turn::Call { kind, content } = heard else {
            end_vm(matches!(heard, Turn::Free));
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
        let returned = (started.clone()).and_then(|()| ThreadVm.call(kind, &content, &mut ask));
        // To its first call it answers what it has to load. After the second that is loaded.
        if started.is_ok() && core::mem::replace(&mut has_answered, true) {
            // 0 in a build of JavaScriptCore that does not count: 1 says that the engine has answered, and takes no room.
            let heap = VirtualMachine::get()
                .jsc_vm()
                .block_bytes_allocated()
                .max(1);
            desk.heap.store(heap, core::sync::atomic::Ordering::Relaxed);
        }
        desk.say(Turn::Returned(returned));
    }
}

/// An engine that is borrowed.
struct Borrowed<'e> {
    engines: &'e Engines,
    at: usize,
    desk: Arc<Desk>,
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
                Turn::Returned(returned) => {
                    self.note_the_heap();
                    return returned;
                }
                _ => {}
            }
        }
    }
}

impl Borrowed<'_> {
    fn note_the_heap(&self) {
        let heap = self.desk.heap.load(core::sync::atomic::Ordering::Relaxed);
        let mut state = self.engines.state.lock();
        let known = &mut state.all[self.at];
        let is_the_first_time = known.largest == 0 && heap > 0;
        (known.heap, known.largest) = (heap, heap.max(known.largest));
        drop(state);
        // Those that wait may start another one by now.
        if is_the_first_time {
            self.engines.is_idle.notify_all();
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
        // They have grown since they were started. The first has the heavy files, and one is left beside those that are kept.
        let all: usize = state.all.iter().map(|it| it.heap).sum();
        if self.at != 0 && all > self.engines.start.memory() && state.count() - state.kept > 1 {
            let known = &mut state.all[self.at];
            (known.heap, known.is_freed) = (0, true);
            self.desk.say(Turn::Free);
        } else {
            state.idle.push(self.at);
        }
        drop(state);
        self.engines.demand.note(self.size);
        // Each of those that wait may wait for another one.
        self.engines.is_idle.notify_all();
    }
}

/// What an engine counts for before it has loaded what it needs and says its size: no configuration that was seen took more. So
/// with 16 GB of memory two engines start at once, and with less, or for a third, the size of one is waited for.
const NOT_LOADED_YET: usize = 2 << 30;

/// An engine.
struct Known {
    desk: Arc<Desk>,
    /// Who has borrowed it last.
    by: ThreadId,
    /// How large its heap was when it was given back last, and at most.
    heap: usize,
    largest: usize,
    /// It was told to free its VM, and is not lent any more.
    is_freed: bool,
}

#[derive(Default)]
struct State {
    all: Vec<Known>,
    /// Which of them nobody has borrowed. The last one was given back last.
    idle: Vec<usize>,
    /// Who has borrowed which.
    borrowed: Vec<(ThreadId, usize)>,
    /// How many are kept: [`Engine::keep_vm`]. They are not there for the files by which the others are counted.
    kept: usize,
}

impl State {
    /// How many engines there are.
    fn count(&self) -> usize {
        self.all.iter().filter(|it| !it.is_freed).count()
    }
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
        for Known { desk, is_freed, .. } in core::mem::take(&mut self.state.lock().all) {
            if !is_freed {
                desk.say(Turn::End);
            }
            desk.hear(|turn| matches!(turn, Turn::Returned(_)));
        }
    }

    /// Whether one more engine fits in the memory that is for them, if it gets as large as the largest of those after the first,
    /// which has the heavy files, or as that one if it is alone.
    fn has_room_for_another(&self, state: &State) -> bool {
        let [first, others @ ..] = &state.all[..] else {
            return true;
        };
        let known = |size: usize| Some(size).filter(|&it| it > 0);
        let first = known(first.largest).unwrap_or(NOT_LOADED_YET);
        let largest = others.iter().map(|it| it.largest).max();
        let largest = largest.and_then(known).unwrap_or(first);
        first + state.count() * largest <= self.start.memory()
    }

    /// Waits for an engine.
    fn borrow(&self, size: usize, is_heavy: bool) -> Result<Borrowed<'_>, Vec<u8>> {
        let me = std::thread::current().id();
        let mut state = self.state.lock();
        // Nothing is asked of it at the moment: this thread would be waiting for the answer.
        if let Some(&(_, at)) = state.borrowed.iter().find(|it| it.0 == me) {
            return Ok(Borrowed {
                engines: self,
                at,
                desk: Arc::clone(&state.all[at].desk),
                size,
                is_borrowed_further_up: true,
            });
        }
        let at = loop {
            // What is heavy is for the first. Else the one that it had, which has grown by what this thread has given it, and the
            // first one last.
            let find = |is_it: &dyn Fn(usize) -> bool| state.idle.iter().rposition(|&at| is_it(at));
            let found = match is_heavy {
                true => find(&|at| at == 0),
                false => find(&|at| state.all[at].by == me)
                    .or_else(|| find(&|at| at != 0))
                    .or_else(|| find(&|_| true)),
            };
            if let Some(found) = found {
                let at = state.idle.remove(found);
                state.all[at].by = me;
                break at;
            }
            let can_start =
                (!is_heavy || state.all.is_empty()) && self.has_room_for_another(&state);
            if can_start && (self.demand).is_worth_another(state.count() - state.kept) {
                let (at, desk) = (state.all.len(), Arc::<Desk>::default());
                let (start, for_thread) = (Arc::clone(&self.start), Arc::clone(&desk));
                // SAFETY: no VM or JS state crosses: a number, a `Once` with a flag, and a `Desk`, whose turns are bytes. This
                // thread has no VM. The new one makes its own, and frees it itself before `end_all` returns.
                std::thread::Builder::new()
                    .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
                    .spawn(move || run_engine(at, &start, &for_thread))
                    .map_err(|_| b"Could not start a thread for the plugins.".to_vec())?;
                state.all.push(Known {
                    desk,
                    by: me,
                    heap: 0,
                    largest: 0,
                    is_freed: false,
                });
                break at;
            }
            self.is_idle.wait_guarded(&mut state);
        };
        state.borrowed.push((me, at));
        Ok(Borrowed {
            engines: self,
            at,
            desk: Arc::clone(&state.all[at].desk),
            size,
            is_borrowed_further_up: false,
        })
    }
}

impl Engine for Engines {
    fn with_vm(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        then(&mut self.borrow(size, size >= HEAVY)?);
        Ok(())
    }

    fn keep_vm(&self, then: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        let borrowed = self.borrow(0, true)?;
        self.state.lock().kept += 1;
        self.is_idle.notify_all();
        then();
        self.state.lock().kept -= 1;
        drop(borrowed);
        Ok(())
    }

    fn sizes(&self) -> (usize, usize) {
        let state = self.state.lock();
        let largest = state.all.iter().map(|it| it.largest).max().unwrap_or(0);
        (largest, state.all.len() - state.count())
    }

    fn expect(&self, files: usize, size: u64, most: usize) {
        let is_for_few = most <= FEW_VMS || files <= FEW_FILES;
        (self.start.is_for_few).store(is_for_few, core::sync::atomic::Ordering::Relaxed);
        self.demand.expect(size, most);
    }
}

#[cfg(test)]
mod tests {
    use super::{group_in, limit_in};

    #[test]
    fn reads_the_groups() {
        let unified = (
            &b"/a/b.scope"[..],
            &b"/sys/fs/cgroup"[..],
            &b"memory.max"[..],
        );
        assert_eq!(group_in(b"0::/a/b.scope"), Some(unified));
        let own = (
            &b"/docker/1"[..],
            &b"/sys/fs/cgroup/memory"[..],
            &b"memory.limit_in_bytes"[..],
        );
        assert_eq!(group_in(b"9:memory:/docker/1"), Some(own));
        assert_eq!(group_in(b"4:cpu,memory:/docker/1"), Some(own));
        assert_eq!(group_in(b"1:name=systemd:/"), None);
        assert_eq!(group_in(b""), None);
    }

    #[test]
    fn reads_a_limit() {
        assert_eq!(limit_in(b"629145600\n"), Some(629_145_600));
        assert_eq!(limit_in(b"max\n"), None);
        assert_eq!(limit_in(b""), None);
    }
}

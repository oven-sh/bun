//! Runs the `bun lint` rules that are written in JavaScript.
//!
//! A VM belongs to one thread for good. Every VM loads all the plugins itself, so there are fewer VMs than lint threads:
//! [`Demand`] and [`Memory`] decide how many.
//!
//! With `BUN_LINT_SAME_THREAD=1` ([`Crew`]), a thread that has a VM is a lint thread. It reads, parses and lints whole files, and
//! what the program asks about a file is a plain function call. Files that need JavaScript are given to these threads
//! ([`Engine::work_off`]). A thread without a VM that turns out to need one posts a job and waits ([`Engine::with_vm`]).
//!
//! The rule that keeps this free of deadlocks: **a thread with a VM never waits for another thread. Other threads may wait for
//! it.** So it never joins a parallel region of the pool (`keep_regions_on_this_thread`), and it never posts a job. It only
//! waits for its own JavaScript, which can need Bun's pool, on which nothing of `bun lint` runs.
//!
//! Without the switch ([`Lending`]), VMs are on extra threads. A lint thread borrows one for a file, and answers what the program
//! asks while it waits for the result.
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
use bun_lint_driver::js_plugin::{Demand, Engine, HEAVY, PROGRAM, Serve, Vm, Work};
use bun_threading::{Condition, Guarded};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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
    /// src/jsc/bindings/LintNodes.cpp
    safe fn Bun__Lint__nodeFunctions(global: &JSGlobalObject) -> JSValue;
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

/// Asks the thread that lints for `kind`. The answer is in `answer` of what this returns. `None`: no file is being linted.
fn ask(kind: u32, details: &[u8]) -> Option<&'static LintVm> {
    let state = crate::jsc_hooks::lint_vm().get()?;
    let mut call = state.call.get()?;
    // SAFETY: on the stack of `ThreadVm::call`, which is below this frame and takes it out before
    // it returns. `serve` runs no JavaScript, so this is the only reference.
    let call = unsafe { call.as_mut() };
    let mut answer = state.answer.borrow_mut();
    answer.clear();
    match kind {
        0 => answer.extend_from_slice(call.content),
        kind => (call.serve)(kind, details, &mut answer),
    }
    Some(&**state)
}

/// `request(kind, details, buffer)`
#[bun_jsc::host_fn]
fn request(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [kind, details, into] = frame.arguments_as_array::<3>();
    let details = details.to_bun_string(global)?;
    match ask(kind.to_int32() as u32, details.to_utf8().slice()) {
        Some(state) => copy_answer(global, state, into),
        None => Err(global.throw_invalid_arguments(format_args!("No file is being linted"))),
    }
}

/// Bytes that are the same until the next question is asked.
#[repr(C)]
struct LintSpan {
    ptr: *const u8,
    len: usize,
}

/// [`request`] for src/jsc/bindings/LintHost.h. Null: no file is being linted.
#[unsafe(no_mangle)]
extern "C" fn Bun__Lint__ask(
    _global: &JSGlobalObject,
    kind: u32,
    details: *const u8,
    details_len: usize,
) -> LintSpan {
    let details = match details.is_null() {
        true => &[][..],
        // SAFETY: the caller's, who keeps them until this returns.
        false => unsafe { core::slice::from_raw_parts(details, details_len) },
    };
    match ask(kind, details) {
        Some(state) => {
            let answer = state.answer.borrow();
            LintSpan {
                ptr: answer.as_ptr(),
                len: answer.len(),
            }
        }
        None => LintSpan {
            ptr: core::ptr::null(),
            len: 0,
        },
    }
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
    let mut source = b"(function (request, again, decode, native) {\n\
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
        Bun__Lint__nodeFunctions(global),
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
    // As for a configuration: `run_script` in `lint_command.rs`.
    vm.transpiler.options.env.disable_default_env_files = true;
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
                    // A rejection that nobody handles is printed and counted, and no loop is alive with one that is counted.
                    vm.as_mut().unhandled_error_counter = 0;
                    if !vm.is_event_loop_alive() {
                        return Err(
                            b"A promise never settled, and nothing is left to wait for.".to_vec()
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

/// What all engines together may take: half of the memory that is to be had, in the machine and in the container. A linter does
/// not take the machine.
fn memory_for_engines() -> usize {
    // On macOS next to nothing is ever free.
    let free = match cfg!(any(target_os = "linux", windows)) {
        true => crate::node::os::freemem() as usize,
        false => 0,
    };
    (if free == 0 {
        memory()
    } else {
        memory().min(free)
    }) / 2
}

/// The memory of the machine, or of the container. `BUN_LINT_MEMORY`: for tests.
pub(super) fn memory() -> usize {
    let said = bun_core::getenv_z(bun_core::zstr!("BUN_LINT_MEMORY"));
    said.and_then(limit_in).unwrap_or_else(|| {
        let machine = bun_core::get_total_memory_size();
        limit_of_the_groups().map_or(machine, |it| it.min(machine))
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

/// What all VMs share.
#[derive(Default)]
struct Start {
    initialize: std::sync::Once,
    /// Whether there can be more than a few VMs. Nobody knows if a VM is needed to find out.
    is_for_few: AtomicBool,
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
            if !self.is_for_few.load(Ordering::Relaxed) {
                jsc::expect_vm_per_thread();
            }
            // What a process has one of, like `FileSystem::instance()`, is made when its first VM starts, and not for
            // several threads at a time.
            first = Some(start_vm().and_then(|()| {
                let vm = VirtualMachine::get();
                vm.run_with_api_lock(|| program_of(vm).map(|_| ()))
            }));
        });
        first.unwrap_or_else(start_vm)
    }

    /// [`Engine::expect`]
    fn expect(&self, demand: &Demand, size: u64, most: usize) {
        demand.expect(size, most);
        // As many as the files are worth.
        let is_enough = |&vms: &usize| !demand.is_worth_another(vms);
        let vms = (1..most).find(is_enough).unwrap_or(most);
        // Cores are left to compile on while the VMs run.
        let is_for_few = vms <= usize::from(bun_core::get_thread_count()) / 2;
        self.is_for_few.store(is_for_few, Ordering::Relaxed);
    }
}

fn name_this_thread(number: usize) {
    let name = format!("Bun Lint JS {number}\0");
    bun_core::Output::Source::configure_named_thread(bun_core::ZStr::from_slice_with_nul(
        name.as_bytes(),
    ));
}

/// What a VM counts for until the run has shown how its VMs grow: none that was seen took much more. So where 16 GB are to be
/// had four VMs start at once, and with less, or for a fifth, that is waited for.
const NOT_LOADED_YET: usize = 2 << 30;

/// How many VMs there are, and how many of them have loaded what they need.
#[derive(Copy, Clone)]
struct Vms {
    count: usize,
    loaded: usize,
}

/// What the VMs of a run take.
#[derive(Default)]
struct Memory {
    /// What the process took before the first VM was started.
    before: usize,
    /// By how much more it took when that was last looked at: the VMs, with the workers that their plugins start and all that
    /// is not in a heap of JavaScript. And the most that it was, in all and for each VM that had loaded what it needs.
    taken: usize,
    most: usize,
    most_for_one: usize,
    /// What it took, and how many bytes were still to be linted, when `grows_by` was last computed: by how many bytes it has
    /// grown since then for each byte that was linted.
    looked_at: (usize, u64),
    grows_by: Option<f64>,
    /// How many files VMs are done with, and what that was when a VM was last freed.
    given_back: u32,
    freed_at: u32,
}

impl Memory {
    /// Before the first VM starts. `left`: [`Demand::left`]
    fn begin(&mut self, left: u64) {
        self.before = bun_sys::self_process_memory_usage().unwrap_or(0);
        self.looked_at = (0, left);
    }

    /// `left`: [`Demand::left`]
    fn measure(&mut self, left: u64, loaded: usize) {
        let now = bun_sys::self_process_memory_usage().unwrap_or(0);
        self.taken = now.saturating_sub(self.before);
        self.most = self.most.max(self.taken);
        // Over a 32nd of what was left: less says little.
        let (taken, left_then) = self.looked_at;
        let done = left_then.saturating_sub(left);
        if done > 0 && done >= left_then / 32 {
            self.grows_by = Some(self.taken.saturating_sub(taken) as f64 / done as f64);
            self.looked_at = (self.taken, left);
        }
        if let Some(for_one) = self.taken.checked_div(loaded) {
            self.most_for_one = self.most_for_one.max(for_one);
        }
    }

    /// A VM has loaded what it needs. How the VMs grow is seen from here on: not by what a load takes.
    fn note_a_load(&mut self, left: u64, loaded: usize) {
        self.measure(left, loaded);
        if self.grows_by.is_none() {
            self.looked_at = (self.taken, left);
        }
    }

    /// A VM is done with a file. They have grown since they were started. Looking costs a system call: every time only until
    /// it is known how they grow, and once they have what was `planned`.
    fn note_a_file(&mut self, planned: usize, demand: &Demand, loaded: usize) {
        self.given_back = self.given_back.wrapping_add(1);
        if self.given_back.is_multiple_of(16) || self.grows_by.is_none() || self.taken >= planned {
            self.measure(demand.left(), loaded);
        }
    }

    /// Whether to free a VM. What it has built is lost with it. So not before half of what the plan has left is gone too, and
    /// what the last one gave back is seen a while after it is gone.
    fn is_too_much(&self, planned: usize) -> bool {
        self.taken > planned / 2 * 3 && self.given_back.wrapping_sub(self.freed_at) >= 16
    }

    /// Whether one more VM fits in the memory that is `planned` for them: if those that have loaded go on growing with each
    /// byte as they have in this run, until all is linted, and it and those that have not loaded yet get as large as one of
    /// these.
    fn has_room_for_another(&self, planned: usize, left: u64, vms: Vms) -> bool {
        let one = match self.grows_by {
            Some(grows_by) if vms.loaded > 0 => {
                (self.taken as f64 + grows_by * left as f64) / vms.loaded as f64
            }
            // What a VM has after its load says little about what it is going to have.
            _ => NOT_LOADED_YET as f64,
        };
        let all = one.max(self.most_for_one as f64) * (vms.count + 1) as f64;
        vms.count == 0 || all <= planned as f64
    }
}

/// The closure of a thread that waits in [`Crew::post`].
struct Job<'j>(&'j mut (dyn FnMut(&mut dyn Vm) + Send));

/// A job for a thread that has a VM.
struct Posted {
    job: NonNull<Job<'static>>,
    size: usize,
    ticket: Arc<Ticket>,
}

// SAFETY: it holds no VM or JS state. The closure is `Send`, and the thread that owns it only waits for the ticket until the job
// is done.
unsafe impl Send for Posted {}

/// What the thread that has posted a job waits for.
#[derive(Default)]
struct Ticket {
    is_done: Guarded<bool>,
    changed: Condition,
}

impl Ticket {
    fn finish(&self) {
        *self.is_done.lock() = true;
        self.changed.notify_one();
    }

    fn wait(&self) {
        let mut is_done = self.is_done.lock();
        while !*is_done {
            self.changed.wait_guarded(&mut is_done);
        }
    }
}

/// What [`Crew::work_off`] was called with.
#[derive(Copy, Clone)]
struct Shared {
    work: NonNull<&'static dyn Work>,
    /// From 1. Every call has another one.
    number: u64,
}

// SAFETY: it holds no VM or JS state. `dyn Work` is `Sync`, and `work_off` doesn't return while a thread can still reach it.
unsafe impl Send for Shared {}

impl Shared {
    /// # Safety
    /// Only while `work_off` waits: the caller is counted in `CrewState::pending`, or holds the lock and has read this from
    /// `CrewState::shared`.
    unsafe fn work(&self) -> &dyn Work {
        // SAFETY: on the stack of `work_off`, by the contract.
        unsafe { *self.work.as_ref() }
    }
}

/// A thread with a VM.
#[derive(Default)]
struct Member {
    /// `None` until it runs.
    thread: Option<ThreadId>,
    /// Why it has no VM after all. It still takes work, and fails it with this.
    failure: Option<Vec<u8>>,
    /// How many calls its VM has answered.
    calls: u8,
    /// A call of `with_vm_here` is on its stack.
    is_in_use: bool,
    /// It waits for work.
    is_idle: bool,
    /// It frees its VM once it's done with its file, and takes no more work.
    is_freed: bool,
    /// It has run the `exit` handlers, or freed its VM.
    is_gone: bool,
    /// [`Shared::number`] of the last work that it has nothing left to do for.
    done_with: u64,
}

impl Member {
    fn is_loaded(&self) -> bool {
        !self.is_freed && self.calls >= 2
    }

    /// It was started, and hasn't asked for work yet.
    fn is_starting(&self) -> bool {
        self.thread.is_none()
    }
}

#[derive(Default)]
struct CrewState {
    all: Vec<Member>,
    posted: VecDeque<Posted>,
    shared: Option<Shared>,
    /// How often `work_off` was called.
    calls: u64,
    /// How many members still have something to do for `shared`.
    pending: usize,
    /// The first member has no heavy file left in `shared`.
    is_done_with_heavy: bool,
    /// Which member is told to run its `exit` handlers.
    ends: Option<usize>,
    memory: Memory,
}

impl CrewState {
    fn vms(&self) -> Vms {
        Vms {
            count: self.all.iter().filter(|it| !it.is_freed).count(),
            loaded: self.all.iter().filter(|it| it.is_loaded()).count(),
        }
    }

    /// How many VMs are busy with files by which the others aren't counted.
    fn kept(&self) -> usize {
        usize::from(self.shared.is_some() && !self.is_done_with_heavy)
    }
}

/// What a member does next.
enum Next {
    Posted(Posted),
    Heavy(Shared),
    Light(Shared),
    End { frees: bool },
}

/// The threads that have a VM. None is started before it is needed.
#[derive(Default)]
struct Crew {
    start: Start,
    demand: Demand,
    state: Guarded<CrewState>,
    /// `CrewState::pending`, for those who only look.
    busy: AtomicUsize,
    /// There may be something to do for a member.
    is_posted: Condition,
    /// `pending` is 0, or a member is gone.
    is_over: Condition,
}

/// The VM of the member `at`, on its thread.
struct Own<'c> {
    crew: &'c Arc<Crew>,
    at: usize,
    failure: Option<Vec<u8>>,
}

impl Vm for Own<'_> {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        let returned = match &self.failure {
            Some(failure) => Err(failure.clone()),
            None => ThreadVm.call(kind, content, serve),
        };
        Crew::note_a_call(self.crew, self.at);
        returned
    }
}

impl Crew {
    /// Which member the calling thread is.
    fn here(&self) -> Option<usize> {
        let me = Some(std::thread::current().id());
        self.state.lock().all.iter().position(|it| it.thread == me)
    }

    /// Starts members while there's work that nobody is going to take soon, and another VM pays and fits. `Err`: a thread
    /// couldn't be started.
    fn start_more(crew: &Arc<Crew>, state: &mut CrewState) -> Result<(), Vec<u8>> {
        loop {
            let free = |it: &&Member| !it.is_freed && (it.is_idle || it.is_starting());
            let light = state.posted.iter().filter(|it| it.size < HEAVY).count();
            // SAFETY: read from `shared` under the lock.
            let has_files = (state.shared).is_some_and(|it| unsafe { it.work() }.needs_realms());
            let is_needed = match state.all.is_empty() {
                true => !state.posted.is_empty() || state.shared.is_some(),
                false => has_files || light > state.all.iter().filter(free).count(),
            };
            let vms = state.vms();
            let planned = crew.start.memory();
            if !is_needed
                || !(state.memory).has_room_for_another(planned, crew.demand.left(), vms)
                || !(crew.demand).is_worth_another(vms.count - state.kept().min(vms.count))
            {
                return Ok(());
            }
            let (at, for_thread) = (state.all.len(), Arc::clone(crew));
            // SAFETY: no VM or JS state crosses: a number and the crew, whose jobs are `Send`. The new thread makes its own VM,
            // and is done with it before `end_all` returns.
            std::thread::Builder::new()
                .stack_size(bun_sema_driver::STACK_OF_A_WORKER as usize)
                .spawn(move || Crew::run_member(&for_thread, at))
                .map_err(|_| b"Could not start a thread for the plugins.".to_vec())?;
            if state.all.is_empty() {
                state.memory.begin(crew.demand.left());
            }
            state.all.push(Member::default());
            if state.shared.is_some() {
                state.pending += 1;
                crew.busy.store(state.pending, Ordering::Relaxed);
            }
        }
    }

    /// The member `at` has nothing left to do for `shared`.
    fn leave_the_work(&self, state: &mut CrewState, at: usize) {
        let Some(shared) = state
            .shared
            .filter(|it| state.all[at].done_with != it.number)
        else {
            return;
        };
        state.all[at].done_with = shared.number;
        state.pending -= 1;
        self.busy.store(state.pending, Ordering::Relaxed);
        if state.pending == 0 {
            self.is_over.notify_all();
        }
    }

    /// Waits for something to do for the member `at`.
    fn next(&self, at: usize) -> Next {
        let mut state = self.state.lock();
        loop {
            if state.all[at].is_freed || state.ends == Some(at) {
                let frees = state.all[at].is_freed;
                self.leave_the_work(&mut state, at);
                return Next::End { frees };
            }
            // What is heavy is for the first. It leaves the rest to the others as long as one of them is free.
            let others_are_free = (state.all.iter().skip(1)).any(|it| it.is_idle && !it.is_freed);
            let found = match at {
                0 => (state.posted.iter().position(|it| it.size >= HEAVY))
                    .or_else(|| state.posted.front().filter(|_| !others_are_free).map(|_| 0)),
                _ => state.posted.iter().position(|it| it.size < HEAVY),
            };
            if let Some(posted) = found.and_then(|found| state.posted.remove(found)) {
                return Next::Posted(posted);
            }
            match state
                .shared
                .filter(|it| state.all[at].done_with != it.number)
            {
                Some(shared) if at == 0 && !state.is_done_with_heavy => return Next::Heavy(shared),
                Some(shared) => return Next::Light(shared),
                None => {}
            }
            state.all[at].is_idle = true;
            self.is_posted.wait_guarded(&mut state);
            state.all[at].is_idle = false;
        }
    }

    /// What the thread of the member `at` does. Nobody joins it: once it's done with its VM it waits until the process exits.
    fn run_member(crew: &Arc<Crew>, at: usize) -> ! {
        name_this_thread(at);
        bun_sema_driver::keep_regions_on_this_thread();
        let failure = crew.start.start_vm().err();
        {
            let mut state = crew.state.lock();
            state.all[at].thread = Some(std::thread::current().id());
            state.all[at].failure = failure;
        }
        loop {
            match crew.next(at) {
                Next::Posted(mut posted) => {
                    // SAFETY: the thread that owns it waits for the ticket, and nobody else has taken the job.
                    let job = unsafe { posted.job.as_mut() };
                    Crew::with_vm_of(crew, at, posted.size, &mut *job.0);
                    posted.ticket.finish();
                }
                Next::Heavy(shared) => {
                    // SAFETY: this member is counted in `pending` until `leave_the_work`.
                    let work = unsafe { shared.work() };
                    if !work.heavy() {
                        crew.state.lock().is_done_with_heavy = true;
                    }
                }
                Next::Light(shared) => {
                    // SAFETY: this member is counted in `pending` until `leave_the_work`.
                    let work = unsafe { shared.work() };
                    if !work.light(at) {
                        crew.leave_the_work(&mut crew.state.lock(), at);
                    }
                }
                Next::End { frees } => {
                    end_vm(frees);
                    crew.state.lock().all[at].is_gone = true;
                    crew.is_over.notify_all();
                    break;
                }
            }
        }
        let (nothing, never) = (Guarded::new(()), Condition::new());
        let mut nothing = nothing.lock();
        loop {
            never.wait_guarded(&mut nothing);
        }
    }

    /// To its first call a VM answers what it has to load. After the second that is loaded.
    fn note_a_call(crew: &Arc<Crew>, at: usize) {
        let mut state = crew.state.lock();
        let calls = &mut state.all[at].calls;
        *calls = calls.saturating_add(1);
        if *calls != 2 {
            return;
        }
        let loaded = state.vms().loaded;
        state.memory.note_a_load(crew.demand.left(), loaded);
        // Another one may fit by now. If it can't be started, the work is left to those that are there.
        let _ = Crew::start_more(crew, &mut state);
    }

    /// [`Engine::with_vm_here`] on the thread of the member `at`.
    fn with_vm_of(crew: &Arc<Crew>, at: usize, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) {
        let (is_outermost, failure) = {
            let member = &mut crew.state.lock().all[at];
            let was_in_use = core::mem::replace(&mut member.is_in_use, true);
            (!was_in_use, member.failure.clone())
        };
        then(&mut Own { crew, at, failure });
        if !is_outermost {
            return;
        }
        let mut state = crew.state.lock();
        state.all[at].is_in_use = false;
        let (planned, vms) = (crew.start.memory(), state.vms());
        (state.memory).note_a_file(planned, &crew.demand, vms.loaded);
        // The first has the heavy files, and one is left beside it.
        if at != 0
            && state.memory.is_too_much(planned)
            && vms.count - state.kept() > 1
            && !state.all.iter().any(|it| it.is_freed && !it.is_gone)
        {
            state.memory.freed_at = state.memory.given_back;
            state.all[at].is_freed = true;
        }
        // What is heavy is not counted.
        if size < HEAVY {
            crew.demand.note(size);
        }
        let _ = Crew::start_more(crew, &mut state);
    }

    /// [`Engine::with_vm`] on a thread that is no member.
    fn post(
        crew: &Arc<Crew>,
        size: usize,
        then: &mut (dyn FnMut(&mut dyn Vm) + Send),
    ) -> Result<(), Vec<u8>> {
        let mut job = Job(then);
        let ticket = Arc::<Ticket>::default();
        let mut state = crew.state.lock();
        state.posted.push_back(Posted {
            job: NonNull::from(&mut job).cast(),
            size,
            ticket: Arc::clone(&ticket),
        });
        let started = Crew::start_more(crew, &mut state);
        if state.all.is_empty() {
            state.posted.pop_back();
            return started;
        }
        drop(state);
        crew.is_posted.notify_all();
        ticket.wait();
        Ok(())
    }

    /// [`Engine::work_off`]
    fn work_off(
        crew: &Arc<Crew>,
        work: &dyn Work,
        meanwhile: &mut dyn FnMut(),
    ) -> Result<(), Vec<u8>> {
        let mut state = crew.state.lock();
        state.calls += 1;
        state.shared = Some(Shared {
            work: NonNull::from(&work).cast(),
            number: state.calls,
        });
        state.is_done_with_heavy = !work.has_heavy();
        // One that is about to free its VM takes no part.
        let number = state.calls;
        for member in state.all.iter_mut().filter(|it| it.is_freed) {
            member.done_with = number;
        }
        state.pending = state.vms().count;
        crew.busy.store(state.pending, Ordering::Relaxed);
        let started = Crew::start_more(crew, &mut state);
        let is_empty = state.all.is_empty();
        drop(state);
        crew.is_posted.notify_all();
        meanwhile();
        let mut state = crew.state.lock();
        while state.pending > 0 {
            crew.is_over.wait_guarded(&mut state);
        }
        state.shared = None;
        match is_empty {
            true => started,
            false => Ok(()),
        }
    }

    /// Has every member run its `exit` handlers, one after the other. Nothing is being linted any more.
    fn end_all(&self) {
        let mut state = self.state.lock();
        for at in 0..state.all.len() {
            state.ends = Some(at);
            self.is_posted.notify_all();
            while !state.all[at].is_gone {
                self.is_over.wait_guarded(&mut state);
            }
        }
    }
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
    /// The engine was told to free its VM, and has.
    is_gone: AtomicBool,
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

/// What the thread of an engine does. Nobody joins it: once its VM is freed it waits for a turn that never comes, until the
/// process exits.
fn run_engine(number: usize, start: &Start, desk: &Desk) -> ! {
    name_this_thread(number);
    let started = start.start_vm();
    loop {
        let heard = desk.hear(|turn| matches!(turn, Turn::Call { .. } | Turn::End | Turn::Free));
        let Turn::Call { kind, content } = heard else {
            end_vm(matches!(heard, Turn::Free));
            desk.is_gone.store(true, Ordering::Relaxed);
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
    engines: &'e Lending,
    at: usize,
    desk: Arc<Desk>,
    /// The size of the file that it is borrowed for. `None`: a caller further up has borrowed it, and gives it back.
    size: Option<usize>,
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
                    self.note_a_call();
                    return returned;
                }
                _ => {}
            }
        }
    }
}

impl Borrowed<'_> {
    /// To its first call an engine answers what it has to load. After the second that is loaded.
    fn note_a_call(&self) {
        let mut state = self.engines.state.lock();
        let calls = &mut state.all[self.at].calls;
        *calls = calls.saturating_add(1);
        if *calls != 2 {
            return;
        }
        let loaded = state.vms().loaded;
        (state.memory).note_a_load(self.engines.demand.left(), loaded);
        drop(state);
        // Those that wait may start another one by now.
        self.engines.is_idle.notify_all();
    }
}

impl Drop for Borrowed<'_> {
    fn drop(&mut self) {
        let Some(size) = self.size else {
            return;
        };
        let mut state = self.engines.state.lock();
        state.borrowed.retain(|it| it.1 != self.at);
        let (planned, vms) = (self.engines.start.memory(), state.vms());
        (state.memory).note_a_file(planned, &self.engines.demand, vms.loaded);
        // The first has the heavy files, and one is left beside those that are kept.
        if self.at != 0
            && state.memory.is_too_much(planned)
            && vms.count - state.kept > 1
            && !state.all.iter().any(Known::is_being_freed)
        {
            state.memory.freed_at = state.memory.given_back;
            state.all[self.at].is_freed = true;
            self.desk.say(Turn::Free);
        } else {
            state.idle.push(self.at);
        }
        drop(state);
        // What is heavy is not counted.
        if size < HEAVY {
            self.engines.demand.note(size);
        }
        // Each of those that wait may wait for another one.
        self.engines.is_idle.notify_all();
    }
}

/// An engine.
struct Known {
    desk: Arc<Desk>,
    /// Who has borrowed it last.
    by: ThreadId,
    /// How many calls it has answered.
    calls: u8,
    /// It was told to free its VM, and is not lent any more.
    is_freed: bool,
}

impl Known {
    fn is_loaded(&self) -> bool {
        !self.is_freed && self.calls >= 2
    }

    fn is_being_freed(&self) -> bool {
        self.is_freed && !self.desk.is_gone.load(Ordering::Relaxed)
    }
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
    memory: Memory,
}

impl State {
    fn vms(&self) -> Vms {
        Vms {
            count: self.all.iter().filter(|it| !it.is_freed).count(),
            loaded: self.all.iter().filter(|it| it.is_loaded()).count(),
        }
    }
}

/// VMs on threads of their own, which lint threads borrow. None is started before it is needed.
#[derive(Default)]
struct Lending {
    start: Arc<Start>,
    demand: Demand,
    state: Guarded<State>,
    is_idle: Condition,
}

impl Lending {
    /// Ends every engine. Nothing is being linted any more.
    fn end_all(&self) {
        for Known { desk, is_freed, .. } in core::mem::take(&mut self.state.lock().all) {
            if !is_freed {
                desk.say(Turn::End);
            }
            desk.hear(|turn| matches!(turn, Turn::Returned(_)));
        }
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
                size: None,
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
            let vms = state.vms();
            let can_start = (!is_heavy || state.all.is_empty())
                && (state.memory).has_room_for_another(
                    self.start.memory(),
                    self.demand.left(),
                    vms,
                );
            if can_start && (self.demand).is_worth_another(vms.count - state.kept) {
                let (at, desk) = (state.all.len(), Arc::<Desk>::default());
                let (start, for_thread) = (Arc::clone(&self.start), Arc::clone(&desk));
                // SAFETY: no VM or JS state crosses: a number, a `Once` with a flag, and a `Desk`, whose turns are bytes. This
                // thread has no VM. The new one makes its own, and frees it itself before `end_all` returns.
                std::thread::Builder::new()
                    .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
                    .spawn(move || run_engine(at, &start, &for_thread))
                    .map_err(|_| b"Could not start a thread for the plugins.".to_vec())?;
                if state.all.is_empty() {
                    state.memory.begin(self.demand.left());
                }
                state.all.push(Known {
                    desk,
                    by: me,
                    calls: 0,
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
            size: Some(size),
        })
    }
}

enum Threads {
    Lent(Box<Lending>),
    OnLintThreads(Arc<Crew>),
}

/// The VMs of a run.
pub(crate) struct Engines(Threads);

impl Default for Engines {
    fn default() -> Engines {
        Engines(
            match bun_core::getenv_z(bun_core::zstr!("BUN_LINT_SAME_THREAD")) {
                Some(b"1") => Threads::OnLintThreads(Arc::default()),
                _ => Threads::Lent(Box::default()),
            },
        )
    }
}

impl Engines {
    /// Runs the `exit` handlers of every VM. Nothing is being linted any more.
    pub(crate) fn end_all(&self) {
        match &self.0 {
            Threads::Lent(lending) => lending.end_all(),
            Threads::OnLintThreads(crew) => crew.end_all(),
        }
    }

    fn demand(&self) -> &Demand {
        match &self.0 {
            Threads::Lent(lending) => &lending.demand,
            Threads::OnLintThreads(crew) => &crew.demand,
        }
    }
}

impl Engine for Engines {
    fn lints(&self) -> bool {
        matches!(self.0, Threads::OnLintThreads(_))
    }

    fn is_here(&self) -> bool {
        match &self.0 {
            Threads::Lent(_) => true,
            Threads::OnLintThreads(crew) => crew.here().is_some(),
        }
    }

    fn with_vm_here(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        match &self.0 {
            Threads::Lent(lending) => then(&mut lending.borrow(size, size >= HEAVY)?),
            Threads::OnLintThreads(crew) => match crew.here() {
                Some(at) => Crew::with_vm_of(crew, at, size, then),
                None => return Err(b"This thread cannot run the plugins.".to_vec()),
            },
        }
        Ok(())
    }

    fn with_vm(
        &self,
        size: usize,
        then: &mut (dyn FnMut(&mut dyn Vm) + Send),
    ) -> Result<(), Vec<u8>> {
        match &self.0 {
            Threads::OnLintThreads(crew) if crew.here().is_none() => Crew::post(crew, size, then),
            _ => self.with_vm_here(size, then),
        }
    }

    fn work_off(&self, work: &dyn Work, meanwhile: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        match &self.0 {
            Threads::Lent(_) => {
                meanwhile();
                Ok(())
            }
            Threads::OnLintThreads(crew) => Crew::work_off(crew, work, meanwhile),
        }
    }

    fn busy(&self) -> usize {
        match &self.0 {
            Threads::Lent(_) => 0,
            Threads::OnLintThreads(crew) => crew.busy.load(Ordering::Relaxed),
        }
    }

    fn keep_vm(&self, then: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        let Threads::Lent(lending) = &self.0 else {
            return self.with_vm_here(0, &mut |_| then());
        };
        let borrowed = lending.borrow(0, true)?;
        lending.state.lock().kept += 1;
        lending.is_idle.notify_all();
        then();
        lending.state.lock().kept -= 1;
        drop(borrowed);
        Ok(())
    }

    fn sizes(&self) -> (usize, usize) {
        match &self.0 {
            Threads::Lent(lending) => {
                let state = lending.state.lock();
                (state.memory.most, state.all.len() - state.vms().count)
            }
            Threads::OnLintThreads(crew) => {
                let state = crew.state.lock();
                (state.memory.most, state.all.len() - state.vms().count)
            }
        }
    }

    fn may_come(&self, size: u64) {
        self.demand().may_come(size);
    }

    fn comes(&self, size: u64) {
        self.demand().comes(size);
    }

    fn has_shown(&self, size: u64, has_come: bool) {
        self.demand().has_shown(size, has_come);
    }

    fn expect(&self, _files: usize, size: u64, most: usize) {
        match &self.0 {
            Threads::Lent(lending) => lending.start.expect(&lending.demand, size, most),
            Threads::OnLintThreads(crew) => crew.start.expect(&crew.demand, size, most),
        }
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

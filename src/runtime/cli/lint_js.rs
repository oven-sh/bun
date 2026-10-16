//! Runs the `bun lint` rules that are written in JavaScript.
//!
//! A VM belongs to one thread for good. Every VM loads all the plugins itself, so there are fewer VMs than lint threads:
//! [`Demand`] and [`Memory`] decide how many.
//!
//! A thread that has a VM is a lint thread ([`Crew`]). It reads, parses and lints whole files, and what the program asks about a
//! file is a plain function call. Files that need JavaScript are given to these threads ([`Engine::work_off`]). A thread
//! without a VM that turns out to need one posts a job and waits ([`Engine::with_vm`]).
//!
//! The rule that keeps this free of deadlocks: **a thread with a VM never waits for something that can itself wait for a VM.
//! Other threads may wait for it.** So it never joins a parallel region of the pool (`keep_regions_on_this_thread`), and it
//! never posts a job. And nobody posts a job while holding a lock that linting a file takes. A thread with a VM does wait for
//! its own JavaScript, which can need Bun's pool, on which nothing of `bun lint` runs.
//!
//! The program is `bun_lint::js_plugin::program()`: the body of a function that is given the native functions of
//! src/jsc/bindings/Lint*.cpp, and returns the function that [`ThreadVm::call`] calls. These functions ask with [`Bun__Lint__ask`].

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;

use bun_core::strings;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, Strong, virtual_machine::VirtualMachine};
use bun_lint_driver::js_plugin::{Demand, Engine, HEAVY, Serve, Vm, Work, program};
use bun_threading::{Condition, Guarded};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread::ThreadId;

bun_core::declare_scope!(lint_js, hidden);

/// One call into the program: its message, and the callback that answers what the program asks while it runs.
struct Call<'c, 's> {
    content: &'c [u8],
    serve: &'c mut Serve<'s>,
}

/// Per-VM state of `bun lint`. Lives in `RuntimeState::lint`.
pub(crate) struct LintVm {
    /// The function that the program returned.
    handle: Strong,
    /// Set while `handle` runs.
    call: Cell<Option<NonNull<Call<'static, 'static>>>>,
    /// The answers to [`Bun__Lint__ask`] during this call.
    kept: RefCell<Kept>,
}

/// Answers that native code has spans into. Each is written once, and its bytes stay where they are until the call is over:
/// pushing to `all` moves the `Vec`s, not what they point to.
#[derive(Default)]
struct Kept {
    all: Vec<Vec<u8>>,
    /// Which of them answers a kind that was asked for without details.
    plain: Vec<(u32, usize)>,
    /// Native code was given a span.
    is_lent: bool,
}

/// Clears `LintVm::call` when the call is over.
struct Lent<'v>(&'v LintVm, &'v JSGlobalObject);

impl Drop for Lent<'_> {
    fn drop(&mut self) {
        self.0.call.set(None);
        let kept = core::mem::take(&mut *self.0.kept.borrow_mut());
        // The program does this itself, unless it was cut short.
        if kept.is_lent {
            Bun__Lint__endFile(self.1);
        }
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
    /// src/jsc/bindings/LintHost.cpp. Drops every span that native code has kept.
    safe fn Bun__Lint__endFile(global: &JSGlobalObject);
}

/// What was thrown, as text. It can be any value, and to make text of it runs code of a plugin, which can throw again.
fn message_of(global: &JSGlobalObject, error: JSValue) -> Vec<u8> {
    if error.is_termination_exception() {
        return b"JavaScript was stopped.".to_vec();
    }
    // `take_exception` returns the `JSC::Exception`, a cell that is no value: what was thrown is in it.
    match error.to_error().unwrap_or(error).to_bun_string(global) {
        Ok(text) => text.to_utf8().slice().to_vec(),
        Err(_) => {
            global.clear_exception();
            b"An exception was thrown.".to_vec()
        }
    }
}

/// Bytes that stay the same, and in the same place, until the call that is running is over.
#[repr(C)]
struct LintSpan {
    ptr: *const u8,
    len: usize,
}

impl LintSpan {
    fn of(bytes: &[u8]) -> LintSpan {
        LintSpan {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}

/// Answers `kind` and keeps the answer. `None`: no file is being linted.
fn ask_and_keep(kind: u32, details: &[u8]) -> Option<LintSpan> {
    let state = crate::jsc_hooks::lint_vm().get()?;
    let mut call = state.call.get()?;
    // SAFETY: on the stack of `ThreadVm::call`, which is below this frame and takes it out before
    // it returns. `serve` runs no JavaScript, so this is the only reference.
    let call = unsafe { call.as_mut() };
    state.kept.borrow_mut().is_lent = true;
    if kind == 0 {
        return Some(LintSpan::of(call.content));
    }
    if details.is_empty() {
        let kept = state.kept.borrow();
        let known = kept.plain.iter().find(|it| it.0 == kind);
        if let Some(known) = known.and_then(|it| kept.all.get(it.1)) {
            return Some(LintSpan::of(known));
        }
    }
    let mut answer = Vec::new();
    (call.serve)(kind, details, &mut answer);
    // The allocator aligns every block to 8 bytes at least, which native code relies on to read numbers in place.
    debug_assert!(answer.is_empty() || answer.as_ptr().addr().is_multiple_of(8));
    let span = LintSpan::of(&answer);
    let mut kept = state.kept.borrow_mut();
    if details.is_empty() {
        let at = kept.all.len();
        kept.plain.push((kind, at));
    }
    kept.all.push(answer);
    Some(span)
}

/// Answers what the program asks, for src/jsc/bindings/LintHost.h, without a copy. `details` are bytes, so a kind can take numbers
/// as they are. Every answer is kept until the call is over, so this is for tables, not for one small question per node.
/// Null: no file is being linted.
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
    ask_and_keep(kind, details).unwrap_or(LintSpan {
        ptr: core::ptr::null(),
        len: 0,
    })
}

/// Runs the program in this thread's new VM.
fn start_program(vm: &VirtualMachine) -> Result<LintVm, Vec<u8>> {
    let global = vm.global();
    // Strict, so that no function of a plugin gets at those of the program through `caller`.
    let mut source = b"(function (native) {\n\
        \"use strict\";\n\
        const require = process.getBuiltinModule(\"node:module\").createRequire(process.cwd() + \"/\");\n\
        const load = specifier => import(specifier);\n"
        .to_vec();
    program().for_each(|part| source.extend_from_slice(part));
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
    match program.call(
        global,
        JSValue::UNDEFINED,
        &[Bun__Lint__nodeFunctions(global)],
    ) {
        Ok(handle) => {
            bun_core::scoped_log!(lint_js, "a VM is made");
            Ok(LintVm {
                handle: Strong::create(handle, global),
                call: Cell::new(None),
                kept: RefCell::default(),
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
    // Transpile on this thread. It would only wait for the result anyway.
    vm.transpiler_store.enabled = false;
    vm.transpiler.resolver.env_loader = NonNull::new(vm.transpiler.env);
    vm.transpiler.options.env.behavior =
        bun_options_types::schema::api::DotEnvBehavior::LoadAllWithoutInlining;
    // Same as for config files: see `run_script` in `lint_command.rs`.
    vm.transpiler.options.env.disable_default_env_files = true;
    vm.transpiler
        .configure_defines()
        .map_err(|error| failed(error.name()))?;
    vm.load_extra_env_and_source_code_printer();
    vm.argv = bun_core::argv().iter().skip(1).map(Box::from).collect();
    vm.event_loop_mut().ensure_waker();
    Ok(())
}

/// Returns the `LintVm` of `vm`, and runs the program first if it hasn't run yet. `vm` is this thread's, and the caller holds its
/// lock.
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
            let _lent = Lent(state, global);
            let _scope = vm.enter_event_loop_scope();
            let kind = JSValue::js_number_from_int32(kind as i32);
            let mut returned = (state.handle.get().call(global, JSValue::UNDEFINED, &[kind]))
                .map_err(|error| message_of(global, global.take_exception(error)))?;
            if let Some(promise) = returned.as_any_promise() {
                // Like `wait_for_promise`, but gives up on a promise that nothing can settle any more. Node.js exits in that case.
                while promise.status() == jsc::js_promise::Status::Pending {
                    vm.as_mut().event_loop_mut().tick();
                    if promise.status() != jsc::js_promise::Status::Pending {
                        break;
                    }
                    // An unhandled rejection is printed and counted, and the loop doesn't count as alive while that count
                    // isn't 0.
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

/// Parses one line of `/proc/self/cgroup` into (group, mount point, name of the limit file). That file exists in the group's
/// directory and in every directory above it. A cgroup v2 line looks like `0::/a/b`, a v1 line like `9:memory:/a/b`.
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

/// Parses a limit file. `max` means no limit.
fn limit_in(text: &[u8]) -> Option<usize> {
    core::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()
}

/// The lowest memory limit among this process's control groups. That's how a container limits it.
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

/// The memory budget for all VMs together: half of what's available on the machine or in the container. A linter shouldn't take
/// over the machine.
fn memory_for_engines() -> usize {
    // How much happens to be free on the machine that runs a test must not decide the test.
    if let Some(said) = memory_a_test_says() {
        return said / 2;
    }
    // macOS always reports next to nothing as free.
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

fn memory_a_test_says() -> Option<usize> {
    bun_core::getenv_z(bun_core::zstr!("BUN_LINT_MEMORY")).and_then(limit_in)
}

/// Total memory of the machine or the container. Tests override it with `BUN_LINT_MEMORY`.
pub(super) fn memory() -> usize {
    memory_a_test_says().unwrap_or_else(|| {
        let machine = bun_core::get_total_memory_size();
        limit_of_the_groups().map_or(machine, |it| it.min(machine))
    })
}

/// Runs the `exit` handlers of this thread's VM, if it has one. Also frees the VM if `frees` or `BUN_DESTRUCT_VM_ON_EXIT` is set.
fn end_vm(frees: bool) {
    if !VirtualMachine::is_loaded() {
        return;
    }
    let vm = VirtualMachine::get();
    if !frees && !bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false) {
        let _lock = vm.global().vm().get_api_lock();
        return vm.as_mut().on_exit();
    }
    // Never released: `exit_and_free` frees the VM, and the lock with it.
    let _lock = core::mem::ManuallyDrop::new(vm.global().vm().get_api_lock());
    drop(crate::jsc_hooks::take_lint_vm());
    drop(core::mem::take(&mut vm.as_mut().argv));
    // SAFETY: made by `start_vm` on this thread, which holds its lock. Nobody else has a pointer to it.
    unsafe { VirtualMachine::exit_and_free(VirtualMachine::get_mut_ptr()) };
}

/// Startup state that all VMs share.
#[derive(Default)]
struct Start {
    initialize: std::sync::Once,
    /// Set if the run won't have more than a few VMs. Stays unset if a VM starts before the files are known.
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
            // A no-op if a regular expression in a config has already started JSC (`bun_yarr`).
            jsc::initialize(jsc::InitializeOptions::default());
            if !self.is_for_few.load(Ordering::Relaxed) {
                jsc::expect_vm_per_thread();
            }
            // The first VM also creates process-wide singletons like `FileSystem::instance()`, which isn't safe from several
            // threads at once. So the others wait here until it's up.
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
        // How many VMs the files are worth.
        let is_enough = |&vms: &usize| !demand.is_worth_another(vms, 0);
        let vms = (1..most).find(is_enough).unwrap_or(most);
        // With few VMs, cores are left for JSC's compiler threads.
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

/// Assumed size of a VM until the run has shown how its VMs grow. No project we looked at needed much more. So with 16 GB available
/// (a budget of 8 GB) four VMs can start at once, and a fifth waits for real numbers.
const NOT_LOADED_YET: usize = 2 << 30;

/// How many VMs there are, and how many of them have loaded what they need.
#[derive(Copy, Clone)]
struct Vms {
    count: usize,
    loaded: usize,
}

/// Tracks how much memory the VMs of a run use.
#[derive(Default)]
struct Memory {
    /// RSS of the process before the first VM started.
    before: usize,
    /// How much RSS had grown since then at the last look. That covers the VMs, the workers their plugins start, and everything
    /// outside the JS heaps. `most` is its peak, and `most_for_one` the peak per VM that had loaded its plugins.
    taken: usize,
    most: usize,
    most_for_one: usize,
    /// `taken` and the bytes still to lint when `grows_by` was last computed. `grows_by` is how many bytes RSS grew per linted
    /// byte.
    looked_at: (usize, u64),
    grows_by: Option<f64>,
    /// How many files the VMs have finished, and what that count was when a VM was last freed.
    given_back: u32,
    freed_at: u32,
}

impl Memory {
    /// Call this before the first VM starts. `left`: [`Demand::left`]
    fn begin(&mut self, left: u64) {
        self.before = bun_sys::self_process_memory_usage().unwrap_or(0);
        self.looked_at = (0, left);
    }

    /// `left`: [`Demand::left`]
    fn measure(&mut self, left: u64, loaded: usize) {
        let now = bun_sys::self_process_memory_usage().unwrap_or(0);
        self.taken = now.saturating_sub(self.before);
        self.most = self.most.max(self.taken);
        // Only after 1/32 of the remaining bytes. A smaller sample says little.
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

    /// A VM has loaded its plugins. Growth is measured from here on, so that loading doesn't count as growth.
    fn note_a_load(&mut self, left: u64, loaded: usize) {
        self.measure(left, loaded);
        if self.grows_by.is_none() {
            self.looked_at = (self.taken, left);
        }
    }

    /// A VM has finished a file. Measuring costs a system call, so it happens every 16th time, or every time while the growth rate
    /// isn't known yet or the VMs have used up what was `planned`.
    fn note_a_file(&mut self, planned: usize, demand: &Demand, loaded: usize) {
        self.given_back = self.given_back.wrapping_add(1);
        if self.given_back.is_multiple_of(16) || self.grows_by.is_none() || self.taken >= planned {
            self.measure(demand.left(), loaded);
        }
    }

    /// Whether to free a VM. That throws away everything it has loaded and compiled, so only at 1.5 times what was `planned`. And
    /// not within 16 files of the last time, because freed memory takes a while to show.
    fn is_too_much(&self, planned: usize) -> bool {
        self.taken > planned / 2 * 3 && self.given_back.wrapping_sub(self.freed_at) >= 16
    }

    /// Whether one more VM fits into what was `planned`. Assumes that the loaded VMs keep growing per byte as they have so far,
    /// until everything is linted, and that the new VM and those still loading end up as large as one of them.
    fn has_room_for_another(&self, planned: usize, left: u64, vms: Vms) -> bool {
        let one = match self.grows_by {
            Some(grows_by) if vms.loaded > 0 => {
                (self.taken as f64 + grows_by * left as f64) / vms.loaded as f64
            }
            // The size right after loading says little about the final size.
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

    /// How many VMs are busy with heavy files. They don't count towards how many VMs the other files are worth.
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
    /// A copy of `CrewState::pending` that can be read without the lock.
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
                || !crew.demand.is_worth_another(vms.count, state.kept())
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
            // Heavy jobs go to the first member. It leaves the other jobs alone as long as another member is free.
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

    /// Counts the calls a VM has answered. The first one only reports what it has to load, so it's loaded after the second.
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
        // Never the first member, which has the heavy files, and never the last one besides it.
        if at != 0
            && state.memory.is_too_much(planned)
            && vms.count - state.kept() > 1
            && !state.all.iter().any(|it| it.is_freed && !it.is_gone)
        {
            state.memory.freed_at = state.memory.given_back;
            state.all[at].is_freed = true;
        }
        // `Demand` doesn't count heavy files.
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
        debug_assert!(state.shared.is_none());
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

/// The VMs of a run.
#[derive(Default)]
pub(crate) struct Engines(Arc<Crew>);

impl Engines {
    /// Runs the `exit` handlers of every VM. Nothing is being linted any more.
    pub(crate) fn end_all(&self) {
        self.0.end_all();
    }
}

impl Engine for Engines {
    fn is_here(&self) -> bool {
        self.0.here().is_some()
    }

    fn with_vm_here(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        match self.0.here() {
            Some(at) => Crew::with_vm_of(&self.0, at, size, then),
            None => return Err(b"This thread cannot run the plugins.".to_vec()),
        }
        Ok(())
    }

    fn with_vm(
        &self,
        size: usize,
        then: &mut (dyn FnMut(&mut dyn Vm) + Send),
    ) -> Result<(), Vec<u8>> {
        match self.0.here() {
            Some(at) => Crew::with_vm_of(&self.0, at, size, then),
            None => return Crew::post(&self.0, size, then),
        }
        Ok(())
    }

    fn work_off(&self, work: &dyn Work, meanwhile: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        Crew::work_off(&self.0, work, meanwhile)
    }

    fn busy(&self) -> usize {
        self.0.busy.load(Ordering::Relaxed)
    }

    fn sizes(&self) -> (usize, usize) {
        let state = self.0.state.lock();
        (state.memory.most, state.all.len() - state.vms().count)
    }

    fn may_come(&self, size: u64) {
        self.0.demand.may_come(size);
    }

    fn comes(&self, size: u64) {
        self.0.demand.comes(size);
    }

    fn has_shown(&self, size: u64, has_come: bool) {
        self.0.demand.has_shown(size, has_come);
    }

    fn expect(&self, _files: usize, size: u64, most: usize) {
        self.0.start.expect(&self.0.demand, size, most);
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

//! Runs the `bun lint` rules written in JavaScript.
//!
//! A VM is tied to one thread for its whole life. Every VM loads all the plugins itself, so there are fewer VMs than
//! lint threads. [`Demand`] and [`Memory`] decide how many.
//!
//! A thread that has a VM is a lint thread ([`Crew`]). It reads, parses and lints whole files, and the program's
//! queries about a file are plain function calls. Files that need JavaScript are handed to these threads
//! ([`Engine::work_off`]). A thread without a VM that turns out to need one posts a job and waits
//! ([`Engine::with_vm`]).
//!
//! The rule that keeps this free of deadlocks: **a thread with a VM never waits for something that can itself wait for
//! a VM. Other threads may wait for it.** So it never joins a parallel region of the pool
//! (`run_regions_inline_on_this_thread`), and it never posts a job. And no thread posts a job while holding a lock that
//! linting a file takes. A thread with a VM does wait for its own JavaScript, which can need Bun's pool, but no
//! `bun lint` work runs on that pool.
//!
//! The program is `bun_lint::js_plugin::program()`: the body of a function that receives the native functions of
//! src/jsc/bindings/Lint*.cpp and returns the function that [`ThreadVm::call`] calls. Those native functions query Rust
//! through [`Bun__Lint__ask`].

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, Strong, virtual_machine::VirtualMachine};
use bun_lint_driver::js_plugin::{
    Demand, Engine, HEAVY, Serve, Vm, Work, can_be_answered_ahead, drop_spare_lists,
    has_long_answer, is_last_call, is_same_for_all_files, program, rules_in_message,
};
use bun_threading::{Condition, Guarded};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread::ThreadId;

bun_core::declare_scope!(lint_js, hidden);

/// One call into the program: its message, and the callback that answers the program's queries while it runs.
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
    answers: RefCell<KeptAnswers>,
    /// See [`Bun__Lint__collectBetweenFiles`]
    allocated: Cell<u64>,
}

/// Answers that native code has spans into. Each is written once, and its bytes don't move until the call is over:
/// pushing to `all` moves the `Vec`s, not what they point to.
#[derive(Default)]
struct KeptAnswers {
    all: Vec<Vec<u8>>,
    /// Maps a kind that was queried without details to its answer's index in `all`.
    plain: Vec<(u32, usize)>,
    /// Native code was given a span.
    has_lent_span: bool,
}

thread_local! {
    /// For the tree of the next file. A new one for each file would leave the allocator with free memory for every size.
    static SPARE: Cell<Vec<u8>> = const { Cell::new(Vec::new()) };
}

fn keep_spare(mut buffer: Vec<u8>) {
    if buffer.capacity() > 8 << 20 {
        return;
    }
    buffer.clear();
    let kept = SPARE.take();
    SPARE.set(core::cmp::max_by_key(kept, buffer, Vec::capacity));
}

fn buffer_for(request: u32) -> Vec<u8> {
    match has_long_answer(request) {
        true => SPARE.take(),
        false => Vec::new(),
    }
}

fn collect_between_files() {
    if !VirtualMachine::is_loaded() {
        return;
    }
    let Some(state) = crate::jsc_hooks::lint_vm().get() else {
        return;
    };
    let vm = VirtualMachine::get();
    vm.run_with_api_lock(|| {
        let allocated = &state.allocated;
        allocated.set(Bun__Lint__collectBetweenFiles(vm.global(), allocated.get()));
    });
}

/// Clears `LintVm::call` when the call is over.
struct CallGuard<'v>(&'v LintVm, &'v JSGlobalObject);

impl Drop for CallGuard<'_> {
    fn drop(&mut self) {
        self.0.call.set(None);
        let answers = core::mem::take(&mut *self.0.answers.borrow_mut());
        // The program does this itself, unless it was cut short.
        if answers.has_lent_span {
            Bun__Lint__endFile(self.1);
        }
        let largest = answers.all.into_iter().max_by_key(Vec::capacity);
        keep_spare(largest.unwrap_or_default());
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
    /// src/jsc/bindings/LintHost.cpp. Drops every span that native code holds.
    safe fn Bun__Lint__endFile(global: &JSGlobalObject);
    safe fn Bun__Lint__collectBetweenFiles(global: &JSGlobalObject, allocated_before: u64) -> u64;
}

/// Converts the thrown value to text. It can be any value, and the conversion runs plugin code, which can throw again.
fn message_of(global: &JSGlobalObject, error: JSValue) -> Vec<u8> {
    if error.is_termination_exception() {
        return b"JavaScript was stopped.".to_vec();
    }
    // `take_exception` returns the `JSC::Exception`, a cell that isn't a value. The thrown value is inside it.
    match error.to_error().unwrap_or(error).to_bun_string(global) {
        Ok(text) => text.to_utf8().slice().to_vec(),
        Err(_) => {
            global.clear_exception();
            b"An exception was thrown.".to_vec()
        }
    }
}

/// Bytes that don't change or move until the current call is over.
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

/// Answers `kind` and keeps the answer alive. `None` if no file is being linted.
fn ask_and_keep(kind: u32, details: &[u8]) -> Option<LintSpan> {
    let state = crate::jsc_hooks::lint_vm().get()?;
    let mut call = state.call.get()?;
    // SAFETY: it points to the stack of `ThreadVm::call`, which is below this frame and clears the pointer before it
    // returns. `serve` runs no JavaScript, so this is the only reference.
    let call = unsafe { call.as_mut() };
    state.answers.borrow_mut().has_lent_span = true;
    if kind == 0 {
        return Some(LintSpan::of(call.content));
    }
    if details.is_empty() {
        let answers = state.answers.borrow();
        let known = answers.plain.iter().find(|it| it.0 == kind);
        if let Some(known) = known.and_then(|it| answers.all.get(it.1)) {
            return Some(LintSpan::of(known));
        }
    }
    let mut answer = buffer_for(kind);
    (call.serve)(kind, details, &mut answer);
    // The allocator aligns every block to at least 8 bytes, which native code relies on to read numbers in place.
    debug_assert!(answer.is_empty() || answer.as_ptr().addr().is_multiple_of(8));
    let span = LintSpan::of(&answer);
    let mut answers = state.answers.borrow_mut();
    if details.is_empty() {
        let at = answers.all.len();
        answers.plain.push((kind, at));
    }
    answers.all.push(answer);
    Some(span)
}

/// Answers the program's queries, for src/jsc/bindings/LintHost.h, without a copy. `details` are bytes, so a kind can
/// take raw numbers. Every answer is kept until the call is over, so this is for tables, not for one small query per
/// node. Returns null if no file is being linted.
#[unsafe(no_mangle)]
extern "C" fn Bun__Lint__ask(
    _global: &JSGlobalObject,
    kind: u32,
    details: *const u8,
    details_len: usize,
) -> LintSpan {
    let details = match details.is_null() {
        true => &[][..],
        // SAFETY: the caller owns them and keeps them alive until this returns.
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
    crate::read_ahead::enable(vm, false);
    // Strict, so that a plugin's function can't reach the program's functions through `caller`.
    let mut source = b"(function (native) {\n\
        \"use strict\";\n\
        const require = process.getBuiltinModule(\"node:module\").createRequire(process.cwd() + \"/\");\n\
        const load = specifier => import(specifier);\n"
        .to_vec();
    program().for_each(|part| source.extend_from_slice(part));
    source.extend_from_slice(b"\n})");
    let name = b"bun-lint-plugins.js";
    let mut exception = JSValue::UNDEFINED;
    // SAFETY: `global` belongs to this thread's VM, whose lock is held, and the slices and `exception` outlive the
    // call.
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
                answers: RefCell::default(),
                allocated: Cell::new(0),
            })
        }
        Err(error) => Err(message_of(global, global.take_exception(error))),
    }
}

/// Creates a VM for this thread. `log` outlives it.
fn start_vm(log: *mut bun_ast::Log) -> Result<(), Vec<u8>> {
    bun_core::scoped_log!(lint_js, "a VM begins");
    let failed = |what: &str| {
        [
            b"Could not start JavaScript for the plugins: ",
            what.as_bytes(),
        ]
        .concat()
    };
    bun_ast::initialize_store();
    static ARGV: std::sync::LazyLock<Vec<Box<[u8]>>> =
        std::sync::LazyLock::new(|| bun_core::argv().iter().skip(1).map(Box::from).collect());
    let options = jsc::VirtualMachineInitOptions {
        argv: &ARGV,
        is_main_thread: false,
        ..Default::default()
    };
    let vm = VirtualMachine::init(log, options).map_err(|error| failed(error.name()))?;
    // Transpile on this thread. It would only wait for the result anyway.
    vm.transpiler_store.enabled.set(false);
    vm.transpiler
        .with_mut(|t| {
            t.resolver.env_loader = NonNull::new(t.env);
            t.options.env.behavior =
                bun_options_types::schema::api::DotEnvBehavior::LoadAllWithoutInlining;
            // Same as for config files: see `run_script` in `lint_command.rs`.
            t.options.env.disable_default_env_files = true;
            t.resolver.opts.packages_require_like_node();
            t.configure_defines()
        })
        .map_err(|error| failed(error.name()))?;
    vm.load_extra_env();
    vm.event_loop().ensure_waker();
    Ok(())
}

/// Returns `vm`'s `LintVm`, and runs the program first if it hasn't run yet. `vm` is this thread's VM, and the caller
/// holds its lock.
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

/// This thread's VM.
struct ThreadVm;

impl Vm for ThreadVm {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        let vm = VirtualMachine::get();
        vm.run_with_api_lock(|| {
            let global = vm.global();
            let state = program_of(vm)?;
            let mut call = Call { content, serve };
            state.call.set(Some(NonNull::from(&mut call).cast()));
            let _call_guard = CallGuard(state, global);
            let _scope = vm.enter_event_loop_scope();
            let kind = JSValue::js_number_from_int32(kind as i32);
            let mut returned = (state.handle.get().call(global, JSValue::UNDEFINED, &[kind]))
                .map_err(|error| message_of(global, global.take_exception(error)))?;
            if let Some(promise) = returned.as_any_promise() {
                // Like `wait_for_promise`, but gives up on a promise that nothing can settle anymore. Node.js exits in
                // that case.
                while promise.status() == jsc::js_promise::Status::Pending {
                    vm.event_loop().tick();
                    if promise.status() != jsc::js_promise::Status::Pending {
                        break;
                    }
                    // An unhandled rejection is printed and counted, and the loop doesn't count as alive while that
                    // count isn't 0.
                    vm.unhandled_error_counter.set(0);
                    if !vm.is_event_loop_alive() {
                        return Err(
                            b"A promise never settled, and nothing is left to wait for.".to_vec()
                        );
                    }
                    vm.auto_tick();
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

/// Parses one line of `/proc/self/cgroup` into (group, mount point, name of the limit file). That file exists in the
/// group's directory and in every directory above it. A cgroup v2 line looks like `0::/a/b`, a v1 line like
/// `9:memory:/a/b`.
#[cfg_attr(not(any(target_os = "linux", test)), expect(dead_code))]
fn parse_cgroup_line(line: &[u8]) -> Option<(&[u8], &'static [u8], &'static [u8])> {
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
fn parse_limit(text: &[u8]) -> Option<usize> {
    core::str::from_utf8(text.trim_ascii()).ok()?.parse().ok()
}

/// The lowest memory limit among this process's control groups. That's how a container limits it.
#[cfg(target_os = "linux")]
fn cgroup_memory_limit() -> Option<usize> {
    use bun_sys::{Fd, File};
    let groups = File::read_from(Fd::cwd(), b"/proc/self/cgroup").ok()?;
    let limits = strings::split(&groups, b"\n")
        .filter_map(parse_cgroup_line)
        .flat_map(|(group, root, file)| {
            let above = core::iter::successors(Some(group), |it| {
                Some(&it[..strings::last_index_of_char(it, b'/')?])
            });
            above.filter_map(move |it| {
                parse_limit(&File::read_from(Fd::cwd(), &[root, it, b"/", file].concat()).ok()?)
            })
        });
    limits.min()
}

#[cfg(not(target_os = "linux"))]
fn cgroup_memory_limit() -> Option<usize> {
    None
}

/// The memory budget for all VMs together: half of what's available on the machine or in the container. A linter
/// shouldn't take over the machine.
fn memory_for_engines() -> usize {
    // A test's result must not depend on how much memory happens to be free on the machine that runs it.
    if let Some(override_bytes) = memory_override_for_tests() {
        return override_bytes / 2;
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

fn memory_override_for_tests() -> Option<usize> {
    bun_core::getenv_z(bun_core::zstr!("BUN_LINT_MEMORY")).and_then(parse_limit)
}

/// Total memory of the machine or the container. Tests override it with `BUN_LINT_MEMORY`.
pub(super) fn memory() -> usize {
    memory_override_for_tests().unwrap_or_else(|| {
        let machine = bun_core::get_total_memory_size();
        cgroup_memory_limit().map_or(machine, |it| it.min(machine))
    })
}

/// Runs the `exit` handlers of this thread's VM, if it has one. Also frees the VM if `frees` or
/// `BUN_DESTRUCT_VM_ON_EXIT` is set.
fn end_vm(frees: bool) {
    if !VirtualMachine::is_loaded() {
        return;
    }
    let vm = VirtualMachine::get();
    if !frees && !bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false) {
        let _lock = vm.global().vm().get_api_lock();
        return vm.on_exit();
    }
    // Never released: `exit_and_free` frees the VM, and the lock with it.
    let _lock = core::mem::ManuallyDrop::new(vm.global().vm().get_api_lock());
    drop(crate::jsc_hooks::take_lint_vm());
    // SAFETY: `start_vm` created it on this thread, which holds its lock. No other thread has a pointer to it.
    unsafe { VirtualMachine::exit_and_free(VirtualMachine::get_mut_ptr()) };
}

/// Startup state that all VMs share.
#[derive(Default)]
struct Start {
    initialize: std::sync::Once,
    /// Set if the run won't have more than a few VMs. Stays unset if a VM starts before the files are known.
    is_for_few: AtomicBool,
    /// The same if no VM has much to do
    is_short: AtomicBool,
    memory: std::sync::OnceLock<usize>,
}

impl Start {
    /// [`memory_for_engines`]
    fn memory(&self) -> usize {
        *self.memory.get_or_init(memory_for_engines)
    }

    /// As [`start_vm`].
    fn start_vm(&self, log: *mut bun_ast::Log) -> Result<(), Vec<u8>> {
        let mut first = None;
        self.initialize.call_once(|| {
            // A no-op if a regular expression in a config has already started JSC (`bun_yarr`).
            jsc::initialize(jsc::InitializeOptions::default());
            match self.is_for_few.load(Ordering::Relaxed) {
                true => jsc::expect_few_lint_vms(),
                false => jsc::expect_vm_per_thread(self.is_short.load(Ordering::Relaxed)),
            }
            // The first VM also creates process-wide singletons like `FileSystem::instance()`, which isn't safe from
            // several threads at once. So the others wait here until it's up.
            first = Some(start_vm(log).and_then(|()| {
                let vm = VirtualMachine::get();
                vm.run_with_api_lock(|| program_of(vm).map(|_| ()))
            }));
        });
        first.unwrap_or_else(|| start_vm(log))
    }

    /// [`Engine::expect`]
    fn expect(&self, demand: &Demand, files: usize, size: u64, most: usize) {
        let most = most.min(files.max(1));
        demand.expect(size, most);
        // How many VMs the files are worth.
        let is_enough = |&vms: &usize| !demand.is_worth_another(vms, 0);
        let vms = (1..most).find(is_enough).unwrap_or(most);
        // With few VMs, cores are left for JSC's compiler threads.
        // More than three keep waiting for each other: a VM that collects garbage stops these threads.
        let is_for_few = vms <= (usize::from(bun_core::get_thread_count()) / 2).min(3);
        self.is_for_few.store(is_for_few, Ordering::Relaxed);
        let is_short = size / (vms.max(1) as u64) < 1 << 20;
        self.is_short.store(is_short, Ordering::Relaxed);
    }
}

fn name_this_thread(number: usize) {
    let name = format!("Bun Lint JS {number}\0");
    bun_core::Output::Source::configure_named_thread(bun_core::ZStr::from_slice_with_nul(
        name.as_bytes(),
    ));
}

fn wait_for_exit() -> ! {
    let (nothing, never) = (Guarded::new(()), Condition::new());
    let mut nothing = nothing.lock();
    loop {
        never.wait_guarded(&mut nothing);
    }
}

/// Assumed size of a VM until the run has shown how its VMs grow. No project we looked at needed much more. So with 16
/// GB available (a budget of 8 GB) four VMs can start at once, and a fifth waits for real numbers.
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
    rss_before: usize,
    /// How much RSS had grown since then at the last measurement. That covers the VMs, the workers their plugins start,
    /// and everything outside the JS heaps. `peak_growth` is its peak, and `peak_per_vm` the peak per VM that had
    /// loaded its plugins.
    rss_growth: usize,
    peak_growth: usize,
    peak_per_vm: usize,
    /// `rss_growth` and the bytes still to lint when `growth_per_byte` was last computed. `growth_per_byte` is how many
    /// bytes RSS grew per linted byte.
    last_sample: (usize, u64),
    growth_per_byte: Option<f64>,
    /// How many files the VMs have finished, and what that count was when a VM was last freed.
    files_done: u32,
    freed_at: u32,
}

impl Memory {
    /// Call this before the first VM starts. `left` is [`Demand::left`].
    fn begin(&mut self, left: u64) {
        self.rss_before = bun_sys::self_process_memory_usage().unwrap_or(0);
        self.last_sample = (0, left);
    }

    /// `left` is [`Demand::left`].
    fn measure(&mut self, left: u64, loaded: usize) {
        let now = bun_sys::self_process_memory_usage().unwrap_or(0);
        self.rss_growth = now.saturating_sub(self.rss_before);
        self.peak_growth = self.peak_growth.max(self.rss_growth);
        // Only after 1/32 of the remaining bytes. A smaller sample is too noisy.
        let (growth_then, left_then) = self.last_sample;
        let done = left_then.saturating_sub(left);
        if done > 0 && done >= left_then / 32 {
            self.growth_per_byte =
                Some(self.rss_growth.saturating_sub(growth_then) as f64 / done as f64);
            self.last_sample = (self.rss_growth, left);
        }
        if let Some(for_one) = self.rss_growth.checked_div(loaded) {
            self.peak_per_vm = self.peak_per_vm.max(for_one);
        }
    }

    /// A VM has loaded its plugins. Growth is measured from here on, so that loading doesn't count as growth.
    fn note_load(&mut self, left: u64, loaded: usize) {
        self.measure(left, loaded);
        if self.growth_per_byte.is_none() {
            self.last_sample = (self.rss_growth, left);
        }
    }

    /// A VM has finished a file. Measuring costs a system call, so it happens every 16th time, or every time while the
    /// growth rate isn't known yet or the VMs have used up what was `planned`.
    fn note_file(&mut self, planned: usize, demand: &Demand, loaded: usize) {
        self.files_done = self.files_done.wrapping_add(1);
        if self.files_done.is_multiple_of(16)
            || self.growth_per_byte.is_none()
            || self.rss_growth >= planned
        {
            self.measure(demand.left(), loaded);
        }
    }

    /// True if a VM should be freed. That throws away everything it has loaded and compiled, so only at 1.5 times what
    /// was `planned`. And not within 16 files of the last time, because freed memory takes a while to show.
    fn is_too_much(&self, planned: usize) -> bool {
        self.rss_growth > planned / 2 * 3 && self.files_done.wrapping_sub(self.freed_at) >= 16
    }

    /// True if one more VM fits into what was `planned`. Assumes that the loaded VMs keep growing per byte as they have
    /// so far, until everything is linted, and that the new VM and those still loading end up as large as one of them.
    fn has_room_for_another(&self, planned: usize, left: u64, vms: Vms) -> bool {
        let one = match self.growth_per_byte {
            Some(growth_per_byte) if vms.loaded > 0 => {
                (self.rss_growth as f64 + growth_per_byte * left as f64) / vms.loaded as f64
            }
            // The size right after loading is a poor predictor of the final size.
            _ => NOT_LOADED_YET as f64,
        };
        let all = one.max(self.peak_per_vm as f64) * (vms.count + 1) as f64;
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

// SAFETY: it holds no VM or JS state. The closure is `Send`, and the thread that owns it only waits for the ticket
// until the job is done.
unsafe impl Send for Posted {}

/// The thread that posted a job waits on this.
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

/// While a member runs the rules on a file, one helper finishes the file before it and then prepares the one after it. The
/// other waits for the member.
const HELPERS: usize = 2;

/// A thread that reads, parses and lints the files of a member, which only runs the JavaScript.
#[derive(Copy, Clone, PartialEq)]
struct Helper {
    member: usize,
    number: usize,
}

thread_local! {
    static HELPER: Cell<Option<Helper>> = const { Cell::new(None) };
}

/// A request with its details
type Request = (u32, Vec<u8>);

/// [`Vm::call`] by a helper
struct RemoteCall {
    by: Helper,
    kind: u32,
    content: NonNull<[u8]>,
    /// For what the program is likely to ask
    answers: VecDeque<(Request, Vec<u8>)>,
    line: Arc<Line>,
}

// SAFETY: it holds no VM or JS state. `content` is only read, and its owner waits at `line` until the call has returned.
unsafe impl Send for RemoteCall {}

/// Between a member and a helper, for one call.
#[derive(Default)]
struct Line {
    said: Guarded<Option<Said>>,
    /// For the helper, and for the member
    changed: [Condition; 2],
}

enum Said {
    Request(Request),
    Answer(Vec<u8>),
    /// And [`SPARE`]
    Returned(Result<Vec<u8>, Vec<u8>>, Vec<u8>),
}

impl Line {
    fn say(&self, what: Said) {
        let is_answer = matches!(what, Said::Answer(_));
        *self.said.lock() = Some(what);
        self.changed[usize::from(is_answer)].notify_one();
    }

    /// Waits for an answer, or for something else.
    fn hear(&self, an_answer: bool) -> Said {
        let mut said = self.said.lock();
        loop {
            match said.take_if(|it| matches!(it, Said::Answer(_)) == an_answer) {
                Some(heard) => return heard,
                None => self.changed[usize::from(an_answer)].wait_guarded(&mut said),
            }
        }
    }
}

/// The VM of a member, on the thread of a helper.
struct Remote<'c> {
    crew: &'c Crew,
    by: Helper,
}

impl Vm for Remote<'_> {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        let (crew, by) = (self.crew, self.by);
        let rules = rules_in_message(kind, content);
        let likely = rules.and_then(|rules| {
            let state = crew.state.lock();
            state.all[by.member].requests.get(&rules.concat()).cloned()
        });
        let answer = |request: Request| {
            let mut answer = buffer_for(request.0);
            serve(request.0, &request.1, &mut answer);
            (request, answer)
        };
        let answers = likely.into_iter().flatten().map(answer).collect();
        let line = Arc::<Line>::default();
        let mut state = crew.state.lock();
        let member = &mut state.all[by.member];
        member.remote_calls.push_back(RemoteCall {
            by,
            kind,
            content: NonNull::from(content),
            answers,
            line: Arc::clone(&line),
        });
        member.prepares.take_if(|it| *it == by && rules.is_some());
        drop(state);
        crew.is_posted.notify_all();
        crew.may_prepare.notify_all();
        loop {
            match line.hear(false) {
                Said::Request((request, details)) => {
                    let mut answer = buffer_for(request);
                    serve(request, &details, &mut answer);
                    line.say(Said::Answer(answer));
                }
                Said::Returned(returned, spare) => {
                    keep_spare(spare);
                    return returned;
                }
                Said::Answer(_) => unreachable!("not what was waited for"),
            }
        }
    }
}

/// The arguments of a [`Crew::work_off`] call.
#[derive(Copy, Clone)]
struct Shared {
    work: NonNull<&'static dyn Work>,
    /// Starts at 1 and is different for every call.
    number: u64,
}

// SAFETY: it holds no VM or JS state. `dyn Work` is `Sync`, and `work_off` doesn't return while a thread can still
// reach it.
unsafe impl Send for Shared {}

impl Shared {
    /// # Safety
    /// Only while `work_off` waits: the caller is counted in `CrewState::pending`, or holds the lock and has read this
    /// from `CrewState::shared`.
    unsafe fn work(&self) -> &dyn Work {
        // SAFETY: it points to the stack of `work_off`, which is still waiting by the contract.
        unsafe { *self.work.as_ref() }
    }
}

/// A thread with a VM.
#[derive(Default)]
struct Member {
    /// `None` until it runs.
    thread: Option<ThreadId>,
    /// Why it failed to get a VM. It still takes work, and fails it with this message.
    failure: Option<Vec<u8>>,
    /// How many calls its VM has answered.
    calls: u8,
    /// A call of `with_vm_here` is on its stack.
    is_in_use: bool,
    /// It's waiting for work.
    is_idle: bool,
    /// It frees its VM once it's done with its file, and takes no more work.
    is_freed: bool,
    /// It has run the `exit` handlers, or freed its VM.
    is_gone: bool,
    /// [`Shared::number`] of the last work that it has finished its part of.
    done_with: u64,
    /// The same for the last work that it has started helpers for, and how many of them are at it.
    helped_with: u64,
    helpers: usize,
    /// One at a time takes a file and calls for it to be linted, so that the files come in the order they would without helpers.
    prepares: Option<Helper>,
    remote_calls: VecDeque<RemoteCall>,
    /// The helper that has more calls to make before anyone else does.
    lent_to: Option<Helper>,
    /// What the program asked for the last file, by [`rules_in_message`].
    requests: HashMap<Vec<u8>, Vec<Request>>,
}

impl Member {
    fn is_loaded(&self) -> bool {
        !self.is_freed && self.calls >= 2
    }

    /// True if it was started and hasn't asked for work yet.
    fn is_starting(&self) -> bool {
        self.thread.is_none()
    }
}

#[derive(Default)]
struct CrewState {
    all: Vec<Member>,
    posted: VecDeque<Posted>,
    shared: Option<Shared>,
    /// The number of `work_off` calls.
    calls: u64,
    /// How many members still have something to do for `shared`.
    pending: usize,
    /// The first member has no heavy file left in `shared`.
    is_done_with_heavy: bool,
    /// How many of its helpers have one.
    helpers_with_heavy: usize,
    /// The member that should run its `exit` handlers now.
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
    fn heavy_vms(&self) -> usize {
        let has_heavy = !self.is_done_with_heavy || self.helpers_with_heavy > 0;
        usize::from(self.shared.is_some() && has_heavy)
    }
}

/// A member's next task.
enum Next {
    Posted(Posted),
    Remote(RemoteCall),
    StartHelpers(Shared),
    Heavy(Shared),
    Light(Shared),
    End { frees: bool },
}

/// The threads that have a VM. Each is only started when it's needed.
#[derive(Default)]
struct Crew {
    start: Start,
    demand: Demand,
    state: Guarded<CrewState>,
    /// A copy of `CrewState::pending` that can be read without the lock.
    busy: AtomicUsize,
    /// How many helpers are at work.
    helping: AtomicUsize,
    /// There may be something to do for a member.
    is_posted: Condition,
    /// `pending` is 0, or a member is gone.
    is_over: Condition,
    /// See [`Member::prepares`]
    may_prepare: Condition,
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
        Crew::note_call(self.crew, self.at);
        returned
    }
}

impl Crew {
    /// The calling thread's member index.
    fn here(&self) -> Option<usize> {
        let me = Some(std::thread::current().id());
        self.state.lock().all.iter().position(|it| it.thread == me)
    }

    /// Starts members while there's work that no member is going to take soon, and another VM is worth it and fits.
    /// `Err` if a thread couldn't be started.
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
                || !crew.demand.is_worth_another(vms.count, state.heavy_vms())
            {
                return Ok(());
            }
            let (at, for_thread) = (state.all.len(), Arc::clone(crew));
            // SAFETY: no VM or JS state crosses threads, only a number and the crew, whose jobs are `Send`. The new
            // thread creates its own VM and is done with it before `end_all` returns.
            std::thread::Builder::new()
                .stack_size(bun_sema_driver::WORKER_STACK_SIZE as usize)
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
    fn finish_shared_work(&self, state: &mut CrewState, at: usize) {
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
            let member = &mut state.all[at];
            let lent_to = member.lent_to;
            let is_allowed = |it: &RemoteCall| lent_to.is_none_or(|helper| helper == it.by);
            let allowed = member.remote_calls.iter().position(is_allowed);
            // What another thread waits for comes first.
            let has_posted = lent_to.is_none() && !state.posted.is_empty();
            let member = &mut state.all[at];
            if (member.is_freed && member.helpers == 0) || state.ends == Some(at) {
                let frees = state.all[at].is_freed;
                self.finish_shared_work(&mut state, at);
                return Next::End { frees };
            }
            // Heavy jobs go to the first member. It leaves the other jobs alone as long as another member is free.
            let others_are_free = (state.all.iter().skip(1)).any(|it| it.is_idle && !it.is_freed);
            let found = match at {
                0 => (state.posted.iter().position(|it| it.size >= HEAVY))
                    .or_else(|| state.posted.front().filter(|_| !others_are_free).map(|_| 0)),
                _ => state.posted.iter().position(|it| it.size < HEAVY),
            };
            let found = found.filter(|_| has_posted && !state.all[at].is_freed);
            if let Some(posted) = found.and_then(|found| state.posted.remove(found)) {
                return Next::Posted(posted);
            }
            let member = &mut state.all[at];
            if let Some(call) = allowed.and_then(|it| member.remote_calls.remove(it)) {
                member.lent_to = Some(call.by);
                return Next::Remote(call);
            }
            // SAFETY: read from `shared` under the lock.
            let can_have_helpers = |it: Shared| unsafe { it.work() }.can_have_helpers(at);
            match state
                .shared
                .filter(|it| state.all[at].done_with != it.number)
            {
                Some(_) if state.all[at].helpers > 0 => {}
                Some(shared)
                    if state.all[at].helped_with != shared.number && can_have_helpers(shared) =>
                {
                    state.all[at].helped_with = shared.number;
                    state.all[at].helpers = HELPERS;
                    return Next::StartHelpers(shared);
                }
                Some(shared) if at == 0 && !state.is_done_with_heavy => return Next::Heavy(shared),
                Some(shared) => return Next::Light(shared),
                None => {}
            }
            state.all[at].is_idle = state.all[at].helpers == 0;
            self.is_posted.wait_guarded(&mut state);
            state.all[at].is_idle = false;
        }
    }

    /// The thread function of the member `at`. The thread is never joined: once it's done with its VM it waits until
    /// the process exits.
    fn run_member(crew: &Arc<Crew>, at: usize) -> ! {
        name_this_thread(at);
        bun_sema_driver::run_regions_inline_on_this_thread();
        let mut log = bun_ast::Log::default();
        let failure = crew.start.start_vm(&raw mut log).err();
        {
            let mut state = crew.state.lock();
            state.all[at].thread = Some(std::thread::current().id());
            state.all[at].failure = failure;
        }
        let mut remembered = HashMap::default();
        loop {
            match crew.next(at) {
                Next::Posted(mut posted) => {
                    // SAFETY: the thread that owns it waits for the ticket, and no other member has taken the job.
                    let job = unsafe { posted.job.as_mut() };
                    Crew::with_vm_of(crew, at, posted.size, &mut *job.0);
                    posted.ticket.finish();
                }
                Next::Remote(call) => Crew::answer(crew, call, &mut remembered),
                Next::StartHelpers(shared) => {
                    for number in 0..HELPERS {
                        let (me, for_thread) = (Helper { member: at, number }, Arc::clone(crew));
                        // SAFETY: no VM or JS state crosses threads, only numbers, the crew and `shared`.
                        let started = std::thread::Builder::new()
                            .stack_size(bun_sema_driver::WORKER_STACK_SIZE as usize)
                            .spawn(move || Crew::run_helper(&for_thread, me, shared));
                        if started.is_err() {
                            crew.state.lock().all[at].helpers -= 1;
                        }
                    }
                }
                Next::Heavy(shared) => {
                    // SAFETY: this member is counted in `pending` until `finish_shared_work`.
                    let work = unsafe { shared.work() };
                    if !work.heavy() {
                        crew.state.lock().is_done_with_heavy = true;
                    }
                }
                Next::Light(shared) => {
                    // SAFETY: this member is counted in `pending` until `finish_shared_work`.
                    let work = unsafe { shared.work() };
                    if !work.light(at) {
                        crew.finish_shared_work(&mut crew.state.lock(), at);
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
        // This frame never returns, and a VM that `end_vm` kept still points at `log`.
        if !VirtualMachine::is_loaded() {
            drop(log);
        }
        wait_for_exit()
    }

    /// The thread function of a helper. What it leaves, the member does itself.
    fn run_helper(crew: &Arc<Crew>, me: Helper, shared: Shared) -> ! {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Bun Lint Help"));
        bun_sema_driver::run_regions_inline_on_this_thread();
        HELPER.set(Some(me));
        crew.helping.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the member is counted in `pending` as long as it has helpers.
        let work = unsafe { shared.work() };
        let mut state = crew.state.lock();
        let mut has_more = true;
        while has_more && !state.all[me.member].is_freed {
            if state.all[me.member].prepares.is_some() {
                crew.may_prepare.wait_guarded(&mut state);
                continue;
            }
            let is_heavy = me.member == 0 && !state.is_done_with_heavy;
            if is_heavy || work.needs_realms() {
                state.all[me.member].prepares = Some(me);
            }
            state.helpers_with_heavy += usize::from(is_heavy);
            drop(state);
            let has_found = if is_heavy {
                work.heavy()
            } else {
                work.light(me.member)
            };
            has_more = has_found || is_heavy;
            state = crew.state.lock();
            state.is_done_with_heavy |= is_heavy && !has_found;
            state.helpers_with_heavy -= usize::from(is_heavy);
            if state.all[me.member]
                .prepares
                .take_if(|it| *it == me)
                .is_some()
            {
                crew.may_prepare.notify_all();
            }
        }
        state.all[me.member].helpers -= 1;
        drop(state);
        crew.helping.fetch_sub(1, Ordering::Relaxed);
        crew.is_posted.notify_all();
        drop(SPARE.take());
        drop_spare_lists();
        bun_sema_driver::drop_caches_of_this_thread();
        bun_sema::session::give_back_free_memory();
        wait_for_exit()
    }

    /// Makes the call of a helper, on the thread of its member. `remembered`: see [`is_same_for_all_files`].
    fn answer(crew: &Arc<Crew>, mut call: RemoteCall, remembered: &mut HashMap<Vec<u8>, Vec<u8>>) {
        let at = call.by.member;
        // SAFETY: the helper keeps it until it hears that the call has returned.
        let content = unsafe { call.content.as_ref() };
        let rules = rules_in_message(call.kind, content).map(|it| it.concat());
        let mut requests = Vec::<Request>::new();
        let mut serve = |request: u32, details: &[u8], out: &mut Vec<u8>| {
            if can_be_answered_ahead(request) {
                requests.push((request, details.to_vec()));
            }
            let for_all = (rules.as_ref().filter(|_| is_same_for_all_files(request)))
                .map(|rules| [&request.to_le_bytes(), &rules[..], details].concat());
            if let Some(known) = for_all.as_ref().and_then(|it| remembered.get(it)) {
                return out.extend_from_slice(known);
            }
            let is_same = |(it, _): &(Request, _)| it.0 == request && it.1 == details;
            let known = call.answers.iter().position(is_same);
            let mut answer = match known.and_then(|it| call.answers.remove(it)) {
                Some((_, answer)) => answer,
                None => {
                    call.line.say(Said::Request((request, details.to_vec())));
                    match call.line.hear(true) {
                        Said::Answer(answer) => answer,
                        _ => unreachable!("not what was waited for"),
                    }
                }
            };
            if let Some(for_all) = for_all {
                remembered.insert(for_all, answer.clone());
            }
            match out.is_empty() {
                true => *out = answer,
                false => out.append(&mut answer),
            }
        };
        let failure = crew.state.lock().all[at].failure.clone();
        let returned = Own { crew, at, failure }.call(call.kind, content, &mut serve);
        if returned
            .as_ref()
            .is_ok_and(|it| is_last_call(call.kind, it))
        {
            let member = &mut crew.state.lock().all[at];
            member.lent_to = None;
            if let Some(rules) = rules {
                member.requests.insert(rules, requests);
            }
        }
        call.line.say(Said::Returned(returned, SPARE.take()));
        collect_between_files();
    }

    /// [`Engine::with_vm_here`] on the thread of a helper.
    fn with_vm_for(crew: &Arc<Crew>, by: Helper, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) {
        thread_local! {
            static IS_IN_USE: Cell<bool> = const { Cell::new(false) };
        }
        let was_in_use = IS_IN_USE.replace(true);
        then(&mut Remote { crew, by });
        if was_in_use {
            return;
        }
        IS_IN_USE.set(false);
        let mut state = crew.state.lock();
        if state.all[by.member]
            .lent_to
            .take_if(|it| *it == by)
            .is_some()
        {
            crew.is_posted.notify_all();
        }
        Crew::note_file(crew, &mut state, by.member, size);
    }

    /// Counts the calls a VM has answered. The first one only reports what it has to load, so it's loaded after the
    /// second.
    fn note_call(crew: &Arc<Crew>, at: usize) {
        let mut state = crew.state.lock();
        let calls = &mut state.all[at].calls;
        *calls = calls.saturating_add(1);
        if *calls != 2 {
            return;
        }
        let loaded = state.vms().loaded;
        state.memory.note_load(crew.demand.left(), loaded);
        // Another VM may fit now. If it can't be started, the existing members do the work.
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
        collect_between_files();
        let mut state = crew.state.lock();
        state.all[at].is_in_use = false;
        Crew::note_file(crew, &mut state, at, size);
    }

    /// The member `at` is done with a file of `size` bytes.
    fn note_file(crew: &Arc<Crew>, state: &mut CrewState, at: usize, size: usize) {
        let (planned, vms) = (crew.start.memory(), state.vms());
        (state.memory).note_file(planned, &crew.demand, vms.loaded);
        // Never the first member, which has the heavy files, and never the last one besides it.
        if at != 0
            && state.memory.is_too_much(planned)
            && vms.count - state.heavy_vms() > 1
            && !state.all.iter().any(|it| it.is_freed && !it.is_gone)
        {
            state.memory.freed_at = state.memory.files_done;
            state.all[at].is_freed = true;
        }
        // `Demand` doesn't count heavy files.
        if size < HEAVY {
            crew.demand.note(size);
        }
        let _ = Crew::start_more(crew, state);
    }

    /// [`Engine::with_vm`] on a thread that isn't a member.
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
        // A member that's about to free its VM doesn't take part.
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

    /// Makes every member run its `exit` handlers, one after the other. Nothing is being linted anymore.
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
    /// Runs the `exit` handlers of every VM. Nothing is being linted anymore.
    pub(crate) fn end_all(&self) {
        self.0.end_all();
    }
}

impl Engine for Engines {
    fn thread_has_realm(&self) -> bool {
        HELPER.get().is_some() || self.0.here().is_some()
    }

    fn with_vm_here(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        if let Some(helper) = HELPER.get() {
            Crew::with_vm_for(&self.0, helper, size, then);
            return Ok(());
        }
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
        if let Some(helper) = HELPER.get() {
            Crew::with_vm_for(&self.0, helper, size, then);
            return Ok(());
        }
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
        self.0.busy.load(Ordering::Relaxed) + self.0.helping.load(Ordering::Relaxed)
    }

    fn realms_that_fit(&self) -> usize {
        self.0.start.memory() / NOT_LOADED_YET
    }

    fn sizes(&self) -> (usize, usize) {
        let state = self.0.state.lock();
        (
            state.memory.peak_growth,
            state.all.len() - state.vms().count,
        )
    }

    fn may_need_realm(&self, size: u64) {
        self.0.demand.may_need_realm(size);
    }

    fn needs_realm(&self, size: u64) {
        self.0.demand.needs_realm(size);
    }

    fn report_realm_need(&self, size: u64, needed_realm: bool) {
        self.0.demand.report_realm_need(size, needed_realm);
    }

    fn allow_extra_realm(&self) {
        self.0.demand.allow_extra_realm();
    }

    fn expect_modules(&self, paths: Vec<Vec<u8>>, has_room_for_bytecode: bool) {
        if has_room_for_bytecode {
            crate::read_ahead::make_bytecode();
        }
        crate::read_ahead::expect(paths.iter().map(|it| &it[..]));
    }

    fn expect(&self, files: usize, size: u64, most: usize) {
        self.0.start.expect(&self.0.demand, files, size, most);
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_cgroup_line, parse_limit};

    #[test]
    fn parses_cgroup_lines() {
        let unified = (
            &b"/a/b.scope"[..],
            &b"/sys/fs/cgroup"[..],
            &b"memory.max"[..],
        );
        assert_eq!(parse_cgroup_line(b"0::/a/b.scope"), Some(unified));
        let own = (
            &b"/docker/1"[..],
            &b"/sys/fs/cgroup/memory"[..],
            &b"memory.limit_in_bytes"[..],
        );
        assert_eq!(parse_cgroup_line(b"9:memory:/docker/1"), Some(own));
        assert_eq!(parse_cgroup_line(b"4:cpu,memory:/docker/1"), Some(own));
        assert_eq!(parse_cgroup_line(b"1:name=systemd:/"), None);
        assert_eq!(parse_cgroup_line(b""), None);
    }

    #[test]
    fn parses_limit_file() {
        assert_eq!(parse_limit(b"629145600\n"), Some(629_145_600));
        assert_eq!(parse_limit(b"max\n"), None);
        assert_eq!(parse_limit(b""), None);
    }
}

use core::cell::{Cell, RefCell};
use std::io::Write as _;

use crate::cli::command::TestOptions;
use crate::cli::test_command::CommandLineReporter;
use crate::timer::ElTimespec;
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_core::Output;
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, RegularExpression};

pub use super::bun_test;
use super::expect::{Expect, ExpectTypeOf};
use super::scope_functions::{create_bound, Mode as ScopeKind};
use super::snapshot::Snapshots;
use super::timers::fake_timers;
use bun_test::js_fns::generic_hook;
use bun_test::{BaseScopeCfg, RefDataValue, ScopeMode};

#[derive(Default)]
struct RepeatInfo {
    count: u32,
    index: u32,
}

#[derive(Default)]
pub struct CurrentFile {
    title: Box<[u8]>,
    prefix: Box<[u8]>,
    repeat_info: RepeatInfo,
    has_printed_filename: bool,
}

impl CurrentFile {
    pub(crate) fn set(
        &mut self,
        title: &[u8],
        prefix: &[u8],
        repeat_count: u32,
        repeat_index: u32,
        reporter: &CommandLineReporter,
    ) {
        if reporter.worker_ipc_file_idx.get().is_some() {
            // Coordinator owns the terminal and prints its own per-test file
            // context; the worker should not emit a header to stderr.
            self.has_printed_filename = true;
            return;
        }
        if reporter.reporters.dots || reporter.reporters.only_failures {
            // Assigning into the Box<[u8]> fields below drops the previous values.
            self.title = Box::<[u8]>::from(title);
            self.prefix = Box::<[u8]>::from(prefix);
            self.repeat_info.count = repeat_count;
            self.repeat_info.index = repeat_index;
            self.has_printed_filename = false;
            return;
        }

        self.has_printed_filename = true;
        Self::print(title, prefix, repeat_count, repeat_index);
    }

    fn print(title: &[u8], prefix: &[u8], repeat_count: u32, repeat_index: u32) {
        let _enable_buffering = Output::enable_buffering_scope();

        bun_core::pretty_error!("<r>\n");

        if repeat_count > 0 {
            if repeat_count > 1 {
                bun_core::pretty_errorln!(
                    "{}{}: <d>(run #{})<r>\n",
                    bstr::BStr::new(prefix),
                    bstr::BStr::new(title),
                    repeat_index + 1
                );
            } else {
                bun_core::pretty_errorln!(
                    "{}{}:\n",
                    bstr::BStr::new(prefix),
                    bstr::BStr::new(title)
                );
            }
        } else {
            bun_core::pretty_errorln!("{}{}:\n", bstr::BStr::new(prefix), bstr::BStr::new(title));
        }

        Output::flush();
    }

    pub(crate) fn print_if_needed(&mut self) {
        if self.has_printed_filename {
            return;
        }
        self.has_printed_filename = true;

        Self::print(
            &self.title,
            &self.prefix,
            self.repeat_info.count,
            self.repeat_info.index,
        );
    }
}

/// Per-process `bun test` state. Leaked for the process lifetime by
/// `test_command::exec` (as part of `CommandLineReporter`) and reached from JS
/// host functions through [`Jest::runner`], so it is `&self`-only; everything
/// mutated after registration is a `Cell`/`RefCell`.
pub struct TestRunner<'a> {
    pub(crate) current_file: RefCell<CurrentFile>,
    pub(crate) files: RefCell<FileList>,
    pub(crate) index: RefCell<FileMap>,
    pub(crate) only: Cell<bool>,
    pub(crate) run_todo: bool,
    pub(crate) concurrent: bool,
    /// The --seed value when --randomize is on. Used to derive a per-file
    /// shuffle PRNG from hash(seed, file_path) so within-file test order is
    /// independent of which worker (and which prior files) ran it.
    pub(crate) randomize_seed: Option<u32>,
    /// Borrowed view over `ctx.test_options.concurrent_test_glob` (owned
    /// `Vec<Box<[u8]>>` with process lifetime); see the detach in
    /// `test_command.rs` where this is populated.
    pub(crate) concurrent_test_glob: Option<&'a [&'a [u8]]>,
    pub(crate) bail: u32,
    pub(crate) max_concurrency: u32,

    pub(crate) snapshots: RefCell<Snapshots>,

    pub(crate) default_timeout_ms: u32,

    /// from `setDefaultTimeout() or jest.setTimeout()`. maxInt(u32) means override not set.
    pub(crate) default_timeout_override: Cell<u32>,

    pub(crate) test_options: &'a TestOptions,

    /// Used for --test-name-pattern to reduce allocations. An `opaque_ffi!`
    /// Yarr handle owned by the CLI context for the process lifetime.
    pub(crate) filter_regex: Option<core::ptr::NonNull<RegularExpression>>,

    pub(crate) unhandled_errors_between_tests: Cell<u32>,
    pub(crate) summary: RefCell<Summary>,

    /// Set once any `node:test` registration API is called; gates `process.on('exit')` dispatch at the end of the run.
    pub(crate) node_test_used: Cell<bool>,

    pub(crate) bun_test_root: bun_test::BunTestRoot,
}

impl<'a> TestRunner<'a> {
    /// The registered source path for `file_id`.
    pub(crate) fn file_path(&self, file_id: FileId) -> bun_paths::fs::Path<'static> {
        self.files.borrow().items_source()[file_id as usize].path
    }

    pub(crate) fn get_active_timeout(&self) -> bun_core::Timespec {
        let Some(active_file) = self.bun_test_root.clone_active_file() else {
            return bun_core::Timespec::EPOCH;
        };
        // Per-entry deadline, not the (only-advances-sooner) file timer.
        // `on_stack_entry` pins the caller when still synchronously on stack;
        // else take the latest running entry so a sibling never terminates early.
        if let Some(entry) = active_file.execution.on_stack_entry.get() {
            return active_file.execution.timespec_of(entry);
        }
        if active_file.phase.get() == bun_test::Phase::Execution {
            if let Some(group) = active_file.execution.active_group() {
                let mut latest: Option<bun_core::Timespec> = None;
                for seq in group.sequences(&active_file.execution) {
                    let Some(entry) = seq.active_entry.get() else {
                        continue;
                    };
                    let ts = active_file.execution.timespec_of(entry);
                    if latest.is_none_or(|l| ts.order(&l) == core::cmp::Ordering::Greater) {
                        latest = Some(ts);
                    }
                }
                if let Some(latest) = latest {
                    return latest;
                }
            }
        }
        if active_file.timer_state() != TimerState::ACTIVE
            || active_file.timer_next() == ElTimespec::EPOCH
        {
            return bun_core::Timespec::EPOCH;
        }
        // bun_event_loop carries a local Timespec stub with the
        // same `{sec, nsec}` shape as bun_core::Timespec; convert by field
        // until the lower tier unifies on bun_core::Timespec (see
        // src/runtime/timer/mod.rs ElTimespec alias).
        let next = active_file.timer_next();
        bun_core::Timespec {
            sec: next.sec,
            nsec: next.nsec,
        }
    }

    pub(crate) fn remove_active_timeout(&self, vm: &mut VirtualMachine) {
        let Some(active_file) = self.bun_test_root.clone_active_file() else {
            return;
        };
        if active_file.timer_state() != TimerState::ACTIVE
            || active_file.timer_next() == ElTimespec::EPOCH
        {
            return;
        }
        let _ = vm;
        active_file.remove_timer();
    }

    pub(crate) fn should_file_run_concurrently(&self, file_id: FileId) -> bool {
        // Check if global concurrent flag is set
        if self.concurrent {
            return true;
        }

        // If no glob patterns are set, don't run concurrently
        let Some(glob_patterns) = self.concurrent_test_glob else {
            return false;
        };

        // Get the file path from the file_id
        if file_id as usize >= self.files.borrow().len() {
            return false;
        }
        let file_path = self.file_path(file_id).text;

        // Check if the file path matches any of the glob patterns
        for pattern in glob_patterns {
            if bun_glob::matcher::r#match(pattern, file_path).matches() {
                return true;
            }
        }
        false
    }

    pub(crate) fn get_or_put_file(&self, file_path: &'static [u8]) -> GetOrPutFileResult {
        let mut index = self.index.borrow_mut();
        let entry = index.get_or_put(file_path).expect("unreachable");
        if entry.found_existing {
            return GetOrPutFileResult {
                file_id: *entry.value_ptr,
            };
        }
        let mut files = self.files.borrow_mut();
        let file_id = files.len() as FileId;
        files
            .append(File {
                source: bun_ast::Source::init_empty_file(file_path),
            })
            .expect("unreachable");
        *entry.value_ptr = file_id;
        GetOrPutFileResult { file_id }
    }
}

// Timer state enum referenced via `.ACTIVE` — re-exported from bun_event_loop
// through `crate::timer` (see src/runtime/timer/mod.rs).
use crate::timer::EventLoopTimerState as TimerState;

#[derive(Default, Clone, Copy)]
pub struct Summary {
    pub(crate) pass: u32,
    pub(crate) expectations: u32,
    pub(crate) skip: u32,
    pub(crate) todo: u32,
    pub(crate) fail: u32,
    pub(crate) files: u32,
    pub(crate) skipped_because_label: u32,
}

impl Summary {
    pub(crate) fn did_label_filter_out_all_tests(&self) -> bool {
        self.skipped_because_label > 0
            && (self.pass + self.skip + self.todo + self.fail + self.expectations) == 0
    }
}

pub(crate) struct GetOrPutFileResult {
    pub(crate) file_id: FileId,
}

pub struct File {
    pub source: bun_ast::Source,
}

pub(crate) type FileList = MultiArrayList<File>;
pub(crate) type FileId = u32;

bun_collections::multi_array_columns! {
    pub trait FileColumns for File {
        source: bun_ast::Source,
    }
}
// Keyed by the interned `&'static [u8]` path from `FilenameStore`, so no
// allocation and distinct paths never alias.
pub(crate) type FileMap = ArrayHashMap<&'static [u8], FileId>;

// HOST_EXPORT(Bun__Jest__createTestModuleObject, c)
pub fn create_test_module_object(global_object: &JSGlobalObject) -> JSValue {
    match Jest::create_test_module(global_object) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

#[allow(non_snake_case)]
pub mod Jest {
    use super::*;

    /// The registered runner; bound to the thread that runs `bun test`
    /// (`test_command::exec`), so Workers and other threads see `None`.
    static RUNNER: bun_core::ThreadBound<&'static TestRunner<'static>> =
        bun_core::ThreadBound::new();

    pub(crate) fn runner() -> Option<&'static TestRunner<'static>> {
        RUNNER.get()
    }

    pub(crate) fn set_runner(runner: Option<&'static TestRunner<'static>>) {
        RUNNER.set(runner);
    }

    pub(super) fn create_test_module(global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let module = JSValue::create_empty_object(global_object, 23);

        let test_scope_functions = create_bound(
            global_object,
            ScopeKind::Test,
            JSValue::ZERO,
            BaseScopeCfg::default(),
            "test",
        )?;
        module.put(global_object, b"test", test_scope_functions);
        module.put(global_object, b"it", test_scope_functions);

        let xtest_scope_functions = create_bound(
            global_object,
            ScopeKind::Test,
            JSValue::ZERO,
            BaseScopeCfg { self_mode: ScopeMode::Skip, ..Default::default() },
            "xtest",
        )?;
        module.put(global_object, b"xtest", xtest_scope_functions);
        module.put(global_object, b"xit", xtest_scope_functions);

        let describe_scope_functions = create_bound(
            global_object,
            ScopeKind::Describe,
            JSValue::ZERO,
            BaseScopeCfg::default(),
            "describe",
        )?;
        module.put(global_object, b"describe", describe_scope_functions);

        let xdescribe_scope_functions = create_bound(
            global_object,
            ScopeKind::Describe,
            JSValue::ZERO,
            BaseScopeCfg { self_mode: ScopeMode::Skip, ..Default::default() },
            "xdescribe",
        )?;
        module.put(global_object, b"xdescribe", xdescribe_scope_functions);

        // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw
        // C-ABI `JSHostFn` signature; pass that to JSFunction::create.
        module.put(
            global_object,
            b"beforeEach",
            jsc::JSFunction::create(
                global_object,
                "beforeEach",
                generic_hook::__jsc_host_before_each,
                1,
                Default::default(),
            ),
        );
        module.put(
            global_object,
            b"beforeAll",
            jsc::JSFunction::create(
                global_object,
                "beforeAll",
                generic_hook::__jsc_host_before_all,
                1,
                Default::default(),
            ),
        );
        module.put(
            global_object,
            b"afterAll",
            jsc::JSFunction::create(
                global_object,
                "afterAll",
                generic_hook::__jsc_host_after_all,
                1,
                Default::default(),
            ),
        );
        module.put(
            global_object,
            b"afterEach",
            jsc::JSFunction::create(
                global_object,
                "afterEach",
                generic_hook::__jsc_host_after_each,
                1,
                Default::default(),
            ),
        );
        module.put(
            global_object,
            b"onTestFinished",
            jsc::JSFunction::create(
                global_object,
                "onTestFinished",
                generic_hook::__jsc_host_on_test_finished,
                1,
                Default::default(),
            ),
        );
        module.put(
            global_object,
            b"setDefaultTimeout",
            jsc::JSFunction::create(
                global_object,
                "setDefaultTimeout",
                __jsc_host_js_set_default_timeout,
                1,
                Default::default(),
            ),
        );
        module.put(
            global_object,
            b"expect",
            jsc::codegen::js::get_constructor::<Expect>(global_object),
        );
        module.put(
            global_object,
            b"expectTypeOf",
            jsc::codegen::js::get_constructor::<ExpectTypeOf>(global_object),
        );

        // will add more 9 properties in the module here so we need to allocate 23 properties
        create_mock_objects(global_object, module);

        Ok(module)
    }

    fn create_mock_objects(global_object: &JSGlobalObject, module: JSValue) {
        let set_system_time = jsc::JSFunction::create(
            global_object,
            "setSystemTime",
            JSMock__jsSetSystemTime,
            0,
            Default::default(),
        );
        module.put(global_object, b"setSystemTime", set_system_time);

        let mock_fn =
            jsc::JSFunction::create(global_object, "fn", JSMock__jsMockFn, 1, Default::default());
        let spy_on = jsc::JSFunction::create(
            global_object,
            "spyOn",
            JSMock__jsSpyOn,
            2,
            Default::default(),
        );
        let restore_all_mocks = jsc::JSFunction::create(
            global_object,
            "restoreAllMocks",
            JSMock__jsRestoreAllMocks,
            2,
            Default::default(),
        );
        let clear_all_mocks = jsc::JSFunction::create(
            global_object,
            "clearAllMocks",
            JSMock__jsClearAllMocks,
            2,
            Default::default(),
        );
        let reset_all_mocks = jsc::JSFunction::create(
            global_object,
            "resetAllMocks",
            JSMock__jsResetAllMocks,
            2,
            Default::default(),
        );
        let mock_module_fn = jsc::JSFunction::create(
            global_object,
            "module",
            JSMock__jsModuleMock,
            2,
            Default::default(),
        );
        module.put(global_object, b"mock", mock_fn);
        mock_fn.put(global_object, b"module", mock_module_fn);
        mock_fn.put(global_object, b"restore", restore_all_mocks);
        mock_fn.put(global_object, b"clearAllMocks", clear_all_mocks);

        let jest = JSValue::create_empty_object(global_object, 9 + fake_timers::TIMER_FNS_COUNT);
        jest.put(global_object, b"fn", mock_fn);
        jest.put(global_object, b"mock", mock_module_fn);
        jest.put(global_object, b"spyOn", spy_on);
        jest.put(global_object, b"restoreAllMocks", restore_all_mocks);
        jest.put(global_object, b"clearAllMocks", clear_all_mocks);
        jest.put(global_object, b"resetAllMocks", reset_all_mocks);
        jest.put(global_object, b"setSystemTime", set_system_time);
        jest.put(
            global_object,
            b"now",
            jsc::JSFunction::create(global_object, "now", JSMock__jsNow, 0, Default::default()),
        );
        jest.put(
            global_object,
            b"setTimeout",
            jsc::JSFunction::create(
                global_object,
                "setTimeout",
                __jsc_host_js_set_default_timeout,
                1,
                Default::default(),
            ),
        );

        module.put(global_object, b"jest", jest);
        module.put(global_object, b"spyOn", spy_on);
        module.put(
            global_object,
            b"expect",
            jsc::codegen::js::get_constructor::<Expect>(global_object),
        );

        let vi = JSValue::create_empty_object(global_object, 6 + fake_timers::TIMER_FNS_COUNT);
        vi.put(global_object, b"fn", mock_fn);
        vi.put(global_object, b"mock", mock_module_fn);
        vi.put(global_object, b"spyOn", spy_on);
        vi.put(global_object, b"restoreAllMocks", restore_all_mocks);
        vi.put(global_object, b"resetAllMocks", reset_all_mocks);
        vi.put(global_object, b"clearAllMocks", clear_all_mocks);
        module.put(global_object, b"vi", vi);

        fake_timers::put_timers_fns(global_object, jest, vi);
    }

    unsafe extern "C" {
        pub(crate) safe fn Bun__Jest__testModuleObject(global: &JSGlobalObject) -> JSValue;
    }
    bun_jsc::jsc_abi_extern! {
        pub(crate) fn JSMock__jsMockFn(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsModuleMock(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsNow(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsSetSystemTime(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsRestoreAllMocks(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsClearAllMocks(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsResetAllMocks(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub(crate) fn JSMock__jsSpyOn(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
    }

    #[bun_jsc::host_fn]
    pub(crate) fn call(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let vm = global_object.bun_vm();

        if vm.is_in_preload || runner().is_none() {
            // in preload, no arguments needed
        } else {
            let arguments = callframe.arguments();

            if arguments.len() < 1 || !arguments[0].is_string() {
                return Err(
                    global_object.throw(format_args!("Bun.jest() expects a string filename"))
                );
            }
            let str = arguments[0].to_utf8(global_object)?;
            let slice = str.slice();

            if !bun_paths::is_absolute(slice) {
                return Err(global_object.throw(format_args!(
                    "Bun.jest() expects an absolute file path, got '{}'",
                    bstr::BStr::new(slice)
                )));
            }
        }

        jsc::from_js_host_call(global_object, || Bun__Jest__testModuleObject(global_object))
    }

    #[bun_jsc::host_fn]
    fn js_set_default_timeout(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.len() < 1 || !arguments[0].is_number() {
            return Err(
                global_object.throw(format_args!("setTimeout() expects a number (milliseconds)"))
            );
        }

        let timeout_ms: u32 =
            u32::try_from(arguments[0].coerce::<i32>(global_object)?.max(0)).unwrap();

        if let Some(test_runner) = runner() {
            test_runner.default_timeout_override.set(timeout_ms);
        }

        Ok(JSValue::UNDEFINED)
    }
}

/// Reached only from `node:test`, through `$newRustFunction` rather than the
/// public `bun:test` module object, whenever a node:test API registers something. Returns 0 outside `bun test`.
pub(crate) fn js_file_generation(
    global: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    let generation = Jest::runner().map_or(0, |runner| {
        if global.bun_vm().worker_ref().is_none() {
            runner.node_test_used.set(true);
        }
        runner.bun_test_root.file_generation.get()
    });
    Ok(JSValue::from(generation))
}

/// Reached only from `node:test` (`t.skip()` / `t.todo()` at runtime): overrides
/// the running sequence's result so bun:test reports skip/todo instead of pass.
/// `done`'s bound `DoneCallback.r#ref.phase` names the intended sequence so a
/// late call after the watchdog moved on cannot mark the currently-running one.
pub(crate) fn js_node_test_mark_result(
    _global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    use super::execution::Result as ExecResult;
    let [mode, done] = callframe.arguments_as_array::<2>();
    let Some(buntest_strong) = bun_test::clone_active_strong() else {
        return Ok(JSValue::UNDEFINED);
    };
    let buntest: &bun_test::BunTest = &buntest_strong;
    // `done` is a JSBoundFunction whose bound-this is the DoneCallback wrapper.
    let wrapper = bun_jsc::cpp::Bun__JSBoundFunction__boundThis(done);
    let Some(dcb) = wrapper.as_class_ref::<bun_test::DoneCallback>() else {
        return Ok(JSValue::UNDEFINED);
    };
    let dcb_ref = dcb.r#ref.take();
    let dcb_phase = dcb_ref.as_ref().map(|r| r.phase.clone());
    // A DoneCallback minted by an earlier file / `--rerun-each` iteration names
    // indices into that file's execution, not this one's.
    let stale = dcb_ref
        .as_ref()
        .is_some_and(|r| !r.bun_test().is_some_and(|b| std::rc::Rc::ptr_eq(&b, &buntest_strong)));
    dcb.r#ref.set(dcb_ref);
    if stale {
        return Ok(JSValue::UNDEFINED);
    }
    let bound = match dcb_phase {
        Some(phase) => phase,
        // `r#ref` unset: `.then()` fired inside run_test_callback's microtask
        // drain before it stamps the DoneCallback. `get_current_state_data()`
        // can't name a sequence inside a concurrent group, but
        // `on_stack_entry_data` holds exactly the `cfg_data` that
        // `run_test_callback` was invoked with (set/restored around it), so
        // the mark lands on the right sequence under --concurrent too.
        None if !dcb.called.get() => match buntest.execution.on_stack_entry_data.get() {
            Some(entry_data) => bun_test::RefDataValue::Execution {
                group_index: buntest.execution.group_index.get(),
                entry_data: Some(entry_data),
            },
            None => buntest.get_current_state_data(),
        },
        // done() already ran and reported — nothing left to mark.
        None => return Ok(JSValue::UNDEFINED),
    };
    let Some((sequence, _)) = buntest
        .execution
        .get_current_and_valid_execution_sequence(&bound)
    else {
        return Ok(JSValue::UNDEFINED);
    };
    if sequence.result.get() == ExecResult::Pending {
        sequence.result.set(if mode.to_boolean() {
            ExecResult::Todo
        } else {
            ExecResult::Skip
        });
    }
    Ok(JSValue::UNDEFINED)
}

pub(crate) mod on_unhandled_rejection {
    use super::*;

    pub(crate) fn on_unhandled_rejection(
        jsc_vm: &mut VirtualMachine,
        global_object: &JSGlobalObject,
        rejection: JSValue,
    ) {
        if let Some(buntest_strong) = bun_test::clone_active_strong() {
            let buntest: &bun_test::BunTest = &buntest_strong;
            // mark unhandled errors as belonging to the currently active test. note that this can be misleading.
            let mut current_state_data = buntest.get_current_state_data();
            if let Some(entry) = current_state_data.entry(buntest) {
                if let Some(sequence) = current_state_data.sequence(buntest) {
                    let is_test_entry = sequence
                        .test_entry
                        .is_some_and(|t| std::rc::Rc::ptr_eq(&buntest.execution.entry(t), &entry));
                    if !is_test_entry {
                        // mark errors in hooks as 'unhandled error between tests'
                        current_state_data = RefDataValue::Start;
                    }
                }
            }
            buntest.on_uncaught_exception(
                global_object,
                Some(rejection),
                true,
                &current_state_data,
            );
            buntest.add_result(current_state_data);
            if let Err(e) = buntest.run(global_object) {
                // As `RunTestsTask::run`: what advancing the runner threw is
                // recorded against wherever the runner now is; a termination is
                // left where it is.
                if !global_object.has_pending_termination_exception() {
                    let phase = buntest.get_current_state_data();
                    buntest.on_uncaught_exception(
                        global_object,
                        Some(global_object.take_exception(e)),
                        false,
                        &phase,
                    );
                }
            }
            return;
        }

        VirtualMachine::default_on_unhandled_rejection(jsc_vm, global_object, rejection);
    }
}

fn consume_arg(
    global_this: &JSGlobalObject,
    should_write: bool,
    str_idx: &mut usize,
    args_idx: &mut usize,
    array_list: &mut Vec<u8>,
    arg: JSValue,
    fallback: &[u8],
) -> JsResult<()> {
    if should_write {
        let owned_slice = arg.to_utf8(global_this)?;
        array_list.extend_from_slice(owned_slice.slice());
    } else {
        array_list.extend_from_slice(fallback);
    }
    *str_idx += 1;
    *args_idx += 1;
    Ok(())
}

/// Generate test label by positionally injecting parameters with printf formatting
pub(crate) fn format_label(
    global_this: &JSGlobalObject,
    label: &[u8],
    function_args: &[JSValue],
    test_idx: usize,
) -> JsResult<Box<[u8]>> {
    let mut idx: usize = 0;
    let mut args_idx: usize = 0;
    let mut list: Vec<u8> = Vec::with_capacity(label.len());

    while idx < label.len() {
        let char = label[idx];

        if char == b'$'
            && idx + 1 < label.len()
            && function_args.len() > 0
            && function_args[0].is_object()
        {
            let var_start = idx + 1;
            let mut var_end = var_start;

            if bun_js_parser::js_lexer::is_identifier_start(label[var_end] as i32) {
                var_end += 1;

                while var_end < label.len() {
                    let c = label[var_end];
                    if c == b'.' {
                        if var_end + 1 < label.len()
                            && bun_js_parser::js_lexer::is_identifier_continue(
                                label[var_end + 1] as i32,
                            )
                        {
                            var_end += 1;
                        } else {
                            break;
                        }
                    } else if bun_js_parser::js_lexer::is_identifier_continue(c as i32) {
                        var_end += 1;
                    } else {
                        break;
                    }
                }

                let var_path = &label[var_start..var_end];
                let value = function_args[0].get_if_property_exists_from_path(
                    global_this,
                    bun_string_jsc::create_utf8_for_js(global_this, var_path)?,
                )?;
                if !value.is_empty_or_undefined_or_null() {
                    // For primitive strings, use toString() to avoid adding quotes
                    // This matches Jest's behavior (https://github.com/jestjs/jest/issues/7689)
                    if value.is_string() {
                        let owned_slice = value.to_utf8(global_this)?;
                        list.extend_from_slice(owned_slice.slice());
                    } else {
                        let mut formatter = crate::test_runner::expect::make_formatter(global_this);
                        // formatter cleanup handled by Drop.
                        formatter.format_value::<false>(value, &mut list)?;
                    }
                    idx = var_end;
                    continue;
                }
            } else {
                while var_end < label.len()
                    && (bun_js_parser::js_lexer::is_identifier_continue(label[var_end] as i32)
                        && label[var_end] != b'$')
                {
                    var_end += 1;
                }
            }

            list.push(b'$');
            list.extend_from_slice(&label[var_start..var_end]);
            idx = var_end;
        } else if char == b'%' && (idx + 1 < label.len()) && !(args_idx >= function_args.len()) {
            let current_arg = function_args[args_idx];

            match label[idx + 1] {
                b's' => {
                    consume_arg(
                        global_this,
                        !current_arg.is_empty() && current_arg.js_type().is_string(),
                        &mut idx,
                        &mut args_idx,
                        &mut list,
                        current_arg,
                        b"%s",
                    )?;
                }
                b'i' => {
                    consume_arg(
                        global_this,
                        current_arg.is_any_int(),
                        &mut idx,
                        &mut args_idx,
                        &mut list,
                        current_arg,
                        b"%i",
                    )?;
                }
                b'd' => {
                    consume_arg(
                        global_this,
                        current_arg.is_number(),
                        &mut idx,
                        &mut args_idx,
                        &mut list,
                        current_arg,
                        b"%d",
                    )?;
                }
                b'f' => {
                    consume_arg(
                        global_this,
                        current_arg.is_number(),
                        &mut idx,
                        &mut args_idx,
                        &mut list,
                        current_arg,
                        b"%f",
                    )?;
                }
                b'j' | b'o' => {
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    let str = current_arg.json_stringify_fast(global_this)?;
                    let owned_slice = str.to_owned_slice();
                    list.extend_from_slice(&owned_slice);
                    idx += 1;
                    args_idx += 1;
                }
                b'p' => {
                    let mut formatter = crate::test_runner::expect::make_formatter(global_this);
                    formatter.format_value::<false>(current_arg, &mut list)?;
                    idx += 1;
                    args_idx += 1;
                }
                b'#' => {
                    write!(&mut list, "{}", test_idx).unwrap();
                    idx += 1;
                }
                b'%' => {
                    list.push(b'%');
                    idx += 1;
                }
                _ => {
                    // ignore unrecognized fmt
                }
            }
        } else {
            list.push(char);
        }
        idx += 1;
    }

    Ok(list.into_boxed_slice())
}

pub(crate) fn capture_test_line_number(callframe: &CallFrame, global_this: &JSGlobalObject) -> u32 {
    if let Some(runner) = Jest::runner() {
        if runner.test_options.reporters.junit {
            unsafe extern "C" {
                safe fn Bun__CallFrame__getLineNumber(
                    callframe: &CallFrame,
                    global: &JSGlobalObject,
                ) -> u32;
            }
            return Bun__CallFrame__getLineNumber(callframe, global_this);
        }
    }
    0
}

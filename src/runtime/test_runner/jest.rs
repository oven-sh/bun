use core::ptr::NonNull;
use std::io::Write as _;

use crate::cli::command::TestOptions;
use crate::cli::test_command::CommandLineReporter;
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_core::Output;
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsClass as _, JsResult, RegularExpression,
    StringJsc as _,
};
use crate::timer::ElTimespec;

pub(crate) use super::bun_test;
use super::expect::{Expect, ExpectTypeOf};
use super::scope_functions::{create_bound, Mode as ScopeKind, ScopeFunctions};
use super::snapshot::Snapshots;
use super::timers::fake_timers;
use super::{vi_utils, vi_wait};
use bun_test::js_fns::generic_hook;
use bun_test::{BaseScopeCfg, Flavor, RefDataValue, ScopeMode};

#[derive(Default)]
struct RepeatInfo {
    count: u32,
    index: u32,
}

#[derive(Default)]
pub(crate) struct CurrentFile {
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
        reporter: &mut CommandLineReporter,
    ) {
        if reporter.worker_ipc_file_idx.is_some() {
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
            bun_core::pretty_errorln!(
                "{}{}:\n",
                bstr::BStr::new(prefix),
                bstr::BStr::new(title)
            );
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

pub(crate) struct TestRunner<'a> {
    pub(crate) current_file: CurrentFile,
    pub(crate) files: FileList,
    pub(crate) index: FileMap,
    pub(crate) only: bool,
    pub(crate) run_todo: bool,
    pub(crate) concurrent: bool,
    /// Borrowed view over `ctx.test_options.concurrent_test_glob` (owned
    /// `Vec<Box<[u8]>>` with process lifetime); see the detach in
    /// `test_command.rs` where this is populated.
    pub(crate) concurrent_test_glob: Option<&'a [&'a [u8]]>,
    pub(crate) bail: u32,
    pub(crate) max_concurrency: u32,

    pub(crate) snapshots: Snapshots,

    pub(crate) default_timeout_ms: u32,

    /// from `setDefaultTimeout() or jest.setTimeout()`. maxInt(u32) means override not set.
    pub(crate) default_timeout_override: u32,

    pub(crate) vi_config: vi_utils::Config,
    /// What `vi_config` goes back to at the end of a test file.
    pub(crate) vi_config_of_preload: vi_utils::Config,

    pub(crate) test_options: &'a TestOptions,

    /// Used for --test-name-pattern to reduce allocations.
    /// Raw `*mut` because `RegularExpression::matches` mutates its internal
    /// cursor through C++ — storing `&'a RegularExpression` and casting back to
    /// `*mut` at the use site would launder shared provenance into a write (UB).
    pub(crate) filter_regex: Option<core::ptr::NonNull<RegularExpression>>,

    pub(crate) unhandled_errors_between_tests: u32,
    pub(crate) summary: Summary,

    /// Set once any `node:test` registration API is called; gates `process.on('exit')` dispatch at the end of the run.
    pub(crate) node_test_used: bool,

    pub(crate) bun_test_root: bun_test::BunTestRoot,
}

impl<'a> TestRunner<'a> {
    pub(crate) fn get_active_timeout(&self) -> bun_core::Timespec {
        let Some(active_file) = self.bun_test_root.active_file.as_deref() else {
            return bun_core::Timespec::EPOCH;
        };
        // Per-entry deadline, not the (only-advances-sooner) file timer.
        // `on_stack` pins the caller when still synchronously on stack;
        // else take the latest running entry so a sibling never terminates early.
        if let Some(on_stack) = active_file.execution.on_stack.get() {
            // SAFETY: arena-owned entry, alive for the lifetime of BunTest.
            return unsafe { &*on_stack.entry.cast::<bun_test::ExecutionEntry>() }.timespec;
        }
        if active_file.phase == bun_test::Phase::Execution {
            if let Some(group) = active_file.execution.active_group_ref() {
                let mut latest: Option<bun_core::Timespec> = None;
                for seq in group.sequences_const(&active_file.execution) {
                    let Some(entry) = seq.active_entry else { continue };
                    // SAFETY: arena-owned entry, alive for the lifetime of BunTest.
                    let ts = unsafe { entry.as_ref() }.timespec;
                    if latest.is_none_or(|l| ts.order(&l) == core::cmp::Ordering::Greater) {
                        latest = Some(ts);
                    }
                }
                if let Some(latest) = latest {
                    return latest;
                }
            }
        }
        if active_file.timer.state != TimerState::ACTIVE
            || active_file.timer.next == ElTimespec::EPOCH
        {
            return bun_core::Timespec::EPOCH;
        }
        // bun_event_loop carries a local Timespec stub with the
        // same `{sec, nsec}` shape as bun_core::Timespec; convert by field
        // until the lower tier unifies on bun_core::Timespec (see
        // src/runtime/timer/mod.rs ElTimespec alias).
        bun_core::Timespec { sec: active_file.timer.next.sec, nsec: active_file.timer.next.nsec }
    }

    pub(crate) fn remove_active_timeout(&mut self, vm: &mut VirtualMachine) {
        let Some(active_file) = self.bun_test_root.active_file.as_ref() else {
            return;
        };
        // SAFETY: single-threaded JS VM; only borrow of this BunTest for the
        // duration of the timer-removal below. The const→mut projection is
        // centralized in `buntest_as_mut` pending the BunTestPtr interior-mut
        // reshape (see bun_test.rs).
        let active_file = unsafe { bun_test::buntest_as_mut(active_file) };
        if active_file.timer.state != TimerState::ACTIVE
            || active_file.timer.next == ElTimespec::EPOCH
        {
            return;
        }
        let _ = vm;
        bun_test::vm_timer().remove(&raw mut active_file.timer);
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
        if file_id as usize >= self.files.len() {
            return false;
        }
        let file_path = self.files.items_source()[file_id as usize].path.text();

        // Check if the file path matches any of the glob patterns
        for pattern in glob_patterns {
            if bun_glob::matcher::r#match(pattern, file_path).matches() {
                return true;
            }
        }
        false
    }

    pub(crate) fn get_or_put_file(&mut self, file_path: &'static [u8]) -> GetOrPutFileResult {
        let entry = self.index.get_or_put(file_path).expect("unreachable");
        if entry.found_existing {
            return GetOrPutFileResult {
                file_id: *entry.value_ptr,
            };
        }
        let file_id = self.files.len() as FileId;
        self.files
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
pub(crate) struct Summary {
    pub(crate) pass: u32,
    pub(crate) expectations: u32,
    pub(crate) skip: u32,
    pub(crate) todo: u32,
    pub(crate) fail: u32,
    pub(crate) files: u32,
    pub(crate) skipped_because_label: u32,
    /// Files in which a `describe.shuffle` decided an order, so that the seed is worth printing.
    pub(crate) shuffled: u32,
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

pub(crate) struct File {
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

#[allow(non_snake_case)]
pub(crate) mod Jest {
    use super::*;

    // JS-VM-thread-only singleton; RacyCell
    // over `Option<NonNull<_>>` so direct `.read()` projections in
    // `snapshot.rs` etc. keep their shape.
    pub(crate) static RUNNER: bun_core::RacyCell<Option<NonNull<TestRunner<'static>>>> =
        bun_core::RacyCell::new(None);

    /// `None` outside of `bun test`, and in a Worker: the runner belongs to the thread that runs the test files.
    pub(crate) fn runner() -> Option<&'static mut TestRunner<'static>> {
        // SAFETY: `runner_ptr` hands it to one thread only.
        runner_ptr().map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// Raw-pointer accessor for callers that must not materialise
    /// an exclusive `&mut TestRunner` because a sub-borrow of it (e.g.
    /// `&BunTestRoot`, `&mut BunTest`) is already live — see
    /// `BunTestRoot::on_before_print` / `BunTest::enter_file`.
    pub(crate) fn runner_ptr() -> Option<NonNull<TestRunner<'static>>> {
        // SAFETY: a thread's VM outlives the script that runs on it.
        if VirtualMachine::get_or_null().is_some_and(|vm| unsafe { (*vm).worker_ref().is_some() }) {
            return None;
        }
        // SAFETY: written and read on the thread that runs the test files only.
        unsafe { RUNNER.read() }
    }

    /// `RuntimeFeatures::own_test_globals`, before a test file is loaded.
    pub(crate) fn own_globals(global: &JSGlobalObject) -> JsResult<u32> {
        let mut found = 0;
        for (index, &name) in bun_js_parser::Jest::GLOBALS.iter().enumerate() {
            let name = bun_core::String::static_(name).to_js(global)?;
            if global.to_js_value().has_own_property_value(global, name)? {
                found |= 1 << index;
            }
        }
        Ok(found)
    }

    /// `BunTestRoot::file_generation`. 0 outside of `bun test`, and in a worker thread: the runner belongs to the main thread.
    pub(crate) fn file_generation(global: &JSGlobalObject) -> u32 {
        if global.bun_vm().worker_ref().is_some() {
            return 0;
        }
        // SAFETY: the runner outlives every test file and is only touched on this thread.
        runner_ptr().map_or(0, |runner| unsafe { (*runner.as_ptr()).bun_test_root.file_generation })
    }

    #[unsafe(no_mangle)]
    extern "C" fn Bun__Jest__createTestModuleObject(
        global_object: &JSGlobalObject,
    ) -> JSValue {
        match create_test_module(global_object, Flavor::Jest) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }

    #[unsafe(no_mangle)]
    extern "C" fn Bun__Jest__createVitestModuleObject(
        global_object: &JSGlobalObject,
    ) -> JSValue {
        match create_test_module(global_object, Flavor::Vitest) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }

    fn create_test_module(global_object: &JSGlobalObject, flavor: Flavor) -> JsResult<JSValue> {
        let module = JSValue::create_empty_object(global_object, 32);

        // What does not differ is what "bun:test" exports, by identity.
        if flavor == Flavor::Vitest {
            let shared = jsc::from_js_host_call(global_object, || Bun__Jest__testModuleObject(global_object))?;
            let exports = jsc::JSPropertyIterator::init(
                global_object,
                shared.to_object(global_object)?,
                jsc::JSPropertyIteratorOptions::new(false, true),
            )?;
            while let Some((name, value)) = exports.next()? {
                module.put(global_object, &*name, value);
            }
        }

        let scope_functions = |kind: ScopeKind, self_mode: ScopeMode, name: &'static str| {
            let cfg = BaseScopeCfg { flavor, self_mode, ..Default::default() };
            create_bound(global_object, ScopeFunctions::new(kind, cfg), name)
        };

        let test_scope_functions = scope_functions(ScopeKind::Test, ScopeMode::Normal, "test")?;
        module.put(global_object, b"test", test_scope_functions);
        module.put(global_object, b"it", test_scope_functions);

        let xtest_scope_functions = scope_functions(ScopeKind::Test, ScopeMode::Skip, "xtest")?;
        module.put(global_object, b"xtest", xtest_scope_functions);
        module.put(global_object, b"xit", xtest_scope_functions);

        let describe_scope_functions = scope_functions(ScopeKind::Describe, ScopeMode::Normal, "describe")?;
        module.put(global_object, b"describe", describe_scope_functions);

        let xdescribe_scope_functions = scope_functions(ScopeKind::Describe, ScopeMode::Skip, "xdescribe")?;
        module.put(global_object, b"xdescribe", xdescribe_scope_functions);

        // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw
        // C-ABI `JSHostFn` signature; pass that to JSFunction::create.
        let hooks: [(&'static str, jsc::JSHostFn); 5] = match flavor {
            Flavor::Jest => [
                ("beforeEach", generic_hook::__jsc_host_before_each),
                ("beforeAll", generic_hook::__jsc_host_before_all),
                ("afterAll", generic_hook::__jsc_host_after_all),
                ("afterEach", generic_hook::__jsc_host_after_each),
                ("onTestFinished", generic_hook::__jsc_host_on_test_finished),
            ],
            Flavor::Vitest => [
                ("beforeEach", generic_hook::__jsc_host_vitest_before_each),
                ("beforeAll", generic_hook::__jsc_host_vitest_before_all),
                ("afterAll", generic_hook::__jsc_host_vitest_after_all),
                ("afterEach", generic_hook::__jsc_host_vitest_after_each),
                ("onTestFinished", generic_hook::__jsc_host_vitest_on_test_finished),
            ],
        };
        for (name, hook) in hooks {
            module.put(global_object, name, jsc::JSFunction::create(global_object, name, hook, 1, Default::default()));
        }

        match flavor {
            Flavor::Jest => {
                module.put(
                    global_object,
                    b"setDefaultTimeout",
                    jsc::JSFunction::create(global_object, "setDefaultTimeout", __jsc_host_js_set_default_timeout, 1, Default::default()),
                );
                module.put(global_object, b"expect", jsc::codegen::js::get_constructor::<Expect>(global_object));
                module.put(global_object, b"expectTypeOf", jsc::codegen::js::get_constructor::<ExpectTypeOf>(global_object));
                create_mock_objects(global_object, module);
            }
            Flavor::Vitest => {
                module.put(
                    global_object,
                    b"onTestFailed",
                    jsc::JSFunction::create(global_object, "onTestFailed", generic_hook::__jsc_host_vitest_on_test_failed, 1, Default::default()),
                );
                module.put(global_object, b"suite", describe_scope_functions);
                if let Some(vi) = module.get(global_object, "vi")? {
                    module.put(global_object, b"vitest", vi);
                }
                module.put(
                    global_object,
                    b"assertType",
                    jsc::JSFunction::create(global_object, "assertType", __jsc_host_js_assert_type, 1, Default::default()),
                );
            }
        }

        Ok(module)
    }

    /// Checked by the type checker only.
    #[bun_jsc::host_fn]
    fn js_assert_type(_global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    fn create_mock_objects(global_object: &JSGlobalObject, module: JSValue) {
        let set_system_time = jsc::JSFunction::create(global_object, "setSystemTime", JSMock__jsSetSystemTime, 0, Default::default());
        module.put(global_object, b"setSystemTime", set_system_time);

        let mock_fn = jsc::JSFunction::create(global_object, "fn", JSMock__jsMockFn, 1, Default::default());
        let spy_on = jsc::JSFunction::create(global_object, "spyOn", JSMock__jsSpyOn, 2, Default::default());
        let restore_all_mocks = jsc::JSFunction::create(global_object, "restoreAllMocks", JSMock__jsRestoreAllMocks, 2, Default::default());
        let clear_all_mocks = jsc::JSFunction::create(global_object, "clearAllMocks", JSMock__jsClearAllMocks, 2, Default::default());
        let reset_all_mocks = jsc::JSFunction::create(global_object, "resetAllMocks", JSMock__jsResetAllMocks, 2, Default::default());
        let mock_module_fn = jsc::JSFunction::create(global_object, "module", JSMock__jsModuleMock, 2, Default::default());
        module.put(global_object, b"mock", mock_fn);
        mock_fn.put(global_object, b"module", mock_module_fn);
        mock_fn.put(global_object, b"restore", restore_all_mocks);
        mock_fn.put(global_object, b"clearAllMocks", clear_all_mocks);

        let jest = JSValue::create_empty_object(global_object, 64);
        jest.put(global_object, b"fn", mock_fn);
        jest.put(global_object, b"mock", mock_module_fn);
        jest.put(global_object, b"spyOn", spy_on);
        jest.put(global_object, b"restoreAllMocks", restore_all_mocks);
        jest.put(global_object, b"clearAllMocks", clear_all_mocks);
        jest.put(global_object, b"resetAllMocks", reset_all_mocks);
        jest.put(global_object, b"setSystemTime", set_system_time);
        jest.put(global_object, b"now", jsc::JSFunction::create(global_object, "now", JSMock__jsNow, 0, Default::default()));
        jest.put(global_object, b"setTimeout", jsc::JSFunction::create(global_object, "setTimeout", __jsc_host_js_set_default_timeout, 1, Default::default()));

        module.put(global_object, b"jest", jest);
        module.put(global_object, b"spyOn", spy_on);
        module.put(global_object, b"expect", jsc::codegen::js::get_constructor::<Expect>(global_object));

        let vi = JSValue::create_empty_object(global_object, 64);
        vi.put(global_object, b"fn", mock_fn);
        vi.put(global_object, b"mock", mock_module_fn);
        vi.put(global_object, b"spyOn", spy_on);
        vi.put(global_object, b"restoreAllMocks", restore_all_mocks);
        vi.put(global_object, b"resetAllMocks", reset_all_mocks);
        vi.put(global_object, b"clearAllMocks", clear_all_mocks);
        vi.put(global_object, b"setSystemTime", set_system_time);
        module.put(global_object, b"vi", vi);

        fake_timers::put_timers_fns(global_object, jest, vi);
        vi_utils::put_fns(global_object, jest, vi);
        vi_wait::put_fns(global_object, jest, vi);
        JSMock__putModuleMockFunctions(global_object, mock_fn, jest, vi);
        JSMock__putMockFunctionUtilities(global_object, mock_fn, jest, vi);
    }

    unsafe extern "C" {
        pub(crate) safe fn Bun__Jest__testModuleObject(global: &JSGlobalObject) -> JSValue;
        safe fn JSMock__putModuleMockFunctions(global: &JSGlobalObject, mock_fn: JSValue, jest: JSValue, vi: JSValue);
        safe fn JSMock__putMockFunctionUtilities(global: &JSGlobalObject, mock_fn: JSValue, jest: JSValue, vi: JSValue);
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
                return Err(global_object.throw(format_args!("Bun.jest() expects a string filename")));
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
            return Err(global_object.throw(format_args!("setTimeout() expects a number (milliseconds)")));
        }

        let timeout_ms: u32 =
            u32::try_from(arguments[0].coerce::<i32>(global_object)?.max(0)).unwrap();

        if let Some(test_runner) = runner() {
            test_runner.default_timeout_override = timeout_ms;
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
    // `runner_ptr()` rather than `runner()`: node:test calls this on every test
    // registration, and an exclusive `&mut TestRunner` would invalidate the
    // `bun_test_root` pointer `test_command.rs` keeps live across the file run.
    // SAFETY: same invariant as `runner()` — RUNNER is only read on the JS thread.
    let generation = Jest::runner_ptr().map_or(0, |p| unsafe {
        if global.bun_vm().worker_ref().is_none() {
            (*p.as_ptr()).node_test_used = true;
        }
        (*p.as_ptr()).bun_test_root.file_generation
    });
    Ok(JSValue::from(generation))
}

/// Reached only from `node:test` (`t.skip()` / `t.todo()` at runtime): overrides
/// the running sequence's result so bun:test reports skip/todo instead of pass.
/// `done`'s bound `DoneCallback.entry` names the intended sequence so a
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
    // SAFETY: single-threaded JS VM; the strong is dropped before any re-borrow.
    let buntest = unsafe { bun_test::buntest_as_mut(&buntest_strong) };
    // `done` is a JSBoundFunction whose bound-this is the DoneCallback wrapper.
    let wrapper = bun_jsc::cpp::Bun__JSBoundFunction__boundThis(done);
    let Some(dcb) = bun_test::DoneCallback::from_js(wrapper) else {
        return Ok(JSValue::UNDEFINED);
    };
    // SAFETY: `dcb` is the live `*mut DoneCallback` from `from_js`; single-
    // threaded JS VM, GC roots `done` (and its bound-this) for this frame.
    let (bound, dcb_called) = unsafe { ((*dcb).entry, (*dcb).called) };
    if dcb_called {
        // done() already ran and reported — nothing left to mark.
        return Ok(JSValue::UNDEFINED);
    }
    let Some((sequence_ptr, _)) =
        buntest.execution.get_current_and_valid_execution_sequence(&bound)
    else {
        return Ok(JSValue::UNDEFINED);
    };
    // SAFETY: NonNull into `execution.sequences`; deref at point-of-use only.
    let sequence = unsafe { &mut *sequence_ptr.as_ptr() };
    if sequence.result == ExecResult::Pending {
        sequence.result = if mode.to_boolean() { ExecResult::Todo } else { ExecResult::Skip };
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
            // `buntest_strong` released by Rc drop.
            // SAFETY: single-threaded JS VM; `buntest_strong` is the only handle
            // dereferenced for this scope. Const→mut projection is centralized in `buntest_as_mut`
            // pending the BunTestPtr interior-mut reshape (see bun_test.rs).
            let buntest = unsafe { bun_test::buntest_as_mut(&buntest_strong) };
            if buntest.unclaimed.is_ended_error(rejection) {
                return;
            }
            // mark unhandled errors as belonging to the currently active test. note that this can be misleading.
            let mut current_state_data = buntest.get_current_state_data();
            // split entry()/sequence() borrows via raw-ptr capture (per-use reborrow).
            let entry_ptr: Option<*mut bun_test::ExecutionEntry> = current_state_data
                .entry(buntest)
                .map(std::ptr::from_mut::<bun_test::ExecutionEntry>);
            if let Some(entry) = entry_ptr {
                // SAFETY: an entry of the file that is running.
                let mode = unsafe { (*entry).base.mode };
                if let Some(sequence) = current_state_data.sequence(buntest) {
                    if sequence.test_entry.map(|p| p.as_ptr()) != Some(entry)
                        // The failure it expects is one of its own function, not whatever goes wrong meanwhile.
                        || matches!(mode, ScopeMode::Failing | ScopeMode::Fails)
                    {
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
            // Script that reported the error may be on the stack: the next test does not start beneath it.
            bun_test::BunTest::run_next_tick(
                &std::rc::Rc::downgrade(&buntest_strong),
                global_object,
                current_state_data,
            );
            return;
        }

        // SAFETY: `on_unhandled_rejection_exception_list` is either None or a
        // live `NonNull<ExceptionList>` owned by the VM; reborrow as `&mut`
        // for the duration of `run_error_handler` (single-threaded JS thread).
        let exception_list = jsc_vm
            .on_unhandled_rejection_exception_list
            .map(|p| unsafe { &mut *p.as_ptr() });
        jsc_vm.run_error_handler(rejection, exception_list);
    }
}

fn write_to_string(global: &JSGlobalObject, value: JSValue, title: &mut Vec<u8>) -> JsResult<()> {
    title.extend_from_slice(value.to_utf8(global)?.slice());
    Ok(())
}

fn write_inspected(global: &JSGlobalObject, value: JSValue, title: &mut Vec<u8>) -> JsResult<()> {
    if value.is_any_error() {
        title.push(b'[');
        write_to_string(global, value, title)?;
        title.push(b']');
        return Ok(());
    }
    let mut formatter = crate::test_runner::expect::make_formatter(global);
    formatter.single_line = true;
    formatter.format_value::<false>(value, title)
}

/// vitest's `truncateString(value, taskTitleValueFormatTruncate)`
fn write_truncated(global: &JSGlobalObject, value: JSValue, title: &mut Vec<u8>) -> JsResult<()> {
    const MAX_UTF16_LENGTH: usize = 40;
    let string = value.to_bun_string(global)?;
    if string.length() <= MAX_UTF16_LENGTH {
        title.extend_from_slice(string.to_utf8().slice());
        return Ok(());
    }
    let is_high_surrogate = (0xD800..=0xDBFF).contains(&string.char_at(MAX_UTF16_LENGTH - 2));
    let end = MAX_UTF16_LENGTH - 1 - usize::from(is_high_surrogate);
    title.extend_from_slice(string.substring_with_len(0, end).to_utf8().slice());
    title.extend_from_slice("…".as_bytes());
    Ok(())
}

/// Node's `hasBuiltInToString`: `util.format("%s")` inspects such an object instead of calling its `toString`.
/// vitest only inspects for `Object.prototype.toString`.
fn has_builtin_to_string(global: &JSGlobalObject, object: JSValue, is_vitest: bool) -> JsResult<bool> {
    const BUILTINS: [&[u8]; 9] = [
        b"Object", b"Array", b"Date", b"RegExp", b"Boolean", b"Number", b"String", b"Symbol", b"BigInt",
    ];
    // What a trap of a Proxy answers need not lead anywhere.
    const MAX_PROTOTYPES: usize = 1000;
    // As in Node, it is the target of a Proxy that counts.
    let object = match object.get_proxy_target() {
        target if target.is_empty() => object,
        target => target,
    };
    let mut owner = object;
    let mut prototypes = 0;
    loop {
        if !owner.is_object() || prototypes > MAX_PROTOTYPES {
            return Ok(true);
        }
        if let Some(to_string) = owner.get_own(global, &bun_core::String::static_("toString"))? {
            if !to_string.is_callable() {
                return Ok(true);
            }
            break;
        }
        owner = owner.get_prototype(global)?;
        prototypes += 1;
    }
    if owner == object {
        return Ok(false);
    }
    let Some(constructor) = owner.get_own(global, &bun_core::String::static_("constructor"))? else {
        return Ok(false);
    };
    let name = constructor.get_name(global)?;
    let builtins = if is_vitest { &BUILTINS[..1] } else { &BUILTINS[..] };
    Ok(builtins.iter().any(|builtin| name.eq_ascii(builtin)))
}

fn write_json(global: &JSGlobalObject, value: JSValue, title: &mut Vec<u8>) -> JsResult<()> {
    let thrown = match value.json_stringify_fast(global) {
        Ok(json) if json.is_empty() => {
            title.extend_from_slice(b"undefined");
            return Ok(());
        }
        Ok(json) => {
            title.extend_from_slice(json.to_utf8().slice());
            return Ok(());
        }
        Err(jsc::JsError::Thrown) => global.take_exception(jsc::JsError::Thrown),
        Err(err) => return Err(err),
    };
    if let Some(error) = thrown.to_error()
        && let Some(message) = error.get(global, "message")?
    {
        let message = message.to_bun_string(global)?;
        if message.eq_ascii(b"JSON.stringify cannot serialize cyclic structures.") {
            title.extend_from_slice(b"[Circular]");
            return Ok(());
        }
        if message.eq_ascii(b"JSON.stringify cannot serialize BigInt.") {
            return write_inspected(global, value, title);
        }
    }
    Err(global.throw_value(thrown))
}

fn trim_start_js_whitespace(text: &[u8]) -> &[u8] {
    let end = bun_core::lexer::end_of_run(text, 0, |c| {
        bun_core::lexer::is_whitespace(c) || matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029)
    });
    &text[end..]
}

fn split_sign(text: &[u8]) -> (f64, &[u8]) {
    match text.split_first() {
        Some((b'-', rest)) => (-1.0, rest),
        Some((b'+', rest)) => (1.0, rest),
        _ => (1.0, text),
    }
}

/// `parseInt(text)`
fn parse_int(text: &[u8]) -> f64 {
    let (sign, text) = split_sign(trim_start_js_whitespace(text));
    if let Some(hex) = text.strip_prefix(b"0x").or_else(|| text.strip_prefix(b"0X")) {
        let digits = hex.iter().map_while(|&c| bun_core::fmt::hex_digit_value(c)).map(f64::from);
        return sign * digits.reduce(|value, digit| value * 16.0 + digit).unwrap_or(f64::NAN);
    }
    let len = text.iter().take_while(|c| c.is_ascii_digit()).count();
    sign * bun_core::fmt::parse_double(&text[..len]).unwrap_or(f64::NAN)
}

/// `parseFloat(text)`
fn parse_float(text: &[u8]) -> f64 {
    let text = trim_start_js_whitespace(text);
    bun_core::fmt::parse_double(text).unwrap_or_else(|_| {
        let (sign, text) = split_sign(text);
        if text.starts_with(b"Infinity") { sign * f64::INFINITY } else { f64::NAN }
    })
}

/// What Jest prints for `%<specifier>`: `util.format`, and pretty-format for `%p`.
fn write_placeholder(
    global: &JSGlobalObject,
    specifier: u8,
    value: JSValue,
    title: &mut Vec<u8>,
    is_vitest: bool,
) -> JsResult<()> {
    let number = match specifier {
        b's' if value.is_string()
            || value.is_function()
            || value.is_any_error()
            || (value.is_object() && !has_builtin_to_string(global, value, is_vitest)?) =>
        {
            return write_to_string(global, value, title);
        }
        b'j' => return write_json(global, value, title),
        b'c' => return Ok(()),
        b'd' | b'i' if value.is_big_int() => return write_inspected(global, value, title),
        b'd' | b'i' | b'f' if value.is_symbol() => f64::NAN,
        b'd' => value.to_number(global)?,
        b'i' => parse_int(value.to_utf8(global)?.slice()),
        b'f' => parse_float(value.to_utf8(global)?.slice()),
        _ => return write_inspected(global, value, title),
    };
    write_inspected(global, JSValue::js_number(number), title)
}

/// Length of the `a.b.c`, or of the array index, at the start of `text`.
fn property_path_len(text: &[u8]) -> usize {
    use bun_js_parser::js_lexer::{is_identifier_continue, is_identifier_start};
    if !is_identifier_start(bun_core::lexer::char_and_size(text, 0).0) {
        let digits = text.iter().take_while(|c| c.is_ascii_digit()).count();
        let is_all = bun_core::lexer::end_of_run(text, digits, is_identifier_continue) == digits;
        return if is_all { digits } else { 0 };
    }
    let mut end = bun_core::lexer::end_of_run(text, 0, is_identifier_continue);
    while text.get(end) == Some(&b'.') {
        let next = bun_core::lexer::end_of_run(text, end + 1, is_identifier_continue);
        if next == end + 1 {
            break;
        }
        end = next;
    }
    end
}

/// `None` when `path` is empty or one of its steps does not exist.
fn get_property_path(global: &JSGlobalObject, object: JSValue, path: &[u8]) -> JsResult<Option<JSValue>> {
    let mut value = object;
    for key in bun_core::strings::split(path, b".") {
        if key.is_empty() || value.is_undefined_or_null() {
            return Ok(None);
        }
        value = value.get_if_property_exists_from_path(global, bun_string_jsc::create_utf8_for_js(global, key)?)?;
        if value.is_empty() {
            return Ok(None);
        }
    }
    Ok(Some(value))
}

/// The title of one `.each()` row: `%` placeholders take `function_args` in order, `$a.b` reads the first one.
pub(crate) fn format_label(
    global_this: &JSGlobalObject,
    label: &[u8],
    function_args: &[JSValue],
    test_idx: usize,
    is_vitest: bool,
) -> JsResult<Box<[u8]>> {
    let object_row = function_args.first().copied().filter(|row| row.is_object());
    let mut args = function_args.iter();
    let mut title: Vec<u8> = Vec::with_capacity(label.len());
    let mut rest = label;

    while let Some((&char, after)) = rest.split_first() {
        rest = after;
        match (char, after.first().copied(), object_row) {
            (b'%', Some(b'%'), _) => title.push(b'%'),
            (b'%', Some(b'#'), _) | (b'$', Some(b'#'), Some(_)) => write!(&mut title, "{}", test_idx).unwrap(),
            (b'%', Some(b'$'), _) => write!(&mut title, "{}", test_idx + 1).unwrap(),
            (b'%', Some(specifier @ (b's' | b'd' | b'i' | b'f' | b'j' | b'o' | b'O' | b'p' | b'c')), _)
                if !(is_vitest && specifier == b'p') =>
            {
                let Some(&arg) = args.next().or_else(|| is_vitest.then_some(&JSValue::UNDEFINED)) else {
                    title.push(b'%');
                    continue;
                };
                write_placeholder(global_this, specifier, arg, &mut title, is_vitest)?;
            }
            (b'$', Some(_), Some(row)) => {
                let (path, after_path) = after.split_at(property_path_len(after));
                rest = after_path;
                match get_property_path(global_this, row, path)? {
                    Some(value) if value.is_string() && is_vitest => write_truncated(global_this, value, &mut title)?,
                    // https://github.com/jestjs/jest/issues/7689
                    Some(value) if value.is_string() => write_to_string(global_this, value, &mut title)?,
                    Some(value) => write_inspected(global_this, value, &mut title)?,
                    None if is_vitest => title.extend_from_slice(b"undefined"),
                    None => {
                        title.push(b'$');
                        title.extend_from_slice(path);
                    }
                }
                continue;
            }
            _ => {
                title.push(char);
                continue;
            }
        }
        rest = &after[1..];
    }

    Ok(title.into_boxed_slice())
}

pub(crate) fn capture_test_line_number(callframe: &CallFrame, global_this: &JSGlobalObject) -> u32 {
    if let Some(runner) = Jest::runner() {
        if runner.test_options.reporters.junit {
            unsafe extern "C" {
                fn Bun__CallFrame__getLineNumber(
                    callframe: *const CallFrame,
                    global: *const JSGlobalObject,
                ) -> u32;
            }
            // SAFETY: callframe and global_this are valid live references.
            return unsafe { Bun__CallFrame__getLineNumber(callframe, global_this) };
        }
    }
    0
}

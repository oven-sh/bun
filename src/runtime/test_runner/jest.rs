use core::ptr::NonNull;
#[allow(unused_imports)] use crate::test_runner::expect::{JSValueTestExt, JSGlobalObjectTestExt, make_formatter};
use std::io::Write as _;

use crate::cli::command::TestOptions;
use crate::cli::test_command::CommandLineReporter;
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_core::Output;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, RegularExpression,
};
#[allow(unused_imports)]
use bun_jsc::StringJsc as _;
use crate::timer::ElTimespec;
use bun_core::strings;

pub use super::bun_test;
use super::expect::{Expect, ExpectTypeOf};
use super::scope_functions::{self, create_bound, strings as scope_strings, Mode as ScopeKind};
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
    pub fn set(
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
            // PORT NOTE: Zig's freeAndClear() freed the old allocations; in Rust,
            // assigning into the Box<[u8]> fields below drops the previous values.
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
                Output::pretty_errorln(format_args!(
                    "{}{}: <d>(run #{})<r>\n",
                    bstr::BStr::new(prefix),
                    bstr::BStr::new(title),
                    repeat_index + 1
                ));
            } else {
                Output::pretty_errorln(format_args!(
                    "{}{}:\n",
                    bstr::BStr::new(prefix),
                    bstr::BStr::new(title)
                ));
            }
        } else {
            Output::pretty_errorln(format_args!(
                "{}{}:\n",
                bstr::BStr::new(prefix),
                bstr::BStr::new(title)
            ));
        }

        Output::flush();
    }

    pub fn print_if_needed(&mut self) {
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

pub struct TestRunner<'a> {
    pub current_file: CurrentFile,
    pub files: FileList,
    pub index: FileMap,
    pub only: bool,
    pub run_todo: bool,
    pub concurrent: bool,
    // TODO(port): std.Random has no direct Rust equivalent; using xoshiro256++ handle.
    pub randomize: Option<bun_core::rand::DefaultPrng>,
    /// The --seed value when --randomize is on. Used to derive a per-file
    /// shuffle PRNG from hash(seed, file_path) so within-file test order is
    /// independent of which worker (and which prior files) ran it.
    pub randomize_seed: Option<u32>,
    // TODO(port): lifetime — likely borrowed from test_options
    pub concurrent_test_glob: Option<&'a [&'a [u8]]>,
    pub last_file: u64,
    pub bail: u32,
    pub max_concurrency: u32,

    // PORT NOTE: `std.mem.Allocator param` field deleted — global mimalloc.
    // TODO(port): `drainer` had `= undefined` default in Zig
    pub drainer: jsc::AnyTask::AnyTask,

    pub has_pending_tests: bool,

    pub snapshots: Snapshots<'a>,

    pub default_timeout_ms: u32,

    /// from `setDefaultTimeout() or jest.setTimeout()`. maxInt(u32) means override not set.
    pub default_timeout_override: u32,

    pub test_options: &'a TestOptions,

    /// Used for --test-name-pattern to reduce allocations.
    /// Raw `*mut` because `RegularExpression::matches` mutates its internal
    /// cursor through C++ — storing `&'a RegularExpression` and casting back to
    /// `*mut` at the use site would launder shared provenance into a write (UB).
    pub filter_regex: Option<core::ptr::NonNull<RegularExpression>>,

    pub unhandled_errors_between_tests: u32,
    pub summary: Summary,

    pub bun_test_root: bun_test::BunTestRoot,
}

impl<'a> TestRunner<'a> {
    pub fn get_active_timeout(&self) -> bun_core::Timespec {
        let Some(active_file) = self.bun_test_root.active_file.as_deref() else {
            return bun_core::Timespec::EPOCH;
        };
        if active_file.timer.state != TimerState::ACTIVE
            || active_file.timer.next == ElTimespec::EPOCH
        {
            return bun_core::Timespec::EPOCH;
        }
        // PORT NOTE: bun_event_loop carries a local Timespec stub with the
        // same `{sec, nsec}` shape as bun_core::Timespec; convert by field
        // until the lower tier unifies on bun_core::Timespec (see
        // src/runtime/timer/mod.rs ElTimespec alias).
        bun_core::Timespec { sec: active_file.timer.next.sec, nsec: active_file.timer.next.nsec }
    }

    pub fn remove_active_timeout(&mut self, vm: &mut VirtualMachine) {
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

    pub fn has_test_filter(&self) -> bool {
        self.filter_regex.is_some()
    }

    pub fn should_file_run_concurrently(&self, file_id: FileId) -> bool {
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
        // TODO(port): MultiArrayList column accessor name (`items(.source)` in Zig)

        // Check if the file path matches any of the glob patterns
        for pattern in glob_patterns {
            let result = bun_glob::matcher::r#match(pattern, file_path);
            if result == bun_glob::matcher::MatchResult::Match {
                return true;
            }
        }
        false
    }

    pub fn get_or_put_file(&mut self, file_path: &'static [u8]) -> GetOrPutFileResult {
        // TODO: this is wrong. you can't put a hash as the key in a hashmap.
        let entry = self
            .index
            .get_or_put(bun_wyhash::hash(file_path) as u32)
            .expect("unreachable");
        if entry.found_existing {
            return GetOrPutFileResult {
                file_id: *entry.value_ptr,
            };
        }
        let file_id = self.files.len() as FileId;
        self.files
            .append(File {
                source: bun_ast::Source::init_empty_file(file_path),
                ..Default::default()
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
    pub pass: u32,
    pub expectations: u32,
    pub skip: u32,
    pub todo: u32,
    pub fail: u32,
    pub files: u32,
    pub skipped_because_label: u32,
}

impl Summary {
    pub fn did_label_filter_out_all_tests(&self) -> bool {
        self.skipped_because_label > 0
            && (self.pass + self.skip + self.todo + self.fail + self.expectations) == 0
    }
}

pub struct GetOrPutFileResult {
    pub file_id: FileId,
}

pub struct File {
    pub source: bun_ast::Source,
    pub log: bun_ast::Log,
}

impl Default for File {
    fn default() -> Self {
        Self {
            source: bun_ast::Source::init_empty_file(b""),
            log: bun_ast::Log::init_comptime(),
        }
    }
}

pub type FileList = MultiArrayList<File>;
pub type FileId = u32;

bun_collections::multi_array_columns! {
    pub trait FileColumns for File {
        source: bun_ast::Source,
        log: bun_ast::Log,
    }
}
// PORT NOTE: Zig used ArrayIdentityContext; u32 keys hash as identity in bun_collections.
pub type FileMap = ArrayHashMap<u32, u32>;

#[allow(non_snake_case)]
pub mod Jest {
    use super::*;

    // Zig `pub var runner: ?*TestRunner = null`.
    // PORTING.md §Global mutable state: JS-VM-thread-only singleton; RacyCell
    // over `Option<NonNull<_>>` so direct `.read()` projections in
    // `snapshot.rs` etc. keep their shape.
    pub static RUNNER: bun_core::RacyCell<Option<NonNull<TestRunner<'static>>>> =
        bun_core::RacyCell::new(None);

    pub fn runner() -> Option<&'static mut TestRunner<'static>> {
        // SAFETY: single-threaded JS VM; matches Zig's unguarded global access.
        unsafe { RUNNER.read().map(|p| &mut *p.as_ptr()) }
    }

    /// Raw-pointer accessor for callers that must not materialise
    /// an exclusive `&mut TestRunner` because a sub-borrow of it (e.g.
    /// `&BunTestRoot`, `&mut BunTest`) is already live — see
    /// `BunTestRoot::on_before_print` / `BunTest::enter_file`.
    pub fn runner_ptr() -> Option<NonNull<TestRunner<'static>>> {
        // SAFETY: single-threaded JS VM; matches Zig's unguarded global access.
        unsafe { RUNNER.read() }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__Jest__createTestModuleObject(
        global_object: &JSGlobalObject,
    ) -> JSValue {
        match create_test_module(global_object) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }

    pub fn create_test_module(global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let module = JSValue::create_empty_object(global_object, 23);

        let test_scope_functions = create_bound(
            global_object,
            ScopeKind::Test,
            JSValue::ZERO,
            BaseScopeCfg::default(),
            scope_strings::TEST(),
        )?;
        module.put(global_object, b"test", test_scope_functions);
        module.put(global_object, b"it", test_scope_functions);

        let xtest_scope_functions = create_bound(
            global_object,
            ScopeKind::Test,
            JSValue::ZERO,
            BaseScopeCfg { self_mode: ScopeMode::Skip, ..Default::default() },
            scope_strings::XTEST(),
        )?;
        module.put(global_object, b"xtest", xtest_scope_functions);
        module.put(global_object, b"xit", xtest_scope_functions);

        let describe_scope_functions = create_bound(
            global_object,
            ScopeKind::Describe,
            JSValue::ZERO,
            BaseScopeCfg::default(),
            scope_strings::DESCRIBE(),
        )?;
        module.put(global_object, b"describe", describe_scope_functions);

        let xdescribe_scope_functions = match create_bound(
            global_object,
            ScopeKind::Describe,
            JSValue::ZERO,
            BaseScopeCfg { self_mode: ScopeMode::Skip, ..Default::default() },
            scope_strings::XDESCRIBE(),
        ) {
            Ok(v) => v,
            Err(_) => return Ok(JSValue::ZERO),
        };
        module.put(global_object, b"xdescribe", xdescribe_scope_functions);

        // `#[bun_jsc::host_fn]` emits a `__jsc_host_{name}` shim with the raw
        // C-ABI `JSHostFn` signature; pass that to JSFunction::create.
        module.put(
            global_object,
            b"beforeEach",
            jsc::JSFunction::create(global_object, "beforeEach", generic_hook::__jsc_host_before_each, 1, Default::default()),
        );
        module.put(
            global_object,
            b"beforeAll",
            jsc::JSFunction::create(global_object, "beforeAll", generic_hook::__jsc_host_before_all, 1, Default::default()),
        );
        module.put(
            global_object,
            b"afterAll",
            jsc::JSFunction::create(global_object, "afterAll", generic_hook::__jsc_host_after_all, 1, Default::default()),
        );
        module.put(
            global_object,
            b"afterEach",
            jsc::JSFunction::create(global_object, "afterEach", generic_hook::__jsc_host_after_each, 1, Default::default()),
        );
        module.put(
            global_object,
            b"onTestFinished",
            jsc::JSFunction::create(global_object, "onTestFinished", generic_hook::__jsc_host_on_test_finished, 1, Default::default()),
        );
        module.put(
            global_object,
            b"setDefaultTimeout",
            jsc::JSFunction::create(global_object, "setDefaultTimeout", __jsc_host_js_set_default_timeout, 1, Default::default()),
        );
        module.put(global_object, b"expect", jsc::codegen::js::get_constructor::<Expect>(global_object));
        module.put(global_object, b"expectTypeOf", jsc::codegen::js::get_constructor::<ExpectTypeOf>(global_object));

        // will add more 9 properties in the module here so we need to allocate 23 properties
        create_mock_objects(global_object, module);

        Ok(module)
    }

    fn create_mock_objects(global_object: &JSGlobalObject, module: JSValue) {
        let set_system_time = jsc::JSFunction::create(global_object, "setSystemTime", JSMock__jsSetSystemTime, 0, Default::default());
        module.put(global_object, b"setSystemTime", set_system_time);

        let mock_fn = jsc::JSFunction::create(global_object, "fn", JSMock__jsMockFn, 1, Default::default());
        let spy_on = jsc::JSFunction::create(global_object, "spyOn", JSMock__jsSpyOn, 2, Default::default());
        let restore_all_mocks = jsc::JSFunction::create(global_object, "restoreAllMocks", JSMock__jsRestoreAllMocks, 2, Default::default());
        let clear_all_mocks = jsc::JSFunction::create(global_object, "clearAllMocks", JSMock__jsClearAllMocks, 2, Default::default());
        let mock_module_fn = jsc::JSFunction::create(global_object, "module", JSMock__jsModuleMock, 2, Default::default());
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
        jest.put(global_object, b"resetAllMocks", clear_all_mocks);
        jest.put(global_object, b"setSystemTime", set_system_time);
        jest.put(global_object, b"now", jsc::JSFunction::create(global_object, "now", JSMock__jsNow, 0, Default::default()));
        jest.put(global_object, b"setTimeout", jsc::JSFunction::create(global_object, "setTimeout", __jsc_host_js_set_default_timeout, 1, Default::default()));

        module.put(global_object, b"jest", jest);
        module.put(global_object, b"spyOn", spy_on);
        module.put(global_object, b"expect", jsc::codegen::js::get_constructor::<Expect>(global_object));

        let vi = JSValue::create_empty_object(global_object, 6 + fake_timers::TIMER_FNS_COUNT);
        vi.put(global_object, b"fn", mock_fn);
        vi.put(global_object, b"mock", mock_module_fn);
        vi.put(global_object, b"spyOn", spy_on);
        vi.put(global_object, b"restoreAllMocks", restore_all_mocks);
        vi.put(global_object, b"resetAllMocks", clear_all_mocks);
        vi.put(global_object, b"clearAllMocks", clear_all_mocks);
        module.put(global_object, b"vi", vi);

        fake_timers::put_timers_fns(global_object, jest, vi);
    }

    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        pub safe fn Bun__Jest__testModuleObject(global: &JSGlobalObject) -> JSValue;
    }
    bun_jsc::jsc_abi_extern! {
        pub fn JSMock__jsMockFn(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub fn JSMock__jsModuleMock(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub fn JSMock__jsNow(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub fn JSMock__jsSetSystemTime(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub fn JSMock__jsRestoreAllMocks(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub fn JSMock__jsClearAllMocks(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
        pub fn JSMock__jsSpyOn(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue;
    }

    #[bun_jsc::host_fn]
    pub fn call(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let vm = global_object.bun_vm();

        // SAFETY: bun_vm() returns the live per-thread VM; deref for a single field read.
        if unsafe { (*vm).is_in_preload } || runner().is_none() {
            // in preload, no arguments needed
        } else {
            let arguments = callframe.arguments_old::<2>();
            let arguments = arguments.slice();

            if arguments.len() < 1 || !arguments[0].is_string() {
                return Err(global_object.throw(format_args!("Bun.jest() expects a string filename")));
            }
            let str = arguments[0].to_slice(global_object)?;
            let slice = str.slice();

            if !bun_paths::is_absolute(slice) {
                return Err(global_object.throw(format_args!(
                    "Bun.jest() expects an absolute file path, got '{}'",
                    bstr::BStr::new(slice)
                )));
            }
        }

        Ok(Bun__Jest__testModuleObject(global_object))
    }

    #[bun_jsc::host_fn]
    fn js_set_default_timeout(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        let arguments = arguments.slice();
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

pub mod on_unhandled_rejection {
    use super::*;

    pub fn on_unhandled_rejection(
        jsc_vm: &mut VirtualMachine,
        global_object: &JSGlobalObject,
        rejection: JSValue,
    ) {
        if let Some(buntest_strong) = bun_test::clone_active_strong() {
            // PORT NOTE: `defer buntest_strong.deinit()` — Rc::drop handles this.
            // SAFETY: single-threaded JS VM; `buntest_strong` is the only handle
            // dereferenced for this scope and is dropped before `BunTest::run`
            // re-borrows. Const→mut projection is centralized in `buntest_as_mut`
            // pending the BunTestPtr interior-mut reshape (see bun_test.rs).
            let buntest = unsafe { bun_test::buntest_as_mut(&buntest_strong) };
            // mark unhandled errors as belonging to the currently active test. note that this can be misleading.
            let mut current_state_data = buntest.get_current_state_data();
            // PORT NOTE: split entry()/sequence() borrows via raw-ptr capture (per-use reborrow).
            let entry_ptr: Option<*mut bun_test::ExecutionEntry> = current_state_data
                .entry(buntest)
                .map(|e| std::ptr::from_mut::<bun_test::ExecutionEntry>(e));
            if let Some(entry) = entry_ptr {
                if let Some(sequence) = current_state_data.sequence(buntest) {
                    if sequence.test_entry.map(|p| p.as_ptr()) != Some(entry) {
                        // mark errors in hooks as 'unhandled error between tests'
                        current_state_data = RefDataValue::Start;
                    }
                }
            }
            buntest.on_uncaught_exception(
                global_object,
                Some(rejection),
                true,
                current_state_data.clone(),
            );
            buntest.add_result(current_state_data);
            if let Err(e) = bun_test::BunTest::run(buntest_strong, global_object) {
                // TODO(blocked_on: bun_jsc::JSGlobalObject::report_uncaught_exception_from_error):
                // the inherent method lives in the cfg-gated JSGlobalObject.rs impl.
                let _ = e;
            }
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

fn consume_arg(
    global_this: &JSGlobalObject,
    should_write: bool,
    str_idx: &mut usize,
    args_idx: &mut usize,
    array_list: &mut Vec<u8>,
    arg: &JSValue,
    fallback: &[u8],
) -> JsResult<()> {
    // TODO(port): narrow error set
    if should_write {
        let owned_slice = arg.to_slice_or_null(global_this)?;
        array_list.extend_from_slice(owned_slice.slice());
    } else {
        array_list.extend_from_slice(fallback);
    }
    *str_idx += 1;
    *args_idx += 1;
    Ok(())
}

/// Generate test label by positionally injecting parameters with printf formatting
pub fn format_label(
    global_this: &JSGlobalObject,
    label: &[u8],
    function_args: &[JSValue],
    test_idx: usize,
) -> JsResult<Box<[u8]>> {
    // TODO(port): narrow error set
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
                            && bun_js_parser::js_lexer::is_identifier_continue(label[var_end + 1] as i32)
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
                    // TODO(port): move to *_jsc
                    bun_core::String::init(var_path).to_js(global_this)?,
                )?;
                if !value.is_empty_or_undefined_or_null() {
                    // For primitive strings, use toString() to avoid adding quotes
                    // This matches Jest's behavior (https://github.com/jestjs/jest/issues/7689)
                    if value.is_string() {
                        let owned_slice = value.to_slice_or_null(global_this)?;
                        list.extend_from_slice(owned_slice.slice());
                    } else {
                        let mut formatter = crate::test_runner::expect::make_formatter(global_this);
                        // PORT NOTE: `defer formatter.deinit()` — Drop handles this.
                        write!(&mut list, "{}", value.to_fmt(&mut formatter)).unwrap();
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
                        &current_arg,
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
                        &current_arg,
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
                        &current_arg,
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
                        &current_arg,
                        b"%f",
                    )?;
                }
                b'j' | b'o' => {
                    let mut str = bun_core::String::empty();
                    // PORT NOTE: `defer str.deref()` — Drop handles this.
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    current_arg.json_stringify_fast(global_this, &mut str)?;
                    let owned_slice = str.to_owned_slice();
                    list.extend_from_slice(&owned_slice);
                    idx += 1;
                    args_idx += 1;
                }
                b'p' => {
                    let mut formatter = crate::test_runner::expect::make_formatter(global_this);
                    let value_fmt = current_arg.to_fmt(&mut formatter);
                    write!(&mut list, "{}", value_fmt).unwrap();
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

pub fn capture_test_line_number(callframe: &CallFrame, global_this: &JSGlobalObject) -> u32 {
    if let Some(runner) = Jest::runner() {
        if runner.test_options.reporters.junit {
            // TODO(port): move to <area>_sys
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

pub fn error_in_ci(global_object: &JSGlobalObject, message: &[u8]) -> JsResult<()> {
    if crate::cli::ci_info::is_ci() {
        return Err(global_object.throw(format_args!(
            "{}\nTo override, set the environment variable CI=false.",
            bstr::BStr::new(message)
        )));
    }
    Ok(())
}

// ported from: src/test_runner/jest.zig

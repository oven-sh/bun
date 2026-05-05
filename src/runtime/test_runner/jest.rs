use core::ptr::NonNull;
use std::io::Write as _;

use crate::cli::command::TestOptions;
use crate::cli::test_command::CommandLineReporter;
use bun_collections::{ArrayHashMap, MultiArrayList};
use bun_core::Output;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, RegularExpression, VirtualMachine,
    ZigString,
};
use bun_logger as logger;
use bun_str as strings;

pub use crate::bun_test;
use crate::expect::{Expect, ExpectTypeOf};
use crate::snapshot::Snapshots;

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

        Output::pretty_error(format_args!("<r>\n"));

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
    // TODO(port): std.Random has no direct Rust equivalent; replace with a PRNG handle.
    pub randomize: Option<bun_core::Random>,
    /// The --seed value when --randomize is on. Used to derive a per-file
    /// shuffle PRNG from hash(seed, file_path) so within-file test order is
    /// independent of which worker (and which prior files) ran it.
    pub randomize_seed: Option<u32>,
    // TODO(port): lifetime — likely borrowed from test_options
    pub concurrent_test_glob: Option<&'a [&'a [u8]]>,
    pub last_file: u64,
    pub bail: u32,
    pub max_concurrency: u32,

    // PORT NOTE: `allocator: std.mem.Allocator` field deleted — global mimalloc.
    // TODO(port): `drainer` had `= undefined` default in Zig
    pub drainer: jsc::AnyTask,

    pub has_pending_tests: bool,

    pub snapshots: Snapshots,

    pub default_timeout_ms: u32,

    /// from `setDefaultTimeout() or jest.setTimeout()`. maxInt(u32) means override not set.
    pub default_timeout_override: u32,

    pub test_options: &'a TestOptions,

    /// Used for --test-name-pattern to reduce allocations
    pub filter_regex: Option<&'a RegularExpression>,

    pub unhandled_errors_between_tests: u32,
    pub summary: Summary,

    pub bun_test_root: bun_test::BunTestRoot,
}

impl<'a> TestRunner<'a> {
    pub fn get_active_timeout(&self) -> bun_core::Timespec {
        let Some(active_file) = self.bun_test_root.active_file.get() else {
            return bun_core::Timespec::EPOCH;
        };
        if active_file.timer.state != TimerState::ACTIVE
            || active_file.timer.next.eql(&bun_core::Timespec::EPOCH)
        {
            return bun_core::Timespec::EPOCH;
        }
        active_file.timer.next
    }

    pub fn remove_active_timeout(&mut self, vm: &mut VirtualMachine) {
        let Some(active_file) = self.bun_test_root.active_file.get() else {
            return;
        };
        if active_file.timer.state != TimerState::ACTIVE
            || active_file.timer.next.eql(&bun_core::Timespec::EPOCH)
        {
            return;
        }
        vm.timer.remove(&mut active_file.timer);
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
            let result = bun_glob::r#match(pattern, file_path);
            if result == bun_glob::MatchResult::Match {
                return true;
            }
        }
        false
    }

    pub fn get_or_put_file(&mut self, file_path: &[u8]) -> GetOrPutFileResult {
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
                source: logger::Source::init_empty_file(file_path),
                ..Default::default()
            })
            .expect("unreachable");
        *entry.value_ptr = file_id;
        GetOrPutFileResult { file_id }
    }
}

// TODO(port): placeholder for timer state enum referenced via `.ACTIVE`
use bun_jsc::timer::State as TimerState;

#[derive(Default)]
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
    pub source: logger::Source,
    pub log: logger::Log,
}

impl Default for File {
    fn default() -> Self {
        Self {
            source: logger::Source::init_empty_file(b""),
            log: logger::Log::init_comptime(),
        }
    }
}

pub type FileList = MultiArrayList<File>;
pub type FileId = u32;
// PORT NOTE: Zig used ArrayIdentityContext; u32 keys hash as identity in bun_collections.
pub type FileMap = ArrayHashMap<u32, u32>;

#[allow(non_snake_case)]
pub mod Jest {
    use super::*;

    // TODO(port): global mutable state; Zig `pub var runner: ?*TestRunner = null`.
    pub static mut RUNNER: Option<NonNull<TestRunner<'static>>> = None;

    pub fn runner() -> Option<&'static mut TestRunner<'static>> {
        // SAFETY: single-threaded JS VM; matches Zig's unguarded global access.
        unsafe { RUNNER.map(|p| &mut *p.as_ptr()) }
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

        let test_scope_functions = bun_test::ScopeFunctions::create_bound(
            global_object,
            bun_test::ScopeKind::Test,
            JSValue::ZERO,
            bun_test::ScopeOptions::default(),
            bun_test::ScopeFunctions::strings::TEST,
        )?;
        module.put(global_object, ZigString::static_str("test"), test_scope_functions);
        module.put(global_object, ZigString::static_str("it"), test_scope_functions);

        let xtest_scope_functions = bun_test::ScopeFunctions::create_bound(
            global_object,
            bun_test::ScopeKind::Test,
            JSValue::ZERO,
            bun_test::ScopeOptions { self_mode: bun_test::SelfMode::Skip, ..Default::default() },
            bun_test::ScopeFunctions::strings::XTEST,
        )?;
        module.put(global_object, ZigString::static_str("xtest"), xtest_scope_functions);
        module.put(global_object, ZigString::static_str("xit"), xtest_scope_functions);

        let describe_scope_functions = bun_test::ScopeFunctions::create_bound(
            global_object,
            bun_test::ScopeKind::Describe,
            JSValue::ZERO,
            bun_test::ScopeOptions::default(),
            bun_test::ScopeFunctions::strings::DESCRIBE,
        )?;
        module.put(global_object, ZigString::static_str("describe"), describe_scope_functions);

        let xdescribe_scope_functions = match bun_test::ScopeFunctions::create_bound(
            global_object,
            bun_test::ScopeKind::Describe,
            JSValue::ZERO,
            bun_test::ScopeOptions { self_mode: bun_test::SelfMode::Skip, ..Default::default() },
            bun_test::ScopeFunctions::strings::XDESCRIBE,
        ) {
            Ok(v) => v,
            Err(_) => return Ok(JSValue::ZERO),
        };
        module.put(global_object, ZigString::static_str("xdescribe"), xdescribe_scope_functions);

        module.put(
            global_object,
            ZigString::static_str("beforeEach"),
            jsc::JSFunction::create(global_object, "beforeEach", bun_test::js_fns::generic_hook::<{ bun_test::HookKind::BeforeEach }>::hook_fn, 1, Default::default()),
        );
        module.put(
            global_object,
            ZigString::static_str("beforeAll"),
            jsc::JSFunction::create(global_object, "beforeAll", bun_test::js_fns::generic_hook::<{ bun_test::HookKind::BeforeAll }>::hook_fn, 1, Default::default()),
        );
        module.put(
            global_object,
            ZigString::static_str("afterAll"),
            jsc::JSFunction::create(global_object, "afterAll", bun_test::js_fns::generic_hook::<{ bun_test::HookKind::AfterAll }>::hook_fn, 1, Default::default()),
        );
        module.put(
            global_object,
            ZigString::static_str("afterEach"),
            jsc::JSFunction::create(global_object, "afterEach", bun_test::js_fns::generic_hook::<{ bun_test::HookKind::AfterEach }>::hook_fn, 1, Default::default()),
        );
        module.put(
            global_object,
            ZigString::static_str("onTestFinished"),
            jsc::JSFunction::create(global_object, "onTestFinished", bun_test::js_fns::generic_hook::<{ bun_test::HookKind::OnTestFinished }>::hook_fn, 1, Default::default()),
        );
        module.put(
            global_object,
            ZigString::static_str("setDefaultTimeout"),
            jsc::JSFunction::create(global_object, "setDefaultTimeout", js_set_default_timeout, 1, Default::default()),
        );
        module.put(global_object, ZigString::static_str("expect"), Expect::js::get_constructor(global_object));
        module.put(global_object, ZigString::static_str("expectTypeOf"), ExpectTypeOf::js::get_constructor(global_object));

        // will add more 9 properties in the module here so we need to allocate 23 properties
        create_mock_objects(global_object, module);

        Ok(module)
    }

    fn create_mock_objects(global_object: &JSGlobalObject, module: JSValue) {
        let set_system_time = jsc::JSFunction::create(global_object, "setSystemTime", JSMock__jsSetSystemTime, 0, Default::default());
        module.put(global_object, "setSystemTime", set_system_time);

        let mock_fn = jsc::JSFunction::create(global_object, "fn", JSMock__jsMockFn, 1, Default::default());
        let spy_on = jsc::JSFunction::create(global_object, "spyOn", JSMock__jsSpyOn, 2, Default::default());
        let restore_all_mocks = jsc::JSFunction::create(global_object, "restoreAllMocks", JSMock__jsRestoreAllMocks, 2, Default::default());
        let clear_all_mocks = jsc::JSFunction::create(global_object, "clearAllMocks", JSMock__jsClearAllMocks, 2, Default::default());
        let mock_module_fn = jsc::JSFunction::create(global_object, "module", JSMock__jsModuleMock, 2, Default::default());
        module.put(global_object, ZigString::static_str("mock"), mock_fn);
        mock_fn.put(global_object, ZigString::static_str("module"), mock_module_fn);
        mock_fn.put(global_object, ZigString::static_str("restore"), restore_all_mocks);
        mock_fn.put(global_object, ZigString::static_str("clearAllMocks"), clear_all_mocks);

        let jest = JSValue::create_empty_object(global_object, 9 + bun_test::FakeTimers::TIMER_FNS_COUNT);
        jest.put(global_object, ZigString::static_str("fn"), mock_fn);
        jest.put(global_object, ZigString::static_str("mock"), mock_module_fn);
        jest.put(global_object, ZigString::static_str("spyOn"), spy_on);
        jest.put(global_object, ZigString::static_str("restoreAllMocks"), restore_all_mocks);
        jest.put(global_object, ZigString::static_str("clearAllMocks"), clear_all_mocks);
        jest.put(global_object, ZigString::static_str("resetAllMocks"), clear_all_mocks);
        jest.put(global_object, ZigString::static_str("setSystemTime"), set_system_time);
        jest.put(global_object, ZigString::static_str("now"), jsc::JSFunction::create(global_object, "now", JSMock__jsNow, 0, Default::default()));
        jest.put(global_object, ZigString::static_str("setTimeout"), jsc::JSFunction::create(global_object, "setTimeout", js_set_default_timeout, 1, Default::default()));

        module.put(global_object, ZigString::static_str("jest"), jest);
        module.put(global_object, ZigString::static_str("spyOn"), spy_on);
        module.put(global_object, ZigString::static_str("expect"), Expect::js::get_constructor(global_object));

        let vi = JSValue::create_empty_object(global_object, 6 + bun_test::FakeTimers::TIMER_FNS_COUNT);
        vi.put(global_object, ZigString::static_str("fn"), mock_fn);
        vi.put(global_object, ZigString::static_str("mock"), mock_module_fn);
        vi.put(global_object, ZigString::static_str("spyOn"), spy_on);
        vi.put(global_object, ZigString::static_str("restoreAllMocks"), restore_all_mocks);
        vi.put(global_object, ZigString::static_str("resetAllMocks"), clear_all_mocks);
        vi.put(global_object, ZigString::static_str("clearAllMocks"), clear_all_mocks);
        module.put(global_object, ZigString::static_str("vi"), vi);

        bun_test::FakeTimers::put_timers_fns(global_object, jest, vi);
    }

    // TODO(port): move to <area>_sys
    // TODO(port): callconv(jsc.conv) — needs "sysv64" on Windows-x64, "C" elsewhere
    unsafe extern "C" {
        pub fn Bun__Jest__testModuleObject(global: *mut JSGlobalObject) -> JSValue;
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

        if vm.is_in_preload || runner().is_none() {
            // in preload, no arguments needed
        } else {
            let arguments = callframe.arguments_old(2).slice();

            if arguments.len() < 1 || !arguments[0].is_string() {
                return global_object.throw(format_args!("Bun.jest() expects a string filename"));
            }
            let str = arguments[0].to_slice(global_object)?;
            let slice = str.slice();

            if !bun_paths::is_absolute(slice) {
                return global_object.throw(format_args!(
                    "Bun.jest() expects an absolute file path, got '{}'",
                    bstr::BStr::new(slice)
                ));
            }
        }

        // SAFETY: FFI call into C++; global_object is valid for the duration.
        Ok(unsafe { Bun__Jest__testModuleObject(global_object as *const _ as *mut _) })
    }

    #[bun_jsc::host_fn]
    fn js_set_default_timeout(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1).slice();
        if arguments.len() < 1 || !arguments[0].is_number() {
            return global_object.throw(format_args!("setTimeout() expects a number (milliseconds)"));
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
        if let Some(buntest_strong_) = bun_test::clone_active_strong() {
            let mut buntest_strong = buntest_strong_;
            // PORT NOTE: `defer buntest_strong.deinit()` — Drop handles this.

            let buntest = buntest_strong.get();
            // mark unhandled errors as belonging to the currently active test. note that this can be misleading.
            let mut current_state_data = buntest.get_current_state_data();
            if let Some(entry) = current_state_data.entry(buntest) {
                if let Some(sequence) = current_state_data.sequence(buntest) {
                    if entry != sequence.test_entry {
                        // mark errors in hooks as 'unhandled error between tests'
                        current_state_data = bun_test::StateData::Start;
                    }
                }
            }
            buntest.on_uncaught_exception(global_object, rejection, true, current_state_data);
            buntest.add_result(current_state_data);
            if let Err(e) = bun_test::BunTest::run(buntest_strong, global_object) {
                global_object.report_uncaught_exception_from_error(e);
            }
            return;
        }

        jsc_vm.run_error_handler(rejection, jsc_vm.on_unhandled_rejection_exception_list);
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

            if bun_js_parser::js_lexer::is_identifier_start(label[var_end]) {
                var_end += 1;

                while var_end < label.len() {
                    let c = label[var_end];
                    if c == b'.' {
                        if var_end + 1 < label.len()
                            && bun_js_parser::js_lexer::is_identifier_continue(label[var_end + 1])
                        {
                            var_end += 1;
                        } else {
                            break;
                        }
                    } else if bun_js_parser::js_lexer::is_identifier_continue(c) {
                        var_end += 1;
                    } else {
                        break;
                    }
                }

                let var_path = &label[var_start..var_end];
                let value = function_args[0].get_if_property_exists_from_path(
                    global_this,
                    // TODO(port): move to *_jsc
                    bun_str::String::init(var_path).to_js(global_this)?,
                )?;
                if !value.is_empty_or_undefined_or_null() {
                    // For primitive strings, use toString() to avoid adding quotes
                    // This matches Jest's behavior (https://github.com/jestjs/jest/issues/7689)
                    if value.is_string() {
                        let owned_slice = value.to_slice_or_null(global_this)?;
                        list.extend_from_slice(owned_slice.slice());
                    } else {
                        let mut formatter = jsc::console_object::Formatter {
                            global_this,
                            quote_strings: true,
                            ..Default::default()
                        };
                        // PORT NOTE: `defer formatter.deinit()` — Drop handles this.
                        write!(&mut list, "{}", value.to_fmt(&mut formatter)).unwrap();
                    }
                    idx = var_end;
                    continue;
                }
            } else {
                while var_end < label.len()
                    && (bun_js_parser::js_lexer::is_identifier_continue(label[var_end])
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
                    let mut str = bun_str::String::empty();
                    // PORT NOTE: `defer str.deref()` — Drop handles this.
                    // Use jsonStringifyFast for SIMD-optimized serialization
                    current_arg.json_stringify_fast(global_this, &mut str)?;
                    let owned_slice = str.to_owned_slice();
                    list.extend_from_slice(&owned_slice);
                    idx += 1;
                    args_idx += 1;
                }
                b'p' => {
                    let mut formatter = jsc::console_object::Formatter {
                        global_this,
                        quote_strings: true,
                        ..Default::default()
                    };
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
    if bun_core::ci::is_ci() {
        return global_object.throw_pretty(format_args!(
            "{}\nTo override, set the environment variable CI=false.",
            bstr::BStr::new(message)
        ));
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/jest.zig (519 lines)
//   confidence: medium
//   todos:      12
//   notes:      TestRunner<'a> from LIFETIMES.tsv; Jest as module w/ static mut RUNNER; extern JSMock__* fns need jsc.conv ABI; bun_test sibling-module API names guessed (ScopeFunctions/HookKind/StateData).
// ──────────────────────────────────────────────────────────────────────────

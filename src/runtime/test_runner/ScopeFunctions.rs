use core::fmt;
use core::sync::atomic::{AtomicI32, Ordering};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer, VirtualMachine};
use bun_str::String as BunString;

use crate::bun_test::{self, BaseScopeCfg, BunTest, DescribeScope};
use crate::bun_test::js_fns::Signature;
// TODO(port): `group_log` is `bun_test::debug::group` — a begin/end/log group tracer.
// Model as RAII guard (`begin()` returns a guard whose Drop calls `end()`) + `log!` macro.
use crate::bun_test::debug::group as group_log;

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[repr(u8)]
pub enum Mode {
    #[strum(serialize = "describe")]
    Describe,
    #[strum(serialize = "test")]
    Test,
}

#[bun_jsc::JsClass]
pub struct ScopeFunctions {
    pub mode: Mode,
    pub cfg: BaseScopeCfg,
    /// typically `.zero`. not Strong.Optional because codegen visits the C++ `m_each`
    /// WriteBarrier on the JS wrapper (see `values: ["each"]` in jest.classes.ts). This
    /// field is kept in sync with that slot via `js::each_set_cached` in `create_unbound`.
    pub each: JSValue,
}

pub mod strings {
    use bun_str::String as BunString;
    // TODO(port): `bun.String.static("...")` — assumes a const-capable `BunString::static_str`.
    pub static DESCRIBE: BunString = BunString::static_str("describe");
    pub static XDESCRIBE: BunString = BunString::static_str("xdescribe");
    pub static TEST: BunString = BunString::static_str("test");
    pub static XTEST: BunString = BunString::static_str("xtest");
    pub static SKIP: BunString = BunString::static_str("skip");
    pub static TODO: BunString = BunString::static_str("todo");
    pub static FAILING: BunString = BunString::static_str("failing");
    pub static CONCURRENT: BunString = BunString::static_str("concurrent");
    pub static SERIAL: BunString = BunString::static_str("serial");
    pub static ONLY: BunString = BunString::static_str("only");
    pub static IF: BunString = BunString::static_str("if");
    pub static SKIP_IF: BunString = BunString::static_str("skipIf");
    pub static TODO_IF: BunString = BunString::static_str("todoIf");
    pub static FAILING_IF: BunString = BunString::static_str("failingIf");
    pub static CONCURRENT_IF: BunString = BunString::static_str("concurrentIf");
    pub static SERIAL_IF: BunString = BunString::static_str("serialIf");
    pub static EACH: BunString = BunString::static_str("each");
}

impl ScopeFunctions {
    #[bun_jsc::host_fn(getter)]
    pub fn get_skip(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"get .skip", strings::SKIP)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_todo(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"get .todo", strings::TODO)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_failing(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"get .failing", strings::FAILING)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_concurrent(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"get .concurrent", strings::CONCURRENT)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_serial(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .serial", strings::SERIAL)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_only(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_only: true, ..Default::default() }, b"get .only", strings::ONLY)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_if(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .if()", true, strings::IF)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_skip_if(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .skipIf()", false, strings::SKIP_IF)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_todo_if(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"call .todoIf()", false, strings::TODO_IF)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_failing_if(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"call .failingIf()", false, strings::FAILING_IF)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_concurrent_if(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"call .concurrentIf()", false, strings::CONCURRENT_IF)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_serial_if(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"call .serialIf()", false, strings::SERIAL_IF)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_each(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let _g = group_log::begin();

        let [array] = frame.arguments_as_array::<1>();
        if array.is_undefined_or_null() || !array.is_array() {
            let formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return global.throw(format_args!("Expected array, got {}", array.to_fmt(&formatter)));
        }

        if !this.each.is_empty() {
            return global.throw(format_args!("Cannot {} on {}", "each", this));
        }
        create_bound(global, this.mode, array, this.cfg, strings::EACH)
    }
}

#[bun_jsc::host_fn]
pub fn call_as_function(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let _g = group_log::begin();

    let Some(this) = ScopeFunctions::from_js(frame.this()) else {
        return global.throw(format_args!("Expected callee to be ScopeFunctions"));
    };
    let line_no = crate::jest::capture_test_line_number(frame, global);

    let buntest_strong = bun_test::js_fns::clone_active_strong(
        global,
        bun_test::js_fns::CloneActiveStrongOpts {
            signature: Signature::ScopeFunctions(this),
            allow_in_preload: false,
        },
    )?;
    let bun_test_ptr = buntest_strong.get();

    let callback_mode: CallbackMode = match this.cfg.self_mode {
        SelfMode::Skip | SelfMode::Todo => CallbackMode::Allow,
        _ => CallbackMode::Require,
    };

    let args = parse_arguments(
        global,
        frame,
        Signature::ScopeFunctions(this),
        ParseArgumentsCfg { callback: callback_mode, kind: FunctionKind::TestOrDescribe },
    )?;

    let callback_length = if let Some(callback) = args.callback {
        callback.get_length(global)?
    } else {
        0
    };

    if !this.each.is_empty() {
        if this.each.is_undefined_or_null() || !this.each.is_array() {
            let formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return global.throw(format_args!("Expected array, got {}", this.each.to_fmt(&formatter)));
        }
        let mut iter = this.each.array_iterator(global)?;
        let mut test_idx: usize = 0;
        while let Some(item) = iter.next()? {
            if item.is_empty() {
                break;
            }

            // PORTING.md §JSC types: Vec<JSValue> backing storage is on the Rust heap (not
            // stack-scanned). MarkedArgumentBuffer is registered with the VM as a root, so
            // values appended mid-loop survive the allocations triggered by array_iterator/
            // format_label/bind below. Replaces Zig's heap ArrayList + parallel raw slice.
            let mut args_list = MarkedArgumentBuffer::new();

            if item.is_array() {
                // Spread array as args_list (matching Jest & Vitest)
                let mut item_iter = item.array_iterator(global)?;
                let mut idx: usize = 0;
                while let Some(array_item) = item_iter.next()? {
                    args_list.append(array_item);
                    idx += 1;
                }
                let _ = idx;
            } else {
                args_list.append(item);
            }

            let formatted_label: Option<Vec<u8>> = if let Some(desc) = args.description.as_deref() {
                Some(crate::jest::format_label(global, desc, args_list.as_slice(), test_idx)?)
            } else {
                None
            };

            let bound = if let Some(cb) = args.callback {
                Some(cb.bind(global, item, &BunString::static_str("cb"), 0, args_list.as_slice())?)
            } else {
                None
            };
            this.enqueue_describe_or_test_callback(
                bun_test_ptr,
                global,
                frame,
                bound,
                formatted_label.as_deref(),
                &args.options,
                callback_length.saturating_sub(args_list.len()),
                line_no,
            )?;

            test_idx += 1;
        }
    } else {
        this.enqueue_describe_or_test_callback(
            bun_test_ptr,
            global,
            frame,
            args.callback,
            args.description.as_deref(),
            &args.options,
            callback_length,
            line_no,
        )?;
    }

    Ok(JSValue::UNDEFINED)
}

// `filterNames` in Zig is generic over a duck-typed `Rem` with `writeEnd`.
trait WriteEnd {
    fn write_end(&mut self, write: &[u8]);
}

struct Measure {
    len: usize,
}
impl WriteEnd for Measure {
    fn write_end(&mut self, write: &[u8]) {
        self.len += write.len();
    }
}

struct Write<'a> {
    buf: &'a mut [u8],
}
impl<'a> WriteEnd for Write<'a> {
    fn write_end(&mut self, write: &[u8]) {
        if self.buf.len() < write.len() {
            debug_assert!(false);
            return;
        }
        let dst_start = self.buf.len() - write.len();
        self.buf[dst_start..].copy_from_slice(write);
        // PORT NOTE: reshaped for borrowck — Zig reassigns the slice in place;
        // here we shrink via `take` + reslice.
        let buf = core::mem::take(&mut self.buf);
        self.buf = &mut buf[..dst_start];
    }
}

fn filter_names<R: WriteEnd>(rem: &mut R, description: Option<&[u8]>, parent_in: Option<&DescribeScope>) {
    const SEP: &[u8] = b" ";
    rem.write_end(description.unwrap_or(b""));
    let mut parent = parent_in;
    while let Some(scope) = parent {
        parent = scope.base.parent.as_deref();
        if scope.base.name.is_none() {
            continue;
        }
        rem.write_end(SEP);
        rem.write_end(scope.base.name.as_deref().unwrap_or(b""));
    }
}

impl ScopeFunctions {
    fn enqueue_describe_or_test_callback(
        &self,
        bun_test: &mut BunTest,
        global: &JSGlobalObject,
        frame: &CallFrame,
        callback: Option<JSValue>,
        description: Option<&[u8]>,
        options: &ParseArgumentsOptions,
        callback_length: usize,
        line_no: u32,
    ) -> JsResult<()> {
        let _g = group_log::begin();

        // only allow in collection phase
        match bun_test.phase {
            bun_test::Phase::Collection => {} // ok
            bun_test::Phase::Execution => {
                return global.throw(format_args!(
                    "Cannot call {}() inside a test. Call it inside describe() instead.",
                    self
                ));
            }
            bun_test::Phase::Done => {
                return global.throw(format_args!(
                    "Cannot call {}() after the test run has completed",
                    self
                ));
            }
        }

        // handle test reporter agent for debugger
        let vm = global.bun_vm();
        let mut test_id_for_debugger: i32 = 0;
        if let Some(debugger) = vm.debugger.as_mut() {
            if debugger.test_reporter_agent.is_enabled() {
                // Zig: fn-local `struct { var max_test_id_for_debugger: i32 = 0; }` — process-global static.
                static MAX_TEST_ID_FOR_DEBUGGER: AtomicI32 = AtomicI32::new(0);
                // TODO(port): Zig used non-atomic `+= 1` (single JS thread). Relaxed fetch_add preserves semantics.
                let id = MAX_TEST_ID_FOR_DEBUGGER.fetch_add(1, Ordering::Relaxed) + 1;
                let mut name = BunString::init(description.unwrap_or(b"(unnamed)"));
                let parent = &bun_test.collection.active_scope;
                let parent_id = if parent.base.test_id_for_debugger != 0 {
                    parent.base.test_id_for_debugger
                } else {
                    -1
                };
                debugger.test_reporter_agent.report_test_found(
                    frame,
                    id,
                    &mut name,
                    match self.mode {
                        Mode::Describe => TestReporterKind::Describe,
                        Mode::Test => TestReporterKind::Test,
                    },
                    parent_id,
                );
                test_id_for_debugger = id;
            }
        }
        let has_done_parameter = if callback.is_some() { callback_length >= 1 } else { false };

        let mut base = self.cfg;
        base.line_no = line_no;
        base.test_id_for_debugger = test_id_for_debugger;
        // Use the file's default concurrent setting (determined once when entering the file)
        // or the global concurrent flag from the runner
        if bun_test.default_concurrent
            || crate::jest::Jest::runner().map_or(false, |r| r.concurrent)
        {
            // Only set to concurrent if still inheriting
            if base.self_concurrent == SelfConcurrent::Inherit {
                base.self_concurrent = SelfConcurrent::Yes;
            }
        }

        match self.mode {
            Mode::Describe => {
                let new_scope = bun_test.collection.active_scope.append_describe(description, base)?;
                bun_test.collection.enqueue_describe_callback(new_scope, callback)?;
            }
            Mode::Test => {
                // check for filter match
                let mut matches_filter = true;
                if let Some(reporter) = bun_test.reporter.as_ref() {
                    if let Some(filter_regex) = reporter.jest.filter_regex.as_ref() {
                        group_log::log!("matches_filter begin");
                        debug_assert!(bun_test.collection.filter_buffer.is_empty());
                        // PORT NOTE: reshaped for borrowck — clear at end via explicit call below.

                        let mut len = Measure { len: 0 };
                        filter_names(&mut len, description, Some(&bun_test.collection.active_scope));
                        // TODO(port): `addManyAsSlice` — extend filter_buffer by `len.len` uninit bytes and return mut slice.
                        let slice = bun_test.collection.filter_buffer.add_many_as_slice(len.len)?;
                        let mut rem = Write { buf: slice };
                        filter_names(&mut rem, description, Some(&bun_test.collection.active_scope));
                        debug_assert!(rem.buf.is_empty());

                        let str = BunString::from_bytes(bun_test.collection.filter_buffer.as_slice());
                        group_log::log!(
                            "matches_filter \"{}\"",
                            bstr::BStr::new(bun_test.collection.filter_buffer.as_slice())
                        );
                        matches_filter = filter_regex.matches(&str);

                        bun_test.collection.filter_buffer.clear();
                    }
                }

                if !matches_filter {
                    base.self_mode = SelfMode::FilteredOut;
                }

                debug_assert!(!bun_test.collection.locked);
                group_log::log!(
                    "enqueueTestCallback / {} / in scope: {}",
                    bstr::BStr::new(description.unwrap_or(b"(unnamed)")),
                    bstr::BStr::new(bun_test.collection.active_scope.base.name.as_deref().unwrap_or(b"(unnamed)"))
                );

                let _ = bun_test.collection.active_scope.append_test(
                    description,
                    if matches_filter { callback } else { None },
                    bun_test::TestCfg {
                        has_done_parameter,
                        timeout: options.timeout,
                        retry_count: options.retry.unwrap_or(0),
                        repeat_count: options.repeats,
                    },
                    base,
                    bun_test::AppendPhase::Collection,
                )?;
            }
        }
        Ok(())
    }

    fn generic_if(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        conditional_cfg: BaseScopeCfg,
        name: &[u8],
        invert: bool,
        fn_name: BunString,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        let [condition] = frame.arguments_as_array::<1>();
        if frame.arguments().len() == 0 {
            return global.throw(format_args!("Expected condition to be a boolean"));
        }
        let cond = condition.to_boolean();
        if cond != invert {
            self.generic_extend(global, conditional_cfg, name, fn_name)
        } else {
            create_bound(global, self.mode, self.each, self.cfg, fn_name)
        }
    }

    fn generic_extend(
        &self,
        global: &JSGlobalObject,
        cfg: BaseScopeCfg,
        name: &[u8],
        fn_name: BunString,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        if cfg.self_mode == SelfMode::Failing && self.mode == Mode::Describe {
            return global.throw(format_args!("Cannot {} on {}", bstr::BStr::new(name), self));
        }
        if cfg.self_only {
            error_in_ci(global, b".only")?;
        }
        let Some(extended) = self.cfg.extend(cfg) else {
            return global.throw(format_args!("Cannot {} on {}", bstr::BStr::new(name), self));
        };
        create_bound(global, self.mode, self.each, extended, fn_name)
    }
}

fn error_in_ci(global: &JSGlobalObject, signature: &[u8]) -> JsResult<()> {
    if bun_ci::is_ci() {
        return global.throw_pretty(format_args!(
            "{} is disabled in CI environments to prevent accidentally skipping tests. To override, set the environment variable CI=false.",
            bstr::BStr::new(signature)
        ));
    }
    Ok(())
}

pub struct ParseArgumentsResult {
    pub description: Option<Vec<u8>>,
    pub callback: Option<JSValue>,
    pub options: ParseArgumentsOptions,
}
// PORT NOTE: Zig `deinit` only freed `description`; `Vec<u8>` drops automatically.

#[derive(Default, Clone, Copy)]
pub struct ParseArgumentsOptions {
    pub timeout: u32,
    pub retry: Option<u32>,
    pub repeats: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum CallbackMode {
    Require,
    Allow,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FunctionKind {
    TestOrDescribe,
    Hook,
}

#[derive(Copy, Clone)]
pub struct ParseArgumentsCfg {
    pub callback: CallbackMode,
    pub kind: FunctionKind,
}
impl Default for ParseArgumentsCfg {
    fn default() -> Self {
        Self { callback: CallbackMode::Require, kind: FunctionKind::TestOrDescribe }
    }
}

fn get_description(
    global: &JSGlobalObject,
    description: JSValue,
    signature: Signature,
) -> JsResult<Vec<u8>> {
    if description.is_empty() {
        return Ok(Vec::new());
    }

    if description.is_class(global) {
        let description_class_name = description.class_name(global)?;

        if description_class_name.len() > 0 {
            return Ok(description_class_name.to_owned_slice());
        }

        let description_name = description.get_name(global)?;
        // `description_name.deref()` handled by Drop on bun_str::String
        return Ok(description_name.to_owned_slice());
    }

    if description.is_function() {
        let func_name = description.get_name(global)?;
        if func_name.length() > 0 {
            return Ok(func_name.to_owned_slice());
        }
    }

    if description.is_number() || description.is_string() {
        let slice = description.to_slice(global)?;
        return Ok(slice.into_owned_slice());
    }

    global.throw_pretty(format_args!(
        "{}() expects first argument to be a named class, named function, number, or string",
        signature
    ))
}

pub fn parse_arguments(
    global: &JSGlobalObject,
    frame: &CallFrame,
    signature: Signature,
    cfg: ParseArgumentsCfg,
) -> JsResult<ParseArgumentsResult> {
    let [a1, a2, a3] = frame.arguments_as_array::<3>();

    #[derive(Copy, Clone)]
    enum Len { Three, Two, One, Zero }
    let len: Len = if !a3.is_undefined_or_null() {
        Len::Three
    } else if !a2.is_undefined_or_null() {
        Len::Two
    } else if !a1.is_undefined_or_null() {
        Len::One
    } else {
        Len::Zero
    };

    #[derive(Copy, Clone)]
    struct DescriptionCallbackOptions {
        description: JSValue,
        callback: JSValue,
        options: JSValue,
    }
    impl Default for DescriptionCallbackOptions {
        fn default() -> Self {
            Self {
                description: JSValue::UNDEFINED,
                callback: JSValue::UNDEFINED,
                options: JSValue::UNDEFINED,
            }
        }
    }

    let items: DescriptionCallbackOptions = match len {
        // description, callback(fn), options(!fn)
        // description, options(!fn), callback(fn)
        Len::Three => {
            if a2.is_function() {
                DescriptionCallbackOptions { description: a1, callback: a2, options: a3 }
            } else {
                DescriptionCallbackOptions { description: a1, callback: a3, options: a2 }
            }
        }
        // callback(fn), options(!fn)
        // description, callback(fn)
        Len::Two => {
            if a1.is_function() && !a2.is_function() {
                DescriptionCallbackOptions { callback: a1, options: a2, ..Default::default() }
            } else {
                DescriptionCallbackOptions { description: a1, callback: a2, ..Default::default() }
            }
        }
        // description
        // callback(fn)
        Len::One => {
            if a1.is_function() {
                DescriptionCallbackOptions { callback: a1, ..Default::default() }
            } else {
                DescriptionCallbackOptions { description: a1, ..Default::default() }
            }
        }
        Len::Zero => DescriptionCallbackOptions::default(),
    };
    let (description, callback, options) = (items.description, items.callback, items.options);

    let result_callback: Option<JSValue> = if cfg.callback != CallbackMode::Require && callback.is_undefined_or_null() {
        None
    } else if callback.is_function() {
        Some(callback.with_async_context_if_needed(global))
    } else {
        let ordinal = if cfg.kind == FunctionKind::Hook { "first" } else { "second" };
        return global.throw(format_args!("{} expects a function as the {} argument", signature, ordinal));
    };

    let mut result = ParseArgumentsResult {
        description: None,
        callback: result_callback,
        options: ParseArgumentsOptions::default(),
    };
    // errdefer result.deinit() — handled by Drop on early return.

    let mut timeout_option: Option<f64> = None;

    if options.is_number() {
        timeout_option = Some(options.as_number());
    } else if options.is_function() {
        return global.throw(format_args!(
            "{}() expects options to be a number or object, not a function",
            signature
        ));
    } else if options.is_object() {
        if let Some(timeout) = options.get(global, "timeout")? {
            if !timeout.is_number() {
                return global.throw_pretty(format_args!("{}() expects timeout to be a number", signature));
            }
            timeout_option = Some(timeout.as_number());
        }
        if let Some(retries) = options.get(global, "retry")? {
            if !retries.is_number() {
                return global.throw_pretty(format_args!("{}() expects retry to be a number", signature));
            }
            // std.math.lossyCast(u32, f64) — Rust `as` saturates on overflow/NaN.
            result.options.retry = Some(retries.as_number() as u32);
        }
        if let Some(repeats) = options.get(global, "repeats")? {
            if !repeats.is_number() {
                return global.throw_pretty(format_args!("{}() expects repeats to be a number", signature));
            }
            if result.options.retry.is_some() && result.options.retry.unwrap() != 0 {
                return global.throw_pretty(format_args!("{}(): Cannot set both retry and repeats", signature));
            }
            result.options.repeats = repeats.as_number() as u32;
        }
    } else if options.is_undefined_or_null() {
        // no options
    } else {
        return global.throw(format_args!(
            "{}() expects a number, object, or undefined as the third argument",
            signature
        ));
    }

    result.description = if description.is_undefined_or_null() {
        None
    } else {
        Some(get_description(global, description, signature)?)
    };

    if result.options.retry.is_none() {
        if let Some(runner) = crate::jest::Jest::runner() {
            result.options.retry = Some(runner.test_options.retry);
        }
    }
    if result.options.retry.unwrap_or(0) != 0 && result.options.repeats != 0 {
        return global.throw_pretty(format_args!("{}(): Cannot set both retry and repeats", signature));
    }

    let default_timeout_ms: Option<u32> = crate::jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_ms != 0 { Some(runner.default_timeout_ms) } else { None }
    });
    let override_timeout_ms: Option<u32> = crate::jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_override != u32::MAX { Some(runner.default_timeout_override) } else { None }
    });
    let timeout_option_ms: Option<u32> = timeout_option.map(|timeout| timeout as u32);
    result.options.timeout = timeout_option_ms.or(override_timeout_ms).or(default_timeout_ms).unwrap_or(0);

    Ok(result)
}

// Codegen bridge — `#[bun_jsc::JsClass]` derive provides `to_js`/`from_js`/`from_js_direct`.
// TODO(port): `js::each_set_cached` is the codegen'd setter for the C++ `m_each` WriteBarrier.
pub use bun_jsc::codegen::JSScopeFunctions as js;

impl fmt::Display for ScopeFunctions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", <&'static str>::from(self.mode))?;
        match self.cfg.self_concurrent {
            SelfConcurrent::Yes => write!(f, ".concurrent")?,
            SelfConcurrent::No => write!(f, ".serial")?,
            SelfConcurrent::Inherit => {}
        }
        if self.cfg.self_mode != SelfMode::Normal {
            write!(f, ".{}", <&'static str>::from(self.cfg.self_mode))?;
        }
        if self.cfg.self_only {
            write!(f, ".only")?;
        }
        if !self.each.is_empty() {
            write!(f, ".each()")?;
        }
        Ok(())
    }
}

impl ScopeFunctions {
    /// `.classes.ts` `finalize: true` — runs on mutator thread during lazy sweep.
    pub extern "C" fn finalize(this: *mut ScopeFunctions) {
        let _g = group_log::begin();
        // SAFETY: `this` was Box::into_raw'd in `create_unbound`; codegen guarantees
        // finalize is called exactly once with that pointer.
        drop(unsafe { Box::from_raw(this) });
    }
}

pub fn create_unbound(global: &JSGlobalObject, mode: Mode, each: JSValue, cfg: BaseScopeCfg) -> JSValue {
    let _g = group_log::begin();

    let scope_functions = Box::into_raw(Box::new(ScopeFunctions { mode, cfg, each }));

    // SAFETY: scope_functions is a valid freshly-allocated *mut ScopeFunctions; codegen
    // takes ownership and pairs with `finalize`.
    let value = unsafe { (*scope_functions).to_js(global) };
    value.ensure_still_alive();
    // Write into the C++ m_each WriteBarrier so GC visits it. The Rust `each` field
    // lives in unmanaged memory that JSC never scans; without this the array can be
    // collected between `.each(arr)` and the trailing `("name", cb)` call.
    if !each.is_empty() {
        js::each_set_cached(value, global, each);
    }
    value
}

pub fn bind(value: JSValue, global: &JSGlobalObject, name: BunString) -> JsResult<JSValue> {
    let call_fn = bun_jsc::JSFunction::create(global, name, call_as_function, 1, Default::default());
    let bound = call_fn.bind(global, value, &name, 1, &[])?;
    bound.set_prototype_direct(value.get_prototype(global), global)?;
    Ok(bound)
}

pub fn create_bound(
    global: &JSGlobalObject,
    mode: Mode,
    each: JSValue,
    cfg: BaseScopeCfg,
    name: BunString,
) -> JsResult<JSValue> {
    let _g = group_log::begin();

    let value = create_unbound(global, mode, each, cfg);
    bind(value, global, name)
}

// TODO(port): these enum types live on `bun_test::BaseScopeCfg` (`self_mode`, `self_concurrent`).
// Re-exported here for readability; Phase B should import from their canonical defs.
use crate::bun_test::{SelfMode, SelfConcurrent};
// TODO(port): `TestReporterKind` is the enum passed to `debugger.test_reporter_agent.report_test_found`.
use bun_jsc::debugger::TestReporterKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/ScopeFunctions.zig (497 lines)
//   confidence: medium
//   todos:      7
//   notes:      .classes.ts payload; allocator params dropped (non-AST); group_log modeled as RAII guard; SelfMode/SelfConcurrent/TestReporterKind/jest::* cross-refs need Phase B wiring; .each args use MarkedArgumentBuffer (new/as_slice/len pending in bun_jsc)
// ──────────────────────────────────────────────────────────────────────────

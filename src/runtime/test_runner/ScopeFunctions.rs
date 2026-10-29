use core::fmt;
use crate::test_runner::expect::JSValueTestExt;

use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult};
use bun_core::{String as BunString, StringView};

use crate::generated_bindgen::jest::js_ScopeFunctions as js;
use crate::generated_bindgen::scope_functions::{
    Bun__ScopeFunctions__callAsFunction, CallbackOrOptions, DescriptionOrCallback,
};
use crate::test_runner::bun_test::{self, BaseScopeCfg, BunTest, DescribeScope};
use crate::test_runner::bun_test::js_fns::Signature;
use crate::test_runner::jest;

// `group_log` wraps `test_runner::debug::group` (a begin/end/log tracer) as an RAII guard
// so call sites read `let _g = group_log::begin();` and drop calls `end()`. The underlying
// `group` module exposes `begin_msg`/`end`/`log` taking `fmt::Arguments`.
//
// The call-site `file:line:col` prefix makes
// each scope traceable in BUN_DEBUG output. `begin()` is `#[track_caller]` and forwards
// `core::panic::Location::caller()` so each call site logs its own source location instead
// of collapsing to a single static string.
mod group_log {
    use crate::test_runner::debug::group;

    #[inline]
    #[track_caller]
    pub(super) fn begin() -> group::GroupGuard {
        let loc = core::panic::Location::caller();
        // `Location` has no `fn_name`, so we emit `file:line:col` which
        // still gives per-call-site identity in the group-log trace.
        group::begin_msg(core::format_args!(
            "\x1b[36m{}\x1b[37m:\x1b[93m{}\x1b[37m:\x1b[33m{}\x1b[m",
            loc.file(),
            loc.line(),
            loc.column(),
        ))
    }
    #[inline]
    pub(super) fn log(args: core::fmt::Arguments<'_>) {
        group::log(args);
    }
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[repr(u8)]
pub enum Mode {
    #[strum(serialize = "describe")]
    Describe,
    #[strum(serialize = "test")]
    Test,
}

// Every JS-exposed method takes `&self`. All three
// fields are written exactly once in `create_unbound` and never mutated again,
// so no `Cell`/`JsCell` wrapping is needed — the type is read-only after
// construction. `generic_if`/`generic_extend`/`each`/`call_as_function` all
// re-enter JS (create_bound → to_js / JSFunction::create / bind), which can
// form fresh `&ScopeFunctions` to the same wrapper; aliased `&Self` is sound,
// aliased `&mut Self` would not be.
pub(crate) struct ScopeFunctions {
    pub(crate) mode: Mode,
    pub(crate) cfg: BaseScopeCfg,
    /// typically `.zero`. not Strong.Optional because codegen visits the C++ `m_each`
    /// WriteBarrier on the JS wrapper (see `internalFields: ["each"]` in jest.bind.ts). This
    /// field is kept in sync with that slot via `js::each_set_cached` in `create_unbound`.
    pub(crate) each: JSValue,
}

impl ScopeFunctions {
    pub(crate) fn get_skip(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"get .skip", "skip")
    }
    pub(crate) fn get_todo(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"get .todo", "todo")
    }
    pub(crate) fn get_failing(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"get .failing", "failing")
    }
    pub(crate) fn get_concurrent(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"get .concurrent", "concurrent")
    }
    pub(crate) fn get_serial(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .serial", "serial")
    }
    pub(crate) fn get_only(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_only: true, ..Default::default() }, b"get .only", "only")
    }
    pub(crate) fn r#if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .if()", true, "if")
    }
    pub(crate) fn skip_if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .skipIf()", false, "skipIf")
    }
    pub(crate) fn todo_if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"call .todoIf()", false, "todoIf")
    }
    pub(crate) fn failing_if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"call .failingIf()", false, "failingIf")
    }
    pub(crate) fn concurrent_if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"call .concurrentIf()", false, "concurrentIf")
    }
    pub(crate) fn serial_if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"call .serialIf()", false, "serialIf")
    }
    pub(crate) fn each(&self, cx: &mut JsScope<'_>, table: JsLocal<'_>) -> JsResult<JSValue> {
        let _g = group_log::begin();

        let global = cx.global();
        let array = table.to_js();
        if array.is_undefined_or_null() || !array.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return Err(global.throw(format_args!("Expected array, got {}", array.to_fmt(&mut formatter))));
        }

        if !self.each.is_empty() {
            return Err(global.throw(format_args!("Cannot {} on {}", "each", self)));
        }
        create_bound(global, self.mode, array, self.cfg, "each")
    }
}

pub(crate) fn call_as_function<'a>(
    cx: &mut JsScope<'a>,
    this_value: JsLocal<'a>,
    first: DescriptionOrCallback<'a>,
    second: CallbackOrOptions<'a>,
    third: CallbackOrOptions<'a>,
) -> JsResult<()> {
    let _g = group_log::begin();

    let global = cx.global();
    let Some(this) = this_value.to_js().as_class_ref::<ScopeFunctions>() else {
        return Err(global.throw(format_args!("Expected callee to be ScopeFunctions")));
    };
    let line_no = jest::capture_test_line_number(global);

    let buntest_strong = bun_test::js_fns::clone_active_strong(global, Signature::ScopeFunctions(this))?;
    let bun_test_ptr = buntest_strong.get();

    let callback_mode: CallbackMode = match this.cfg.self_mode {
        SelfMode::Skip | SelfMode::Todo => CallbackMode::Allow,
        _ => CallbackMode::Require,
    };

    let args = parse_arguments(
        global,
        first,
        second,
        third,
        Signature::ScopeFunctions(this),
        ParseArgumentsCfg { callback: callback_mode, kind: FunctionKind::TestOrDescribe },
    )?;

    let callback_length: usize = if let Some(callback) = args.callback {
        callback.get_length(global)? as usize
    } else {
        0
    };

    if !this.each.is_empty() {
        if this.each.is_undefined_or_null() || !this.each.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return Err(global.throw(format_args!("Expected array, got {}", this.each.to_fmt(&mut formatter))));
        }
        let mut iter = this.each.array_iterator(global)?;
        let mut test_idx: usize = 0;
        while let Some(item) = iter.next()? {
            if item.is_empty() {
                break;
            }

            // Root the gathered args for the GC across the `format_label`/`bind`
            // allocations below. `MarkedArgumentBuffer` stack-roots every appended
            // value for the duration of the closure; the plain `Vec<JSValue>`
            // mirrors it because `format_label`/`bind` need a slice view (the
            // buffer exposes no `as_slice`/`len`).
            bun_jsc::MarkedArgumentBuffer::new(|rooted| -> JsResult<()> {
                rooted.append(item);
                let mut args_list: Vec<JSValue> = Vec::new();

                if item.is_array() {
                    // Spread array as args_list (matching Jest & Vitest)
                    let mut item_iter = item.array_iterator(global)?;
                    while let Some(array_item) = item_iter.next()? {
                        rooted.append(array_item);
                        args_list.push(array_item);
                    }
                } else {
                    args_list.push(item);
                }

                let formatted_label: Option<Vec<u8>> = if let Some(desc) = args.description.as_deref() {
                    Some(jest::format_label(global, desc, args_list.as_slice(), test_idx)?.into_vec())
                } else {
                    None
                };

                let bound = if let Some(cb) = args.callback {
                    Some(JSValueTestExt::bind(cb, global, item, &BunString::static_("cb"), 0.0, args_list.as_slice())?)
                } else {
                    None
                };
                this.enqueue_describe_or_test_callback(
                    // Explicit reborrow: the closure must not move the `&mut`
                    // (it is reused on later loop iterations).
                    &mut *bun_test_ptr,
                    global,
                    bound,
                    formatted_label.as_deref(),
                    &args.options,
                    callback_length.saturating_sub(args_list.len()),
                    line_no,
                )
            })?;

            test_idx += 1;
        }
    } else {
        this.enqueue_describe_or_test_callback(
            bun_test_ptr,
            global,
            args.callback,
            args.description.as_deref(),
            &args.options,
            callback_length,
            line_no,
        )?;
    }

    Ok(())
}

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
        // shrink via `take` + reslice (borrowck-friendly).
        let buf = core::mem::take(&mut self.buf);
        self.buf = &mut buf[..dst_start];
    }
}

fn filter_names<R: WriteEnd>(rem: &mut R, description: Option<&[u8]>, parent_in: Option<&DescribeScope>) {
    const SEP: &[u8] = b" ";
    rem.write_end(description.unwrap_or(b""));
    let mut parent = parent_in;
    while let Some(scope) = parent {
        // PORTING.md: `BaseScope.parent` is `Option<*const DescribeScope>` (raw backref);
        // per-use reborrow.
        // SAFETY: parent backrefs are stable for the lifetime of the collection tree.
        parent = scope.base.parent.map(|p| unsafe { &*p });
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
                return Err(global.throw(format_args!(
                    "Cannot call {}() inside a test. Call it inside describe() instead.",
                    self
                )));
            }
            bun_test::Phase::Done => {
                return Err(global.throw(format_args!(
                    "Cannot call {}() after the test run has completed",
                    self
                )));
            }
        }

        // handle test reporter agent for debugger
        let vm = global.bun_vm().as_mut();
        let mut test_id_for_debugger: i32 = 0;
        if let Some(debugger) = (*vm).debugger.as_mut() {
            if debugger.test_reporter_agent.is_enabled() {
                debugger.test_reporter_agent.next_test_id += 1;
                let id = debugger.test_reporter_agent.next_test_id;
                let name = StringView::from_bytes(description.unwrap_or(b"(unnamed)"));
                let parent: &DescribeScope = bun_test.collection.active_scope();
                let parent_id = if parent.base.test_id_for_debugger != 0 {
                    parent.base.test_id_for_debugger
                } else {
                    -1
                };
                debugger.test_reporter_agent.report_test_found(
                    id,
                    &name,
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
            || jest::Jest::runner().is_some_and(|r| r.concurrent)
        {
            // Only set to concurrent if still inheriting
            if base.self_concurrent == SelfConcurrent::Inherit {
                base.self_concurrent = SelfConcurrent::Yes;
            }
        }

        match self.mode {
            Mode::Describe => {
                // SAFETY: active_scope is a valid cursor into root_scope's tree for the lifetime of Collection.
                let new_scope = unsafe { bun_test.collection.active_scope.as_mut() }.append_describe(description, base);
                bun_test.collection.enqueue_describe_callback(new_scope, callback)?;
            }
            Mode::Test => {
                // check for filter match
                let mut matches_filter = true;
                if let Some(reporter) = bun_test.reporter {
                    // SAFETY: reporter outlives every BunTest (owned by test_command::exec).
                    let reporter = unsafe { reporter.as_ref() };
                    if let Some(filter_regex) = reporter.jest.filter_regex {
                        group_log::log(format_args!("matches_filter begin"));
                        debug_assert!(bun_test.collection.filter_buffer.is_empty());
                        // reshaped for borrowck — clear at end via explicit call below.

                        // SAFETY: active_scope is a valid cursor into root_scope's tree for the lifetime of Collection.
                        let active_scope: &DescribeScope = unsafe { bun_test.collection.active_scope.as_ref() };

                        let mut len = Measure { len: 0 };
                        filter_names(&mut len, description, Some(active_scope));
                        // Extend by `len.len` zero bytes and
                        // hand back the freshly-appended tail as `&mut [u8]`.
                        let start = bun_test.collection.filter_buffer.len();
                        bun_test.collection.filter_buffer.resize(start + len.len, 0);
                        let slice: &mut [u8] = &mut bun_test.collection.filter_buffer[start..];
                        let mut rem = Write { buf: slice };
                        filter_names(&mut rem, description, Some(active_scope));
                        debug_assert!(rem.buf.is_empty());

                        let str = StringView::from_bytes(bun_test.collection.filter_buffer.as_slice());
                        group_log::log(format_args!(
                            "matches_filter \"{}\"",
                            bstr::BStr::new(bun_test.collection.filter_buffer.as_slice())
                        ));
                        matches_filter = filter_regex.matches(&str);

                        bun_test.collection.filter_buffer.clear();
                    }
                }

                if !matches_filter {
                    base.self_mode = SelfMode::FilteredOut;
                }

                debug_assert!(!bun_test.collection.locked);
                group_log::log(format_args!(
                    "enqueueTestCallback / {} / in scope: {}",
                    bstr::BStr::new(description.unwrap_or(b"(unnamed)")),
                    bstr::BStr::new(bun_test.collection.active_scope().base.name.as_deref().unwrap_or(b"(unnamed)"))
                ));

                let _ = bun_test.collection.active_scope_mut().append_test(
                    description,
                    if matches_filter { callback } else { None },
                    bun_test::ExecutionEntryCfg {
                        has_done_parameter,
                        timeout: options.timeout,
                        retry_count: options.retry.unwrap_or(0),
                        repeat_count: options.repeats,
                    },
                    base,
                    bun_test::AddedInPhase::Collection,
                )?;
            }
        }
        Ok(())
    }

    fn generic_if(
        &self,
        global: &JSGlobalObject,
        condition: bool,
        conditional_cfg: BaseScopeCfg,
        name: &[u8],
        invert: bool,
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        if condition != invert {
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
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        if cfg.self_mode == SelfMode::Failing && self.mode == Mode::Describe {
            return Err(global.throw(format_args!("Cannot {} on {}", bstr::BStr::new(name), self)));
        }
        if cfg.self_only {
            error_in_ci(global, b".only")?;
        }
        let Some(extended) = self.cfg.extend(cfg) else {
            return Err(global.throw(format_args!("Cannot {} on {}", bstr::BStr::new(name), self)));
        };
        create_bound(global, self.mode, self.each, extended, fn_name)
    }
}

fn error_in_ci(global: &JSGlobalObject, signature: &[u8]) -> JsResult<()> {
    if bun_core::ci_info::is_ci() {
        return Err(global.throw(format_args!(
            "{} is disabled in CI environments to prevent accidentally skipping tests. To override, set the environment variable CI=false.",
            bstr::BStr::new(signature)
        )));
    }
    Ok(())
}

pub(crate) struct ParseArgumentsResult {
    pub(crate) description: Option<Vec<u8>>,
    pub callback: Option<JSValue>,
    pub(crate) options: ParseArgumentsOptions,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct ParseArgumentsOptions {
    pub(crate) timeout: u32,
    pub(crate) retry: Option<u32>,
    pub(crate) repeats: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum CallbackMode {
    Require,
    Allow,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum FunctionKind {
    TestOrDescribe,
    Hook,
}

#[derive(Copy, Clone)]
pub(crate) struct ParseArgumentsCfg {
    pub callback: CallbackMode,
    pub(crate) kind: FunctionKind,
}

/// What a test is called that is named after a class or a function.
fn name_of_callable(
    global: &JSGlobalObject,
    callable: JsLocal<'_, Callable>,
    signature: Signature,
) -> JsResult<Vec<u8>> {
    let callable = callable.to_js();
    if callable.is_class(global) {
        let class_name = callable.get_class_name(global)?;

        if !class_name.is_empty() {
            return Ok(class_name.to_owned_slice());
        }

        return Ok(callable.get_name(global)?.to_owned_slice());
    }

    let name = callable.get_name(global)?;
    if name.length() > 0 {
        return Ok(name.to_owned_slice());
    }

    Err(global.throw(format_args!(
        "{}() expects first argument to be a named class, named function, number, or string",
        signature
    )))
}

pub(crate) fn parse_arguments<'a>(
    global: &JSGlobalObject,
    first: DescriptionOrCallback<'a>,
    second: CallbackOrOptions<'a>,
    third: CallbackOrOptions<'a>,
    signature: Signature,
    cfg: ParseArgumentsCfg,
) -> JsResult<ParseArgumentsResult> {
    let (description, callback, options) = match (first, second, third) {
        // callback
        // callback, options
        (
            DescriptionOrCallback::Function(callback),
            options @ (CallbackOrOptions::None | CallbackOrOptions::Timeout(_) | CallbackOrOptions::Options(_)),
            CallbackOrOptions::None,
        ) => (DescriptionOrCallback::None, CallbackOrOptions::Callback(callback), options),
        // description
        // description, callback
        // description, callback, options
        (description, callback @ CallbackOrOptions::Callback(_), options)
        | (description, callback, options @ CallbackOrOptions::None) => (description, callback, options),
        // description, options, callback
        (description, options, callback) => (description, callback, options),
    };

    let result_callback: Option<JSValue> = match callback {
        CallbackOrOptions::Callback(callback) => Some(callback.to_js().with_async_context_if_needed(global)),
        CallbackOrOptions::None if cfg.callback != CallbackMode::Require => None,
        _ => {
            let ordinal = if cfg.kind == FunctionKind::Hook { "first" } else { "second" };
            return Err(global.throw(format_args!("{} expects a function as the {} argument", signature, ordinal)));
        }
    };

    let mut result = ParseArgumentsResult {
        description: None,
        callback: result_callback,
        options: ParseArgumentsOptions::default(),
    };

    let mut timeout_option: Option<f64> = None;

    match options {
        CallbackOrOptions::None => {}
        CallbackOrOptions::Timeout(timeout) => timeout_option = Some(timeout),
        CallbackOrOptions::Callback(_) => {
            return Err(global.throw(format_args!(
                "{}() expects options to be a number or object, not a function",
                signature
            )));
        }
        CallbackOrOptions::Options(options) => {
            timeout_option = options.timeout;
            // Lossy cast: Rust `as` saturates on overflow/NaN.
            result.options.retry = options.retry.map(|retry| retry as u32);
            if let Some(repeats) = options.repeats {
                if result.options.retry.is_some() && result.options.retry.unwrap() != 0 {
                    return Err(global.throw(format_args!("{}(): Cannot set both retry and repeats", signature)));
                }
                result.options.repeats = repeats as u32;
            }
        }
    }

    result.description = match description {
        DescriptionOrCallback::None => None,
        DescriptionOrCallback::Function(callable) => Some(name_of_callable(global, callable, signature)?),
        DescriptionOrCallback::Text(text) => Some(text.into_vec()),
        DescriptionOrCallback::Number(number) => Some(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], number).to_vec()),
    };

    if result.options.retry.is_none() {
        if let Some(runner) = jest::Jest::runner() {
            result.options.retry = Some(runner.test_options.retry);
        }
    }
    if result.options.retry.unwrap_or(0) != 0 && result.options.repeats != 0 {
        return Err(global.throw(format_args!("{}(): Cannot set both retry and repeats", signature)));
    }

    let default_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_ms != 0 { Some(runner.default_timeout_ms) } else { None }
    });
    let override_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_override != u32::MAX { Some(runner.default_timeout_override) } else { None }
    });
    let timeout_option_ms: Option<u32> = timeout_option.map(|timeout| timeout as u32);
    result.options.timeout = timeout_option_ms.or(override_timeout_ms).or(default_timeout_ms).unwrap_or(0);

    Ok(result)
}

impl fmt::Display for ScopeFunctions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", <&'static str>::from(self.mode))?;
        match self.cfg.self_concurrent {
            SelfConcurrent::Yes => write!(f, ".concurrent")?,
            SelfConcurrent::No => write!(f, ".serial")?,
            SelfConcurrent::Inherit => {}
        }
        if self.cfg.self_mode != SelfMode::Normal {
            write!(f, ".{}", self.cfg.self_mode.tag_name())?;
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

impl Drop for ScopeFunctions {
    fn drop(&mut self) {
        let _g = group_log::begin();
    }
}

fn create_unbound(global: &JSGlobalObject, mode: Mode, each: JSValue, cfg: BaseScopeCfg) -> JSValue {
    let _g = group_log::begin();

    let value = ScopeFunctions { mode, cfg, each }.to_js(global);
    value.ensure_still_alive();
    // Write into the C++ m_each WriteBarrier so GC visits it. The Rust `each` field
    // lives in the payload, which JSC never scans; without this the array can be
    // collected between `.each(arr)` and the trailing `("name", cb)` call.
    if !each.is_empty() {
        js::each_set_cached(value, global, each);
    }
    value
}

fn bind(value: JSValue, global: &JSGlobalObject, name: &'static str) -> JsResult<JSValue> {
    let call_fn = bun_jsc::JSFunction::create(global, name, Bun__ScopeFunctions__callAsFunction, 1, Default::default());
    let bound = JSValueTestExt::bind(call_fn, global, value, &BunString::static_(name), 1.0, &[])?;
    set_prototype_direct(bound, value.get_prototype(global)?, global)?;
    Ok(bound)
}

/// Local shim for `JSValue::setPrototypeDirect` (not yet on `bun_jsc::JSValue`).
/// The C++ `Bun__JSValue__setPrototypeDirect` is `[[ZIG_EXPORT(check_slow)]]`,
/// so we manually surface any pending exception as `JsError::Thrown`.
#[track_caller]
fn set_prototype_direct(value: JSValue, prototype: JSValue, global: &JSGlobalObject) -> JsResult<()> {
    // `[[ZIG_EXPORT(check_slow)]]`. C++ side reads `value.getObject()` so
    // `value` must be an object (always a JSBoundFunction here).
    bun_jsc::cpp::Bun__JSValue__setPrototypeDirect(value, prototype, global)
}

pub(crate) fn create_bound(
    global: &JSGlobalObject,
    mode: Mode,
    each: JSValue,
    cfg: BaseScopeCfg,
    name: &'static str,
) -> JsResult<JSValue> {
    let _g = group_log::begin();

    let value = create_unbound(global, mode, each, cfg);
    bind(value, global, name)
}

// These enum types live on `bun_test::BaseScopeCfg` (`self_mode`, `self_concurrent`).
// bun_test.rs names them `ScopeMode`/`ConcurrentMode`; alias here for brevity.
use crate::test_runner::bun_test::{ScopeMode as SelfMode, ConcurrentMode as SelfConcurrent};
// `TestReporterKind` in the spec is `bun_jsc::debugger::TestType` (Test/Describe).
use bun_jsc::debugger::TestType as TestReporterKind;

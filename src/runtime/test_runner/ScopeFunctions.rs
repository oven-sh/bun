use core::fmt;
#[allow(unused_imports)] use crate::test_runner::expect::{JSValueTestExt, JSGlobalObjectTestExt, make_formatter};
use core::sync::atomic::{AtomicI32, Ordering};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass, JsResult};
#[allow(unused_imports)] use bun_jsc::{MarkedArgumentBuffer, VirtualMachine};
use bun_core::String as BunString;

use crate::test_runner::bun_test::{self, BaseScopeCfg, BunTest, DescribeScope};
use crate::test_runner::bun_test::js_fns::{Signature, GetActiveCfg};
use crate::test_runner::jest;

// `group_log` wraps `test_runner::debug::group` (a begin/end/log tracer) as an RAII guard
// so call sites read `let _g = group_log::begin();` and drop calls `end()`. The underlying
// `group` module exposes `begin_msg`/`end`/`log` taking `fmt::Arguments`.
//
// Zig `groupLog.begin(@src())` (debug.zig) emits the call-site `file:line:col: fn_name` so
// each scope is traceable in BUN_DEBUG output. `begin()` is `#[track_caller]` and forwards
// `core::panic::Location::caller()` so each call site logs its own source location instead
// of collapsing to a single static string.
mod group_log {
    use crate::test_runner::debug::group;

    #[inline]
    #[track_caller]
    pub fn begin() -> group::GroupGuard {
        let loc = core::panic::Location::caller();
        // Mirrors Zig `group.begin(@src())` → `"<file>:<line>:<col>: <fn_name>"` (ANSI-coloured
        // in debug.zig). Rust's `Location` has no `fn_name`, so we emit `file:line:col` which
        // still gives per-call-site identity in the group-log trace.
        group::begin_msg(core::format_args!(
            "\x1b[36m{}\x1b[37m:\x1b[93m{}\x1b[37m:\x1b[33m{}\x1b[m",
            loc.file(),
            loc.line(),
            loc.column(),
        ))
    }
    #[inline]
    pub fn log(args: core::fmt::Arguments<'_>) {
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

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. All three
// fields are written exactly once in `create_unbound` and never mutated again,
// so no `Cell`/`JsCell` wrapping is needed — the type is read-only after
// construction. `generic_if`/`generic_extend`/`fn_each`/`call_as_function` all
// re-enter JS (create_bound → to_js / JSFunction::create / bind), which can
// form fresh `&ScopeFunctions` to the same wrapper; aliased `&Self` is sound,
// aliased `&mut Self` would not be.
#[bun_jsc::JsClass(no_constructor)]
pub struct ScopeFunctions {
    pub mode: Mode,
    pub cfg: BaseScopeCfg,
    /// typically `.zero`. not Strong.Optional because codegen visits the C++ `m_each`
    /// WriteBarrier on the JS wrapper (see `values: ["each"]` in jest.classes.ts). This
    /// field is kept in sync with that slot via `js::each_set_cached` in `create_unbound`.
    pub each: JSValue,
}

pub mod strings {
    use bun_core::String as BunString;
    // TODO(port): `bun.String.static("...")` — assumes a const-capable `BunString::static_str`.
    #[allow(non_snake_case)] #[inline] pub fn DESCRIBE() -> BunString { BunString::static_str("describe") }
    #[allow(non_snake_case)] #[inline] pub fn XDESCRIBE() -> BunString { BunString::static_str("xdescribe") }
    #[allow(non_snake_case)] #[inline] pub fn TEST() -> BunString { BunString::static_str("test") }
    #[allow(non_snake_case)] #[inline] pub fn XTEST() -> BunString { BunString::static_str("xtest") }
    #[allow(non_snake_case)] #[inline] pub fn SKIP() -> BunString { BunString::static_str("skip") }
    #[allow(non_snake_case)] #[inline] pub fn TODO() -> BunString { BunString::static_str("todo") }
    #[allow(non_snake_case)] #[inline] pub fn FAILING() -> BunString { BunString::static_str("failing") }
    #[allow(non_snake_case)] #[inline] pub fn CONCURRENT() -> BunString { BunString::static_str("concurrent") }
    #[allow(non_snake_case)] #[inline] pub fn SERIAL() -> BunString { BunString::static_str("serial") }
    #[allow(non_snake_case)] #[inline] pub fn ONLY() -> BunString { BunString::static_str("only") }
    #[allow(non_snake_case)] #[inline] pub fn IF() -> BunString { BunString::static_str("if") }
    #[allow(non_snake_case)] #[inline] pub fn SKIP_IF() -> BunString { BunString::static_str("skipIf") }
    #[allow(non_snake_case)] #[inline] pub fn TODO_IF() -> BunString { BunString::static_str("todoIf") }
    #[allow(non_snake_case)] #[inline] pub fn FAILING_IF() -> BunString { BunString::static_str("failingIf") }
    #[allow(non_snake_case)] #[inline] pub fn CONCURRENT_IF() -> BunString { BunString::static_str("concurrentIf") }
    #[allow(non_snake_case)] #[inline] pub fn SERIAL_IF() -> BunString { BunString::static_str("serialIf") }
    #[allow(non_snake_case)] #[inline] pub fn EACH() -> BunString { BunString::static_str("each") }
}

impl ScopeFunctions {
    #[bun_jsc::host_fn(getter)]
    pub fn get_skip(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"get .skip", strings::SKIP())
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_todo(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"get .todo", strings::TODO())
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_failing(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"get .failing", strings::FAILING())
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_concurrent(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"get .concurrent", strings::CONCURRENT())
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_serial(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .serial", strings::SERIAL())
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_only(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_only: true, ..Default::default() }, b"get .only", strings::ONLY())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .if()", true, strings::IF())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_skip_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .skipIf()", false, strings::SKIP_IF())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_todo_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"call .todoIf()", false, strings::TODO_IF())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_failing_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"call .failingIf()", false, strings::FAILING_IF())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_concurrent_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"call .concurrentIf()", false, strings::CONCURRENT_IF())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_serial_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"call .serialIf()", false, strings::SERIAL_IF())
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_each(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let _g = group_log::begin();

        let [array] = frame.arguments_as_array::<1>();
        if array.is_undefined_or_null() || !array.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return Err(global.throw(format_args!("Expected array, got {}", array.to_fmt(&mut formatter))));
        }

        if !this.each.is_empty() {
            return Err(global.throw(format_args!("Cannot {} on {}", "each", this)));
        }
        create_bound(global, this.mode, array, this.cfg, strings::EACH())
    }
}

#[bun_jsc::host_fn]
pub fn call_as_function(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let _g = group_log::begin();

    let Some(this_ptr) = ScopeFunctions::from_js(frame.this()) else {
        return Err(global.throw(format_args!("Expected callee to be ScopeFunctions")));
    };
    // SAFETY: `from_js` returned non-null; the JS wrapper keeps the boxed
    // ScopeFunctions alive for the duration of this call (we hold `frame.this()`).
    // R-2: deref as shared (`&*const`) — every field is read-only after
    // `create_unbound`, and the body re-enters JS (get_length / array_iterator /
    // bind / enqueue) which can form fresh `&ScopeFunctions` to the same object.
    let this: &ScopeFunctions = unsafe { &*this_ptr.cast_const() };
    let line_no = jest::capture_test_line_number(frame, global);

    let buntest_strong = bun_test::js_fns::clone_active_strong(
        global,
        &GetActiveCfg {
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

            // PORT NOTE: Zig keeps a parallel `ArrayList(Strong)` to root each element across
            // the format_label/bind allocations below. `bun_jsc::MarkedArgumentBuffer` only
            // exposes a scoped-closure constructor (no `as_slice`/`len`), so for Phase D we
            // use a plain `Vec<JSValue>` mirroring Zig's `args_list_raw`. The outer `iter`
            // keeps `this.each` alive; per-element rooting is a TODO once Strong<JSValue>
            // lands in bun_jsc.
            // TODO(port): root args via Strong / MarkedArgumentBuffer once upstream surface exists.
            let mut args_list: Vec<JSValue> = Vec::new();

            if item.is_array() {
                // Spread array as args_list (matching Jest & Vitest)
                let mut item_iter = item.array_iterator(global)?;
                let mut idx: usize = 0;
                while let Some(array_item) = item_iter.next()? {
                    args_list.push(array_item);
                    idx += 1;
                }
                let _ = idx;
            } else {
                args_list.push(item);
            }

            let formatted_label: Option<Vec<u8>> = if let Some(desc) = args.description.as_deref() {
                Some(jest::format_label(global, desc, args_list.as_slice(), test_idx)?.into_vec())
            } else {
                None
            };

            let bound = if let Some(cb) = args.callback {
                Some(JSValueTestExt::bind(cb, global, item, &BunString::static_str("cb"), 0.0, args_list.as_slice())?)
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
        // SAFETY: `bun_vm()` returns a non-null `*mut VirtualMachine` for any
        // Bun-owned global; single JS thread so no aliasing across this borrow.
        if let Some(debugger) = unsafe { (*vm).debugger.as_mut() } {
            if debugger.test_reporter_agent.is_enabled() {
                // Zig: fn-local `struct { var max_test_id_for_debugger: i32 = 0; }` — process-global static.
                static MAX_TEST_ID_FOR_DEBUGGER: AtomicI32 = AtomicI32::new(0);
                // TODO(port): Zig used non-atomic `+= 1` (single JS thread). Relaxed fetch_add preserves semantics.
                let id = MAX_TEST_ID_FOR_DEBUGGER.fetch_add(1, Ordering::Relaxed) + 1;
                let mut name = BunString::init(description.unwrap_or(b"(unnamed)"));
                let parent: &DescribeScope = bun_test.collection.active_scope();
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
            || jest::Jest::runner().map_or(false, |r| r.concurrent)
        {
            // Only set to concurrent if still inheriting
            if base.self_concurrent == SelfConcurrent::Inherit {
                base.self_concurrent = SelfConcurrent::Yes;
            }
        }

        match self.mode {
            Mode::Describe => {
                // SAFETY: active_scope is a valid cursor into root_scope's tree for the lifetime of Collection.
                let new_scope = unsafe { bun_test.collection.active_scope.as_mut() }.append_describe(description, base)?;
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
                        // PORT NOTE: reshaped for borrowck — clear at end via explicit call below.

                        // SAFETY: active_scope is a valid cursor into root_scope's tree for the lifetime of Collection.
                        let active_scope: &DescribeScope = unsafe { bun_test.collection.active_scope.as_ref() };

                        let mut len = Measure { len: 0 };
                        filter_names(&mut len, description, Some(active_scope));
                        // PORT NOTE: Zig `addManyAsSlice` — extend by `len.len` zero bytes and
                        // hand back the freshly-appended tail as `&mut [u8]`.
                        let start = bun_test.collection.filter_buffer.len();
                        bun_test.collection.filter_buffer.resize(start + len.len, 0);
                        let slice: &mut [u8] = &mut bun_test.collection.filter_buffer[start..];
                        let mut rem = Write { buf: slice };
                        filter_names(&mut rem, description, Some(active_scope));
                        debug_assert!(rem.buf.is_empty());

                        let str = BunString::from_bytes(bun_test.collection.filter_buffer.as_slice());
                        group_log::log(format_args!(
                            "matches_filter \"{}\"",
                            bstr::BStr::new(bun_test.collection.filter_buffer.as_slice())
                        ));
                        // SAFETY: `filter_regex` is the FFI-allocated Yarr handle stored in
                        // `TestRunner` for the process lifetime; single-threaded here so the
                        // exclusive borrow is unaliased.
                        matches_filter = unsafe { &mut *filter_regex.as_ptr() }.matches(str);

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
        frame: &CallFrame,
        conditional_cfg: BaseScopeCfg,
        name: &[u8],
        invert: bool,
        fn_name: BunString,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        let [condition] = frame.arguments_as_array::<1>();
        if frame.arguments().len() == 0 {
            return Err(global.throw(format_args!("Expected condition to be a boolean")));
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
    if crate::cli::ci_info::is_ci() {
        return Err(global.throw(format_args!(
            "{} is disabled in CI environments to prevent accidentally skipping tests. To override, set the environment variable CI=false.",
            bstr::BStr::new(signature)
        )));
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
        // PORT NOTE: upstream `JSValue::get_class_name` writes into an out-param
        // ZigString instead of returning one (unlike Zig's `className` which
        // returns by value). Adapt locally rather than touching bun_jsc.
        let mut description_class_name = bun_core::ZigString::EMPTY;
        description.get_class_name(global, &mut description_class_name)?;

        if description_class_name.len > 0 {
            return Ok(description_class_name.to_owned_slice());
        }

        let description_name = description.get_name(global)?;
        // `description_name.deref()` handled by Drop on bun_core::String
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
        return Ok(slice.into_vec());
    }

    Err(global.throw(format_args!(
        "{}() expects first argument to be a named class, named function, number, or string",
        signature
    )))
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
        return Err(global.throw(format_args!("{} expects a function as the {} argument", signature, ordinal)));
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
        return Err(global.throw(format_args!(
            "{}() expects options to be a number or object, not a function",
            signature
        )));
    } else if options.is_object() {
        if let Some(timeout) = options.get(global, "timeout")? {
            if !timeout.is_number() {
                return Err(global.throw(format_args!("{}() expects timeout to be a number", signature)));
            }
            timeout_option = Some(timeout.as_number());
        }
        if let Some(retries) = options.get(global, "retry")? {
            if !retries.is_number() {
                return Err(global.throw(format_args!("{}() expects retry to be a number", signature)));
            }
            // std.math.lossyCast(u32, f64) — Rust `as` saturates on overflow/NaN.
            result.options.retry = Some(retries.as_number() as u32);
        }
        if let Some(repeats) = options.get(global, "repeats")? {
            if !repeats.is_number() {
                return Err(global.throw(format_args!("{}() expects repeats to be a number", signature)));
            }
            if result.options.retry.is_some() && result.options.retry.unwrap() != 0 {
                return Err(global.throw(format_args!("{}(): Cannot set both retry and repeats", signature)));
            }
            result.options.repeats = repeats.as_number() as u32;
        }
    } else if options.is_undefined_or_null() {
        // no options
    } else {
        return Err(global.throw(format_args!(
            "{}() expects a number, object, or undefined as the third argument",
            signature
        )));
    }

    result.description = if description.is_undefined_or_null() {
        None
    } else {
        Some(get_description(global, description, signature)?)
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

// Codegen bridge — `#[bun_jsc::JsClass]` derive provides `to_js`/`from_js`/`from_js_direct`.
// `js::each_set_cached` is the codegen'd setter for the C++ `m_each` WriteBarrier
// (see jest.classes.ts `values: ["each"]`).
//
// Hand-expansion of what `src/codegen/generate-classes.ts` emits into
// `ZigGeneratedClasses.zig` for `pub const JSScopeFunctions = struct { ... }`:
// `eachSetCached` / `eachGetCached` thin-wrap the C++-side
// `ScopeFunctionsPrototype__each{Set,Get}CachedValue` shims, which write/read the
// `JSC::WriteBarrier<Unknown> m_each` slot on the JSCell wrapper so the GC visits
// the `.each(arr)` argument between construction and the trailing `("name", cb)` call.
pub mod js {
    bun_jsc::codegen_cached_accessors!("ScopeFunctions"; each);
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
            write!(f, ".{}", scope_mode_str(self.cfg.self_mode))?;
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
    pub fn finalize(self: Box<Self>) {
        let _g = group_log::begin();
        drop(self);
    }
}

pub fn create_unbound(global: &JSGlobalObject, mode: Mode, each: JSValue, cfg: BaseScopeCfg) -> JSValue {
    let _g = group_log::begin();

    // `JsClass::to_js` boxes `self` and hands the raw pointer to the C++
    // wrapper (m_ctx); freed in `finalize`.
    let value = ScopeFunctions { mode, cfg, each }.to_js(global);
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
    // `#[bun_jsc::host_fn]` on `call_as_function` emits the C-ABI thunk
    // `__jsc_host_call_as_function`; `JSFunction::create` wants the raw
    // `JSHostFn` shape, not the safe Rust signature.
    let call_fn = bun_jsc::JSFunction::create(global, name.clone(), __jsc_host_call_as_function, 1, Default::default());
    let bound = JSValueTestExt::bind(call_fn, global, value, &name, 1.0, &[])?;
    set_prototype_direct(bound, value.get_prototype(global), global)?;
    Ok(bound)
}

/// Local shim for `JSValue::setPrototypeDirect` (not yet on `bun_jsc::JSValue`).
/// Mirrors Zig `bun.cpp.Bun__JSValue__setPrototypeDirect` — `[[ZIG_EXPORT(check_slow)]]`,
/// so we manually surface any pending exception as `JsError::Thrown`.
// TODO(port): land as inherent `JSValue::set_prototype_direct` in bun_jsc.
#[track_caller]
fn set_prototype_direct(value: JSValue, prototype: JSValue, global: &JSGlobalObject) -> JsResult<()> {
    // `[[ZIG_EXPORT(check_slow)]]`. C++ side reads `value.getObject()` so
    // `value` must be an object (always a JSBoundFunction here).
    bun_jsc::cpp::Bun__JSValue__setPrototypeDirect(value, prototype, global)
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

// These enum types live on `bun_test::BaseScopeCfg` (`self_mode`, `self_concurrent`).
// The Zig spec named them `SelfMode`/`SelfConcurrent`; bun_test.rs ported them as
// `ScopeMode`/`ConcurrentMode`. Alias here so the bodies read like the spec.
use crate::test_runner::bun_test::{ScopeMode as SelfMode, ConcurrentMode as SelfConcurrent};
// `TestReporterKind` in the spec is `bun_jsc::debugger::TestType` (Test/Describe).
use bun_jsc::debugger::TestType as TestReporterKind;

/// Local stringifier for `ScopeMode` — sibling `bun_test.rs` does not derive
/// `IntoStaticStr` on it, so we can't use `<&'static str>::from`.
fn scope_mode_str(m: SelfMode) -> &'static str {
    match m {
        SelfMode::Normal => "normal",
        SelfMode::Skip => "skip",
        SelfMode::Todo => "todo",
        SelfMode::Failing => "failing",
        SelfMode::FilteredOut => "filtered_out",
    }
}

// ported from: src/test_runner/ScopeFunctions.zig

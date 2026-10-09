use core::fmt;
use std::rc::Rc;
use crate::test_runner::expect::JSValueTestExt;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass, JsResult};
use bun_core::String as BunString;

use crate::test_runner::bun_test::{self, BaseScopeCfg, BunTest, Calling, DescribeScope, Flavor};
use crate::test_runner::bun_test::js_fns::{Signature, generic_hook};
use crate::test_runner::test_context;
use crate::test_runner::test_context_fixtures::TestFixtures;
use crate::test_runner::test_context_parameter::ContextParameter;
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

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. All three
// fields are written exactly once in `create_unbound` and never mutated again,
// so no `Cell`/`JsCell` wrapping is needed — the type is read-only after
// construction. `generic_if`/`generic_extend`/`fn_each`/`call_as_function` all
// re-enter JS (create_bound → to_js / JSFunction::create / bind), which can
// form fresh `&ScopeFunctions` to the same wrapper; aliased `&Self` is sound,
// aliased `&mut Self` would not be.
#[bun_jsc::JsClass(no_constructor)]
pub(crate) struct ScopeFunctions {
    pub(crate) mode: Mode,
    pub(crate) cfg: BaseScopeCfg,
    /// typically `.zero`. not Strong.Optional because codegen visits the C++ `m_each`
    /// WriteBarrier on the JS wrapper (see `values: ["each"]` in jest.classes.ts). This
    /// field is kept in sync with that slot via `js::each_set_cached` in `create_unbound`.
    pub(crate) each: JSValue,
    pub(crate) rows: Rows,
    /// The `TestFixtures` of `test.extend()`, else `.zero`. Kept alive like `each`.
    pub(crate) fixtures: JSValue,
}

/// How the callback gets a row of `each`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Rows {
    /// `.each()`: an array is spread over the parameters.
    Each,
    /// `.for()`: as the first argument, before the test context.
    For,
}

impl ScopeFunctions {
    pub(crate) fn new(mode: Mode, cfg: BaseScopeCfg) -> ScopeFunctions {
        ScopeFunctions { mode, cfg, each: JSValue::ZERO, rows: Rows::Each, fixtures: JSValue::ZERO }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_skip(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"get .skip", "skip")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_todo(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"get .todo", "todo")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_failing(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"get .failing", "failing")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_fails(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"get .fails", "fails")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_concurrent(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"get .concurrent", "concurrent")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_serial(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .serial", "serial")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_sequential(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .sequential", "sequential")
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_only(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.generic_extend(global, BaseScopeCfg { self_only: true, ..Default::default() }, b"get .only", "only")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .if()", true, "if")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_run_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .runIf()", true, "runIf")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_skip_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .skipIf()", false, "skipIf")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_todo_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"call .todoIf()", false, "todoIf")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_failing_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"call .failingIf()", false, "failingIf")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_concurrent_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"call .concurrentIf()", false, "concurrentIf")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_serial_if(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.generic_if(global, frame, BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"call .serialIf()", false, "serialIf")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_each(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.with_rows(global, frame, Rows::Each, this.cfg.flavor, "each")
    }
    /// vitest's, whichever module `this` is from.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_for(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.with_rows(global, frame, Rows::For, Flavor::Vitest, "for")
    }

    /// vitest's, whichever module `this` is from.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_extend(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let fixtures = this.define_fixtures(global, frame, "test.extend()", false)?;
        let cfg = BaseScopeCfg { flavor: Flavor::Vitest, ..Default::default() };
        create_bound(global, ScopeFunctions { fixtures, ..ScopeFunctions::new(Mode::Test, cfg) }, "test")
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_override(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if this.fixtures.is_empty() {
            return Err(global.throw(format_args!(
                "test.override() can only be called on a function that test.extend() returned"
            )));
        }
        this.define_fixtures(global, frame, "test.override()", true)?;
        Ok(frame.this())
    }

    fn define_fixtures(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        signature: &'static str,
        is_override: bool,
    ) -> JsResult<JSValue> {
        if self.mode == Mode::Describe {
            return Err(global.throw(format_args!("{} cannot be called on {}", signature, self)));
        }
        let mut active_scope: *const DescribeScope = core::ptr::null();
        let mut is_top_level = true;
        if let Some(buntest) = bun_test::clone_active_strong() {
            if buntest.phase == bun_test::Phase::Collection {
                active_scope = buntest.collection.active_scope.as_ptr();
                is_top_level = core::ptr::eq(active_scope, &raw const *buntest.collection.root_scope);
            } else if is_override {
                return Err(global.throw(format_args!(
                    "Cannot call {} inside a test. Call it inside describe() instead.",
                    signature
                )));
            }
        }
        TestFixtures::define(global, frame, signature, self.fixtures, active_scope, is_top_level, is_override)
    }

    fn hook(&self, global: &JSGlobalObject, name: &'static str, jest: bun_jsc::JSHostFn, vitest: bun_jsc::JSHostFn) -> JsResult<JSValue> {
        if self.mode == Mode::Describe {
            return Ok(JSValue::UNDEFINED);
        }
        let hook = if self.cfg.flavor == Flavor::Vitest { vitest } else { jest };
        let hook = bun_jsc::JSFunction::create(global, name, hook, 1, Default::default());
        if self.fixtures.is_empty() {
            return Ok(hook);
        }
        JSValueTestExt::bind(hook, global, self.fixtures, &BunString::static_(name), 1.0, &[])
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_before_all(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.hook(global, "beforeAll", generic_hook::__jsc_host_before_all, generic_hook::__jsc_host_vitest_before_all)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_before_each(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.hook(global, "beforeEach", generic_hook::__jsc_host_before_each, generic_hook::__jsc_host_vitest_before_each)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_after_each(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.hook(global, "afterEach", generic_hook::__jsc_host_after_each, generic_hook::__jsc_host_vitest_after_each)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_after_all(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        this.hook(global, "afterAll", generic_hook::__jsc_host_after_all, generic_hook::__jsc_host_vitest_after_all)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_describe(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.mode == Mode::Describe {
            return Ok(JSValue::UNDEFINED);
        }
        let cfg = BaseScopeCfg { flavor: this.cfg.flavor, ..Default::default() };
        create_bound(global, ScopeFunctions::new(Mode::Describe, cfg), "describe")
    }

    fn with_rows(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        rows: Rows,
        flavor: Flavor,
        name: &'static str,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        let [array] = frame.arguments_as_array::<1>();
        if array.is_undefined_or_null() || !array.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return Err(global.throw(format_args!("Expected array, got {}", array.to_fmt(&mut formatter))));
        }

        if !self.each.is_empty() {
            return Err(global.throw(format_args!("Cannot {} on {}", name, self)));
        }
        let array = template_rows(global, frame.arguments(), flavor)?.unwrap_or(array);
        let cfg = BaseScopeCfg { flavor, ..self.cfg };
        create_bound(global, ScopeFunctions { cfg, each: array, rows, ..*self }, name)
    }
}

/// The rows of a table written as a tagged template: an object for each, keyed by the headings of the first line.
/// ```js
/// test.each`
///   a    | b
///   ${1} | ${2}
/// `
/// ```
fn template_rows(global: &JSGlobalObject, arguments: &[JSValue], flavor: Flavor) -> JsResult<Option<JSValue>> {
    let Some((&strings, values)) = arguments.split_first() else {
        return Ok(None);
    };
    if !strings.get_own(global, &BunString::static_("raw"))?.is_some_and(JSValue::is_array) {
        return Ok(None);
    }
    // vitest takes a template without values for an array, and leaves out a last row that is not complete.
    if values.is_empty() && flavor == Flavor::Vitest {
        return Ok(None);
    }
    let before_first_value = strings.get_index(global, 0)?.to_utf8(global)?;
    let first_line = bun_core::strings::split_any(before_first_value.slice().trim_ascii(), b"\r\n")
        .next()
        .unwrap_or_default();
    let headings: Vec<&[u8]> = bun_core::strings::split(first_line, b"|").map(<[u8]>::trim_ascii).collect();
    if flavor == Flavor::Jest && (values.is_empty() || values.len() % headings.len() != 0) {
        return Err(global.throw(format_args!(
            "Expected a value for each of the {} headings \"{}\" in every row of the table, received {} values",
            headings.len(),
            bstr::BStr::new(first_line),
            values.len(),
        )));
    }
    let rows = JSValue::create_empty_array(global, 0)?;
    for row_values in values.chunks_exact(headings.len()) {
        let row = JSValue::create_empty_object(global, headings.len());
        for (heading, &value) in headings.iter().zip(row_values) {
            row.put(global, BunString::clone_utf8(heading), value);
        }
        rows.push(global, row)?;
    }
    Ok(Some(rows))
}

#[bun_jsc::host_fn]
fn call_as_function(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    let buntest_strong = bun_test::js_fns::clone_active_strong(global, Signature::ScopeFunctions(this))?;
    let bun_test_ptr = buntest_strong.get();

    let is_vitest = this.cfg.flavor == Flavor::Vitest;
    let callback_mode: CallbackMode = match this.cfg.self_mode {
        SelfMode::Skip | SelfMode::Todo => CallbackMode::Allow,
        // vitest: a test or a describe block without a callback is a todo.
        _ if is_vitest => CallbackMode::Allow,
        _ => CallbackMode::Require,
    };

    let args = parse_arguments(
        global,
        frame,
        Signature::ScopeFunctions(this),
        ParseArgumentsCfg {
            callback: callback_mode,
            kind: FunctionKind::TestOrDescribe,
            inherited: bun_test_ptr.collection.active_scope().inherited,
        },
    )?;

    // Jest: a parameter that no value of the row fills is a `done` callback.
    let callback_length: usize = match args.callback {
        Some(callback) if !is_vitest => callback.get_length(global)? as usize,
        _ => 0,
    };
    // The fixtures the callback asks for.
    let parameter: Option<Rc<ContextParameter>> = match args.callback {
        Some(callback) if !this.fixtures.is_empty() && this.mode == Mode::Test => Some(Rc::new(if this.each.is_empty() {
            ContextParameter::of(callback, 0)
        } else if this.rows == Rows::For {
            ContextParameter::of(callback, 1)
        } else {
            ContextParameter::Absent
        })),
        _ => None,
    };

    if !this.each.is_empty() {
        if this.each.is_undefined_or_null() || !this.each.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global);
            return Err(global.throw(format_args!("Expected array, got {}", this.each.to_fmt(&mut formatter))));
        }
        // vitest spreads the rows only if each of them is an array.
        let mut spread_rows = this.rows == Rows::Each;
        if spread_rows && is_vitest {
            let mut rows = this.each.array_iterator(global)?;
            while let Some(row) = rows.next()? {
                spread_rows &= row.is_array();
            }
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

                let callback_args = if spread_rows { args_list.as_slice() } else { core::slice::from_ref(&item) };
                let bound = if let Some(cb) = args.callback {
                    Some(JSValueTestExt::bind(cb, global, item, &BunString::static_("cb"), 0.0, callback_args)?)
                } else {
                    None
                };
                this.enqueue_describe_or_test_callback(
                    // Explicit reborrow: the closure must not move the `&mut`
                    // (it is reused on later loop iterations).
                    &mut *bun_test_ptr,
                    global,
                    frame,
                    bound,
                    formatted_label.as_deref(),
                    &args.options,
                    if is_vitest {
                        Calling::Vitest { context: this.rows == Rows::For }
                    } else {
                        Calling::Jest { done: callback_length > args_list.len() }
                    },
                    parameter.as_ref(),
                    line_no,
                )
            })?;

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
            if is_vitest { Calling::Vitest { context: true } } else { Calling::Jest { done: callback_length >= 1 } },
            parameter.as_ref(),
            line_no,
        )?;
    }

    Ok(JSValue::UNDEFINED)
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
        frame: &CallFrame,
        callback: Option<JSValue>,
        description: Option<&[u8]>,
        options: &ParseArgumentsOptions,
        calling: Calling,
        parameter: Option<&Rc<ContextParameter>>,
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
                let name = BunString::from_bytes(description.unwrap_or(b"(unnamed)"));
                let parent: &DescribeScope = bun_test.collection.active_scope();
                let parent_id = if parent.base.test_id_for_debugger != 0 {
                    parent.base.test_id_for_debugger
                } else {
                    -1
                };
                debugger.test_reporter_agent.report_test_found(
                    frame,
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

        let mut base = self.cfg;
        options.modifiers.apply(global, &mut base)?;
        if callback.is_none() && matches!(base.self_mode, SelfMode::Normal | SelfMode::Failing) {
            base.self_mode = SelfMode::Todo;
        }
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
                if self.cfg.flavor == Flavor::Vitest {
                    new_scope.inherited = options.inherited;
                }
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

                        let str = BunString::from_bytes(bun_test.collection.filter_buffer.as_slice());
                        group_log::log(format_args!(
                            "matches_filter \"{}\"",
                            bstr::BStr::new(bun_test.collection.filter_buffer.as_slice())
                        ));
                        // SAFETY: `filter_regex` is the FFI-allocated Yarr handle stored in
                        // `TestRunner` for the process lifetime; single-threaded here so the
                        // exclusive borrow is unaliased.
                        matches_filter = unsafe { &mut *filter_regex.as_ptr() }.matches(&str);

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

                let mut callback = if matches_filter { callback } else { None };
                if let (Some(parameter), Some(function)) = (parameter, callback) {
                    let (call, ordinal) = if self.each.is_empty() { ("()", "first") } else { ("", "second") };
                    let why = "fixtures are set up for the properties it names";
                    let error = match &**parameter {
                        ContextParameter::Absent | ContextParameter::Properties(_) => None,
                        ContextParameter::RestProperty => Some(global.create_error_instance(format_args!(
                            "{self}{call} expects the {ordinal} parameter of its callback not to have a rest property: {why}"
                        ))),
                        ContextParameter::Other(Some(received)) => Some(global.create_error_instance(format_args!(
                            "{self}{call} expects the {ordinal} parameter of its callback to be an object destructuring pattern, received {}: {why}",
                            bun_core::fmt::quote(received),
                        ))),
                        ContextParameter::Other(None) => Some(global.create_error_instance(format_args!(
                            "{self}{call} expects the {ordinal} parameter of its callback to be an object destructuring pattern: {why}"
                        ))),
                    };
                    match error {
                        Some(error) => callback = Some(test_context::rejecting(global, error)?),
                        None => bun_test.set_context_parameter(function, Rc::clone(&parameter)),
                    }
                    if TestFixtures::has_scope_beyond_test(self.fixtures) {
                        bun_test.expect_file_scoped_fixtures();
                    }
                }

                let _ = bun_test.collection.active_scope_mut().append_test(
                    description,
                    callback,
                    bun_test::ExecutionEntryCfg {
                        calling,
                        fixtures: Some(self.fixtures).filter(|fixtures| !fixtures.is_empty()),
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
        fn_name: &'static str,
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
            create_bound(global, ScopeFunctions { ..*self }, fn_name)
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
        // Modifiers are a set, as in Jest and vitest: repeating one changes nothing and skip > todo > failing.
        let (mut base, mut added) = (self.cfg, cfg);
        base.self_only &= !added.self_only;
        if base.self_concurrent == added.self_concurrent {
            base.self_concurrent = SelfConcurrent::Inherit;
        }
        if mode_precedence(base.self_mode) > mode_precedence(added.self_mode) {
            added.self_mode = SelfMode::Normal;
        } else {
            base.self_mode = SelfMode::Normal;
        }
        let Some(extended) = base.extend(added) else {
            return Err(global.throw(format_args!("Cannot {} on {}", bstr::BStr::new(name), self)));
        };
        create_bound(global, ScopeFunctions { cfg: extended, ..*self }, fn_name)
    }
}

fn mode_precedence(mode: SelfMode) -> u8 {
    match mode {
        SelfMode::Normal => 0,
        SelfMode::Failing => 1,
        SelfMode::Todo => 2,
        SelfMode::Skip | SelfMode::FilteredOut => 3,
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
    /// What was given, else what `ParseArgumentsCfg::inherited` has.
    pub(crate) inherited: InheritedOptions,
    pub(crate) modifiers: ModifierOptions,
}

/// The options of a vitest `describe()` that are the defaults of what is inside it.
#[derive(Default, Clone, Copy)]
pub(crate) struct InheritedOptions {
    pub(crate) timeout: Option<u32>,
    pub(crate) retry: Option<u32>,
    pub(crate) repeats: Option<u32>,
}

/// vitest: `test(name, { skip: true }, fn)` is `test.skip(name, fn)`, and `{ skip: false }` undoes `test.skip`.
#[derive(Default, Clone, Copy)]
pub(crate) struct ModifierOptions {
    only: Option<bool>,
    skip: Option<bool>,
    todo: Option<bool>,
    fails: Option<bool>,
    concurrent: Option<bool>,
}

impl ModifierOptions {
    fn apply(self, global: &JSGlobalObject, cfg: &mut BaseScopeCfg) -> JsResult<()> {
        if let Some(concurrent) = self.concurrent {
            cfg.self_concurrent = if concurrent { SelfConcurrent::Yes } else { SelfConcurrent::No };
        }
        if self.only.or(self.skip).or(self.todo).or(self.fails).is_none() {
            return Ok(());
        }
        if self.only == Some(true) {
            error_in_ci(global, b".only")?;
        }
        cfg.self_only = self.only.unwrap_or(cfg.self_only);
        let has = |option: Option<bool>, mode: SelfMode| option.unwrap_or(cfg.self_mode == mode);
        cfg.self_mode = if !cfg.self_only && has(self.skip, SelfMode::Skip) {
            SelfMode::Skip
        } else if !cfg.self_only && has(self.todo, SelfMode::Todo) {
            SelfMode::Todo
        } else if has(self.fails, SelfMode::Failing) {
            SelfMode::Failing
        } else {
            SelfMode::Normal
        };
        Ok(())
    }
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
    pub(crate) inherited: InheritedOptions,
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
        let description_class_name = description.get_class_name(global)?;

        if !description_class_name.is_empty() {
            return Ok(description_class_name.to_owned_slice());
        }

        let description_name = description.get_name(global)?;
        return Ok(description_name.to_owned_slice());
    }

    if description.is_function() {
        let func_name = description.get_name(global)?;
        if func_name.length() > 0 {
            return Ok(func_name.to_owned_slice());
        }
    }

    if description.is_number() || description.is_string() {
        let slice = description.to_utf8(global)?;
        return Ok(slice.into_vec());
    }

    Err(global.throw(format_args!(
        "{}() expects first argument to be a named class, named function, number, or string",
        signature
    )))
}

pub(crate) fn parse_arguments(
    global: &JSGlobalObject,
    frame: &CallFrame,
    signature: Signature,
    cfg: ParseArgumentsCfg,
) -> JsResult<ParseArgumentsResult> {
    let [a1, a2, a3] = frame.arguments_as_array::<3>();
    let is_vitest = matches!(signature, Signature::ScopeFunctions(function) if function.cfg.flavor == Flavor::Vitest);

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
            } else if is_vitest && !a2.is_function() {
                DescriptionCallbackOptions { description: a1, options: a2, ..Default::default() }
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
    // `result` cleanup handled by Drop on early return.

    let mut timeout_option: Option<f64> = None;
    let mut repeats_option: Option<u32> = None;

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
        if let Some(mut retries) = options.get(global, "retry")? {
            if is_vitest && retries.is_object() {
                retries = retries.get(global, "count")?.unwrap_or_else(|| JSValue::js_number(0.0));
            }
            if !retries.is_number() {
                return Err(global.throw(format_args!("{}() expects retry to be a number", signature)));
            }
            // Lossy cast: Rust `as` saturates on overflow/NaN.
            result.options.retry = Some(retries.as_number() as u32);
        }
        if let Some(repeats) = options.get(global, "repeats")? {
            if !repeats.is_number() {
                return Err(global.throw(format_args!("{}() expects repeats to be a number", signature)));
            }
            if !is_vitest && result.options.retry.is_some() && result.options.retry.unwrap() != 0 {
                return Err(global.throw(format_args!("{}(): Cannot set both retry and repeats", signature)));
            }
            repeats_option = Some(repeats.as_number() as u32);
        }
        if is_vitest {
            let modifiers = &mut result.options.modifiers;
            for (name, modifier) in [
                ("only", &mut modifiers.only),
                ("skip", &mut modifiers.skip),
                ("todo", &mut modifiers.todo),
                ("fails", &mut modifiers.fails),
                ("concurrent", &mut modifiers.concurrent),
            ] {
                *modifier = options.get(global, name)?.map(JSValue::to_boolean);
            }
            if let Some(sequential) = options.get(global, "sequential")?
                && sequential.to_boolean()
            {
                modifiers.concurrent = Some(false);
            }
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

    let timeout_option_ms: Option<u32> = timeout_option.map(|timeout| timeout as u32);
    result.options.inherited = InheritedOptions {
        timeout: timeout_option_ms.or(cfg.inherited.timeout),
        retry: result.options.retry.or(cfg.inherited.retry),
        repeats: repeats_option.or(cfg.inherited.repeats),
    };
    result.options.retry = result.options.inherited.retry;
    result.options.repeats = result.options.inherited.repeats.unwrap_or(0);

    if result.options.retry.is_none() {
        if let Some(runner) = jest::Jest::runner() {
            result.options.retry = Some(runner.test_options.retry);
        }
    }
    if !is_vitest && result.options.retry.unwrap_or(0) != 0 && result.options.repeats != 0 {
        return Err(global.throw(format_args!("{}(): Cannot set both retry and repeats", signature)));
    }

    let default_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_ms != 0 { Some(runner.default_timeout_ms) } else { None }
    });
    let override_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_override != u32::MAX { Some(runner.default_timeout_override) } else { None }
    });
    result.options.timeout = result.options.inherited.timeout.or(override_timeout_ms).or(default_timeout_ms).unwrap_or(0);

    Ok(result)
}

// Codegen bridge — `#[bun_jsc::JsClass]` derive provides `to_js`/`from_js`/`from_js_direct`.
// `js::each_set_cached` is the codegen'd setter for the C++ `m_each` WriteBarrier
// (see jest.classes.ts `values: ["each"]`).
//
// Hand-expansion of the cached-value accessors `src/codegen/generate-classes.ts` emits:
// `eachSetCached` / `eachGetCached` thin-wrap the C++-side
// `ScopeFunctionsPrototype__each{Set,Get}CachedValue` shims, which write/read the
// `JSC::WriteBarrier<Unknown> m_each` slot on the JSCell wrapper so the GC visits
// the `.each(arr)` argument between construction and the trailing `("name", cb)` call.
pub(crate) mod js {
    bun_jsc::codegen_cached_accessors!("ScopeFunctions"; each, fixtures);
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
            write!(f, "{}", if self.rows == Rows::For { ".for()" } else { ".each()" })?;
        }
        Ok(())
    }
}

impl Drop for ScopeFunctions {
    fn drop(&mut self) {
        let _g = group_log::begin();
    }
}

fn create_unbound(global: &JSGlobalObject, scope_functions: ScopeFunctions) -> JSValue {
    let _g = group_log::begin();

    let (each, fixtures) = (scope_functions.each, scope_functions.fixtures);
    // `JsClass::to_js` boxes `self` and hands the raw pointer to the C++
    // wrapper (m_ctx); freed in `finalize`.
    let value = scope_functions.to_js(global);
    value.ensure_still_alive();
    // Write into the C++ m_each WriteBarrier so GC visits it. The Rust `each` field
    // lives in unmanaged memory that JSC never scans; without this the array can be
    // collected between `.each(arr)` and the trailing `("name", cb)` call.
    if !each.is_empty() {
        js::each_set_cached(value, global, each);
    }
    if !fixtures.is_empty() {
        js::fixtures_set_cached(value, global, fixtures);
    }
    value
}

fn bind(value: JSValue, global: &JSGlobalObject, name: &'static str) -> JsResult<JSValue> {
    // `#[bun_jsc::host_fn]` on `call_as_function` emits the C-ABI thunk
    // `__jsc_host_call_as_function`; `JSFunction::create` wants the raw
    // `JSHostFn` shape, not the safe Rust signature.
    let call_fn = bun_jsc::JSFunction::create(global, name, __jsc_host_call_as_function, 1, Default::default());
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
    scope_functions: ScopeFunctions,
    name: &'static str,
) -> JsResult<JSValue> {
    let _g = group_log::begin();

    let value = create_unbound(global, scope_functions);
    bind(value, global, name)
}

// These enum types live on `bun_test::BaseScopeCfg` (`self_mode`, `self_concurrent`).
// bun_test.rs names them `ScopeMode`/`ConcurrentMode`; alias here for brevity.
use crate::test_runner::bun_test::{ScopeMode as SelfMode, ConcurrentMode as SelfConcurrent};
// `TestReporterKind` in the spec is `bun_jsc::debugger::TestType` (Test/Describe).
use bun_jsc::debugger::TestType as TestReporterKind;

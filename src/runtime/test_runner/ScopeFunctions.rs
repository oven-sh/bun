use core::fmt;
use std::rc::Rc;
use crate::test_runner::expect::{FormatterTestExt as _, JSValueTestExt};

use bun_jsc::bindgen::{Callable, JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult};
use bun_core::{String as BunString, StringView};

use crate::generated_bindgen::jest::js_ScopeFunctions as js;
use crate::generated_bindgen::scope_functions::{
    Bun__ScopeFunctions__callAsFunction, CallbackOrOptions, DescriptionOrCallback, Retry,
};
use crate::test_runner::bun_test::{self, BaseScopeCfg, BunTest, Calling, DescribeScope, Flavor};
use crate::test_runner::bun_test::js_fns::{GenericHookTag, Signature, create_hook};
use crate::test_runner::test_context;
use crate::test_runner::test_context_fixtures::TestFixtures;
use crate::test_runner::test_context_parameter::{ContextParameter, SharedContextParameter};
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

// Every JS-exposed method takes `&self`. All
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
    pub(crate) rows: Rows,
    /// The `TestFixtures` from `test.extend()`, else `.zero`. Kept alive the same way as `each`.
    pub(crate) fixtures: JSValue,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Rows {
    Each,
    /// `.for()` passes the row as the first argument, before the test context.
    For,
}

impl ScopeFunctions {
    pub(crate) fn new(mode: Mode, cfg: BaseScopeCfg) -> ScopeFunctions {
        ScopeFunctions { mode, cfg, each: JSValue::ZERO, rows: Rows::Each, fixtures: JSValue::ZERO }
    }

    pub(crate) fn get_skip(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"get .skip", "skip")
    }
    pub(crate) fn get_todo(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Todo, ..Default::default() }, b"get .todo", "todo")
    }
    pub(crate) fn get_failing(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Failing, ..Default::default() }, b"get .failing", "failing")
    }
    pub(crate) fn get_fails(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_mode: SelfMode::Fails, ..Default::default() }, b"get .fails", "fails")
    }
    pub(crate) fn get_shuffle(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        if self.mode == Mode::Test {
            return Ok(JSValue::UNDEFINED);
        }
        self.generic_extend(cx.global(), BaseScopeCfg { self_shuffle: true, ..Default::default() }, b"get .shuffle", "shuffle")
    }
    pub(crate) fn get_concurrent(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_concurrent: SelfConcurrent::Yes, ..Default::default() }, b"get .concurrent", "concurrent")
    }
    pub(crate) fn get_serial(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .serial", "serial")
    }
    pub(crate) fn get_sequential(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_concurrent: SelfConcurrent::No, ..Default::default() }, b"get .sequential", "sequential")
    }
    pub(crate) fn get_only(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.generic_extend(cx.global(), BaseScopeCfg { self_only: true, ..Default::default() }, b"get .only", "only")
    }
    pub(crate) fn r#if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .if()", true, "if")
    }
    pub(crate) fn run_if(&self, cx: &mut JsScope<'_>, condition: bool) -> JsResult<JSValue> {
        self.generic_if(cx.global(), condition, BaseScopeCfg { self_mode: SelfMode::Skip, ..Default::default() }, b"call .runIf()", true, "runIf")
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
    pub(crate) fn each(&self, cx: &mut JsScope<'_>, table: JsLocal<'_>, values: &[JsLocal<'_>]) -> JsResult<JSValue> {
        self.with_rows(cx.global(), table.to_js(), JsLocal::to_js_slice(values), Rows::Each, self.cfg.flavor, "each")
    }
    /// `.for()` and `.extend()` use Vitest semantics even when `this` came from "bun:test".
    pub(crate) fn r#for(&self, cx: &mut JsScope<'_>, table: JsLocal<'_>, values: &[JsLocal<'_>]) -> JsResult<JSValue> {
        self.with_rows(cx.global(), table.to_js(), JsLocal::to_js_slice(values), Rows::For, Flavor::Vitest, "for")
    }

    pub(crate) fn extend(
        &self,
        cx: &mut JsScope<'_>,
        name: JsLocal<'_>,
        options: JsLocal<'_>,
        value: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let fixtures = self.define_fixtures(global, [name.to_js(), options.to_js(), value.to_js()], "test.extend()", false)?;
        let cfg = BaseScopeCfg { flavor: Flavor::Vitest, ..Default::default() };
        create_bound(global, ScopeFunctions { fixtures, ..ScopeFunctions::new(Mode::Test, cfg) }, "test")
    }
    pub(crate) fn r#override(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        name: JsLocal<'_>,
        options: JsLocal<'_>,
        value: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.fixtures.is_empty() {
            return Err(global.throw(format_args!(
                "test.override() can only be called on a function that test.extend() returned"
            )));
        }
        self.define_fixtures(global, [name.to_js(), options.to_js(), value.to_js()], "test.override()", true)?;
        Ok(js::bound_get_cached(this_value.to_js()).unwrap_or(JSValue::UNDEFINED))
    }

    #[optimize(size)]
    fn define_fixtures(
        &self,
        global: &JSGlobalObject,
        arguments: [JSValue; 3],
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
        TestFixtures::define(global, arguments, signature, self.fixtures, active_scope, is_top_level, is_override)
    }

    fn hook(&self, global: &JSGlobalObject, tag: GenericHookTag) -> JsResult<JSValue> {
        if self.mode == Mode::Describe {
            return Ok(JSValue::UNDEFINED);
        }
        let this_value = if self.fixtures.is_empty() { JSValue::UNDEFINED } else { self.fixtures };
        create_hook(global, tag, self.cfg.flavor, this_value)
    }
    pub(crate) fn get_before_all(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.hook(cx.global(), GenericHookTag::BeforeAll)
    }
    pub(crate) fn get_before_each(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.hook(cx.global(), GenericHookTag::BeforeEach)
    }
    pub(crate) fn get_after_each(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.hook(cx.global(), GenericHookTag::AfterEach)
    }
    pub(crate) fn get_after_all(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.hook(cx.global(), GenericHookTag::AfterAll)
    }
    pub(crate) fn get_around_each(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.hook(cx.global(), GenericHookTag::AroundEach)
    }
    pub(crate) fn get_around_all(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.hook(cx.global(), GenericHookTag::AroundAll)
    }
    pub(crate) fn get_describe(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        if self.mode == Mode::Describe {
            return Ok(JSValue::UNDEFINED);
        }
        let cfg = BaseScopeCfg { flavor: self.cfg.flavor, ..Default::default() };
        create_bound(cx.global(), ScopeFunctions::new(Mode::Describe, cfg), "describe")
    }

    /// A tagged template call passes its substitutions as `values`.
    #[optimize(size)]
    fn with_rows(
        &self,
        global: &JSGlobalObject,
        array: JSValue,
        values: &[JSValue],
        rows: Rows,
        flavor: Flavor,
        name: &'static str,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        if array.is_undefined_or_null() || !array.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global).with_quote_strings(false);
            return Err(global.throw(format_args!("Expected array, got {}", array.to_fmt(&mut formatter))));
        }

        if !self.each.is_empty() {
            return Err(global.throw(format_args!("Cannot {} on {}", name, self)));
        }
        let array = template_rows(global, array, values, flavor)?.unwrap_or(array);
        let cfg = BaseScopeCfg { flavor, ..self.cfg };
        create_bound(global, ScopeFunctions { cfg, each: array, rows, ..*self }, name)
    }
}

/// Turns a tagged-template `.each` table into one object per row, keyed by the headings on the first line.
fn template_rows(global: &JSGlobalObject, strings: JSValue, values: &[JSValue], flavor: Flavor) -> JsResult<Option<JSValue>> {
    if flavor == Flavor::Vitest {
        return vitest_template_rows(global, strings, values);
    }
    if !strings.get_own(global, &BunString::static_("raw"))?.is_some_and(JSValue::is_array) {
        return Ok(None);
    }
    let before_first_value = strings.get_index(global, 0)?.to_utf8(global)?;
    let first_line = bun_core::strings::split_any(before_first_value.slice().trim_ascii(), b"\r\n")
        .next()
        .unwrap_or_default();
    let headings: Vec<&[u8]> = bun_core::strings::split(first_line, b"|").map(<[u8]>::trim_ascii).collect();
    if values.is_empty() || !values.len().is_multiple_of(headings.len()) {
        return Err(global.throw(format_args!(
            "Expected a value for each of the {} headings \"{}\" in every row of the table, received {} values",
            headings.len(),
            bstr::BStr::new(first_line),
            values.len(),
        )));
    }
    table_rows(global, &headings, values).map(Some)
}

#[optimize(size)]
fn table_rows(global: &JSGlobalObject, headings: &[&[u8]], values: &[JSValue]) -> JsResult<JSValue> {
    let rows = JSValue::create_empty_array(global, 0)?;
    for row_values in values.chunks_exact(headings.len()) {
        let row = JSValue::create_empty_object(global, headings.len());
        for (heading, &value) in headings.iter().zip(row_values) {
            row.put_may_be_index(global, &BunString::clone_utf8(heading), value)?;
        }
        rows.push(global, row)?;
    }
    Ok(rows)
}

/// Vitest's `formatTemplateString(cases, args)`. It takes any array followed by arguments and drops an incomplete last row.
fn vitest_template_rows(global: &JSGlobalObject, strings: JSValue, values: &[JSValue]) -> JsResult<Option<JSValue>> {
    if values.is_empty() {
        return Ok(None);
    }
    // `cases.join("").trim().replace(/ /g, "").split("\n")[0].split("|")`
    let mut joined = Vec::new();
    let mut iter = strings.array_iterator(global)?;
    while let Some(string) = iter.next()? {
        if !string.is_undefined_or_null() {
            joined.extend_from_slice(string.to_utf8(global)?.slice());
        }
    }
    let trimmed = bun_core::strings::trim_js_whitespace(&joined);
    let first_line = &trimmed[..bun_core::strings::index_of_char_usize(trimmed, b'\n').unwrap_or(trimmed.len())];
    let first_line: Vec<u8> = first_line.iter().copied().filter(|byte| *byte != b' ').collect();
    let headings: Vec<&[u8]> = bun_core::strings::split(&first_line, b"|").collect();
    table_rows(global, &headings, values).map(Some)
}

#[optimize(size)]
pub(crate) fn call_as_function<'a>(
    cx: &mut JsScope<'a>,
    this_value: JsLocal<'a>,
    first: (DescriptionOrCallback<'a>, JsLocal<'a>),
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

    let is_vitest = this.cfg.flavor == Flavor::Vitest;
    let callback_mode: CallbackMode = match this.cfg.self_mode {
        SelfMode::Skip | SelfMode::Todo => CallbackMode::Allow,
        // In Vitest, a test or describe block without a callback is a todo.
        _ if is_vitest => CallbackMode::Allow,
        _ => CallbackMode::Require,
    };

    let args = parse_arguments(
        global,
        first,
        second,
        third,
        Signature::ScopeFunctions(this),
        ParseArgumentsCfg {
            callback: callback_mode,
            kind: FunctionKind::TestOrDescribe,
            inherited: bun_test_ptr.collection.active_scope().inherited,
        },
    )?;

    // In Jest, a parameter past the row's values is a `done` callback.
    let callback_length: usize = match args.callback {
        Some(callback) if !is_vitest => callback.without_async_context().get_length(global)? as usize,
        _ => 0,
    };
    let parameter: Option<SharedContextParameter> = match args.callback {
        Some(callback) if !this.fixtures.is_empty() && this.mode == Mode::Test => Some(Rc::new(core::cell::OnceCell::from(if this.each.is_empty() {
            ContextParameter::of(callback, 0)
        } else if this.rows == Rows::For {
            ContextParameter::of(callback, 1)
        } else {
            ContextParameter::Absent
        }))),
        _ => None,
    };

    if !this.each.is_empty() {
        if this.each.is_undefined_or_null() || !this.each.is_array() {
            let mut formatter = bun_jsc::ConsoleObject::Formatter::new(global).with_quote_strings(false);
            return Err(global.throw(format_args!("Expected array, got {}", this.each.to_fmt(&mut formatter))));
        }
        // Vitest only spreads the rows if every row is an array.
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

                let formatted_label: Option<Vec<u8>> = match args.description.as_deref() {
                    // Vitest's `toArray(item)` turns null and undefined into an empty array.
                    Some(desc) if is_vitest && this.rows == Rows::For && item.is_undefined_or_null() => {
                        Some(jest::format_vitest_title(global, desc, &[], test_idx)?)
                    }
                    Some(desc) if is_vitest => Some(jest::format_vitest_title(global, desc, args_list.as_slice(), test_idx)?),
                    Some(desc) => Some(jest::format_label(global, desc, args_list.as_slice(), test_idx)?.into_vec()),
                    None => None,
                };

                let callback_args = if spread_rows { args_list.as_slice() } else { core::slice::from_ref(&item) };
                let bound = if let Some(cb) = args.callback {
                    let bound = JSValueTestExt::bind(cb.without_async_context(), global, item, &BunString::static_("cb"), 0.0, callback_args)?;
                    Some(bound.with_async_context_if_needed(global))
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
            args.callback,
            args.description.as_deref(),
            &args.options,
            if is_vitest { Calling::Vitest { context: true } } else { Calling::Jest { done: callback_length >= 1 } },
            parameter.as_ref(),
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
    #[optimize(size)]
    fn enqueue_describe_or_test_callback(
        &self,
        bun_test: &mut BunTest,
        global: &JSGlobalObject,
        callback: Option<JSValue>,
        description: Option<&[u8]>,
        options: &ParseArgumentsOptions,
        calling: Calling,
        parameter: Option<&SharedContextParameter>,
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

        let mut base = self.cfg;
        options.modifiers.apply(global, &mut base, options.inherited.fails.filter(|_| self.mode == Mode::Test))?;
        if callback.is_none() && matches!(base.self_mode, SelfMode::Normal | SelfMode::Failing | SelfMode::Fails) {
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
                } else {
                    new_scope.inherited.shuffle = options.inherited.shuffle;
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

                        let str = StringView::from_bytes(bun_test.collection.filter_buffer.as_slice());
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
                let mut parameter_of_callback = None;
                if let (Some(parameter), Some(_)) = (parameter, callback) {
                    let (call, ordinal) = if self.each.is_empty() { ("()", "first") } else { ("", "second") };
                    let why = "fixtures are chosen by the properties it destructures";
                    let error = match parameter.get().unwrap_or(&ContextParameter::Absent) {
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
                        None => parameter_of_callback = Some(Rc::clone(parameter)),
                    }
                    if TestFixtures::has_scope_beyond_test(self.fixtures) {
                        bun_test.expect_file_scoped_fixtures();
                    }
                }

                let entry = bun_test.collection.active_scope_mut().append_test(
                    description,
                    callback,
                    bun_test::ExecutionEntryCfg {
                        calling,
                        around: None,
                        fixtures: Some(self.fixtures).filter(|fixtures| !fixtures.is_empty()),
                        timeout: options.timeout,
                        retry_count: options.retry.unwrap_or(0),
                        repeat_count: options.repeats,
                    },
                    base,
                    bun_test::AddedInPhase::Collection,
                )?;
                if parameter_of_callback.is_some() {
                    entry.parameter = parameter_of_callback;
                }
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
            create_bound(global, ScopeFunctions { ..*self }, fn_name)
        }
    }

    #[optimize(size)]
    fn generic_extend(
        &self,
        global: &JSGlobalObject,
        cfg: BaseScopeCfg,
        name: &[u8],
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let _g = group_log::begin();

        if matches!(cfg.self_mode, SelfMode::Failing | SelfMode::Fails) && self.mode == Mode::Describe {
            return Err(global.throw(format_args!("Cannot {} on {}", bstr::BStr::new(name), self)));
        }
        if cfg.self_only {
            error_in_ci(global, b".only")?;
        }
        // As in Jest and Vitest, modifiers form a set. Repeating one is a no-op, and skip beats todo beats failing.
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
        SelfMode::Failing | SelfMode::Fails => 1,
        SelfMode::Todo => 2,
        SelfMode::Skip | SelfMode::FilteredOut => 3,
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
    pub(crate) inherited: InheritedOptions,
    pub(crate) modifiers: ModifierOptions,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct InheritedOptions {
    pub(crate) timeout: Option<u32>,
    pub(crate) retry: Option<u32>,
    pub(crate) repeats: Option<u32>,
    pub(crate) fails: Option<bool>,
    pub(crate) shuffle: Option<bool>,
}

/// In Vitest, `test(name, { skip: true }, fn)` means `test.skip(name, fn)`, and `{ skip: false }` undoes `test.skip`.
#[derive(Default, Clone, Copy)]
pub(crate) struct ModifierOptions {
    only: Option<bool>,
    skip: Option<bool>,
    todo: Option<bool>,
    concurrent: Option<bool>,
}

impl ModifierOptions {
    fn apply(self, global: &JSGlobalObject, cfg: &mut BaseScopeCfg, fails: Option<bool>) -> JsResult<()> {
        if let Some(concurrent) = self.concurrent {
            cfg.self_concurrent = if concurrent { SelfConcurrent::Yes } else { SelfConcurrent::No };
        }
        if self.only.or(self.skip).or(self.todo).or(fails).is_none() {
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
        } else if has(fails, SelfMode::Fails) {
            SelfMode::Fails
        } else if cfg.self_mode == SelfMode::Failing {
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
    VitestHook,
}

#[derive(Copy, Clone)]
pub(crate) struct ParseArgumentsCfg {
    pub callback: CallbackMode,
    pub(crate) kind: FunctionKind,
    pub(crate) inherited: InheritedOptions,
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

/// `first_value` is the first argument itself. Only Vitest's `test` and `describe` read it.
#[optimize(size)]
pub(crate) fn parse_arguments<'a>(
    global: &JSGlobalObject,
    (first, first_value): (DescriptionOrCallback<'a>, JsLocal<'a>),
    second: CallbackOrOptions<'a>,
    third: CallbackOrOptions<'a>,
    signature: Signature,
    cfg: ParseArgumentsCfg,
) -> JsResult<ParseArgumentsResult> {
    let is_vitest = matches!(signature, Signature::ScopeFunctions(function) if function.cfg.flavor == Flavor::Vitest);

    // Vitest names a test after any value.
    if matches!(first, DescriptionOrCallback::Other(_)) && !is_vitest {
        return Err(if cfg.kind == FunctionKind::TestOrDescribe {
            global.throw_invalid_arguments(format_args!(
                "The first argument must be a named class, named function, number, or string"
            ))
        } else {
            global.throw_invalid_arguments(format_args!("{} expects a function as the first argument", signature))
        });
    }

    for (argument, ordinal) in [(&second, "second"), (&third, "third")] {
        if matches!(argument, CallbackOrOptions::Other(_)) {
            return Err(if cfg.kind == FunctionKind::TestOrDescribe {
                global.throw_invalid_arguments(format_args!("The {} argument must be a function, number, or object", ordinal))
            } else {
                global.throw_invalid_arguments(format_args!("{} expects a number or object as the {} argument", signature, ordinal))
            });
        }
    }

    let mut is_first_the_name = !matches!((&second, &third), (CallbackOrOptions::None, CallbackOrOptions::None));
    let (description, callback, options) = match (first, second, third) {
        // callback
        // callback, options
        (
            DescriptionOrCallback::Function(callback),
            options @ (CallbackOrOptions::None | CallbackOrOptions::Timeout(_) | CallbackOrOptions::Options(_)),
            CallbackOrOptions::None,
        ) => {
            is_first_the_name = false;
            (DescriptionOrCallback::None, CallbackOrOptions::Callback(callback), options)
        }
        // description, options
        (description, options @ (CallbackOrOptions::Timeout(_) | CallbackOrOptions::Options(_)), CallbackOrOptions::None)
            if is_vitest =>
        {
            (description, CallbackOrOptions::None, options)
        }
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
            let ordinal = if cfg.kind == FunctionKind::TestOrDescribe { "second" } else { "first" };
            return Err(global.throw(format_args!("{} expects a function as the {} argument", signature, ordinal)));
        }
    };

    let mut result = ParseArgumentsResult {
        description: None,
        callback: result_callback,
        options: ParseArgumentsOptions::default(),
    };

    let mut timeout_option: Option<f64> = None;
    let mut repeats_option: Option<u32> = None;
    let mut fails_option: Option<bool> =
        matches!(signature, Signature::ScopeFunctions(function) if function.cfg.self_mode == SelfMode::Fails).then_some(true);
    let mut shuffle_option: Option<bool> = None;

    match options {
        CallbackOrOptions::None | CallbackOrOptions::Other(_) => {}
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
            result.options.retry = match options.retry {
                None => None,
                Some(Retry::Count(count)) => Some(count as u32),
                Some(Retry::Options(retry)) if is_vitest => Some(retry.count.unwrap_or(0.0) as u32),
                Some(Retry::Options(_)) => {
                    return Err(global.throw(format_args!("{}() expects retry to be a number", signature)));
                }
            };
            if let Some(repeats) = options.repeats {
                if !is_vitest && result.options.retry.is_some() && result.options.retry.unwrap() != 0 {
                    return Err(global.throw(format_args!("{}(): Cannot set both retry and repeats", signature)));
                }
                repeats_option = Some(repeats as u32);
            }
            if is_vitest {
                result.options.modifiers = ModifierOptions {
                    only: options.only,
                    skip: options.skip,
                    todo: options.todo,
                    concurrent: if options.sequential == Some(true) { Some(false) } else { options.concurrent },
                };
                fails_option = options.fails.or(fails_option);
                shuffle_option = options.shuffle;
            }
        }
    }

    result.description = if is_vitest
        && cfg.kind == FunctionKind::TestOrDescribe
        && (is_first_the_name || !matches!(description, DescriptionOrCallback::None))
    {
        Some(jest::format_vitest_name(global, first_value.to_js())?)
    } else {
        match description {
            DescriptionOrCallback::None | DescriptionOrCallback::Other(_) => None,
            DescriptionOrCallback::Function(callable) => Some(name_of_callable(global, callable, signature)?),
            DescriptionOrCallback::Text(text) => Some(text.into_vec()),
            DescriptionOrCallback::Number(number) => {
                Some(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], number).to_vec())
            }
        }
    };

    let timeout_option_ms: Option<u32> = timeout_option.map(|timeout| timeout as u32);
    result.options.inherited = InheritedOptions {
        timeout: timeout_option_ms.or(cfg.inherited.timeout),
        retry: result.options.retry.or(cfg.inherited.retry),
        repeats: repeats_option.or(cfg.inherited.repeats),
        fails: fails_option.or(cfg.inherited.fails),
        shuffle: matches!(signature, Signature::ScopeFunctions(function) if function.cfg.self_shuffle)
            .then_some(true)
            .or(shuffle_option)
            .or(cfg.inherited.shuffle),
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

    let default_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| match (runner.default_timeout_ms, cfg.kind) {
        (0, _) => None,
        // Vitest's default `hookTimeout`
        (ms, FunctionKind::VitestHook) => Some(ms.max(10_000)),
        (ms, _) => Some(ms),
    });
    let override_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| {
        if runner.default_timeout_override != u32::MAX { Some(runner.default_timeout_override) } else { None }
    });
    let vi_timeout_ms: Option<u32> = jest::Jest::runner().and_then(|runner| match cfg.kind {
        FunctionKind::TestOrDescribe => runner.vi_config.test_timeout,
        FunctionKind::Hook | FunctionKind::VitestHook => runner.vi_config.hook_timeout,
    });
    result.options.timeout =
        result.options.inherited.timeout.or(vi_timeout_ms).or(override_timeout_ms).or(default_timeout_ms).unwrap_or(0);

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
        if self.cfg.self_shuffle {
            write!(f, ".shuffle")?;
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
    let value = scope_functions.to_js(global);
    value.ensure_still_alive();
    // Write into the C++ m_each WriteBarrier so GC visits it. The Rust `each` field
    // lives in the payload, which JSC never scans; without this the array can be
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
    let call_fn = bun_jsc::JSFunction::create(global, name, Bun__ScopeFunctions__callAsFunction, 1, Default::default());
    let bound = JSValueTestExt::bind(call_fn, global, value, &BunString::static_(name), 1.0, &[])?;
    set_prototype_direct(bound, value.get_prototype(global)?, global)?;
    js::bound_set_cached(value, global, bound);
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

#[optimize(size)]
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

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::throw;
use super::{Expect, PostMatchGuard};

/// One entry of `mock.settledResults`.
pub(super) enum Settled {
    Fulfilled(JSValue),
    Rejected(JSValue),
    Incomplete,
}

impl Settled {
    pub(super) fn at(global: &JSGlobalObject, settled_results: JSValue, index: u32) -> JsResult<Settled> {
        let result = settled_results.get_index(global, index)?;
        if !result.is_object() {
            return Ok(Settled::Incomplete);
        }
        let kind = result.get(global, "type")?.unwrap_or(JSValue::UNDEFINED);
        if !kind.is_string() {
            return Ok(Settled::Incomplete);
        }
        let kind = kind.to_bun_string(global)?;
        let value = result.get(global, "value")?.unwrap_or(JSValue::UNDEFINED);
        Ok(if kind.eq_ascii(b"fulfilled") {
            Settled::Fulfilled(value)
        } else if kind.eq_ascii(b"rejected") {
            Settled::Rejected(value)
        } else {
            Settled::Incomplete
        })
    }
}

impl Expect {
    /// [`Expect::mock_prologue`] for the matchers that read `mock.settledResults`.
    pub(super) fn settled_results_prologue<'a>(
        &'a self,
        global: &'a JSGlobalObject,
        this_value: JSValue,
        matcher_name: &'static str,
        matcher_params: &'static str,
    ) -> JsResult<(PostMatchGuard<'a>, JSValue)> {
        let (this, _returns, value) =
            self.mock_prologue(global, this_value, matcher_name, matcher_params, mock::MockKind::Returns)?;
        let state = value.get(global, "mock")?.unwrap_or(JSValue::UNDEFINED);
        let settled_results = if state.is_object() {
            state.get(global, "settledResults")?.unwrap_or(JSValue::UNDEFINED)
        } else {
            JSValue::UNDEFINED
        };
        if !settled_results.js_type().is_array() {
            let mut formatter = super::make_formatter(global);
            return Err(global.throw(format_args!(
                "Expected value must be a mock function with returns: {}",
                value.to_fmt(&mut formatter),
            )));
        }
        Ok((this, settled_results))
    }
}

fn to_have_resolved_times_fn(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
    matcher_name: &'static str,
    at_least_once: bool,
) -> JsResult<JSValue> {
    let arguments = frame.arguments();
    let matcher_params = if at_least_once { "" } else { "<green>expected<r>" };
    let (this, settled_results) =
        this.settled_results_prologue(global, frame.this(), matcher_name, matcher_params)?;

    let expected_count: u32 = if at_least_once {
        if !arguments.is_empty() && !arguments[0].is_undefined() {
            return Err(global.throw_invalid_arguments(format_args!("{matcher_name}() must not have an argument")));
        }
        1
    } else {
        if arguments.is_empty() || !arguments[0].is_uint32_as_any_int() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{matcher_name}() requires 1 non-negative integer argument"
            )));
        }
        arguments[0].to_u32()
    };

    let calls_count = settled_results.get_length(global)? as u32;
    let mut resolved_count: u32 = 0;
    for index in 0..calls_count {
        if matches!(Settled::at(global, settled_results, index)?, Settled::Fulfilled(_)) {
            resolved_count += 1;
        }
    }

    let pass = if at_least_once { resolved_count >= expected_count } else { resolved_count == expected_count };
    let not = this.flags.get().not();
    if pass != not {
        return Ok(JSValue::UNDEFINED);
    }

    let (relation, padding): (&'static str, &'static str) = match (at_least_once, not) {
        (true, false) => (">= ", "   "),
        (true, true) => ("< ", "  "),
        (false, false) => ("== ", "   "),
        (false, true) => ("!= ", "   "),
    };
    throw!(
        this,
        global,
        Expect::get_signature(matcher_name, matcher_params, not),
        concat!(
            "\n\n",
            "Expected number of resolved calls: {}<green>{}<r>\n",
            "Received number of resolved calls: {}<red>{}<r>\n",
            "Received number of calls:          {}<red>{}<r>\n",
        ),
        relation,
        expected_count,
        padding,
        resolved_count,
        padding,
        calls_count,
    )
}

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_resolved(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        to_have_resolved_times_fn(self, global, frame, "toHaveResolved", true)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_resolved_times(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        to_have_resolved_times_fn(self, global, frame, "toHaveResolvedTimes", false)
    }
}

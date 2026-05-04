use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::Expect;

#[derive(core::marker::ConstParamTy, PartialEq, Eq, Clone, Copy)]
enum Mode {
    ToHaveReturned,
    ToHaveReturnedTimes,
}

impl Mode {
    #[inline]
    const fn tag_name(self) -> &'static str {
        match self {
            Mode::ToHaveReturned => "toHaveReturned",
            Mode::ToHaveReturnedTimes => "toHaveReturnedTimes",
        }
    }
}

#[inline]
fn to_have_returned_times_fn<const MODE: Mode>(
    this: &mut Expect,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let this_value = callframe.this();
    let arguments = callframe.arguments();
    // Zig: `defer this.postMatch(globalThis);`
    // TODO(port): defer with side effect — borrowck may require reshaping (this: &mut Expect is
    // used below). Phase B: consider an inner-fn + post_match-after pattern or raw-ptr scopeguard.
    let _post_match = scopeguard::guard((), |_| this.post_match(global));

    let value: JSValue =
        this.get_value(global, this_value, MODE.tag_name(), "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let mut returns = mock::jest_mock_iterator(global, value)?;

    let expected_success_count: i32 = if MODE == Mode::ToHaveReturned {
        if arguments.len() > 0 && !arguments[0].is_undefined() {
            // PERF(port): Zig used comptime `@tagName(mode) ++ "..."`; runtime fmt on error path.
            return global.throw_invalid_arguments(format_args!(
                "{}() must not have an argument",
                MODE.tag_name()
            ));
        }
        1
    } else {
        if arguments.len() < 1 || !arguments[0].is_uint32_as_any_int() {
            return global.throw_invalid_arguments(format_args!(
                "{}() requires 1 non-negative integer argument",
                MODE.tag_name()
            ));
        }

        arguments[0].coerce::<i32>(global)?
    };

    let mut pass;

    let mut actual_success_count: i32 = 0;
    let mut total_call_count: i32 = 0;
    while let Some(item) = returns.next(global)? {
        match mock::jest_mock_return_object_type(global, item)? {
            mock::ReturnObjectType::Return => actual_success_count += 1,
            _ => {}
        }
        total_call_count += 1;
    }

    pass = match MODE {
        Mode::ToHaveReturned => actual_success_count >= expected_success_count,
        Mode::ToHaveReturnedTimes => actual_success_count == expected_success_count,
    };

    let not = this.flags.not;
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // Zig: `switch (not) { inline else => |is_not| ... }` — runtime bool → comptime dispatch.
    // PERF(port): was comptime bool dispatch — profile in Phase B.
    let is_not = not;
    // PERF(port): Zig computed `getSignature` at comptime; runtime here (error path, cold).
    let signature = Expect::get_signature(MODE.tag_name(), "<green>expected<r>", is_not);
    let (str_, spc): (&'static str, &'static str) = match MODE {
        Mode::ToHaveReturned => match not {
            false => (">= ", "   "),
            true => ("< ", "  "),
        },
        Mode::ToHaveReturnedTimes => match not {
            false => ("== ", "   "),
            true => ("!= ", "   "),
        },
    };
    this.throw(
        global,
        signature,
        format_args!(
            "\n\n\
             Expected number of succesful returns: {}<green>{}<r>\n\
             Received number of succesful returns: {}<red>{}<r>\n\
             Received number of calls:             {}<red>{}<r>\n",
            str_, expected_success_count, spc, actual_success_count, spc, total_call_count,
        ),
    )
}

#[bun_jsc::host_fn(method)]
pub fn to_have_returned(
    this: &mut Expect,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    to_have_returned_times_fn::<{ Mode::ToHaveReturned }>(this, global, callframe)
}

#[bun_jsc::host_fn(method)]
pub fn to_have_returned_times(
    this: &mut Expect,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    to_have_returned_times_fn::<{ Mode::ToHaveReturnedTimes }>(this, global, callframe)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveReturned.zig (90 lines)
//   confidence: medium
//   todos:      1
//   notes:      `defer post_match` scopeguard will fight borrowck; mock iterator/ReturnObjectType names are guesses; get_signature/throw_invalid_arguments arg shapes need verification.
// ──────────────────────────────────────────────────────────────────────────

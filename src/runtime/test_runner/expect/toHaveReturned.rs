use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};

use super::mock;
use super::Expect;

#[derive(PartialEq, Eq, Clone, Copy)]
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

// PERF(port): Zig used a `comptime mode` parameter (anonymous enum) so the two callers were
// monomorphized; stable Rust forbids enum const-generic params (`adt_const_params`). Passed as a
// runtime value here — the body branches on it only on cold/error paths.
#[inline]
fn to_have_returned_times_fn(
    this: &mut Expect,
    global: &JSGlobalObject,
    callframe: &CallFrame,
    mode: Mode,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let this_value = callframe.this();
    let arguments = callframe.arguments();
    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — the guard owns the &mut Expect and runs post_match on
    // every exit path; access goes through DerefMut so the unique borrow is never aliased.
    let mut this = scopeguard::guard(this, |t| t.post_match(global));

    let value: JSValue =
        this.get_value(global, this_value, mode.tag_name(), "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let mut returns = mock::jest_mock_iterator(global, value)?;

    let expected_success_count: i32 = if mode == Mode::ToHaveReturned {
        if arguments.len() > 0 && !arguments[0].is_undefined() {
            // PERF(port): Zig used comptime `@tagName(mode) ++ "..."`; runtime fmt on error path.
            return Err(global.throw_invalid_arguments(format_args!(
                "{}() must not have an argument",
                mode.tag_name()
            )));
        }
        1
    } else {
        if arguments.len() < 1 || !arguments[0].is_uint32_as_any_int() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{}() requires 1 non-negative integer argument",
                mode.tag_name()
            )));
        }

        arguments[0].coerce::<i32>(global)?
    };

    let mut pass;

    let mut actual_success_count: i32 = 0;
    let mut total_call_count: i32 = 0;
    while let Some(item) = returns.next()? {
        match mock::jest_mock_return_object_type(global, item)? {
            mock::ReturnStatus::Return => actual_success_count += 1,
            _ => {}
        }
        total_call_count += 1;
    }

    pass = match mode {
        Mode::ToHaveReturned => actual_success_count >= expected_success_count,
        Mode::ToHaveReturnedTimes => actual_success_count == expected_success_count,
    };

    let not = this.flags.not();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // Zig: `switch (not) { inline else => |is_not| ... }` — runtime bool → comptime dispatch.
    // PERF(port): Zig computed `getSignature` at comptime; runtime here (error path, cold).
    let signature = Expect::get_signature(mode.tag_name(), "<green>expected<r>", not);
    let (str_, spc): (&'static str, &'static str) = match mode {
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

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_have_returned(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        to_have_returned_times_fn(this, global, callframe, Mode::ToHaveReturned)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_have_returned_times(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        to_have_returned_times_fn(this, global, callframe, Mode::ToHaveReturnedTimes)
    }
}

// ported from: src/test_runner/expect/toHaveReturned.zig

use core::cell::RefCell;
use core::fmt;

use bun_jsc::console_object::Formatter;
use bun_jsc::{js_error_to_write_error, CallFrame, JSGlobalObject, JSValue, JsResult};

use super::throw;
use super::to_have_resolved::Settled;
use super::{DiffFormatter, Expect, PostMatchGuard};

struct SettledResultsFormatter<'g, 'f> {
    global: &'g JSGlobalObject,
    settled_results: JSValue,
    calls_count: u32,
    formatter: RefCell<&'f mut Formatter<'g>>,
}

impl fmt::Display for SettledResultsFormatter<'_, '_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut formatter = self.formatter.borrow_mut();
        for index in 0..self.calls_count {
            if index > 0 {
                writer.write_str("\n")?;
            }
            write!(writer, "           {:>4}: ", index + 1)?;
            match Settled::at(self.global, self.settled_results, index).map_err(js_error_to_write_error)? {
                Settled::Fulfilled(value) => write!(writer, "{}", value.to_fmt(&mut **formatter))?,
                Settled::Rejected(reason) => {
                    write!(writer, "function call rejected with: {}", reason.to_fmt(&mut **formatter))?;
                }
                Settled::Incomplete => writer.write_str("<pending call>")?,
            }
        }
        Ok(())
    }
}

fn throw_mismatch(
    this: &PostMatchGuard<'_>,
    global: &JSGlobalObject,
    signature: &'static str,
    label: impl fmt::Display,
    expected: JSValue,
    received: JSValue,
) -> JsResult<JSValue> {
    if expected.is_string() && received.is_string() {
        let diff_format = DiffFormatter::new(global, received, expected, false)?;
        return throw!(this, global, signature, "\n\n{}{}\n", label, diff_format);
    }
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    throw!(
        this,
        global,
        signature,
        "\n\n{}Expected: <green>{}<r>\nReceived: <red>{}<r>",
        label,
        expected.to_fmt(&mut formatter),
        received.to_fmt(&mut formatter2),
    )
}

#[derive(Clone, Copy)]
enum Call {
    Last,
    Nth(u32),
}

impl fmt::Display for Call {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Call::Last => f.write_str("The last call"),
            Call::Nth(n) => write!(f, "Call {n}"),
        }
    }
}

fn one_call_resolved_with(
    this: &PostMatchGuard<'_>,
    global: &JSGlobalObject,
    settled_results: JSValue,
    matcher_name: &'static str,
    matcher_params: &'static str,
    call: Call,
    expected: JSValue,
) -> JsResult<JSValue> {
    let calls_count = settled_results.get_length(global)? as u32;
    let index = match call {
        Call::Last => calls_count.checked_sub(1),
        Call::Nth(n) => (n <= calls_count).then_some(n - 1),
    };
    let settled = match index {
        Some(index) => Some(Settled::at(global, settled_results, index)?),
        None => None,
    };
    let pass = match settled {
        Some(Settled::Fulfilled(value)) => value.jest_deep_equals(expected, global)?,
        _ => false,
    };

    let not = this.flags.get().not();
    if pass != not {
        return Ok(JSValue::UNDEFINED);
    }

    let signature = Expect::get_signature(matcher_name, matcher_params, not);
    let mut formatter = super::make_formatter(global);
    if not {
        return throw!(
            this,
            global,
            signature,
            "\n\n{} was expected not to resolve with: <green>{}<r>\nBut it did.\n",
            call,
            expected.to_fmt(&mut formatter),
        );
    }

    match (settled, call) {
        (None, Call::Last) => throw!(this, global, signature, "\n\nThe mock function was not called."),
        (None, Call::Nth(n)) => throw!(
            this,
            global,
            signature,
            "\n\nThe mock function was called {} time{}, but call {} was requested.\n",
            calls_count,
            if calls_count == 1 { "" } else { "s" },
            n,
        ),
        (Some(Settled::Rejected(reason)), _) => throw!(
            this,
            global,
            signature,
            "\n\n{} rejected with: <red>{}<r>\n",
            call,
            reason.to_fmt(&mut formatter),
        ),
        (Some(Settled::Incomplete), _) => throw!(this, global, signature, "\n\n{} has not settled.\n", call),
        (Some(Settled::Fulfilled(received)), _) => {
            throw_mismatch(this, global, signature, format_args!("{call}:\n"), expected, received)
        }
    }
}

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_resolved_with(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [expected] = frame.arguments_as_array::<1>();
        let (this, settled_results) =
            self.settled_results_prologue(global, frame.this(), "toHaveResolvedWith", "<green>expected<r>")?;

        let calls_count = settled_results.get_length(global)? as u32;
        let mut pass = false;
        let mut resolved_count: u32 = 0;
        let mut last_resolved = JSValue::UNDEFINED;
        for index in 0..calls_count {
            if let Settled::Fulfilled(value) = Settled::at(global, settled_results, index)? {
                resolved_count += 1;
                last_resolved = value;
                if !pass && value.jest_deep_equals(expected, global)? {
                    pass = true;
                }
            }
        }

        let not = this.flags.get().not();
        if pass != not {
            return Ok(JSValue::UNDEFINED);
        }

        let signature = Expect::get_signature("toHaveResolvedWith", "<green>expected<r>", not);
        let mut formatter = super::make_formatter(global);
        if not {
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected mock function not to have resolved with: <green>{}<r>\n",
                expected.to_fmt(&mut formatter),
            );
        }

        if calls_count == 0 {
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected: <green>{}<r>\nBut it was not called.",
                expected.to_fmt(&mut formatter),
            );
        }

        if calls_count == 1 && resolved_count == 1 {
            return throw_mismatch(&this, global, signature, "", expected, last_resolved);
        }

        let mut list_fmt = super::make_formatter(global);
        let list_formatter = SettledResultsFormatter {
            global,
            settled_results,
            calls_count,
            formatter: RefCell::new(&mut list_fmt),
        };
        throw!(
            this,
            global,
            signature,
            concat!(
                "\n\n",
                "    <green>Expected<r>: {}\n",
                "    <red>Received<r>:\n{}\n\n",
                "    Number of resolved calls: {}\n",
                "    Number of calls:          {}\n",
            ),
            expected.to_fmt(&mut formatter),
            list_formatter,
            resolved_count,
            calls_count,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_last_resolved_with(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [expected] = frame.arguments_as_array::<1>();
        let (this, settled_results) =
            self.settled_results_prologue(global, frame.this(), "toHaveLastResolvedWith", "<green>expected<r>")?;
        one_call_resolved_with(
            &this,
            global,
            settled_results,
            "toHaveLastResolvedWith",
            "<green>expected<r>",
            Call::Last,
            expected,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_nth_resolved_with(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [nth_arg, expected] = frame.arguments_as_array::<2>();
        let (this, settled_results) = self.settled_results_prologue(
            global,
            frame.this(),
            "toHaveNthResolvedWith",
            "<green>n<r>, <green>expected<r>",
        )?;

        if !nth_arg.is_any_int() {
            return Err(global.throw_invalid_arguments(format_args!(
                "toHaveNthResolvedWith() first argument must be an integer"
            )));
        }
        let n = nth_arg.to_int32();
        if n <= 0 {
            return Err(global.throw_invalid_arguments(format_args!(
                "toHaveNthResolvedWith() n must be greater than 0"
            )));
        }

        one_call_resolved_with(
            &this,
            global,
            settled_results,
            "toHaveNthResolvedWith",
            "<green>n<r>, <green>expected<r>",
            Call::Nth(n.unsigned_abs()),
            expected,
        )
    }
}

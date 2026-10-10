use core::fmt;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::mock;
use super::throw;
use super::Expect;

#[derive(Clone, Copy)]
enum Order {
    Before,
    After,
}

impl Order {
    const fn matcher_name(self) -> &'static str {
        match self {
            Order::Before => "toHaveBeenCalledBefore",
            Order::After => "toHaveBeenCalledAfter",
        }
    }

    const fn word(self) -> &'static str {
        match self {
            Order::Before => "before",
            Order::After => "after",
        }
    }
}

/// `mock.invocationCallOrder[0]`.
struct FirstInvocation(Option<f64>);

impl FirstInvocation {
    fn of(global: &JSGlobalObject, mock_fn: JSValue) -> JsResult<Self> {
        let state = mock_fn.get(global, "mock")?.unwrap_or(JSValue::UNDEFINED);
        let order = if state.is_object() {
            state.get(global, "invocationCallOrder")?.unwrap_or(JSValue::UNDEFINED)
        } else {
            JSValue::UNDEFINED
        };
        if !order.js_type().is_array() {
            let mut formatter = super::make_formatter(global);
            return Err(global.throw(format_args!(
                "Expected value must be a mock function with calls: {}",
                mock_fn.to_fmt(&mut formatter),
            )));
        }
        if order.get_length(global)? == 0 {
            return Ok(Self(None));
        }
        Ok(Self(Some(order.get_index(global, 0)?.to_number(global)?)))
    }
}

impl fmt::Display for FirstInvocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(id) => write!(f, "invocation {id}"),
            None => f.write_str("(no calls)"),
        }
    }
}

fn to_have_been_called_in_order(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
    order: Order,
) -> JsResult<JSValue> {
    let [other, fail_if_no_first_invocation] = frame.arguments_as_array::<2>();
    let fail_if_no_first_invocation =
        fail_if_no_first_invocation.is_undefined() || fail_if_no_first_invocation.to_boolean();
    let (this, _calls, value) = this.mock_prologue(
        global,
        frame.this(),
        order.matcher_name(),
        "<green>expected<r>",
        mock::MockKind::CallsWithSig,
    )?;
    let not = this.flags.get().not();
    let signature = Expect::get_signature(order.matcher_name(), "<green>expected<r>", not);

    if !bun_jsc::cpp::JSMockFunction__getCalls(global, other)?.js_type().is_array() {
        let mut formatter = super::make_formatter(global);
        return throw!(
            this,
            global,
            signature,
            "\n\nMatcher error: <green>expected<r> value must be a mock function\nExpected: {}",
            other.to_fmt(&mut formatter),
        );
    }

    let received = FirstInvocation::of(global, value)?;
    let expected = FirstInvocation::of(global, other)?;
    let (first, second) = match order {
        Order::Before => (&received, &expected),
        Order::After => (&expected, &received),
    };
    let pass = match (first.0, second.0) {
        (None, _) => !fail_if_no_first_invocation,
        (Some(_), None) => false,
        (Some(first), Some(second)) => first < second,
    };

    if pass != not {
        return Ok(JSValue::UNDEFINED);
    }

    throw!(
        this,
        global,
        signature,
        concat!(
            "\n\n",
            "Expected the first call of <red>received<r> {}to be {} the first call of <green>expected<r>\n\n",
            "First call of received: <red>{}<r>\n",
            "First call of expected: <green>{}<r>\n",
        ),
        if not { "not " } else { "" },
        order.word(),
        received,
        expected,
    )
}

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_been_called_before(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        to_have_been_called_in_order(self, global, frame, Order::Before)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn to_have_been_called_after(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        to_have_been_called_in_order(self, global, frame, Order::After)
    }
}

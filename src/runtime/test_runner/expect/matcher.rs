//! One call of a matcher: it is counted, reads the received value, then passes or fails.

use core::fmt::{self, Write as _};

use bun_core::{Output, write_pretty};
use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};

use super::expect_deferred::{MatcherCall, Settled};
use super::{Promise, js, show};
use crate::test_runner::diff_format::DiffFormatter;

pub(crate) type This<'a> = &'a MatcherCall<'a>;
pub(crate) type Verdict = JsResult<Passed>;

/// What a matcher returns to script. Only a [`Matcher`] makes one, so no matcher passes without being counted.
pub(crate) struct Passed(JSValue);

impl Passed {
    #[inline]
    pub(super) fn into_js(self) -> JSValue {
        self.0
    }
}

/// The parameters in `expect(received).toBe(expected)`, without and with colors.
#[derive(Clone, Copy)]
pub(super) struct Params(pub(super) &'static [&'static str; 2]);

macro_rules! params {
    ($markup:literal) => {
        $crate::test_runner::expect::matcher::Params(&[
            ::bun_core::pretty_fmt!($markup, false),
            ::bun_core::pretty_fmt!($markup, true),
        ])
    };
}
pub(super) use params;

pub(super) const NO_PARAMS: Params = params!("");
pub(super) const EXPECTED: Params = params!("<green>expected<r>");

impl fmt::Display for Params {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0[usize::from(Output::enable_ansi_colors_stderr())])
    }
}

/// `Err` of [`Matcher::fail`]. Only the template is read for `<tag>` markup, never the arguments.
macro_rules! fail {
    ($matcher:expr, $template:expr $(, $argument:expr)* $(,)?) => {
        Err(if ::bun_core::Output::enable_ansi_colors_stderr() {
            $matcher.fail(format_args!(::bun_core::pretty_fmt!($template, true) $(, $argument)*))
        } else {
            $matcher.fail(format_args!(::bun_core::pretty_fmt!($template, false) $(, $argument)*))
        })
    };
}
pub(super) use fail;

/// A call that `expect.assertions()` has counted.
#[derive(Clone, Copy)]
pub(super) struct Matcher<'a> {
    pub(super) call: This<'a>,
    pub(super) global: &'a JSGlobalObject,
    pub(super) name: &'static str,
    params: Params,
    signed_not: bool,
}

/// A call that has not been counted yet. It can't pass.
pub(super) struct Uncounted<'a>(Matcher<'a>);

impl<'a> MatcherCall<'a> {
    #[inline]
    pub(super) fn begin(&'a self, cx: &'a mut JsScope<'_>, name: &'static str, params: Params) -> Uncounted<'a> {
        Uncounted(Matcher { call: self, global: cx.global(), name, params, signed_not: self.flags.not() })
    }

    /// Reads the received value, then counts the call.
    #[inline]
    pub(super) fn start(
        &'a self,
        cx: &'a mut JsScope<'_>,
        name: &'static str,
        params: Params,
    ) -> JsResult<(Matcher<'a>, JSValue)> {
        let call = self.begin(cx, name, params);
        let received = call.received()?;
        Ok((call.count(), received))
    }

    /// The value in `expect(value)`, or what it settled with after `.resolves` / `.rejects`.
    #[inline]
    pub(super) fn received(
        &self,
        global: &JSGlobalObject,
        name: &dyn fmt::Display,
        params: &dyn fmt::Display,
    ) -> JsResult<JSValue> {
        match js::captured_value_get_cached(self.this) {
            Some(value) if self.flags.promise() == Promise::None => Ok(value),
            value => self.received_from_promise(global, value, name, params),
        }
    }

    #[cold]
    #[optimize(size)]
    fn received_from_promise(
        &self,
        global: &JSGlobalObject,
        value: Option<JSValue>,
        name: &dyn fmt::Display,
        params: &dyn fmt::Display,
    ) -> JsResult<JSValue> {
        let Some(value) = value else {
            return Err(global.throw(format_args!(
                "Internal error: the expect(value) was garbage collected but it should not have been!"
            )));
        };
        let promise = self.flags.promise();
        let (expected, received) = match (self.settled, promise) {
            (Settled::NotAPromise, _) => ("Expected promise", "Received: "),
            (Settled::Fulfilled(_), Promise::Rejects) => {
                ("Expected promise that rejects", "Received promise that resolved: ")
            }
            (Settled::Rejected(_), Promise::Resolves) => {
                ("Expected promise that resolves", "Received promise that rejected: ")
            }
            (Settled::Fulfilled(settled) | Settled::Rejected(settled), _) => return Ok(settled),
        };
        let signature = Signature { promise, not: self.flags.not(), name, params };
        let colors = Output::enable_ansi_colors_stderr();
        let body = fmt::from_fn(|f| {
            write_pretty!(f, colors, "{}<r>\n{}<red>{}<r>\n", expected, received, show(global, value))
        });
        Err(global.throw(format_args!("{}\n\n{body}", self.label_or(&signature))))
    }

    fn label_or<'l>(&'l self, signature: &'l dyn fmt::Display) -> &'l dyn fmt::Display {
        if self.expect.custom_label.is_empty() { signature } else { &self.expect.custom_label }
    }
}

/// `expect(received).resolves.not.toBe(expected)`
struct Signature<'a> {
    promise: Promise,
    not: bool,
    name: &'a dyn fmt::Display,
    params: &'a dyn fmt::Display,
}

impl fmt::Display for Signature<'_> {
    #[optimize(size)]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let colors = Output::enable_ansi_colors_stderr();
        write_pretty!(f, colors, "<d>expect(<r><red>received<r><d>).<r>")?;
        match self.promise {
            Promise::None => {}
            Promise::Resolves => write_pretty!(f, colors, "resolves<d>.<r>")?,
            Promise::Rejects => write_pretty!(f, colors, "rejects<d>.<r>")?,
        }
        if self.not {
            write_pretty!(f, colors, "not<d>.<r>")?;
        }
        write_pretty!(f, colors, "{}<d>(<r>{}<d>)<r>", self.name, self.params)
    }
}

impl<'a> Uncounted<'a> {
    #[inline]
    pub(super) fn global(&self) -> &'a JSGlobalObject {
        self.0.global
    }

    #[inline]
    pub(super) fn received(&self) -> JsResult<JSValue> {
        self.0.received()
    }

    /// Before anything that can `Pass::wait_for`: `matcher_threw` takes the count back.
    #[inline]
    pub(super) fn count(self) -> Matcher<'a> {
        self.0.call.expect.increment_expect_call_counter();
        self.0
    }
}

impl<'a> Matcher<'a> {
    #[inline]
    pub(super) fn received(&self) -> JsResult<JSValue> {
        self.call.received(self.global, &self.name, &self.params)
    }

    #[inline]
    pub(super) fn promise(&self) -> Promise {
        self.call.flags.promise()
    }

    #[inline]
    pub(super) fn not(&self) -> bool {
        self.call.flags.not()
    }

    pub(super) fn not_word(&self) -> &'static str {
        if self.not() { "not " } else { "" }
    }

    #[inline]
    pub(super) fn passes(&self, matched: bool) -> bool {
        matched != self.not()
    }

    #[inline]
    pub(super) fn pass(&self) -> Verdict {
        self.pass_with(JSValue::UNDEFINED)
    }

    /// For the `chainable` matchers of expect.bind.ts.
    #[inline]
    pub(super) fn pass_this(&self) -> Verdict {
        self.pass_with(self.call.this)
    }

    #[inline]
    pub(super) fn pass_with(&self, returned: JSValue) -> Verdict {
        Ok(Passed(returned))
    }

    pub(super) fn show(&self, value: JSValue) -> impl fmt::Display + use<'a> {
        show(self.global, value)
    }

    /// For a failure whose signature has other parameters.
    pub(super) fn with_params(&self, params: Params) -> Self {
        Self { params, ..*self }
    }

    /// For a failure whose signature has `.not`, or lacks it, whatever the call has.
    pub(super) fn signed_not(&self, signed_not: bool) -> Self {
        Self { signed_not, ..*self }
    }

    /// Throws `body` under the label or the signature.
    #[cold]
    #[optimize(size)]
    pub(super) fn fail(&self, body: fmt::Arguments<'_>) -> JsError {
        self.fail_under(
            &Signature { promise: Promise::None, not: self.signed_not, name: &self.name, params: &self.params },
            body,
        )
    }

    /// An argument error that has the label, but no signature.
    #[cold]
    #[optimize(size)]
    pub(super) fn fail_unsigned(&self, error: &str) -> JsError {
        self.fail_under(&"", format_args!("Matcher error: {error}\n"))
    }

    #[cold]
    #[optimize(size)]
    fn fail_under(&self, signature: &dyn fmt::Display, body: fmt::Arguments<'_>) -> JsError {
        let mut message = String::with_capacity(256);
        let rendered = write!(message, "{}\n\n{body}", self.call.label_or(signature));
        // If printing a value threw (a getter, a Proxy trap), propagate that error like Jest does.
        if rendered.is_err() && self.global.has_exception() {
            return JsError::Thrown;
        }
        self.global.throw(format_args!("{message}"))
    }

    #[cold]
    #[optimize(size)]
    pub(super) fn fail_received(&self, received: JSValue) -> Verdict {
        fail!(self, "Received: <red>{}<r>\n", self.show(received))
    }

    #[cold]
    #[optimize(size)]
    pub(super) fn fail_expected(&self, expected: JSValue, received: JSValue) -> Verdict {
        fail!(
            self,
            "Expected: {}<green>{}<r>\nReceived: <red>{}<r>\n",
            self.not_word(),
            self.show(expected),
            self.show(received)
        )
    }

    #[cold]
    #[optimize(size)]
    pub(super) fn fail_expected_to(&self, verb: &str, expected: JSValue, received: JSValue) -> Verdict {
        fail!(
            self,
            "Expected to {}{}: <green>{}<r>\nReceived: <red>{}<r>\n",
            self.not_word(),
            verb,
            self.show(expected),
            self.show(received),
        )
    }

    #[cold]
    #[optimize(size)]
    pub(super) fn fail_diff(&self, expected: JSValue, received: JSValue) -> Verdict {
        let diff = DiffFormatter::new(self.global, received, expected, self.not())?;
        Err(self.fail(format_args!("{diff}\n")))
    }
}

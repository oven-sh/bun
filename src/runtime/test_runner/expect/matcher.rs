//! One call of a matcher: it is counted, reads the received value, then passes or fails.

use core::fmt::{self, Write as _};

use bun_core::{Output, write_pretty};
use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::js_promise::Status;
use bun_jsc::{AnyPromise, JSGlobalObject, JSValue, JsError, JsResult};

use super::{Expect, Flags, Promise, js, show};
use crate::test_runner::diff_format::DiffFormatter;

pub(crate) type This<'a> = JsWrapper<'a, Expect>;
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
    pub(super) expect: &'a Expect,
    pub(super) global: &'a JSGlobalObject,
    pub(super) this: JSValue,
    pub(super) name: &'static str,
    params: Params,
    /// As they were when the call began: script that the matcher runs can read `.not` on the same `expect()`.
    flags: Flags,
}

/// A call that has not been counted yet. It can't pass.
pub(super) struct Uncounted<'a>(Matcher<'a>);

impl Expect {
    #[inline]
    pub(super) fn begin<'a>(
        &'a self,
        this: This<'_>,
        cx: &'a mut JsScope<'_>,
        name: &'static str,
        params: Params,
    ) -> Uncounted<'a> {
        Uncounted(Matcher {
            expect: self,
            global: cx.global(),
            this: this.to_js(),
            name,
            params,
            flags: self.flags.get(),
        })
    }

    /// Reads the received value, then counts the call.
    #[inline]
    pub(super) fn start<'a>(
        &'a self,
        this: This<'_>,
        cx: &'a mut JsScope<'_>,
        name: &'static str,
        params: Params,
    ) -> JsResult<(Matcher<'a>, JSValue)> {
        let call = self.begin(this, cx, name, params);
        let received = call.received()?;
        Ok((call.count(), received))
    }

    /// The value in `expect(value)`, or what it settled with after `.resolves` / `.rejects`.
    #[inline]
    pub(super) fn received(
        &self,
        global: &JSGlobalObject,
        this: JSValue,
        flags: Flags,
        name: &dyn fmt::Display,
        params: &dyn fmt::Display,
    ) -> JsResult<JSValue> {
        match js::captured_value_get_cached(this) {
            Some(value) if flags.promise() == Promise::None => Ok(value),
            value => self.settled(
                global,
                this,
                value,
                &Signature { promise: flags.promise(), not: flags.not(), name, params },
            ),
        }
    }

    #[cold]
    #[optimize(size)]
    fn settled(
        &self,
        global: &JSGlobalObject,
        this: JSValue,
        value: Option<JSValue>,
        signature: &Signature<'_>,
    ) -> JsResult<JSValue> {
        let Some(value) = value else {
            return Err(global.throw(format_args!(
                "Internal error: the expect(value) was garbage collected but it should not have been!"
            )));
        };
        // `call_matcher_on_promise` keeps the promise there.
        let promise = js::result_value_get_cached(this).and_then(JSValue::as_any_promise);
        let (expected, received) = match settle(global, signature.promise, promise) {
            Ok(settled) => return Ok(settled),
            Err(Mismatch::NotAPromise) => ("Expected promise", "Received: "),
            Err(Mismatch::Resolved) => ("Expected promise that rejects", "Received promise that resolved: "),
            Err(Mismatch::Rejected) => ("Expected promise that resolves", "Received promise that rejected: "),
        };
        let colors = Output::enable_ansi_colors_stderr();
        let body = fmt::from_fn(|f| {
            write_pretty!(f, colors, "{}<r>\n{}<red>{}<r>\n", expected, received, show(global, value))
        });
        Err(global.throw(format_args!("{}\n\n{body}", self.label_or(signature))))
    }

    fn label_or<'a>(&'a self, signature: &'a dyn fmt::Display) -> &'a dyn fmt::Display {
        if self.custom_label.is_empty() { signature } else { &self.custom_label }
    }
}

pub(super) enum Mismatch {
    NotAPromise,
    Resolved,
    Rejected,
}

/// What `promise`, which is not pending, settled with, if it settled the way `expected` says.
pub(super) fn settle(
    global: &JSGlobalObject,
    expected: Promise,
    promise: Option<AnyPromise>,
) -> Result<JSValue, Mismatch> {
    let promise = promise.ok_or(Mismatch::NotAPromise)?;
    match (promise.status(), expected) {
        (Status::Pending, _) => unreachable!(),
        (Status::Fulfilled, Promise::Rejects) => Err(Mismatch::Resolved),
        (Status::Rejected, Promise::Resolves) => Err(Mismatch::Rejected),
        _ => Ok(promise.result(global.vm())),
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
        self.0.expect.increment_expect_call_counter();
        self.0
    }
}

impl<'a> Matcher<'a> {
    #[inline]
    pub(super) fn received(&self) -> JsResult<JSValue> {
        self.expect.received(self.global, self.this, self.flags, &self.name, &self.params)
    }

    #[inline]
    pub(super) fn promise(&self) -> Promise {
        self.flags.promise()
    }

    #[inline]
    pub(super) fn not(&self) -> bool {
        self.flags.not()
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
        self.pass_with(self.this)
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
    pub(super) fn signed_not(&self, not: bool) -> Self {
        let mut signed = *self;
        signed.flags.set_not(not);
        signed
    }

    /// Throws `body` under the label or the signature.
    #[cold]
    #[optimize(size)]
    pub(super) fn fail(&self, body: fmt::Arguments<'_>) -> JsError {
        self.fail_under(
            &Signature { promise: Promise::None, not: self.not(), name: &self.name, params: &self.params },
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
        let mut message = String::new();
        let rendered = write!(message, "{}\n\n{body}", self.expect.label_or(signature));
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

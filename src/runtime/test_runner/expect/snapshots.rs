use bun_core::Utf8Bytes;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSPromise, JSStringView, JSValue, JsResult};
use bun_sys_jsc::ErrorJsc as _;

use super::matcher::{Matcher, NO_PARAMS, Params, This, Verdict, fail, params};
use super::{Expect, Received};
use crate::test_runner::diff_format::DiffFormatter;
use crate::test_runner::jest::Jest;
use crate::test_runner::pretty_format::JestPrettyFormat;
use crate::test_runner::snapshot::{FileOutcome, Format};

const PROPERTIES_HINT: Params = params!("<green>properties<r><d>, <r>hint");

#[cold]
pub(super) fn fail_outside_of_a_test(m: &Matcher<'_>, signed_not: bool) -> Verdict {
    fail!(
        m.with_params(NO_PARAMS).signed_not(signed_not),
        "<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n"
    )
}

fn properties_argument(m: &Matcher<'_>, properties: JSValue) -> JsResult<JSValue> {
    if properties.is_object() {
        return Ok(properties);
    }
    fail!(m, "Matcher error: Expected <green>properties<r> must be an object\n")
}

fn thrown(m: &Matcher<'_>) -> JsResult<Received> {
    match Expect::call_to_throw(m, m.received()?)? {
        Received::Value(_) => fail!(m.with_params(NO_PARAMS), "<b>Matcher error<r>: Received function did not throw\n"),
        thrown => Ok(thrown),
    }
}

fn utf8<'a>(text: &'a Option<JSStringView<'_>>) -> Option<Utf8Bytes<'a>> {
    text.as_ref().map(|text| text.to_utf8())
}

#[optimize(size)]
fn begin_snapshot<'a>(
    this: This<'a>,
    cx: &'a mut JsScope<'_>,
    name: &'static str,
    params: Params,
) -> JsResult<Matcher<'a>> {
    let m = this.begin(cx, name, params).count();
    if m.not() {
        return fail!(
            m.with_params(NO_PARAMS),
            "<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n"
        );
    }
    Ok(m)
}

impl Expect {
    #[optimize(size)]
    pub(crate) fn to_match_snapshot(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        first: JsLocal<'_>,
        second: JsLocal<'_>,
    ) -> Verdict {
        let m = begin_snapshot(this, cx, "toMatchSnapshot", PROPERTIES_HINT)?;
        let Some(_file) = self.bun_test() else { return fail_outside_of_a_test(&m, true) };
        let (first, second) = (first.to_js(), second.to_js());
        let (properties, hint) = if !second.is_undefined() {
            let properties = properties_argument(&m, first)?;
            if !second.is_string() {
                return Err(m.fail_unsigned("Expected second argument to be a string"));
            }
            (Some(properties), Some(second.to_js_string_view(m.global)?))
        } else if first.is_string() {
            (None, Some(first.to_js_string_view(m.global)?))
        } else if first.is_object() {
            (Some(first), None)
        } else if first.is_undefined() {
            (None, None)
        } else {
            return Err(m.fail_unsigned("Expected first argument to be a string or object"));
        };
        Self::snapshot(&m, Received::Value(m.received()?), properties, utf8(&hint).as_deref().unwrap_or_default())
    }

    #[optimize(size)]
    pub(crate) fn to_match_inline_snapshot(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> Verdict {
        let m = begin_snapshot(this, cx, "toMatchInlineSnapshot", PROPERTIES_HINT)?;
        let (properties, saved) = match *JsLocal::to_js_slice(args) {
            [] => (None, None),
            [saved] if saved.is_string() => (None, Some(saved.to_js_string_view(m.global)?)),
            [properties] if properties.is_object() => (Some(properties), None),
            [_] => return Err(m.fail_unsigned("Expected first argument to be a string or object")),
            [properties, saved, ..] => (
                Some(properties_argument(&m, properties)?),
                if saved.is_string() { Some(saved.to_js_string_view(m.global)?) } else { None },
            ),
        };
        Self::inline_snapshot(&m, Received::Value(m.received()?), properties, utf8(&saved).as_deref())
    }

    #[optimize(size)]
    pub(crate) fn to_throw_error_matching_snapshot(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        hint: JsLocal<'_>,
    ) -> Verdict {
        let m = begin_snapshot(this, cx, "toThrowErrorMatchingSnapshot", PROPERTIES_HINT)?;
        let Some(_file) = self.bun_test() else { return fail_outside_of_a_test(&m, true) };
        let hint = match hint.to_js() {
            hint if hint.is_string() => Some(hint.to_js_string_view(m.global)?),
            hint if hint.is_undefined() => None,
            _ => return Err(m.fail_unsigned("Expected first argument to be a string")),
        };
        let hint = utf8(&hint);
        Self::snapshot(&m, thrown(&m)?, None, hint.as_deref().unwrap_or_default())
    }

    #[optimize(size)]
    pub(crate) fn to_throw_error_matching_inline_snapshot(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        args: &[JsLocal<'_>],
    ) -> Verdict {
        let m = begin_snapshot(this, cx, "toThrowErrorMatchingInlineSnapshot", PROPERTIES_HINT)?;
        let saved = match *JsLocal::to_js_slice(args) {
            [] => None,
            [saved] if saved.is_string() => Some(saved.to_js_string_view(m.global)?),
            [_] => return Err(m.fail_unsigned("Expected first argument to be a string")),
            _ => return Err(m.fail_unsigned("Expected zero or one arguments")),
        };
        let saved = utf8(&saved);
        Self::inline_snapshot(&m, thrown(&m)?, None, saved.as_deref())
    }

    #[optimize(size)]
    pub(crate) fn to_match_file_snapshot(
        &self,
        this: This<'_>,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        hint: JsLocal<'_>,
    ) -> Verdict {
        let m = begin_snapshot(this, cx, "toMatchFileSnapshot", params!("<green>path<r><d>, <r>hint"))?;
        let global = m.global;
        let (Some(_), Some(runner)) = (self.bun_test(), Jest::runner()) else {
            return fail_outside_of_a_test(&m, true);
        };
        let (path, hint) = (path.to_js(), hint.to_js());
        if !path.is_string() {
            return Err(m.fail_unsigned("Expected first argument to be a string"));
        }
        if !hint.is_undefined() && !hint.is_string() {
            return Err(m.fail_unsigned("Expected second argument to be a string"));
        }
        let path = path.to_js_string_view(global)?;
        if path.index_of_ascii_char(0).is_some() {
            return Err(m.fail_unsigned("Expected first argument to be a string without null bytes"));
        }
        let hint = if hint.is_string() { Some(hint.to_js_string_view(global)?) } else { None };

        let value = m.received()?;
        let mut received: Vec<u8> = Vec::new();
        if value.is_string_literal() {
            received.extend_from_slice(value.to_js_string_view(global)?.to_utf8().slice());
        } else {
            JestPrettyFormat::print_snapshot(global, value, None, &mut received, Format::Vitest)?;
            if received.len() > 2 && received.starts_with(b"\n") && received.ends_with(b"\n") {
                received.pop();
                received.remove(0);
            }
        }

        let (path, hint) = (path.to_utf8(), utf8(&hint));
        match runner.with_snapshots(|snapshots| snapshots.match_or_write_file(self, &path, &received, hint.as_deref().unwrap_or_default())) {
            FileOutcome::Passed | FileOutcome::Written => m.pass_with(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED)),
            FileOutcome::Mismatch { saved } => {
                let diff = DiffFormatter::from_strings(&received, &saved, false);
                Err(m.with_params(params!("<green>path<r>")).fail(format_args!("{diff}\n")))
            }
            FileOutcome::IsSnapshotFile => Err(global.throw(format_args!(
                "toMatchFileSnapshot() can't write to the test file's own .snap file: {}",
                bstr::BStr::new(path.slice()),
            ))),
            FileOutcome::NotAllowedInCI => Err(global.throw(format_args!(
                "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nSnapshot file: \"{}\"\nReceived: {}",
                bstr::BStr::new(path.slice()),
                bstr::BStr::new(&received),
            ))),
            FileOutcome::NoTest(err) => Err(self.throw_snapshot_error(global, &err, &received)),
            FileOutcome::Failed(err) => Err(global.throw_value(err.to_js(global)?)),
        }
    }
}

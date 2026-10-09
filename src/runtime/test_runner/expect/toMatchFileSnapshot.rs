use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult};
use bun_sys_jsc::ErrorJsc as _;

use super::super::jest::Jest;
use super::super::pretty_format::JestPrettyFormat;
use super::super::snapshot::{FileOutcome, Format};
use super::DiffFormatter;
use super::Expect;
use super::get_signature;
use super::throw;

pub(crate) fn to_match_file_snapshot(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let this = this.post_match_guard(global);
    let this_value = frame.this();
    let [path, hint] = frame.arguments_as_array::<2>();

    this.increment_expect_call_counter();

    if this.flags.get().not() {
        let signature = get_signature("toMatchFileSnapshot", "", true);
        return throw!(
            this,
            global,
            signature,
            "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n",
        );
    }
    let (Some(_), Some(runner)) = (this.bun_test(), Jest::runner()) else {
        let signature = get_signature("toMatchFileSnapshot", "", true);
        return throw!(
            this,
            global,
            signature,
            "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n",
        );
    };
    if !path.is_string() {
        return throw!(this, global, "", "\n\nMatcher error: Expected first argument to be a string\n");
    }
    if !hint.is_undefined() && !hint.is_string() {
        return throw!(this, global, "", "\n\nMatcher error: Expected second argument to be a string\n");
    }
    let path = path.to_js_string_view(global)?;
    if path.index_of_ascii_char(0).is_some() {
        return throw!(this, global, "", "\n\nMatcher error: Expected first argument to be a string without null bytes\n");
    }
    let hint = if hint.is_string() { Some(hint.to_js_string_view(global)?) } else { None };
    let hint = hint.as_ref().map_or(bun_core::Utf8Bytes::EMPTY, |hint| hint.to_utf8());

    let value = this.get_value(global, this_value, "toMatchFileSnapshot", "<green>path<r><d>, <r>hint")?;
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

    match runner.snapshots.match_or_write_file(&this, path.to_utf8().slice(), &received, hint.slice()) {
        FileOutcome::Passed | FileOutcome::Written => Ok(JSPromise::resolved_promise_value(global, JSValue::UNDEFINED)),
        FileOutcome::Mismatch { saved } => {
            let signature = get_signature("toMatchFileSnapshot", "<green>path<r>", false);
            let diff_format = DiffFormatter::from_strings(&received, &saved, false);
            throw!(this, global, signature, "\n\n{}\n", diff_format)
        }
        FileOutcome::IsSnapshotFile => Err(global.throw(format_args!(
            "toMatchFileSnapshot() cannot use the file that holds the other snapshots of the test file: {}",
            bstr::BStr::new(path.to_utf8().slice()),
        ))),
        FileOutcome::NotAllowedInCI => Err(global.throw(format_args!(
            "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nSnapshot file: \"{}\"\nReceived: {}",
            bstr::BStr::new(path.to_utf8().slice()),
            bstr::BStr::new(&received),
        ))),
        FileOutcome::NoTest(err) => Err(this.throw_snapshot_error(global, &err, &received)),
        FileOutcome::Failed(err) => Err(global.throw_value(err.to_js(global)?)),
    }
}

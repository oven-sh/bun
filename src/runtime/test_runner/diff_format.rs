use core::fmt;
use std::borrow::Cow;

use bun_core::Output;
use bun_jsc::{DeepMatchStop, JSGlobalObject, JSValue, JsResult, MatchedRows};

use super::diff::print_diff::{print_diff_main, DiffConfig};
use super::expect::expect_deferred::Pass;
use super::pretty_format::{FormatOptions, JestPrettyFormat, MessageLevel};

/// Renders a Jest-style diff of two already-formatted values. Formatting a JS value runs user code
/// (getters, Proxy traps) and can throw, so it happens up front in [`DiffFormatter::new`], never
/// inside `Display::fmt`.
pub(crate) struct DiffFormatter<'a> {
    pub(crate) received_string: Cow<'a, [u8]>,
    pub(crate) expected_string: Cow<'a, [u8]>,
    pub(crate) not: bool,
}

impl<'a> DiffFormatter<'a> {
    #[optimize(size)]
    pub(crate) fn new(
        global_this: &JSGlobalObject,
        received: JSValue,
        expected: JSValue,
        not: bool,
    ) -> JsResult<DiffFormatter<'static>> {
        let received_string = Cow::Owned(Self::print(global_this, received, MatchedRows::default(), None)?);
        let expected_string = Cow::Owned(Self::print(global_this, expected, MatchedRows::default(), None)?);
        Ok(DiffFormatter { received_string, expected_string, not })
    }

    /// The diff of a `toMatchObject()` that failed at `stop`. `received` prints each matcher of `expected` that passed
    /// in place of what it matched. The comparison asked only the matchers before `stop`, so the others are asked here.
    #[optimize(size)]
    pub(crate) fn of_failed_match(
        global_this: &JSGlobalObject,
        received: JSValue,
        expected: JSValue,
        stop: &DeepMatchStop,
    ) -> JsResult<DiffFormatter<'static>> {
        let printed_matcher = core::cell::Cell::new(false);
        let expected_string =
            Cow::Owned(Self::print(global_this, expected, MatchedRows::default(), Some(&printed_matcher))?);
        // A pattern that prints no matcher leaves none to show.
        let rows = if printed_matcher.get() {
            let pass = Pass::collecting();
            let _entered = pass.enter();
            received.jest_matched_rows(expected, global_this, stop)?
        } else {
            MatchedRows::default()
        };
        let received_string = Cow::Owned(Self::print(global_this, received, rows, None)?);
        Ok(DiffFormatter { received_string, expected_string, not: false })
    }

    fn print(
        global_this: &JSGlobalObject,
        value: JSValue,
        rows: MatchedRows,
        printed_matcher: Option<&core::cell::Cell<bool>>,
    ) -> JsResult<Vec<u8>> {
        let mut printed: Vec<u8> = Vec::new();
        JestPrettyFormat::format(
            MessageLevel::Debug,
            global_this,
            core::slice::from_ref(&value),
            1,
            &mut printed,
            FormatOptions { enable_colors: false, add_newline: false, flush: false, quote_strings: true },
            rows,
            printed_matcher,
        )?;
        Ok(trim_one_newline(printed))
    }

    pub(crate) fn from_strings(received: &'a [u8], expected: &'a [u8], not: bool) -> Self {
        DiffFormatter {
            received_string: Cow::Borrowed(received),
            expected_string: Cow::Borrowed(expected),
            not,
        }
    }
}

fn trim_one_newline(mut buf: Vec<u8>) -> Vec<u8> {
    if buf.ends_with(b"\n") {
        buf.pop();
    }
    if buf.starts_with(b"\n") {
        buf.remove(0);
    }
    buf
}

impl<'a> fmt::Display for DiffFormatter<'a> {
    #[optimize(size)]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let diff_config =
            DiffConfig::default(Output::is_ai_agent(), Output::enable_ansi_colors_stderr());
        print_diff_main(
            self.not,
            &self.received_string,
            &self.expected_string,
            f,
            &diff_config,
        )
    }
}

/// C++ bridge for `BunAnalyzeTranspiledModule.cpp` — renders a diff between the
/// JSC-parsed module record and Bun's transpiler output when they disagree.
///
/// Lives here (not in
/// `bun_bundler_jsc::analyze_jsc`) because `DiffFormatter` is a `bun_runtime`
/// type and `bun_bundler_jsc` is a lower-tier crate that cannot depend on it;
/// the `extern "C"` symbol resolves the same at link time regardless of which
/// crate defines it.
#[unsafe(no_mangle)]
extern "C" fn zig__renderDiff(
    expected_ptr: *const core::ffi::c_char,
    expected_len: usize,
    received_ptr: *const core::ffi::c_char,
    received_len: usize,
) {
    // SAFETY: caller (BunAnalyzeTranspiledModule.cpp) passes a valid UTF-8 buffer
    // of length `expected_len` that outlives this call.
    let expected = unsafe { bun_core::ffi::slice(expected_ptr.cast::<u8>(), expected_len) };
    // SAFETY: caller (BunAnalyzeTranspiledModule.cpp) passes a valid UTF-8 buffer
    // of length `received_len` that outlives this call.
    let received = unsafe { bun_core::ffi::slice(received_ptr.cast::<u8>(), received_len) };
    let formatter = DiffFormatter::from_strings(received, expected, false);
    let _ = bun_core::output::error_writer().print(format_args!("DIFF:\n{}\n", formatter));
}

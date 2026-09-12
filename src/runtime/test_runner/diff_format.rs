use core::fmt;
use std::borrow::Cow;

use bun_core::Output;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use super::diff::print_diff::{print_diff_main, DiffConfig};
use super::pretty_format::{FormatOptions, JestPrettyFormat, MessageLevel};

/// Cap on the pretty-printed size of each side of an assertion diff. A value that is reachable N
/// ways is printed N times, so without a cap a small graph of shared references expands
/// exponentially and allocates until the machine dies. https://github.com/oven-sh/bun/issues/34178
const MAX_PRETTY_PRINT_BYTES: usize = 1024 * 1024;

const TRUNCATION_NOTICE: &[u8] = b"\n... [value too large, output truncated]";

/// Renders a Jest-style diff of two already-formatted values. Formatting a JS value runs user code
/// (getters, Proxy traps) and can throw, so it happens up front in [`DiffFormatter::new`], never
/// inside `Display::fmt`.
pub struct DiffFormatter<'a> {
    pub(crate) received_string: Cow<'a, [u8]>,
    pub(crate) expected_string: Cow<'a, [u8]>,
    pub(crate) not: bool,
}

impl<'a> DiffFormatter<'a> {
    pub fn new(
        global_this: &JSGlobalObject,
        received: JSValue,
        expected: JSValue,
        not: bool,
    ) -> JsResult<DiffFormatter<'static>> {
        Ok(DiffFormatter {
            received_string: Cow::Owned(format_capped(global_this, received)?),
            expected_string: Cow::Owned(format_capped(global_this, expected)?),
            not,
        })
    }

    pub fn from_strings(received: &'a [u8], expected: &'a [u8], not: bool) -> Self {
        DiffFormatter {
            received_string: Cow::Borrowed(received),
            expected_string: Cow::Borrowed(expected),
            not,
        }
    }
}

/// Pretty-prints one side of the diff, keeping at most [`MAX_PRETTY_PRINT_BYTES`] of it.
fn format_capped(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Vec<u8>> {
    let mut buf: Vec<u8> = Vec::new();
    let truncated = JestPrettyFormat::format_capped(
        MessageLevel::Debug,
        global_this,
        core::slice::from_ref(&value),
        1,
        &mut buf,
        FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            quote_strings: true,
        },
        MAX_PRETTY_PRINT_BYTES,
    )?;
    if truncated {
        buf.extend_from_slice(TRUNCATION_NOTICE);
    }
    Ok(trim_one_newline(buf))
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

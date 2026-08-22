use core::fmt;
use std::borrow::Cow;

use bun_core::Output;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use super::diff::print_diff::{print_diff_main, DiffConfig};
use super::pretty_format::{FormatOptions, JestPrettyFormat, MessageLevel};

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
        let fmt_options = FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            quote_strings: true,
        };
        let mut received_buf: Vec<u8> = Vec::new();
        JestPrettyFormat::format(
            MessageLevel::Debug,
            global_this,
            core::slice::from_ref(&received),
            1,
            &mut received_buf,
            fmt_options,
        )?;
        let mut expected_buf: Vec<u8> = Vec::new();
        JestPrettyFormat::format(
            MessageLevel::Debug,
            global_this,
            core::slice::from_ref(&expected),
            1,
            &mut expected_buf,
            fmt_options,
        )?;
        Ok(DiffFormatter {
            received_string: Cow::Owned(trim_one_newline(received_buf)),
            expected_string: Cow::Owned(trim_one_newline(expected_buf)),
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

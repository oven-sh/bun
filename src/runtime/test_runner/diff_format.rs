use core::fmt;

use bun_core::Output;
use bun_jsc::{JSGlobalObject, JSValue};

use super::diff::print_diff::{print_diff_main, DiffConfig};
use super::pretty_format::{FormatOptions, JestPrettyFormat, MessageLevel};

pub struct DiffFormatter<'a> {
    pub received_string: Option<&'a [u8]>,
    pub expected_string: Option<&'a [u8]>,
    pub received: Option<JSValue>,
    pub expected: Option<JSValue>,
    pub global_this: Option<&'a JSGlobalObject>,
    pub not: bool,
}

impl<'a> Default for DiffFormatter<'a> {
    fn default() -> Self {
        Self {
            received_string: None,
            expected_string: None,
            received: None,
            expected: None,
            global_this: None,
            not: false,
        }
    }
}

impl<'a> fmt::Display for DiffFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let diff_config =
            DiffConfig::default(Output::is_ai_agent(), Output::enable_ansi_colors_stderr());

        if self.expected_string.is_some() && self.received_string.is_some() {
            let received = self.received_string.unwrap();
            let expected = self.expected_string.unwrap();

            print_diff_main(self.not, received, expected, f, &diff_config)?;
            return Ok(());
        }

        if self.received.is_none() || self.expected.is_none() {
            return Ok(());
        }

        let global_this = self.global_this.expect("DiffFormatter.global_this not set");

        let received = self.received.unwrap();
        let expected = self.expected.unwrap();
        let mut received_buf: Vec<u8> = Vec::new();
        let mut expected_buf: Vec<u8> = Vec::new();

        {
            let fmt_options = FormatOptions {
                enable_colors: false,
                add_newline: false,
                flush: false,
                quote_strings: true,
            };
            // Zig: @as([*]const JSValue, @ptrCast(&received)), 1  → 1-element slice
            let _ = JestPrettyFormat::format(
                MessageLevel::Debug,
                global_this,
                core::slice::from_ref(&received),
                1,
                &mut received_buf,
                fmt_options,
            ); // TODO:

            let _ = JestPrettyFormat::format(
                MessageLevel::Debug,
                global_this,
                core::slice::from_ref(&expected),
                1,
                &mut expected_buf,
                fmt_options,
            ); // TODO:
        }

        let mut received_slice: &[u8] = received_buf.as_slice();
        let mut expected_slice: &[u8] = expected_buf.as_slice();
        if received_slice.starts_with(b"\n") {
            received_slice = &received_slice[1..];
        }
        if expected_slice.starts_with(b"\n") {
            expected_slice = &expected_slice[1..];
        }
        if received_slice.ends_with(b"\n") {
            received_slice = &received_slice[..received_slice.len() - 1];
        }
        if expected_slice.ends_with(b"\n") {
            expected_slice = &expected_slice[..expected_slice.len() - 1];
        }

        print_diff_main(self.not, received_slice, expected_slice, f, &diff_config)?;
        Ok(())
    }
}

/// C++ bridge for `BunAnalyzeTranspiledModule.cpp` — renders a diff between the
/// JSC-parsed module record and Bun's transpiler output when they disagree.
///
/// Ported from `src/bundler_jsc/analyze_jsc.zig`. Lives here (not in
/// `bun_bundler_jsc::analyze_jsc`) because `DiffFormatter` is a `bun_runtime`
/// type and `bun_bundler_jsc` is a lower-tier crate that cannot depend on it;
/// the `extern "C"` symbol resolves the same at link time regardless of which
/// crate defines it.
#[unsafe(no_mangle)]
pub extern "C" fn zig__renderDiff(
    expected_ptr: *const core::ffi::c_char,
    expected_len: usize,
    received_ptr: *const core::ffi::c_char,
    received_len: usize,
    global_this: &JSGlobalObject,
) {
    // SAFETY: caller (BunAnalyzeTranspiledModule.cpp) passes valid UTF-8 buffers
    // of the given lengths for the duration of this call.
    let expected = unsafe { bun_core::ffi::slice(expected_ptr.cast::<u8>(), expected_len) };
    let received = unsafe { bun_core::ffi::slice(received_ptr.cast::<u8>(), received_len) };
    let formatter = DiffFormatter {
        received_string: Some(received),
        expected_string: Some(expected),
        global_this: Some(global_this),
        ..Default::default()
    };
    // Zig: `Output.errorWriter().print("DIFF:\n{any}\n", .{formatter}) catch {};`
    let _ = bun_core::output::error_writer().print(format_args!("DIFF:\n{}\n", formatter));
}

// ported from: src/test_runner/diff_format.zig

use core::fmt;
use std::borrow::Cow;

use bun_core::Output;
use bun_jsc::{Formatter, JSGlobalObject, JSValue, JsResult};

use super::diff::print_diff::{print_diff_main, DiffConfig};

/// Renders a Jest-style diff of two already-formatted values. Formatting a JS value can throw, so it
/// happens up front in [`DiffFormatter::new`], never inside `Display::fmt`.
pub(crate) struct DiffFormatter<'a> {
    pub(crate) received_string: Cow<'a, [u8]>,
    pub(crate) expected_string: Cow<'a, [u8]>,
    pub(crate) not: bool,
    /// A side printed `[Object]` for a value it had already printed in full, past this many bytes
    /// of repeats.
    abbreviated: Option<usize>,
    /// A side nests deeper than the native stack allows.
    stopped_early: bool,
}

impl<'a> DiffFormatter<'a> {
    pub(crate) fn new(
        global_this: &JSGlobalObject,
        received: JSValue,
        expected: JSValue,
        not: bool,
    ) -> JsResult<DiffFormatter<'static>> {
        struct Side {
            text: Vec<u8>,
            abbreviated: Option<usize>,
            stopped_early: bool,
        }
        let side = |value: JSValue, repeats: Option<usize>| -> JsResult<Side> {
            let mut text: Vec<u8> = Vec::new();
            let mut formatter = Formatter::diff(global_this);
            if let Some(bytes) = repeats {
                formatter.raise_shared_reference_budget(bytes);
            }
            formatter.format_value::<false>(value, &mut text)?;
            Ok(Side {
                text: trim_one_newline(text),
                abbreviated: formatter.abbreviated_shared_references(),
                stopped_early: formatter.stopped_early(),
            })
        };
        let mut expected_side = side(expected, None)?;
        if not {
            // Only `expected` is shown.
            return Ok(DiffFormatter {
                received_string: Cow::Borrowed(b""),
                expected_string: Cow::Owned(expected_side.text),
                not,
                abbreviated: expected_side.abbreviated,
                stopped_early: expected_side.stopped_early,
            });
        }
        let mut received_side = side(received, None)?;
        // One side shares an object where the other has copies of it. Abbreviated on one side
        // only, every line of it would differ. What the other side printed in full bounds this.
        if received_side.abbreviated.is_some() && expected_side.abbreviated.is_none() {
            received_side = side(received, Some(expected_side.text.len()))?;
        } else if expected_side.abbreviated.is_some() && received_side.abbreviated.is_none() {
            expected_side = side(expected, Some(received_side.text.len()))?;
        }
        Ok(DiffFormatter {
            received_string: Cow::Owned(received_side.text),
            expected_string: Cow::Owned(expected_side.text),
            not,
            abbreviated: received_side.abbreviated.or(expected_side.abbreviated),
            stopped_early: received_side.stopped_early || expected_side.stopped_early,
        })
    }

    pub(crate) fn from_strings(received: &'a [u8], expected: &'a [u8], not: bool) -> Self {
        DiffFormatter {
            received_string: Cow::Borrowed(received),
            expected_string: Cow::Borrowed(expected),
            not,
            abbreviated: None,
            stopped_early: false,
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
        )?;
        if !self.not && self.received_string == self.expected_string {
            f.write_str("\n\nnote: the values are not equal, but they print the same.")?;
        }
        if let Some(limit) = self.abbreviated {
            write!(
                f,
                "\n\nnote: [Array], [Object], [Map] and [Set] stand for values that are printed in full earlier in the same output. The output for repeated values is limited to {} MiB.",
                limit / (1024 * 1024)
            )?;
        }
        if self.stopped_early {
            f.write_str("\n\nnote: a value is nested too deeply to print in full.")?;
        }
        Ok(())
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

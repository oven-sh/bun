use core::fmt;

use bun_core::Output;
use bun_jsc::{JSGlobalObject, JSValue};

use super::diff::print_diff::{print_diff_main, DiffConfig};
use super::pretty_format::{FormatOptions, JestPrettyFormat, MessageLevel};

/// Cap on the pretty-printed size of each side of an assertion diff. Shared
/// (non-circular) references re-expand at every occurrence, so a tiny object
/// graph can otherwise expand exponentially and allocate until the machine
/// dies. https://github.com/oven-sh/bun/issues/34178
const MAX_PRETTY_PRINT_BYTES: usize = 1024 * 1024;

const TRUNCATION_NOTICE: &[u8] = b"\n... [value too large, output truncated]";

#[derive(Default)]
pub struct DiffFormatter<'a> {
    pub received_string: Option<&'a [u8]>,
    pub expected_string: Option<&'a [u8]>,
    pub received: Option<JSValue>,
    pub expected: Option<JSValue>,
    pub global_this: Option<&'a JSGlobalObject>,
    pub not: bool,
}

impl<'a> fmt::Display for DiffFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let diff_config =
            DiffConfig::default(Output::is_ai_agent(), Output::enable_ansi_colors_stderr());

        if let (Some(expected), Some(received)) = (self.expected_string, self.received_string) {
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
            let mut received_writer =
                bun_io::LimitedWriter::new(&mut received_buf, MAX_PRETTY_PRINT_BYTES);
            let _ = JestPrettyFormat::format(
                MessageLevel::Debug,
                global_this,
                core::slice::from_ref(&received),
                1,
                &mut received_writer,
                fmt_options,
            ); // TODO:
            if received_writer.truncated {
                received_buf.extend_from_slice(TRUNCATION_NOTICE);
            }

            let mut expected_writer =
                bun_io::LimitedWriter::new(&mut expected_buf, MAX_PRETTY_PRINT_BYTES);
            let _ = JestPrettyFormat::format(
                MessageLevel::Debug,
                global_this,
                core::slice::from_ref(&expected),
                1,
                &mut expected_writer,
                fmt_options,
            ); // TODO:
            if expected_writer.truncated {
                expected_buf.extend_from_slice(TRUNCATION_NOTICE);
            }
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
/// Lives here (not in
/// `bun_bundler_jsc::analyze_jsc`) because `DiffFormatter` is a `bun_runtime`
/// type and `bun_bundler_jsc` is a lower-tier crate that cannot depend on it;
/// the `extern "C"` symbol resolves the same at link time regardless of which
/// crate defines it.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn zig__renderDiff(
    expected_ptr: *const core::ffi::c_char,
    expected_len: usize,
    received_ptr: *const core::ffi::c_char,
    received_len: usize,
    global_this: &JSGlobalObject,
) {
    // SAFETY: caller (BunAnalyzeTranspiledModule.cpp) passes a valid UTF-8 buffer
    // of length `expected_len` that outlives this call.
    let expected = unsafe { bun_core::ffi::slice(expected_ptr.cast::<u8>(), expected_len) };
    // SAFETY: caller (BunAnalyzeTranspiledModule.cpp) passes a valid UTF-8 buffer
    // of length `received_len` that outlives this call.
    let received = unsafe { bun_core::ffi::slice(received_ptr.cast::<u8>(), received_len) };
    let formatter = DiffFormatter {
        received_string: Some(received),
        expected_string: Some(expected),
        global_this: Some(global_this),
        ..Default::default()
    };
    let _ = bun_core::output::error_writer().print(format_args!("DIFF:\n{}\n", formatter));
}

use core::fmt;

use bun_core::Output;
use bun_jsc::{JSGlobalObject, JSValue};

use crate::diff::print_diff::{print_diff_main, DiffConfig};
use crate::pretty_format::JestPrettyFormat;

pub struct DiffFormatter<'a> {
    pub received_string: Option<&'a [u8]>,
    pub expected_string: Option<&'a [u8]>,
    pub received: Option<JSValue>,
    pub expected: Option<JSValue>,
    pub global_this: &'a JSGlobalObject,
    pub not: bool,
}

impl<'a> fmt::Display for DiffFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Zig: var scope = bun.AllocationScope.init(default_allocator);
        // // defer scope.deinit(); // TODO: fix leaks
        // Allocator param dropped (non-AST crate; global mimalloc).

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

        let received = self.received.unwrap();
        let expected = self.expected.unwrap();
        let mut received_buf: Vec<u8> = Vec::new();
        let mut expected_buf: Vec<u8> = Vec::new();

        {
            // TODO(port): JestPrettyFormat::FormatOptions / ::format are nested decls in Zig;
            // Phase B may need to adjust to the actual Rust pretty_format module layout.
            let fmt_options = JestPrettyFormat::FormatOptions {
                enable_colors: false,
                add_newline: false,
                flush: false,
                quote_strings: true,
            };
            // Zig: @as([*]const JSValue, @ptrCast(&received)), 1  → 1-element slice
            let _ = JestPrettyFormat::format(
                JestPrettyFormat::FormatKind::Debug,
                self.global_this,
                core::slice::from_ref(&received),
                &mut received_buf,
                fmt_options,
            ); // TODO:

            let _ = JestPrettyFormat::format(
                JestPrettyFormat::FormatKind::Debug,
                self.global_this,
                core::slice::from_ref(&expected),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/diff_format.zig (84 lines)
//   confidence: medium
//   todos:      1
//   notes:      JestPrettyFormat nested-decl access (FormatOptions/FormatKind/format) needs Phase B path fixup; print_diff_main allocator param dropped.
// ──────────────────────────────────────────────────────────────────────────

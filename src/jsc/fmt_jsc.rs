//! Bindgen target for `fmt_jsc.bind.ts`. The actual formatters live in
//! `src/bun_core/fmt.rs`; only the JS-facing wrapper lives here so `bun_core/`
//! stays JSC-free.

use std::io::Write as _;

use crate::bindgen::{self, JsHeap};
use bun_core::fmt;
use bun_core::{MutableString, String};

pub mod js_bindings {
    use super::*;

    pub use crate::generated_bindgen::fmt_jsc::Formatter;

    /// Internal function for testing in highlighter.test.ts
    pub fn fmt_string<'a>(
        heap: &JsHeap<'a>,
        code: &[u8],
        formatter_id: Formatter,
    ) -> bindgen::Result<'a, String> {
        let mut buffer = MutableString::init_empty();
        let writer = buffer.writer();

        match formatter_id {
            Formatter::HighlightJavascript => {
                let formatter = fmt::fmt_javascript(
                    code,
                    fmt::HighlighterOptions {
                        enable_colors: true,
                        check_for_unhighlighted_write: false,
                        ..Default::default()
                    },
                );
                write!(writer, "{}", formatter).map_err(|_| heap.throw_out_of_memory())?;
            }
            Formatter::HighlightJavascriptRedacted => {
                let formatter = fmt::fmt_javascript(
                    code,
                    fmt::HighlighterOptions {
                        enable_colors: true,
                        check_for_unhighlighted_write: false,
                        redact_sensitive_information: true,
                    },
                );
                write!(writer, "{}", formatter).map_err(|_| heap.throw_out_of_memory())?;
            }
            Formatter::EscapePowershell => {
                write!(writer, "{}", fmt::escape_powershell(code))
                    .map_err(|_| heap.throw_out_of_memory())?;
            }
        }

        Ok(String::clone_utf8(buffer.list.as_slice()))
    }
}

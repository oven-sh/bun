//! The bodies of `fmt_jsc.bind.ts`. The formatters are in `src/bun_core/fmt.rs`, which stays JSC-free.

use std::io::Write as _;

use crate::JsError;
use bun_core::fmt;
use bun_core::{MutableString, String};

pub(crate) mod js_bindings {
    use super::*;

    use crate::generated_bindgen::fmt_jsc::Formatter;

    /// Internal function for testing in highlighter.test.ts
    pub(crate) fn fmt_string(code: &[u8], formatter_id: Formatter) -> Result<String, JsError> {
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
                write!(writer, "{}", formatter).map_err(|_| JsError::OutOfMemory)?;
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
                write!(writer, "{}", formatter).map_err(|_| JsError::OutOfMemory)?;
            }
            Formatter::EscapePowershell => {
                write!(writer, "{}", fmt::escape_powershell(code))
                    .map_err(|_| JsError::OutOfMemory)?;
            }
        }

        Ok(String::clone_utf8(buffer.list.as_slice()))
    }
}

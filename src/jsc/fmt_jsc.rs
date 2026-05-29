//! Bindgen target for `fmt_jsc.bind.ts`. The actual formatters live in
//! `src/bun_core/fmt.zig`; only the JS-facing wrapper that takes a
//! `&JSGlobalObject` lives here so `bun_core/` stays JSC-free.

use std::io::Write as _;

use crate::{JSGlobalObject, JsResult};
use bun_core::fmt;
use bun_core::{MutableString, String};

pub mod js_bindings {
    use super::*;

    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Formatter {
        EscapePowershell = 0,
        HighlightJavascript = 1,
    }

    /// Internal function for testing in highlighter.test.ts
    pub fn fmt_string(
        global: &JSGlobalObject,
        code: &[u8],
        formatter_id: Formatter,
    ) -> JsResult<String> {
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
                write!(writer, "{}", formatter).map_err(|_| global.throw_out_of_memory())?;
            }
            Formatter::EscapePowershell => {
                write!(writer, "{}", fmt::escape_powershell(code))
                    .map_err(|_| global.throw_out_of_memory())?;
            }
        }

        Ok(String::clone_utf8(buffer.list.as_slice()))
    }
}

// ported from: src/jsc/fmt_jsc.zig

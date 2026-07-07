//! Bindgen target for `fmt_jsc.bind.ts`. The actual formatters live in
//! `src/bun_core/fmt.rs`; only the JS-facing wrapper that takes a
//! `&JSGlobalObject` lives here so `bun_core/` stays JSC-free.

use std::io::Write as _;

use crate::{JSGlobalObject, JsResult};
use bun_core::fmt;
use bun_core::{MutableString, String};

pub mod js_bindings {
    use super::*;

    // Bindgen-emitted Rust mirrors (one `pub mod <namespace>` per .bind.ts file
    // with stringEnums); discriminants are generated, not hand-synced.
    #[allow(dead_code, unreachable_pub)]
    mod generated {
        include!(concat!(env!("BUN_CODEGEN_DIR"), "/bindgen_string_enums.rs"));
    }
    pub use generated::fmt_jsc::Formatter;

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
            Formatter::HighlightJavascriptRedacted => {
                let formatter = fmt::fmt_javascript(
                    code,
                    fmt::HighlighterOptions {
                        enable_colors: true,
                        check_for_unhighlighted_write: false,
                        redact_sensitive_information: true,
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

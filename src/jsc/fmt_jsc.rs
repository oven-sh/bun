//! Bindgen target for `fmt_jsc.bind.ts`. The actual formatters live in
//! `src/bun_core/fmt.zig`; only the JS-facing wrapper that takes a
//! `&JSGlobalObject` lives here so `bun_core/` stays JSC-free.

use core::fmt::Write as _;

use bun_core::fmt;
use bun_jsc::{JSGlobalObject, JsResult};
use bun_str::{MutableString, String};

pub mod js_bindings {
    use super::*;

    // TODO(port): `bun.gen.fmt_jsc` is bindgen output; confirm crate path in Phase B.
    use bun_gen::fmt_jsc as gen;

    /// Internal function for testing in highlighter.test.ts
    pub fn fmt_string(
        global: &JSGlobalObject,
        code: &[u8],
        formatter_id: gen::Formatter,
    ) -> JsResult<String> {
        let mut buffer = MutableString::init_empty();
        let mut writer = buffer.buffered_writer();

        match formatter_id {
            gen::Formatter::HighlightJavascript => {
                let formatter = fmt::fmt_javascript(
                    code,
                    fmt::FmtJavaScriptOptions {
                        enable_colors: true,
                        check_for_unhighlighted_write: false,
                    },
                );
                write!(writer.writer(), "{}", formatter)
                    .map_err(|err| global.throw_error(err, b"while formatting"))?;
            }
            gen::Formatter::EscapePowershell => {
                write!(writer.writer(), "{}", fmt::escape_powershell(code))
                    .map_err(|err| global.throw_error(err, b"while formatting"))?;
            }
        }

        writer
            .flush()
            .map_err(|err| global.throw_error(err, b"while formatting"))?;

        Ok(String::clone_utf8(buffer.list.as_slice()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/fmt_jsc.zig (39 lines)
//   confidence: medium
//   todos:      1
//   notes:      bun_gen::fmt_jsc::Formatter is bindgen-emitted; MutableString/buffered_writer API surface assumed from Zig shape.
// ──────────────────────────────────────────────────────────────────────────

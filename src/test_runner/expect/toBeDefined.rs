use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_defined(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalThis)` becomes a
    // scopeguard owning the `&mut Expect` borrow so post_match runs on every exit path.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let value: JSValue = this.get_value(global, this_value, b"toBeDefined", b"")?;

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = !value.is_undefined();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // TODO(port): Formatter likely needs a constructor (global_this field can't Default);
    // adjust once bun_jsc::console_object::Formatter is ported.
    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    let value_fmt = value.to_fmt(&mut formatter);
    if not {
        // `received_line` const inlined: format_args! requires a literal first arg.
        let signature = Expect::get_signature(b"toBeDefined", b"", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        );
    }

    let signature = Expect::get_signature(b"toBeDefined", b"", false);
    this.throw(
        global,
        signature,
        format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeDefined.zig (37 lines)
//   confidence: medium
//   todos:      1
//   notes:      Expect::throw assumed to take (global, signature, fmt::Arguments) — Zig's separate template+tuple merged into format_args!; Expect::get_signature assumed const fn.
// ──────────────────────────────────────────────────────────────────────────

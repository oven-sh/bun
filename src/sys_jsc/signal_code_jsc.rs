//! JSC bridge for `bun.SignalCode`. Keeps `src/sys/` free of JSC types.

use bun_sys::SignalCode;

use crate::{JSGlobalObject, JSValue, JsResult};

pub fn from_js(arg: JSValue, global_this: &JSGlobalObject) -> JsResult<SignalCode> {
    if let Some(sig64) = arg.get_number() {
        // Node does this:
        if sig64.is_nan() {
            return Ok(SignalCode::DEFAULT);
        }

        // This matches node behavior, minus some details with the error messages: https://gist.github.com/Jarred-Sumner/23ba38682bf9d84dff2f67eb35c42ab6
        if sig64.is_infinite() || sig64.trunc() != sig64 {
            return Err(global_this.throw_invalid_arguments(format_args!("Unknown signal")));
        }

        if sig64 < 0.0 {
            return Err(
                global_this.throw_invalid_arguments(format_args!("Invalid signal: must be >= 0"))
            );
        }

        if sig64 > 31.0 {
            return Err(
                global_this.throw_invalid_arguments(format_args!("Invalid signal: must be < 32"))
            );
        }

        // PORT NOTE: SignalCode is `#[repr(transparent)] struct(u8)` (non-exhaustive
        // Zig enum), so the public ctor is used instead of transmute.
        return Ok(SignalCode(sig64 as u8));
    } else if arg.is_string() {
        // SAFETY: `is_string()` ⇒ `as_string()` returns a non-null JSString cell;
        // borrowed for `.length()` only.
        if unsafe { &*arg.as_string() }.length() == 0 {
            return Ok(SignalCode::DEFAULT);
        }
        let signal_code = arg.to_enum::<SignalCode>(global_this, "signal")?;
        return Ok(signal_code);
    } else if !arg.is_empty_or_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Invalid signal: must be a string or an integer"
        )));
    }

    Ok(SignalCode::DEFAULT)
}

// ported from: src/sys_jsc/signal_code_jsc.zig

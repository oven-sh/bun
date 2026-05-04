//! JSC bridge for `bun.SignalCode`. Keeps `src/sys/` free of JSC types.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_sys::SignalCode;

pub fn from_js(arg: JSValue, global_this: &JSGlobalObject) -> JsResult<SignalCode> {
    if let Some(sig64) = arg.get_number() {
        // Node does this:
        if sig64.is_nan() {
            return Ok(SignalCode::DEFAULT);
        }

        // This matches node behavior, minus some details with the error messages: https://gist.github.com/Jarred-Sumner/23ba38682bf9d84dff2f67eb35c42ab6
        if sig64.is_infinite() || sig64.trunc() != sig64 {
            return global_this.throw_invalid_arguments(format_args!("Unknown signal"));
        }

        if sig64 < 0.0 {
            return global_this.throw_invalid_arguments(format_args!("Invalid signal: must be >= 0"));
        }

        if sig64 > 31.0 {
            return global_this.throw_invalid_arguments(format_args!("Invalid signal: must be < 32"));
        }

        // SAFETY: sig64 is in [0, 31] and integral (checked above), so it fits u8 and is a valid SignalCode discriminant.
        let code: SignalCode = unsafe { core::mem::transmute::<u8, SignalCode>(sig64 as u8) };
        return Ok(code);
    } else if arg.is_string() {
        if arg.as_string().length() == 0 {
            return Ok(SignalCode::DEFAULT);
        }
        let signal_code = arg.to_enum::<SignalCode>(global_this, "signal")?;
        return Ok(signal_code);
    } else if !arg.is_empty_or_undefined_or_null() {
        return global_this.throw_invalid_arguments(format_args!(
            "Invalid signal: must be a string or an integer"
        ));
    }

    Ok(SignalCode::DEFAULT)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys_jsc/signal_code_jsc.zig (42 lines)
//   confidence: high
//   todos:      0
//   notes:      throw_invalid_arguments assumed to return JsResult<T>; SignalCode::DEFAULT is the `default` const decl
// ──────────────────────────────────────────────────────────────────────────

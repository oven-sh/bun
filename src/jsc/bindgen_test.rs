//! This namespace is used to test binding generator

use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult};

// TODO(port): generated bindgen module path (`bun.gen.bindgen_test` in Zig)
use crate::gen::bindgen_test as gen;

pub fn get_bindgen_test_functions(global: &JSGlobalObject) -> JsResult<JSValue> {
    // TODO(port): Zig `JSObject.create(.{ .field = val, ... }, global)` uses comptime
    // field reflection; Phase B needs a builder/macro on `bun_jsc::JSObject`.
    Ok(JSObject::create(
        &[
            ("add", gen::create_add_callback(global)),
            (
                "requiredAndOptionalArg",
                gen::create_required_and_optional_arg_callback(global),
            ),
        ],
        global,
    )?
    .to_js())
}

// This example should be kept in sync with bindgen's documentation
pub fn add(global: &JSGlobalObject, a: i32, b: i32) -> JsResult<i32> {
    // TODO(port): narrow error set
    match a.checked_add(b) {
        Some(v) => Ok(v),
        None => {
            // Binding functions can return `error.OutOfMemory` and `error.JSError`.
            // Others like `error.Overflow` from `std.math.add` must be converted.
            // Remember to be descriptive.
            global.throw_pretty(format_args!("Integer overflow while adding"))
        }
    }
}

pub fn required_and_optional_arg(a: bool, b: Option<usize>, c: i32, d: Option<u8>) -> i32 {
    let Some(b_nonnull) = b else {
        return 123456i32
            .wrapping_add(c)
            .wrapping_add(i32::from(d.unwrap_or(0)));
    };
    // Zig: @truncate(@as(isize, @as(u53, @truncate(
    //     (b_nonnull +% @as(usize, @abs(c))) *% (d orelse 1),
    // ))))
    let inner: usize = b_nonnull
        .wrapping_add(c.unsigned_abs() as usize)
        .wrapping_mul(usize::from(d.unwrap_or(1)));
    // @truncate usize -> u53 (low 53 bits), widen to isize, then @truncate -> i32.
    let as_u53: u64 = (inner as u64) & ((1u64 << 53) - 1);
    let mut math_result: i32 = (as_u53 as isize) as i32;
    if a {
        math_result = -math_result;
    }
    math_result
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/bindgen_test.zig (37 lines)
//   confidence: medium
//   todos:      3
//   notes:      `gen` is codegen output (bun.gen.bindgen_test); JSObject::create anon-struct API needs a Rust-side builder/macro in Phase B.
// ──────────────────────────────────────────────────────────────────────────

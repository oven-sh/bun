//! `bun:internal-for-testing` probes for the `bun_highway` wrappers that write
//! into a caller-supplied output slice, for test/internal/highway-output-bounds.test.ts.
//!
//! Each probe takes the same arguments as the wrapper it names, as typed arrays,
//! copies `output` into a `Vec` of the length the test chose, runs the wrapper
//! on the copy and returns it. A `Vec` rather than the JS buffer itself so that
//! a wrapper missing its length check overflows a heap allocation ASAN reports,
//! instead of silently corrupting the JS heap.

use bun_jsc::{ArrayBuffer, CallFrame, JSGlobalObject, JSValue, JsResult};

fn typed_array_argument(
    global: &JSGlobalObject,
    frame: &CallFrame,
    index: usize,
    name: &str,
) -> JsResult<Vec<u8>> {
    match frame.argument(index).as_array_buffer(global) {
        Some(buffer) => Ok(buffer.byte_slice().to_vec()),
        None => Err(global.throw(format_args!("{name} must be a typed array"))),
    }
}

/// The probes exist to hit the wrappers' length checks; that panic must not
/// leave a core dump behind in CI.
fn expect_panic_if_too_short(output_len: usize, input_len: usize) {
    if output_len < input_len {
        bun_crash_handler::suppress_core_dumps_if_necessary();
    }
}

/// `copyU16ToU8Probe(input: Uint16Array, output: Uint8Array): Uint8Array`
pub(crate) fn copy_u16_to_u8_probe(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let input: Vec<u16> = typed_array_argument(global, frame, 0, "input")?
        .chunks_exact(2)
        .map(|unit| u16::from_ne_bytes([unit[0], unit[1]]))
        .collect();
    let mut output = typed_array_argument(global, frame, 1, "output")?;

    expect_panic_if_too_short(output.len(), input.len());
    bun_highway::copy_u16_to_u8(&input, &mut output);
    ArrayBuffer::create_uint8_array(global, &output)
}

/// `fillWithSkipMaskProbe(mask: Uint8Array, output: Uint8Array, input: Uint8Array, skipMask: boolean): Uint8Array`
pub(crate) fn fill_with_skip_mask_probe(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let Ok(mask) = <[u8; 4]>::try_from(typed_array_argument(global, frame, 0, "mask")?) else {
        return Err(global.throw(format_args!("mask must be 4 bytes")));
    };
    let mut output = typed_array_argument(global, frame, 1, "output")?;
    let input = typed_array_argument(global, frame, 2, "input")?;
    let skip_mask = frame.argument(3).to_boolean();

    expect_panic_if_too_short(output.len(), input.len());
    bun_highway::fill_with_skip_mask(mask, &mut output, &input, skip_mask);
    ArrayBuffer::create_uint8_array(global, &output)
}

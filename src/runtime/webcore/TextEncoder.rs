use bun_core::strings;
use bun_jsc::HostReturn as _;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSString, JSType, JSValue, JsResult};
use bun_simdutf_sys::simdutf::WithUtf8Len;

// `const TextEncoder = @This();` — file is a namespace of exported fns; no wrapper struct needed.

#[inline]
fn create_uninitialized_uint8_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
    JSValue::create_uninitialized_uint8_array(global, len)
}

/// # Safety
/// `ptr` must be valid for reading `len` bytes of Latin-1 data.
#[unsafe(no_mangle)]
unsafe extern "C" fn TextEncoder__encode8(
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    // SAFETY: caller guarantees ptr[0..len] is valid Latin-1 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };

    if strings::first_non_ascii(slice).is_none() {
        let Ok(uint8array) = create_uninitialized_uint8_array(global_this, slice.len()) else {
            return JSValue::ZERO;
        };
        let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
            return JSValue::ZERO;
        };
        debug_assert!(array_buffer.len == slice.len());
        array_buffer.byte_slice_mut().copy_from_slice(slice);
        return uint8array;
    }

    let utf8_len = strings::element_length_latin1_into_utf8(slice);
    let Ok(uint8array) = create_uninitialized_uint8_array(global_this, utf8_len) else {
        return JSValue::ZERO;
    };
    let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
        return JSValue::ZERO;
    };
    debug_assert!(array_buffer.len == utf8_len);
    let result = strings::copy_latin1_into_utf8(array_buffer.byte_slice_mut(), slice);
    debug_assert!(result.written == utf8_len);
    debug_assert!(result.read == slice.len());
    uint8array
}

fn replacement_char_uint8_array(global_this: &JSGlobalObject) -> JSValue {
    let Ok(uint8array) = create_uninitialized_uint8_array(global_this, 3) else {
        return JSValue::ZERO;
    };
    let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
        return JSValue::ZERO;
    };
    const REPLACEMENT_CHAR: [u8; 3] = [239, 191, 189];
    array_buffer.byte_slice_mut()[..REPLACEMENT_CHAR.len()].copy_from_slice(&REPLACEMENT_CHAR);
    uint8array
}

/// # Safety
/// `ptr` must be valid for reading `len` UTF-16 code units.
#[unsafe(no_mangle)]
unsafe extern "C" fn TextEncoder__encode16(
    global_this: &JSGlobalObject,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    // SAFETY: caller guarantees ptr[0..len] is valid UTF-16 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };

    const SMALL_BUF_LEN: usize = 192;
    if slice.len() <= SMALL_BUF_LEN / 3 {
        let mut buf = [0u8; SMALL_BUF_LEN];
        let result = strings::copy_utf16_into_utf8(&mut buf, slice);
        if result.read == 0 || result.written == 0 {
            return replacement_char_uint8_array(global_this);
        }
        let written = result.written;
        debug_assert!(result.read == slice.len());
        let Ok(uint8array) = create_uninitialized_uint8_array(global_this, written) else {
            return JSValue::ZERO;
        };
        let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
            return JSValue::ZERO;
        };
        debug_assert!(array_buffer.len == written);
        array_buffer
            .byte_slice_mut()
            .copy_from_slice(&buf[..written]);
        return uint8array;
    }

    let input = WithUtf8Len::utf16_with_replacement(slice);
    let need = input.utf8_len();

    if need == 0 {
        return replacement_char_uint8_array(global_this);
    }

    let Ok(uint8array) = create_uninitialized_uint8_array(global_this, need) else {
        return JSValue::ZERO;
    };
    let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
        return JSValue::ZERO;
    };
    debug_assert!(array_buffer.len == need);
    let result = strings::copy_utf16_into_utf8_with_utf8_len(array_buffer.byte_slice_mut(), input);
    if result.written == need && result.read == slice.len() {
        return uint8array;
    }

    let bytes = strings::to_utf8_alloc_with_type(slice);
    ArrayBuffer::from_default_allocator(global_this, JSType::Uint8Array, bytes)
        .or_pending_exception()
}

// This fast path is only suitable for ASCII strings
// It's not suitable for UTF-16 strings, because getting the byteLength is unpredictable
// It also isn't usable for latin1 strings which contain non-ascii characters
#[unsafe(no_mangle)]
extern "C" fn TextEncoder__encodeRopeString(
    global_this: &JSGlobalObject,
    rope_str: &JSString,
) -> JSValue {
    debug_assert!(rope_str.is_8bit());
    let length = rope_str.length();
    let array = match create_uninitialized_uint8_array(global_this, length) {
        Ok(v) => v,
        Err(_) => return JSValue::ZERO,
    };
    array.ensure_still_alive();
    let Some(mut array_buffer) = array.as_array_buffer(global_this) else {
        return JSValue::ZERO;
    };
    if !rope_str.copy_if_ascii(array_buffer.byte_slice_mut()) {
        return JSValue::UNDEFINED;
    }
    array
}

/// # Safety
/// `input_ptr` must be valid for reading `input_len` UTF-16 code units and
/// `buf_ptr` must be valid for writing `buf_len` bytes. A null `WTF::String` and a
/// detached view are both `(null, 0)`.
#[unsafe(no_mangle)]
unsafe extern "C" fn TextEncoder__encodeInto16(
    input_ptr: *const u16,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> strings::EncodeIntoResult {
    // SAFETY: caller guarantees buf_ptr[0..buf_len] is a valid mutable buffer
    let output = unsafe { bun_core::ffi::slice_mut(buf_ptr, buf_len) };
    // SAFETY: caller guarantees input_ptr[0..input_len] is valid UTF-16 data
    let input = unsafe { bun_core::ffi::slice(input_ptr, input_len) };
    strings::copy_utf16_into_utf8(output, input)
}

/// # Safety
/// `input_ptr` must be valid for reading `input_len` bytes of Latin-1 data and
/// `buf_ptr` must be valid for writing `buf_len` bytes. A null `WTF::String` and a
/// detached view are both `(null, 0)`.
#[unsafe(no_mangle)]
unsafe extern "C" fn TextEncoder__encodeInto8(
    input_ptr: *const u8,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> strings::EncodeIntoResult {
    // SAFETY: caller guarantees buf_ptr[0..buf_len] is a valid mutable buffer
    let output = unsafe { bun_core::ffi::slice_mut(buf_ptr, buf_len) };
    // SAFETY: caller guarantees input_ptr[0..input_len] is valid Latin-1 data
    let input = unsafe { bun_core::ffi::slice(input_ptr, input_len) };
    strings::copy_latin1_into_utf8(output, input)
}

use bun_core::strings;
use bun_jsc::HostReturn as _;
use bun_jsc::js_string::StringVisitor;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSType, JSValue, JsResult};

// `const TextEncoder = @This();` — file is a namespace of exported fns; no wrapper struct needed.

#[inline]
fn create_uninitialized_uint8_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
    JSValue::create_uninitialized_uint8_array(global, len)
}

// HOST_EXPORT(TextEncoder__encode8, c)
pub fn encode8(global_this: &JSGlobalObject, slice: &[u8]) -> JSValue {
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
    debug_assert!(result.written as usize == utf8_len);
    debug_assert!(result.read as usize == slice.len());
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

// HOST_EXPORT(TextEncoder__encode16, c)
pub fn encode16(global_this: &JSGlobalObject, slice: &[u16]) -> JSValue {
    const SMALL_BUF_LEN: usize = 192;
    if slice.len() <= SMALL_BUF_LEN / 3 {
        let mut buf = [0u8; SMALL_BUF_LEN];
        let result = strings::copy_utf16_into_utf8(&mut buf, slice);
        if result.read == 0 || result.written == 0 {
            return replacement_char_uint8_array(global_this);
        }
        let written = result.written as usize;
        debug_assert!(result.read as usize == slice.len());
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

    let need = strings::element_length_utf16_into_utf8(slice);

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
    let result =
        strings::copy_utf16_into_utf8_with_utf8_len(array_buffer.byte_slice_mut(), slice, need);
    if result.written as usize == need && result.read as usize == slice.len() {
        return uint8array;
    }

    let bytes = strings::to_utf8_alloc_with_type(slice);
    ArrayBuffer::from_bytes(bytes.leak(), JSType::Uint8Array)
        .to_js_unchecked(global_this)
        .or_pending_exception()
}

// This is a fast path for copying a Rope string into a Uint8Array.
// This keeps us from an extra string temporary allocation
struct RopeStringEncoder<'a> {
    buf: &'a mut [u8],
    tail: usize,
    any_non_ascii: bool,
}

impl StringVisitor for RopeStringEncoder<'_> {
    fn append8(&mut self, src: &[u8]) -> bool {
        let result = strings::copy_latin1_into_utf8_stop_on_non_ascii::<true>(
            &mut self.buf[self.tail..],
            src,
        );
        if result.read == u32::MAX && result.written == u32::MAX {
            self.any_non_ascii = true;
            false
        } else {
            self.tail += result.written as usize;
            true
        }
    }

    fn append16(&mut self, _: &[u16]) -> bool {
        self.any_non_ascii = true;
        false
    }

    fn write8(&mut self, src: &[u8], offset: u32) -> bool {
        let result = strings::copy_latin1_into_utf8_stop_on_non_ascii::<true>(
            &mut self.buf[offset as usize..],
            src,
        );
        if result.read == u32::MAX && result.written == u32::MAX {
            self.any_non_ascii = true;
            false
        } else {
            true
        }
    }

    fn write16(&mut self, _: &[u16], _: u32) -> bool {
        self.any_non_ascii = true;
        false
    }
}

// This fast path is only suitable for ASCII strings
// It's not suitable for UTF-16 strings, because getting the byteLength is unpredictable
// It also isn't usable for latin1 strings which contain non-ascii characters
// HOST_EXPORT(TextEncoder__encodeRopeString, c)
pub fn encode_rope_string(global_this: &JSGlobalObject, rope_str: &bun_jsc::JSString) -> JSValue {
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
    let mut encoder = RopeStringEncoder {
        buf: array_buffer.byte_slice_mut(),
        tail: 0,
        any_non_ascii: false,
    };
    array.ensure_still_alive();
    rope_str.visit(global_this, &mut encoder);
    array.ensure_still_alive();

    if encoder.any_non_ascii {
        return JSValue::UNDEFINED;
    }

    array
}

/// `read` at byte offset 0 and `written` at offset 4, as the C++ caller unpacks them.
fn pack_encode_into_result(result: strings::EncodeIntoResult) -> u64 {
    let mut b = [0u8; 8];
    b[..4].copy_from_slice(&result.read.to_ne_bytes());
    b[4..].copy_from_slice(&result.written.to_ne_bytes());
    u64::from_ne_bytes(b)
}

// HOST_EXPORT(TextEncoder__encodeInto16, c)
pub fn encode_into16(input: &[u16], output: &mut [u8]) -> u64 {
    pack_encode_into_result(strings::copy_utf16_into_utf8(output, input))
}

// HOST_EXPORT(TextEncoder__encodeInto8, c)
pub fn encode_into8(input: &[u8], output: &mut [u8]) -> u64 {
    pack_encode_into_result(strings::copy_latin1_into_utf8(output, input))
}

use core::ffi::c_void;

use bun_core::strings;
use bun_jsc::js_string::Iterator as JSStringIterator;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSString, JSType, JSValue, JsResult};

// `const TextEncoder = @This();` — file is a namespace of exported fns; no wrapper struct needed.

#[inline]
fn create_uninitialized_uint8_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
    JSValue::create_uninitialized_uint8_array(global, len)
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encode8(
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> JSValue {
    // as much as possible, rely on jsc to own the memory
    // their code is more battle-tested than bun's code
    // so we do a stack allocation here
    // and then copy into jsc memory
    // unless it's huge
    // JSC will GC Uint8Array that occupy less than 512 bytes
    // so it's extra good for that case
    // this also means there won't be reallocations for small strings
    let mut buf = [0u8; 2048];
    // SAFETY: caller guarantees ptr[0..len] is valid Latin-1 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };

    if slice.len() <= buf.len() / 2 {
        let result = strings::copy_latin1_into_utf8(&mut buf, slice);
        let Ok(uint8array) = create_uninitialized_uint8_array(global_this, result.written as usize)
        else {
            return JSValue::ZERO;
        };
        debug_assert!(result.written as usize <= buf.len());
        debug_assert!(result.read as usize == slice.len());
        let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
            return JSValue::ZERO;
        };
        debug_assert!(result.written as usize == array_buffer.len);
        array_buffer.byte_slice_mut()[..result.written as usize]
            .copy_from_slice(&buf[..result.written as usize]);
        uint8array
    } else {
        let Ok(bytes) = strings::allocate_latin1_into_utf8(slice) else {
            return global_this.throw_out_of_memory_value();
        };
        debug_assert!(bytes.len() >= slice.len());
        // PORT NOTE: ownership transfers to JSC via to_js_unchecked; leak the Vec.
        ArrayBuffer::from_bytes(bytes.leak(), JSType::Uint8Array)
            .to_js_unchecked(global_this)
            .unwrap_or(JSValue::ZERO)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encode16(
    global_this: &JSGlobalObject,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    // as much as possible, rely on jsc to own the memory
    // their code is more battle-tested than bun's code
    // so we do a stack allocation here
    // and then copy into jsc memory
    // unless it's huge
    // JSC will GC Uint8Array that occupy less than 512 bytes
    // so it's extra good for that case
    // this also means there won't be reallocations for small strings
    let mut buf = [0u8; 2048];

    // SAFETY: caller guarantees ptr[0..len] is valid UTF-16 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };

    // max utf16 -> utf8 length
    if slice.len() <= buf.len() / 4 {
        let result = strings::copy_utf16_into_utf8(&mut buf, slice);
        if result.read == 0 || result.written == 0 {
            let Ok(uint8array) = create_uninitialized_uint8_array(global_this, 3) else {
                return JSValue::ZERO;
            };
            let mut array_buffer = uint8array.as_array_buffer(global_this).unwrap();
            const REPLACEMENT_CHAR: [u8; 3] = [239, 191, 189];
            array_buffer.slice_mut()[..REPLACEMENT_CHAR.len()].copy_from_slice(&REPLACEMENT_CHAR);
            return uint8array;
        }
        let Ok(uint8array) = create_uninitialized_uint8_array(global_this, result.written as usize)
        else {
            return JSValue::ZERO;
        };
        debug_assert!(result.written as usize <= buf.len());
        debug_assert!(result.read as usize == slice.len());
        let mut array_buffer = uint8array.as_array_buffer(global_this).unwrap();
        debug_assert!(result.written as usize == array_buffer.len);
        array_buffer.slice_mut()[..result.written as usize]
            .copy_from_slice(&buf[..result.written as usize]);
        uint8array
    } else {
        let bytes = strings::to_utf8_alloc_with_type(slice);
        // PORT NOTE: ownership transfers to JSC via to_js_unchecked; leak the Vec.
        ArrayBuffer::from_bytes(bytes.leak(), JSType::Uint8Array)
            .to_js_unchecked(global_this)
            .unwrap_or(JSValue::ZERO)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn c(global_this: &JSGlobalObject, ptr: *const u16, len: usize) -> JSValue {
    // as much as possible, rely on jsc to own the memory
    // their code is more battle-tested than bun's code
    // so we do a stack allocation here
    // and then copy into jsc memory
    // unless it's huge
    // JSC will GC Uint8Array that occupy less than 512 bytes
    // so it's extra good for that case
    // this also means there won't be reallocations for small strings
    let mut buf = [0u8; 2048];

    // SAFETY: caller guarantees ptr[0..len] is valid UTF-16 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };

    // max utf16 -> utf8 length
    if slice.len() <= buf.len() / 4 {
        let result = strings::copy_utf16_into_utf8(&mut buf, slice);
        if result.read == 0 || result.written == 0 {
            let Ok(uint8array) = create_uninitialized_uint8_array(global_this, 3) else {
                return JSValue::ZERO;
            };
            let mut array_buffer = uint8array.as_array_buffer(global_this).unwrap();
            const REPLACEMENT_CHAR: [u8; 3] = [239, 191, 189];
            array_buffer.slice_mut()[..REPLACEMENT_CHAR.len()].copy_from_slice(&REPLACEMENT_CHAR);
            return uint8array;
        }
        let Ok(uint8array) = create_uninitialized_uint8_array(global_this, result.written as usize)
        else {
            return JSValue::ZERO;
        };
        debug_assert!(result.written as usize <= buf.len());
        debug_assert!(result.read as usize == slice.len());
        let mut array_buffer = uint8array.as_array_buffer(global_this).unwrap();
        debug_assert!(result.written as usize == array_buffer.len);
        array_buffer.slice_mut()[..result.written as usize]
            .copy_from_slice(&buf[..result.written as usize]);
        uint8array
    } else {
        let bytes = strings::to_utf8_alloc_with_type(slice);
        // PORT NOTE: ownership transfers to JSC via to_js_unchecked; leak the Vec.
        ArrayBuffer::from_bytes(bytes.leak(), JSType::Uint8Array)
            .to_js_unchecked(global_this)
            .unwrap_or(JSValue::ZERO)
    }
}

// This is a fast path for copying a Rope string into a Uint8Array.
// This keeps us from an extra string temporary allocation
struct RopeStringEncoder<'a> {
    global_this: &'a JSGlobalObject,
    buf: &'a mut [u8],
    tail: usize,
    any_non_ascii: bool,
}

impl<'a> RopeStringEncoder<'a> {
    /// Recover `(&mut JSStringIterator, &mut Self)` from the rope-iteration
    /// callback's `*mut JSStringIterator`. Centralises the per-callback raw
    /// derefs so the four `extern "C"` thunks below are safe callers (one
    /// accessor, N safe call sites).
    ///
    /// # Safety (encapsulated)
    /// Only ever invoked from the four callbacks registered in [`Self::iter`],
    /// which JSC calls with the live stack-allocated `JSStringIterator` whose
    /// `.data` field was set to `&mut Self` by `iter()`. The iterator and the
    /// encoder live in disjoint stack allocations (the iterator is a local in
    /// `TextEncoder__encodeRopeString`; the encoder is its sibling local), so
    /// the two `&mut` borrows do not alias. JSC rope iteration is
    /// single-threaded and re-entrancy-free, so each is the sole live `&mut`
    /// for the callback's duration.
    #[inline(always)]
    fn resolve<'r>(it: *mut JSStringIterator) -> (&'r mut JSStringIterator, &'r mut Self) {
        debug_assert!(!it.is_null());
        // SAFETY: see fn doc — `it` is the live iterator JSC passed; `it.data`
        // is the `&mut RopeStringEncoder` stashed in `iter()`. Disjoint
        // allocations, single-threaded, exclusively accessed for `'r`.
        unsafe {
            let it = &mut *it;
            let this = &mut *it.data_ptr().cast::<RopeStringEncoder<'a>>();
            (it, this)
        }
    }

    // The four rope-iteration callbacks coerce (safe → unsafe `extern "C"`) to
    // the `JSStringIterator` callback-pointer field types at `iter()` below.
    pub extern "C" fn append8(it: *mut JSStringIterator, ptr: *const u8, len: u32) {
        let (it, this) = Self::resolve(it);
        // SAFETY: ptr[0..len] is provided by JSC rope iteration
        let src = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
        let result = strings::copy_latin1_into_utf8_stop_on_non_ascii::<true>(
            &mut this.buf[this.tail..],
            src,
        );
        if result.read == u32::MAX && result.written == u32::MAX {
            it.stop = 1;
            this.any_non_ascii = true;
        } else {
            this.tail += result.written as usize;
        }
    }

    pub extern "C" fn append16(it: *mut JSStringIterator, _: *const u16, _: u32) {
        let (it, this) = Self::resolve(it);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    pub extern "C" fn write8(it: *mut JSStringIterator, ptr: *const u8, len: u32, offset: u32) {
        let (it, this) = Self::resolve(it);
        // SAFETY: ptr[0..len] is provided by JSC rope iteration
        let src = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
        let result = strings::copy_latin1_into_utf8_stop_on_non_ascii::<true>(
            &mut this.buf[offset as usize..],
            src,
        );
        if result.read == u32::MAX && result.written == u32::MAX {
            it.stop = 1;
            this.any_non_ascii = true;
        }
    }

    pub extern "C" fn write16(it: *mut JSStringIterator, _: *const u16, _: u32, _: u32) {
        let (it, this) = Self::resolve(it);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    pub fn iter(&mut self) -> JSStringIterator {
        JSStringIterator {
            data: std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            stop: 0,
            append8: Some(Self::append8),
            append16: Some(Self::append16),
            write8: Some(Self::write8),
            write16: Some(Self::write16),
        }
    }
}

// This fast path is only suitable for ASCII strings
// It's not suitable for UTF-16 strings, because getting the byteLength is unpredictable
// It also isn't usable for latin1 strings which contain non-ascii characters
#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encodeRopeString(
    global_this: &JSGlobalObject,
    rope_str: &JSString,
) -> JSValue {
    debug_assert!(rope_str.is_8bit());
    let mut stack_buf = [0u8; 2048];
    let stack_buf_len = stack_buf.len();
    let mut buf_to_use: &mut [u8] = &mut stack_buf;
    let length = rope_str.length();
    let mut array: JSValue = JSValue::ZERO;
    // PORT NOTE: store the ArrayBuffer view so the borrowed slice outlives the if-branch.
    let mut heap_ab: ArrayBuffer;
    if length > stack_buf_len / 2 {
        array = match create_uninitialized_uint8_array(global_this, length) {
            Ok(v) => v,
            Err(_) => return JSValue::ZERO,
        };
        array.ensure_still_alive();
        heap_ab = array.as_array_buffer(global_this).unwrap();
        buf_to_use = heap_ab.slice_mut();
    }
    let mut encoder = RopeStringEncoder {
        global_this,
        buf: buf_to_use,
        tail: 0,
        any_non_ascii: false,
    };
    let mut iter = encoder.iter();
    array.ensure_still_alive();
    rope_str.iterator(global_this, (&raw mut iter).cast::<c_void>());
    array.ensure_still_alive();

    if encoder.any_non_ascii {
        return JSValue::UNDEFINED;
    }

    if array.is_empty() {
        array = match create_uninitialized_uint8_array(global_this, length) {
            Ok(v) => v,
            Err(_) => return JSValue::ZERO,
        };
        array.ensure_still_alive();
        // PORT NOTE: reshaped for borrowck — encoder.buf aliases stack_buf here
        array
            .as_array_buffer(global_this)
            .unwrap()
            .byte_slice_mut()
            .copy_from_slice(&encoder.buf[..length]);
    }

    array
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encodeInto16(
    input_ptr: *const u16,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> u64 {
    // SAFETY: caller guarantees buf_ptr[0..buf_len] is a valid mutable buffer
    let output = unsafe { core::slice::from_raw_parts_mut(buf_ptr, buf_len) };
    // SAFETY: caller guarantees input_ptr[0..input_len] is valid UTF-16 data
    let input = unsafe { core::slice::from_raw_parts(input_ptr, input_len) };
    let mut result: strings::EncodeIntoResult = strings::copy_utf16_into_utf8(output, input);
    if output.len() >= 3 && (result.read == 0 || result.written == 0) {
        const REPLACEMENT_CHAR: [u8; 3] = [239, 191, 189];
        output[..REPLACEMENT_CHAR.len()].copy_from_slice(&REPLACEMENT_CHAR);
        result.read = 1;
        result.written = 3;
    }
    // Zig `@bitCast([2]u32 → u64)`: field 0 (`read`) at byte offset 0, field 1 (`written`)
    // at offset 4. Compose via native-endian bytes — identical bit pattern, no `unsafe`.
    let mut b = [0u8; 8];
    b[..4].copy_from_slice(&result.read.to_ne_bytes());
    b[4..].copy_from_slice(&result.written.to_ne_bytes());
    u64::from_ne_bytes(b)
}

#[unsafe(no_mangle)]
pub extern "C" fn TextEncoder__encodeInto8(
    input_ptr: *const u8,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> u64 {
    // SAFETY: caller guarantees buf_ptr[0..buf_len] is a valid mutable buffer
    let output = unsafe { core::slice::from_raw_parts_mut(buf_ptr, buf_len) };
    // SAFETY: caller guarantees input_ptr[0..input_len] is valid Latin-1 data
    let input = unsafe { core::slice::from_raw_parts(input_ptr, input_len) };
    let result: strings::EncodeIntoResult = strings::copy_latin1_into_utf8(output, input);
    // Zig `@bitCast([2]u32 → u64)`: field 0 (`read`) at byte offset 0, field 1 (`written`)
    // at offset 4. Compose via native-endian bytes — identical bit pattern, no `unsafe`.
    let mut b = [0u8; 8];
    b[..4].copy_from_slice(&result.read.to_ne_bytes());
    b[4..].copy_from_slice(&result.written.to_ne_bytes());
    u64::from_ne_bytes(b)
}

// ported from: src/runtime/webcore/TextEncoder.zig

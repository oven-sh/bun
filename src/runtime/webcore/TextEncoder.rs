use core::ffi::c_void;

use bun_core::strings;
use bun_jsc::HostReturn as _;
use bun_jsc::js_string::Iterator as JSStringIterator;
use bun_jsc::{ArrayBuffer, JSGlobalObject, JSString, JSType, JSUint8Array, JSValue, JsResult};
use bun_simd::SharedOutU8;
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
        return JSUint8Array::from_bytes_copy(global_this, slice).or_pending_exception();
    }

    let utf8_len = strings::element_length_latin1_into_utf8(slice);
    let Ok(uint8array) = create_uninitialized_uint8_array(global_this, utf8_len) else {
        return JSValue::ZERO;
    };
    let Some(mut array_buffer) = uint8array.as_array_buffer(global_this) else {
        return JSValue::ZERO;
    };
    debug_assert!(array_buffer.len == utf8_len);
    let result = strings::copy_latin1_into_shared_utf8(array_buffer.shared_out_bytes(), slice);
    debug_assert!(result.written == utf8_len);
    debug_assert!(result.read == slice.len());
    uint8array
}

fn replacement_char_uint8_array(global_this: &JSGlobalObject) -> JSValue {
    JSUint8Array::from_bytes_copy(global_this, &[239, 191, 189]).or_pending_exception()
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
        debug_assert!(result.read == slice.len());
        return JSUint8Array::from_bytes_copy(global_this, &buf[..result.written])
            .or_pending_exception();
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
    let bytes = array_buffer.shared_out_bytes();
    let result = strings::copy_utf16_into_utf8_with_utf8_len(bytes, input);
    if result.written == need && result.read == slice.len() {
        return uint8array;
    }

    let bytes = strings::to_utf8_alloc_with_type(slice);
    ArrayBuffer::from_default_allocator(global_this, JSType::Uint8Array, bytes)
        .or_pending_exception()
}

// This is a fast path for copying a Rope string into a Uint8Array.
// This keeps us from an extra string temporary allocation
struct RopeStringEncoder<'a> {
    buf: &'a [SharedOutU8],
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
    extern "C" fn append8(it: *mut JSStringIterator, ptr: *const u8, len: u32) {
        let (it, this) = Self::resolve(it);
        // SAFETY: ptr[0..len] is provided by JSC rope iteration
        let src = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
        let copied = strings::copy_ascii_prefix_to_shared(&this.buf[this.tail..], src);
        this.tail += copied;
        if copied < src.len() {
            it.stop = 1;
            this.any_non_ascii = true;
        }
    }

    extern "C" fn append16(it: *mut JSStringIterator, _: *const u16, _: u32) {
        let (it, this) = Self::resolve(it);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    extern "C" fn write8(it: *mut JSStringIterator, ptr: *const u8, len: u32, offset: u32) {
        let (it, this) = Self::resolve(it);
        // SAFETY: ptr[0..len] is provided by JSC rope iteration
        let src = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
        if strings::copy_ascii_prefix_to_shared(&this.buf[offset as usize..], src) < src.len() {
            it.stop = 1;
            this.any_non_ascii = true;
        }
    }

    extern "C" fn write16(it: *mut JSStringIterator, _: *const u16, _: u32, _: u32) {
        let (it, this) = Self::resolve(it);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    fn iter(&mut self) -> JSStringIterator {
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
    let mut encoder = RopeStringEncoder {
        buf: array_buffer.shared_out_bytes(),
        tail: 0,
        any_non_ascii: false,
    };
    let mut iter = encoder.iter();
    array.ensure_still_alive();
    rope_str.iterator(global_this, &mut iter);
    array.ensure_still_alive();

    if encoder.any_non_ascii {
        return JSValue::UNDEFINED;
    }

    array
}

// HOST_EXPORT(TextEncoder__encodeInto16, c)
pub(crate) fn encode_into16(
    input: &[u16],
    output: &[SharedOutU8],
) -> bun_core::strings::EncodeIntoResult {
    strings::copy_utf16_into_shared_utf8(output, input)
}

// HOST_EXPORT(TextEncoder__encodeInto8, c)
pub(crate) fn encode_into8(
    input: &[u8],
    output: &[SharedOutU8],
) -> bun_core::strings::EncodeIntoResult {
    strings::copy_latin1_into_shared_utf8(output, input)
}

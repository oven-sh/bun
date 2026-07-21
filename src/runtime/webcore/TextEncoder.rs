use core::ffi::c_void;

use bun_core::strings;
use bun_jsc::js_string::Iterator as JSStringIterator;
use bun_jsc::{JSGlobalObject, JSString, JSType, JSValue, JsResult};

// `const TextEncoder = @This();` — file is a namespace of exported fns; no wrapper struct needed.

#[inline]
fn create_uninitialized_uint8_array(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
    JSValue::create_uninitialized_uint8_array(global, len)
}

/// # Safety
/// `ptr` must be valid for reading `len` bytes of Latin-1 data.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn TextEncoder__encode8(
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

fn encode16_impl(global_this: &JSGlobalObject, slice: &[u16]) -> JSValue {
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

    // The Vec's capacity exceeds its length (transcoding over-reserves);
    // `from_vec` transfers the whole allocation with no shrink or owner box.
    let bytes = strings::to_utf8_alloc_with_type(slice);
    bun_jsc::array_buffer::typed_array_from_vec(
        global_this,
        JSType::Uint8Array.to_typed_array_type(),
        bytes,
    )
    .unwrap_or(JSValue::ZERO)
}

/// # Safety
/// `ptr` must be valid for reading `len` UTF-16 code units.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn TextEncoder__encode16(
    global_this: &JSGlobalObject,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    // SAFETY: caller guarantees ptr[0..len] is valid UTF-16 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    encode16_impl(global_this, slice)
}

/// # Safety
/// `ptr` must be valid for reading `len` UTF-16 code units.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn c(
    global_this: &JSGlobalObject,
    ptr: *const u16,
    len: usize,
) -> JSValue {
    // SAFETY: caller guarantees ptr[0..len] is valid UTF-16 data
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    encode16_impl(global_this, slice)
}

// This is a fast path for copying a Rope string into a Uint8Array.
// This keeps us from an extra string temporary allocation
struct RopeStringEncoder<'a> {
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
    pub(crate) extern "C" fn append8(it: *mut JSStringIterator, ptr: *const u8, len: u32) {
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

    pub(crate) extern "C" fn append16(it: *mut JSStringIterator, _: *const u16, _: u32) {
        let (it, this) = Self::resolve(it);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    pub(crate) extern "C" fn write8(
        it: *mut JSStringIterator,
        ptr: *const u8,
        len: u32,
        offset: u32,
    ) {
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

    pub(crate) extern "C" fn write16(it: *mut JSStringIterator, _: *const u16, _: u32, _: u32) {
        let (it, this) = Self::resolve(it);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    pub(crate) fn iter(&mut self) -> JSStringIterator {
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
pub(crate) extern "C" fn TextEncoder__encodeRopeString(
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
        buf: array_buffer.byte_slice_mut(),
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

/// # Safety
/// `input_ptr` must be valid for reading `input_len` UTF-16 code units and
/// `buf_ptr` must be valid for writing `buf_len` bytes.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn TextEncoder__encodeInto16(
    input_ptr: *const u16,
    input_len: usize,
    buf_ptr: *mut u8,
    buf_len: usize,
) -> u64 {
    // SAFETY: caller guarantees buf_ptr[0..buf_len] is a valid mutable buffer
    let output = unsafe { core::slice::from_raw_parts_mut(buf_ptr, buf_len) };
    // SAFETY: caller guarantees input_ptr[0..input_len] is valid UTF-16 data
    let input = unsafe { core::slice::from_raw_parts(input_ptr, input_len) };
    let result: strings::EncodeIntoResult = strings::copy_utf16_into_utf8(output, input);
    // Pack `read` at byte offset 0 and `written` at offset 4 via native-endian bytes — no `unsafe`.
    let mut b = [0u8; 8];
    b[..4].copy_from_slice(&result.read.to_ne_bytes());
    b[4..].copy_from_slice(&result.written.to_ne_bytes());
    u64::from_ne_bytes(b)
}

/// # Safety
/// `input_ptr` must be valid for reading `input_len` bytes of Latin-1 data and
/// `buf_ptr` must be valid for writing `buf_len` bytes.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn TextEncoder__encodeInto8(
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
    // Pack `read` at byte offset 0 and `written` at offset 4 via native-endian bytes — no `unsafe`.
    let mut b = [0u8; 8];
    b[..4].copy_from_slice(&result.read.to_ne_bytes());
    b[4..].copy_from_slice(&result.written.to_ne_bytes());
    u64::from_ne_bytes(b)
}

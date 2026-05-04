//! Port of `src/string/immutable/unicode.zig`.

use bun_alloc::AllocError;
use bun_str::strings::{
    self, copy_u16_to_u8 as highway_copy_u16_to_u8, eql_ignore_len, first_non_ascii,
    first_non_ascii16, unicode_replacement, U3Fast, ASCII_VECTOR_SIZE,
};
use bun_str::{WStr, ZStr};

use bun_core::CodePoint; // i32
use bun_js_parser::js_lexer;
use bun_simdutf as simdutf;

bun_output::declare_scope!(strings, hidden);

// ───────────────────────────── NewCodePointIterator ─────────────────────────────

/// Trait providing the per-instantiation `ZERO_VALUE` that Zig threaded as a
/// `comptime_int` parameter alongside the codepoint type.
pub trait CodePointZero: Copy + Eq + From<u8> {
    const ZERO_VALUE: Self;
    const MAX: Self;
}

impl CodePointZero for CodePoint {
    const ZERO_VALUE: Self = -1;
    const MAX: Self = CodePoint::MAX;
}

impl CodePointZero for u32 {
    const ZERO_VALUE: Self = 0;
    const MAX: Self = u32::MAX;
}

/// Zig: `fn NewCodePointIterator(comptime CodePointType_, comptime zeroValue) type`.
pub struct NewCodePointIterator<'a, C: CodePointZero> {
    pub bytes: &'a [u8],
    pub i: usize,
    pub next_width: usize,
    pub width: U3Fast,
    pub c: C,
}

#[derive(Clone, Copy)]
pub struct Cursor<C: CodePointZero> {
    pub i: u32,
    pub c: C,
    pub width: U3Fast,
}

impl<C: CodePointZero> Default for Cursor<C> {
    fn default() -> Self {
        Self { i: 0, c: C::ZERO_VALUE, width: 0 }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SkipResult {
    Eof,
    Found,
    NotFound,
}

impl<'a, C: CodePointZero> NewCodePointIterator<'a, C> {
    pub const ZERO_VALUE: C = C::ZERO_VALUE;

    pub fn init(str: &'a [u8]) -> Self {
        Self { bytes: str, i: 0, next_width: 0, width: 0, c: C::ZERO_VALUE }
    }

    pub fn init_offset(str: &'a [u8], i: usize) -> Self {
        Self { bytes: str, i, next_width: 0, width: 0, c: C::ZERO_VALUE }
    }

    /// Advance forward until the scalar function returns true.
    /// THe simd function is "best effort" and expected to sometimes return a result which `scalar` will return false for.
    /// This is because we don't decode UTF-8 in the SIMD code path.
    pub fn skip(
        it: &Self,
        cursor: &mut Cursor<C>,
        simd: fn(&[u8]) -> Option<usize>,
        scalar: fn(C) -> bool,
    ) -> SkipResult {
        loop {
            // 1. Get current position. Check for EOF.
            let current_byte_index = cursor.i;
            if current_byte_index as usize >= it.bytes.len() {
                return SkipResult::NotFound; // Reached end without finding
            }

            // 2. Decode the *next* character using the standard iterator method.
            if !Self::next(it, cursor) {
                return SkipResult::NotFound; // Reached end or error during decode
            }

            // 3. Check if the character just decoded matches the scalar condition.
            // PORT NOTE: Zig reads `it.c` here, but `next()` writes to `cursor.c` not `it.c`;
            // preserved as-is (reads the iterator's `c` which is unchanged by `next`).
            if scalar(it.c) {
                return SkipResult::Found; // Found it!
            }

            // 4. Optimization: Can we skip ahead using SIMD?
            //    Scan starting from the byte *after* the character we just decoded.
            let next_scan_start_index = cursor.i as usize;
            if next_scan_start_index >= it.bytes.len() {
                // Just decoded the last character and it didn't match.
                return SkipResult::NotFound;
            }
            let remaining_slice = &it.bytes[next_scan_start_index..];
            if remaining_slice.is_empty() {
                return SkipResult::NotFound;
            }

            // Ask SIMD for the next potential candidate.
            if let Some(pos) = simd(remaining_slice) {
                // SIMD found a potential candidate `pos` bytes ahead.
                if pos > 0 {
                    // Jump the byte index to the start of the potential candidate.
                    cursor.i = u32::try_from(next_scan_start_index + pos).unwrap();
                    // Reset width so next() decodes correctly from the jumped position.
                    cursor.width = 0;
                    // Loop will continue, starting the decode from the new cursor.i.
                    continue;
                }
                // If pos == 0, SIMD suggests the *immediate next* character.
                // No jump needed, just let the loop iterate naturally.
                // Fallthrough to the end of the loop.
            } else {
                // SIMD found no potential candidates in the rest of the string.
                // Since the SIMD search set is a superset of the scalar check set,
                // we can guarantee that no character satisfying `scalar` exists further.
                // Since the current character (decoded in step 2) also didn't match,
                // we can conclude the target character is not found.
                return SkipResult::NotFound;
            }

            // If we reach here, it means SIMD returned pos=0.
            // Loop continues to the next iteration, processing the immediate next char.
        } // End while true
    }

    #[inline]
    pub fn next(it: &Self, cursor: &mut Cursor<C>) -> bool {
        let pos: u32 = cursor.width as u32 + cursor.i;
        if pos as usize >= it.bytes.len() {
            return false;
        }

        let cp_len = wtf8_byte_sequence_length(it.bytes[pos as usize]);
        let error_char = C::MAX;

        let codepoint: C = match cp_len {
            0 => return false,
            1 => C::from(it.bytes[pos as usize]),
            _ => {
                // Copy into a zero-padded stack buffer so we never read past
                // the end of `it.bytes` when a multi-byte lead appears near
                // EOF without enough continuation bytes. The zero padding is
                // rejected by decodeWTF8RuneTMultibyte (0x00 is not a valid
                // continuation byte), so truncated sequences become U+FFFD.
                let remaining = &it.bytes[pos as usize..];
                let n = remaining.len().min(4);
                let cp_bytes: [u8; 4] = [
                    remaining[0],
                    if n > 1 { remaining[1] } else { 0 },
                    if n > 2 { remaining[2] } else { 0 },
                    if n > 3 { remaining[3] } else { 0 },
                ];
                decode_wtf8_rune_t_multibyte::<C>(&cp_bytes, cp_len, error_char)
            }
        };

        *cursor = Cursor {
            i: pos,
            c: if error_char != codepoint {
                codepoint
            } else {
                // TODO(port): unicode_replacement cast — assumes C: From<u32> for 0xFFFD
                C::from_u32(unicode_replacement)
            },
            width: if codepoint != error_char { cp_len } else { 1 },
        };

        true
    }

    #[inline]
    fn next_codepoint_slice(it: &mut Self) -> &'a [u8] {
        let bytes = it.bytes;
        let prev = it.i;
        let next_ = prev + it.next_width;
        if bytes.len() <= next_ {
            return b"";
        }

        let cp_len = utf8_byte_sequence_length(bytes[next_]);
        it.next_width = cp_len as usize;
        it.i = next_.min(bytes.len());

        let slice = &bytes[prev..][..(cp_len as usize).min(bytes.len() - prev)];
        it.width = U3Fast::try_from(slice.len()).unwrap();
        slice
    }

    pub fn needs_utf8_decoding(slice: &[u8]) -> bool {
        let mut it = NewCodePointIterator::<C>::init(slice);

        loop {
            let part = it.next_codepoint_slice();
            // @setRuntimeSafety(false) — no Rust equivalent needed
            match part.len() {
                0 => return false,
                1 => continue,
                _ => return true,
            }
        }
    }

    pub fn scan_until_quoted_value_or_eof<const QUOTE: i32>(iter: &mut Self) -> usize
    where
        C: PartialOrd<i32> + PartialEq<i32>,
    {
        // TODO(port): generic comparison `iter.c > -1` only meaningful for signed CodePoint
        while iter.c > -1 {
            let cp = iter.next_codepoint();
            let keep_going = if cp == QUOTE {
                false
            } else if cp == ('\\' as i32) {
                if iter.next_codepoint() == QUOTE {
                    continue;
                }
                true
            } else {
                true
            };
            if !keep_going {
                return iter.i + 1;
            }
        }

        iter.i
    }

    pub fn next_codepoint(it: &mut Self) -> C {
        let slice = it.next_codepoint_slice();

        it.c = match slice.len() {
            0 => C::ZERO_VALUE,
            1 => C::from(slice[0]),
            2 => C::from_u32(utf8_decode2(slice).expect("unreachable")),
            3 => C::from_u32(utf8_decode3(slice).expect("unreachable")),
            4 => C::from_u32(utf8_decode4(slice).expect("unreachable")),
            _ => unreachable!(),
        };

        it.c
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    pub fn peek(it: &mut Self, n: usize) -> &'a [u8] {
        let original_i = it.i;
        let bytes = it.bytes;

        let mut end_ix = original_i;
        for _ in 0..n {
            // PORT NOTE: Zig used `orelse` on a non-optional slice; treat empty as EOF.
            let next_codepoint = it.next_codepoint_slice();
            if next_codepoint.is_empty() {
                it.i = original_i;
                return &bytes[original_i..];
            }
            end_ix += next_codepoint.len();
        }

        it.i = original_i;
        &bytes[original_i..end_ix]
    }
}

// TODO(port): helper trait extension for `from_u32` on CodePointZero — Phase B can fold into trait.
trait FromU32 {
    fn from_u32(v: u32) -> Self;
}
impl FromU32 for i32 {
    #[inline]
    fn from_u32(v: u32) -> Self { v as i32 }
}
impl FromU32 for u32 {
    #[inline]
    fn from_u32(v: u32) -> Self { v }
}

// TODO(port): std.unicode.utf8Decode2/3/4 equivalents — provide thin local impls or move to bun_str.
fn utf8_decode2(s: &[u8]) -> Option<u32> { bun_str::strings::utf8_decode2(s) }
fn utf8_decode3(s: &[u8]) -> Option<u32> { bun_str::strings::utf8_decode3(s) }
fn utf8_decode4(s: &[u8]) -> Option<u32> { bun_str::strings::utf8_decode4(s) }

pub type CodepointIterator<'a> = NewCodePointIterator<'a, CodePoint>;
pub type UnsignedCodepointIterator<'a> = NewCodePointIterator<'a, u32>;

// ───────────────────────────── helpers ─────────────────────────────

pub fn contains_non_bmp_code_point(text: &[u8]) -> bool {
    let iter = CodepointIterator::init(text);
    let mut curs = Cursor::<CodePoint>::default();

    while CodepointIterator::next(&iter, &mut curs) {
        if curs.c > 0xFFFF {
            return true;
        }
    }

    false
}

pub fn contains_non_bmp_code_point_or_is_invalid_identifier(text: &[u8]) -> bool {
    let iter = CodepointIterator::init(text);
    let mut curs = Cursor::<CodePoint>::default();

    if !CodepointIterator::next(&iter, &mut curs) {
        return true;
    }

    if curs.c > 0xFFFF || !js_lexer::is_identifier_start(curs.c) {
        return true;
    }

    while CodepointIterator::next(&iter, &mut curs) {
        if curs.c > 0xFFFF || !js_lexer::is_identifier_continue(curs.c) {
            return true;
        }
    }

    false
}

/// Convert potentially ill-formed UTF-8 or UTF-16 bytes to a Unicode Codepoint.
/// - Invalid codepoints are replaced with `zero` parameter
/// - Null bytes return 0
pub fn decode_wtf8_rune_t<T: CodePointZero>(p: &[u8; 4], len: U3Fast, zero: T) -> T {
    if len == 0 {
        return zero;
    }
    if len == 1 {
        return T::from(p[0]);
    }

    decode_wtf8_rune_t_multibyte::<T>(p, len, zero)
}

pub fn codepoint_size<R>(r: R) -> U3Fast
where
    R: Into<u32> + Copy,
{
    match r.into() {
        0b0000_0000..=0b0111_1111 => 1,
        0b1100_0000..=0b1101_1111 => 2,
        0b1110_0000..=0b1110_1111 => 3,
        0b1111_0000..=0b1111_0111 => 4,
        _ => 0,
    }
}

// ───────────────────────────── UTF16 → UTF8 ─────────────────────────────

pub fn convert_utf16_to_utf8(mut list: Vec<u8>, utf16: &[u16]) -> Result<Vec<u8>, AllocError> {
    let result = simdutf::convert::utf16::to::utf8::with_errors_le(
        utf16,
        list.spare_capacity_mut_as_slice(), // TODO(port): allocatedSlice() == full backing buffer from idx 0
    );
    if result.status == simdutf::Status::Surrogate {
        // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
        return to_utf8_list_with_type_bun::<false>(&mut list, utf16).map(|_| list);
    }

    // SAFETY: simdutf wrote `result.count` bytes into the allocated capacity.
    unsafe { list.set_len(result.count) };
    Ok(list)
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SurrogatePairError {
    #[error("SurrogatePair")]
    SurrogatePair,
}

pub fn convert_utf16_to_utf8_without_invalid_surrogate_pairs(
    mut list: Vec<u8>,
    utf16: &[u16],
) -> Result<Vec<u8>, SurrogatePairError> {
    let result = simdutf::convert::utf16::to::utf8::with_errors_le(
        utf16,
        list.spare_capacity_mut_as_slice(), // TODO(port): allocatedSlice()
    );
    if result.status == simdutf::Status::Surrogate {
        return Err(SurrogatePairError::SurrogatePair);
    }

    // SAFETY: simdutf wrote `result.count` bytes into the allocated capacity.
    unsafe { list.set_len(result.count) };
    Ok(list)
}

pub fn convert_utf16_to_utf8_append(list: &mut Vec<u8>, utf16: &[u16]) -> Result<(), AllocError> {
    let result = simdutf::convert::utf16::to::utf8::with_errors_le(
        utf16,
        list.spare_capacity_mut_as_slice(),
    );

    if result.status == simdutf::Status::Surrogate {
        // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
        let _ = to_utf8_list_with_type_bun::<false>(list, utf16)?;
        return Ok(());
    }

    // SAFETY: simdutf wrote `result.count` bytes after the current len.
    unsafe { list.set_len(list.len() + result.count) };
    Ok(())
}

pub fn to_utf8_alloc_with_type_without_invalid_surrogate_pairs(
    utf16: &[u16],
) -> Result<Vec<u8>, AllocError> {
    // previously, this function was an exact copy of `toUTF8AllocWithType`.
    // TODO: actually make this function behave differently?
    to_utf8_alloc_with_type(utf16)
}

pub fn to_utf8_alloc_with_type(utf16: &[u16]) -> Result<Vec<u8>, AllocError> {
    if bun_core::FeatureFlags::USE_SIMDUTF {
        let length = simdutf::length::utf8::from::utf16_le(utf16);
        // add 16 bytes of padding for SIMDUTF
        let list = Vec::with_capacity(length + 16);
        let list = convert_utf16_to_utf8(list, utf16)?;
        return Ok(list);
    }

    let list = Vec::with_capacity(utf16.len());
    let list = to_utf8_list_with_type(list, utf16)?;
    Ok(list)
}

pub fn to_utf8_list_with_type(mut list: Vec<u8>, utf16: &[u16]) -> Result<Vec<u8>, AllocError> {
    if bun_core::FeatureFlags::USE_SIMDUTF {
        let length = simdutf::length::utf8::from::utf16_le(utf16);
        list.reserve_exact((length + 16).saturating_sub(list.len()));
        let buf = convert_utf16_to_utf8(list, utf16)?;

        // Commenting out because `convertUTF16ToUTF8` may convert to WTF-8
        // which uses 3 bytes for invalid surrogates, causing the length to not
        // match from simdutf.
        // if (Environment.allow_assert) {
        //     bun.unsafeAssert(buf.items.len == length);
        // }

        return Ok(buf);
    }

    unreachable!("not implemented");
}

pub fn to_utf8_append_to_list(list: &mut Vec<u8>, utf16: &[u16]) -> Result<(), AllocError> {
    if !bun_core::FeatureFlags::USE_SIMDUTF {
        unreachable!("not implemented");
    }
    let length = simdutf::length::utf8::from::utf16_le(utf16);
    list.reserve(length + 16);
    convert_utf16_to_utf8_append(list, utf16)?;
    Ok(())
}

pub fn to_utf8_from_latin1(latin1: &[u8]) -> Result<Option<Vec<u8>>, AllocError> {
    if is_all_ascii(latin1) {
        return Ok(None);
    }

    let list = Vec::with_capacity(latin1.len());
    Ok(Some(allocate_latin1_into_utf8_with_list(list, 0, latin1)?))
}

pub fn to_utf8_from_latin1_z(latin1: &[u8]) -> Result<Option<Vec<u8>>, AllocError> {
    if is_all_ascii(latin1) {
        return Ok(None);
    }

    let list = Vec::with_capacity(latin1.len() + 1);
    let mut list1 = allocate_latin1_into_utf8_with_list(list, 0, latin1)?;
    list1.push(0);
    Ok(Some(list1))
}

/// Returns `Some(u16)` (the trailing lead surrogate) when `SKIP_TRAILING_REPLACEMENT` and a
/// dangling lead surrogate is at the end; otherwise `None`. When `SKIP_TRAILING_REPLACEMENT` is
/// false the Zig version returned the list by value — in Rust the caller already owns `list`.
pub fn to_utf8_list_with_type_bun<const SKIP_TRAILING_REPLACEMENT: bool>(
    list: &mut Vec<u8>,
    utf16: &[u16],
) -> Result<Option<u16>, AllocError> {
    let mut utf16_remaining = utf16;

    while let Some(i) = first_non_ascii16(utf16_remaining) {
        let i = i as usize;
        let to_copy = &utf16_remaining[..i];
        utf16_remaining = &utf16_remaining[i..];
        let token = utf16_remaining[0];

        let replacement = utf16_codepoint_with_fffd_and_first_input_char(token, utf16_remaining);
        utf16_remaining = &utf16_remaining[replacement.len as usize..];

        let count: usize = replacement.utf8_width() as usize;
        #[cfg(not(target_family = "wasm"))]
        {
            let extra = ((utf16_remaining.len() as u64 & ((1u64 << 52) - 1)) as f64 * 1.2) as usize;
            list.reserve_exact((i + count + list.len() + extra).saturating_sub(list.len()));
        }
        #[cfg(target_family = "wasm")]
        {
            list.reserve_exact((i + count + list.len() + utf16_remaining.len() + 4).saturating_sub(list.len()));
        }
        let old_len = list.len();
        // SAFETY: capacity reserved above; bytes written immediately below.
        unsafe { list.set_len(old_len + i) };

        copy_u16_into_u8(&mut list[old_len..], to_copy);

        if SKIP_TRAILING_REPLACEMENT {
            if replacement.is_lead && utf16_remaining.is_empty() {
                return Ok(Some(token));
            }
        }

        let cur_len = list.len();
        // SAFETY: capacity reserved above for `count` bytes; encodeWTF8RuneT writes them.
        unsafe { list.set_len(cur_len + count) };
        // SAFETY: we need a *[4]u8 view starting at cur_len; capacity guarantees ≥4 bytes available.
        let four: &mut [u8; 4] = unsafe {
            &mut *(list.as_mut_ptr().add(cur_len) as *mut [u8; 4])
        };
        let _ = encode_wtf8_rune_t::<u32>(four, replacement.code_point);
    }

    if !utf16_remaining.is_empty() {
        let need = utf16_remaining.len() + list.len();
        list.reserve_exact(need.saturating_sub(list.len()));
        let old_len = list.len();
        // SAFETY: capacity reserved; bytes written immediately below.
        unsafe { list.set_len(old_len + utf16_remaining.len()) };
        copy_u16_into_u8(&mut list[old_len..], utf16_remaining);
    }

    bun_output::scoped_log!(strings, "UTF16 {} -> {} UTF8", utf16.len(), list.len());

    if SKIP_TRAILING_REPLACEMENT {
        return Ok(None);
    }
    Ok(None)
}

#[derive(Clone, Copy, Default)]
pub struct EncodeIntoResult {
    /// The number of u16s we read from the utf-16 buffer
    pub read: u32,
    /// The number of u8s we wrote to the utf-8 buffer
    pub written: u32,
}

pub fn allocate_latin1_into_utf8(latin1_: &[u8]) -> Result<Vec<u8>, AllocError> {
    let list = Vec::with_capacity(latin1_.len());
    let foo = allocate_latin1_into_utf8_with_list(list, 0, latin1_)?;
    Ok(foo)
}

pub fn allocate_latin1_into_utf8_with_list(
    mut list: Vec<u8>,
    offset_into_list: usize,
    latin1_: &[u8],
) -> Result<Vec<u8>, AllocError> {
    let mut latin1 = latin1_;
    let mut i: usize = offset_into_list;
    list.reserve(latin1.len());

    while !latin1.is_empty() {
        debug_assert!(i < list.capacity());
        // SAFETY: we operate on the raw backing buffer between `i` and `capacity`, mirroring Zig's
        // `list.items.ptr[i..list.capacity]`. Bytes are written before being observed.
        let mut buf: &mut [u8] = unsafe {
            core::slice::from_raw_parts_mut(list.as_mut_ptr().add(i), list.capacity() - i)
        };

        'inner: {
            // PERF(port): Zig used @Vector(ascii_vector_size, u8) + @reduce(.Max). Rust portable_simd
            // is unstable; fall back to the u64 SWAR path which the Zig also contains. Profile in Phase B.
            let mut count = latin1.len() / ASCII_VECTOR_SIZE;
            while count > 0 {
                count -= 1;
                // Emulate `@reduce(.Max, vec) > 127` by scanning the chunk for a high bit.
                let chunk = &latin1[..ASCII_VECTOR_SIZE];
                let mut has_high = false;
                for &b in chunk {
                    if b > 127 {
                        has_high = true;
                        break;
                    }
                }

                if has_high {
                    const SIZE: usize = core::mem::size_of::<u64>();
                    // zig or LLVM doesn't do @ctz nicely with SIMD
                    if ASCII_VECTOR_SIZE >= 8 {
                        {
                            let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().unwrap());
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            let mask = bytes & 0x8080808080808080;

                            if mask > 0 {
                                let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                                debug_assert!(latin1[first_set_byte] >= 127);

                                buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());
                                buf = &mut buf[first_set_byte..];
                                latin1 = &latin1[first_set_byte..];
                                break 'inner;
                            }

                            buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());
                            latin1 = &latin1[SIZE..];
                            buf = &mut buf[SIZE..];
                        }

                        if ASCII_VECTOR_SIZE >= 16 {
                            let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().unwrap());
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            let mask = bytes & 0x8080808080808080;

                            if mask > 0 {
                                let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                                debug_assert!(latin1[first_set_byte] >= 127);

                                buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());
                                buf = &mut buf[first_set_byte..];
                                latin1 = &latin1[first_set_byte..];
                                break 'inner;
                            }
                        }
                    }
                    unreachable!();
                }

                buf[..ASCII_VECTOR_SIZE].copy_from_slice(chunk);
                latin1 = &latin1[ASCII_VECTOR_SIZE..];
                buf = &mut buf[ASCII_VECTOR_SIZE..];
            }

            while latin1.len() >= 8 {
                const SIZE: usize = core::mem::size_of::<u64>();

                let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().unwrap());
                // https://dotat.at/@/2022-06-27-tolower-swar.html
                let mask = bytes & 0x8080808080808080;

                if mask > 0 {
                    let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                    debug_assert!(latin1[first_set_byte] >= 127);

                    buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());
                    latin1 = &latin1[first_set_byte..];
                    buf = &mut buf[first_set_byte..];
                    break 'inner;
                }

                buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());
                latin1 = &latin1[SIZE..];
                buf = &mut buf[SIZE..];
            }

            {
                debug_assert!(latin1.len() < 8);
                while !latin1.is_empty() && latin1[0] < 128 {
                    buf[0] = latin1[0];
                    buf = &mut buf[1..];
                    latin1 = &latin1[1..];
                }
            }
        }

        while !latin1.is_empty() && latin1[0] > 127 {
            // PORT NOTE: reshaped for borrowck — recompute `i` from buf offset.
            i = (buf.as_ptr() as usize) - (list.as_ptr() as usize);
            // SAFETY: `i` bytes have been written into the backing buffer.
            unsafe { list.set_len(i) };
            list.reserve(2 + latin1.len());
            // SAFETY: see top of loop.
            buf = unsafe {
                core::slice::from_raw_parts_mut(list.as_mut_ptr().add(i), list.capacity() - i)
            };
            let two = latin1_to_codepoint_bytes_assume_not_ascii(latin1[0] as u32);
            buf[..2].copy_from_slice(&two);
            latin1 = &latin1[1..];
            buf = &mut buf[2..];
        }

        i = (buf.as_ptr() as usize) - (list.as_ptr() as usize);
        // SAFETY: `i` bytes have been written into the backing buffer.
        unsafe { list.set_len(i) };
    }

    bun_output::scoped_log!(strings, "Latin1 {} -> UTF8 {}", latin1_.len(), i);

    Ok(list)
}

#[derive(Clone, Copy)]
pub struct UTF16Replacement {
    pub code_point: u32,
    pub len: U3Fast,

    /// Explicit fail boolean to distinguish between a Unicode Replacement Codepoint
    /// that was already in there
    /// and a genuine error.
    pub fail: bool,

    pub can_buffer: bool,
    pub is_lead: bool,
}

impl Default for UTF16Replacement {
    fn default() -> Self {
        Self {
            code_point: unicode_replacement,
            len: 0,
            fail: false,
            can_buffer: true,
            is_lead: false,
        }
    }
}

impl UTF16Replacement {
    #[inline]
    pub fn utf8_width(self) -> U3Fast {
        match self.code_point {
            0..=0x7F => 1,
            0x80..=0x7FF => 2,
            0x800..=0xFFFF => 3,
            _ => 4,
        }
    }
}

pub fn convert_utf8_bytes_into_utf16_with_length(
    sequence: &[u8; 4],
    len: U3Fast,
    remaining_len: usize,
) -> UTF16Replacement {
    debug_assert!(sequence[0] > 127);
    match len {
        2 => {
            debug_assert!(sequence[0] >= 0xC0);
            debug_assert!(sequence[0] <= 0xDF);
            if sequence[1] < 0x80 || sequence[1] > 0xBF {
                return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
            }
            UTF16Replacement {
                len,
                code_point: ((sequence[0] as u32) << 6) + (sequence[1] as u32) - 0x00003080,
                ..Default::default()
            }
        }
        3 => {
            debug_assert!(sequence[0] >= 0xE0);
            debug_assert!(sequence[0] <= 0xEF);
            match sequence[0] {
                0xE0 => {
                    if sequence[1] < 0xA0 || sequence[1] > 0xBF {
                        return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
                    }
                }
                0xED => {
                    if sequence[1] < 0x80 || sequence[1] > 0x9F {
                        return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
                    }
                }
                _ => {
                    if sequence[1] < 0x80 || sequence[1] > 0xBF {
                        return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
                    }
                }
            }
            if sequence[2] < 0x80 || sequence[2] > 0xBF {
                return UTF16Replacement { len: 2, fail: true, can_buffer: remaining_len < 3, ..Default::default() };
            }
            UTF16Replacement {
                len,
                code_point: (((sequence[0] as u32) << 12) + ((sequence[1] as u32) << 6) + (sequence[2] as u32)) - 0x000E2080,
                ..Default::default()
            }
        }
        4 => {
            match sequence[0] {
                0xF0 => {
                    if sequence[1] < 0x90 || sequence[1] > 0xBF {
                        return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
                    }
                }
                0xF4 => {
                    if sequence[1] < 0x80 || sequence[1] > 0x8F {
                        return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
                    }
                }
                // invalid code point
                // this used to be an assertion
                0..=0xEF | 0xF5..=u8::MAX => {
                    return UTF16Replacement { len: 1, fail: true, can_buffer: false, ..Default::default() };
                }
                _ => {
                    if sequence[1] < 0x80 || sequence[1] > 0xBF {
                        return UTF16Replacement { len: 1, fail: true, can_buffer: remaining_len < 2, ..Default::default() };
                    }
                }
            }

            if sequence[2] < 0x80 || sequence[2] > 0xBF {
                return UTF16Replacement { len: 2, fail: true, can_buffer: remaining_len < 3, ..Default::default() };
            }
            if sequence[3] < 0x80 || sequence[3] > 0xBF {
                return UTF16Replacement { len: 3, fail: true, can_buffer: remaining_len < 4, ..Default::default() };
            }
            UTF16Replacement {
                len,
                code_point: (((sequence[0] as u32) << 18)
                    + ((sequence[1] as u32) << 12)
                    + ((sequence[2] as u32) << 6)
                    + (sequence[3] as u32))
                    - 0x03C82080,
                ..Default::default()
            }
        }
        // invalid unicode sequence
        // 1 or 0 are both invalid here
        _ => UTF16Replacement { len: 1, fail: true, ..Default::default() },
    }
}

// This variation matches WebKit behavior.
// fn convertUTF8BytesIntoUTF16(sequence: *const [4]u8, remaining_len: usize) UTF16Replacement {
pub fn convert_utf8_bytes_into_utf16(bytes: &[u8]) -> UTF16Replacement {
    let sequence: [u8; 4] = match bytes.len() {
        0 => unreachable!(),
        1 => [bytes[0], 0, 0, 0],
        2 => [bytes[0], bytes[1], 0, 0],
        3 => [bytes[0], bytes[1], bytes[2], 0],
        _ => bytes[..4].try_into().unwrap(),
    };
    debug_assert!(sequence[0] > 127);
    let sequence_length = non_ascii_sequence_length(sequence[0]);
    convert_utf8_bytes_into_utf16_with_length(&sequence, sequence_length, bytes.len())
}

pub fn copy_latin1_into_utf8(buf_: &mut [u8], latin1_: &[u8]) -> EncodeIntoResult {
    copy_latin1_into_utf8_stop_on_non_ascii::<false>(buf_, latin1_)
}

pub fn copy_latin1_into_utf8_stop_on_non_ascii<const STOP: bool>(
    buf_: &mut [u8],
    latin1_: &[u8],
) -> EncodeIntoResult {
    let buf_total = buf_.len();
    let latin1_total = latin1_.len();
    let mut buf: &mut [u8] = buf_;
    let mut latin1: &[u8] = latin1_;

    bun_output::scoped_log!(strings, "latin1 encode {} -> {}", buf_total, latin1_total);

    while !buf.is_empty() && !latin1.is_empty() {
        'inner: {
            // PERF(port): Zig used @Vector(ascii_vector_size, u8) + @reduce(.Max). See note in
            // allocate_latin1_into_utf8_with_list — we emulate with a scalar high-bit scan.
            let mut remaining_runs = buf.len().min(latin1.len()) / ASCII_VECTOR_SIZE;
            while remaining_runs > 0 {
                remaining_runs -= 1;
                let chunk = &latin1[..ASCII_VECTOR_SIZE];
                let mut has_high = false;
                for &b in chunk {
                    if b > 127 {
                        has_high = true;
                        break;
                    }
                }

                if has_high {
                    if STOP {
                        return EncodeIntoResult { written: u32::MAX, read: u32::MAX };
                    }

                    // zig or LLVM doesn't do @ctz nicely with SIMD
                    if ASCII_VECTOR_SIZE >= 8 {
                        const SIZE: usize = core::mem::size_of::<u64>();

                        {
                            let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().unwrap());
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            let mask = bytes & 0x8080808080808080;

                            buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());

                            if mask > 0 {
                                let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                                debug_assert!(latin1[first_set_byte] >= 127);

                                buf = &mut buf[first_set_byte..];
                                latin1 = &latin1[first_set_byte..];
                                break 'inner;
                            }

                            latin1 = &latin1[SIZE..];
                            buf = &mut buf[SIZE..];
                        }

                        if ASCII_VECTOR_SIZE >= 16 {
                            let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().unwrap());
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            let mask = bytes & 0x8080808080808080;

                            buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());

                            debug_assert!(mask > 0);
                            let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                            debug_assert!(latin1[first_set_byte] >= 127);

                            buf = &mut buf[first_set_byte..];
                            latin1 = &latin1[first_set_byte..];
                            break 'inner;
                        }
                    }
                    unreachable!();
                }

                buf[..ASCII_VECTOR_SIZE].copy_from_slice(chunk);
                latin1 = &latin1[ASCII_VECTOR_SIZE..];
                buf = &mut buf[ASCII_VECTOR_SIZE..];
            }

            {
                const SIZE: usize = core::mem::size_of::<u64>();
                while buf.len().min(latin1.len()) >= SIZE {
                    let bytes = u64::from_ne_bytes(latin1[..SIZE].try_into().unwrap());
                    buf[..SIZE].copy_from_slice(&bytes.to_ne_bytes());

                    // https://dotat.at/@/2022-06-27-tolower-swar.html

                    let mask = bytes & 0x8080808080808080;

                    if mask > 0 {
                        let first_set_byte = (mask.trailing_zeros() / 8) as usize;
                        if STOP {
                            return EncodeIntoResult { written: u32::MAX, read: u32::MAX };
                        }
                        debug_assert!(latin1[first_set_byte] >= 127);

                        buf = &mut buf[first_set_byte..];
                        latin1 = &latin1[first_set_byte..];

                        break 'inner;
                    }

                    latin1 = &latin1[SIZE..];
                    buf = &mut buf[SIZE..];
                }
            }

            {
                // PORT NOTE: reshaped for borrowck — Zig advanced raw `.ptr`/`.len` independently.
                let limit = buf.len().min(latin1.len());
                debug_assert!(limit < 8);
                let mut k = 0usize;
                while k < limit && latin1[k] <= 127 {
                    buf[k] = latin1[k];
                    k += 1;
                }
                buf = &mut buf[k..];
                latin1 = &latin1[k..];
            }
        }

        if !latin1.is_empty() {
            if buf.len() >= 2 {
                if STOP {
                    return EncodeIntoResult { written: u32::MAX, read: u32::MAX };
                }

                let two = latin1_to_codepoint_bytes_assume_not_ascii(latin1[0] as u32);
                buf[..2].copy_from_slice(&two);
                latin1 = &latin1[1..];
                buf = &mut buf[2..];
            } else {
                break;
            }
        }
    }

    EncodeIntoResult {
        written: (buf_total - buf.len()) as u32,
        read: (latin1_total - latin1.len()) as u32,
    }
}

pub fn replace_latin1_with_utf8(buf_: &mut [u8]) {
    let mut latin1: &mut [u8] = buf_;
    while let Some(i) = first_non_ascii(latin1) {
        let i = i as usize;
        let two = latin1_to_codepoint_bytes_assume_not_ascii(latin1[i] as u32);
        latin1[i..i + 2].copy_from_slice(&two);

        latin1 = &mut latin1[i + 2..];
    }
}

pub fn element_length_latin1_into_utf8(slice: &[u8]) -> usize {
    simdutf::length::utf8::from::latin1(slice)
}

pub fn copy_cp1252_into_utf16(buf_: &mut [u16], latin1_: &[u8]) -> EncodeIntoResult {
    let buf_total = buf_.len();
    let latin1_total = latin1_.len();
    let mut buf: &mut [u16] = buf_;
    let mut latin1: &[u8] = latin1_;
    while !buf.is_empty() && !latin1.is_empty() {
        let to_write = first_non_ascii(latin1)
            .map(|v| v as usize)
            .unwrap_or_else(|| latin1.len().min(buf.len()));
        copy_u8_into_u16(buf, &latin1[..to_write]);

        latin1 = &latin1[to_write..];
        buf = &mut buf[to_write..];
        if !latin1.is_empty() && buf.len() >= 1 {
            buf[0] = cp1252_to_codepoint_bytes_assume_not_ascii16(latin1[0] as u32);
            latin1 = &latin1[1..];
            buf = &mut buf[1..];
        }
    }

    EncodeIntoResult {
        read: (buf_total - buf.len()) as u32,
        written: (latin1_total - latin1.len()) as u32,
    }
}

pub fn copy_latin1_into_utf16(buf_: &mut [u16], latin1_: &[u8]) -> EncodeIntoResult {
    let len = buf_.len().min(latin1_.len());
    debug_assert_eq!(buf_[..len].len(), latin1_[..len].len());
    for (out, &inp) in buf_[..len].iter_mut().zip(latin1_[..len].iter()) {
        *out = inp as u16;
    }
    EncodeIntoResult { read: len as u32, written: len as u32 }
}

pub fn element_length_cp1252_into_utf16(cp1252_: &[u8]) -> usize {
    // cp1252 is always at most 1 UTF-16 code unit long
    cp1252_.len()
}

pub fn eql_utf16(self_: &[u8], other: &[u16]) -> bool {
    if self_.len() != other.len() {
        return false;
    }

    if self_.is_empty() {
        return true;
    }

    // SAFETY: comparing raw bytes; `other` has `self_.len()` u16s == `self_.len()*2` bytes.
    unsafe {
        bun_core::c::memcmp(
            self_.as_ptr() as *const core::ffi::c_void,
            other.as_ptr() as *const core::ffi::c_void,
            self_.len() * core::mem::size_of::<u16>(),
        ) == 0
    }
}

pub fn to_utf8_alloc(js: &[u16]) -> Result<Vec<u8>, AllocError> {
    to_utf8_alloc_with_type(js)
}

pub fn to_utf8_alloc_z(js: &[u16]) -> Result<Box<ZStr>, AllocError> {
    let mut list = Vec::new();
    to_utf8_append_to_list(&mut list, js)?;
    list.push(0);
    // SAFETY: trailing NUL just appended; bytes [0..len-1] form the slice.
    Ok(unsafe { ZStr::from_vec_with_nul_unchecked(list) })
}

#[inline]
pub fn append_utf8_machine_word_to_utf16_machine_word(
    output: &mut [u16; core::mem::size_of::<usize>() / 2],
    input: &[u8; core::mem::size_of::<usize>() / 2],
) {
    // PERF(port): Zig used @Vector(4, u8) -> @Vector(4, u16) widening; scalar widen here.
    for (o, &i) in output.iter_mut().zip(input.iter()) {
        *o = i as u16;
    }
}

#[inline]
pub fn copy_u8_into_u16(output_: &mut [u16], input_: &[u8]) {
    let output = output_;
    let input = input_;
    debug_assert!(input.len() <= output.len());

    // https://zig.godbolt.org/z/9rTn1orcY

    let n = input.len().min(output.len());
    for i in 0..n {
        output[i] = input[i] as u16;
    }
}

#[inline]
pub fn copy_u16_into_u8(output: &mut [u8], input: &[u16]) {
    debug_assert!(input.len() <= output.len());
    let count = input.len().min(output.len());

    bun_highway::copy_u16_to_u8(&input[..count], &mut output[..count]);
}

pub fn copy_latin1_into_ascii(dest: &mut [u8], src: &[u8]) {
    let mut remain = src;
    let mut to: &mut [u8] = dest;

    let non_ascii_offset = first_non_ascii(remain).map(|v| v as usize).unwrap_or(remain.len());
    if non_ascii_offset > 0 {
        to[..non_ascii_offset].copy_from_slice(&remain[..non_ascii_offset]);
        remain = &remain[non_ascii_offset..];
        to = &mut to[non_ascii_offset..];

        // ascii fast path
        if remain.is_empty() {
            return;
        }
    }

    if to.len() >= 16 && bun_core::Environment::ENABLE_SIMD {
        const VECTOR_SIZE: usize = 16;
        // https://zig.godbolt.org/z/qezsY8T3W
        let remain_in_u64_len = remain.len() - (remain.len() % VECTOR_SIZE);
        let to_in_u64_len = to.len() - (to.len() % VECTOR_SIZE);
        // PORT NOTE: reshaped for borrowck — operate on byte indices instead of bytesAsSlice(u64).
        let end_vector_len = (remain_in_u64_len / 8).min(to_in_u64_len / 8);
        let mut idx = 0usize;
        // using the pointer instead of the length is super important for the codegen
        while idx < end_vector_len {
            let buf = u64::from_ne_bytes(remain[idx * 8..idx * 8 + 8].try_into().unwrap());
            // this gets auto-vectorized
            const MASK: u64 = 0x7f7f7f7f7f7f7f7f;
            to[idx * 8..idx * 8 + 8].copy_from_slice(&(buf & MASK).to_ne_bytes());
            idx += 1;
        }
        remain = &remain[remain_in_u64_len..];
        to = &mut to[to_in_u64_len..];
    }

    for to_byte in to.iter_mut() {
        *to_byte = (remain[0] & 0x7f) as u8;
        remain = &remain[1..];
    }
}

/// It is common on Windows to find files that are not encoded in UTF8. Most of these include
/// a 'byte-order mark' codepoint at the start of the file. The layout of this codepoint can
/// determine the encoding.
///
/// https://en.wikipedia.org/wiki/Byte_order_mark
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum BOM {
    Utf8,
    Utf16Le,
    Utf16Be,
    Utf32Le,
    Utf32Be,
}

impl BOM {
    pub const UTF8_BYTES: [u8; 3] = [0xef, 0xbb, 0xbf];
    pub const UTF16_LE_BYTES: [u8; 2] = [0xff, 0xfe];
    pub const UTF16_BE_BYTES: [u8; 2] = [0xfe, 0xff];
    pub const UTF32_LE_BYTES: [u8; 4] = [0xff, 0xfe, 0x00, 0x00];
    pub const UTF32_BE_BYTES: [u8; 4] = [0x00, 0x00, 0xfe, 0xff];

    pub fn detect(bytes: &[u8]) -> Option<BOM> {
        if bytes.len() < 3 {
            return None;
        }
        if eql_ignore_len(bytes, &Self::UTF8_BYTES) {
            return Some(BOM::Utf8);
        }
        if eql_ignore_len(bytes, &Self::UTF16_LE_BYTES) {
            // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes[2..], utf32_le_bytes[2..]))
            //   return .utf32_le;
            return Some(BOM::Utf16Le);
        }
        // if (eqlComptimeIgnoreLen(bytes, utf16_be_bytes)) return .utf16_be;
        // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes, utf32_le_bytes)) return .utf32_le;
        None
    }

    pub fn detect_and_split(bytes: &[u8]) -> (Option<BOM>, &[u8]) {
        let bom = Self::detect(bytes);
        match bom {
            None => (None, bytes),
            Some(b) => (bom, &bytes[b.length()..]),
        }
    }

    pub fn get_header(self) -> &'static [u8] {
        match self {
            BOM::Utf8 => &Self::UTF8_BYTES,
            BOM::Utf16Le => &Self::UTF16_LE_BYTES,
            BOM::Utf16Be => &Self::UTF16_BE_BYTES,
            BOM::Utf32Le => &Self::UTF32_LE_BYTES,
            BOM::Utf32Be => &Self::UTF32_BE_BYTES,
        }
    }

    pub fn length(self) -> usize {
        self.get_header().len()
    }

    /// If an allocation is needed, free the input and the caller will
    /// replace it with the new return
    pub fn remove_and_convert_to_utf8_and_free(self, bytes: Vec<u8>) -> Result<Vec<u8>, AllocError> {
        match self {
            BOM::Utf8 => {
                let mut bytes = bytes;
                let n = Self::UTF8_BYTES.len();
                bytes.copy_within(n.., 0);
                bytes.truncate(bytes.len() - n);
                Ok(bytes)
            }
            BOM::Utf16Le => {
                let trimmed_bytes = &bytes[Self::UTF16_LE_BYTES.len()..];
                // SAFETY: trimmed bytes are pairs of u8 forming u16 LE; alignment may be 1 — Zig used @alignCast.
                let trimmed_bytes_u16: &[u16] = unsafe {
                    core::slice::from_raw_parts(
                        trimmed_bytes.as_ptr() as *const u16,
                        trimmed_bytes.len() / 2,
                    )
                };
                let out = to_utf8_alloc(trimmed_bytes_u16)?;
                drop(bytes);
                Ok(out)
            }
            _ => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                let mut bytes = bytes;
                let n = self.get_header().len();
                bytes.copy_within(n.., 0);
                bytes.truncate(bytes.len() - n);
                Ok(bytes)
            }
        }
    }

    /// This is required for fs.zig's `use_shared_buffer` flag. we cannot free that pointer.
    /// The returned slice will always point to the base of the input.
    ///
    /// Requires an arraylist in case it must be grown.
    pub fn remove_and_convert_to_utf8_without_dealloc<'a>(
        self,
        list: &'a mut Vec<u8>,
    ) -> Result<&'a [u8], AllocError> {
        match self {
            BOM::Utf8 => {
                let n = Self::UTF8_BYTES.len();
                let len = list.len();
                list.copy_within(n.., 0);
                // PORT NOTE: Zig returned a subslice without truncating; we mirror by returning a slice.
                Ok(&list[..len - n])
            }
            BOM::Utf16Le => {
                let trimmed_bytes = &list[Self::UTF16_LE_BYTES.len()..];
                // SAFETY: see remove_and_convert_to_utf8_and_free.
                let trimmed_bytes_u16: &[u16] = unsafe {
                    core::slice::from_raw_parts(
                        trimmed_bytes.as_ptr() as *const u16,
                        trimmed_bytes.len() / 2,
                    )
                };
                let out = to_utf8_alloc(trimmed_bytes_u16)?;
                if list.capacity() < out.len() {
                    list.reserve(out.len() - list.len());
                }
                // SAFETY: capacity ensured; bytes overwritten immediately below.
                unsafe { list.set_len(out.len()) };
                list.copy_from_slice(&out);
                // TODO(port): Zig returned `out` (the new alloc); returning list slice instead to honor
                // "always points to the base of the input" doc comment.
                Ok(&list[..])
            }
            _ => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                let n = self.get_header().len();
                let len = list.len();
                list.copy_within(n.., 0);
                Ok(&list[..len - n])
            }
        }
    }
}

/// @deprecated. If you are using this, you likely will need to remove other BOMs and handle encoding.
/// Use the BOM struct's `detect` and conversion functions instead.
pub fn without_utf8_bom(bytes: &[u8]) -> &[u8] {
    if bytes.starts_with(&BOM::UTF8_BYTES) {
        &bytes[BOM::UTF8_BYTES.len()..]
    } else {
        bytes
    }
}

// https://github.com/WebKit/WebKit/blob/443e796d1538654c34f2690e39600c70c8052b63/Source/WebCore/PAL/pal/text/TextCodecUTF8.cpp#L69
pub fn non_ascii_sequence_length(first_byte: u8) -> U3Fast {
    match first_byte {
        0..=193 => 0,
        194..=223 => 2,
        224..=239 => 3,
        240..=244 => 4,
        245..=255 => 0,
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ToUTF16Error {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("InvalidByteSequence")]
    InvalidByteSequence,
}

impl From<AllocError> for ToUTF16Error {
    fn from(_: AllocError) -> Self { ToUTF16Error::OutOfMemory }
}

/// Convert a UTF-8 string to a UTF-16 string IF there are any non-ascii characters
/// If there are no non-ascii characters, this returns null
/// This is intended to be used for strings that go to JavaScript
pub fn to_utf16_alloc<const FAIL_IF_INVALID: bool, const SENTINEL: bool>(
    bytes: &[u8],
) -> Result<Option<Vec<u16>>, ToUTF16Error> {
    // PORT NOTE: Zig's return type was `[:0]u16` vs `[]u16` based on SENTINEL. In Rust both are
    // `Vec<u16>`; when SENTINEL the trailing 0 is included and the logical length is `len()-1`.
    // TODO(port): consider returning `Box<WStr>` for the SENTINEL case in Phase B.
    let Some(i) = first_non_ascii(bytes) else { return Ok(None) };
    let i = i as usize;

    let output_: Option<Vec<u16>> = if bun_core::FeatureFlags::USE_SIMDUTF {
        'simd: {
            let out_length = simdutf::length::utf16::from::utf8(bytes);
            if out_length == 0 {
                break 'simd None;
            }

            let mut out = vec![0u16; out_length + if SENTINEL { 1 } else { 0 }];
            bun_output::scoped_log!(strings, "toUTF16 {} UTF8 -> {} UTF16", bytes.len(), out_length);

            let res = simdutf::convert::utf8::to::utf16::with_errors_le(
                bytes,
                if SENTINEL { &mut out[..out_length] } else { &mut out[..] },
            );
            if res.status == simdutf::Status::Success {
                if SENTINEL {
                    out[out_length] = 0;
                    out.truncate(out_length + 1);
                    return Ok(Some(out));
                }
                return Ok(Some(out));
            }

            if FAIL_IF_INVALID {
                drop(out);
                return Err(ToUTF16Error::InvalidByteSequence);
            }

            // Reuse `out` as a Vec with `i` valid items and full capacity.
            // SAFETY: `i <= out.len()`; first `i` items will be overwritten/kept.
            unsafe { out.set_len(i) };
            break 'simd Some(out);
        }
    } else {
        None
    };
    let mut output = match output_ {
        Some(v) => v,
        None => {
            let mut list = Vec::with_capacity(i + 2);
            // SAFETY: capacity reserved; bytes written immediately below.
            unsafe { list.set_len(i) };
            copy_u8_into_u16(&mut list, &bytes[..i]);
            list
        }
    };
    // errdefer output.deinit() — Vec drops on `?`

    let mut remaining = &bytes[i..];

    {
        let replacement = convert_utf8_bytes_into_utf16(remaining);
        if FAIL_IF_INVALID {
            if replacement.fail {
                debug_assert!(replacement.code_point == unicode_replacement);
                return Err(ToUTF16Error::InvalidByteSequence);
            }
        }
        remaining = &remaining[(replacement.len as usize).max(1)..];

        //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
        match replacement.code_point {
            c @ 0..=0xffff => {
                output.push(u16::try_from(c).unwrap());
            }
            c => {
                output.extend_from_slice(&[u16_lead(c), u16_trail(c)]);
            }
        }
    }

    while let Some(j) = first_non_ascii(remaining) {
        let j = j as usize;
        let end = output.len();
        output.reserve(j);
        // SAFETY: capacity reserved; bytes written immediately below.
        unsafe { output.set_len(end + j) };
        copy_u8_into_u16(&mut output[end..end + j], &remaining[..j]);
        remaining = &remaining[j..];

        let replacement = convert_utf8_bytes_into_utf16(remaining);
        if FAIL_IF_INVALID {
            if replacement.fail {
                debug_assert!(replacement.code_point == unicode_replacement);
                return Err(ToUTF16Error::InvalidByteSequence);
            }
        }
        remaining = &remaining[(replacement.len as usize).max(1)..];

        //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
        match replacement.code_point {
            c @ 0..=0xffff => {
                output.push(u16::try_from(c).unwrap());
            }
            c => {
                output.extend_from_slice(&[u16_lead(c), u16_trail(c)]);
            }
        }
    }

    if !remaining.is_empty() {
        let need = output.len() + remaining.len() + if SENTINEL { 1 } else { 0 };
        output.reserve_exact(need.saturating_sub(output.len()));

        let old = output.len();
        // SAFETY: capacity reserved; bytes written immediately below.
        unsafe { output.set_len(old + remaining.len()) };
        copy_u8_into_u16(&mut output[old..], remaining);
    }

    if SENTINEL {
        output.reserve(1);
        output.push(0); // PERF(port): was assume_capacity
        return Ok(Some(output));
    }

    Ok(Some(output))
}

// TODO(port): move to *_jsc — `TestingAPIs` re-exported from bun_string_jsc.
// pub const TestingAPIs = @import("../../jsc/bun_string_jsc.zig").UnicodeTestingAPIs;

// this one does the thing it's named after
pub fn to_utf16_alloc_for_real<const FAIL_IF_INVALID: bool, const SENTINEL: bool>(
    bytes: &[u8],
) -> Result<Vec<u16>, ToUTF16Error> {
    if let Some(v) = to_utf16_alloc::<FAIL_IF_INVALID, SENTINEL>(bytes)? {
        return Ok(v);
    }
    let mut output = vec![0u16; bytes.len() + if SENTINEL { 1 } else { 0 }];
    copy_u8_into_u16(
        if SENTINEL { &mut output[..bytes.len()] } else { &mut output[..] },
        bytes,
    );

    if SENTINEL {
        output[bytes.len()] = 0;
        return Ok(output);
    }

    Ok(output)
}

pub fn to_utf16_alloc_maybe_buffered<const FAIL_IF_INVALID: bool, const FLUSH: bool>(
    bytes: &[u8],
) -> Result<Option<(Vec<u16>, [u8; 3], u8)>, ToUTF16Error> {
    let Some(first_non_ascii_idx) = first_non_ascii(bytes) else { return Ok(None) };
    let first_non_ascii_idx = first_non_ascii_idx as usize;

    let mut output: Vec<u16> = if bun_core::FeatureFlags::USE_SIMDUTF {
        'output: {
            let out_length = simdutf::length::utf16::from::utf8(bytes);

            if out_length == 0 {
                break 'output Vec::new();
            }

            let mut out = vec![0u16; out_length];

            let res = simdutf::convert::utf8::to::utf16::with_errors_le(bytes, &mut out);
            if res.status == simdutf::Status::Success {
                bun_output::scoped_log!(strings, "toUTF16 {} UTF8 -> {} UTF16", bytes.len(), out_length);
                return Ok(Some((out, [0; 3], 0)));
            }

            // SAFETY: `first_non_ascii_idx <= out.len()`.
            unsafe { out.set_len(first_non_ascii_idx) };
            break 'output out;
        }
    } else {
        Vec::new()
    };
    // errdefer output.deinit(allocator) — Vec drops on `?`

    let start = if !output.is_empty() { first_non_ascii_idx } else { 0 };
    let mut remaining = &bytes[start..];

    let mut non_ascii: Option<u32> = Some(0);
    while let Some(i) = non_ascii {
        let i = i as usize;
        {
            let end = output.len();
            output.reserve(i + 2); // +2 for UTF16 codepoint
            // SAFETY: capacity reserved; bytes written immediately below.
            unsafe { output.set_len(end + i) };
            copy_u8_into_u16(&mut output[end..end + i], &remaining[..i]);
            remaining = &remaining[i..];
        }

        let sequence: [u8; 4] = match remaining.len() {
            0 => unreachable!(),
            1 => [remaining[0], 0, 0, 0],
            2 => [remaining[0], remaining[1], 0, 0],
            3 => [remaining[0], remaining[1], remaining[2], 0],
            _ => remaining[..4].try_into().unwrap(),
        };

        let converted_length = non_ascii_sequence_length(sequence[0]);

        let converted = convert_utf8_bytes_into_utf16_with_length(&sequence, converted_length, remaining.len());

        if !FLUSH {
            if converted.fail && converted.can_buffer && (converted_length as usize) > remaining.len() {
                let buffered: [u8; 3] = match remaining.len() {
                    1 => [remaining[0], 0, 0],
                    2 => [remaining[0], remaining[1], 0],
                    3 => [remaining[0], remaining[1], remaining[2]],
                    _ => unreachable!(),
                };
                return Ok(Some((output, buffered, u8::try_from(remaining.len()).unwrap())));
            }
        }

        if FAIL_IF_INVALID {
            if converted.fail {
                debug_assert!(converted.code_point == unicode_replacement);
                return Err(ToUTF16Error::InvalidByteSequence);
            }
        }

        remaining = &remaining[(converted.len as usize).max(1)..];

        // #define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
        match converted.code_point {
            c @ 0..=0xffff => output.push(u16::try_from(c).unwrap()), // PERF(port): was assume_capacity
            c => output.extend_from_slice(&[u16_lead(c), u16_trail(c)]), // PERF(port): was assume_capacity
        }

        non_ascii = first_non_ascii(remaining);
    }

    if !remaining.is_empty() {
        let need = output.len() + remaining.len();
        output.reserve_exact(need.saturating_sub(output.len()));
        let old = output.len();
        // SAFETY: capacity reserved; bytes written immediately below.
        unsafe { output.set_len(old + remaining.len()) };
        copy_u8_into_u16(&mut output[old..], remaining);
    }

    bun_output::scoped_log!(strings, "toUTF16 {} UTF8 -> {} UTF16", bytes.len(), output.len());
    Ok(Some((output, [0; 3], 0)))
}

pub fn utf16_codepoint_with_fffd(input: &[u16]) -> UTF16Replacement {
    utf16_codepoint_with_fffd_and_first_input_char(input[0], input)
}

fn utf16_codepoint_with_fffd_and_first_input_char(char: u16, input: &[u16]) -> UTF16Replacement {
    let c0 = char as u32;

    if c0 & !0x03ff == 0xd800 {
        // surrogate pair
        if input.len() == 1 {
            return UTF16Replacement { len: 1, is_lead: true, ..Default::default() };
        }
        //error.DanglingSurrogateHalf;
        let c1 = input[1] as u32;
        if c1 & !0x03ff != 0xdc00 {
            if input.len() == 1 {
                return UTF16Replacement { len: 1, ..Default::default() };
            } else {
                return UTF16Replacement {
                    fail: true,
                    len: 1,
                    code_point: unicode_replacement,
                    is_lead: true,
                    ..Default::default()
                };
            }
        }
        // return error.ExpectedSecondSurrogateHalf;

        UTF16Replacement {
            len: 2,
            code_point: 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)),
            ..Default::default()
        }
    } else if c0 & !0x03ff == 0xdc00 {
        // return error.UnexpectedSecondSurrogateHalf;
        UTF16Replacement { fail: true, len: 1, code_point: unicode_replacement, ..Default::default() }
    } else {
        UTF16Replacement { code_point: c0, len: 1, ..Default::default() }
    }
}

pub fn utf16_codepoint(input: &[u16]) -> UTF16Replacement {
    let c0 = input[0] as u32;

    if c0 & !0x03ff == 0xd800 {
        // surrogate pair
        if input.len() == 1 {
            return UTF16Replacement { len: 1, ..Default::default() };
        }
        //error.DanglingSurrogateHalf;
        let c1 = input[1] as u32;
        if c1 & !0x03ff != 0xdc00 {
            if input.len() == 1 {
                return UTF16Replacement { len: 1, ..Default::default() };
            }
        }
        // return error.ExpectedSecondSurrogateHalf;

        UTF16Replacement {
            len: 2,
            code_point: 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)),
            ..Default::default()
        }
    } else if c0 & !0x03ff == 0xdc00 {
        // return error.UnexpectedSecondSurrogateHalf;
        UTF16Replacement { len: 1, ..Default::default() }
    } else {
        UTF16Replacement { code_point: c0, len: 1, ..Default::default() }
    }
}

// TODO: remove this
pub use to_utf16_literal as w;

/// Zig: `pub fn toUTF16Literal(comptime str) [:0]const u16` → use `bun_str::w!("...")` macro.
#[macro_export]
macro_rules! to_utf16_literal {
    ($s:literal) => {
        bun_str::w!($s)
    };
}
pub use to_utf16_literal;

/// Zig: `pub fn literal(comptime T, comptime str) *const [N:0]T`.
/// In Rust: `b"..."` for u8, `bun_str::w!("...")` for u16. No runtime fn possible.
// TODO(port): callers should use byte/wide literals directly; this is a stub for diff parity.
#[macro_export]
macro_rules! literal {
    (u8, $s:literal) => { concat!($s, "\0").as_bytes() };
    (u16, $s:literal) => { bun_str::w!($s) };
}
pub use literal;

// `literalLength` is comptime-only and folded into the macros above.

// Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>
// See http://bjoern.hoehrmann.de/utf-8/decoder/dfa/ for details.
pub fn is_valid_utf8_without_simd(slice: &[u8]) -> bool {
    let mut state: u8 = 0;

    for &byte in slice {
        state = decode_check(state, byte);
    }
    state == UTF8_ACCEPT
}

pub fn is_valid_utf8(slice: &[u8]) -> bool {
    if bun_core::FeatureFlags::USE_SIMDUTF {
        return simdutf::validate::utf8(slice);
    }

    is_valid_utf8_without_simd(slice)
}

pub fn is_all_ascii(slice: &[u8]) -> bool {
    // PORT NOTE: Zig's `@inComptime()` branch dropped — Rust const-eval can't call simdutf anyway,
    // and runtime callers always go through simdutf.
    simdutf::validate::ascii(slice)
}

const UTF8_ACCEPT: u8 = 0;
const UTF8_REJECT: u8 = 12;

#[rustfmt::skip]
static UTF8D: [u8; 364] = [
    // The first part of the table maps bytes to character classes that
    // to reduce the size of the transition table and create bitmasks.
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,
    7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,
    8,  8,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,
    10, 3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  4,  3,  3,  11, 6,  6,  6,  5,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,

    // The second part is a transition table that maps a combination
    // of a state of the automaton and a character class to a state.
    0,  12, 24, 36, 60, 96, 84, 12, 12, 12, 48, 72, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 0,  12, 12, 12, 12, 12, 0,
    12, 0,  12, 12, 12, 24, 12, 12, 12, 12, 12, 24, 12, 24, 12, 12, 12, 12, 12, 12, 12, 12, 12, 24, 12, 12, 12, 12, 12, 24, 12, 12,
    12, 12, 12, 12, 12, 24, 12, 12, 12, 12, 12, 12, 12, 12, 12, 36, 12, 36, 12, 12, 12, 36, 12, 12, 12, 12, 12, 36, 12, 36, 12, 12,
    12, 36, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
];

pub fn decode_check(state: u8, byte: u8) -> u8 {
    let char_type: u32 = UTF8D[byte as usize] as u32;
    // we dont care about the codep
    // codep = if (*state != UTF8_ACCEPT) (byte & 0x3f) | (*codep << 6) else (0xff >> char_type) & (byte);

    let value = 256u32 + state as u32 + char_type;
    if value as usize >= UTF8D.len() {
        return UTF8_REJECT;
    }
    UTF8D[value as usize]
}

// #define U16_LEAD(supplementary) (UChar)(((supplementary)>>10)+0xd7c0)
#[inline]
pub fn u16_lead(supplementary: u32) -> u16 {
    u16::try_from((supplementary >> 10) + 0xd7c0).unwrap()
}

// #define U16_TRAIL(supplementary) (UChar)(((supplementary)&0x3ff)|0xdc00)
#[inline]
pub fn u16_trail(supplementary: u32) -> u16 {
    u16::try_from((supplementary & 0x3ff) | 0xdc00).unwrap()
}

// #define U16_IS_TRAIL(c) (((c)&0xfffffc00)==0xdc00)
#[inline]
pub fn u16_is_trail(supplementary: u16) -> bool {
    (supplementary as u32 & 0xfffffc00) == 0xdc00
}

// #define U16_IS_LEAD(c) (((c)&0xfffffc00)==0xd800)
#[inline]
pub fn u16_is_lead(supplementary: u16) -> bool {
    (supplementary as u32 & 0xfffffc00) == 0xd800
}

// #define U16_GET_SUPPLEMENTARY(lead, trail) \
//     (((UChar32)(lead)<<10UL)+(UChar32)(trail)-U16_SURROGATE_OFFSET)
#[inline]
pub fn u16_get_supplementary(lead: u32, trail: u32) -> u32 {
    let shifted = lead << 10;
    (shifted + trail) - U16_SURROGATE_OFFSET
}

// #define U16_SURROGATE_OFFSET ((0xd800<<10UL)+0xdc00-0x10000)
pub const U16_SURROGATE_OFFSET: u32 = 56613888;

#[inline]
pub fn utf8_byte_sequence_length(first_byte: u8) -> U3Fast {
    match first_byte {
        0b0000_0000..=0b0111_1111 => 1,
        0b1100_0000..=0b1101_1111 => 2,
        0b1110_0000..=0b1110_1111 => 3,
        0b1111_0000..=0b1111_0111 => 4,
        _ => 0,
    }
}

/// Same as `utf8_byte_sequence_length`, but assumes the byte is valid UTF-8.
///
/// You should only use this function if you know the string you are getting the byte from is valid UTF-8.
#[inline]
pub fn utf8_byte_sequence_length_unsafe(first_byte: u8) -> U3Fast {
    match first_byte {
        0b0000_0000..=0b0111_1111 => 1,
        0b1100_0000..=0b1101_1111 => 2,
        0b1110_0000..=0b1110_1111 => 3,
        0b1111_0000..=0b1111_0111 => 4,
        _ => unreachable!(),
    }
}

/// This will simply ignore invalid UTF-8 and just do it
pub fn convert_utf8_to_utf16_in_buffer<'a>(buf: &'a mut [u16], input: &[u8]) -> &'a mut [u16] {
    // TODO(@paperclover): implement error handling here.
    // for now this will cause invalid utf-8 to be ignored and become empty.
    // this is lame because of https://github.com/oven-sh/bun/issues/8197
    // it will cause process.env.whatever to be len=0 instead of the data
    // but it's better than failing the run entirely
    //
    // the reason i didn't implement the fallback is purely because our
    // code in this file is too chaotic. it is left as a TODO
    if input.is_empty() {
        return &mut buf[..0];
    }
    let result = simdutf::convert::utf8::to::utf16::le(input, buf);
    &mut buf[..result]
}

pub fn convert_utf8_to_utf16_in_buffer_z<'a>(buf: &'a mut [u16], input: &[u8]) -> &'a mut WStr {
    // TODO: see convert_utf8_to_utf16_in_buffer
    if input.is_empty() {
        buf[0] = 0;
        // SAFETY: buf[0] == 0 written above.
        return unsafe { WStr::from_raw_mut(buf.as_mut_ptr(), 0) };
    }
    let result = simdutf::convert::utf8::to::utf16::le(input, buf);
    buf[result] = 0;
    // SAFETY: buf[result] == 0 written above.
    unsafe { WStr::from_raw_mut(buf.as_mut_ptr(), result) }
}

pub fn convert_utf16_to_utf8_in_buffer<'a>(
    buf: &'a mut [u8],
    input: &[u16],
) -> Result<&'a [u8], bun_core::Error> {
    // See above
    if input.is_empty() {
        return Ok(&[]);
    }
    let result = simdutf::convert::utf16::to::utf8::le(input, buf);
    // switch (result.status) {
    //     .success => return buf[0..result.count],
    //     // TODO(@paperclover): handle surrogate
    //     .surrogate => @panic("TODO: handle surrogate in convertUTF8toUTF16"),
    //     else => @panic("TODO: handle error in convertUTF16toUTF8InBuffer"),
    // }
    Ok(&buf[..result])
}

pub fn cp1252_to_codepoint_assume_not_ascii<C: From<u16>>(char: u8) -> C {
    C::from(cp1252_to_codepoint_bytes_assume_not_ascii16(char as u32))
}

#[rustfmt::skip]
static CP1252_TO_UTF16_CONVERSION_TABLE: [u16; 256] = [
    0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, // 00-07
    0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, // 08-0F
    0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017, // 10-17
    0x0018, 0x0019, 0x001A, 0x001B, 0x001C, 0x001D, 0x001E, 0x001F, // 18-1F
    0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, // 20-27
    0x0028, 0x0029, 0x002A, 0x002B, 0x002C, 0x002D, 0x002E, 0x002F, // 28-2F
    0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, // 30-37
    0x0038, 0x0039, 0x003A, 0x003B, 0x003C, 0x003D, 0x003E, 0x003F, // 38-3F
    0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, // 40-47
    0x0048, 0x0049, 0x004A, 0x004B, 0x004C, 0x004D, 0x004E, 0x004F, // 48-4F
    0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, // 50-57
    0x0058, 0x0059, 0x005A, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, // 58-5F
    0x0060, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0066, 0x0067, // 60-67
    0x0068, 0x0069, 0x006A, 0x006B, 0x006C, 0x006D, 0x006E, 0x006F, // 68-6F
    0x0070, 0x0071, 0x0072, 0x0073, 0x0074, 0x0075, 0x0076, 0x0077, // 70-77
    0x0078, 0x0079, 0x007A, 0x007B, 0x007C, 0x007D, 0x007E, 0x007F, // 78-7F
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 80-87
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F, // 88-8F
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 90-97
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178, // 98-9F
    0x00A0, 0x00A1, 0x00A2, 0x00A3, 0x00A4, 0x00A5, 0x00A6, 0x00A7, // A0-A7
    0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF, // A8-AF
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, // B0-B7
    0x00B8, 0x00B9, 0x00BA, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00BF, // B8-BF
    0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7, // C0-C7
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, // C8-CF
    0x00D0, 0x00D1, 0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D6, 0x00D7, // D0-D7
    0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF, // D8-DF
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, // E0-E7
    0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF, // E8-EF
    0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7, // F0-F7
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF, // F8-FF
];

pub fn latin1_to_codepoint_bytes_assume_not_ascii(char: u32) -> [u8; 2] {
    let mut bytes = [0u8; 4];
    let _ = encode_wtf8_rune(&mut bytes, i32::try_from(char).unwrap());
    [bytes[0], bytes[1]]
}

pub fn cp1252_to_codepoint_bytes_assume_not_ascii16(char: u32) -> u16 {
    CP1252_TO_UTF16_CONVERSION_TABLE[(char as u8) as usize]
}

/// Copy a UTF-16 string as UTF-8 into `buf`
///
/// This may not encode everything if `buf` is not big enough.
pub fn copy_utf16_into_utf8(buf: &mut [u8], utf16: &[u16]) -> EncodeIntoResult {
    copy_utf16_into_utf8_impl::<false>(buf, utf16)
}

/// See comment on `copy_utf16_into_utf8_with_buffer_impl` on what `allow_truncated_utf8_sequence` should do
pub fn copy_utf16_into_utf8_impl<const ALLOW_TRUNCATED_UTF8_SEQUENCE: bool>(
    buf: &mut [u8],
    utf16: &[u16],
) -> EncodeIntoResult {
    if bun_core::FeatureFlags::USE_SIMDUTF {
        if utf16.is_empty() {
            return EncodeIntoResult { read: 0, written: 0 };
        }
        let trimmed = simdutf::trim::utf16(utf16);
        if trimmed.is_empty() {
            return EncodeIntoResult { read: 0, written: 0 };
        }

        let out_len = if buf.len() <= (trimmed.len() * 3 + 2) {
            simdutf::length::utf8::from::utf16_le(trimmed)
        } else {
            buf.len()
        };

        return copy_utf16_into_utf8_with_buffer_impl::<ALLOW_TRUNCATED_UTF8_SEQUENCE>(buf, utf16, out_len);
    }

    copy_utf16_into_utf8_with_buffer_impl::<ALLOW_TRUNCATED_UTF8_SEQUENCE>(buf, utf16, utf16.len())
}

/// Q: What does the `allow_truncated_utf8_sequence` parameter do?
/// A: If the output buffer can't fit everything, this function will write
///    incomplete utf-8 byte sequences if `allow_truncated_utf8_sequence` is
///    enabled.
///
/// Q: Doesn't that mean this function would output invalid utf-8? Why would you
///    ever want to do that?
/// A: Yes. This is needed for writing a UTF-16 string to a node Buffer that
///    doesn't have enough space for all the bytes:
///
/// ```js
/// let buffer = Buffer.allocUnsafe(1);
/// buffer.fill("Ȣ");
/// expect(buffer[0]).toBe(0xc8);
/// ```
pub fn copy_utf16_into_utf8_with_buffer_impl<const ALLOW_TRUNCATED_UTF8_SEQUENCE: bool>(
    buf: &mut [u8],
    utf16: &[u16],
    out_len: usize,
) -> EncodeIntoResult {
    let buf_total = buf.len();
    let mut remaining: &mut [u8] = buf;
    let mut utf16_remaining = utf16;
    let mut ended_on_non_ascii = false;

    'brk: {
        if bun_core::FeatureFlags::USE_SIMDUTF {
            bun_output::scoped_log!(strings, "UTF16 {} -> UTF8 {}", utf16.len(), out_len);
            if remaining.len() >= out_len {
                let result = simdutf::convert::utf16::to::utf8::with_errors_le(utf16, remaining);
                if result.status == simdutf::Status::Surrogate {
                    break 'brk;
                }

                return EncodeIntoResult {
                    read: utf16.len() as u32,
                    written: result.count as u32,
                };
            }
        }
    }

    while let Some(i) = first_non_ascii16(utf16_remaining) {
        let i = i as usize;
        let end = i.min(remaining.len());
        if end > 0 {
            copy_u16_into_u8(remaining, &utf16_remaining[..end]);
        }
        remaining = &mut remaining[end..];
        utf16_remaining = &utf16_remaining[end..];

        if utf16_remaining.len().min(remaining.len()) == 0 {
            break;
        }

        let replacement = utf16_codepoint_with_fffd(utf16_remaining);

        let width: usize = replacement.utf8_width() as usize;
        debug_assert!(width > 1);
        if width > remaining.len() {
            ended_on_non_ascii = width > 1;
            if ALLOW_TRUNCATED_UTF8_SEQUENCE {
                match width {
                    2 => {
                        if !remaining.is_empty() {
                            //only first will be written
                            remaining[0] = (0xC0 | (replacement.code_point >> 6)) as u8;
                            let rl = remaining.len();
                            remaining = &mut remaining[rl..];
                        }
                    }
                    3 => {
                        //only first to second written
                        match remaining.len() {
                            1 => {
                                remaining[0] = (0xE0 | (replacement.code_point >> 12)) as u8;
                                let rl = remaining.len();
                                remaining = &mut remaining[rl..];
                            }
                            2 => {
                                remaining[0] = (0xE0 | (replacement.code_point >> 12)) as u8;
                                remaining[1] = (0x80 | (replacement.code_point >> 6) & 0x3F) as u8;
                                let rl = remaining.len();
                                remaining = &mut remaining[rl..];
                            }
                            _ => {}
                        }
                    }
                    4 => {
                        //only 1 to 3 written
                        match remaining.len() {
                            1 => {
                                remaining[0] = (0xF0 | (replacement.code_point >> 18)) as u8;
                                let rl = remaining.len();
                                remaining = &mut remaining[rl..];
                            }
                            2 => {
                                remaining[0] = (0xF0 | (replacement.code_point >> 18)) as u8;
                                remaining[1] = (0x80 | (replacement.code_point >> 12) & 0x3F) as u8;
                                let rl = remaining.len();
                                remaining = &mut remaining[rl..];
                            }
                            3 => {
                                remaining[0] = (0xF0 | (replacement.code_point >> 18)) as u8;
                                remaining[1] = (0x80 | (replacement.code_point >> 12) & 0x3F) as u8;
                                remaining[2] = (0x80 | (replacement.code_point >> 6) & 0x3F) as u8;
                                let rl = remaining.len();
                                remaining = &mut remaining[rl..];
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
            break;
        }

        utf16_remaining = &utf16_remaining[replacement.len as usize..];
        // SAFETY: width <= remaining.len() and we need a *[4]u8 view; encodeWTF8RuneT writes at most `width` bytes.
        let four: &mut [u8; 4] = unsafe { &mut *(remaining.as_mut_ptr() as *mut [u8; 4]) };
        let _ = encode_wtf8_rune_t::<u32>(four, replacement.code_point);
        remaining = &mut remaining[width..];
    }

    if !remaining.is_empty() && !ended_on_non_ascii && !utf16_remaining.is_empty() {
        let len = remaining.len().min(utf16_remaining.len());
        copy_u16_into_u8(&mut remaining[..len], &utf16_remaining[..len]);
        utf16_remaining = &utf16_remaining[len..];
        remaining = &mut remaining[len..];
    }

    EncodeIntoResult {
        read: (utf16.len() - utf16_remaining.len()) as u32,
        written: (buf_total - remaining.len()) as u32,
    }
}

pub fn element_length_utf16_into_utf8(utf16: &[u16]) -> usize {
    if bun_core::FeatureFlags::USE_SIMDUTF {
        return simdutf::length::utf8::from::utf16_le(utf16);
    }

    let mut utf16_remaining = utf16;
    let mut count: usize = 0;

    while let Some(i) = first_non_ascii16(utf16_remaining) {
        let i = i as usize;
        count += i;

        utf16_remaining = &utf16_remaining[i..];

        let replacement = utf16_codepoint(utf16_remaining);

        count += replacement.utf8_width() as usize;
        utf16_remaining = &utf16_remaining[replacement.len as usize..];
    }

    count + utf16_remaining.len()
}

pub fn element_length_utf8_into_utf16(utf8: &[u8]) -> usize {
    let mut utf8_remaining = utf8;
    let mut count: usize = 0;

    if bun_core::FeatureFlags::USE_SIMDUTF {
        return simdutf::length::utf16::from::utf8(utf8);
    }

    while let Some(i) = first_non_ascii(utf8_remaining) {
        let i = i as usize;
        count += i;

        utf8_remaining = &utf8_remaining[i..];

        // PORT NOTE: Zig calls `utf16Codepoint` (which takes []const u16) on a []const u8 here —
        // preserved as a TODO; this branch is dead when use_simdutf is true.
        // TODO(port): dead non-simdutf path passes wrong slice type in Zig source
        // SAFETY: dead path (use_simdutf always true); preserved verbatim from Zig which passes wrong slice type
        let replacement = utf16_codepoint(unsafe {
            core::slice::from_raw_parts(utf8_remaining.as_ptr() as *const u16, utf8_remaining.len() / 2)
        });

        count += replacement.len as usize;
        utf8_remaining = &utf8_remaining[(replacement.utf8_width() as usize).min(utf8_remaining.len())..];
    }

    count + utf8_remaining.len()
}

// Check utf16 string equals utf8 string without allocating extra memory
pub fn utf16_eql_string(text: &[u16], str: &[u8]) -> bool {
    if text.len() > str.len() {
        // Strings can't be equal if UTF-16 encoding is longer than UTF-8 encoding
        return false;
    }

    let mut temp = [0u8; 4];
    let n = text.len();
    let mut j: usize = 0;
    let mut i: usize = 0;
    // TODO: is it safe to just make this u32 or u21?
    let mut r1: i32;
    while i < n {
        r1 = text[i] as i32;
        if r1 >= 0xD800 && r1 <= 0xDBFF && i + 1 < n {
            let r2: i32 = text[i + 1] as i32;
            if r2 >= 0xDC00 && r2 <= 0xDFFF {
                r1 = (r1 - 0xD800) << 10 | (r2 - 0xDC00) + 0x10000;
                i += 1;
            }
        }

        let width = encode_wtf8_rune(&mut temp, r1) as usize;
        if j + width > str.len() {
            return false;
        }
        for k in 0..width {
            if temp[k] != str[j] {
                return false;
            }
            j += 1;
        }
        i += 1;
    }

    j == str.len()
}

pub const fn encode_utf8_comptime<const CP: u32>() -> &'static [u8] {
    const HEADER_CONT_BYTE: u8 = 0b10000000;
    const HEADER_2BYTE: u8 = 0b11000000;
    const HEADER_3BYTE: u8 = 0b11100000;
    const HEADER_4BYTE: u8 = 0b11100000;

    // TODO(port): Zig returned distinct-length slices from comptime; in Rust we leak via const arrays.
    match CP {
        0x0..=0x7F => &[CP as u8],
        0x80..=0x7FF => &[
            HEADER_2BYTE | (CP >> 6) as u8,
            HEADER_CONT_BYTE | (CP & 0b00111111) as u8,
        ],
        0x800..=0xFFFF => &[
            HEADER_3BYTE | (CP >> 12) as u8,
            HEADER_CONT_BYTE | ((CP >> 6) & 0b00111111) as u8,
            HEADER_CONT_BYTE | (CP & 0b00111111) as u8,
        ],
        0x10000..=0x10FFFF => &[
            HEADER_4BYTE | (CP >> 18) as u8,
            HEADER_CONT_BYTE | ((CP >> 12) & 0b00111111) as u8,
            HEADER_CONT_BYTE | ((CP >> 6) & 0b00111111) as u8,
            HEADER_CONT_BYTE | (CP & 0b00111111) as u8,
        ],
        _ => panic!("Invalid UTF-8 codepoint!"),
    }
}

// This is a clone of golang's "utf8.EncodeRune" that has been modified to encode using
// WTF-8 instead. See https://simonsapin.github.io/wtf-8/ for more info.
pub fn encode_wtf8_rune(p: &mut [u8; 4], r: i32) -> U3Fast {
    encode_wtf8_rune_t::<u32>(p, u32::try_from(r).unwrap())
}

pub fn encode_wtf8_rune_t<R: Into<u32> + Copy>(p: &mut [u8; 4], r: R) -> U3Fast {
    let r: u32 = r.into();
    match r {
        0..=0x7F => {
            p[0] = u8::try_from(r).unwrap();
            1
        }
        0x80..=0x7FF => {
            p[0] = (0xC0 | (r >> 6)) as u8;
            p[1] = (0x80 | (r & 0x3F)) as u8;
            2
        }
        0x800..=0xFFFF => {
            p[0] = (0xE0 | (r >> 12)) as u8;
            p[1] = (0x80 | ((r >> 6) & 0x3F)) as u8;
            p[2] = (0x80 | (r & 0x3F)) as u8;
            3
        }
        _ => {
            p[0] = (0xF0 | (r >> 18)) as u8;
            p[1] = (0x80 | ((r >> 12) & 0x3F)) as u8;
            p[2] = (0x80 | ((r >> 6) & 0x3F)) as u8;
            p[3] = (0x80 | (r & 0x3F)) as u8;
            4
        }
    }
}

pub fn wtf8_sequence(code_point: u32) -> [u8; 4] {
    match code_point {
        0..=0x7f => [u8::try_from(code_point).unwrap(), 0, 0, 0],
        0x80..=0x7ff => [
            (0xc0 | (code_point >> 6)) as u8,
            (0x80 | (code_point & 0x3f)) as u8,
            0,
            0,
        ],
        0x800..=0xffff => [
            (0xe0 | (code_point >> 12)) as u8,
            (0x80 | ((code_point >> 6) & 0x3f)) as u8,
            (0x80 | (code_point & 0x3f)) as u8,
            0,
        ],
        _ => [
            (0xf0 | (code_point >> 18)) as u8,
            (0x80 | ((code_point >> 12) & 0x3f)) as u8,
            (0x80 | ((code_point >> 6) & 0x3f)) as u8,
            (0x80 | (code_point & 0x3f)) as u8,
        ],
    }
}

#[inline]
pub fn wtf8_byte_sequence_length(first_byte: u8) -> u8 {
    match first_byte {
        0..=0x7f => 1,
        _ => {
            if (first_byte & 0xE0) == 0xC0 {
                2
            } else if (first_byte & 0xF0) == 0xE0 {
                3
            } else if (first_byte & 0xF8) == 0xF0 {
                4
            } else {
                1
            }
        }
    }
}

/// 0 == invalid
#[inline]
pub fn wtf8_byte_sequence_length_with_invalid(first_byte: u8) -> u8 {
    match first_byte {
        0..=0x7f => 1,
        _ => {
            if (first_byte & 0xE0) == 0xC0 {
                2
            } else if (first_byte & 0xF0) == 0xE0 {
                3
            } else if (first_byte & 0xF8) == 0xF0 {
                4
            } else {
                1
            }
        }
    }
}

/// Convert potentially ill-formed UTF-8 or UTF-16 bytes to a Unicode Codepoint.
/// Invalid codepoints are replaced with `zero` parameter
/// This is a clone of esbuild's decodeWTF8Rune
/// which was a clone of golang's "utf8.DecodeRune" that was modified to decode using WTF-8 instead.
/// Asserts a multi-byte codepoint
#[inline]
pub fn decode_wtf8_rune_t_multibyte<T>(p: &[u8; 4], len: U3Fast, zero: T) -> T
where
    T: Copy + PartialOrd + From<u8> + core::ops::Shl<u32, Output = T> + core::ops::BitOr<Output = T> + core::ops::BitAnd<Output = T>,
{
    // TODO(port): trait bounds above are an approximation of "integer-ish T"; Phase B can specialize
    // to i32/u32 with a small sealed trait instead.
    debug_assert!(len > 1);

    let s1 = p[1];
    if (s1 & 0xC0) != 0x80 {
        return zero;
    }

    if len == 2 {
        let cp = (T::from(p[0] & 0x1F) << 6) | T::from(s1 & 0x3F);
        if cp < T::from(0x80u8) {
            return zero;
        }
        return cp;
    }

    let s2 = p[2];

    if (s2 & 0xC0) != 0x80 {
        return zero;
    }

    if len == 3 {
        let cp = (T::from(p[0] & 0x0F) << 12) | (T::from(s1 & 0x3F) << 6) | T::from(s2 & 0x3F);
        // 0x800 doesn't fit in u8; compare via FromU32 helper.
        if cp < T::from_u32_const(0x800) {
            return zero;
        }
        return cp;
    }

    let s3 = p[3];

    if (s3 & 0xC0) != 0x80 {
        return zero;
    }

    {
        let cp = (T::from(p[0] & 0x07) << 18)
            | (T::from(s1 & 0x3F) << 12)
            | (T::from(s2 & 0x3F) << 6)
            | T::from(s3 & 0x3F);
        if cp < T::from_u32_const(0x10000) || cp > T::from_u32_const(0x10FFFF) {
            return zero;
        }
        return cp;
    }
}

// TODO(port): helper for `decode_wtf8_rune_t_multibyte` integer-literal comparisons.
trait FromU32Const {
    fn from_u32_const(v: u32) -> Self;
}
impl FromU32Const for i32 {
    #[inline]
    fn from_u32_const(v: u32) -> Self { v as i32 }
}
impl FromU32Const for u32 {
    #[inline]
    fn from_u32_const(v: u32) -> Self { v }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable/unicode.zig (2042 lines)
//   confidence: medium
//   todos:      14
//   notes:      SIMD @Vector paths replaced with SWAR fallback (PERF-tagged); generic CodePointType modeled via CodePointZero/FromU32 traits; simdutf allocatedSlice() vs spare_capacity semantics need Phase B review; SENTINEL u16 returns Vec<u16> not WStr.
// ──────────────────────────────────────────────────────────────────────────


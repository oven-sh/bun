use bun_alloc::AllocError;

use crate::strings::{
    self, utf16_codepoint, AsciiU16Vector, AsciiVector, ASCII_U16_VECTOR_SIZE, ASCII_VECTOR_SIZE,
};
use crate::w;

// TODO(port): Environment.enableSIMD — Zig gates SIMD paths behind a comptime
// build flag. Mirror with a cargo feature or a `const ENABLE_SIMD: bool` in
// `crate::strings`. For now reference it as a const so Phase B can wire it.
use crate::strings::ENABLE_SIMD;

// ──────────────────────────────────────────────────────────────────────────
// Escaped<T>
// ──────────────────────────────────────────────────────────────────────────

/// Result of HTML-escaping. `Static` is always Latin-1/ASCII bytes (the
/// entity literals) regardless of `T`; `Allocated` matches the input encoding.
pub enum Escaped<T> {
    Static(&'static [u8]),
    Original,
    Allocated(Box<[T]>),
}

// ──────────────────────────────────────────────────────────────────────────
// Scalar lookup table (shared by both Latin-1 and UTF-16 paths)
// ──────────────────────────────────────────────────────────────────────────

// Zig used `u4`; Rust has no `u4`, so widen to `u8`. Values are all ≤ 6.
const SCALAR_LENGTHS: [u8; 256] = {
    let mut values = [1u8; 256];
    values[b'"' as usize] = b"&quot;".len() as u8;
    values[b'&' as usize] = b"&amp;".len() as u8;
    values[b'\'' as usize] = b"&#x27;".len() as u8;
    values[b'<' as usize] = b"&lt;".len() as u8;
    values[b'>' as usize] = b"&gt;".len() as u8;
    values
};

#[inline(always)]
fn scalar_append_string(buf: *mut u8, s: &'static [u8]) -> usize {
    // SAFETY: caller guarantees `buf` has at least `s.len()` bytes writable.
    unsafe { core::ptr::copy_nonoverlapping(s.as_ptr(), buf, s.len()) };
    s.len()
}

#[inline(always)]
fn scalar_append(buf: *mut u8, ch: u8) -> usize {
    if SCALAR_LENGTHS[ch as usize] == 1 {
        // SAFETY: caller guarantees at least 1 byte writable.
        unsafe { *buf = ch };
        return 1;
    }

    match ch {
        b'"' => scalar_append_string(buf, b"&quot;"),
        b'&' => scalar_append_string(buf, b"&amp;"),
        b'\'' => scalar_append_string(buf, b"&#x27;"),
        b'<' => scalar_append_string(buf, b"&lt;"),
        b'>' => scalar_append_string(buf, b"&gt;"),
        _ => unreachable!(),
    }
}

#[inline(always)]
fn scalar_push<const LEN: usize>(chars: &[u8; LEN]) -> Escaped<u8> {
    // PERF(port): Zig used `inline while` to fully unroll this sum at comptime
    // for each LEN in 3..=32 — profile in Phase B.
    let mut total: usize = 0;
    let mut i = 0;
    while i < LEN {
        total += SCALAR_LENGTHS[chars[i] as usize] as usize;
        i += 1;
    }

    if total == LEN {
        return Escaped::Original;
    }

    let mut output = vec![0u8; total].into_boxed_slice();
    let mut head = output.as_mut_ptr();
    // PERF(port): Zig used `inline for (comptime bun.range(0, len))` — profile in Phase B.
    for i in 0..LEN {
        // SAFETY: `total` was computed from SCALAR_LENGTHS so `head` never
        // overruns `output`.
        head = unsafe { head.add(scalar_append(head, chars[i])) };
    }

    Escaped::Allocated(output)
}

// ──────────────────────────────────────────────────────────────────────────
// escapeHTMLForLatin1Input
// ──────────────────────────────────────────────────────────────────────────

pub fn escape_html_for_latin1_input(latin1: &[u8]) -> Result<Escaped<u8>, AllocError> {
    match latin1.len() {
        0 => return Ok(Escaped::Static(b"")),
        1 => {
            return Ok(match latin1[0] {
                b'"' => Escaped::Static(b"&quot;"),
                b'&' => Escaped::Static(b"&amp;"),
                b'\'' => Escaped::Static(b"&#x27;"),
                b'<' => Escaped::Static(b"&lt;"),
                b'>' => Escaped::Static(b"&gt;"),
                _ => Escaped::Original,
            });
        }
        2 => {
            let first: &[u8] = match latin1[0] {
                b'"' => b"&quot;",
                b'&' => b"&amp;",
                b'\'' => b"&#x27;",
                b'<' => b"&lt;",
                b'>' => b"&gt;",
                _ => &latin1[0..1],
            };
            let second: &[u8] = match latin1[1] {
                b'"' => b"&quot;",
                b'&' => b"&amp;",
                b'\'' => b"&#x27;",
                b'<' => b"&lt;",
                b'>' => b"&gt;",
                _ => &latin1[1..2],
            };
            if first.len() == 1 && second.len() == 1 {
                return Ok(Escaped::Original);
            }

            return Ok(Escaped::Allocated(strings::append(first, second)));
        }

        // The simd implementation is slower for inputs less than 32 bytes.
        3 => return Ok(scalar_push::<3>(latin1[0..3].try_into().unwrap())),
        4 => return Ok(scalar_push::<4>(latin1[0..4].try_into().unwrap())),
        5 => return Ok(scalar_push::<5>(latin1[0..5].try_into().unwrap())),
        6 => return Ok(scalar_push::<6>(latin1[0..6].try_into().unwrap())),
        7 => return Ok(scalar_push::<7>(latin1[0..7].try_into().unwrap())),
        8 => return Ok(scalar_push::<8>(latin1[0..8].try_into().unwrap())),
        9 => return Ok(scalar_push::<9>(latin1[0..9].try_into().unwrap())),
        10 => return Ok(scalar_push::<10>(latin1[0..10].try_into().unwrap())),
        11 => return Ok(scalar_push::<11>(latin1[0..11].try_into().unwrap())),
        12 => return Ok(scalar_push::<12>(latin1[0..12].try_into().unwrap())),
        13 => return Ok(scalar_push::<13>(latin1[0..13].try_into().unwrap())),
        14 => return Ok(scalar_push::<14>(latin1[0..14].try_into().unwrap())),
        15 => return Ok(scalar_push::<15>(latin1[0..15].try_into().unwrap())),
        16 => return Ok(scalar_push::<16>(latin1[0..16].try_into().unwrap())),
        17 => return Ok(scalar_push::<17>(latin1[0..17].try_into().unwrap())),
        18 => return Ok(scalar_push::<18>(latin1[0..18].try_into().unwrap())),
        19 => return Ok(scalar_push::<19>(latin1[0..19].try_into().unwrap())),
        20 => return Ok(scalar_push::<20>(latin1[0..20].try_into().unwrap())),
        21 => return Ok(scalar_push::<21>(latin1[0..21].try_into().unwrap())),
        22 => return Ok(scalar_push::<22>(latin1[0..22].try_into().unwrap())),
        23 => return Ok(scalar_push::<23>(latin1[0..23].try_into().unwrap())),
        24 => return Ok(scalar_push::<24>(latin1[0..24].try_into().unwrap())),
        25 => return Ok(scalar_push::<25>(latin1[0..25].try_into().unwrap())),
        26 => return Ok(scalar_push::<26>(latin1[0..26].try_into().unwrap())),
        27 => return Ok(scalar_push::<27>(latin1[0..27].try_into().unwrap())),
        28 => return Ok(scalar_push::<28>(latin1[0..28].try_into().unwrap())),
        29 => return Ok(scalar_push::<29>(latin1[0..29].try_into().unwrap())),
        30 => return Ok(scalar_push::<30>(latin1[0..30].try_into().unwrap())),
        31 => return Ok(scalar_push::<31>(latin1[0..31].try_into().unwrap())),
        32 => return Ok(scalar_push::<32>(latin1[0..32].try_into().unwrap())),

        _ => {
            let mut remaining = latin1;

            const VEC_CHARS: &[u8; 5] = b"\"&'<>";
            // TODO(port): `core::simd` (portable_simd) is nightly-only. Phase B:
            // either gate behind `#![feature(portable_simd)]` or route through
            // `bun_highway`. The Zig builds `[5]@Vector(N, u8)` via `@splat`.
            let vecs: [AsciiVector; 5] = [
                AsciiVector::splat(VEC_CHARS[0]),
                AsciiVector::splat(VEC_CHARS[1]),
                AsciiVector::splat(VEC_CHARS[2]),
                AsciiVector::splat(VEC_CHARS[3]),
                AsciiVector::splat(VEC_CHARS[4]),
            ];

            let mut any_needs_escape = false;
            let mut buf: Vec<u8> = Vec::new();

            if ENABLE_SIMD {
                // pass #1: scan for any characters that need escaping
                // assume most strings won't need any escaping, so don't actually allocate the buffer
                'scan_and_allocate_lazily: while remaining.len() >= ASCII_VECTOR_SIZE {
                    debug_assert!(!any_needs_escape);
                    let vec = AsciiVector::from_slice(&remaining[..ASCII_VECTOR_SIZE]);
                    // Zig: @reduce(.Max, (vec==v0)|(vec==v1)|...) == 1
                    if (vec.simd_eq(vecs[0])
                        | vec.simd_eq(vecs[1])
                        | vec.simd_eq(vecs[2])
                        | vec.simd_eq(vecs[3])
                        | vec.simd_eq(vecs[4]))
                    .any()
                    {
                        debug_assert!(buf.capacity() == 0);

                        buf = Vec::with_capacity(latin1.len() + 6);
                        let copy_len = latin1.len() - remaining.len();
                        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                        buf.extend_from_slice(&latin1[..copy_len]);
                        any_needs_escape = true;
                        // PERF(port): Zig used `inline for (0..ascii_vector_size)` to
                        // unroll this — profile in Phase B.
                        for i in 0..ASCII_VECTOR_SIZE {
                            match remaining[i] {
                                b'"' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&quot;".len());
                                    // PERF(port): Zig wrote into spare capacity then
                                    // bumped `items.len` directly — profile in Phase B.
                                    buf.extend_from_slice(b"&quot;");
                                }
                                b'&' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&amp;".len());
                                    buf.extend_from_slice(b"&amp;");
                                }
                                b'\'' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&#x27;".len());
                                    buf.extend_from_slice(b"&#x27;");
                                }
                                b'<' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&lt;".len());
                                    buf.extend_from_slice(b"&lt;");
                                }
                                b'>' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&gt;".len());
                                    buf.extend_from_slice(b"&gt;");
                                }
                                c => {
                                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                                    buf.push(c);
                                }
                            }
                        }

                        remaining = &remaining[ASCII_VECTOR_SIZE..];
                        break 'scan_and_allocate_lazily;
                    }

                    remaining = &remaining[ASCII_VECTOR_SIZE..];
                }
            }

            if any_needs_escape {
                // pass #2: we found something that needed an escape
                // so we'll go ahead and copy the buffer into a new buffer
                while remaining.len() >= ASCII_VECTOR_SIZE {
                    let vec = AsciiVector::from_slice(&remaining[..ASCII_VECTOR_SIZE]);
                    if (vec.simd_eq(vecs[0])
                        | vec.simd_eq(vecs[1])
                        | vec.simd_eq(vecs[2])
                        | vec.simd_eq(vecs[3])
                        | vec.simd_eq(vecs[4]))
                    .any()
                    {
                        buf.reserve(ASCII_VECTOR_SIZE + 6);
                        // PERF(port): Zig used `inline for` here — profile in Phase B.
                        for i in 0..ASCII_VECTOR_SIZE {
                            match remaining[i] {
                                b'"' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&quot;".len());
                                    buf.extend_from_slice(b"&quot;");
                                }
                                b'&' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&amp;".len());
                                    buf.extend_from_slice(b"&amp;");
                                }
                                b'\'' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&#x27;".len());
                                    buf.extend_from_slice(b"&#x27;");
                                }
                                b'<' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&lt;".len());
                                    buf.extend_from_slice(b"&lt;");
                                }
                                b'>' => {
                                    buf.reserve((ASCII_VECTOR_SIZE - i) + b"&gt;".len());
                                    buf.extend_from_slice(b"&gt;");
                                }
                                c => {
                                    // PERF(port): was appendAssumeCapacity — profile in Phase B
                                    buf.push(c);
                                }
                            }
                        }

                        remaining = &remaining[ASCII_VECTOR_SIZE..];
                        continue;
                    }

                    buf.reserve(ASCII_VECTOR_SIZE);
                    // PERF(port): Zig wrote into spare capacity then bumped
                    // `items.len` directly — profile in Phase B.
                    buf.extend_from_slice(&remaining[..ASCII_VECTOR_SIZE]);
                    remaining = &remaining[ASCII_VECTOR_SIZE..];
                }
            }

            // PORT NOTE: reshaped for borrowck — Zig walked raw `ptr`/`end`
            // pointers; here we index into `remaining` so the prefix-copy
            // offset is computable without `@intFromPtr`.
            let mut idx: usize = 0;
            let end = remaining.len();

            if !any_needs_escape {
                'scan_and_allocate_lazily: while idx != end {
                    match remaining[idx] {
                        c @ (b'"' | b'&' | b'\'' | b'<' | b'>') => {
                            debug_assert!(buf.capacity() == 0);

                            buf = Vec::with_capacity(
                                latin1.len() + SCALAR_LENGTHS[c as usize] as usize,
                            );
                            let copy_len = (latin1.len() - remaining.len()) + idx;
                            debug_assert!(copy_len <= buf.capacity());
                            // PERF(port): Zig set `items.len = copy_len` then `@memcpy`
                            // into it. `extend_from_slice` is equivalent here.
                            buf.extend_from_slice(&latin1[..copy_len]);
                            any_needs_escape = true;
                            break 'scan_and_allocate_lazily;
                        }
                        _ => {}
                    }
                    idx += 1;
                }
            }

            while idx != end {
                match remaining[idx] {
                    b'"' => buf.extend_from_slice(b"&quot;"),
                    b'&' => buf.extend_from_slice(b"&amp;"),
                    // modified from escape-html; used to be '&#39'
                    b'\'' => buf.extend_from_slice(b"&#x27;"),
                    b'<' => buf.extend_from_slice(b"&lt;"),
                    b'>' => buf.extend_from_slice(b"&gt;"),
                    c => buf.push(c),
                }
                idx += 1;
            }

            if !any_needs_escape {
                debug_assert!(buf.capacity() == 0);
                return Ok(Escaped::Original);
            }

            return Ok(Escaped::Allocated(buf.into_boxed_slice()));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// escapeHTMLForUTF16Input
// ──────────────────────────────────────────────────────────────────────────

pub fn escape_html_for_utf16_input(utf16: &[u16]) -> Result<Escaped<u16>, AllocError> {
    match utf16.len() {
        0 => return Ok(Escaped::Static(b"")),
        1 => {
            return Ok(match utf16[0] {
                c if c == u16::from(b'"') => Escaped::Static(b"&quot;"),
                c if c == u16::from(b'&') => Escaped::Static(b"&amp;"),
                c if c == u16::from(b'\'') => Escaped::Static(b"&#x27;"),
                c if c == u16::from(b'<') => Escaped::Static(b"&lt;"),
                c if c == u16::from(b'>') => Escaped::Static(b"&gt;"),
                _ => Escaped::Original,
            });
        }
        2 => {
            let first_16: &[u16] = match utf16[0] {
                c if c == u16::from(b'"') => w!("&quot;"),
                c if c == u16::from(b'&') => w!("&amp;"),
                c if c == u16::from(b'\'') => w!("&#x27;"),
                c if c == u16::from(b'<') => w!("&lt;"),
                c if c == u16::from(b'>') => w!("&gt;"),
                _ => &utf16[0..1],
            };

            let second_16: &[u16] = match utf16[1] {
                c if c == u16::from(b'"') => w!("&quot;"),
                c if c == u16::from(b'&') => w!("&amp;"),
                c if c == u16::from(b'\'') => w!("&#x27;"),
                c if c == u16::from(b'<') => w!("&lt;"),
                c if c == u16::from(b'>') => w!("&gt;"),
                _ => &utf16[1..2],
            };

            if core::ptr::eq(first_16.as_ptr(), utf16.as_ptr())
                && core::ptr::eq(second_16.as_ptr(), utf16[1..].as_ptr())
            {
                return Ok(Escaped::Original);
            }

            let mut buf = vec![0u16; first_16.len() + second_16.len()].into_boxed_slice();
            buf[..first_16.len()].copy_from_slice(first_16);
            buf[first_16.len()..].copy_from_slice(second_16);
            return Ok(Escaped::Allocated(buf));
        }

        _ => {
            let mut remaining = utf16;

            let mut any_needs_escape = false;
            let mut buf: Vec<u16> = Vec::new();

            if ENABLE_SIMD {
                const VEC_CHARS: &[u8; 5] = b"\"&'<>";
                // TODO(port): portable_simd nightly — see note in latin1 path.
                let vecs: [AsciiU16Vector; 5] = [
                    AsciiU16Vector::splat(u16::from(VEC_CHARS[0])),
                    AsciiU16Vector::splat(u16::from(VEC_CHARS[1])),
                    AsciiU16Vector::splat(u16::from(VEC_CHARS[2])),
                    AsciiU16Vector::splat(u16::from(VEC_CHARS[3])),
                    AsciiU16Vector::splat(u16::from(VEC_CHARS[4])),
                ];
                let high = AsciiU16Vector::splat(127u16);

                // pass #1: scan for any characters that need escaping
                // assume most strings won't need any escaping, so don't actually allocate the buffer
                'scan_and_allocate_lazily: while remaining.len() >= ASCII_U16_VECTOR_SIZE {
                    debug_assert!(!any_needs_escape);
                    let vec = AsciiU16Vector::from_slice(&remaining[..ASCII_U16_VECTOR_SIZE]);
                    if (vec.simd_gt(high)
                        | vec.simd_eq(vecs[0])
                        | vec.simd_eq(vecs[1])
                        | vec.simd_eq(vecs[2])
                        | vec.simd_eq(vecs[3])
                        | vec.simd_eq(vecs[4]))
                    .any()
                    {
                        let mut i: u16 = 0;
                        'lazy: {
                            while (i as usize) < ASCII_U16_VECTOR_SIZE {
                                match remaining[i as usize] {
                                    c if matches!(
                                        c,
                                        0x22 /* " */ | 0x26 /* & */ | 0x27 /* ' */ | 0x3C /* < */ | 0x3E /* > */
                                    ) =>
                                    {
                                        any_needs_escape = true;
                                        break 'lazy;
                                    }
                                    128..=u16::MAX => {
                                        let cp = utf16_codepoint(&remaining[i as usize..]);
                                        i += u16::from(cp.len);
                                    }
                                    _ => {
                                        i += 1;
                                    }
                                }
                            }
                        }

                        if !any_needs_escape {
                            remaining = &remaining[i as usize..];
                            continue 'scan_and_allocate_lazily;
                        }

                        // Zig computed byte offset via @intFromPtr; here the
                        // u16-count offset is `(utf16.len()-remaining.len()) + i`.
                        let prefix_u16 = (utf16.len() - remaining.len()) + i as usize;
                        debug_assert!(prefix_u16 <= utf16.len());
                        buf = Vec::with_capacity(utf16.len() + 6);
                        buf.extend_from_slice(&utf16[..prefix_u16]);

                        while (i as usize) < ASCII_U16_VECTOR_SIZE {
                            match remaining[i as usize] {
                                c if matches!(c, 0x22 | 0x26 | 0x27 | 0x3C | 0x3E) => {
                                    let result: &'static [u16] = match c {
                                        0x22 => w!("&quot;"),
                                        0x26 => w!("&amp;"),
                                        0x27 => w!("&#x27;"),
                                        0x3C => w!("&lt;"),
                                        0x3E => w!("&gt;"),
                                        _ => unreachable!(),
                                    };

                                    buf.extend_from_slice(result);
                                    i += 1;
                                }
                                128..=u16::MAX => {
                                    let cp = utf16_codepoint(&remaining[i as usize..]);

                                    buf.extend_from_slice(
                                        &remaining[i as usize..][..usize::from(cp.len)],
                                    );
                                    i += u16::from(cp.len);
                                }
                                c => {
                                    i += 1;
                                    buf.push(c);
                                }
                            }
                        }

                        // edgecase: code point width could exceed ascii_u16_vector_size
                        remaining = &remaining[i as usize..];
                        break 'scan_and_allocate_lazily;
                    }

                    remaining = &remaining[ASCII_U16_VECTOR_SIZE..];
                }

                if any_needs_escape {
                    // pass #2: we found something that needed an escape
                    // but there's still some more text to
                    // so we'll go ahead and copy the buffer into a new buffer
                    while remaining.len() >= ASCII_U16_VECTOR_SIZE {
                        let vec = AsciiU16Vector::from_slice(&remaining[..ASCII_U16_VECTOR_SIZE]);
                        if (vec.simd_gt(high)
                            | vec.simd_eq(vecs[0])
                            | vec.simd_eq(vecs[1])
                            | vec.simd_eq(vecs[2])
                            | vec.simd_eq(vecs[3])
                            | vec.simd_eq(vecs[4]))
                        .any()
                        {
                            buf.reserve(ASCII_U16_VECTOR_SIZE);
                            let mut i: u16 = 0;
                            while (i as usize) < ASCII_U16_VECTOR_SIZE {
                                match remaining[i as usize] {
                                    0x22 => {
                                        buf.extend_from_slice(w!("&quot;"));
                                        i += 1;
                                    }
                                    0x26 => {
                                        buf.extend_from_slice(w!("&amp;"));
                                        i += 1;
                                    }
                                    0x27 => {
                                        // modified from escape-html; used to be '&#39'
                                        buf.extend_from_slice(w!("&#x27;"));
                                        i += 1;
                                    }
                                    0x3C => {
                                        buf.extend_from_slice(w!("&lt;"));
                                        i += 1;
                                    }
                                    0x3E => {
                                        buf.extend_from_slice(w!("&gt;"));
                                        i += 1;
                                    }
                                    128..=u16::MAX => {
                                        let cp = utf16_codepoint(&remaining[i as usize..]);

                                        buf.extend_from_slice(
                                            &remaining[i as usize..][..usize::from(cp.len)],
                                        );
                                        i += u16::from(cp.len);
                                    }
                                    c => {
                                        buf.push(c);
                                        i += 1;
                                    }
                                }
                            }

                            remaining = &remaining[i as usize..];
                            continue;
                        }

                        buf.reserve(ASCII_U16_VECTOR_SIZE);
                        // PERF(port): Zig wrote into spare capacity then bumped
                        // `items.len` directly — profile in Phase B.
                        buf.extend_from_slice(&remaining[..ASCII_U16_VECTOR_SIZE]);
                        remaining = &remaining[ASCII_U16_VECTOR_SIZE..];
                    }
                }
            }

            // PORT NOTE: reshaped for borrowck — index into `remaining` instead
            // of raw `ptr`/`end` pointers.
            let mut idx: usize = 0;
            let end = remaining.len();

            if !any_needs_escape {
                'scan_and_allocate_lazily: while idx != end {
                    match remaining[idx] {
                        c if matches!(c, 0x22 | 0x26 | 0x27 | 0x3C | 0x3E) => {
                            buf = Vec::with_capacity(
                                utf16.len() + SCALAR_LENGTHS[c as usize] as usize,
                            );
                            let prefix_u16 = (utf16.len() - remaining.len()) + idx;
                            debug_assert!(prefix_u16 <= utf16.len());
                            buf.extend_from_slice(&utf16[..prefix_u16]);
                            any_needs_escape = true;
                            break 'scan_and_allocate_lazily;
                        }
                        128..=u16::MAX => {
                            let avail = if idx + 1 == end { 1 } else { 2 };
                            let cp = utf16_codepoint(&remaining[idx..idx + avail]);

                            idx += usize::from(cp.len);
                        }
                        _ => {
                            idx += 1;
                        }
                    }
                }
            }

            while idx != end {
                match remaining[idx] {
                    0x22 => {
                        buf.extend_from_slice(w!("&quot;"));
                        idx += 1;
                    }
                    0x26 => {
                        buf.extend_from_slice(w!("&amp;"));
                        idx += 1;
                    }
                    0x27 => {
                        // modified from escape-html; used to be '&#39'
                        buf.extend_from_slice(w!("&#x27;"));
                        idx += 1;
                    }
                    0x3C => {
                        buf.extend_from_slice(w!("&lt;"));
                        idx += 1;
                    }
                    0x3E => {
                        buf.extend_from_slice(w!("&gt;"));
                        idx += 1;
                    }
                    128..=u16::MAX => {
                        let avail = if idx + 1 == end { 1 } else { 2 };
                        let cp = utf16_codepoint(&remaining[idx..idx + avail]);

                        buf.extend_from_slice(&remaining[idx..idx + usize::from(cp.len)]);
                        idx += usize::from(cp.len);
                    }
                    c => {
                        buf.push(c);
                        idx += 1;
                    }
                }
            }

            if !any_needs_escape {
                return Ok(Escaped::Original);
            }

            return Ok(Escaped::Allocated(buf.into_boxed_slice()));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable/escapeHTML.zig (642 lines)
//   confidence: medium
//   todos:      2
//   notes:      SIMD paths assume core::simd-style API on AsciiVector/AsciiU16Vector (nightly portable_simd or bun_highway shim); ENABLE_SIMD const + strings::append signature need wiring in Phase B. Raw ptr/end loops reshaped to index-based for borrowck.
// ──────────────────────────────────────────────────────────────────────────

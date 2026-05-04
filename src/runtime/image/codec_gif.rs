//! GIF89a/87a first-frame decode for `Bun.Image`.
//!
//! LZW is inherently serial — each code's expansion depends on the dictionary
//! built from all prior codes — so the bitstream decode is scalar by
//! construction. The post-LZW palette→RGBA expand is a 4-byte gather per
//! pixel; on the sizes GIF is actually used at it's memory-bandwidth-bound
//! and a tight scalar loop already saturates that, so no Highway kernel here
//! (the existing `NearestPaletteImpl` covers the encode-side colour match if
//! we add `.gif()` later).
//!
//! Scope: single-image, first frame; honours interlace and the GCE
//! transparency index. Animated/disposal/NETSCAPE loop are skipped — Sharp's
//! default `pages:1` does the same.

use super::codecs;

/// Sub-block-aware bit reader. GIF wraps the LZW bitstream in length-
/// prefixed sub-blocks (≤255 bytes each, terminated by a 0 block), and
/// codes are LSB-first across byte boundaries — so this pulls one byte at
/// a time from the sub-block stream into a 32-bit accumulator.
// PORT NOTE: stack-local helper; `'a` borrows the input byte slice for the
// duration of the decode call.
struct Bits<'a> {
    src: &'a [u8],
    /// Index into `src` of the next byte to consume.
    i: usize,
    /// Bytes remaining in the current sub-block. 0 ⇒ need to read a length.
    block: usize,
    acc: u32,
    // Zig: u5
    nbits: u8,
    /// We hit the 0-length terminator or ran off the end — every subsequent
    /// `read` returns 0 so the LZW loop sees an EOI-shaped value and stops
    /// instead of looping forever on truncated input.
    eof: bool,
}

impl<'a> Bits<'a> {
    fn read(&mut self, n: u8) -> u16 {
        while self.nbits < n && !self.eof {
            if self.block == 0 {
                if self.i >= self.src.len() {
                    self.eof = true;
                    break;
                }
                self.block = self.src[self.i] as usize;
                self.i += 1;
                if self.block == 0 {
                    self.eof = true;
                    break;
                }
            }
            if self.i >= self.src.len() {
                self.eof = true;
                break;
            }
            self.acc |= (self.src[self.i] as u32) << self.nbits;
            self.i += 1;
            self.block -= 1;
            self.nbits += 8;
        }
        let v: u16 = (self.acc & ((1u32 << n) - 1)) as u16;
        self.acc >>= n;
        self.nbits = self.nbits.saturating_sub(n);
        v
    }

    /// Skip the rest of this image's sub-blocks (after EOI we may still be
    /// mid-block, and there can be trailing padding sub-blocks).
    fn drain(&mut self) {
        let mut i = self.i + self.block;
        while i < self.src.len() {
            // Widen before the add: `1 + u8(255)` overflows u8 (peer-type
            // resolution) before reaching the usize lhs — Debug panics,
            // ReleaseFast wraps to 0 and loops forever.
            let n: usize = self.src[i] as usize;
            i += 1 + n;
            if n == 0 {
                break;
            }
        }
        self.i = i.min(self.src.len());
    }
}

/// One node per dictionary entry. The classic LZW dict is "string = previous
/// string + one byte"; we store `(prefix, suffix)` and reconstruct each string
/// by walking `prefix` back to a root code (< clear). 4096 codes is the GIF
/// hard cap (12-bit codes), so the table is fixed-size — heap-allocated in
/// `decode_frame` (12 KiB) to keep WorkPool stacks small.
struct Dict {
    prefix: [u16; 4096],
    suffix: [u8; 4096],
}

impl Dict {
    /// Walk the prefix chain into `scratch` (reversed), then copy forwards
    /// into `out`. Returns bytes written and the FIRST byte of the string
    /// (needed for the K-ω-K case where the new code refers to itself).
    fn emit(&self, code_: u16, clear: u16, out: &mut [u8], scratch: &mut [u8]) -> (usize, u8) {
        let mut code = code_;
        let mut n: usize = 0;
        while code >= clear {
            // The chain is bounded ≤4096 because every entry was written with
            // `prefix[avail] = p` where p < avail at the time (see the
            // `if (avail < 4096)` block in decode), so following `prefix`
            // strictly decreases. Hostile streams can't break that — `code >
            // avail` is rejected before emit() is called. Asserted so a future
            // edit that loosens the rejection trips loudly.
            debug_assert!(n < 4096);
            scratch[n] = self.suffix[code as usize];
            code = self.prefix[code as usize];
            n += 1;
        }
        scratch[n] = code as u8; // root: literal byte
        n += 1;
        let first: u8 = scratch[n - 1];
        let cap = n.min(out.len());
        for k in 0..cap {
            out[k] = scratch[n - 1 - k];
        }
        (cap, first)
    }
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    // ── header + LSD ───────────────────────────────────────────────────────
    if bytes.len() < 13 || !(&bytes[0..6] == b"GIF89a" || &bytes[0..6] == b"GIF87a") {
        return Err(codecs::Error::DecodeFailed);
    }
    let lsd_packed = bytes[10];
    let has_gct = lsd_packed & 0x80 != 0;
    let gct_size: u16 = if has_gct { 1u16 << ((lsd_packed & 7) + 1) } else { 0 };

    let mut i: usize = 13 + (gct_size as usize) * 3;
    if i > bytes.len() {
        return Err(codecs::Error::DecodeFailed);
    }
    let gct: &[u8] = if has_gct { &bytes[13..][..(gct_size as usize) * 3] } else { &[] };

    let mut trns: Option<u8> = None; // transparency index from the most recent GCE

    // ── block stream: skip extensions, take the first Image Descriptor ─────
    while i < bytes.len() {
        match bytes[i] {
            0x3B => return Err(codecs::Error::DecodeFailed), // trailer before any image
            0x21 => {
                // extension introducer
                if i + 2 > bytes.len() {
                    return Err(codecs::Error::DecodeFailed);
                }
                let label = bytes[i + 1];
                i += 2;
                if label == 0xF9 && i + 6 <= bytes.len() && bytes[i] == 4 {
                    // Graphics Control Extension: blocksize=4 · packed ·
                    // delay(u16) · trns-idx · 0
                    if bytes[i + 1] & 1 != 0 {
                        trns = Some(bytes[i + 4]);
                    }
                }
                // Skip sub-blocks regardless of label. Widen `n` first — a
                // legal max-size 255-byte sub-block (XMP/ICC application
                // extensions emit these) would overflow `1 + u8` and either
                // panic or spin a WorkPool thread forever.
                while i < bytes.len() {
                    let n: usize = bytes[i] as usize;
                    i += 1 + n;
                    if n == 0 {
                        break;
                    }
                }
            }
            0x2C => {
                // Image Descriptor
                if i + 10 > bytes.len() {
                    return Err(codecs::Error::DecodeFailed);
                }
                let w: u32 = u16::from_le_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
                let h: u32 = u16::from_le_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
                let ipacked = bytes[i + 9];
                let interlace = ipacked & 0x40 != 0;
                let has_lct = ipacked & 0x80 != 0;
                let lct_size: usize = if has_lct { 1usize << ((ipacked & 7) + 1) } else { 0 };
                i += 10;
                if w == 0 || h == 0 {
                    return Err(codecs::Error::DecodeFailed);
                }
                codecs::guard(w, h, max_pixels)?;
                let ct: &[u8] = if has_lct {
                    if i + lct_size * 3 > bytes.len() {
                        return Err(codecs::Error::DecodeFailed);
                    }
                    let s = &bytes[i..][..lct_size * 3];
                    i += lct_size * 3;
                    s
                } else {
                    gct
                };
                if ct.is_empty() {
                    return Err(codecs::Error::DecodeFailed); // no palette at all
                }

                if i >= bytes.len() {
                    return Err(codecs::Error::DecodeFailed);
                }
                let min_code: u8 = bytes[i].max(2).min(11);
                i += 1;
                return decode_frame(bytes, i, w, h, interlace, ct, min_code, trns);
            }
            _ => return Err(codecs::Error::DecodeFailed),
        }
    }
    Err(codecs::Error::DecodeFailed)
}

fn decode_frame(
    bytes: &[u8],
    lzw_off: usize,
    w: u32,
    h: u32,
    interlace: bool,
    ct: &[u8],
    min_code: u8,
    trns: Option<u8>,
) -> Result<codecs::Decoded, codecs::Error> {
    let npix: usize = (w as usize) * (h as usize);

    // LZW dictionary state. `clear` and `eoi` are the two reserved codes
    // immediately after the literal range; the first assignable code is
    // `eoi + 1`. Code width starts at min_code+1 and grows to 12.
    let clear: u16 = 1u16 << min_code;
    let eoi: u16 = clear + 1;
    let mut size: u8 = min_code + 1;
    let mut avail: u16 = eoi + 1;
    let mut prev: Option<u16> = None;

    // PERF(port): Zig left this uninitialized; zero-init here for safety.
    // SAFETY: all-zero is a valid Dict (plain integer arrays).
    let mut dict: Box<Dict> = unsafe { Box::<Dict>::new_zeroed().assume_init() };
    let mut scratch = [0u8; 4096];

    // PERF(port): Zig left this uninitialized; zero-init here for safety.
    let mut idx = vec![0u8; npix];
    let mut written: usize = 0;

    let mut bits = Bits { src: bytes, i: lzw_off, block: 0, acc: 0, nbits: 0, eof: false };
    while written < npix {
        let code = bits.read(size);
        if bits.eof && code == 0 {
            break;
        }
        if code == clear {
            size = min_code + 1;
            avail = eoi + 1;
            prev = None;
            continue;
        }
        if code == eoi {
            break;
        }

        // Emit the string for `code`. If `code == avail` (the K-ω-K case: the
        // encoder referenced the entry it's about to create), the string is
        // prev's expansion + prev's first byte — so we emit prev, then append
        // its own first byte.
        let first: u8;
        if code < avail {
            let r = dict.emit(code, clear, &mut idx[written..], &mut scratch);
            written += r.0;
            first = r.1;
        } else if code == avail && prev.is_some() {
            let r = dict.emit(prev.unwrap(), clear, &mut idx[written..], &mut scratch);
            written += r.0;
            first = r.1;
            if written < npix {
                idx[written] = first;
                written += 1;
            }
        } else {
            return Err(codecs::Error::DecodeFailed); // out-of-range code
        }

        // Add prev+first to the dictionary, then bump code width when the
        // table fills the current width's range. GIF uses *deferred* clear:
        // once avail hits 4096 the encoder may keep emitting 12-bit codes
        // without growing further until it sends a clear.
        if let Some(p) = prev {
            if avail < 4096 {
                dict.prefix[avail as usize] = p;
                dict.suffix[avail as usize] = first;
                avail += 1;
                if avail == (1u16 << size) && size < 12 {
                    size += 1;
                }
            }
        }
        prev = Some(code);
    }
    bits.drain();
    // A short or truncated stream (early EOI/eof) leaves `idx[written..]` as
    // raw mimalloc bytes. Those would be mapped through an attacker-controlled
    // palette into the output — a heap-memory disclosure. Filling with the
    // transparent index (or 0) makes the unfilled region transparent/background
    // instead, which is what browsers do for short frames.
    if written < npix {
        idx[written..].fill(trns.unwrap_or(0));
    }

    // ── interlace reorder ──────────────────────────────────────────────────
    // GIF interlacing writes rows in 4 passes (every 8th from 0, every 8th
    // from 4, every 4th from 2, every 2nd from 1). The decoded `idx` is in
    // pass order; remap to scan order while expanding so we don't allocate a
    // second index buffer.
    let mut out = vec![0u8; npix * 4].into_boxed_slice();

    let mut pal: [[u8; 4]; 256] = [[0, 0, 0, 255]; 256];
    for c in 0..ct.len() / 3 {
        pal[c] = [ct[c * 3], ct[c * 3 + 1], ct[c * 3 + 2], 255];
    }
    if let Some(t) = trns {
        pal[t as usize] = [0, 0, 0, 0];
    }

    if interlace {
        const PASSES: [[u32; 2]; 4] = [[0, 8], [4, 8], [2, 4], [1, 2]];
        let mut src_y: u32 = 0;
        for p in PASSES {
            let mut y: u32 = p[0];
            while y < h {
                expand_row(
                    &idx[(src_y as usize) * (w as usize)..][..w as usize],
                    &mut out[(y as usize) * (w as usize) * 4..],
                    &pal,
                );
                y += p[1];
                src_y += 1;
            }
        }
    } else {
        let mut y: u32 = 0;
        while y < h {
            expand_row(
                &idx[(y as usize) * (w as usize)..][..w as usize],
                &mut out[(y as usize) * (w as usize) * 4..],
                &pal,
            );
            y += 1;
        }
    }
    Ok(codecs::Decoded { rgba: out, width: w, height: h })
}

/// One row of palette indices → RGBA. Scalar 4-byte copy per pixel — see file
/// comment for why this isn't a Highway kernel.
#[inline]
fn expand_row(idx: &[u8], out: &mut [u8], pal: &[[u8; 4]; 256]) {
    for (x, &c) in idx.iter().enumerate() {
        out[x * 4..][..4].copy_from_slice(&pal[c as usize]);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/codec_gif.zig (287 lines)
//   confidence: high
//   todos:      0
//   notes:      Box::new_zeroed requires nightly or 1.82+; codecs::Decoded.rgba assumed Box<[u8]>
// ──────────────────────────────────────────────────────────────────────────

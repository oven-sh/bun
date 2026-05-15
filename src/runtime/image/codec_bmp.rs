//! Windows DIB / BMP decode-only.
//!
//! Exists so the WSL2 clipboard path (`CF_DIB` surfaced via xclip on the
//! Linux side) has a decoder; on macOS/Windows the system backend gets first
//! refusal and handles RLE/JPEG-in-BMP/OS2-header oddities. This static path
//! covers what clipboards actually emit: BITMAPINFOHEADER (40) and
//! BITMAPV4/V5HEADER (108/124), uncompressed (BI_RGB) or BI_BITFIELDS, 24/32-
//! bit. Anything else → DecodeFailed (caller has already exhausted the system
//! backend by then).

use super::codecs;

pub struct Header {
    pub width: u32,
    pub height: u32,
    /// y-stride direction: BMP rows are bottom-up unless biHeight < 0.
    pub top_down: bool,
    pub bpp: u16, // 24 or 32
    pub pix_off: u32,
    /// BI_BITFIELDS masks; for BI_RGB these are the Windows defaults.
    pub r_mask: u32,
    pub g_mask: u32,
    pub b_mask: u32,
    pub a_mask: u32,
}

/// Read enough of BITMAPFILEHEADER + BITMAPINFOHEADER (any version ≥ 40)
/// to size and locate the pixel array. Everything is little-endian.
pub fn parse_header(b: &[u8]) -> Result<Header, codecs::Error> {
    // BITMAPFILEHEADER(14) + at least BITMAPINFOHEADER(40).
    if b.len() < 54 || b[0] != b'B' || b[1] != b'M' {
        return Err(codecs::Error::DecodeFailed);
    }
    let pix_off = u32::from_le_bytes(b[10..14].try_into().expect("infallible: size matches"));
    let ih_size = u32::from_le_bytes(b[14..18].try_into().expect("infallible: size matches"));
    // OS/2 BITMAPCOREHEADER (12) and other oddities — let the system
    // backend (already tried) or caller deal; clipboards don't emit these.
    // (usize add: `ih_size` is attacker bytes; u32 14+u32::MAX would wrap.)
    if ih_size < 40 || 14 + ih_size as usize > b.len() {
        return Err(codecs::Error::DecodeFailed);
    }
    let w_raw = i32::from_le_bytes(b[18..22].try_into().expect("infallible: size matches"));
    let h_raw = i32::from_le_bytes(b[22..26].try_into().expect("infallible: size matches"));
    // i32::MIN biHeight would make `@abs` yield 2³¹, which then doesn't fit
    // back into i32 anywhere downstream — reject it as the corrupt header it
    // is rather than letting safety-checked casts trap.
    if w_raw <= 0 || h_raw == 0 || h_raw == i32::MIN {
        return Err(codecs::Error::DecodeFailed);
    }
    let bpp = u16::from_le_bytes(b[28..30].try_into().expect("infallible: size matches"));
    let compression = u32::from_le_bytes(b[30..34].try_into().expect("infallible: size matches"));
    if bpp != 24 && bpp != 32 {
        return Err(codecs::Error::DecodeFailed);
    }
    // BI_RGB = 0, BI_BITFIELDS = 3. RLE/JPEG/PNG-in-BMP need a real codec.
    if compression != 0 && compression != 3 {
        return Err(codecs::Error::DecodeFailed);
    }

    let mut h = Header {
        width: u32::try_from(w_raw).expect("int cast"),
        height: h_raw.unsigned_abs(),
        top_down: h_raw < 0,
        bpp,
        pix_off,
        // BI_RGB defaults — Windows-native byte order is BGR(X). For 32-bit
        // BI_RGB the high byte is *reserved* per the BITMAPINFOHEADER spec
        // and real-world producers (CF_DIB clipboard, GetDIBits, Pillow BGRX)
        // write 0 there; treating it as alpha would make every such image
        // fully transparent. Alpha is only honoured below for BI_BITFIELDS
        // with an explicit V4+ mask, matching libgd/Pillow/stb_image.
        r_mask: 0x00FF0000,
        g_mask: 0x0000FF00,
        b_mask: 0x000000FF,
        a_mask: 0,
    };
    // BI_BITFIELDS: masks live either in the V4/V5 header at +40 or, for a
    // plain 40-byte INFOHEADER, immediately after it. Same offset both ways.
    if compression == 3 {
        if b.len() < 14 + 40 + 12 {
            return Err(codecs::Error::DecodeFailed);
        }
        h.r_mask = u32::from_le_bytes(b[54..58].try_into().expect("infallible: size matches"));
        h.g_mask = u32::from_le_bytes(b[58..62].try_into().expect("infallible: size matches"));
        h.b_mask = u32::from_le_bytes(b[62..66].try_into().expect("infallible: size matches"));
        // Alpha mask is V4+ only (offset 66). V3+BITFIELDS has no alpha.
        h.a_mask = if ih_size >= 108 && b.len() >= 70 {
            u32::from_le_bytes(b[66..70].try_into().expect("infallible: size matches"))
        } else {
            0
        };
    }
    // BITFIELDS masks come from the file; reject anything that isn't a
    // single ≤8-bit-wide aligned run before `shift_width` casts the
    // popcount into u5 (and `to8` multiplies by 255 in u32). 5/6-bit masks
    // are real (565 BMPs); >8-bit are nonsense for an 8-bit-per-channel out.
    for m in [h.r_mask, h.g_mask, h.b_mask, h.a_mask] {
        if m != 0 {
            // Contiguous-run check: m >> ctz(m) must be 2^k - 1. The +1 wraps
            // for the all-ones mask we're rejecting, hence `wrapping_add`.
            let run = m >> m.trailing_zeros();
            if (run & run.wrapping_add(1)) != 0 || m.count_ones() > 8 {
                return Err(codecs::Error::DecodeFailed);
            }
        }
    }
    Ok(h)
}

/// One contiguous run of bits in `mask` → (right-shift, bit-width).
/// Separate from the mask read so the inner loop has no ctz/popcount.
#[inline]
fn shift_width(mask: u32) -> (u32, u32) {
    if mask == 0 {
        return (0, 0);
    }
    let sh = mask.trailing_zeros();
    (sh, mask.count_ones())
}

/// Expand `width`-bit channel value to 8-bit by bit-replication so 5-bit
/// 0b11111 → 255 (not 248) and 1-bit alpha → 0/255.
#[inline]
fn to8(v: u32, width: u32) -> u8 {
    match width {
        0 => 0xFF, // unused channel → opaque/full
        8 => v as u8,
        _ => ((v * 255) / ((1u32 << width) - 1)) as u8,
    }
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let h = parse_header(bytes)?;
    codecs::guard(h.width, h.height, max_pixels)?;

    let bpp_bytes: u32 = (h.bpp / 8) as u32;
    // Rows are padded to 4-byte boundaries — DWORD alignment is the one
    // BMP rule everyone implements.
    let stride: usize = ((h.width as usize * bpp_bytes as usize + 3) / 4) * 4;
    let need = h.pix_off as usize + stride * h.height as usize;
    if need > bytes.len() {
        return Err(codecs::Error::DecodeFailed);
    }

    let (rs, rw) = shift_width(h.r_mask);
    let (gs, gw) = shift_width(h.g_mask);
    let (bs, bw) = shift_width(h.b_mask);
    let (as_, aw) = shift_width(h.a_mask);

    let mut out = vec![0u8; h.width as usize * h.height as usize * 4];

    let mut y: u32 = 0;
    while y < h.height {
        let src_y: usize = if h.top_down {
            y as usize
        } else {
            (h.height - 1 - y) as usize
        };
        let row = &bytes[h.pix_off as usize + src_y * stride..];
        let dst = &mut out[y as usize * h.width as usize * 4..];
        let mut x: u32 = 0;
        while x < h.width {
            let xs = x as usize;
            // 24-bit reads three bytes; 32-bit reads a native LE u32. Both
            // feed the same mask path so BI_BITFIELDS Just Works.
            let pix: u32 = if bpp_bytes == 3 {
                row[xs * 3] as u32 | (row[xs * 3 + 1] as u32) << 8 | (row[xs * 3 + 2] as u32) << 16
            } else {
                u32::from_le_bytes(
                    row[xs * 4..xs * 4 + 4]
                        .try_into()
                        .expect("infallible: size matches"),
                )
            };
            dst[xs * 4 + 0] = to8((pix >> rs) & (1u32 << rw).wrapping_sub(1), rw);
            dst[xs * 4 + 1] = to8((pix >> gs) & (1u32 << gw).wrapping_sub(1), gw);
            dst[xs * 4 + 2] = to8((pix >> bs) & (1u32 << bw).wrapping_sub(1), bw);
            dst[xs * 4 + 3] = if h.a_mask == 0 {
                0xFF
            } else {
                to8((pix >> as_) & (1u32 << aw).wrapping_sub(1), aw)
            };
            x += 1;
        }
        y += 1;
    }
    Ok(codecs::Decoded {
        rgba: out,
        width: h.width,
        height: h.height,
        icc_profile: None,
    })
}

// ported from: src/runtime/image/codec_bmp.zig

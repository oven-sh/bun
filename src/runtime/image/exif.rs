//! EXIF Orientation reader.
//!
//! Only the *Orientation* tag (0x0112) is parsed — that is the one piece of
//! EXIF that changes pixel meaning, and the only thing Sharp's `autoOrient`
//! looks at. Everything else (GPS, camera model, timestamps, …) is ignored.
//!
//! Layout being walked, for the next maintainer:
//!
//!   JPEG = FF D8 (SOI) · marker* · FF DA (SOS) · scan · FF D9 (EOI)
//!   marker = FF xx · be16 length · payload[length-2]
//!
//!   APP1/Exif payload = "Exif\0\0" · TIFF
//!   TIFF = byte-order ("II"=LE | "MM"=BE) · u16 magic 42 · u32 IFD0-offset
//!   IFD0 = u16 entry-count · entry[count] · u32 next-IFD-offset
//!   entry = u16 tag · u16 type · u32 count · u32 value-or-offset
//!
//! Orientation is type 3 (SHORT), count 1, so its value is packed in the
//! first 2 bytes of the 4-byte value field — no offset chase needed.
//!
//! The functions are deliberately permissive: any malformation returns
//! `None`/`.Normal` rather than an error. EXIF is advisory; we never fail
//! decode over it.

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Orientation {
    Normal = 1,
    Flop = 2, // mirror horizontal
    Rotate180 = 3,
    Flip = 4, // mirror vertical
    FlopRotate90 = 5,
    Rotate90 = 6,
    FlopRotate270 = 7,
    Rotate270 = 8,
}

pub struct Transform {
    pub flop: bool,
    pub flip: bool,
    pub rotate: u16,
}

impl Orientation {
    /// The (mirror?, cw-degrees) pair that turns the stored pixels upright.
    pub fn transform(self) -> Transform {
        match self {
            Orientation::Normal => Transform { flop: false, flip: false, rotate: 0 },
            Orientation::Flop => Transform { flop: true, flip: false, rotate: 0 },
            Orientation::Rotate180 => Transform { flop: false, flip: false, rotate: 180 },
            Orientation::Flip => Transform { flop: false, flip: true, rotate: 0 },
            // 5 = transpose, 7 = transverse. With flop applied BEFORE a CW
            // rotate (Image.applyOrientation order), flop∘rot270 = transpose
            // and flop∘rot90 = transverse.
            Orientation::FlopRotate90 => Transform { flop: true, flip: false, rotate: 270 },
            Orientation::Rotate90 => Transform { flop: false, flip: false, rotate: 90 },
            Orientation::FlopRotate270 => Transform { flop: true, flip: false, rotate: 90 },
            Orientation::Rotate270 => Transform { flop: false, flip: false, rotate: 270 },
        }
    }
}

/// Walk JPEG markers up to SOS looking for an APP1/Exif segment, then read
/// IFD0 tag 0x0112. JPEG-only because phone cameras are the source of rotated
/// images; PNG eXIf and WebP EXIF chunks exist but are rare enough to leave
/// for a follow-up.
pub fn read_jpeg(bytes: &[u8]) -> Orientation {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Orientation::Normal;
    }
    let mut i: usize = 2;
    while i + 4 <= bytes.len() {
        if bytes[i] != 0xFF {
            return Orientation::Normal;
        }
        let marker = bytes[i + 1];
        match marker {
            // Padding / restart markers carry no length field.
            0xFF => {
                i += 1;
                continue;
            }
            0xD0..=0xD8 => {
                i += 2;
                continue;
            }
            // SOS / EOI: scan data begins; EXIF would have come earlier.
            0xDA | 0xD9 => return Orientation::Normal,
            _ => {}
        }
        let seglen = ((bytes[i + 2] as usize) << 8) | (bytes[i + 3] as usize);
        if seglen < 2 || i + 2 + seglen > bytes.len() {
            return Orientation::Normal;
        }
        if marker == 0xE1 && seglen >= 8 {
            let seg = &bytes[i + 4..i + 2 + seglen];
            if seg.len() >= 6 && &seg[0..6] == b"Exif\x00\x00" {
                return parse_tiff(&seg[6..]).unwrap_or(Orientation::Normal);
            }
        }
        i += 2 + seglen;
    }
    Orientation::Normal
}

fn parse_tiff(tiff: &[u8]) -> Option<Orientation> {
    if tiff.len() < 8 {
        return None;
    }
    let big = &tiff[0..2] == b"MM";
    if !big && &tiff[0..2] != b"II" {
        return None;
    }
    if rd16(tiff, 2, big)? != 42 {
        return None;
    }
    let ifd0 = rd32(tiff, 4, big)? as usize;
    let count = rd16(tiff, ifd0, big)?;
    let mut e: usize = ifd0 + 2;
    let mut n: u16 = 0;
    while n < count {
        let tag = match rd16(tiff, e, big) {
            Some(t) => t,
            None => return None,
        };
        if tag != 0x0112 {
            n += 1;
            e += 12;
            continue;
        }
        // Type 3 (SHORT), count 1 — anything else is malformed for this tag
        // and the value-field layout (packed in first 2 of 4 bytes) wouldn't
        // hold; bail rather than read garbage.
        let ty = rd16(tiff, e + 2, big)?;
        let cnt = rd32(tiff, e + 4, big)?;
        if ty != 3 || cnt != 1 {
            return None;
        }
        let v = rd16(tiff, e + 8, big)?;
        return if v >= 1 && v <= 8 {
            // SAFETY: v is in 1..=8, exactly the discriminant range of #[repr(u8)] Orientation.
            Some(unsafe { core::mem::transmute::<u8, Orientation>(v as u8) })
        } else {
            None
        };
    }
    None
}

#[inline]
fn rd16(b: &[u8], off: usize, big: bool) -> Option<u16> {
    if off + 2 > b.len() {
        return None;
    }
    let bytes = [b[off], b[off + 1]];
    Some(if big { u16::from_be_bytes(bytes) } else { u16::from_le_bytes(bytes) })
}

#[inline]
fn rd32(b: &[u8], off: usize, big: bool) -> Option<u32> {
    if off + 4 > b.len() {
        return None;
    }
    let bytes = [b[off], b[off + 1], b[off + 2], b[off + 3]];
    Some(if big { u32::from_be_bytes(bytes) } else { u32::from_le_bytes(bytes) })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/exif.zig (124 lines)
//   confidence: high
//   todos:      0
//   notes:      anonymous return struct in transform() → named `Transform`; pure byte parsing, no allocators/FFI
// ──────────────────────────────────────────────────────────────────────────

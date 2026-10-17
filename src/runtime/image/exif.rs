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
pub(crate) enum Orientation {
    Normal = 1,
    Flop = 2, // mirror horizontal
    Rotate180 = 3,
    Flip = 4, // mirror vertical
    FlopRotate90 = 5,
    Rotate90 = 6,
    FlopRotate270 = 7,
    Rotate270 = 8,
}

pub(crate) struct Transform {
    pub(crate) flop: bool,
    pub(crate) flip: bool,
    pub(crate) rotate: u16,
}

impl Orientation {
    /// The (mirror?, cw-degrees) pair that turns the stored pixels upright.
    pub(crate) fn transform(self) -> Transform {
        match self {
            Orientation::Normal => Transform {
                flop: false,
                flip: false,
                rotate: 0,
            },
            Orientation::Flop => Transform {
                flop: true,
                flip: false,
                rotate: 0,
            },
            Orientation::Rotate180 => Transform {
                flop: false,
                flip: false,
                rotate: 180,
            },
            Orientation::Flip => Transform {
                flop: false,
                flip: true,
                rotate: 0,
            },
            // 5 = transpose, 7 = transverse. With flop applied BEFORE a CW
            // rotate (Image.applyOrientation order), flop∘rot270 = transpose
            // and flop∘rot90 = transverse.
            Orientation::FlopRotate90 => Transform {
                flop: true,
                flip: false,
                rotate: 270,
            },
            Orientation::Rotate90 => Transform {
                flop: false,
                flip: false,
                rotate: 90,
            },
            Orientation::FlopRotate270 => Transform {
                flop: true,
                flip: false,
                rotate: 90,
            },
            Orientation::Rotate270 => Transform {
                flop: false,
                flip: false,
                rotate: 270,
            },
        }
    }
}

/// Walk JPEG markers up to SOS looking for an APP1/Exif segment, then read
/// IFD0 tag 0x0112. JPEG-only because phone cameras are the source of rotated
/// images; PNG eXIf and WebP EXIF chunks exist but are rare enough to leave
/// for a follow-up.
pub(crate) fn read_jpeg(bytes: &[u8]) -> Orientation {
    let mut found = Orientation::Normal;
    walk::<false>(bytes, |app1| match exif_orientation(app1) {
        Some(orientation) => {
            found = orientation;
            true
        }
        None => false,
    });
    found
}

/// `read_jpeg` for a head that holds the first SOS header. `Err`: the least head that can (`usize::MAX`: none).
pub(crate) fn read_jpeg_head(head: &[u8]) -> Result<Orientation, usize> {
    let mut found = None;
    let stop = walk::<true>(head, |app1| {
        // `read_jpeg` stops at the first Exif segment, so later ones do not count.
        if found.is_none() {
            found = exif_orientation(app1);
        }
        false
    });
    match stop {
        Stop::Sos(end) if end <= head.len() => Ok(found.unwrap_or(Orientation::Normal)),
        Stop::Sos(end) | Stop::Short(end) => Err(end),
        Stop::Lost | Stop::Taken => Err(usize::MAX),
    }
}

/// Where the walk over the segments before the first scan ended.
enum Stop {
    /// `app1` took a segment.
    Taken,
    /// At the first SOS. Its header ends at this offset, which can lie past the input.
    Sos(usize),
    /// Not a JPEG, EOI before SOS, or a bad segment length. With `SEGMENTS_ONLY`, also bytes between two segments.
    Lost,
    /// The segments run past the input. No input shorter than this reaches the next one.
    Short(usize),
}

/// Walks the segments from SOI to the first SOS. `app1` gets each APP1 payload, and `true` from it ends the walk.
#[inline(always)]
fn walk<const SEGMENTS_ONLY: bool>(bytes: &[u8], mut app1: impl FnMut(&[u8]) -> bool) -> Stop {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return Stop::Lost;
    }
    let mut i: usize = 2;
    while i + 4 <= bytes.len() {
        if bytes[i] != 0xFF {
            // A head wants plain segments: libjpeg warns at stray bytes, and a run of fill bytes or bare markers is slow to walk.
            if SEGMENTS_ONLY {
                return Stop::Lost;
            }
            // libjpeg's next_marker() skips to the next 0xFF with a warning, so the decoder accepts this junk too.
            let Some(skip) = bun_core::strings::index_of_char_usize(&bytes[i..], 0xFF) else {
                return Stop::Lost;
            };
            i += skip;
            continue;
        }
        let marker = bytes[i + 1];
        match marker {
            // Padding / restart markers carry no length field.
            0xFF => {
                if SEGMENTS_ONLY {
                    return Stop::Lost;
                }
                i += 1;
                continue;
            }
            // 0xFF00 is a stuffed zero, which next_marker() skips the same way.
            0x00 | 0xD0..=0xD8 => {
                if SEGMENTS_ONLY {
                    return Stop::Lost;
                }
                i += 2;
                continue;
            }
            // SOS / EOI: scan data begins; EXIF would have come earlier.
            0xDA => return Stop::Sos(i + 2 + segment_length(bytes, i)),
            0xD9 => return Stop::Lost,
            _ => {}
        }
        let seglen = segment_length(bytes, i);
        let end = i + 2 + seglen;
        if seglen < 2 {
            return Stop::Lost;
        }
        if end > bytes.len() {
            return Stop::Short(end);
        }
        if marker == 0xE1 && app1(&bytes[i + 4..end]) {
            return Stop::Taken;
        }
        i = end;
    }
    Stop::Short(i + 4)
}

/// The big-endian length field of the segment whose marker is at `bytes[at]`.
#[inline(always)]
fn segment_length(bytes: &[u8], at: usize) -> usize {
    ((bytes[at + 2] as usize) << 8) | (bytes[at + 3] as usize)
}

/// The orientation that an APP1 payload gives when it is an Exif segment.
#[inline]
fn exif_orientation(app1: &[u8]) -> Option<Orientation> {
    if app1.len() >= 6 && &app1[0..6] == b"Exif\x00\x00" {
        return Some(parse_tiff(&app1[6..]).unwrap_or(Orientation::Normal));
    }
    None
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
        let tag = rd16(tiff, e, big)?;
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
        return match v {
            1 => Some(Orientation::Normal),
            2 => Some(Orientation::Flop),
            3 => Some(Orientation::Rotate180),
            4 => Some(Orientation::Flip),
            5 => Some(Orientation::FlopRotate90),
            6 => Some(Orientation::Rotate90),
            7 => Some(Orientation::FlopRotate270),
            8 => Some(Orientation::Rotate270),
            _ => None,
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
    Some(if big {
        u16::from_be_bytes(bytes)
    } else {
        u16::from_le_bytes(bytes)
    })
}

#[inline]
fn rd32(b: &[u8], off: usize, big: bool) -> Option<u32> {
    if off + 4 > b.len() {
        return None;
    }
    let bytes = [b[off], b[off + 1], b[off + 2], b[off + 3]];
    Some(if big {
        u32::from_be_bytes(bytes)
    } else {
        u32::from_le_bytes(bytes)
    })
}

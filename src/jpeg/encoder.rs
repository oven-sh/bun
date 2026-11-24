//! Writes the bytes that `tj3Compress8()` does with 4:2:0 subsampling.

use crate::block::NATURAL_ORDER;
use crate::header::check_size;
use crate::marker::*;
use crate::segment_writer::write_segment;
use crate::strips::Strips;
use crate::{Error, Result, progressive_encoder, sequential_encoder, wrapped};

/// For luma, then chroma, row by row (ITU-T T.81, K.1).
#[rustfmt::skip]
static STANDARD_QUANT: [[u8; 64]; 2] = [
    [
        16, 11, 10, 16,  24,  40,  51,  61,
        12, 12, 14, 19,  26,  58,  60,  55,
        14, 13, 16, 24,  40,  57,  69,  56,
        14, 17, 22, 29,  51,  87,  80,  62,
        18, 22, 37, 56,  68, 109, 103,  77,
        24, 35, 55, 64,  81, 104, 113,  92,
        49, 64, 78, 87, 103, 121, 120, 101,
        72, 92, 95, 98, 112, 100, 103,  99,
    ],
    [
        17, 18, 24, 47, 99, 99, 99, 99,
        18, 21, 26, 66, 99, 99, 99, 99,
        24, 26, 56, 99, 99, 99, 99, 99,
        47, 66, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
    ],
];

/// A segment less its length field, name, number and count.
const ICC_SEGMENT_LEN: usize = u16::MAX as usize - 2 - ICC_PROFILE.len() - 2;

/// In zigzag order.
fn quant_table(standard: &[u8; 64], quality: u8) -> [u8; 64] {
    let quality = u32::from(quality.clamp(1, 100));
    let scale = if quality < 50 {
        5000 / quality
    } else {
        200 - 2 * quality
    };
    NATURAL_ORDER.map(|at| {
        let step = u32::from(*wrapped(standard, at.into()));
        ((step * scale + 50) / 100).clamp(1, 255) as u8
    })
}

/// `quality` is from 1 to 100. Alpha is ignored, and so is a profile that is too long for the format.
pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    progressive: bool,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    check_size(width, height)?;
    if rgba.len() as u64 != 4 * u64::from(width) * u64::from(height) {
        return Err(Error::InvalidBufferSize);
    }
    let pixels = rgba.as_chunks().0;

    let mut out = Vec::new();
    // A photo of good quality has about 2 bits for each pixel.
    out.try_reserve(1024 + pixels.len() / 4)?;
    out.extend_from_slice(&[0xFF, SOI]);
    // Version 1.1, square pixels, no thumbnail.
    write_segment(&mut out, APP0, &[&JFIF, &[1, 1, 0, 0, 1, 0, 1, 0, 0]])?;
    let icc_segments = icc_profile.unwrap_or_default().chunks(ICC_SEGMENT_LEN);
    if let Ok(count) = u8::try_from(icc_segments.len()) {
        for (number, data) in (1..=count).zip(icc_segments) {
            write_segment(&mut out, APP2, &[&ICC_PROFILE, &[number, count], data])?;
        }
    }
    let quant = STANDARD_QUANT
        .each_ref()
        .map(|standard| quant_table(standard, quality));
    for (number, table) in (0..).zip(&quant) {
        write_segment(&mut out, DQT, &[&[number], table])?;
    }
    let size = [height as u16, width as u16].map(u16::to_be_bytes);
    write_segment(
        &mut out,
        if progressive { SOF2 } else { SOF0 },
        &[
            &[8],
            size.as_flattened(),
            &[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
        ],
    )?;

    let mut strips = Strips::new(pixels, width as usize, height as usize, &quant)?;
    if progressive {
        progressive_encoder::write_scans(&mut out, &mut strips)?;
    } else {
        sequential_encoder::write_scan(&mut out, &mut strips)?;
    }
    out.try_reserve(2)?;
    out.extend_from_slice(&[0xFF, EOI]);
    let _ = out.try_shrink_to_fit();
    Ok(out)
}

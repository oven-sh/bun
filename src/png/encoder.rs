//! 8-bit RGBA or palette indices to PNG, byte for byte what libspng wrote with the same zlib.

use bun_zlib::{DeflateEncoder, FlushValue, ReturnCode};

use crate::chunk;
use crate::error::{Error, Result};
use crate::filter::{self, CandidateLines};
use crate::header::{ColorType, Header, MAX_U31};

// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L31
const IDAT_LEN: usize = 8192;
const MEM_LEVEL: i32 = 8;
const Z_DEFAULT_COMPRESSION: i32 = -1;
const Z_DEFAULT_STRATEGY: i32 = 0;
const Z_FILTERED: i32 = 1;

/// The name is for people. Readers go by the profile alone.
const ICC_PROFILE_NAME: &[u8] = b"ICC Profile";

pub struct Palette<'a> {
    /// 1 to 256 of them, as RGBA.
    pub colors: &'a [[u8; 4]],
    /// Without it the colors' alpha is not written and they are all opaque.
    pub has_alpha: bool,
}

/// `image` is RGBA, or with a `palette` one index per pixel. `level` is zlib's: 0 to 9, or -1 for its default.
// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L4737
pub fn encode(
    image: &[u8],
    width: u32,
    height: u32,
    palette: Option<&Palette>,
    level: i8,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let color_type = match palette {
        Some(_) => ColorType::Indexed,
        None => ColorType::TruecolorAlpha,
    };
    let header = Header::new(width, height, 8, color_type, false)?;
    let row_bytes = header.width as usize * header.bytes_per_pixel();
    if row_bytes.checked_mul(header.height as usize) != Some(image.len()) {
        return Err(Error::InvalidBufferSize);
    }

    let mut out = Vec::new();
    out.try_reserve(2 * IDAT_LEN)?;
    out.extend_from_slice(&chunk::SIGNATURE);
    let start = chunk::begin(&mut out, chunk::IHDR)?;
    out.extend_from_slice(&header.width.to_be_bytes());
    out.extend_from_slice(&header.height.to_be_bytes());
    out.extend_from_slice(&[header.bit_depth, header.color_type as u8, 0, 0, 0]);
    chunk::end(&mut out, start)?;
    // A profile longer than a chunk can be is left out.
    if let Some(profile) = icc_profile
        && !profile.is_empty()
        && profile.len() <= MAX_U31 as usize
    {
        write_icc_profile(&mut out, profile)?;
    }
    if let Some(palette) = palette {
        write_palette(&mut out, palette)?;
    }

    // Neither stored bytes nor palette indices get smaller by filtering.
    let worth_filtering = level != 0 && palette.is_none();
    let strategy = if worth_filtering {
        Z_FILTERED
    } else {
        Z_DEFAULT_STRATEGY
    };
    let mut idat = Idat {
        deflater: DeflateEncoder::new(level.into(), bun_zlib::MAX_WBITS, MEM_LEVEL, strategy)?,
        start: chunk::begin(&mut out, chunk::IDAT)?,
        out,
    };

    // A longer row is left as it is. libspng could not add one up in 32 bits. Here it would take six times its memory.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1608
    let adaptive = worth_filtering && row_bytes <= (i32::MAX / 128) as usize;
    let mut lines = CandidateLines::new(row_bytes, adaptive)?;
    let zeros = filter::zeros(if adaptive { row_bytes } else { 0 })?;
    let mut above = zeros.as_slice();
    for row in image.chunks_exact(row_bytes) {
        idat.write(if adaptive {
            lines.best(row, above)
        } else {
            lines.unfiltered(row)
        })?;
        above = row;
    }
    let mut out = idat.finish()?;
    chunk::write(&mut out, chunk::IEND, &[])?;
    // Or a file of 100 bytes would hold on to the room for two IDAT chunks for as long as JavaScript keeps it.
    out.shrink_to_fit();
    Ok(out)
}

fn write_icc_profile(out: &mut Vec<u8>, profile: &[u8]) -> Result<()> {
    let start = chunk::begin(out, chunk::ICCP)?;
    out.try_reserve(ICC_PROFILE_NAME.len() + 2)?;
    out.extend_from_slice(ICC_PROFILE_NAME);
    // The name's terminator, then compression method 0.
    out.extend_from_slice(&[0, 0]);
    let mut deflater = DeflateEncoder::new(
        Z_DEFAULT_COMPRESSION,
        bun_zlib::MAX_WBITS,
        MEM_LEVEL,
        Z_DEFAULT_STRATEGY,
    )?;
    let bound = deflater.bound(profile.len());
    match deflater.step(profile, out, bound, FlushValue::Finish) {
        (_, ReturnCode::StreamEnd) => chunk::end(out, start),
        (_, ReturnCode::MemError) => Err(Error::Alloc(bun_alloc::AllocError)),
        _ => Err(Error::Zlib),
    }
}

fn write_palette(out: &mut Vec<u8>, palette: &Palette) -> Result<()> {
    if palette.colors.is_empty() || palette.colors.len() > 256 {
        return Err(Error::InvalidPalette);
    }
    out.try_reserve(2 * 12 + 4 * palette.colors.len())?;
    let start = chunk::begin(out, chunk::PLTE)?;
    out.extend(palette.colors.iter().flat_map(|&[r, g, b, _]| [r, g, b]));
    chunk::end(out, start)?;
    if palette.has_alpha {
        let start = chunk::begin(out, chunk::TRNS)?;
        out.extend(palette.colors.iter().map(|&[.., a]| a));
        chunk::end(out, start)?;
    }
    Ok(())
}

/// One zlib stream cut into IDAT chunks of `IDAT_LEN` bytes.
///
/// zlib gets each line in a call of its own and sees only the room left in the current chunk, as with libspng:
/// at level 0 both decide where a stored block ends.
struct Idat {
    deflater: DeflateEncoder,
    out: Vec<u8>,
    /// Where the chunk being written starts in `out`.
    start: usize,
}

impl Idat {
    fn room(&self) -> usize {
        (self.start + 8 + IDAT_LEN).saturating_sub(self.out.len())
    }

    fn deflate(&mut self, input: &[u8], flush: FlushValue) -> Result<(usize, ReturnCode)> {
        let room = self.room();
        let (used, code) = self
            .deflater
            .step_limited(input, &mut self.out, room, flush);
        if code == ReturnCode::MemError {
            return Err(Error::Alloc(bun_alloc::AllocError));
        }
        Ok((used, code))
    }

    fn next_chunk_if_full(&mut self) -> Result<()> {
        if self.room() == 0 {
            chunk::end(&mut self.out, self.start)?;
            self.start = chunk::begin(&mut self.out, chunk::IDAT)?;
        }
        Ok(())
    }

    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L4487
    fn write(&mut self, mut line: &[u8]) -> Result<()> {
        while !line.is_empty() {
            let (used, code) = self.deflate(line, FlushValue::NoFlush)?;
            if code != ReturnCode::Ok {
                return Err(Error::Zlib);
            }
            line = line.get(used..).unwrap_or_default();
            self.next_chunk_if_full()?;
        }
        Ok(())
    }

    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L4523
    fn finish(mut self) -> Result<Vec<u8>> {
        loop {
            let before = self.out.len();
            match self.deflate(&[], FlushValue::Finish)? {
                (_, ReturnCode::StreamEnd) => break,
                (_, ReturnCode::Ok | ReturnCode::BufError) if self.out.len() > before => {}
                _ => return Err(Error::Zlib),
            }
            self.next_chunk_if_full()?;
        }
        chunk::end(&mut self.out, self.start)?;
        Ok(self.out)
    }
}

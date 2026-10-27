//! 8-bit RGBA or palette indices to PNG, byte for byte what libspng wrote with the same zlib.

use bun_zlib::{DeflateEncoder, FlushValue, ReturnCode};

use crate::chunk;
use crate::error::{Error, Result};
use crate::filter::Lines;
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
    /// 1 to 256 colors.
    pub rgba: &'a [[u8; 4]],
    /// Without it the colors' alpha is not written and they are all opaque.
    pub has_alpha: bool,
}

/// `level` is zlib's, 0 to 9, or `None` for its default.
pub fn encode_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    level: Option<u8>,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let header = Header::new(width, height, 8, ColorType::TruecolorAlpha, false)?;
    encode(header, rgba, None, level, icc_profile)
}

/// One byte per pixel in `indices`.
pub fn encode_indexed(
    indices: &[u8],
    width: u32,
    height: u32,
    palette: &Palette,
    level: Option<u8>,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let header = Header::new(width, height, 8, ColorType::Indexed, false)?;
    encode(header, indices, Some(palette), level, icc_profile)
}

// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L4737
fn encode(
    header: Header,
    image: &[u8],
    palette: Option<&Palette>,
    level: Option<u8>,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let row_bytes = header.width as usize * header.bytes_per_pixel();
    if row_bytes.checked_mul(header.height as usize) != Some(image.len()) {
        return Err(Error::BufferSize);
    }

    let mut out = Vec::new();
    out.try_reserve(2 * IDAT_LEN)?;
    out.extend_from_slice(&chunk::SIGNATURE);
    chunk::write(&mut out, chunk::IHDR, &header.to_bytes())?;
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
    let filtering = level != Some(0) && palette.is_none();
    let strategy = if filtering {
        Z_FILTERED
    } else {
        Z_DEFAULT_STRATEGY
    };
    let level = level.map_or(Z_DEFAULT_COMPRESSION, i32::from);
    let mut idat = Idat {
        zlib: DeflateEncoder::new(level, bun_zlib::MAX_WBITS, MEM_LEVEL, strategy)?,
        start: chunk::begin(&mut out, chunk::IDAT)?,
        out,
    };

    // libspng does not add up a row longer than this, and so leaves it as it is.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1608
    let choosing = filtering && row_bytes <= (i32::MAX / 128) as usize;
    let mut lines = Lines::new(row_bytes, choosing)?;
    let mut zeros = Vec::new();
    if choosing {
        zeros.try_reserve_exact(row_bytes)?;
        zeros.resize(row_bytes, 0);
    }
    let mut above = zeros.as_slice();
    for row in image.chunks_exact(row_bytes) {
        idat.write(if choosing {
            lines.best(header.bytes_per_pixel(), above, row)
        } else {
            lines.unfiltered(row)
        })?;
        above = row;
    }
    let mut out = idat.finish()?;
    chunk::write(&mut out, chunk::IEND, &[])?;
    out.shrink_to_fit();
    Ok(out)
}

fn write_icc_profile(out: &mut Vec<u8>, profile: &[u8]) -> Result<()> {
    let start = chunk::begin(out, chunk::ICCP)?;
    out.try_reserve(ICC_PROFILE_NAME.len() + 2)?;
    out.extend_from_slice(ICC_PROFILE_NAME);
    // The name's terminator, then compression method 0.
    out.extend_from_slice(&[0, 0]);
    let mut zlib = DeflateEncoder::new(
        Z_DEFAULT_COMPRESSION,
        bun_zlib::MAX_WBITS,
        MEM_LEVEL,
        Z_DEFAULT_STRATEGY,
    )?;
    let bound = zlib.bound(profile.len());
    match zlib.step(profile, out, bound, FlushValue::Finish) {
        (_, ReturnCode::StreamEnd) => chunk::end(out, start),
        (_, ReturnCode::MemError) => Err(Error::Alloc(bun_alloc::AllocError)),
        _ => Err(Error::Zlib),
    }
}

fn write_palette(out: &mut Vec<u8>, palette: &Palette) -> Result<()> {
    if palette.rgba.is_empty() || palette.rgba.len() > 256 {
        return Err(Error::InvalidPalette);
    }
    out.try_reserve(2 * 12 + 4 * palette.rgba.len())?;
    let start = chunk::begin(out, chunk::PLTE)?;
    out.extend(palette.rgba.iter().flat_map(|&[r, g, b, _]| [r, g, b]));
    chunk::end(out, start)?;
    if palette.has_alpha {
        let start = chunk::begin(out, chunk::TRNS)?;
        out.extend(palette.rgba.iter().map(|&[.., a]| a));
        chunk::end(out, start)?;
    }
    Ok(())
}

/// One zlib stream cut into IDAT chunks of `IDAT_LEN` bytes.
///
/// zlib gets each line in a call of its own and sees only the room left in the current chunk, as with libspng:
/// at level 0 both decide where a stored block ends.
struct Idat {
    zlib: DeflateEncoder,
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
        let (used, code) = self.zlib.step_limited(input, &mut self.out, room, flush);
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

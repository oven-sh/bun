//! PNG to 8-bit RGBA. No checksum is looked at: not a chunk's CRC, not a zlib stream's Adler-32.

use bun_core::strings::index_of_char_usize;
use bun_zlib::{InflateDecoder, ReturnCode};

use crate::chunk::{self, Reader, Type};
use crate::error::{Error, Result};
use crate::filter;
use crate::header::{ColorType, Header, Pass};

// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L32
const MAX_STORED_CHUNKS: u32 = 1000;

type Rgba = [u8; 4];

pub struct Image {
    /// `width * height * 4` bytes, rows from the top, not premultiplied.
    pub rgba: Vec<u8>,
    /// What the iCCP chunk inflates to.
    pub icc_profile: Option<Vec<u8>>,
}

/// A file whose IHDR has been read and found valid.
pub struct Decoder<'a> {
    header: Header,
    /// Behind IHDR's data.
    reader: Reader<'a>,
}

impl<'a> Decoder<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self> {
        let mut reader = Reader::new(bytes);
        if reader.array()? != chunk::SIGNATURE {
            return Err(Error::Signature);
        }
        let len = u32::from_be_bytes(reader.array()?);
        let kind: Type = reader.array()?;
        if len != 13 || kind != chunk::IHDR {
            return Err(Error::InvalidHeader);
        }
        let header = Header::parse(&reader.array()?)?;
        Ok(Self { header, reader })
    }

    pub fn header(&self) -> Header {
        self.header
    }

    /// `max_inflated` bounds what an iCCP, zTXt or iTXt chunk may inflate to, rounded down as `inflate` says.
    /// One that needs more fails the decode.
    pub fn decode(self, max_inflated: usize) -> Result<Image> {
        let Self { header, mut reader } = self;
        let mut chunks = Chunks::new(header, max_inflated);
        let first_idat = chunks.read(&mut reader)?;
        let expand = Expand::new(header, &chunks);
        let mut idat = Idat::new(reader, first_idat)?;
        Ok(Image {
            rgba: read_image(header, &expand, &mut idat)?,
            icc_profile: chunks.icc_profile,
        })
    }
}

/// What the chunks between IHDR and the first IDAT leave behind.
///
/// An ancillary chunk that breaks a rule is passed over. A critical one fails the decode. The rules are
/// libspng's, which are not always the specification's.
struct Chunks<'a> {
    header: Header,
    max_inflated: usize,
    /// A second PLTE replaces only as many entries as it has.
    palette: [[u8; 3]; 256],
    /// Of the last PLTE. 0: there was none.
    palette_len: usize,
    /// The data of a tRNS chunk of the right length for the color type.
    transparency: Option<&'a [u8]>,
    has_background: bool,
    has_histogram: bool,
    /// Also set by an iCCP chunk that was passed over.
    has_iccp: bool,
    has_exif: bool,
    icc_profile: Option<Vec<u8>>,
    /// The tEXt, zTXt, iTXt, sPLT and eXIf chunks, which libspng kept.
    stored: u32,
}

impl<'a> Chunks<'a> {
    fn new(header: Header, max_inflated: usize) -> Self {
        Self {
            header,
            max_inflated,
            palette: [[0; 3]; 256],
            palette_len: 0,
            transparency: None,
            has_background: false,
            has_histogram: false,
            has_iccp: false,
            has_exif: false,
            icc_profile: None,
            stored: 0,
        }
    }

    /// Leaves `reader` behind the header of the first IDAT and returns that chunk's length.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L2358
    fn read(&mut self, reader: &mut Reader<'a>) -> Result<usize> {
        loop {
            let (len, kind) = reader.next_header()?;
            if kind == chunk::IDAT {
                if self.header.color_type == ColorType::Indexed && self.palette_len == 0 {
                    return Err(Error::MissingPalette);
                }
                return Ok(len);
            }
            let data = reader.take(len)?;
            match kind {
                chunk::PLTE => self.palette(data)?,
                chunk::IHDR | chunk::IEND => return Err(Error::ChunkOutOfPlace),
                _ if chunk::is_critical(kind) => return Err(Error::UnknownCriticalChunk),
                chunk::TRNS => self.transparency(data),
                chunk::BKGD => self.background(data),
                chunk::HIST => self.histogram(data),
                chunk::ICCP => self.icc_profile(data)?,
                chunk::TEXT | chunk::ZTXT | chunk::ITXT => self.text(kind, data)?,
                chunk::SPLT => {
                    if !data.is_empty() {
                        self.count_stored()?;
                    }
                }
                chunk::EXIF => {
                    if !self.has_exif && !data.is_empty() {
                        self.has_exif = true;
                        self.count_stored()?;
                    }
                }
                _ => {}
            }
        }
    }

    fn palette(&mut self, data: &[u8]) -> Result<()> {
        if self.transparency.is_some() || self.has_histogram || self.has_background {
            return Err(Error::ChunkOutOfPlace);
        }
        let (entries, rest) = data.as_chunks::<3>();
        let max = match self.header.color_type {
            ColorType::Indexed => 1 << self.header.bit_depth,
            _ => 256,
        };
        if !rest.is_empty() || entries.is_empty() || entries.len() > max {
            return Err(Error::InvalidPalette);
        }
        for (to, from) in self.palette.iter_mut().zip(entries) {
            *to = *from;
        }
        self.palette_len = entries.len();
        Ok(())
    }

    fn transparency(&mut self, data: &'a [u8]) {
        let fits = match self.header.color_type {
            ColorType::Grayscale => data.len() == 2,
            ColorType::Truecolor => data.len() == 6,
            ColorType::Indexed => !data.is_empty() && data.len() <= self.palette_len,
            ColorType::GrayscaleAlpha | ColorType::TruecolorAlpha => false,
        };
        if fits && self.transparency.is_none() {
            self.transparency = Some(data);
        }
    }

    /// Only matters for PLTE, which may not follow it.
    fn background(&mut self, data: &[u8]) {
        self.has_background |= match self.header.color_type {
            ColorType::Grayscale | ColorType::GrayscaleAlpha => data.len() == 2,
            ColorType::Truecolor | ColorType::TruecolorAlpha => data.len() == 6,
            ColorType::Indexed => {
                matches!(data, &[index] if usize::from(index) < self.palette_len)
            }
        };
    }

    /// Only matters for PLTE, which may not follow it.
    fn histogram(&mut self, data: &[u8]) {
        self.has_histogram |= self.palette_len != 0 && data.len() / 2 == self.palette_len;
    }

    fn icc_profile(&mut self, data: &[u8]) -> Result<()> {
        if self.palette_len != 0 || self.has_iccp || data.is_empty() {
            return Ok(());
        }
        self.has_iccp = true;
        let name_field = data.get(..80).unwrap_or(data);
        let Some(name_len) = index_of_char_usize(name_field, 0) else {
            return Ok(());
        };
        let (name, rest) = data.split_at_checked(name_len).unwrap_or_default();
        // The name's terminator, then compression method 0.
        let (true, [0, 0, compressed @ ..]) = (is_keyword(name), rest) else {
            return Ok(());
        };
        self.icc_profile = inflate(compressed, self.max_inflated, Keep::Yes)?;
        Ok(())
    }

    /// Nothing is kept of the text, but libspng kept it, so one that inflates to too much fails the decode.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L2761
    fn text(&mut self, kind: Type, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        self.count_stored()?;
        // All the fields in front of the text have to be in here.
        let fields = data.get(..256).unwrap_or(data);
        let Some(keyword_len) = index_of_char_usize(data.get(..80).unwrap_or(data), 0) else {
            return Ok(());
        };
        let after_keyword = fields.get(keyword_len + 1..).unwrap_or_default();
        let fields_left = match (kind, after_keyword) {
            // Compression method 0 and at least a byte.
            (chunk::ZTXT, [0, compressed @ ..]) if !compressed.is_empty() => compressed.len(),
            // Compressed, compression method 0, a language tag, a translated keyword.
            (chunk::ITXT, [1, 0, tags @ ..]) if tags.len() >= 2 => {
                let Some(language_len) = index_of_char_usize(tags, 0) else {
                    return Ok(());
                };
                let translated = tags.get(language_len + 1..).unwrap_or_default();
                let Some(translated_len) = index_of_char_usize(translated, 0) else {
                    return Ok(());
                };
                translated.len() - translated_len - 1
            }
            _ => return Ok(()),
        };
        let compressed_at = fields.len() - fields_left;
        let compressed = data.get(compressed_at..).unwrap_or_default();
        // libspng put a terminator behind the text.
        let max = self.max_inflated.checked_sub(1).ok_or(Error::ChunkLimits)?;
        inflate(compressed, max, Keep::No)?;
        Ok(())
    }

    fn count_stored(&mut self) -> Result<()> {
        self.stored += 1;
        if self.stored > MAX_STORED_CHUNKS {
            return Err(Error::ChunkLimits);
        }
        Ok(())
    }
}

/// 1 to 79 printable Latin-1 characters. Spaces only inside, one at a time.
// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L2206
fn is_keyword(name: &[u8]) -> bool {
    let mut after_space = true;
    for &c in name {
        if !matches!(c, 32..=126 | 161..) || (c == b' ' && after_space) {
            return false;
        }
        after_space = c == b' ';
    }
    !after_space && name.len() <= 79
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Keep {
    Yes,
    No,
}

/// Inflates the zlib stream of an ancillary chunk. `None`: the stream is damaged, cut short, empty or not kept.
///
/// libspng inflated into a buffer of 8 KiB that it doubled when full, unless that made it larger than `max`.
/// So the limit on the output is the largest `8 KiB << n` that `max` allows.
///
/// Not the same for a `max` of 256 KiB or less: libspng gave zlib the first 81 or 256 bytes of the chunk apart
/// from the rest, and refused a stream whose output filled the last buffer before its end was in sight.
// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1244
fn inflate(mut input: &[u8], max: usize, keep: Keep) -> Result<Option<Vec<u8>>> {
    const INITIAL: usize = 8 * 1024;
    const DISCARDED_AT_ONCE: usize = 64 * 1024;

    let mut zlib = new_zlib()?;
    let mut out = Vec::new();
    let mut size = INITIAL;
    let mut total = 0usize;
    loop {
        let mut room = size - total;
        if keep == Keep::No {
            out.clear();
            room = room.min(DISCARDED_AT_ONCE);
        }
        let before = out.len();
        let (used, code) = zlib.step_limited(input, &mut out, room);
        input = input.get(used..).unwrap_or_default();
        let produced = out.len() - before;
        total += produced;
        match code {
            ReturnCode::StreamEnd => break,
            ReturnCode::Ok | ReturnCode::BufError => {}
            ReturnCode::MemError => return Err(Error::Alloc(bun_alloc::AllocError)),
            _ => return Ok(None),
        }
        if produced < room {
            if input.is_empty() || (used == 0 && produced == 0) {
                return Ok(None);
            }
        } else if total == size {
            if size > max / 2 {
                return Err(Error::ChunkLimits);
            }
            size *= 2;
        }
    }
    if total == 0 || keep == Keep::No {
        return Ok(None);
    }
    out.shrink_to_fit();
    Ok(Some(out))
}

fn new_zlib() -> Result<InflateDecoder> {
    let mut zlib = InflateDecoder::new(bun_zlib::MAX_WBITS)?;
    if zlib.set_validate(false) != ReturnCode::Ok {
        return Err(Error::Zlib);
    }
    Ok(zlib)
}

/// The zlib stream that the consecutive IDAT chunks hold between them.
struct Idat<'a> {
    reader: Reader<'a>,
    /// What zlib has not taken yet of the chunk `reader` is behind.
    input: &'a [u8],
    zlib: InflateDecoder,
}

impl<'a> Idat<'a> {
    /// `reader` is behind the header of the first IDAT, which announces `len` bytes.
    fn new(reader: Reader<'a>, len: usize) -> Result<Self> {
        let mut idat = Self {
            reader,
            input: &[],
            zlib: new_zlib()?,
        };
        idat.input = match len {
            0 => idat.next_chunk()?,
            _ => idat.reader.take(len)?,
        };
        Ok(idat)
    }

    /// The data of the next IDAT that has any. It has to be in the file whole, but its CRC does not.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1359
    fn next_chunk(&mut self) -> Result<&'a [u8]> {
        loop {
            let (len, kind) = self.reader.next_header()?;
            if kind != chunk::IDAT {
                return Err(Error::IdatTooShort);
            }
            if len != 0 {
                return self.reader.take(len);
            }
        }
    }

    /// Replaces `line` with the next `len` bytes of the stream. What the stream holds after the last line is never looked at.
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L1389
    fn read_line(&mut self, line: &mut Vec<u8>, len: usize) -> Result<()> {
        line.clear();
        while line.len() < len {
            let (used, code) = self.zlib.step_limited(self.input, line, len - line.len());
            self.input = self.input.get(used..).unwrap_or_default();
            match code {
                ReturnCode::Ok => {}
                ReturnCode::StreamEnd if line.len() < len => return Err(Error::IdatTooShort),
                ReturnCode::StreamEnd => {}
                ReturnCode::BufError => self.input = self.next_chunk()?,
                ReturnCode::MemError => return Err(Error::Alloc(bun_alloc::AllocError)),
                _ => return Err(Error::IdatStream),
            }
        }
        Ok(())
    }
}

/// How a row of the file becomes a row of RGBA.
struct Expand {
    layout: Layout,
    /// For `Layout::Lookup`: the color of each sample value.
    table: [Rgba; 256],
}

#[derive(Clone, Copy)]
enum Layout {
    Rgba8,
    Rgba16,
    /// The pixel that tRNS makes transparent, as it is in the file.
    Rgb8(Option<[u8; 3]>),
    Rgb16(Option<[u8; 6]>),
    Gray16(Option<[u8; 2]>),
    GrayAlpha8,
    GrayAlpha16,
    /// Palette indices or gray samples of so many bits, at most 8.
    Lookup(u8),
}

impl Expand {
    // https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L3878
    fn new(header: Header, chunks: &Chunks) -> Self {
        let mut table = [[0, 0, 0, 255]; 256];
        let transparency = chunks.transparency.unwrap_or_default();
        let layout = match (header.color_type, header.bit_depth) {
            (ColorType::TruecolorAlpha, 8) => Layout::Rgba8,
            (ColorType::TruecolorAlpha, _) => Layout::Rgba16,
            // Only the low byte of each 16-bit sample in tRNS counts.
            (ColorType::Truecolor, 8) => Layout::Rgb8(match *transparency {
                [_, r, _, g, _, b] => Some([r, g, b]),
                _ => None,
            }),
            (ColorType::Truecolor, _) => Layout::Rgb16(transparency.try_into().ok()),
            (ColorType::GrayscaleAlpha, 8) => Layout::GrayAlpha8,
            (ColorType::GrayscaleAlpha, _) => Layout::GrayAlpha16,
            (ColorType::Grayscale, 16) => Layout::Gray16(transparency.try_into().ok()),
            (ColorType::Grayscale, depth) => {
                // All 16 bits of the sample in tRNS count, so one too large for the depth matches nothing.
                let transparent = transparency.try_into().ok().map(u16::from_be_bytes);
                let max = u8::MAX >> (8 - depth);
                for (sample, color) in (0..=max).zip(&mut table) {
                    let gray = sample * (u8::MAX / max);
                    let alpha = if transparent == Some(u16::from(sample)) {
                        0
                    } else {
                        255
                    };
                    *color = [gray, gray, gray, alpha];
                }
                Layout::Lookup(depth)
            }
            (ColorType::Indexed, depth) => {
                for (color, &[r, g, b]) in table.iter_mut().zip(&chunks.palette) {
                    *color = [r, g, b, 255];
                }
                for ([.., alpha], transparency) in table.iter_mut().zip(transparency) {
                    *alpha = *transparency;
                }
                Layout::Lookup(depth)
            }
        };
        Self { layout, table }
    }

    fn color(&self, sample: u8) -> Rgba {
        self.table
            .get(usize::from(sample))
            .copied()
            .unwrap_or_default()
    }

    /// Whether `filter::undo()` alone gives RGBA, but for the pixels that `make_transparent()` changes.
    fn is_rgba(&self) -> bool {
        matches!(self.layout, Layout::Rgba8 | Layout::Rgb8(_))
    }

    fn make_transparent(&self, rgba: &mut [u8]) {
        if let Layout::Rgb8(Some(transparent)) = self.layout {
            for pixel in rgba.as_chunks_mut().0 {
                if let [r, g, b, _] = *pixel
                    && [r, g, b] == transparent
                {
                    *pixel = [r, g, b, 0];
                }
            }
        }
    }

    /// `row` is what `filter::undo()` gave. 16-bit samples lose their low byte.
    fn row(&self, row: &[u8], out: &mut [u8]) {
        fn alpha<const N: usize>(pixel: &[u8; N], transparent: Option<[u8; N]>) -> u8 {
            if transparent == Some(*pixel) { 0 } else { 255 }
        }
        let out = out.as_chunks_mut::<4>().0;
        match self.layout {
            Layout::Rgba8 | Layout::Rgb8(_) => {
                for (out, pixel) in out.iter_mut().zip(row.as_chunks().0) {
                    *out = *pixel;
                }
                self.make_transparent(out.as_flattened_mut());
            }
            Layout::Rgba16 => {
                for (out, &[r, _, g, _, b, _, a, _]) in out.iter_mut().zip(row.as_chunks().0) {
                    *out = [r, g, b, a];
                }
            }
            Layout::Rgb16(transparent) => {
                for (out, pixel) in out.iter_mut().zip(row.as_chunks().0) {
                    let [r, _, g, _, b, _] = *pixel;
                    *out = [r, g, b, alpha(pixel, transparent)];
                }
            }
            Layout::Gray16(transparent) => {
                for (out, pixel) in out.iter_mut().zip(row.as_chunks().0) {
                    let [gray, _] = *pixel;
                    *out = [gray, gray, gray, alpha(pixel, transparent)];
                }
            }
            Layout::GrayAlpha8 => {
                for (out, &[gray, a]) in out.iter_mut().zip(row.as_chunks().0) {
                    *out = [gray, gray, gray, a];
                }
            }
            Layout::GrayAlpha16 => {
                for (out, &[gray, _, a, _]) in out.iter_mut().zip(row.as_chunks().0) {
                    *out = [gray, gray, gray, a];
                }
            }
            Layout::Lookup(8) => {
                for (out, &sample) in out.iter_mut().zip(row) {
                    *out = self.color(sample);
                }
            }
            Layout::Lookup(4) => self.packed_row::<4>(row, out),
            Layout::Lookup(2) => self.packed_row::<2>(row, out),
            Layout::Lookup(_) => self.packed_row::<1>(row, out),
        }
    }

    /// Several samples of `DEPTH` bits to the byte, the leftmost in the high bits.
    fn packed_row<const DEPTH: usize>(&self, row: &[u8], out: &mut [Rgba]) {
        for (pixels, &byte) in out.chunks_mut(8 / DEPTH).zip(row) {
            for (pixel, end) in pixels.iter_mut().zip((DEPTH..=8).step_by(DEPTH)) {
                *pixel = self.color((byte >> (8 - end)) & (u8::MAX >> (8 - DEPTH)));
            }
        }
    }
}

// https://github.com/randy408/libspng/blob/fb768002d4288590083a476af628e51c3f1d47cd/spng/spng.c#L3618
fn read_image(header: Header, expand: &Expand, idat: &mut Idat) -> Result<Vec<u8>> {
    if header
        .passes()
        .any(|pass| u64::from(pass.width) * 4 > u64::from(u32::MAX))
    {
        return Err(Error::RowTooLong);
    }
    let stride = header.width as usize * 4;
    let size = stride
        .checked_mul(header.height as usize)
        .ok_or(Error::RowTooLong)?;
    let mut image: Vec<u8> = Vec::new();
    image.try_reserve_exact(size)?;

    // A filter byte, a filtered row, padding.
    let mut line: Vec<u8> = Vec::new();
    let longest = header.passes().map(|pass| pass.row_bytes).max();
    line.try_reserve_exact(
        longest
            .unwrap_or_default()
            .saturating_add(1 + filter::PADDING),
    )?;

    let bytes_per_pixel = header.bytes_per_pixel();
    let unfiltered_len = |pass: &Pass| match bytes_per_pixel {
        3 => pass.width as usize * 4,
        _ => pass.row_bytes,
    };
    let mut row: Vec<u8> = Vec::new();
    let mut row_above: Vec<u8> = Vec::new();
    let longest = header.passes().map(|pass| unfiltered_len(&pass)).max();
    row.try_reserve_exact(longest.unwrap_or_default())?;
    row_above.try_reserve_exact(longest.unwrap_or_default())?;

    let mut pass_rgba: Vec<u8> = Vec::new();
    if header.interlaced {
        pass_rgba.try_reserve_exact(stride)?;
    }

    for pass in header.passes() {
        for y in 0..pass.height as usize {
            idat.read_line(&mut line, pass.row_bytes + 1)?;
            line.extend_from_slice(&[0; filter::PADDING]);
            // Memory is written to only now that there is a row: a header can announce any size.
            if y == 0 {
                for unfiltered in [&mut row, &mut row_above] {
                    unfiltered.clear();
                    unfiltered.resize(unfiltered_len(&pass), 0);
                }
                if header.interlaced {
                    pass_rgba.resize(pass.width as usize * 4, 0);
                }
            }
            let Some((&filter, filtered)) = line.split_first() else {
                return Err(Error::IdatTooShort);
            };

            if header.interlaced {
                filter::undo(filter, bytes_per_pixel, filtered, &row_above, &mut row)?;
                expand.row(&row, &mut pass_rgba);
                let start = (pass.y_start + y * pass.y_step) * stride;
                // The first pass has a row in every eight, so the image is whole at the end of it.
                let reached = size.min(start + pass.y_step * stride);
                if image.len() < reached {
                    image.resize(reached, 0);
                }
                let image_row = image.get_mut(start..).unwrap_or_default();
                let pixels = image_row.as_chunks_mut::<4>().0.iter_mut();
                let places = pixels.take(header.width as usize).skip(pass.x_start);
                for (to, from) in places.step_by(pass.x_step).zip(pass_rgba.as_chunks().0) {
                    *to = *from;
                }
                core::mem::swap(&mut row, &mut row_above);
                continue;
            }

            let start = image.len();
            image.resize(start + stride, 0);
            let (done, image_row) = image.split_at_mut_checked(start).unwrap_or_default();
            if expand.is_rgba() {
                // Above the first row are the zeros of `row_above`.
                let above = start.checked_sub(stride).and_then(|at| done.get(at..));
                let above = above.unwrap_or(&row_above);
                filter::undo(filter, bytes_per_pixel, filtered, above, image_row)?;
                expand.make_transparent(image_row);
            } else {
                filter::undo(filter, bytes_per_pixel, filtered, &row_above, &mut row)?;
                expand.row(&row, image_row);
                core::mem::swap(&mut row, &mut row_above);
            }
        }
    }
    Ok(image)
}

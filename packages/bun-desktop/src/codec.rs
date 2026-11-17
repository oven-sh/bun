//! Image files. Bun has the codecs for PNG, JPEG and WebP. Containers, animations, GIF and BMP are read here.

use std::ffi::c_void;
use std::time::Duration;

use crate::abi_graphics as wire;
use crate::bun::{self, abi, host};

pub const MAX_SIDE: u32 = 32768;
pub const MAX_BYTES: usize = 512 << 20;

#[derive(Clone, Copy, PartialEq)]
pub enum Format {
    Png,
    Jpeg,
    WebP,
    Gif,
    Bmp,
    Ico,
}

impl Format {
    pub fn of(bytes: &[u8]) -> Option<Format> {
        Some(match bytes {
            [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', ..] => Format::Png,
            [0xff, 0xd8, 0xff, ..] => Format::Jpeg,
            [
                b'R',
                b'I',
                b'F',
                b'F',
                _,
                _,
                _,
                _,
                b'W',
                b'E',
                b'B',
                b'P',
                ..,
            ] => Format::WebP,
            [b'G', b'I', b'F', b'8', b'7' | b'9', b'a', ..] => Format::Gif,
            [b'B', b'M', ..] => Format::Bmp,
            [0, 0, 1 | 2, 0, ..] => Format::Ico,
            _ => return None,
        })
    }
}

/// Not premultiplied.
#[derive(Clone)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Rgba {
    fn blank(width: u32, height: u32) -> Option<Rgba> {
        fits(width, height).then(|| Rgba {
            width,
            height,
            data: vec![0; width as usize * height as usize * 4],
        })
    }

    fn pixels_mut(&mut self) -> &mut [[u8; 4]] {
        self.data.as_chunks_mut().0
    }

    /// Of the part of the rectangle that is inside.
    fn rows_mut(
        &mut self,
        [x, y, width, height]: [u32; 4],
    ) -> impl Iterator<Item = &mut [[u8; 4]]> {
        let (whole, [start, end]) = (
            self.width as usize,
            [x, x.saturating_add(width)].map(|it| it.min(self.width) as usize),
        );
        self.pixels_mut()
            .chunks_mut(whole)
            .skip(y as usize)
            .take(height as usize)
            .map(move |row| &mut row[start..end])
    }

    pub fn resized(&self, width: u32, height: u32) -> Option<Rgba> {
        let (pixels, size) = (self.data.as_ptr(), [self.width, self.height]);
        // SAFETY: `data` has all pixels.
        let data = bun::collect(|sink, context| unsafe {
            (host().resize_image)(pixels, &size, &[width, height], sink, context)
        })?;
        Some(Rgba {
            width,
            height,
            data,
        })
    }

    fn encode(&self, format: u8, effort: u8) -> Option<Vec<u8>> {
        let (pixels, size) = (self.data.as_ptr(), [self.width, self.height]);
        (self.data.len() == self.width as usize * self.height as usize * 4
            && !self.data.is_empty())
        .then_some(())?;
        // SAFETY: `data` has all pixels.
        bun::collect(|sink, context| unsafe {
            (host().encode_image)(pixels, &size, format, effort, sink, context)
        })
    }

    pub fn to_png(&self) -> Option<Vec<u8>> {
        self.encode(abi::FORMAT_PNG, 1)
    }

    /// Without the alpha channel.
    pub fn to_jpeg(&self, quality: u8) -> Option<Vec<u8>> {
        self.encode(abi::FORMAT_JPEG, quality)
    }

    fn oriented(self, orientation: u8) -> Rgba {
        if orientation < 2 {
            return self;
        }
        let (from, [w, h]) = (
            self.data.as_chunks::<4>().0,
            [self.width, self.height].map(|it| it as usize),
        );
        let (width, height) = if orientation > 4 { (h, w) } else { (w, h) };
        let pixel = |x: usize, y: usize| {
            let (x, y) = if orientation > 4 { (y, x) } else { (x, y) };
            let x = if matches!(orientation, 2 | 3 | 7 | 8) {
                w - 1 - x
            } else {
                x
            };
            let y = if matches!(orientation, 3 | 4 | 6 | 7) {
                h - 1 - y
            } else {
                y
            };
            from[y * w + x]
        };
        let data = (0..height)
            .flat_map(|y| (0..width).flat_map(move |x| pixel(x, y)))
            .collect();
        Rgba {
            width: width as u32,
            height: height as u32,
            data,
        }
    }
}

/// # Safety
/// As `Graphics::encode`.
pub unsafe fn encode(
    size: &[u32; 2],
    rgba: *const u8,
    format: wire::Format,
    quality: u8,
    sink: wire::Sink,
    context: *mut c_void,
) -> bool {
    let (format, effort) = match format {
        wire::Format::Png => (abi::FORMAT_PNG, 1),
        wire::Format::Jpeg => (abi::FORMAT_JPEG, quality),
        wire::Format::Webp => (abi::FORMAT_WEBP, 100),
    };
    // SAFETY: the caller's contract.
    unsafe { (host().encode_image)(rgba, size, format, effort, sink, context) }
}

fn fits(width: u32, height: u32) -> bool {
    (1..=MAX_SIDE).contains(&width)
        && (1..=MAX_SIDE).contains(&height)
        && width as usize * height as usize * 4 <= MAX_BYTES
}

fn little<const N: usize>(bytes: &[u8], at: usize) -> Option<u32> {
    Some(
        bytes
            .get(at..)?
            .first_chunk::<N>()?
            .iter()
            .rfold(0, |all, it| all << 8 | u32::from(*it)),
    )
}

fn big<const N: usize>(bytes: &[u8], at: usize) -> Option<u32> {
    Some(
        bytes
            .get(at..)?
            .first_chunk::<N>()?
            .iter()
            .fold(0, |all, it| all << 8 | u32::from(*it)),
    )
}

pub fn png_chunks(bytes: &[u8]) -> impl Iterator<Item = (&[u8; 4], &[u8])> {
    let mut rest = bytes.strip_prefix(b"\x89PNG\r\n\x1a\n").unwrap_or_default();
    std::iter::from_fn(move || {
        let (length, after) = rest.split_first_chunk()?;
        let (kind, after) = after.split_first_chunk()?;
        let (data, after) = after.split_at((u32::from_be_bytes(*length) as usize).min(after.len()));
        rest = after.get(4..).unwrap_or_default();
        Some((kind, data))
    })
}

fn riff_chunks(mut rest: &[u8]) -> impl Iterator<Item = (&[u8; 4], &[u8])> {
    std::iter::from_fn(move || {
        let (kind, after) = rest.split_first_chunk()?;
        let (data, after) = after
            .get(4..)?
            .split_at_checked(little::<4>(after, 0)? as usize)?;
        rest = after.get(data.len() % 2..).unwrap_or_default();
        Some((kind, data))
    })
}

fn jpeg_segments(bytes: &[u8]) -> impl Iterator<Item = (u8, &[u8])> {
    let mut rest = &bytes[2..];
    std::iter::from_fn(move || {
        let [0xff, marker @ (0xc0..=0xd9 | 0xdb..=0xfe), after @ ..] = rest else {
            return None;
        };
        let (segment, after) = after.split_at_checked(big::<2>(after, 0)? as usize)?;
        rest = after;
        Some((*marker, segment.get(2..)?))
    })
}

/// The ICC profile.
pub fn profile(bytes: &[u8]) -> Option<Vec<u8>> {
    match Format::of(bytes)? {
        Format::Png => {
            let chunk = png_chunks(bytes)
                .take_while(|it| it.0 != b"IDAT")
                .find(|it| it.0 == b"iCCP")?
                .1;
            let mut profile = vec![0; 1 << 16];
            let (_, length, _) = bun::Inflater::new()?.inflate(
                chunk.get(chunk.iter().position(|it| *it == 0)? + 2..)?,
                &mut profile,
            )?;
            profile.truncate(length);
            Some(profile)
        }
        Format::WebP => riff_chunks(&bytes[12..])
            .find(|it| it.0 == b"ICCP")
            .map(|it| it.1.to_vec()),
        Format::Jpeg => {
            let parts = jpeg_segments(bytes)
                .filter(|it| it.0 == 0xe2)
                .filter_map(|it| it.1.strip_prefix(b"ICC_PROFILE\0")?.get(2..));
            Some(parts.flatten().copied().collect())
        }
        _ => None,
    }
}

fn exif(bytes: &[u8]) -> Option<&[u8]> {
    match Format::of(bytes)? {
        Format::Png => png_chunks(bytes)
            .take_while(|it| it.0 != b"IDAT")
            .find(|it| it.0 == b"eXIf")
            .map(|it| it.1),
        Format::WebP => riff_chunks(&bytes[12..])
            .find(|it| it.0 == b"EXIF")
            .map(|it| it.1.strip_prefix(b"Exif\0\0").unwrap_or(it.1)),
        Format::Jpeg => jpeg_segments(bytes)
            .filter(|it| it.0 == 0xe1)
            .find_map(|it| it.1.strip_prefix(b"Exif\0\0")),
        _ => None,
    }
}

/// From 1 to 8.
pub fn orientation(bytes: &[u8]) -> u8 {
    let read = || {
        let tiff = exif(bytes)?;
        let short = |at| {
            if tiff.starts_with(b"II") {
                little::<2>(tiff, at)
            } else {
                big::<2>(tiff, at)
            }
        };
        let directory = if tiff.starts_with(b"II") {
            little::<4>(tiff, 4)
        } else {
            big::<4>(tiff, 4)
        }? as usize;
        let entry = (0..short(directory)? as usize)
            .map(|it| directory + 2 + it * 12)
            .find(|it| short(*it) == Some(0x112))?;
        short(entry + 8).filter(|it| (1..=8).contains(it))
    };
    read().unwrap_or(1) as u8
}

/// Of a PNG, JPEG or WebP file, as it is shown.
pub fn size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut size = [0; 2];
    // SAFETY: a live slice with its length.
    (unsafe { (host().image_size)(bytes.as_ptr(), bytes.len(), &mut size) }
        && fits(size[0], size[1]))
    .then_some(())?;
    Some(if orientation(bytes) > 4 {
        (size[1], size[0])
    } else {
        (size[0], size[1])
    })
}

pub fn is_animated(bytes: &[u8]) -> bool {
    match Format::of(bytes) {
        Some(Format::Png) => png_chunks(bytes)
            .take_while(|it| it.0 != b"IDAT")
            .any(|it| it.0 == b"acTL"),
        Some(Format::WebP) => {
            matches!(riff_chunks(&bytes[12..]).next(), Some((b"VP8X", [flags, ..])) if flags & 2 != 0)
        }
        format => format == Some(Format::Gif),
    }
}

fn decode_in_bun(bytes: &[u8], mut size: [u32; 2]) -> Option<Rgba> {
    let most = MAX_BYTES as u64 / 4;
    // SAFETY: a live slice with its length.
    let data = bun::collect(|sink, context| unsafe {
        (host().decode_image)(bytes.as_ptr(), bytes.len(), most, &mut size, sink, context)
    })?;
    Some(Rgba {
        width: size[0],
        height: size[1],
        data,
    })
    .filter(|it| fits(it.width, it.height))
}

/// The first frame. It may be smaller than the file says, but not than `least`, unless that is zero.
pub fn decode(bytes: &[u8], is_oriented: bool, least: (u32, u32)) -> Option<Rgba> {
    let orientation = if is_oriented { orientation(bytes) } else { 1 };
    let image = match Format::of(bytes)? {
        Format::Bmp => decode_dib(
            bytes.get(14..)?,
            (little::<4>(bytes, 10)? as usize).checked_sub(14),
            false,
        ),
        Format::Ico => decode_icon(bytes),
        format if format != Format::Png && is_animated(bytes) => {
            let mut first = None;
            frames(bytes, &mut |frame, _| {
                first.replace(frame.clone()).is_some()
            });
            first
        }
        _ => decode_in_bun(
            bytes,
            if orientation > 4 {
                [least.1, least.0]
            } else {
                [least.0, least.1]
            },
        ),
    };
    Some(image?.oriented(orientation))
}

fn decode_icon(bytes: &[u8]) -> Option<Rgba> {
    let entries = bytes
        .get(6..)?
        .as_chunks::<16>()
        .0
        .iter()
        .take(little::<2>(bytes, 4)? as usize);
    let side = |it: u8| u32::from(it.wrapping_sub(1)) + 1;
    let best = entries.max_by_key(|it| (side(it[0]) * side(it[1]), little::<2>(*it, 6)))?;
    let data = bytes.get(little::<4>(best, 12)? as usize..)?;
    let data = &data[..data.len().min(little::<4>(best, 8)? as usize)];
    if Format::of(data) == Some(Format::Png) {
        decode_in_bun(data, [0; 2])
    } else {
        decode_dib(data, None, true)
    }
}

/// What follows the header of a BMP file. In an icon, a mask comes after the pixels.
fn decode_dib(dib: &[u8], pixels_at: Option<usize>, is_icon: bool) -> Option<Rgba> {
    let header = little::<4>(dib, 0)? as usize;
    let (width, height, depth, compression, colors) = match header {
        12 => (
            little::<2>(dib, 4)?,
            little::<2>(dib, 6)? as i32,
            little::<2>(dib, 10)?,
            0,
            0,
        ),
        _ => (
            little::<4>(dib, 4)?,
            little::<4>(dib, 8)? as i32,
            little::<2>(dib, 14)?,
            little::<4>(dib, 16)?,
            little::<4>(dib, 32)?,
        ),
    };
    let mut image = Rgba::blank(width, height.unsigned_abs() >> u32::from(is_icon))?;
    let (columns, rows, has_masks) = (
        width as usize,
        image.height as usize,
        matches!(compression, 3 | 6),
    );
    let masks = match depth {
        _ if has_masks => [40, 44, 48, 52].map(|at| {
            little::<4>(dib, at)
                .filter(|_| at < 52 || header >= 56 || compression == 6)
                .unwrap_or(0)
        }),
        16 => [0x7c00, 0x3e0, 0x1f, 0],
        _ => [
            0xff_0000,
            0xff00,
            0xff,
            if depth == 32 { 0xff00_0000 } else { 0 },
        ],
    };
    let palette_at = header.checked_add(if has_masks && header == 40 {
        compression as usize / 3 * 4 + 8
    } else {
        0
    })?;
    let (entry, colors) = (
        if header == 12 { 3 } else { 4 },
        if colors == 0 && depth <= 8 {
            1 << depth
        } else {
            colors.min(256) as usize
        },
    );
    let color = |index: usize| match dib.get(palette_at + index * entry..) {
        Some([blue, green, red, ..]) if index < colors => [*red, *green, *blue, 255],
        _ => [0, 0, 0, 255],
    };
    let data = dib.get(pixels_at.unwrap_or(palette_at + colors * entry)..)?;
    let target = |row: usize| (if height < 0 { row } else { rows - 1 - row }) * columns;
    let pixels = image.pixels_mut();
    if matches!(compression, 1 | 2) {
        let (mut x, mut y, mut rest) = (0, 0, data);
        let index = |bytes: &[u8], at: usize| {
            if compression == 1 {
                bytes[at]
            } else {
                bytes[at / 2] >> (4 - at % 2 * 4) & 15
            }
        };
        while let ([count, value, after @ ..], true) = (rest, y < rows) {
            rest = after;
            let (run, literal) = match (*count, *value) {
                (0, 0) => {
                    (x, y) = (0, y + 1);
                    continue;
                }
                (0, 1) => break,
                (0, 2) => {
                    let (delta, after) = rest.split_first_chunk::<2>()?;
                    (x, y, rest) = (x + usize::from(delta[0]), y + usize::from(delta[1]), after);
                    continue;
                }
                (0, count) => {
                    let (literal, after) = rest.split_at_checked(
                        usize::from(count)
                            .div_ceil(compression as usize)
                            .next_multiple_of(2),
                    )?;
                    rest = after;
                    (count, Some(literal))
                }
                (count, _) => (count, None),
            };
            for at in 0..usize::from(run).min(columns.saturating_sub(x)) {
                let index = literal.map_or_else(
                    || index(&[*value], at % compression as usize),
                    |it| index(it, at),
                );
                pixels[target(y) + x + at] = color(index.into());
            }
            x += usize::from(run);
        }
        return Some(image);
    }
    matches!(depth, 1 | 2 | 4 | 8 | 16 | 24 | 32).then_some(())?;
    let (depth, stride) = (depth as usize, (columns * depth as usize).div_ceil(32) * 4);
    let channel = |value: u32, mask: u32| match mask.checked_shr(mask.trailing_zeros()) {
        Some(most) => {
            (u64::from((value & mask) >> mask.trailing_zeros()) * 255 + u64::from(most / 2))
                / u64::from(most)
        }
        None => 255,
    };
    for (y, row) in data.get(..stride * rows)?.chunks(stride).enumerate() {
        for (x, pixel) in pixels[target(y)..][..columns].iter_mut().enumerate() {
            *pixel = match depth {
                ..=8 => color(
                    usize::from(row[x * depth / 8]) >> (8 - depth - x * depth % 8)
                        & ((1 << depth) - 1),
                ),
                _ => {
                    let value = row[x * depth / 8..][..depth / 8]
                        .iter()
                        .rfold(0, |all, it| all << 8 | u32::from(*it));
                    masks.map(|mask| channel(value, mask) as u8)
                }
            };
        }
    }
    let has_alpha = masks[3] != 0 && pixels.iter().any(|it| it[3] != 0);
    if masks[3] != 0 && (!has_alpha || !is_icon && !has_masks) {
        pixels.iter_mut().for_each(|it| it[3] = 255);
    }
    if is_icon && !has_alpha {
        for (y, row) in data[stride * rows..]
            .chunks_exact(columns.div_ceil(32) * 4)
            .take(rows)
            .enumerate()
        {
            let hidden = pixels[target(y)..][..columns]
                .iter_mut()
                .enumerate()
                .filter(|(x, _)| row[x / 8] >> (7 - x % 8) & 1 != 0);
            hidden.for_each(|(_, pixel)| *pixel = [0; 4]);
        }
    }
    Some(image)
}

#[derive(Clone, Copy, PartialEq)]
enum Disposal {
    Keep,
    Clear,
    Restore,
}

/// Returns whether to go on.
type Take<'a> = &'a mut dyn FnMut(&Rgba, Duration) -> bool;

fn show(
    canvas: &mut Rgba,
    frame: &Rgba,
    [x, y]: [u32; 2],
    blends: bool,
    disposal: Disposal,
    delay: u64,
    take: Take,
) -> Option<()> {
    let (area, before) = (
        [x, y, frame.width, frame.height],
        (disposal == Disposal::Restore).then(|| canvas.data.clone()),
    );
    for (row, source) in canvas
        .rows_mut(area)
        .zip(frame.data.as_chunks::<4>().0.chunks(frame.width as usize))
    {
        for (below, above) in row.iter_mut().zip(source) {
            *below = match above[3] {
                0 if blends => *below,
                1..=254 if blends => {
                    let (over, under) = (
                        u32::from(above[3]) * 255,
                        u32::from(below[3]) * u32::from(255 - above[3]),
                    );
                    let mix = |it: usize| {
                        ((u32::from(above[it]) * over + u32::from(below[it]) * under)
                            / (over + under)) as u8
                    };
                    [mix(0), mix(1), mix(2), ((over + under + 127) / 255) as u8]
                }
                _ => *above,
            };
        }
    }
    take(canvas, Duration::from_millis(delay)).then_some(())?;
    match before {
        Some(before) => canvas.data = before,
        None if disposal == Disposal::Clear => {
            canvas.rows_mut(area).for_each(|row| row.fill([0; 4]))
        }
        None => {}
    }
    Some(())
}

/// The parts of all frames may be this large together, whatever the size of the image is.
const MAX_PIXELS_IN_FRAMES: usize = 1 << 27;

/// Each with how long it is shown, up to one that is broken.
pub fn frames(bytes: &[u8], take: Take) {
    match Format::of(bytes) {
        Some(Format::Png) => png_frames(bytes, take),
        Some(Format::WebP) => webp_frames(bytes, take),
        Some(Format::Gif) => gif_frames(bytes, take),
        _ => None,
    };
}

fn png_frames(bytes: &[u8], take: Take) -> Option<()> {
    let header = png_chunks(bytes).next()?.1;
    let mut canvas = Rgba::blank(big::<4>(header, 0)?, big::<4>(header, 4)?)?;
    let (mut control, mut data): (Option<&[u8]>, Vec<u8>) = (None, Vec::new());
    let shared: Vec<_> = png_chunks(bytes)
        .filter(|it| matches!(it.0, b"PLTE" | b"tRNS"))
        .take(2)
        .collect();
    let mut room = MAX_PIXELS_IN_FRAMES;
    for (kind, body) in png_chunks(bytes).chain([(b"IEND", &[][..])]) {
        match kind {
            b"IDAT" if control.is_some() => data.extend(body),
            b"fdAT" => data.extend(body.get(4..)?),
            b"fcTL" | b"IEND" => {
                let Some(control) =
                    std::mem::replace(&mut control, (kind == b"fcTL").then_some(body))
                else {
                    continue;
                };
                let (own_header, data) = (
                    [control.get(4..12)?, header.get(8..)?].concat(),
                    std::mem::take(&mut data),
                );
                let mut file = bytes[..8].to_vec();
                for (kind, body) in [(b"IHDR", &own_header[..])]
                    .into_iter()
                    .chain(shared.iter().copied())
                    .chain([(b"IDAT", &data[..]), (b"IEND", &[])])
                {
                    file.extend((body.len() as u32).to_be_bytes());
                    let start = file.len();
                    file.extend(kind.iter().chain(body));
                    file.extend(bun::crc32(&file[start..]).to_be_bytes());
                }
                let per_second = Some(big::<2>(control, 22)?)
                    .filter(|it| *it > 0)
                    .unwrap_or(100);
                let disposal = *[Disposal::Keep, Disposal::Clear, Disposal::Restore]
                    .get(usize::from(*control.get(24)?))?;
                let (at, delay) = (
                    [big::<4>(control, 12)?, big::<4>(control, 16)?],
                    big::<2>(control, 20)? * 1000 / per_second,
                );
                let frame = decode_in_bun(&file, [0; 2])?;
                show(
                    &mut canvas,
                    &frame,
                    at,
                    *control.get(25)? == 1,
                    disposal,
                    delay.into(),
                    take,
                )?;
                room = room.checked_sub(frame.data.len() / 4)?;
            }
            _ => {}
        }
    }
    Some(())
}

fn webp_frames(bytes: &[u8], take: Take) -> Option<()> {
    let header = riff_chunks(&bytes[12..]).next()?.1;
    let mut canvas = Rgba::blank(little::<3>(header, 4)? + 1, little::<3>(header, 7)? + 1)?;
    let mut room = MAX_PIXELS_IN_FRAMES;
    for (_, frame) in riff_chunks(&bytes[12..]).filter(|it| it.0 == b"ANMF") {
        let (fields, data) = frame.split_first_chunk::<16>()?;
        let extended = [b"VP8X\x0a\0\0\0\x10\0\0\0", &fields[6..12]].concat();
        let extended = if data.starts_with(b"ALPH") {
            &extended[..]
        } else {
            &[]
        };
        let size = (4 + extended.len() + data.len()) as u32;
        let file = [b"RIFF", &size.to_le_bytes()[..], b"WEBP", extended, data].concat();
        let disposal = if fields[15] & 1 != 0 {
            Disposal::Clear
        } else {
            Disposal::Keep
        };
        let at = [little::<3>(fields, 0)? * 2, little::<3>(fields, 3)? * 2];
        let frame = decode_in_bun(&file, [0; 2])?;
        show(
            &mut canvas,
            &frame,
            at,
            fields[15] & 2 == 0,
            disposal,
            little::<3>(fields, 12)?.into(),
            take,
        )?;
        room = room.checked_sub(frame.data.len() / 4)?;
    }
    Some(())
}

/// Up to the first error.
fn decode_lzw(data: &[u8], least_bits: u8, most: usize) -> Vec<u8> {
    let clear = 1usize << least_bits;
    // Each code stands for what was written before: where, and how much.
    let (mut known, mut out) = (
        Vec::<(usize, usize)>::with_capacity(4096),
        Vec::with_capacity(most),
    );
    let (mut bits, mut available, mut width, mut previous) = (0u32, 0, least_bits + 1, None);
    for byte in data {
        bits |= u32::from(*byte) << available;
        available += 8;
        while available >= width {
            let (code, start) = (bits as usize & ((1 << width) - 1), out.len());
            (bits, available) = (bits >> width, available - width);
            if code == clear {
                known.clear();
                (width, previous) = (least_bits + 1, None);
                continue;
            }
            if let Some((start, len)) = previous.filter(|_| clear + 2 + known.len() < 4096) {
                known.push((start, len + 1));
            }
            match code.checked_sub(clear + 2).map(|it| known.get(it)) {
                _ if code == clear + 1 || start >= most => return out,
                None => out.push(code as u8),
                Some(Some(&(from, len))) => (from..from + len).for_each(|it| out.push(out[it])),
                Some(None) => return out,
            }
            previous = Some((start, out.len() - start));
            if clear + 2 + known.len() + 1 > 1 << width && width < 12 {
                width += 1;
            }
        }
    }
    out
}

fn gif_frames(bytes: &[u8], take: Take) -> Option<()> {
    fn palette<'a>(flags: u8, rest: &mut &'a [u8]) -> Option<&'a [[u8; 3]]> {
        Some(
            rest.split_off(
                ..if flags & 0x80 != 0 {
                    6 << (flags & 7)
                } else {
                    0
                },
            )?
            .as_chunks()
            .0,
        )
    }
    fn blocks(rest: &mut &[u8]) -> Vec<u8> {
        let mut data = Vec::new();
        while let Some(&len @ 1..) = rest.split_off_first() {
            data.extend(
                rest.split_off(..usize::from(len).min(rest.len()))
                    .unwrap_or_default(),
            );
        }
        data
    }
    let (header, mut rest) = bytes.split_first_chunk::<13>()?;
    let (global, mut canvas, mut control) = (palette(header[10], &mut rest)?, None, [0; 4]);
    let mut room = MAX_PIXELS_IN_FRAMES;
    loop {
        match rest.split_off_first()? {
            b'!' => {
                let (label, data) = (*rest.split_off_first()?, blocks(&mut rest));
                control = data
                    .first_chunk()
                    .filter(|_| label == 0xf9)
                    .map_or(control, |it| *it);
            }
            b',' => {
                let fields = rest.split_off(..9)?;
                let [x, y, width, height] =
                    [0, 2, 4, 6].map(|at| little::<2>(fields, at).unwrap_or(0));
                let colors = Some(palette(fields[8], &mut rest)?)
                    .filter(|it| !it.is_empty())
                    .unwrap_or(global);
                let least_bits = rest
                    .split_off_first()
                    .copied()
                    .filter(|it| (1..12).contains(it))?;
                room = room.checked_sub(width as usize * height as usize)?;
                let mut frame = Rgba::blank(width, height)?;
                let indexes = decode_lzw(&blocks(&mut rest), least_bits, frame.data.len() / 4);
                let passes: &[(usize, usize)] = if fields[8] & 0x40 != 0 {
                    &[(0, 8), (4, 8), (2, 4), (1, 2)]
                } else {
                    &[(0, 1)]
                };
                let rows = passes
                    .iter()
                    .flat_map(|&(first, step)| (first..height as usize).step_by(step));
                for (row, indexes) in rows.zip(indexes.chunks(width as usize)) {
                    for (pixel, index) in frame.pixels_mut()[row * width as usize..]
                        .iter_mut()
                        .zip(indexes)
                    {
                        if let Some(&[red, green, blue]) = colors
                            .get(usize::from(*index))
                            .filter(|_| control[0] & 1 == 0 || *index != control[3])
                        {
                            *pixel = [red, green, blue, 255];
                        }
                    }
                }
                if canvas.is_none() {
                    canvas = Rgba::blank(
                        little::<2>(header, 6)?.max(x + width),
                        little::<2>(header, 8)?.max(y + height),
                    );
                }
                let disposal = match control[0] >> 2 & 7 {
                    2 => Disposal::Clear,
                    3 => Disposal::Restore,
                    _ => Disposal::Keep,
                };
                show(
                    canvas.as_mut()?,
                    &frame,
                    [x, y],
                    true,
                    disposal,
                    u64::from(little::<2>(&control, 1)?) * 10,
                    take,
                )?;
                control = [0; 4];
            }
            _ => return Some(()),
        }
    }
}

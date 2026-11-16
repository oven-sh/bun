//! WOFF and WOFF2 to SFNT. The input is untrusted.

use std::io::Read as _;

const MAX_SIZE: usize = 128 << 20;

#[derive(Clone)]
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let (taken, rest) = self.0.split_at_checked(count)?;
        self.0 = rest;
        Some(taken)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_be_bytes(self.take(2)?.try_into().ok()?))
    }

    fn i16(&mut self) -> Option<i16> {
        Some(self.u16()? as i16)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_be_bytes(self.take(4)?.try_into().ok()?))
    }

    fn base128(&mut self) -> Option<u32> {
        let mut value = 0u32;
        for index in 0..5 {
            let byte = self.u8()?;
            if (index == 0 && byte == 0x80) || value >> 25 != 0 {
                return None;
            }
            value = value << 7 | u32::from(byte & 0x7F);
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    fn u255(&mut self) -> Option<u16> {
        Some(match self.u8()? {
            253 => self.u16()?,
            254 => u16::from(self.u8()?) + 506,
            255 => u16::from(self.u8()?) + 253,
            byte => byte.into(),
        })
    }
}

type Tag = [u8; 4];

fn checksum(bytes: &[u8]) -> u32 {
    bytes.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

pub fn write_sfnt(flavor: u32, mut tables: Vec<(Tag, Vec<u8>)>) -> Option<Vec<u8>> {
    tables.sort_by_key(|(tag, _)| *tag);
    let count = u16::try_from(tables.len())
        .ok()
        .filter(|count| (1..4096).contains(count))?;
    let selector = count.ilog2() as u16;
    let range = 16 << selector;
    let mut font = flavor.to_be_bytes().to_vec();
    for field in [count, range, selector, count * 16 - range] {
        font.extend(field.to_be_bytes());
    }
    let mut offset = 12 + tables.len() * 16;
    for (tag, data) in &tables {
        font.extend(tag);
        for field in [checksum(data), offset as u32, data.len() as u32] {
            font.extend(field.to_be_bytes());
        }
        offset += data.len().next_multiple_of(4);
    }
    for (_, data) in &tables {
        font.extend(data);
        font.resize(font.len().next_multiple_of(4), 0);
    }
    Some(font)
}

fn inflate(stream: impl std::io::Read, size: usize) -> Option<Vec<u8>> {
    if size > MAX_SIZE {
        return None;
    }
    let mut output = Vec::with_capacity(size);
    stream.take(size as u64).read_to_end(&mut output).ok()?;
    (output.len() == size).then_some(output)
}

fn decode_woff(file: &[u8]) -> Option<Vec<u8>> {
    let mut header = Reader(file.get(4..)?);
    let flavor = header.u32()?;
    header.take(4)?;
    let count = header.u16()?;
    header.take(30)?;
    let mut total = 0;
    let tables = (0..count).map(|_| {
        let tag: Tag = header.take(4)?.try_into().ok()?;
        let (offset, stored) = (header.u32()? as usize, header.u32()? as usize);
        let size = header.u32()? as usize;
        header.take(4)?;
        total += size;
        let data = file
            .get(offset..offset.checked_add(stored)?)
            .filter(|_| total <= MAX_SIZE)?;
        match stored < size {
            true => Some((tag, inflate(flate2::read::ZlibDecoder::new(data), size)?)),
            false => Some((tag, data.to_vec())),
        }
    });
    write_sfnt(flavor, tables.collect::<Option<_>>()?)
}

const KNOWN_TAGS: [&Tag; 63] = [
    b"cmap", b"head", b"hhea", b"hmtx", b"maxp", b"name", b"OS/2", b"post", b"cvt ", b"fpgm",
    b"glyf", b"loca", b"prep", b"CFF ", b"VORG", b"EBDT", b"EBLC", b"gasp", b"hdmx", b"kern",
    b"LTSH", b"PCLT", b"VDMX", b"vhea", b"vmtx", b"BASE", b"GDEF", b"GPOS", b"GSUB", b"EBSC",
    b"JSTF", b"MATH", b"CBDT", b"CBLC", b"COLR", b"CPAL", b"SVG ", b"sbix", b"acnt", b"avar",
    b"bdat", b"bloc", b"bsln", b"cvar", b"fdsc", b"feat", b"fmtx", b"fvar", b"gvar", b"hsty",
    b"just", b"lcar", b"mort", b"morx", b"opbd", b"prop", b"trak", b"Zapf", b"Silf", b"Glat",
    b"Gloc", b"Feat", b"Sill",
];

struct Glyphs {
    glyf: Vec<u8>,
    loca: Vec<u8>,
    x_mins: Vec<i16>,
}

fn triplet(flag: u8, stream: &mut Reader) -> Option<(i32, i32)> {
    let flag = i32::from(flag & 0x7F);
    let signed = |bit: i32, value: i32| if bit & 1 != 0 { value } else { -value };
    let mut byte = || stream.u8().map(i32::from);
    Some(match flag {
        0..10 => (0, signed(flag, ((flag & 14) << 7) + byte()?)),
        10..20 => (signed(flag, (((flag - 10) & 14) << 7) + byte()?), 0),
        20..84 => {
            let (high, low) = (flag - 20, byte()?);
            let x = 1 + (high & 0x30) + (low >> 4);
            let y = 1 + ((high & 0x0C) << 2) + (low & 0x0F);
            (signed(flag, x), signed(flag >> 1, y))
        }
        84..120 => {
            let high = flag - 84;
            let x = 1 + ((high / 12) << 8) + byte()?;
            let y = 1 + (((high % 12) >> 2) << 8) + byte()?;
            (signed(flag, x), signed(flag >> 1, y))
        }
        120..124 => {
            let (a, b, c) = (byte()?, byte()?, byte()?);
            (
                signed(flag, (a << 4) + (b >> 4)),
                signed(flag >> 1, ((b & 0x0F) << 8) + c),
            )
        }
        _ => {
            let (a, b, c, d) = (byte()?, byte()?, byte()?, byte()?);
            (signed(flag, (a << 8) + b), signed(flag >> 1, (c << 8) + d))
        }
    })
}

fn write_points(points: &[(i32, i32, bool)], overlaps: bool, glyf: &mut Vec<u8>) {
    let (mut xs, mut ys) = (Vec::new(), Vec::new());
    for (index, &(dx, dy, on_curve)) in points.iter().enumerate() {
        let mut flag = u8::from(on_curve) | if overlaps && index == 0 { 0x40 } else { 0 };
        for (delta, short, same, output) in [(dx, 0x02, 0x10, &mut xs), (dy, 0x04, 0x20, &mut ys)] {
            if delta == 0 {
                flag |= same;
            } else if delta.abs() < 256 {
                flag |= short | if delta > 0 { same } else { 0 };
                output.push(delta.unsigned_abs() as u8);
            } else {
                output.extend((delta as i16).to_be_bytes());
            }
        }
        glyf.push(flag);
    }
    glyf.extend(xs);
    glyf.extend(ys);
}

fn composite_size(mut stream: Reader) -> Option<(usize, bool)> {
    let (before, mut has_instructions) = (stream.0.len(), false);
    loop {
        let flags = stream.u16()?;
        has_instructions |= flags & 0x100 != 0;
        let arguments = if flags & 1 != 0 { 4 } else { 2 };
        let scale = match flags {
            _ if flags & 0x08 != 0 => 2,
            _ if flags & 0x40 != 0 => 4,
            _ if flags & 0x80 != 0 => 8,
            _ => 0,
        };
        stream.take(2 + arguments + scale)?;
        if flags & 0x20 == 0 {
            return Some((before - stream.0.len(), has_instructions));
        }
    }
}

fn reconstruct_glyf(table: &[u8]) -> Option<Glyphs> {
    let mut header = Reader(table);
    header.u16()?;
    let options = header.u16()?;
    let (count, long_offsets) = (usize::from(header.u16()?), header.u16()? != 0);
    let mut sizes = [0; 7];
    for size in &mut sizes {
        *size = header.u32()? as usize;
    }
    let mut stream = |index: usize| header.take(sizes[index]).map(Reader);
    let (mut contours, mut point_counts, mut flags) = (stream(0)?, stream(1)?, stream(2)?);
    let (mut data, mut composites, mut boxes) = (stream(3)?, stream(4)?, stream(5)?);
    let mut instructions = stream(6)?;
    let overlaps = match options & 1 {
        0 => &[][..],
        _ => header.take(count.div_ceil(8))?,
    };
    let has_box = boxes.take(count.div_ceil(32) * 4)?;
    let bit = |bits: &[u8], index: usize| {
        bits.get(index / 8)
            .is_some_and(|byte| byte & (0x80 >> (index % 8)) != 0)
    };

    let mut output = Glyphs {
        glyf: Vec::new(),
        loca: Vec::new(),
        x_mins: Vec::with_capacity(count),
    };
    let mut points = Vec::new();
    for glyph in 0..=count {
        let glyf = &mut output.glyf;
        match long_offsets {
            true => output.loca.extend((glyf.len() as u32).to_be_bytes()),
            false => output
                .loca
                .extend(u16::try_from(glyf.len() / 2).ok()?.to_be_bytes()),
        }
        if glyph == count {
            break;
        }
        let contour_count = contours.i16()?;
        let explicit_box = match bit(has_box, glyph) {
            true => Some(boxes.take(8)?),
            false => None,
        };
        let start = glyf.len();
        if contour_count == 0 {
            output.x_mins.push(0);
            continue;
        }
        glyf.extend(contour_count.to_be_bytes());
        if contour_count < 0 {
            glyf.extend(explicit_box?);
            let (size, has_instructions) = composite_size(composites.clone())?;
            glyf.extend(composites.take(size)?);
            if has_instructions {
                let length = data.u255()?;
                glyf.extend(length.to_be_bytes());
                glyf.extend(instructions.take(length.into())?);
            }
        } else {
            let mut ends = Vec::with_capacity(contour_count as usize * 2);
            let mut total = 0u32;
            for _ in 0..contour_count {
                total += u32::from(point_counts.u255()?);
                ends.extend(u16::try_from(total.checked_sub(1)?).ok()?.to_be_bytes());
            }
            points.clear();
            let (mut x, mut y) = (0i32, 0i32);
            let mut bounds = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
            for &flag in flags.take(total as usize)? {
                let (dx, dy) = triplet(flag, &mut data)?;
                (x, y) = (x.checked_add(dx)?, y.checked_add(dy)?);
                bounds = [
                    bounds[0].min(x),
                    bounds[1].min(y),
                    bounds[2].max(x),
                    bounds[3].max(y),
                ];
                points.push((dx, dy, flag & 0x80 == 0));
            }
            match explicit_box {
                Some(explicit) => glyf.extend(explicit),
                None => glyf.extend(bounds.iter().flat_map(|side| (*side as i16).to_be_bytes())),
            }
            glyf.extend(ends);
            let length = data.u255()?;
            glyf.extend(length.to_be_bytes());
            glyf.extend(instructions.take(length.into())?);
            write_points(&points, bit(overlaps, glyph), glyf);
        }
        output
            .x_mins
            .push(i16::from_be_bytes([glyf[start + 2], glyf[start + 3]]));
        glyf.resize(glyf.len().next_multiple_of(4), 0);
        if glyf.len() > MAX_SIZE {
            return None;
        }
    }
    Some(output)
}

fn reconstruct_hmtx(table: &[u8], metric_count: usize, x_mins: &[i16]) -> Option<Vec<u8>> {
    let mut stream = Reader(table);
    let flags = stream.u8()?;
    let mut advances = Reader(stream.take(metric_count * 2)?);
    let mut output = Vec::new();
    for (glyph, x_min) in x_mins.iter().enumerate() {
        let omitted = if glyph < metric_count { 1 } else { 2 };
        if glyph < metric_count {
            output.extend(advances.take(2)?);
        }
        let bearing = if flags & omitted != 0 {
            *x_min
        } else {
            stream.i16()?
        };
        output.extend(bearing.to_be_bytes());
    }
    Some(output)
}

struct Entry {
    tag: Tag,
    transformed: bool,
    range: std::ops::Range<usize>,
}

fn decode_woff2(file: &[u8]) -> Option<Vec<u8>> {
    let mut header = Reader(file.get(4..)?);
    let mut flavor = header.u32()?;
    header.take(4)?;
    let count = header.u16()?;
    header.take(6)?;
    let compressed_size = header.u32()? as usize;
    header.take(24)?;

    let mut entries = Vec::new();
    let mut offset = 0usize;
    for _ in 0..count {
        let flags = header.u8()?;
        let tag: Tag = match KNOWN_TAGS.get(usize::from(flags & 63)) {
            Some(tag) => **tag,
            None => header.take(4)?.try_into().ok()?,
        };
        let untransformed_version = if matches!(&tag, b"glyf" | b"loca") {
            3
        } else {
            0
        };
        let transformed = flags >> 6 != untransformed_version;
        let size = header.base128()?;
        let size = if transformed { header.base128()? } else { size };
        let end = offset.checked_add(size as usize)?;
        entries.push(Entry {
            tag,
            transformed,
            range: offset..end,
        });
        offset = end;
    }

    // `src: url()` names the first font of a collection.
    let mut indices: Vec<usize> = (0..entries.len()).collect();
    if flavor == u32::from_be_bytes(*b"ttcf") {
        header.u32()?;
        for font in 0..header.u255()? {
            let table_count = header.u255()?;
            let font_flavor = header.u32()?;
            let font_indices = (0..table_count).map(|_| header.u255().map(usize::from));
            let font_indices = font_indices.collect::<Option<Vec<_>>>()?;
            if font == 0 {
                (flavor, indices) = (font_flavor, font_indices);
            }
        }
    }

    let stream = brotli_decompressor::Decompressor::new(header.take(compressed_size)?, 4096);
    let data = inflate(stream, offset)?;
    let entries = indices.into_iter().map(|index| entries.get(index));
    let entries = entries.collect::<Option<Vec<_>>>()?;
    let find = |tag: &Tag| entries.iter().find(|entry| entry.tag == *tag);

    let mut glyphs = match find(b"glyf") {
        Some(entry) if entry.transformed => Some(reconstruct_glyf(&data[entry.range.clone()])?),
        _ => None,
    };
    let tables = entries.iter().map(|entry| {
        let table = &data[entry.range.clone()];
        let table = match &entry.tag {
            _ if !entry.transformed => table.to_vec(),
            b"glyf" => std::mem::take(&mut glyphs.as_mut()?.glyf),
            b"loca" => std::mem::take(&mut glyphs.as_mut()?.loca),
            b"hmtx" => {
                let metric_count = Reader(data[find(b"hhea")?.range.clone()].get(34..)?).u16()?;
                reconstruct_hmtx(table, metric_count.into(), &glyphs.as_ref()?.x_mins)?
            }
            _ => return None,
        };
        Some((entry.tag, table))
    });
    write_sfnt(flavor, tables.collect::<Option<_>>()?)
}

pub fn is_compressed(file: &[u8]) -> bool {
    file.starts_with(b"wOFF") || file.starts_with(b"wOF2")
}

pub fn decode(file: &[u8]) -> Option<Vec<u8>> {
    if file.starts_with(b"wOFF") {
        decode_woff(file)
    } else {
        decode_woff2(file)
    }
}

#[cfg(test)]
mod tests {
    use skrifa::instance::{LocationRef, Size};
    use skrifa::outline::{DrawSettings, pen::PathElement};
    use skrifa::{FontRef, MetadataProvider as _};

    const TTF: &[u8] = include_bytes!("../../fixtures/space-mono-subset.ttf");
    const WOFF: &[u8] = include_bytes!("../../fixtures/space-mono-subset.woff");
    const WOFF2: &[u8] = include_bytes!("../../fixtures/space-mono-subset.woff2");

    fn glyphs(data: &[u8]) -> Vec<(Vec<PathElement>, Option<f32>, Option<f32>)> {
        let font = FontRef::new(data).unwrap();
        let metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
        let glyphs = font.outline_glyphs().iter().map(|(id, glyph)| {
            let mut path = Vec::new();
            glyph
                .draw(
                    DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                    &mut path,
                )
                .unwrap();
            (
                path,
                metrics.advance_width(id),
                metrics.left_side_bearing(id),
            )
        });
        glyphs.collect()
    }

    #[test]
    fn has_the_glyphs_of_the_original() {
        assert!(glyphs(TTF).len() > 8);
        for packed in [WOFF, WOFF2] {
            assert_eq!(glyphs(&super::decode(packed).unwrap()), glyphs(TTF));
        }
    }

    #[test]
    fn survives_damage() {
        for packed in [WOFF, WOFF2] {
            for length in 0..packed.len() {
                super::decode(&packed[..length]);
            }
            for index in 0..packed.len() {
                let mut damaged = packed.to_vec();
                damaged[index] ^= 0xFF;
                super::decode(&damaged);
            }
        }
    }

    /// `WOFF2_PAIRS` names a directory with `x.woff2` and what another decoder made of it, `x.ttf`.
    #[test]
    #[ignore]
    fn agrees_with_another_decoder() {
        for entry in std::fs::read_dir(std::env::var("WOFF2_PAIRS").unwrap()).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().unwrap() == "woff2" {
                let expected = std::fs::read(path.with_extension("ttf")).unwrap();
                let decoded = super::decode(&std::fs::read(&path).unwrap()).unwrap();
                assert!(glyphs(&decoded) == glyphs(&expected), "{path:?}");
            }
        }
    }
}

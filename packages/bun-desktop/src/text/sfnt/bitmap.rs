//! Glyphs that are pictures: `sbix` and `CBDT`.

use super::{Data, Font};
use crate::abi::Rect;

pub enum Pixels {
    Png(&'static [u8]),
    /// Premultiplied.
    Bgra(&'static [u8]),
}

pub struct Bitmap {
    pub pixels: Pixels,
    pub size: [u32; 2],
    /// In ems, with y down.
    pub bounds: Rect,
    /// In ems.
    pub advance: Option<f32>,
}

/// The smallest of the strikes that are large enough, or else the largest.
fn best<T>(strikes: impl Iterator<Item = (f32, T)>, size: f32) -> Option<T> {
    let is_better = |it: f32, than: f32| {
        if than < size {
            it > than
        } else {
            it >= size && it < than
        }
    };
    strikes
        .reduce(|best, it| if is_better(it.0, best.0) { it } else { best })
        .map(|it| it.1)
}

fn from_sbix(font: &Font, glyph: u32, size: f32) -> Option<Bitmap> {
    let table = font.table(b"sbix")?;
    let find = |strike: Data, glyph: u32| {
        let start =
            strike.u32(4 + Some(glyph).filter(|it| *it < font.glyph_count)? as usize * 4)? as usize;
        strike.part(
            start,
            (strike.u32(8 + glyph as usize * 4)? as usize)
                .checked_sub(start)
                .filter(|it| *it > 8)?,
        )
    };
    let strikes = (0..table.u32(4)?.min(256) as usize).filter_map(|it| table.at32(8 + it * 4));
    let strike = best(
        strikes.filter_map(|it| {
            Some((f32::from(it.u16(0)?), it)).filter(|_| find(it, glyph).is_some())
        }),
        size,
    )?;
    let data = find(strike, glyph)?;
    let data = if data.tag(4)? == *b"dupe" {
        find(strike, data.u16(8)?.into())?
    } else {
        data
    };
    let (png, per_em, em) = (
        data.from(8).filter(|_| data.tag(4) == Some(*b"png "))?,
        f32::from(strike.u16(0)?),
        f32::from(font.units_per_em),
    );
    let (size, outline) = (
        [png.u32(16)?, png.u32(20)?],
        font.bounds(glyph, &[]).unwrap_or_default(),
    );
    let (width, height) = (size[0] as f32 / per_em, size[1] as f32 / per_em);
    let x = f32::from(font.horizontal.bearing(glyph).unwrap_or(0)) / em
        + f32::from(data.i16(0)?) / per_em;
    let bounds = Rect {
        x,
        y: -outline.y / em - f32::from(data.i16(2)?) / per_em - height,
        width,
        height,
    };
    Some(Bitmap {
        pixels: Pixels::Png(png.0),
        size,
        bounds,
        advance: None,
    })
}

fn from_cbdt(font: &Font, glyph: u32, size: f32) -> Option<Bitmap> {
    let (index, images) = (font.table(b"CBLC")?, font.table(b"CBDT")?);
    let locate = |strike: Data| {
        let list = index.from(strike.u32(0)? as usize)?;
        let records =
            (0..strike.u32(8)?.min(0x1_0000) as usize).map_while(|it| list.part(it * 8, 8));
        let record = { records }.find(|it| {
            it.u16(0).map(u32::from) <= Some(glyph) && Some(glyph) <= it.u16(2).map(u32::from)
        })?;
        let (table, position) = (
            list.from(record.u32(4)? as usize)?,
            (glyph - u32::from(record.u16(0)?)) as usize,
        );
        let listed = |count: usize, start: usize, step: usize| {
            (0..count.min(0x1_0000))
                .find(|it| table.u16(start + it * step).map(u32::from) == Some(glyph))
        };
        let (start, end, metrics) = match table.u16(0)? {
            1 => (
                table.u32(8 + position * 4)? as usize,
                table.u32(12 + position * 4)? as usize,
                None,
            ),
            3 => (
                table.u16(8 + position * 2)?.into(),
                table.u16(10 + position * 2)?.into(),
                None,
            ),
            4 => {
                let pair = 12 + listed(table.u32(8)? as usize, 12, 4)? * 4;
                (
                    table.u16(pair + 2)?.into(),
                    table.u16(pair + 6)?.into(),
                    None,
                )
            }
            format => {
                let (position, size) = (
                    if format == 2 {
                        position
                    } else {
                        listed(table.u32(20)? as usize, 24, 2)?
                    },
                    table.u32(8)? as usize,
                );
                (position * size, (position + 1) * size, table.from(12))
            }
        };
        let data = images
            .from(table.u32(4)? as usize)?
            .part(start, end.checked_sub(start).filter(|it| *it > 0)?)?;
        Some((table.u16(2)?, data, metrics))
    };
    let strikes = (0..index.u32(4)?.min(256) as usize).filter_map(|it| index.from(8 + it * 48));
    let (strike, (format, data, metrics)) = best(
        strikes.filter_map(|it| Some((f32::from(it.u8(45)?), (it, locate(it)?)))),
        size,
    )?;
    let (metrics, start) = match format {
        1 | 2 | 17 => (data, 5),
        6 | 7 | 18 => (data, 8),
        _ => (metrics?, 0),
    };
    let ([height, width, left, top, advance], [x, y]) =
        (metrics.array(0)?, strike.array(44)?.map(f32::from));
    let pixels = match format {
        17..=19 => Pixels::Png(data.part(start + 4, data.u32(start)? as usize)?.0),
        _ => Pixels::Bgra(
            data.part(start, usize::from(width) * usize::from(height) * 4)
                .filter(|_| strike.u8(46) == Some(32))?
                .0,
        ),
    };
    let bounds = Rect {
        x: f32::from(left as i8) / x,
        y: -f32::from(top as i8) / y,
        width: f32::from(width) / x,
        height: f32::from(height) / y,
    };
    Some(Bitmap {
        pixels,
        size: [width.into(), height.into()],
        bounds,
        advance: Some(f32::from(advance) / x),
    })
}

pub fn find(font: &Font, glyph: u32, size: f32) -> Option<Bitmap> {
    from_sbix(font, glyph, size).or_else(|| from_cbdt(font, glyph, size))
}

//! Reads OpenType fonts, which are untrusted.
//!
//! Rounding and fallbacks follow skrifa. Copyright (c) 2019 Fontations Developers. MIT, see `licenses/fontations.txt`.

pub mod bitmap;
mod cff;
pub mod color;
mod glyf;
pub mod memo;
pub mod variations;
pub mod work;

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU16, AtomicUsize, Ordering::Relaxed};

use crate::abi::Rect;
use crate::gfx::{self, Path};
#[cfg(not(target_os = "macos"))]
pub use glyf::Shape;
use variations::{Coords, Deltas};

pub type Tag = [u8; 4];

/// A table or a part of it. What is outside reads as `None`.
#[derive(Clone, Copy, Default)]
pub struct Data(pub &'static [u8]);

impl Data {
    fn array<const N: usize>(self, at: usize) -> Option<[u8; N]> {
        self.0.get(at..)?.first_chunk().copied()
    }

    pub fn u8(self, at: usize) -> Option<u8> {
        self.0.get(at).copied()
    }

    pub fn u16(self, at: usize) -> Option<u16> {
        self.array(at).map(u16::from_be_bytes)
    }

    pub fn i16(self, at: usize) -> Option<i16> {
        self.array(at).map(i16::from_be_bytes)
    }

    pub fn u24(self, at: usize) -> Option<u32> {
        self.array(at)
            .map(|[a, b, c]| u32::from_be_bytes([0, a, b, c]))
    }

    pub fn u32(self, at: usize) -> Option<u32> {
        self.array(at).map(u32::from_be_bytes)
    }

    pub fn tag(self, at: usize) -> Option<Tag> {
        self.array(at)
    }

    pub fn fixed(self, at: usize) -> Option<f32> {
        Some(self.u32(at)? as i32 as f32 / 65536.)
    }

    pub fn from(self, at: usize) -> Option<Data> {
        self.0.get(at..).map(Data)
    }

    pub fn part(self, at: usize, len: usize) -> Option<Data> {
        self.0.get(at..)?.get(..len).map(Data)
    }

    /// Follows the 16-bit offset that is stored `at`, unless it is null.
    pub fn at16(self, at: usize) -> Option<Data> {
        self.from(self.u16(at).filter(|it| *it != 0)?.into())
    }

    pub fn at24(self, at: usize) -> Option<Data> {
        self.from(self.u24(at).filter(|it| *it != 0)? as usize)
    }

    pub fn at32(self, at: usize) -> Option<Data> {
        self.from(self.u32(at).filter(|it| *it != 0)? as usize)
    }

    /// As many as there are of the `count` numbers.
    pub fn u16s(
        self,
        at: usize,
        count: usize,
    ) -> impl DoubleEndedIterator<Item = u16> + ExactSizeIterator + Clone {
        let all = self.0.get(at..).unwrap_or_default().as_chunks().0;
        all[..count.min(all.len())]
            .iter()
            .map(|it| u16::from_be_bytes(*it))
    }

    /// The first of `count` records for which `is_before` is false.
    pub fn partition(count: usize, is_before: impl Fn(usize) -> bool) -> usize {
        let (mut low, mut high) = (0, count);
        while low < high {
            let middle = low.midpoint(high);
            if is_before(middle) {
                low = middle + 1
            } else {
                high = middle
            }
        }
        low
    }
}

#[derive(Clone, Copy, Default)]
struct Charmap {
    table: Data,
    is_symbol: bool,
    is_mac_roman: bool,
    selectors: Option<Data>,
    known: Option<&'static Known>,
}

/// The glyphs of the characters that have been asked about, in pages of the first plane. There is none where there are no glyphs.
type Known = [OnceLock<Page>; 256];
type Page = Option<Box<[AtomicU16; 256]>>;

/// Whether so many bytes are left of what all fonts may take for that.
fn may_remember(bytes: usize) -> bool {
    static LEFT: AtomicUsize = AtomicUsize::new(8 << 20);
    LEFT.try_update(Relaxed, Relaxed, |it| it.checked_sub(bytes))
        .is_ok()
}

const WORK_PER_GLYPH: usize = 1 << 21;

const MAC_ROMAN: &str = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u{a0}ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\u{f8ff}ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

impl Charmap {
    fn new(cmap: Data) -> Option<Charmap> {
        const PREFERRED: [(u16, u16); 10] = [
            (3, 0),
            (3, 10),
            (0, 6),
            (0, 4),
            (3, 1),
            (0, 3),
            (0, 2),
            (0, 1),
            (0, 0),
            (1, 0),
        ];
        let find = |wanted: (u16, u16), formats: &[u16]| {
            let mut records = (0..usize::from(cmap.u16(2)?)).map(|it| 4 + it * 8);
            let record = records.find(|it| cmap.u16(*it).zip(cmap.u16(it + 2)) == Some(wanted))?;
            cmap.at32(record + 4)
                .filter(|it| it.u16(0).is_some_and(|it| formats.contains(&it)))
        };
        let (id, table) = PREFERRED
            .iter()
            .find_map(|it| Some((*it, find(*it, &[0, 4, 6, 10, 12, 13])?)))?;
        Some(Charmap {
            table,
            is_symbol: id == (3, 0),
            is_mac_roman: id == (1, 0),
            selectors: find((0, 5), &[14]),
            known: None,
        })
    }

    fn look_up(&self, code: u32) -> Option<u32> {
        let table = self.table;
        match table.u16(0)? {
            0 => table
                .u8(6 + Some(code).filter(|it| *it < 256)? as usize)
                .map(u32::from),
            4 => {
                let (code, count) = (u16::try_from(code).ok()?, usize::from(table.u16(6)? / 2));
                let segment = Data::partition(count, |it| {
                    table.u16(14 + it * 2).is_some_and(|end| end < code)
                });
                let [start, delta, offset] =
                    [1, 2, 3].map(|array| 16 + (count * array + segment) * 2);
                let index = code.checked_sub(table.u16(start).filter(|_| segment < count)?)?;
                let glyph = match table.u16(offset)? {
                    0 => code,
                    0xffff => return None,
                    by => table
                        .u16(offset + usize::from(by) + usize::from(index) * 2)
                        .filter(|it| *it != 0)?,
                };
                Some(glyph.wrapping_add(table.u16(delta)?).into())
            }
            6 => {
                let index = code
                    .checked_sub(table.u16(6)?.into())
                    .filter(|it| Some(*it) < table.u16(8).map(u32::from))?;
                table.u16(10 + index as usize * 2).map(u32::from)
            }
            10 => table
                .u16(
                    20 + code
                        .checked_sub(table.u32(12)?)
                        .filter(|it| Some(*it) < table.u32(16))? as usize
                        * 2,
                )
                .map(u32::from),
            format => {
                let count = table.u32(12)? as usize;
                let index = Data::partition(count, |it| {
                    table.u32(20 + it * 12).is_some_and(|end| end < code)
                });
                let group = table.from(16 + Some(index).filter(|it| *it < count)? * 12)?;
                let offset = code.checked_sub(group.u32(0)?)?;
                group
                    .u32(8)?
                    .checked_add(if format == 12 { offset } else { 0 })
            }
        }
    }

    fn may_have(&self, [first, last]: [u32; 2]) -> bool {
        let table = self.table;
        let start = || match table.u16(0)? {
            4 => {
                let count = usize::from(table.u16(6)? / 2);
                let segment = Data::partition(count, |it| {
                    table
                        .u16(14 + it * 2)
                        .is_some_and(|end| u32::from(end) < first)
                });
                table
                    .u16(16 + (count + segment) * 2)
                    .filter(|_| segment < count)
                    .map(u32::from)
            }
            12 | 13 => {
                let count = table.u32(12)? as usize;
                let index = Data::partition(count, |it| {
                    table.u32(20 + it * 12).is_some_and(|end| end < first)
                });
                table.u32(16 + Some(index).filter(|it| *it < count)? * 12)
            }
            _ => Some(0),
        };
        start().is_some_and(|it| it <= last)
    }

    #[cold]
    fn new_page(&self, place: &'static OnceLock<Page>, character: u32) -> Option<&'static Page> {
        let is_empty = !self.may_have([character & !255, character | 255]);
        (is_empty || may_remember(512)).then(|| {
            place.get_or_init(|| (!is_empty).then(|| Box::new([const { AtomicU16::new(0) }; 256])))
        })
    }

    fn map(&self, code: u32) -> Option<u32> {
        let code = match self.is_mac_roman && code >= 0x80 {
            true => MAC_ROMAN.chars().position(|it| u32::from(it) == code)? as u32 + 0x80,
            false => code,
        };
        let found = self.look_up(code).filter(|it| *it != 0);
        found.or_else(|| {
            self.look_up(0xf000 + Some(code).filter(|it| self.is_symbol && *it < 0x100)?)
                .filter(|it| *it != 0)
        })
    }

    fn map_variant(&self, code: u32, selector: u32) -> Option<u32> {
        let table = self.selectors?;
        let record = (0..table.u32(6)? as usize)
            .map(|it| 10 + it * 11)
            .take(300)
            .find(|it| table.u24(*it) == Some(selector))?;
        let last_from = |list: Data, size: usize| {
            let after = Data::partition(list.u32(0)? as usize, |it| {
                list.u24(4 + it * size).is_some_and(|it| it <= code)
            });
            list.from(4 + after.checked_sub(1)? * size)
        };
        let range = table.at32(record + 3).and_then(|it| last_from(it, 4));
        if range.is_some_and(|it| {
            it.u24(0)
                .zip(it.u8(3))
                .is_some_and(|(start, more)| code - start <= more.into())
        }) {
            return self.map(code);
        }
        last_from(table.at32(record + 7)?, 5)
            .filter(|it| it.u24(0) == Some(code))?
            .u16(3)
            .map(u32::from)
    }
}

/// `hmtx` or `vmtx`
#[derive(Clone, Copy, Default)]
struct Advances {
    table: Data,
    count: usize,
    deltas: Option<Data>,
}

impl Advances {
    fn advance(&self, glyph: u32) -> Option<u16> {
        self.table
            .u16((glyph as usize).min(self.count.checked_sub(1)?) * 4)
    }

    fn bearing(&self, glyph: u32) -> Option<i16> {
        match (glyph as usize).checked_sub(self.count) {
            Some(more) => self.table.i16(self.count * 4 + more * 2),
            None => self.table.i16(glyph as usize * 4 + 2),
        }
    }

    /// `map` is where the offset of the index map is.
    fn delta(&self, map: usize, glyph: u32, coords: &Coords) -> Option<f32> {
        let table = self.deltas?;
        let map = table.at32(map);
        Deltas {
            store: table.at32(4)?,
            map,
        }
        .get(glyph, coords)
    }
}

#[derive(Clone, Copy)]
enum Outlines {
    Glyf(glyf::Glyf),
    Cff(cff::Cff),
    None,
}

/// In font units.
#[derive(Clone, Copy, Default)]
pub struct Metrics {
    pub ascent: f32,
    /// Negative.
    pub descent: f32,
    pub leading: f32,
    pub x_height: Option<f32>,
    pub cap_height: Option<f32>,
    pub average_width: Option<f32>,
    /// The offset and the thickness.
    pub underline: Option<(f32, f32)>,
    pub widest: f32,
}

#[derive(Clone, Copy)]
pub struct Font {
    file: Data,
    directory: Data,
    pub units_per_em: u16,
    pub glyph_count: u32,
    charmap: Option<Charmap>,
    horizontal: Advances,
    vertical: Advances,
    outlines: Outlines,
}

pub const FAMILY_NAME: u16 = 1;
#[cfg(target_os = "macos")]
pub const POSTSCRIPT_NAME: u16 = 6;

impl Font {
    pub fn count(file: &'static [u8]) -> Option<u32> {
        file.starts_with(b"ttcf").then(|| Data(file).u32(8))?
    }

    pub fn is_font(file: &[u8]) -> bool {
        let tables = file
            .get(4..6)
            .map_or(0, |it| usize::from(it[0]) << 8 | usize::from(it[1]));
        matches!(
            file.first_chunk(),
            Some([0, 1, 0, 0] | b"OTTO" | b"true" | b"ttcf")
        ) && file.len() >= 12 + tables * 16
    }

    pub fn new(file: &'static [u8], index: u32) -> Option<Font> {
        let file = Data(file);
        let directory = match Font::count(file.0) {
            Some(count) => file.at32(12 + Some(index).filter(|it| *it < count)? as usize * 4)?,
            None => (index == 0).then_some(file)?,
        };
        matches!(&directory.tag(0)?, [0, 1, 0, 0] | b"OTTO" | b"true").then_some(())?;
        directory.part(12, usize::from(directory.u16(4)?) * 16)?;
        let (horizontal, vertical, outlines) =
            (Advances::default(), Advances::default(), Outlines::None);
        let mut font = Font {
            file,
            directory,
            units_per_em: 0,
            glyph_count: 0,
            charmap: None,
            horizontal,
            vertical,
            outlines,
        };
        let advances = |header, table, deltas| Advances {
            table: font.table(table).unwrap_or_default(),
            count: font
                .table(header)
                .and_then(|it| it.u16(34))
                .unwrap_or(0)
                .into(),
            deltas: font.table(deltas),
        };
        (font.horizontal, font.vertical) = (
            advances(b"hhea", b"hmtx", b"HVAR"),
            advances(b"vhea", b"vmtx", b"VVAR"),
        );
        font.units_per_em = font.table(b"head").and_then(|it| it.u16(18)).unwrap_or(0);
        font.glyph_count = font
            .table(b"maxp")
            .and_then(|it| it.u16(4))
            .unwrap_or(0)
            .into();
        font.charmap = font.table(b"cmap").and_then(Charmap::new);
        let outlines = glyf::Glyf::new(&font)
            .map(Outlines::Glyf)
            .or_else(|| cff::Cff::new(&font).map(Outlines::Cff));
        font.outlines = outlines.unwrap_or(Outlines::None);
        Some(font)
    }

    pub fn table(&self, tag: &Tag) -> Option<Data> {
        let records = self
            .directory
            .part(12, usize::from(self.directory.u16(4)?) * 16)?;
        let record = Data(
            records
                .0
                .as_chunks::<16>()
                .0
                .iter()
                .find(|it| it.starts_with(tag))?,
        );
        self.file
            .part(record.u32(8)? as usize, record.u32(12)? as usize)
    }

    pub fn has_charmap(&self) -> bool {
        self.charmap.is_some()
    }

    /// For a font that stays.
    pub fn remember_glyphs(&mut self) {
        let charmap = self
            .charmap
            .as_mut()
            .filter(|it| !it.is_symbol && !it.is_mac_roman && may_remember(size_of::<Known>()));
        charmap
            .into_iter()
            .for_each(|it| it.known = Some(Box::leak(Box::new([const { OnceLock::new() }; 256]))));
    }

    #[inline]
    pub fn glyph(&self, character: u32) -> Option<u32> {
        const MISSING: u16 = u16::MAX;
        let charmap = self.charmap.as_ref()?;
        if let Some(page) = charmap.known.and_then(|it| it.get(character as usize >> 8))
            && let Some(page) = page.get().or_else(|| charmap.new_page(page, character))
        {
            let slot = &page.as_ref()?[character as usize & 255];
            return match slot.load(Relaxed) {
                0 => {
                    let found = charmap.map(character);
                    slot.store(
                        found.map_or(
                            MISSING,
                            |it| if it < MISSING.into() { it as u16 } else { 0 },
                        ),
                        Relaxed,
                    );
                    found
                }
                MISSING => None,
                known => Some(known.into()),
            };
        }
        memo::remembered(
            u32::from(charmap.is_symbol) + u32::from(charmap.is_mac_roman) * 2,
            charmap.table,
            character & 0xff_ffff,
            || charmap.map(character),
        )
    }

    pub fn glyph_variant(&self, character: u32, selector: u32) -> Option<u32> {
        self.charmap.as_ref()?.map_variant(character, selector)
    }

    /// `None` for TrueType outlines.
    #[cfg(not(target_os = "macos"))]
    pub fn outline_with_postscript_hints(
        &self,
        glyph: u32,
        coords: &Coords,
        size: f32,
    ) -> Option<Path> {
        let Outlines::Cff(table) = &self.outlines else {
            return None;
        };
        Some(
            work::limited(WORK_PER_GLYPH, || {
                table.outline(glyph, coords, 1., Some(size))
            })
            .unwrap_or_default(),
        )
    }

    /// With y up. Like in FreeType, points are on a grid of 1/64 after they are scaled.
    pub fn outline(&self, glyph: u32, coords: &Coords, scale: f32) -> Option<Path> {
        work::limited(WORK_PER_GLYPH, || match &self.outlines {
            Outlines::Glyf(table) => table.shape(self, glyph, coords, Some(scale))?.path(),
            Outlines::Cff(table) => table.outline(glyph, coords, scale, None),
            Outlines::None => None,
        })
    }

    /// In whole font units.
    #[cfg(not(target_os = "macos"))]
    pub fn shape(&self, glyph: u32, coords: &Coords) -> Option<Shape> {
        match &self.outlines {
            Outlines::Glyf(table) => {
                work::limited(WORK_PER_GLYPH, || table.shape(self, glyph, coords, None))
            }
            _ => Some(Shape::from_cubic(&self.outline(glyph, coords, 1.)?)),
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn is_symbol(&self) -> bool {
        self.charmap.is_some_and(|it| it.is_symbol)
    }

    /// Characters and their glyphs.
    #[cfg(not(target_os = "macos"))]
    pub fn mappings(&self) -> impl Iterator<Item = (u32, u32)> {
        let table = self.charmap.map_or_else(Data::default, |it| it.table);
        let group = move |index: usize| {
            table.part(
                16 + Some(index).filter(|it| Some(*it as u32) < table.u32(12))? * 12,
                12,
            )
        };
        let range = move |index: usize| match table.u16(0)? {
            4 => {
                let starts = 16 + usize::from(table.u16(6).filter(|it| index * 2 < (*it).into())?);
                Some((
                    table.u16(starts + index * 2)?.into()..=table.u16(14 + index * 2)?.into(),
                    None,
                ))
            }
            format @ (12 | 13) => Some((
                group(index)?.u32(0)?..=group(index)?.u32(4)?,
                group(index)?.u32(8).filter(|_| format == 12),
            )),
            _ => (index == 0).then_some((0..=0xffff, None)),
        };
        let mapped = (0..).map_while(range).flat_map(move |(range, first)| {
            let start = *range.start();
            range.map(move |it| {
                Some((
                    it,
                    first.map_or_else(|| self.glyph(it), |first| first.checked_add(it - start))?,
                ))
            })
        });
        mapped.take(0x11_0000).flatten()
    }

    /// With y up, so that it starts at the bottom.
    pub fn bounds(&self, glyph: u32, coords: &Coords) -> Option<Rect> {
        let measure = || Some(gfx::bounds(&self.outline(glyph, coords, 1.)?));
        let (Outlines::Glyf(table), []) = (&self.outlines, coords) else {
            return measure();
        };
        let stated = table.bounds(glyph)?;
        let is_moved = stated != Rect::default()
            && self
                .horizontal
                .bearing(glyph)
                .is_some_and(|it| f32::from(it) != stated.x);
        Some(if is_moved {
            Rect {
                x: measure()?.x,
                ..stated
            }
        } else {
            stated
        })
    }

    fn advance_of(
        &self,
        advances: &Advances,
        axis: usize,
        glyph: u32,
        coords: &Coords,
    ) -> Option<f32> {
        let advance = advances.advance(glyph)?;
        let delta = match &self.outlines {
            _ if coords.is_empty() => None,
            Outlines::Glyf(table) if advances.deltas.is_none() => {
                work::limited(WORK_PER_GLYPH, || {
                    table.advance_delta(self, glyph, axis, coords)
                })
            }
            _ => advances.delta(8, glyph, coords),
        };
        Some(f32::from(advance) + delta.unwrap_or(0.).round())
    }

    pub fn advance(&self, glyph: u32, coords: &Coords) -> Option<f32> {
        self.advance_of(&self.horizontal, 0, glyph, coords)
    }

    pub fn vertical_advance(&self, glyph: u32, coords: &Coords) -> Option<f32> {
        self.advance_of(&self.vertical, 1, glyph, coords)
    }

    /// How far above the baseline the glyph hangs from in vertical text.
    pub fn vertical_origin(&self, glyph: u32, coords: &Coords) -> Option<f32> {
        if let Some(table) = self.table(b"VORG") {
            let count = usize::from(table.u16(6)?);
            let index = Data::partition(count, |it| {
                table
                    .u16(8 + it * 4)
                    .is_some_and(|it| u32::from(it) < glyph)
            });
            let is_listed = index < count && table.u16(8 + index * 4).map(u32::from) == Some(glyph);
            let delta = self
                .vertical
                .deltas
                .and_then(|it| it.at32(20))
                .and_then(|_| self.vertical.delta(20, glyph, coords));
            return Some(
                f32::from(table.i16(if is_listed { 10 + index * 4 } else { 4 })?)
                    + delta.unwrap_or(0.).round(),
            );
        }
        let delta = self
            .vertical
            .deltas
            .and_then(|it| it.at32(12))
            .and_then(|_| self.vertical.delta(12, glyph, coords));
        let (bounds, bearing) = (self.bounds(glyph, coords)?, self.vertical.bearing(glyph)?);
        Some(bounds.y + bounds.height + f32::from(bearing) + delta.unwrap_or(0.).round())
    }

    /// The typographic ascent and descent.
    pub fn em_lines(&self) -> [f32; 2] {
        let lines = |table, at: usize| {
            Some([self.table(table)?.i16(at)?, self.table(table)?.i16(at + 2)?].map(f32::from))
        };
        lines(b"OS/2", 68)
            .or_else(|| lines(b"hhea", 4))
            .unwrap_or_default()
    }

    /// Of the default script, in horizontal text.
    pub fn baseline(&self, tag: &Tag) -> Option<f32> {
        let axis = self.table(b"BASE")?.at16(4)?;
        let (tags, scripts) = (axis.at16(0)?, axis.at16(2)?);
        let index = (0..usize::from(tags.u16(0)?)).find(|it| tags.tag(2 + it * 4) == Some(*tag))?;
        let script = (0..usize::from(scripts.u16(0)?))
            .find(|it| scripts.tag(2 + it * 6) == Some(*b"DFLT"))?;
        let values = scripts.at16(6 + script * 6)?.at16(0)?;
        (index < usize::from(values.u16(2)?)).then_some(())?;
        values.at16(4 + index * 2)?.i16(2).map(f32::from)
    }

    pub fn metrics(&self, coords: &Coords) -> Metrics {
        let number =
            |table: Option<Data>, at: usize| table.and_then(|it| it.i16(at)).map(f32::from);
        let (hhea, os2, post, head) = (
            self.table(b"hhea"),
            self.table(b"OS/2").filter(|it| it.0.len() >= 78),
            self.table(b"post"),
            self.table(b"head"),
        );
        let lines =
            |table, at: usize| [at, at + 2, at + 4].map(|it| number(table, it).unwrap_or(0.));
        let [mut ascent, mut descent, mut leading] = lines(hhea, 4);
        let (typographic, uses_typographic) = (
            lines(os2, 68),
            os2.and_then(|it| it.u16(62))
                .is_some_and(|it| it & 0x80 != 0),
        );
        if uses_typographic || [ascent, descent] == [0.; 2] && typographic[..2] != [0.; 2] {
            [ascent, descent, leading] = typographic;
        } else if let Some(os2) = os2.filter(|_| [ascent, descent] == [0.; 2]) {
            (ascent, descent) = (
                os2.u16(74).unwrap_or(0).into(),
                -f32::from(os2.u16(76).unwrap_or(0)),
            );
        }
        let delta = |tag: &Tag| variations::metric_delta(self, tag, coords);
        let newer = os2.filter(|it| it.u16(0) >= Some(2));
        Metrics {
            ascent: ascent + delta(b"hasc"),
            descent: descent + delta(b"hdsc"),
            leading: leading + delta(b"hlgp"),
            x_height: number(newer, 86).map(|it| it + delta(b"xhgt")),
            cap_height: number(newer, 88).map(|it| it + delta(b"cpht")),
            average_width: number(os2, 2),
            underline: number(post, 8)
                .zip(number(post, 10))
                .map(|it| (it.0 + delta(b"undo"), it.1 + delta(b"unds"))),
            widest: number(head, 40).unwrap_or(0.) - number(head, 36).unwrap_or(0.),
        }
    }

    /// In all languages, with English first.
    pub fn names(&self, id: u16) -> Vec<String> {
        let Some(table) = self.table(b"name") else {
            return Vec::new();
        };
        let records = (0..usize::from(table.u16(2).unwrap_or(0)))
            .filter_map(|it| table.part(6 + it * 12, 12));
        let names = records
            .filter(|it| it.u16(6) == Some(id) && it.u16(8) < Some(1024))
            .take(256)
            .filter_map(|record| {
                let text = table
                    .at16(4)?
                    .part(record.u16(10)?.into(), record.u16(8)?.into())?;
                let roman = |byte: &u8| {
                    byte.checked_sub(0x80)
                        .map_or(Some(char::from(*byte)), |it| {
                            MAC_ROMAN.chars().nth(it.into())
                        })
                };
                let text: String = match (record.u16(0)?, record.u16(2)?) {
                    (1, 0) => text.0.iter().filter_map(roman).collect(),
                    (0, _) | (3, 0 | 1 | 10) => char::decode_utf16(text.u16s(0, usize::MAX))
                        .flatten()
                        .collect(),
                    _ => return None,
                };
                Some((
                    !matches!((record.u16(0)?, record.u16(4)?), (1, 0) | (3, 0x409)),
                    text,
                ))
            });
        let mut names: Vec<_> = names.collect();
        names.sort_by_key(|it| it.0);
        names.into_iter().map(|it| it.1).collect()
    }

    /// The weight, the width in percent, and whether it is slanted.
    #[cfg(target_os = "macos")]
    pub fn style(&self) -> (f32, f32, bool) {
        const WIDTHS: [f32; 9] = [50., 62.5, 75., 87.5, 100., 112.5, 125., 150., 200.];
        let declared = self
            .table(b"OS/2")
            .and_then(|it| Some((it.u16(4)?, it.u16(6)?, it.u16(62)?)));
        if let Some((weight, width, flags)) = declared {
            return (
                weight.into(),
                WIDTHS[usize::from(width.clamp(1, 9)) - 1],
                flags & 0x201 != 0,
            );
        }
        let flags = self.table(b"head").and_then(|it| it.u16(44)).unwrap_or(0);
        (
            if flags & 1 != 0 { 700. } else { 400. },
            100.,
            flags & 2 != 0,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_remembered_about_glyphs_is_limited() {
        let cmap = [
            0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 12, 0, 6, 0, 12, 0, 0, 0, 65, 0, 1, 0, 7,
        ];
        let file = [
            &[0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0][..],
            b"cmap",
            &[0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0, 24],
            &cmap,
        ]
        .concat()
        .leak();
        let mut pages = 0;
        for _ in 0..200 {
            let mut font = Font::new(file, 0).unwrap();
            font.remember_glyphs();
            assert!((0..256).all(|it| font.glyph(it * 256 + 65) == (it == 0).then_some(7)));
            pages += font
                .charmap
                .unwrap()
                .known
                .into_iter()
                .flatten()
                .filter(|it| it.get().is_some())
                .count();
        }
        assert!(pages <= 1 << 14);
    }
}

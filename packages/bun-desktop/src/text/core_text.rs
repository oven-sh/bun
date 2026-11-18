//! The system's fonts. Core Text finds them, and draws the ones whose formats are Apple's own.

use std::ffi::{CString, c_char, c_void};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

use super::decoded::map;
use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE, Like, index_of};
use super::sfnt::{self, variations};
use super::woff::write_sfnt;
use crate::abi::Rect;
use crate::gfx::{Path, PathBuilder as _};
use crate::hash::FastMap;
use crate::paint::raster::{IntRect, Layer};
use crate::platform::macos::{Object, take_string};
use crate::sync::Mutex;

type AddToPath = unsafe extern "C" fn(pen: *mut c_void, kind: i32, points: *const [f64; 2]);

unsafe extern "C" {
    fn bd_font_named(name: *const c_char) -> Object;
    safe fn bd_font_of_system() -> Option<Object>;
    safe fn bd_font_with_traits(font: &c_void, is_bold: bool, is_italic: bool) -> Option<Object>;
    safe fn bd_font_unscaled(font: &c_void) -> Object;
    safe fn bd_font_sized(font: &c_void, size: f64) -> Object;
    fn bd_font_of_data(bytes: *const u8, length: usize, index: u32) -> Option<Object>;
    safe fn bd_font_with_weight(font: &c_void, size: f64, weight: f64) -> Object;
    safe fn bd_font_metrics(font: &c_void, size: f64, metrics: &mut [f64; 3]);
    fn bd_font_for_text(base: &c_void, text: *const c_char, language: *const c_char) -> Object;
    fn bd_fonts_of_family(family: *const c_char, fonts: *mut Object, capacity: usize) -> usize;
    safe fn bd_font_families() -> *mut c_char;
    safe fn bd_font_family_name(font: &c_void) -> *mut c_char;
    safe fn bd_font_postscript_name(font: &c_void) -> *mut c_char;
    safe fn bd_font_full_name(font: &c_void) -> *mut c_char;
    safe fn bd_font_path(font: &c_void) -> *mut c_char;
    safe fn bd_font_weight(font: &c_void) -> f64;
    safe fn bd_font_table(
        font: &c_void,
        tag: u32,
        bytes: &mut *const u8,
        length: &mut usize,
    ) -> Option<Object>;
    fn bd_font_outline(font: &c_void, glyph: u16, scale: f64, pen: *mut c_void, add: AddToPath);
    safe fn bd_glyph_bounds(font: &c_void, glyph: u16) -> Rect;
    safe fn bd_font_glyph(font: &c_void, character: u16) -> u16;
    fn bd_glyph_draw_black(
        font: &c_void,
        glyph: u16,
        x: f64,
        y: f64,
        pixels: *mut u32,
        width: usize,
        height: usize,
        is_smoothed: bool,
    );
    fn bd_glyph_draw(
        font: &c_void,
        glyph: u16,
        x: f64,
        y: f64,
        pixels: *mut u8,
        width: usize,
        height: usize,
    );
}

const SYMBOL_FAMILIES: &[&str] = &[
    "Lucida Grande",
    "Menlo",
    "Apple Symbols",
    "Zapf Dingbats",
    "STIX Two Math",
    "Hiragino Sans",
    "Arial Unicode MS",
];

pub type FamilyId = u32;

#[derive(Clone, Copy)]
pub struct Font {
    data: &'static [u8],
    index: u32,
}

/// One unit of the font is one point.
#[derive(Clone)]
pub struct NativeFont(Object);

// SAFETY: Core Text documents its font objects as immutable and usable on any thread.
unsafe impl Send for NativeFont {}
// SAFETY: as above.
unsafe impl Sync for NativeFont {}

static NATIVE_FONTS: LazyLock<Mutex<FastMap<(u64, u32), NativeFont>>> =
    LazyLock::new(Mutex::default);

unsafe extern "C" fn add_to_path(pen: *mut c_void, kind: i32, points: *const [f64; 2]) {
    // SAFETY: the argument of `outline`, and as many points as the kind takes.
    unsafe {
        let pen = &mut *pen.cast::<Path>();
        let [x, y] = [0, 1].map(|axis| move |index| points.add(index).read()[axis] as f32);
        match kind {
            0 => pen.move_to([x(0), y(0)]),
            1 => pen.line_to([x(0), y(0)]),
            2 => pen.quad_to([x(0), y(0)], [x(1), y(1)]),
            3 => pen.curve_to([x(0), y(0)], [x(1), y(1)], [x(2), y(2)]),
            _ => pen.close(),
        };
    }
}

impl NativeFont {
    pub fn of(data: &'static [u8], index: u32) -> Option<NativeFont> {
        NATIVE_FONTS
            .lock()
            .get(&Catalog::identity(&Font { data, index }))
            .cloned()
    }

    /// `scale` is in pixels per unit.
    pub fn outline(&self, glyph: u32, scale: f32, pen: &mut Path) {
        // SAFETY: the pointer is only used during the call.
        unsafe {
            bd_font_outline(
                &self.0,
                glyph as u16,
                scale.into(),
                std::ptr::from_mut(pen).cast(),
                add_to_path,
            )
        };
    }

    /// Ascent, descent and leading. Small emoji are drawn larger.
    pub fn metrics(&self, size: f32) -> [f32; 3] {
        let mut metrics = [0.; 3];
        bd_font_metrics(&self.0, size.into(), &mut metrics);
        metrics.map(|it| it as f32)
    }

    /// Of a picture, without tracking.
    pub fn advance(&self, glyph: u32, size: f32) -> f32 {
        ((bd_glyph_bounds(&bd_font_sized(&self.0, size.into()), glyph as u16).width * 64.).round()
            / 64.)
            .round_ties_even()
    }

    /// The glyph's origin is at `x` and `y`.
    pub fn draw(&self, glyph: u32, size: f32, x: f32, y: f32) -> Option<Layer> {
        let (font, glyph) = (bd_font_sized(&self.0, size.into()), glyph as u16);
        let Rect {
            x: from_x,
            y: from_y,
            width,
            height,
        } = bd_glyph_bounds(&font, glyph);
        let (left, top) = (x + from_x, y - from_y - height);
        let rect = IntRect::around(Rect {
            x: left - 1.,
            y: top - 1.,
            width: width + 2.,
            height: height + 2.,
        });
        let mut layer = Layer::new(rect)?;
        let (x, y, pixels) = (
            x - rect.left as f32,
            rect.bottom as f32 - y,
            layer.pixmap.data_mut().as_mut_ptr(),
        );
        // SAFETY: a bitmap of that size.
        unsafe {
            bd_glyph_draw(
                &font,
                glyph,
                x.into(),
                y.into(),
                pixels,
                rect.width(),
                rect.height(),
            )
        };
        layer
            .pixels()
            .iter()
            .any(|pixel| pixel[3] != 0)
            .then_some(layer)
    }
}

/// How far Core Graphics moves the left, upper, right and lower edges of a glyph outwards, in pixels, unless the user has turned that off.
pub fn smoothing(size: f32) -> Option<[f32; 4]> {
    static KNOWN: LazyLock<Mutex<FastMap<u32, Option<[f32; 4]>>>> = LazyLock::new(Mutex::default);
    let halves = (size.clamp(6., 256.) * 2.).round() as u32;
    *KNOWN
        .lock()
        .entry(halves)
        .or_insert_with(|| measure_smoothing(halves as f32 / 2.))
}

fn measure_smoothing(size: f32) -> Option<[f32; 4]> {
    const MARGIN: f32 = 4.;
    const SHIFTS: [f32; 4] = [0., 0.25, 0.5, 0.75];
    let font = bd_font_sized(&named("Menlo-Regular"), size.into());
    let block = Some(bd_font_glyph(&font, 0x2588)).filter(|it| *it != 0)?;
    let Rect {
        x,
        y,
        width,
        height,
    } = bd_glyph_bounds(&font, block);
    let [columns, rows] = [width, height].map(|it| (it + MARGIN * 2.).ceil() as usize + 1);
    let origin = [x, y].map(|it| (MARGIN - it).round());
    let draw = |shift: f32, is_smoothed| {
        let mut pixels = vec![u32::MAX; columns * rows];
        // SAFETY: a bitmap of that size.
        unsafe {
            bd_glyph_draw_black(
                &font,
                block,
                (origin[0] + shift).into(),
                origin[1].into(),
                pixels.as_mut_ptr(),
                columns,
                rows,
                is_smoothed,
            )
        };
        pixels
    };
    (draw(0.5, true) != draw(0.5, false)).then_some(())?;
    let mut growth = [0.; 4];
    for shift in SHIFTS {
        let exact = Rect {
            x: origin[0] + shift + x,
            y: rows as f32 - origin[1] - y - height,
            width,
            height,
        };
        let measured = super::raster::growth_of_block(&draw(shift, true), columns, exact);
        growth
            .iter_mut()
            .zip(measured)
            .for_each(|(all, it)| *all += it / SHIFTS.len() as f32);
    }
    crate::diagnostics::log!("font smoothing at {size}: {growth:?}");
    Some(growth.map(|it| it.clamp(0., 0.75)))
}

fn terminated(text: impl Into<Vec<u8>>) -> CString {
    CString::new(text).unwrap_or_default()
}

fn named(name: &str) -> Object {
    // SAFETY: a string.
    unsafe { bd_font_named(terminated(name).as_ptr()) }
}

fn string_of(font: &Object, get: extern "C" fn(&c_void) -> *mut c_char) -> String {
    // SAFETY: each of them returns a copy.
    unsafe { take_string(get(font)) }
}

fn family_name(font: &Object) -> String {
    string_of(font, bd_font_family_name)
}

fn postscript_name(font: &Object) -> String {
    string_of(font, bd_font_postscript_name)
}

fn members_of(family: &str) -> Vec<Object> {
    let mut fonts = Vec::with_capacity(256);
    // SAFETY: it writes as many as it says.
    unsafe {
        let count = bd_fonts_of_family(
            terminated(family).as_ptr(),
            fonts.as_mut_ptr(),
            fonts.capacity(),
        );
        fonts.set_len(count);
    }
    fonts.retain(|font| family_name(font) == family);
    fonts
}

fn css_weight(font: &Object) -> Option<f32> {
    const STOPS: [f64; 9] = [-0.8, -0.6, -0.4, 0., 0.23, 0.3, 0.4, 0.56, 0.62];
    let weight = bd_font_weight(font);
    let nearest = (0..9).min_by(|a, b| {
        (STOPS[*a] - weight)
            .abs()
            .total_cmp(&(STOPS[*b] - weight).abs())
    })?;
    Some((nearest + 1) as f32 * 100.)
}

/// What it takes to shape text.
fn without_glyphs(font: &Object) -> Option<&'static [u8]> {
    const TABLES: [&[u8; 4]; 24] = [
        b"head", b"hhea", b"maxp", b"OS/2", b"cmap", b"hmtx", b"name", b"post", b"vhea", b"vmtx",
        b"VORG", b"GDEF", b"GPOS", b"GSUB", b"kern", b"kerx", b"morx", b"ankr", b"feat", b"trak",
        b"STAT", b"fvar", b"avar", b"HVAR",
    ];
    let table = |tag: &&[u8; 4]| {
        let (mut bytes, mut length) = (std::ptr::null(), 0);
        let _owner = bd_font_table(font, u32::from_be_bytes(**tag), &mut bytes, &mut length)
            .filter(|_| length > 0)?;
        // SAFETY: it has them.
        Some((
            **tag,
            unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec(),
        ))
    };
    Some(write_sfnt(0x0001_0000, TABLES.iter().filter_map(table).collect())?.leak())
}

fn capabilities(font: &sfnt::Font) -> Capabilities {
    let (axes, (weight, stretch, is_slanted)) = (variations::axes(font), font.style());
    let range = |tag: &sfnt::Tag| {
        axes.iter()
            .find(|axis| axis.tag == *tag)
            .map(|axis| (axis.min, axis.max))
    };
    let slope = if is_slanted {
        DEFAULT_OBLIQUE_ANGLE
    } else {
        0.
    };
    Capabilities {
        weight: range(b"wght")
            .filter(|(_, max)| *max >= 100.)
            .unwrap_or((weight, weight)),
        stretch: range(b"wdth")
            .filter(|(_, max)| *max >= 50.)
            .unwrap_or((stretch, stretch)),
        slope: match (range(b"slnt"), range(b"ital")) {
            (Some((min, max)), _) => (-max, -min),
            (None, Some((min, max))) => (min * DEFAULT_OBLIQUE_ANGLE, max * DEFAULT_OBLIQUE_ANGLE),
            _ => (slope, slope),
        },
    }
}

#[derive(Default)]
pub struct Catalog {
    /// What was asked for, in lower case.
    names: FastMap<String, Option<FamilyId>>,
    /// As Core Text spells them.
    ids: FastMap<String, FamilyId>,
    /// One member of each.
    families: Vec<NativeFont>,
    alone: Vec<FamilyId>,
    available: Vec<String>,
    mapped: FastMap<PathBuf, Option<&'static [u8]>>,
    opened: FastMap<String, Option<(Font, Capabilities)>>,
    natives: FastMap<(u64, u32), Option<NativeFont>>,
}

impl Catalog {
    pub fn new() -> Catalog {
        Catalog::default()
    }

    pub fn identity(font: &Font) -> (u64, u32) {
        (font.data.as_ptr().addr() as u64, font.index)
    }

    pub fn load(&mut self, font: &Font) -> Option<(&'static [u8], u32)> {
        Some((font.data, font.index))
    }

    pub fn path(&self, font: &Font) -> Option<&PathBuf> {
        self.mapped.iter().find_map(|(path, data)| {
            data.is_some_and(|it| it.as_ptr() == font.data.as_ptr())
                .then_some(path)
        })
    }

    pub fn has(&self, family: FamilyId) -> bool {
        (family as usize) < self.families.len()
    }

    fn file_of(&mut self, font: &Object, name: &str) -> Option<Font> {
        let data = (*self
            .mapped
            .entry(string_of(font, bd_font_path).into())
            .or_insert_with_key(|path| map(path)))?;
        Some(Font {
            data,
            index: index_of(data, name)?,
        })
    }

    fn open(&mut self, native: &Object) -> Option<(Font, Capabilities)> {
        let name = postscript_name(native);
        if let Some(opened) = self.opened.get(&name) {
            return *opened;
        }
        let has = |font: &Font, tags: &[&[u8; 4]]| {
            let font = sfnt::Font::new(font.data, font.index);
            font.is_some_and(|font| tags.iter().any(|tag| font.table(tag).is_some()))
        };
        let is_readable =
            |it: &Font| has(it, &[b"glyf", b"CFF ", b"CFF2", b"sbix"]) && !has(it, &[b"hvgl"]);
        let file = self.file_of(native, &name).filter(is_readable);
        let font = file.or_else(|| {
            Some(Font {
                data: without_glyphs(native)?,
                index: 0,
            })
        });
        let opened = font.and_then(|font| {
            let mut capabilities = capabilities(&sfnt::Font::new(font.data, font.index)?);
            if file.is_none() {
                capabilities.weight =
                    css_weight(native).map_or(capabilities.weight, |weight| (weight, weight));
            }
            if file.is_none() || has(&font, &[b"sbix"]) {
                NATIVE_FONTS.lock().insert(
                    Catalog::identity(&font),
                    NativeFont(bd_font_unscaled(native)),
                );
            }
            self.natives
                .insert(Catalog::identity(&font), Some(NativeFont(native.clone())));
            Some((font, capabilities))
        });
        crate::diagnostics::log!(
            "font {name}: has a file {}, opened {}",
            file.is_some(),
            opened.is_some()
        );
        self.opened.insert(name, opened);
        opened
    }

    fn family_of(&mut self, font: Object) -> FamilyId {
        *self.ids.entry(family_name(&font)).or_insert_with(|| {
            self.families.push(NativeFont(font));
            self.families.len() as u32 - 1
        })
    }

    pub fn family(&mut self, name: &str) -> Option<FamilyId> {
        let lower = name.to_lowercase();
        if let Some(found) = self.names.get(&lower) {
            return *found;
        }
        let capitalized = lower.split(' ').map(|word| {
            let (first, rest) = word.split_at(word.ceil_char_boundary(1));
            first.to_uppercase() + rest
        });
        let capitalized = capitalized.collect::<Vec<_>>().join(" ");
        let spellings = [Some(name), (name == lower).then_some(&*capitalized)];
        let found = (spellings.into_iter().flatten())
            .filter(|_| !name.is_empty() && !name.starts_with('.') && lower != "lastresort")
            .map(named)
            .find(|font| {
                family_name(font).to_lowercase() == lower
                    || postscript_name(font).to_lowercase() == lower
            });
        let found = found.map(|font| self.family_of(font));
        self.names.insert(lower, found);
        found
    }

    pub fn family_names(&mut self) -> impl Iterator<Item = &str> {
        if self.available.is_empty() {
            // SAFETY: it returns a copy.
            let names = unsafe { take_string(bd_font_families()) };
            self.available = names
                .lines()
                .filter(|it| !it.starts_with('.'))
                .map(str::to_owned)
                .collect();
        }
        self.available.iter().map(String::as_str)
    }

    pub fn generic(&mut self, name: &str) -> Option<FamilyId> {
        match name {
            "system-ui" => Some(self.family_of(bd_font_of_system()?)),
            "emoji" => self.family("Apple Color Emoji"),
            "math" => self.family("STIX Two Math"),
            "fangsong" => self.family("STFangsong"),
            _ => None,
        }
    }

    pub fn fonts(&mut self, family: FamilyId) -> Arc<[(Font, Capabilities)]> {
        let member = self.families[family as usize].0.clone();
        let name = family_name(&member);
        let mut members = if name.starts_with('.') {
            Vec::new()
        } else {
            members_of(&name)
        };
        if members.is_empty() && !self.alone.contains(&family) {
            let traits = [(true, false), (false, true), (true, true)].into_iter();
            members.extend(
                traits.filter_map(|(bold, italic)| bd_font_with_traits(&member, bold, italic)),
            );
        }
        members.push(member);
        let mut fonts: Vec<_> = members
            .iter()
            .filter_map(|member| self.open(member))
            .collect();
        fonts.sort_by_key(|(font, _)| Catalog::identity(font));
        fonts.dedup_by_key(|(font, _)| Catalog::identity(font));
        fonts.into()
    }

    fn native(
        &mut self,
        Like {
            file,
            weight,
            device_scale,
            ..
        }: Like,
    ) -> Option<Object> {
        const USUAL_SIZE: f32 = 14.;
        // SAFETY: a slice with its length, which is never freed.
        let of_data = || {
            unsafe { bd_font_of_data(file.data.as_ptr(), file.data.len(), file.index) }
                .map(NativeFont)
        };
        let font = &self
            .natives
            .entry(Catalog::identity(&Font {
                data: file.data,
                index: file.index,
            }))
            .or_insert_with(of_data)
            .as_ref()?
            .0;
        Some(if family_name(font).starts_with('.') {
            bd_font_with_weight(font, (USUAL_SIZE * device_scale).into(), weight.into())
        } else {
            font.clone()
        })
    }

    /// The members of a hidden family cannot be listed, and this one was chosen for its style.
    fn only(&mut self, font: Object) -> FamilyId {
        *self
            .ids
            .entry(postscript_name(&font) + "/")
            .or_insert_with(|| {
                self.families.push(NativeFont(font));
                self.alone.push(self.families.len() as u32 - 1);
                self.families.len() as u32 - 1
            })
    }

    /// The families that may have the character, the best one first.
    pub fn fallbacks(
        &mut self,
        character: char,
        color: bool,
        language: &[u8],
        like: Option<Like>,
    ) -> Vec<FamilyId> {
        if color {
            return self.generic("emoji").into_iter().collect();
        }
        let text = terminated(character.to_string());
        let language = terminated(std::str::from_utf8(language).unwrap_or(""));
        let base = like
            .and_then(|it| self.native(it))
            .unwrap_or_else(|| named("Times"));
        // SAFETY: strings.
        let found = unsafe { bd_font_for_text(&base, text.as_ptr(), language.as_ptr()) };
        let found = Some(found).filter(|font| !family_name(font).contains("LastResort"));
        let mut families: Vec<_> = found
            .map(|font| {
                if family_name(&font).starts_with('.') {
                    self.only(font)
                } else {
                    self.family_of(font)
                }
            })
            .into_iter()
            .collect();
        families.extend(SYMBOL_FAMILIES.iter().filter_map(|name| self.family(name)));
        families
    }

    pub fn by_full_name(&mut self, name: &str) -> Option<Font> {
        let font = named(name);
        let names = [postscript_name(&font), string_of(&font, bd_font_full_name)];
        names
            .iter()
            .any(|it| it.to_lowercase() == name.to_lowercase())
            .then_some(())?;
        Some(self.open(&font)?.0)
    }
}

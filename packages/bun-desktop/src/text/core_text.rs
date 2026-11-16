//! The system's fonts. Core Text finds them, and draws the ones whose formats are Apple's own.

use std::ffi::{CString, c_char, c_void};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

use crate::hash::FastMap;
use crate::sync::Mutex;
use skrifa::attribute::Style;
use skrifa::outline::OutlinePen;
use skrifa::{FontRef, MetadataProvider as _, Tag};

use super::decoded::map;
use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE, index_of};
use super::woff::write_sfnt;
use crate::abi::Rect;
use crate::paint::raster::{IntRect, Layer};
use crate::platform::macos::{Object, take_string};

type AddToPath = unsafe extern "C" fn(pen: *mut c_void, kind: i32, points: *const [f64; 2]);

unsafe extern "C" {
    fn bd_font_named(name: *const c_char) -> Object;
    safe fn bd_font_of_system() -> Option<Object>;
    safe fn bd_font_with_traits(font: &c_void, is_bold: bool, is_italic: bool) -> Option<Object>;
    safe fn bd_font_unscaled(font: &c_void) -> Object;
    safe fn bd_font_sized(font: &c_void, size: f64) -> Object;
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
        let pen = &mut **pen.cast::<&mut dyn OutlinePen>();
        let [x, y] = [0, 1].map(|axis| move |index| points.add(index).read()[axis] as f32);
        match kind {
            0 => pen.move_to(x(0), y(0)),
            1 => pen.line_to(x(0), y(0)),
            2 => pen.quad_to(x(0), y(0), x(1), y(1)),
            3 => pen.curve_to(x(0), y(0), x(1), y(1), x(2), y(2)),
            _ => pen.close(),
        }
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
    pub fn outline(&self, glyph: u32, scale: f32, mut pen: &mut dyn OutlinePen) {
        // SAFETY: the pointer is only used during the call.
        unsafe {
            bd_font_outline(
                &self.0,
                glyph as u16,
                scale.into(),
                (&raw mut pen).cast(),
                add_to_path,
            )
        };
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
    const TABLES: [&[u8; 4]; 19] = [
        b"head", b"hhea", b"maxp", b"OS/2", b"cmap", b"hmtx", b"name", b"post", b"vhea", b"vmtx",
        b"VORG", b"GDEF", b"GPOS", b"GSUB", b"kern", b"kerx", b"morx", b"ankr", b"feat",
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

fn capabilities(font: &FontRef) -> Capabilities {
    let attributes = font.attributes();
    let range = |tag| {
        font.axes()
            .get_by_tag(Tag::new(tag))
            .map(|axis| (axis.min_value(), axis.max_value()))
    };
    let (weight, stretch) = (attributes.weight.value(), attributes.stretch.percentage());
    let slope = if attributes.style == Style::Normal {
        0.
    } else {
        DEFAULT_OBLIQUE_ANGLE
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
    available: Vec<String>,
    mapped: FastMap<PathBuf, Option<&'static [u8]>>,
    opened: FastMap<String, Option<(Font, Capabilities)>>,
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
            let font = FontRef::from_index(font.data, font.index);
            font.is_ok_and(|font| {
                tags.iter()
                    .any(|tag| font.table_data(Tag::new(tag)).is_some())
            })
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
            let mut capabilities = capabilities(&FontRef::from_index(font.data, font.index).ok()?);
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
        if members.is_empty() {
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

    /// The families that may have the character, the best one first.
    pub fn fallbacks(&mut self, character: char, color: bool, language: &[u8]) -> Vec<FamilyId> {
        if color {
            return self.generic("emoji").into_iter().collect();
        }
        let text = terminated(character.to_string());
        let language = terminated(std::str::from_utf8(language).unwrap_or(""));
        // SAFETY: strings.
        let found =
            unsafe { bd_font_for_text(&named("Helvetica"), text.as_ptr(), language.as_ptr()) };
        let found = Some(found).filter(|font| !family_name(font).contains("LastResort"));
        let mut families: Vec<_> = found.map(|font| self.family_of(font)).into_iter().collect();
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

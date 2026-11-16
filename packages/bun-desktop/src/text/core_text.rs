//! The system's fonts. Core Text finds them, and draws the ones whose formats are Apple's own.

use std::ffi::c_void;
use std::path::PathBuf;
use std::ptr::{NonNull, null, null_mut};
use std::sync::{Arc, LazyLock};

use objc2_core_foundation::{
    CFArray, CFDictionary, CFNumber, CFRange, CFRetained, CFString, CFURL, CGAffineTransform,
    CGPoint,
};
use objc2_core_graphics::{
    CGBitmapContextCreate, CGColorSpace, CGImageAlphaInfo, CGPath, CGPathElement,
    CGPathElementType, kCGColorSpaceSRGB,
};
use objc2_core_text::{
    CTFont, CTFontDescriptor, CTFontManagerCopyAvailableFontFamilyNames, CTFontOptions,
    CTFontOrientation, CTFontSymbolicTraits, CTFontTableOptions, CTFontUIFontType,
    kCTFontFamilyNameAttribute, kCTFontURLAttribute, kCTFontWeightTrait,
};
use parking_lot::Mutex;
use rustc_hash::FxHashMap;
use skrifa::attribute::Style;
use skrifa::outline::OutlinePen;
use skrifa::{FontRef, MetadataProvider as _, Tag};

use super::decoded::map;
use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE, index_of};
use super::woff::write_sfnt;
use crate::abi::Rect;
use crate::paint::raster::{IntRect, Layer};

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
pub struct NativeFont(CFRetained<CTFont>);

// SAFETY: Core Text documents its font objects as immutable and usable on any thread.
unsafe impl Send for NativeFont {}
// SAFETY: as above.
unsafe impl Sync for NativeFont {}

static NATIVE_FONTS: LazyLock<Mutex<FxHashMap<(u64, u32), NativeFont>>> =
    LazyLock::new(Mutex::default);

unsafe extern "C-unwind" fn add_to_path(pen: *mut c_void, element: NonNull<CGPathElement>) {
    // SAFETY: the argument of `outline`, and as many points as the type of the element takes.
    unsafe {
        let (pen, element) = (&mut **pen.cast::<&mut dyn OutlinePen>(), element.as_ref());
        let [x, y] = [0, 1].map(|axis| {
            move |index| {
                let point = element.points.add(index).read();
                [point.x, point.y][axis] as f32
            }
        });
        match element.r#type {
            CGPathElementType::MoveToPoint => pen.move_to(x(0), y(0)),
            CGPathElementType::AddLineToPoint => pen.line_to(x(0), y(0)),
            CGPathElementType::AddQuadCurveToPoint => pen.quad_to(x(0), y(0), x(1), y(1)),
            CGPathElementType::AddCurveToPoint => pen.curve_to(x(0), y(0), x(1), y(1), x(2), y(2)),
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
        let matrix = CGAffineTransform {
            a: scale.into(),
            b: 0.,
            c: 0.,
            d: scale.into(),
            tx: 0.,
            ty: 0.,
        };
        // SAFETY: the pointers are only used during the calls.
        unsafe {
            let path = self.0.path_for_glyph(glyph as u16, &raw const matrix);
            CGPath::apply(
                path.as_deref(),
                (&raw mut pen).cast(),
                path.as_ref().map(|_| add_to_path as _),
            );
        }
    }

    /// The glyph's origin is at `x` and `y`.
    pub fn draw(&self, glyph: u32, size: f32, x: f32, y: f32) -> Option<Layer> {
        let glyph = glyph as u16;
        // SAFETY: one glyph at one position, and a bitmap that outlives the context.
        unsafe {
            let font = self.0.copy_with_attributes(size.into(), null(), None);
            let bounds = font.bounding_rects_for_glyphs(
                CTFontOrientation::Horizontal,
                (&glyph).into(),
                null_mut(),
                1,
            );
            let (width, height) = (bounds.size.width as f32, bounds.size.height as f32);
            let (left, top) = (
                x + bounds.origin.x as f32,
                y - bounds.origin.y as f32 - height,
            );
            let rect = IntRect::around(Rect {
                x: left - 1.,
                y: top - 1.,
                width: width + 2.,
                height: height + 2.,
            });
            let mut layer = Layer::new(rect)?;
            let context = CGBitmapContextCreate(
                layer.pixmap.data_mut().as_mut_ptr().cast(),
                rect.width(),
                rect.height(),
                8,
                rect.width() * 4,
                CGColorSpace::with_name(Some(kCGColorSpaceSRGB)).as_deref(),
                CGImageAlphaInfo::PremultipliedLast.0,
            )?;
            let position = CGPoint::new(
                (x - rect.left as f32).into(),
                (rect.bottom as f32 - y).into(),
            );
            font.draw_glyphs((&glyph).into(), (&position).into(), 1, &context);
            drop(context);
            layer
                .pixels()
                .iter()
                .any(|pixel| pixel[3] != 0)
                .then_some(layer)
        }
    }
}

/// A style sheet is no reason to show a dialog.
const WITHOUT_ASKING: CTFontOptions =
    CTFontOptions::PreventAutoActivation.union(CTFontOptions::PreventAutoDownload);

fn named(name: &str) -> CFRetained<CTFont> {
    // SAFETY: the matrix is optional.
    unsafe { CTFont::with_name_and_options(&CFString::from_str(name), 12., null(), WITHOUT_ASKING) }
}

fn family_name(font: &CTFont) -> String {
    // SAFETY: a getter.
    unsafe { font.family_name() }.to_string()
}

fn postscript_name(font: &CTFont) -> String {
    // SAFETY: as above.
    unsafe { font.post_script_name() }.to_string()
}

fn with_traits(font: &CTFont, traits: CTFontSymbolicTraits) -> Option<CFRetained<CTFont>> {
    // SAFETY: the matrix is optional.
    unsafe { font.copy_with_symbolic_traits(0., null(), traits, traits) }
}

fn members_of(family: &str) -> Vec<CFRetained<CTFont>> {
    // SAFETY: the attribute is a string, and the result an array of descriptors.
    unsafe {
        let attributes = CFDictionary::from_slices(
            &[kCTFontFamilyNameAttribute],
            &[&*CFString::from_str(family)],
        );
        let found = CTFontDescriptor::with_attributes(attributes.as_opaque())
            .matching_font_descriptors(None);
        let found =
            found.map(|found| CFRetained::cast_unchecked::<CFArray<CTFontDescriptor>>(found));
        let fonts = found.iter().flat_map(|found| found.iter());
        let fonts = fonts
            .map(|it| CTFont::with_font_descriptor_and_options(&it, 12., null(), WITHOUT_ASKING));
        fonts.filter(|font| family_name(font) == family).collect()
    }
}

fn css_weight(font: &CTFont) -> Option<f32> {
    const STOPS: [f64; 9] = [-0.8, -0.6, -0.4, 0., 0.23, 0.3, 0.4, 0.56, 0.62];
    // SAFETY: a dictionary of numbers.
    let weight = unsafe {
        let traits = CFRetained::cast_unchecked::<CFDictionary<CFString, CFNumber>>(font.traits());
        traits.get(kCTFontWeightTrait)?.as_f64()?
    };
    let nearest = (0..9).min_by(|a, b| {
        (STOPS[*a] - weight)
            .abs()
            .total_cmp(&(STOPS[*b] - weight).abs())
    })?;
    Some((nearest + 1) as f32 * 100.)
}

/// What it takes to shape text.
fn without_glyphs(font: &CTFont) -> Option<&'static [u8]> {
    const TABLES: [&[u8; 4]; 19] = [
        b"head", b"hhea", b"maxp", b"OS/2", b"cmap", b"hmtx", b"name", b"post", b"vhea", b"vmtx",
        b"VORG", b"GDEF", b"GPOS", b"GSUB", b"kern", b"kerx", b"morx", b"ankr", b"feat",
    ];
    let table = |tag: &&[u8; 4]| {
        // SAFETY: any tag may be asked for.
        let data = unsafe { font.table(u32::from_be_bytes(**tag), CTFontTableOptions::NoOptions) };
        Some((**tag, data?.to_vec()))
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
    names: FxHashMap<String, Option<FamilyId>>,
    /// As Core Text spells them.
    ids: FxHashMap<String, FamilyId>,
    /// One member of each.
    families: Vec<NativeFont>,
    available: Vec<String>,
    mapped: FxHashMap<PathBuf, Option<&'static [u8]>>,
    opened: FxHashMap<String, Option<(Font, Capabilities)>>,
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

    fn file_of(&mut self, font: &CTFont, name: &str) -> Option<Font> {
        // SAFETY: a getter.
        let url = unsafe { font.attribute(kCTFontURLAttribute) }?
            .downcast::<CFURL>()
            .ok()?;
        let data = (*self
            .mapped
            .entry(url.to_file_path()?)
            .or_insert_with_key(|path| map(path)))?;
        Some(Font {
            data,
            index: index_of(data, name)?,
        })
    }

    fn open(&mut self, native: &CTFont) -> Option<(Font, Capabilities)> {
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
                // SAFETY: the matrix and the attributes are optional.
                let native = unsafe {
                    native.copy_with_attributes(native.units_per_em().into(), null(), None)
                };
                NATIVE_FONTS
                    .lock()
                    .insert(Catalog::identity(&font), NativeFont(native));
            }
            Some((font, capabilities))
        });
        log::info!(
            "font {name}: has a file {}, opened {}",
            file.is_some(),
            opened.is_some()
        );
        self.opened.insert(name, opened);
        opened
    }

    fn family_of(&mut self, font: CFRetained<CTFont>) -> FamilyId {
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
            // SAFETY: an array of strings.
            let names = unsafe {
                CFRetained::cast_unchecked::<CFArray<CFString>>(
                    CTFontManagerCopyAvailableFontFamilyNames(),
                )
            };
            self.available = names
                .iter()
                .map(|name| name.to_string())
                .filter(|it| !it.starts_with('.'))
                .collect();
        }
        self.available.iter().map(String::as_str)
    }

    pub fn generic(&mut self, name: &str) -> Option<FamilyId> {
        match name {
            "system-ui" => {
                // SAFETY: the language is optional.
                let font = unsafe {
                    CTFont::new_ui_font_for_language(CTFontUIFontType::System, 12., None)
                }?;
                Some(self.family_of(font))
            }
            "emoji" => self.family("Apple Color Emoji"),
            "math" => self.family("STIX Two Math"),
            "fangsong" => self.family("STFangsong"),
            _ => None,
        }
    }

    pub fn fonts(&mut self, family: FamilyId) -> Arc<[(Font, Capabilities)]> {
        let (bold, italic) = (
            CTFontSymbolicTraits::TraitBold,
            CTFontSymbolicTraits::TraitItalic,
        );
        let member = self.families[family as usize].0.clone();
        let name = family_name(&member);
        let mut members = if name.starts_with('.') {
            Vec::new()
        } else {
            members_of(&name)
        };
        if members.is_empty() {
            members.extend(
                [bold, italic, bold | italic]
                    .into_iter()
                    .filter_map(|traits| with_traits(&member, traits)),
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
        let text = CFString::from_str(character.encode_utf8(&mut [0; 4]));
        let language = std::str::from_utf8(language)
            .ok()
            .filter(|it| !it.is_empty())
            .map(CFString::from_str);
        let range = CFRange::new(0, text.length());
        // SAFETY: the range is within the string.
        let found = unsafe {
            named("Helvetica").for_string_with_language(&text, range, language.as_deref())
        };
        let found = Some(found).filter(|font| !family_name(font).contains("LastResort"));
        let mut families: Vec<_> = found.map(|font| self.family_of(font)).into_iter().collect();
        families.extend(SYMBOL_FAMILIES.iter().filter_map(|name| self.family(name)));
        families
    }

    pub fn by_full_name(&mut self, name: &str) -> Option<Font> {
        let font = named(name);
        // SAFETY: a getter.
        let names = [
            postscript_name(&font),
            unsafe { font.full_name() }.to_string(),
        ];
        names
            .iter()
            .any(|it| it.to_lowercase() == name.to_lowercase())
            .then_some(())?;
        Some(self.open(&font)?.0)
    }
}

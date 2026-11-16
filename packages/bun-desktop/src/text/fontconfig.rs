//! The system's fonts, which are only opened to be used.

use std::ffi::{CStr, CString, OsStr};
use std::os::unix::ffi::OsStrExt as _;
use std::ptr::null_mut;
use std::sync::Arc;

use fontconfig_sys::constants::*;
use fontconfig_sys::statics::{LIB, LIB_RESULT};
use fontconfig_sys::{FcConfig, FcFontSet, FcMatchPattern, FcPattern, FcResultMatch, FcSetSystem};
use rustc_hash::FxHashMap;
use skrifa::{FontRef, MetadataProvider as _, Tag};

use super::decoded::map;
use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE};

pub type FamilyId = u32;

/// A pattern that is never freed.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Font(*mut FcPattern);

// SAFETY: fontconfig's objects belong to no thread, and this one is only read.
unsafe impl Send for Font {}
// SAFETY: see above.
unsafe impl Sync for Font {}

impl Font {
    fn bytes(self, key: &CStr, index: i32) -> Option<&'static CStr> {
        let mut value = null_mut();
        // SAFETY: the pattern owns the string.
        unsafe {
            let found =
                (LIB.FcPatternGetString)(self.0, key.as_ptr(), index, &mut value) == FcResultMatch;
            found.then(|| CStr::from_ptr(value.cast()))
        }
    }

    fn strings(self, key: &CStr) -> impl Iterator<Item = &'static str> {
        (0..)
            .map_while(move |index| self.bytes(key, index))
            .filter_map(|value| value.to_str().ok())
    }

    fn number(self, key: &CStr) -> Option<f32> {
        let mut value = 0.;
        // SAFETY: the pattern is alive.
        let result = unsafe { (LIB.FcPatternGetDouble)(self.0, key.as_ptr(), 0, &mut value) };
        (result == FcResultMatch).then_some(value as f32)
    }

    fn is(self, key: &CStr) -> bool {
        let mut value = 0;
        // SAFETY: the pattern is alive.
        unsafe { (LIB.FcPatternGetBool)(self.0, key.as_ptr(), 0, &mut value) };
        value != 0
    }

    fn has(self, character: char) -> bool {
        let mut characters = null_mut();
        // SAFETY: the pattern owns the set.
        unsafe {
            (LIB.FcPatternGetCharSet)(self.0, FC_CHARSET.as_ptr(), 0, &mut characters)
                == FcResultMatch
                && (LIB.FcCharSetHasChar)(characters, character.into()) != 0
        }
    }

    /// The high half numbers the named instances of a variable font.
    fn index(self) -> u32 {
        self.number(FC_INDEX).unwrap_or(0.) as u32
    }
}

/// # Safety
/// `set` is null or never freed.
unsafe fn fonts_of(set: *mut FcFontSet) -> &'static [Font] {
    // SAFETY: a set has `nfont` patterns.
    unsafe {
        let set = set.as_ref().filter(|set| set.nfont > 0);
        set.map_or(&[], |set| {
            std::slice::from_raw_parts(set.fonts.cast(), set.nfont as usize)
        })
    }
}

fn css_weight(weight: f32) -> f32 {
    const STOPS: [(f32, f32); 12] = [
        (0., 100.),
        (40., 200.),
        (50., 300.),
        (55., 350.),
        (75., 380.),
        (80., 400.),
        (100., 500.),
        (180., 600.),
        (200., 700.),
        (205., 800.),
        (210., 900.),
        (215., 1000.),
    ];
    let between = STOPS.array_windows().find(|[_, (end, _)]| weight <= *end);
    between.map_or(1000., |[(start, low), (end, high)]| {
        low + (high - low) * (weight - start) / (end - start)
    })
}

pub struct Catalog {
    /// Null without fontconfig.
    config: *mut FcConfig,
    all: &'static [Font],
    /// In lower case.
    names: FxHashMap<String, FamilyId>,
    families: Vec<Vec<Font>>,
    generics: FxHashMap<String, Option<FamilyId>>,
    sorted_by_language: FxHashMap<Vec<u8>, &'static [Font]>,
    mapped: FxHashMap<&'static CStr, Option<&'static [u8]>>,
}

// SAFETY: as for `Font`.
unsafe impl Send for Catalog {}

impl Catalog {
    pub fn new() -> Catalog {
        // SAFETY: the configuration is never freed.
        let (config, all) = LIB_RESULT
            .as_ref()
            .map_or((null_mut(), &[][..]), |fc| unsafe {
                let config = (fc.FcConfigGetCurrent)();
                (config, fonts_of((fc.FcConfigGetFonts)(config, FcSetSystem)))
            });
        let (mut names, mut families) = (FxHashMap::default(), Vec::<Vec<Font>>::new());
        for font in all.iter().filter(|font| font.index() >> 16 == 0) {
            let mut aliases = font.strings(FC_FAMILY).map(str::to_lowercase);
            let Some(name) = aliases.next() else { continue };
            let family = *names.entry(name).or_insert(families.len() as FamilyId);
            families.resize_with(families.len().max(family as usize + 1), Vec::new);
            families[family as usize].push(*font);
        }
        for (family, fonts) in (0..).zip(&families) {
            for alias in fonts
                .iter()
                .flat_map(|font| font.strings(FC_FAMILY).skip(1))
            {
                names.entry(alias.to_lowercase()).or_insert(family);
            }
        }
        let (generics, sorted_by_language, mapped) = Default::default();
        Catalog {
            config,
            all,
            names,
            families,
            generics,
            sorted_by_language,
            mapped,
        }
    }

    pub fn identity(font: &Font) -> (u64, u32) {
        (font.0 as u64, 0)
    }

    pub fn load(&mut self, font: &Font) -> Option<(&'static [u8], u32)> {
        let path = font.bytes(FC_FILE, 0)?;
        let data = self
            .mapped
            .entry(path)
            .or_insert_with(|| map(OsStr::from_bytes(path.to_bytes()).as_ref()));
        Some(((*data)?, font.index() & 0xFFFF))
    }

    pub fn family(&mut self, name: &str) -> Option<FamilyId> {
        self.names.get(&name.to_lowercase()).copied()
    }

    fn family_of(&self, font: Font) -> Option<FamilyId> {
        self.names
            .get(&font.strings(FC_FAMILY).next()?.to_lowercase())
            .copied()
    }

    fn query<R>(&self, key: &CStr, value: &[u8], f: impl FnOnce(*mut FcPattern) -> R) -> Option<R> {
        let value = CString::new(value)
            .ok()
            .filter(|_| !self.config.is_null())?;
        // SAFETY: the pattern is alive until it is destroyed.
        unsafe {
            let pattern = (LIB.FcPatternCreate)();
            if !value.is_empty() {
                (LIB.FcPatternAddString)(pattern, key.as_ptr(), value.as_ptr().cast());
            }
            (LIB.FcPatternAddBool)(pattern, FC_SCALABLE.as_ptr(), 1);
            (LIB.FcConfigSubstitute)(self.config, pattern, FcMatchPattern);
            (LIB.FcDefaultSubstitute)(pattern);
            let result = f(pattern);
            (LIB.FcPatternDestroy)(pattern);
            Some(result)
        }
    }

    pub fn family_names(&mut self) -> impl Iterator<Item = &str> {
        self.families
            .iter()
            .filter_map(|fonts| fonts[0].strings(FC_FAMILY).next())
    }

    pub fn generic(&mut self, name: &str) -> Option<FamilyId> {
        if let Some(family) = self.generics.get(name) {
            return *family;
        }
        let family = self.query(FC_FAMILY, name.as_bytes(), |pattern| {
            // SAFETY: both are alive.
            let font = unsafe { (LIB.FcFontMatch)(self.config, pattern, &mut 0) };
            (!font.is_null()).then(|| self.family_of(Font(font)))?
        });
        *self
            .generics
            .entry(name.to_owned())
            .or_insert(family.flatten())
    }

    fn capabilities(&mut self, font: Font) -> Capabilities {
        let fixed = |value: f32| (value, value);
        let mut capabilities = Capabilities {
            weight: fixed(font.number(FC_WEIGHT).map_or(400., css_weight)),
            stretch: fixed(font.number(FC_WIDTH).unwrap_or(100.)),
            slope: fixed(if font.number(FC_SLANT).unwrap_or(0.) > 0. {
                DEFAULT_OBLIQUE_ANGLE
            } else {
                0.
            }),
        };
        let loaded = font.is(FC_VARIABLE).then(|| self.load(&font)).flatten();
        let Some(font) = loaded.and_then(|(data, index)| FontRef::from_index(data, index).ok())
        else {
            return capabilities;
        };
        let range = |tag| {
            font.axes()
                .get_by_tag(Tag::new(tag))
                .map(|axis| (axis.min_value(), axis.max_value()))
        };
        capabilities.weight = range(b"wght").unwrap_or(capabilities.weight);
        capabilities.stretch = range(b"wdth").unwrap_or(capabilities.stretch);
        capabilities.slope = match (range(b"slnt"), range(b"ital")) {
            (Some((min, max)), _) => (-max, -min),
            (None, Some((min, max))) => (min * DEFAULT_OBLIQUE_ANGLE, max * DEFAULT_OBLIQUE_ANGLE),
            _ => capabilities.slope,
        };
        capabilities
    }

    pub fn fonts(&mut self, family: FamilyId) -> Arc<[(Font, Capabilities)]> {
        let mut fonts = self.families[family as usize].clone();
        // A variable font is also listed as its default instance.
        fonts.sort_by_key(|font| (font.bytes(FC_FILE, 0), font.index(), !font.is(FC_VARIABLE)));
        fonts.dedup_by_key(|font| (font.bytes(FC_FILE, 0), font.index()));
        fonts
            .into_iter()
            .map(|font| (font, self.capabilities(font)))
            .collect()
    }

    /// Like `gfx::GetFallbackFontForChar` in Chromium.
    pub fn fallbacks(&mut self, character: char, color: bool, language: &[u8]) -> Vec<FamilyId> {
        let sorted = self
            .sorted_by_language
            .get(language)
            .copied()
            .unwrap_or_else(|| {
                // SAFETY: both are alive, and the result is never freed.
                let sort = |pattern| unsafe {
                    fonts_of((LIB.FcFontSort)(
                        self.config,
                        pattern,
                        0,
                        null_mut(),
                        &mut 0,
                    ))
                };
                let sorted = self.query(FC_LANG, language, sort).unwrap_or_default();
                self.sorted_by_language.insert(language.to_owned(), sorted);
                sorted
            });
        let suitable = sorted
            .iter()
            .filter(|font| font.is(FC_COLOR) == color && font.has(character));
        let mut families: Vec<_> = suitable.filter_map(|font| self.family_of(*font)).collect();
        families.dedup();
        families
    }

    /// `name` is in lower case.
    pub fn by_full_name(&mut self, name: &str) -> Option<Font> {
        let name = name.to_lowercase();
        let names = |font: Font| {
            font.strings(FC_FULLNAME)
                .chain(font.strings(FC_POSTSCRIPT_NAME))
        };
        self.all
            .iter()
            .copied()
            .find(|font| names(*font).any(|it| it.to_lowercase() == name))
    }
}

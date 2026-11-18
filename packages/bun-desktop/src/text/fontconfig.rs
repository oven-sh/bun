//! The system's fonts, which are only opened to be used.

use std::ffi::{CStr, CString, OsStr, c_char, c_double, c_int, c_void};
use std::ops::Deref;
use std::os::unix::ffi::OsStrExt as _;
use std::path::Path;
use std::ptr::null_mut;
use std::sync::{Arc, LazyLock};

use super::decoded::map;
use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE, Like};
use super::sfnt::{self, variations};
use crate::hash::FastMap;

pub fn smoothing(_size: f32) -> Option<[f32; 4]> {
    None
}

pub type FamilyId = u32;

type FcConfig = c_void;
type FcPattern = c_void;
type Key = *const c_char;

#[repr(C)]
struct FcFontSet {
    nfont: c_int,
    sfont: c_int,
    fonts: *mut *mut FcPattern,
}

const MATCH: c_int = 0;

macro_rules! functions {
    ($($name:ident: fn($($argument:ty),*) $(-> $result:ty)?;)+) => {
        #[expect(non_snake_case)]
        struct Functions {
            $($name: unsafe extern "C" fn($($argument),*) $(-> $result)?,)+
        }

        // SAFETY: those are the signatures in fontconfig.h, and the library stays loaded.
        static LOADED: LazyLock<Option<Functions>> = LazyLock::new(|| unsafe {
            let library = Some(libc::dlopen(c"libfontconfig.so.1".as_ptr(), libc::RTLD_LAZY)).filter(|it| !it.is_null())?;
            Some(Functions {$(
                $name: std::mem::transmute::<*mut c_void, Option<unsafe extern "C" fn($($argument),*) $(-> $result)?>>(
                    libc::dlsym(library, concat!(stringify!($name), "\0").as_ptr().cast()),
                )?,
            )+})
        });
    };
}

functions! {
    FcConfigGetCurrent: fn() -> *mut FcConfig;
    FcConfigGetFonts: fn(*mut FcConfig, c_int) -> *mut FcFontSet;
    FcConfigSubstitute: fn(*mut FcConfig, *mut FcPattern, c_int) -> c_int;
    FcDefaultSubstitute: fn(*mut FcPattern);
    FcFontMatch: fn(*mut FcConfig, *mut FcPattern, *mut c_int) -> *mut FcPattern;
    FcFontSort: fn(*mut FcConfig, *mut FcPattern, c_int, *mut *mut c_void, *mut c_int) -> *mut FcFontSet;
    FcPatternCreate: fn() -> *mut FcPattern;
    FcPatternDestroy: fn(*mut FcPattern);
    FcPatternAddString: fn(*mut FcPattern, Key, *const c_char) -> c_int;
    FcPatternAddBool: fn(*mut FcPattern, Key, c_int) -> c_int;
    FcPatternGetString: fn(*mut FcPattern, Key, c_int, *mut *mut c_char) -> c_int;
    FcPatternGetDouble: fn(*mut FcPattern, Key, c_int, *mut c_double) -> c_int;
    FcPatternGetBool: fn(*mut FcPattern, Key, c_int, *mut c_int) -> c_int;
    FcPatternGetCharSet: fn(*mut FcPattern, Key, c_int, *mut *mut c_void) -> c_int;
    FcCharSetHasChar: fn(*mut c_void, u32) -> c_int;
}

/// For what only exists once it is loaded.
struct Library;

static LIB: Library = Library;

impl Deref for Library {
    type Target = Functions;

    fn deref(&self) -> &Functions {
        LOADED.as_ref().expect("it is loaded")
    }
}

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
            let found = (LIB.FcPatternGetString)(self.0, key.as_ptr(), index, &mut value) == MATCH;
            found.then(|| CStr::from_ptr(value))
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
        (result == MATCH).then_some(value as f32)
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
            (LIB.FcPatternGetCharSet)(self.0, c"charset".as_ptr(), 0, &mut characters) == MATCH
                && (LIB.FcCharSetHasChar)(characters, character.into()) != 0
        }
    }

    /// The high half numbers the named instances of a variable font.
    fn index(self) -> u32 {
        self.number(c"index").unwrap_or(0.) as u32
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
    names: FastMap<String, FamilyId>,
    families: Vec<Vec<Font>>,
    generics: FastMap<String, Option<FamilyId>>,
    sorted_by_language: FastMap<Vec<u8>, &'static [Font]>,
    mapped: FastMap<&'static CStr, Option<&'static [u8]>>,
}

// SAFETY: as for `Font`.
unsafe impl Send for Catalog {}

impl Catalog {
    pub fn new() -> Catalog {
        // SAFETY: the configuration is never freed.
        let (config, all) = LOADED.as_ref().map_or((null_mut(), &[][..]), |fc| unsafe {
            let config = (fc.FcConfigGetCurrent)();
            (config, fonts_of((fc.FcConfigGetFonts)(config, 0)))
        });
        let (mut names, mut families) = (FastMap::default(), Vec::<Vec<Font>>::new());
        for font in all.iter().filter(|font| font.index() >> 16 == 0) {
            let mut aliases = font.strings(c"family").map(str::to_lowercase);
            let Some(name) = aliases.next() else { continue };
            let family = *names.entry(name).or_insert(families.len() as FamilyId);
            families.resize_with(families.len().max(family as usize + 1), Vec::new);
            families[family as usize].push(*font);
        }
        for (family, fonts) in (0..).zip(&families) {
            for alias in fonts
                .iter()
                .flat_map(|font| font.strings(c"family").skip(1))
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
        let path = font.bytes(c"file", 0)?;
        let data = self
            .mapped
            .entry(path)
            .or_insert_with(|| map(OsStr::from_bytes(path.to_bytes()).as_ref()));
        Some(((*data)?, font.index() & 0xFFFF))
    }

    pub fn path(&self, font: &Font) -> Option<&Path> {
        Some(OsStr::from_bytes(font.bytes(c"file", 0)?.to_bytes()).as_ref())
    }

    pub fn has(&self, family: FamilyId) -> bool {
        (family as usize) < self.families.len()
    }

    pub fn family(&mut self, name: &str) -> Option<FamilyId> {
        self.names.get(&name.to_lowercase()).copied()
    }

    fn family_of(&self, font: Font) -> Option<FamilyId> {
        self.names
            .get(&font.strings(c"family").next()?.to_lowercase())
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
                (LIB.FcPatternAddString)(pattern, key.as_ptr(), value.as_ptr());
            }
            (LIB.FcPatternAddBool)(pattern, c"scalable".as_ptr(), 1);
            (LIB.FcConfigSubstitute)(self.config, pattern, 0);
            (LIB.FcDefaultSubstitute)(pattern);
            let result = f(pattern);
            (LIB.FcPatternDestroy)(pattern);
            Some(result)
        }
    }

    pub fn family_names(&mut self) -> impl Iterator<Item = &str> {
        self.families
            .iter()
            .filter_map(|fonts| fonts[0].strings(c"family").next())
    }

    pub fn generic(&mut self, name: &str) -> Option<FamilyId> {
        if let Some(family) = self.generics.get(name) {
            return *family;
        }
        let family = self.query(c"family", name.as_bytes(), |pattern| {
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
            weight: fixed(font.number(c"weight").map_or(400., css_weight)),
            stretch: fixed(font.number(c"width").unwrap_or(100.)),
            slope: fixed(if font.number(c"slant").unwrap_or(0.) > 0. {
                DEFAULT_OBLIQUE_ANGLE
            } else {
                0.
            }),
        };
        let loaded = font.is(c"variable").then(|| self.load(&font)).flatten();
        let Some(font) = loaded.and_then(|(data, index)| sfnt::Font::new(data, index)) else {
            return capabilities;
        };
        let axes = variations::axes(&font);
        let range = |tag: &sfnt::Tag| {
            axes.iter()
                .find(|axis| axis.tag == *tag)
                .map(|axis| (axis.min, axis.max))
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
        fonts.sort_by_key(|font| (font.bytes(c"file", 0), font.index(), !font.is(c"variable")));
        fonts.dedup_by_key(|font| (font.bytes(c"file", 0), font.index()));
        fonts
            .into_iter()
            .map(|font| (font, self.capabilities(font)))
            .collect()
    }

    /// Like `gfx::GetFallbackFontForChar` in Chromium.
    pub fn fallbacks(
        &mut self,
        character: char,
        color: bool,
        language: &[u8],
        _: Option<Like>,
    ) -> Vec<FamilyId> {
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
                let sorted = self.query(c"lang", language, sort).unwrap_or_default();
                self.sorted_by_language.insert(language.to_owned(), sorted);
                sorted
            });
        let suitable = sorted
            .iter()
            .filter(|font| font.is(c"color") == color && font.has(character));
        let mut families: Vec<_> = suitable.filter_map(|font| self.family_of(*font)).collect();
        families.dedup();
        families
    }

    /// `name` is in lower case.
    pub fn by_full_name(&mut self, name: &str) -> Option<Font> {
        let name = name.to_lowercase();
        let names = |font: Font| {
            font.strings(c"fullname")
                .chain(font.strings(c"postscriptname"))
        };
        self.all
            .iter()
            .copied()
            .find(|font| names(*font).any(|it| it.to_lowercase() == name))
    }
}

//! The system's fonts, which are only opened to be used.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};

use super::decoded::map;
use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE, Face, Origin};
use super::sfnt::{self, variations};
use crate::gfx::Transform;
use crate::hash::FastMap;
use crate::paint::raster::IntRect;
use crate::sync::Mutex;
use crate::unicode::Script;
use crate::win32::com::{
    Interface as _, Object, Out, Outcome, Status, Unknown, class, filled, made,
};
use crate::win32::*;

pub fn smoothing(_size: f32) -> Option<[f32; 4]> {
    None
}

pub fn is_smooth() -> bool {
    static SETTING: LazyLock<bool> =
        LazyLock::new(|| system_parameter(SPI_GETFONTSMOOTHING, 0) != 0);
    *SETTING
}

pub static AVOIDS_SUBPIXELS: AtomicBool = AtomicBool::new(false);

/// Whether blue is on the left, if text is drawn for the parts of a pixel.
pub fn subpixels() -> Option<bool> {
    static SETTING: LazyLock<Option<bool>> = LazyLock::new(|| {
        let is_on = is_smooth()
            && system_parameter(SPI_GETFONTSMOOTHINGTYPE, 0) == FE_FONTSMOOTHINGCLEARTYPE;
        is_on.then(|| {
            system_parameter(SPI_GETFONTSMOOTHINGORIENTATION, 1) == FE_FONTSMOOTHINGORIENTATIONBGR
        })
    });
    SETTING.filter(|_| !AVOIDS_SUBPIXELS.load(Ordering::Relaxed))
}

struct Shared<T>(T);

// SAFETY: the objects of a shared factory belong to no thread.
unsafe impl<T> Send for Shared<T> {}
// SAFETY: as above.
unsafe impl<T> Sync for Shared<T> {}

static FACTORY: LazyLock<Shared<Outcome<IDWriteFactory3>>> = LazyLock::new(|| {
    Shared(made(|it| create_write_factory(0, &IDWriteFactory3::ID, it)).and_then(|it| it.cast()))
});

/// By the addresses of what is in them.
static PATHS: Mutex<Vec<(usize, PathBuf)>> = Mutex::new(Vec::new());

/// An installed font, whose hints the system follows. It does not get to see those from the web.
pub struct Native {
    path: PathBuf,
    index: u32,
    faces: Mutex<FastMap<u32, Shared<Outcome<Unknown>>>>,
}

/// What is normalized to the coordinates of the face.
fn settings_of(face: &Face) -> Outcome<Vec<DWriteFontAxisValue>> {
    let (font, axes) = (&face.file.font, variations::axes(&face.file.font));
    let normalized = |index: usize, value: f32| {
        variations::normalize(font, &axes, [(axes[index].tag, value)].into_iter())
            .get(index)
            .copied()
            .unwrap_or(0)
    };
    let find = |(index, wanted): (usize, &i16)| {
        let (mut low, mut high) = (axes[index].min, axes[index].max);
        for _ in 0..20 {
            let middle = (low + high) / 2.;
            *if normalized(index, middle) < *wanted {
                &mut low
            } else {
                &mut high
            } = middle;
        }
        (axes[index].tag, high)
    };
    let found: Vec<_> = face
        .coords
        .iter()
        .enumerate()
        .take(axes.len())
        .map(find)
        .collect();
    let is_near = variations::normalize(font, &axes, found.iter().copied())
        .iter()
        .zip(face.coords)
        .all(|(a, b)| a.abs_diff(*b) < 8);
    let values = found.into_iter().map(|(tag, value)| DWriteFontAxisValue {
        axis_tag: u32::from_le_bytes(tag),
        value,
    });
    is_near.then(|| values.collect()).ok_or(Status::FAILED)
}

/// How it wants to be drawn at that size, if it says so: the version of the table and the flags.
fn grid_fitting(font: &sfnt::Font, size: u16) -> Option<(u16, u16)> {
    let table = font.table(b"gasp")?;
    let range = (0..usize::from(table.u16(2)?)).find(|it| table.u16(4 + it * 4) >= Some(size))?;
    Some((table.u16(0)?, table.u16(6 + range * 4)?))
}

fn has_bitmaps(font: &sfnt::Font, size: u16) -> bool {
    let strikes = font
        .table(b"EBLC")
        .and_then(|it| Some((it, it.u32(4)?.min(64) as usize)));
    strikes.is_some_and(|(table, count)| {
        (0..count).any(|it| {
            table.u16(8 + it * 48 + 44) == Some(size * 0x101)
                && table.u16(8 + it * 48 + 42)
                    >= table.u16(8 + it * 48 + 40).map(|it| it.saturating_add(3))
        })
    })
}

pub fn is_hinted(font: &sfnt::Font) -> bool {
    let limits = font.table(b"maxp").filter(|it| it.u32(0) == Some(0x1_0000));
    limits.is_some_and(|it| [16, 18, 20, 26].iter().any(|at| it.u16(*at) > Some(0)))
}

impl Native {
    pub fn of(data: &'static [u8], index: u32, _: Origin) -> Option<Native> {
        let path = PATHS
            .lock()
            .iter()
            .find(|it| it.0 == data.as_ptr().addr())?
            .1
            .clone();
        Some(Native {
            path,
            index,
            faces: Mutex::default(),
        })
    }

    fn open(&self, factory: &IDWriteFactory3, face: &Face) -> Outcome<Unknown> {
        let simulations = face.embolden.into();
        let reference = made(|it| {
            factory.create_font_face_reference(
                Wide::new(&self.path).str(),
                0,
                self.index,
                simulations,
                it,
            )
        })?;
        if face.coords.is_empty() {
            return made(|it| reference.create_font_face(it));
        }
        let (file, settings) = (made(|it| reference.get_font_file(it))?, settings_of(face)?);
        let resource = made(|it| {
            factory.cast::<IDWriteFactory6>().map_or_else(
                |it| it,
                |factory| factory.create_font_resource(file.borrowed(), self.index, it),
            )
        })?;
        // SAFETY: that many are read.
        made(|it| {
            resource.create_font_face(
                simulations,
                unsafe { Raw::new(settings.as_ptr().cast_mut()) },
                settings.len() as u32,
                it,
            )
        })
    }

    /// As Skia asks for it. There are three values for each pixel if text is drawn for their parts.
    pub fn coverage(
        &self,
        face: &Face,
        glyph: u32,
        size: f32,
        matrix: &Transform,
    ) -> Outcome<(IntRect, Vec<u8>)> {
        const ALIASED: i32 = 1;
        const AS_GDI: i32 = 2;
        const NATURAL: i32 = 4;
        const SYMMETRIC: i32 = 5;
        const SMOOTHES_SYMMETRICALLY: u16 = 8;
        let (factory, font) = (FACTORY.0.as_ref().map_err(|it| *it)?, &face.file.font);
        let face = self
            .faces
            .lock()
            .entry(face.id)
            .or_insert_with(|| Shared(self.open(factory, face)))
            .0
            .clone()?;
        let rendering = match grid_fitting(font, size.round() as u16) {
            _ if !is_smooth() => ALIASED,
            _ if size < 256. && has_bitmaps(font, size as u16) => AS_GDI,
            _ if matrix.kx != 0. => SYMMETRIC,
            Some((1.., flags)) => {
                if flags & SMOOTHES_SYMMETRICALLY != 0 {
                    SYMMETRIC
                } else {
                    NATURAL
                }
            }
            _ => {
                if size > 20. || !is_hinted(font) {
                    SYMMETRIC
                } else {
                    NATURAL
                }
            }
        };
        let (glyph, has_parts) = (glyph as u16, subpixels().is_some());
        let run = DWriteGlyphRun {
            font_face: face.as_ptr(),
            font_em_size: size,
            glyph_count: 1,
            glyph_indices: Some(&glyph),
            glyph_advances: Some(&0.),
            ..Default::default()
        };
        let how = [
            rendering,
            (rendering <= AS_GDI).into(),
            if has_parts { 0 } else { 2 },
            (!has_parts && is_smooth()).into(),
        ];
        let Transform {
            sx,
            ky,
            kx,
            sy,
            tx,
            ty,
        } = *matrix;
        let analysis =
            made(|it| factory.create_glyph_run_analysis(&run, &[sx, ky, kx, sy, tx, ty], how, it))?;
        let bounds = filled(|it| analysis.get_alpha_texture_bounds(has_parts.into(), it))?;
        let rect = IntRect::new(bounds.left, bounds.top, bounds.right, bounds.bottom);
        if rect.area() >= 1 << 24 {
            return Err(Status::FAILED);
        }
        let mut values = vec![0; rect.area() as usize * if has_parts { 3 } else { 1 }];
        if !rect.is_empty() {
            // SAFETY: it has that size.
            analysis
                .create_alpha_texture(
                    has_parts.into(),
                    &bounds,
                    unsafe { Raw::new(values.as_mut_ptr()) },
                    values.len() as u32,
                )
                .ok()?;
        }
        Ok((rect, values))
    }
}

pub type FamilyId = u32;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Font {
    file: u32,
    index: u32,
}

struct System {
    factory: &'static IDWriteFactory3,
    collection: IDWriteFontCollection,
}

#[derive(Default)]
pub struct Catalog {
    system: Option<System>,
    /// And what is in them, once it has been asked for.
    files: Vec<(PathBuf, Option<Option<&'static [u8]>>)>,
    names: Vec<String>,
}

// SAFETY: the objects of a shared factory belong to no thread.
unsafe impl Send for Catalog {}

struct Source {
    text: Wide,
    length: u32,
    locale: Wide,
}

class! { Source {
    0 [IID_ID_WRITE_TEXT_ANALYSIS_SOURCE] {
        text_at(position: u32, text: Out<*const u16>, length: Out<u32>),
        text_before(position: u32, text: Out<*const u16>, length: Out<u32>),
        direction() -> u32,
        locale(position: u32, length: Out<u32>, locale: Out<*const u16>),
        numbers(position: u32, length: Out<u32>, substitution: Out<Option<Unknown>>),
    }
} }

impl Source {
    fn text_at(&self, position: u32, text: Out<*const u16>, length: Out<u32>) -> Outcome {
        let left = self.length.saturating_sub(position);
        text.set(if left == 0 {
            std::ptr::null()
        } else {
            self.text.as_ptr().wrapping_add(position as usize)
        })?;
        length.set(left)
    }

    fn text_before(&self, position: u32, text: Out<*const u16>, length: Out<u32>) -> Outcome {
        text.set(if position == 0 {
            std::ptr::null()
        } else {
            self.text.as_ptr()
        })?;
        length.set(position.min(self.length))
    }

    fn direction(&self) -> u32 {
        0
    }

    fn locale(&self, position: u32, length: Out<u32>, locale: Out<*const u16>) -> Outcome {
        length.set(self.length.saturating_sub(position))?;
        locale.set(self.locale.as_ptr())
    }

    fn numbers(
        &self,
        position: u32,
        length: Out<u32>,
        substitution: Out<Option<Unknown>>,
    ) -> Outcome {
        length.set(self.length.saturating_sub(position))?;
        substitution.set(None)
    }
}

fn read(length: u32, fill: impl FnOnce(Raw<u16>, u32) -> Status) -> Outcome<String> {
    let mut buffer = vec![0; length as usize + 1];
    // SAFETY: it has that length.
    fill(unsafe { Raw::new(buffer.as_mut_ptr()) }, length + 1)
        .ok()
        .map(|()| string_in(&buffer))
}

fn name_of(family: &IDWriteFontFamily) -> Outcome<String> {
    let (names, mut index, mut exists) = (made(|it| family.get_family_names(it))?, 0, 0);
    names
        .find_locale_name(wide!("en-us"), &mut index, &mut exists)
        .ok()?;
    let index = if exists == 0 { 0 } else { index };
    read(
        filled(|it| names.get_string_length(index, it))?,
        |buffer, size| names.get_string(index, buffer, size),
    )
}

fn path_of(face: &IDWriteFontFaceReference) -> Outcome<PathBuf> {
    let (file, mut key, mut size) = (made(|it| face.get_font_file(it))?, Raw::default(), 0);
    let loader: IDWriteLocalFontFileLoader = made(|it| file.get_loader(it))?.cast()?;
    file.get_reference_key(&mut key, &mut size).ok()?;
    let length = filled(|it| loader.get_file_path_length_from_key(key, size, it))?;
    read(length, |buffer, length| {
        loader.get_file_path_from_key(key, size, buffer, length)
    })
    .map(PathBuf::from)
}

/// What Chromium tries before it asks the system.
fn preferred(character: char, language: &str) -> &'static [&'static str] {
    const JAPANESE: &[&str] = &[
        "Noto Sans JP",
        "Noto Sans CJK JP",
        "Meiryo",
        "Yu Gothic",
        "MS PGothic",
        "Microsoft YaHei",
    ];
    const KOREAN: &[&str] = &["Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", "Gulim"];
    const SIMPLIFIED: &[&str] = &[
        "Noto Sans SC",
        "Noto Sans CJK SC",
        "Microsoft YaHei",
        "SimSun",
    ];
    const TRADITIONAL: &[&str] = &[
        "Noto Sans TC",
        "Noto Sans CJK TC",
        "Microsoft JhengHei",
        "PMingLiU",
    ];
    const MATH: &[&str] = &["Cambria Math", "Segoe UI Symbol", "Code2000"];
    let mut parts = language.split(['-', '_']);
    match (&Script::of(character).0, character) {
        (b"Hani", _) | (_, '\u{3000}'..='\u{303f}' | '\u{ff00}'..='\u{ffef}') => match parts.next()
        {
            Some("ja") => JAPANESE,
            Some("ko") => KOREAN,
            Some("zh") if parts.any(|it| ["hant", "tw", "hk", "mo"].contains(&it)) => TRADITIONAL,
            _ => SIMPLIFIED,
        },
        (b"Hira" | b"Kana", _) => JAPANESE,
        (b"Hang", _) => KOREAN,
        (b"Bopo", _) => TRADITIONAL,
        (b"Latn" | b"Grek" | b"Cyrl", _) => &["Times New Roman"],
        (b"Arab", _) => &["Tahoma", "Segoe UI"],
        (b"Hebr", _) => &["David", "Segoe UI"],
        (b"Thai", _) => &["Tahoma", "Leelawadee UI", "Leelawadee"],
        (b"Deva", _) => &["Nirmala UI", "Mangal"],
        (b"Beng", _) => &["Nirmala UI", "Vrinda"],
        (b"Guru", _) => &["Nirmala UI", "Raavi"],
        (b"Gujr", _) => &["Nirmala UI", "Shruti"],
        (b"Taml", _) => &["Nirmala UI", "Latha"],
        (b"Telu", _) => &["Nirmala UI", "Gautami"],
        (b"Knda", _) => &["Tunga", "Nirmala UI"],
        (b"Mlym", _) => &["Nirmala UI", "Kartika"],
        (b"Armn", _) => &["Segoe UI", "Sylfaen"],
        (b"Geor", _) => &["Sylfaen", "Segoe UI"],
        (
            _,
            '\u{2190}'..='\u{23ff}'
            | '\u{25a0}'..='\u{25ff}'
            | '\u{27c0}'..='\u{27ff}'
            | '\u{2900}'..='\u{2aff}',
        ) => MATH,
        (_, '\u{1d400}'..='\u{1d7ff}' | '\u{1ee00}'..='\u{1eeff}' | '\u{1f780}'..='\u{1f7ff}') => {
            MATH
        }
        (_, '\u{2600}'..='\u{27bf}' | '\u{2b00}'..='\u{2bff}' | '\u{1f0a0}'..='\u{1f77f}') => {
            &["Segoe UI Symbol"]
        }
        _ => &[],
    }
}

impl Catalog {
    pub fn new() -> Catalog {
        let system = || -> Outcome<System> {
            let factory = FACTORY.0.as_ref().map_err(|it| *it)?;
            Ok(System {
                collection: made(|it| factory.get_system_font_collection(it, 0))?,
                factory,
            })
        };
        Catalog {
            system: system().ok(),
            ..Catalog::default()
        }
    }

    pub fn identity(font: &Font) -> (u64, u32) {
        (font.file.into(), font.index)
    }

    pub fn load(&mut self, font: &Font) -> Option<(&'static [u8], u32)> {
        let (path, data) = &mut self.files[font.file as usize];
        let open = || map(path).inspect(|it| PATHS.lock().push((it.as_ptr().addr(), path.clone())));
        Some(((*data.get_or_insert_with(open))?, font.index))
    }

    pub fn path(&self, font: &Font) -> Option<&PathBuf> {
        Some(&self.files.get(font.file as usize)?.0)
    }

    pub fn has(&self, family: FamilyId) -> bool {
        self.system
            .as_ref()
            .is_some_and(|it| family < it.collection.get_font_family_count())
    }

    fn font(&mut self, face: &IDWriteFontFaceReference) -> Outcome<Font> {
        let path = path_of(face)?;
        let file = self
            .files
            .iter()
            .position(|it| it.0 == path)
            .unwrap_or_else(|| {
                self.files.push((path, None));
                self.files.len() - 1
            });
        Ok(Font {
            file: file as u32,
            index: face.get_font_face_index(),
        })
    }

    pub fn family(&mut self, name: &str) -> Option<FamilyId> {
        let (mut index, mut exists) = (0, 0);
        self.system
            .as_ref()?
            .collection
            .find_family_name(Wide::new(name).str(), &mut index, &mut exists)
            .ok()
            .ok()?;
        (exists != 0).then_some(index)
    }

    pub fn family_names(&mut self) -> impl Iterator<Item = &str> {
        if let Some(System { collection, .. }) =
            self.system.as_ref().filter(|_| self.names.is_empty())
        {
            let families = (0..collection.get_font_family_count())
                .filter_map(|index| made(|it| collection.get_font_family(index, it)).ok());
            self.names = families.filter_map(|it| name_of(&it).ok()).collect();
        }
        self.names.iter().map(String::as_str)
    }

    pub fn generic(&mut self, name: &str) -> Option<FamilyId> {
        match name {
            "system-ui" => {
                let empty = NonClientMetricsW {
                    cb_size: size_of::<NonClientMetricsW>() as u32,
                    ..Default::default()
                };
                let name = string_in(
                    &system_parameter(SPI_GETNONCLIENTMETRICS, empty)
                        .lf_message_font
                        .lf_face_name,
                );
                self.family(&name).or_else(|| self.family("Segoe UI"))
            }
            "emoji" => self.family("Segoe UI Emoji"),
            "math" => self.family("Cambria Math"),
            "fangsong" => self.family("FangSong"),
            _ => self
                .generic("system-ui")
                .or_else(|| self.family_names().next().map(|_| 0)),
        }
    }

    pub fn fonts(&mut self, family: FamilyId) -> Arc<[(Font, Capabilities)]> {
        const WIDTHS: [f32; 10] = [100., 50., 62.5, 75., 87.5, 100., 112.5, 125., 150., 200.];
        let Some(family) = self
            .system
            .as_ref()
            .and_then(|it| made(|family_| it.collection.get_font_family(family, family_)).ok())
        else {
            return Arc::default();
        };
        let members = (0..family.get_font_count()).filter_map(|index| {
            made(|it| family.get_font(index, it))
                .ok()?
                .cast::<IDWriteFont3>()
                .ok()
        });
        let mut fonts = FastMap::default();
        for member in members.filter(|it| it.get_simulations() == 0) {
            let Ok(font) =
                made(|it| member.get_font_face_reference(it)).and_then(|it| self.font(&it))
            else {
                continue;
            };
            let fixed = |value: f32| (value, value);
            let capabilities = Capabilities {
                weight: fixed(member.get_weight() as f32),
                stretch: fixed(*WIDTHS.get(member.get_stretch() as usize).unwrap_or(&100.)),
                slope: fixed(if member.get_style() == 0 {
                    0.
                } else {
                    DEFAULT_OBLIQUE_ANGLE
                }),
            };
            // A variable font is there once for each of its instances.
            if fonts
                .insert(Catalog::identity(&font), (font, capabilities))
                .is_some()
                && let Some(variable) = self
                    .load(&font)
                    .and_then(|(data, index)| sfnt::Font::new(data, index))
            {
                fonts.insert(
                    Catalog::identity(&font),
                    (font, Capabilities::of(&variable)),
                );
            }
        }
        let mut fonts: Vec<_> = fonts.into_values().collect();
        fonts.sort_by_key(|it| it.0);
        fonts.into()
    }

    fn chosen_by_system(&mut self, character: char, language: &str) -> Outcome<Option<FamilyId>> {
        let System {
            factory,
            collection,
        } = self.system.as_ref().ok_or(Status::FAILED)?;
        let length = character.len_utf16() as u32;
        let source = Object::create(Source {
            text: Wide::new(character.to_string()),
            length,
            locale: Wide::new(language),
        });
        let fallback = made(|it| factory.get_system_font_fallback(it))?;
        let font = made(|it| {
            fallback.map_characters(source.borrowed(), length, collection.borrowed(), it)
        })?;
        let font: IDWriteFont3 = font.cast()?;
        Ok(self.family(&name_of(&made(|it| font.get_font_family(it))?)?))
    }

    /// The families that may have the character, the best one first.
    pub fn fallbacks(
        &mut self,
        character: char,
        color: bool,
        language: &[u8],
        _: Option<super::fonts::Like>,
    ) -> Vec<FamilyId> {
        const WITH_IDEOGRAPHS: &[&str] = &[
            "Arial Unicode MS",
            "MS PGothic",
            "SimSun",
            "Gulim",
            "PMingLiU",
        ];
        const WITH_MANY_SCRIPTS: &[&str] = &[
            "Tahoma",
            "Arial Unicode MS",
            "Lucida Sans Unicode",
            "Microsoft Sans Serif",
            "Palatino Linotype",
            "MS PGothic",
            "SimSun",
            "Gulim",
            "PMingLiU",
        ];
        if color {
            return self.generic("emoji").into_iter().collect();
        }
        let has_ideographs = |it: &String| {
            ["ja", "ko", "zh"]
                .iter()
                .any(|start| it.to_lowercase().split(['-', '_']).next() == Some(start))
        };
        let language = String::from_utf8_lossy(language).into_owned();
        let language = std::iter::once(language)
            .chain(languages_of_user())
            .find(has_ideographs)
            .unwrap_or_else(language_of_user)
            .to_lowercase();
        let many = if Script::of(character) == Script::HAN {
            WITH_IDEOGRAPHS
        } else {
            WITH_MANY_SCRIPTS
        };
        let first = preferred(character, &language)
            .iter()
            .find_map(|it| self.family(it));
        let mut families: Vec<_> = first
            .into_iter()
            .chain(many.iter().filter_map(|it| self.family(it)))
            .collect();
        families.extend(self.chosen_by_system(character, &language).ok().flatten());
        families.extend(
            ["Segoe UI", "Segoe UI Symbol"]
                .iter()
                .filter_map(|it| self.family(it)),
        );
        families
    }

    pub fn by_full_name(&mut self, name: &str) -> Option<Font> {
        const FULL_NAME: i32 = 4;
        const POSTSCRIPT_NAME: i32 = 6;
        let (all, name) = (
            made(|it| {
                Some(self.system.as_ref())
                    .flatten()
                    .map_or(Status::FAILED, |system| {
                        system.factory.get_system_font_set(it)
                    })
            })
            .ok()?,
            Wide::new(name),
        );
        let face = [FULL_NAME, POSTSCRIPT_NAME]
            .into_iter()
            .find_map(|property| {
                let property = DWriteFontProperty {
                    property_id: property,
                    property_value: name.str(),
                    locale_name: wide!(""),
                };
                let matching = made(|it| all.get_matching_fonts(&property, 1, it)).ok()?;
                made(|it| matching.get_font_face_reference(0, it)).ok()
            });
        self.font(&face?).ok()
    }
}

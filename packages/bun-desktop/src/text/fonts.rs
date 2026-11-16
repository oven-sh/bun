use std::hash::{Hash, Hasher};
use std::sync::{Arc, LazyLock, OnceLock};

use crate::error::{Context as _, Result, bail};
use crate::hash::{FastHasher, FastMap};
use crate::json::{Deserialize as _, Value, json, record};
use crate::small_vec::SmallVec;
use crate::sync::{Mutex, RwLock};
use harfrust::{Feature, ShapePlan, Shaper, ShaperData, ShaperInstance};
use skrifa::charmap::Charmap;
use skrifa::instance::{LocationRef, NormalizedCoord, Size};
use skrifa::metrics::Metrics;
use skrifa::outline::GlyphStyles;
use skrifa::outline::OutlineGlyphCollection;
use skrifa::raw::TableProvider as _;
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider as _, Tag};

use super::catalog::{Catalog, FamilyId, Font};
use super::decoded;
use super::reach::{Reach, reach};
use crate::abi::{self, FontMetrics};
use crate::bridge;
use crate::unicode::{self, Script};

pub const DEFAULT_OBLIQUE_ANGLE: f32 = 14.;
const BOLD_THRESHOLD: f32 = 600.;

struct Axis {
    tag: Tag,
    min: f32,
    max: f32,
}

/// Never freed. Equal bytes are loaded once.
pub struct File {
    pub data: &'static [u8],
    pub font: FontRef<'static>,
    pub outlines: OutlineGlyphCollection<'static>,
    #[cfg(target_os = "macos")]
    pub native: Option<super::catalog::NativeFont>,
    pub has_color: bool,
    /// Advances are not proportional to the size.
    pub has_tracking: bool,
    reach: OnceLock<Option<Reach>>,
    glyph_styles: OnceLock<GlyphStyles>,
    charmap: Charmap<'static>,
    ascii: u128,
    axes: Vec<Axis>,
    shaper_data: ShaperData,
}

impl File {
    fn load(data: &'static [u8], index: u32) -> Option<&'static File> {
        let font = FontRef::from_index(data, index).ok()?;
        font.head().ok().filter(|head| head.units_per_em() > 0)?;
        let charmap = font.charmap();
        charmap.has_map().then_some(())?;
        let has_table = |tag: &[u8; 4]| font.table_data(Tag::new(tag)).is_some();
        let axes = font.axes().iter().map(|axis| Axis {
            tag: axis.tag(),
            min: axis.min_value(),
            max: axis.max_value(),
        });
        Some(Box::leak(Box::new(File {
            data,
            outlines: font.outline_glyphs(),
            #[cfg(target_os = "macos")]
            native: super::catalog::NativeFont::of(data, index),
            has_color: has_table(b"COLR") || has_table(b"CBDT") || has_table(b"sbix"),
            has_tracking: has_table(b"trak"),
            ascii: (0..128u32)
                .filter(|code| charmap.map(*code).is_some_and(|glyph| glyph.to_u32() != 0))
                .fold(0, |bits, code| bits | 1 << code),
            axes: axes.collect(),
            shaper_data: ShaperData::new(&font),
            reach: OnceLock::new(),
            glyph_styles: OnceLock::new(),
            charmap,
            font,
        })))
    }

    pub fn glyph(&self, character: char) -> Option<u32> {
        Some(self.charmap.map(character)?.to_u32()).filter(|glyph| *glyph != 0)
    }

    /// For hinting.
    pub fn glyph_styles(&self) -> GlyphStyles {
        self.glyph_styles
            .get_or_init(|| GlyphStyles::new(&self.outlines))
            .clone()
    }

    pub fn reach(&self) -> Option<Reach> {
        *self
            .reach
            .get_or_init(|| reach(&self.font, self.glyph(' ')?))
    }

    fn covers(&self, character: char) -> bool {
        match character as u32 {
            code @ 0..128 => self.ascii >> code & 1 != 0,
            0x2011 => self
                .glyph(character)
                .or_else(|| self.glyph('\u{2010}'))
                .is_some(),
            _ => self.glyph(character).is_some(),
        }
    }

    fn substitutes(&self, tag: &[u8; 4]) -> bool {
        let features = self.font.gsub().and_then(|table| table.feature_list());
        features.is_ok_and(|list| {
            list.feature_records()
                .iter()
                .any(|record| record.feature_tag() == Tag::new(tag))
        })
    }

    /// An `abi::ADJUST_*` metric, relative to the size.
    fn aspect(&self, metric: u8, variations: &[(Tag, f32)]) -> Option<f32> {
        if metric == abi::ADJUST_NONE {
            return None;
        }
        let location = self.font.axes().location(variations.iter().copied());
        let (metrics, glyphs) = (
            self.font.metrics(Size::unscaled(), &location),
            self.font.glyph_metrics(Size::unscaled(), &location),
        );
        let (top, em) = (
            |character| Some(glyphs.bounds(self.glyph(character)?.into())?.y_max),
            f32::from(metrics.units_per_em),
        );
        let value = match metric {
            abi::ADJUST_EX_HEIGHT => metrics.x_height.filter(|it| *it > 0.).or_else(|| top('x')),
            abi::ADJUST_CAP_HEIGHT => metrics
                .cap_height
                .filter(|it| *it > 0.)
                .or_else(|| top('H')),
            abi::ADJUST_CH_WIDTH => glyphs.advance_width(self.glyph('0')?.into()),
            abi::ADJUST_IC_WIDTH => Some(
                self.glyph('水')
                    .and_then(|it| glyphs.advance_width(it.into()))
                    .unwrap_or(em),
            ),
            _ => Some(
                self.glyph('水')
                    .and_then(|it| self.font.vmtx().ok()?.advance(it.into()))
                    .map_or(em, f32::from),
            ),
        };
        value.filter(|it| *it > 0.).map(|it| it / em)
    }

    fn axis(&self, tag: &[u8; 4]) -> Option<&Axis> {
        self.axes.iter().find(|axis| axis.tag == Tag::new(tag))
    }
}

/// Which font of a file has this PostScript name.
#[cfg(target_os = "macos")]
pub fn index_of(data: &[u8], name: &str) -> Option<u32> {
    use skrifa::raw::FileRef;
    use skrifa::string::StringId;
    let FileRef::Collection(collection) = FileRef::new(data).ok()? else {
        return Some(0);
    };
    (0..collection.len()).find(|index| {
        collection.get(*index).is_ok_and(|font| {
            let instances = font
                .named_instances()
                .iter()
                .filter_map(|instance| instance.postscript_name_id());
            let mut ids = std::iter::once(StringId::POSTSCRIPT_NAME).chain(instances);
            ids.any(|id| {
                font.localized_strings(id)
                    .any(|it| it.chars().eq(name.chars()))
            })
        })
    })
}

type PlanKey = (Script, bool, u64);

/// What `abi::Face::id` names. Never freed.
pub struct Face {
    pub id: u32,
    pub file: &'static File,
    pub embolden: bool,
    pub skew: bool,
    palette: Palette,
    pub shaper: Shaper<'static>,
    instance: &'static ShaperInstance,
    metrics: Metrics,
    plans: Mutex<FastMap<PlanKey, Arc<ShapePlan>>>,
}

impl Face {
    pub fn location(&self) -> LocationRef<'static> {
        LocationRef::new(self.instance.coords())
    }

    pub fn table(&self, tag: u32) -> Option<&'static [u8]> {
        Some(
            self.file
                .font
                .table_data(skrifa::Tag::from_u32(tag))?
                .as_bytes(),
        )
    }

    pub fn palette_color(&self, index: u16) -> Option<[u8; 4]> {
        use skrifa::raw::tables::cpal::PaletteType;
        let palettes = self.file.font.color_palettes();
        let first = |wanted| {
            (0..palettes.len()).find(|it| {
                palettes
                    .get(*it)
                    .and_then(|it| it.palette_type())
                    .is_some_and(|it| it.contains(wanted))
            })
        };
        let base = match self.palette.base {
            abi::PALETTE_LIGHT => first(PaletteType::USABLE_WITH_LIGHT_BACKGROUND),
            abi::PALETTE_DARK => first(PaletteType::USABLE_WITH_DARK_BACKGROUND),
            base => u16::try_from(base).ok().filter(|it| *it < palettes.len()),
        };
        let color = *palettes
            .get(base.unwrap_or(0))?
            .colors()
            .get(usize::from(index))?;
        let own = self
            .palette
            .overrides
            .iter()
            .rfind(|it| it[0] == u32::from(index));
        Some(
            own.map_or([color.red, color.green, color.blue, color.alpha], |it| {
                it[1].to_be_bytes()
            }),
        )
    }

    pub fn units_per_em(&self) -> f32 {
        self.metrics.units_per_em.into()
    }

    pub fn plan(&self, key: PlanKey, create: impl FnOnce() -> ShapePlan) -> Arc<ShapePlan> {
        self.plans
            .lock()
            .entry(key)
            .or_insert_with(|| Arc::new(create()))
            .clone()
    }

    /// Instead of the one in `hmtx`, which differs a little.
    pub fn bitmap_advance(&self, glyph: u32, size: f32) -> Option<f32> {
        let bitmap = self
            .file
            .font
            .bitmap_strikes()
            .glyph_for_size(Size::new(size), glyph.into())?;
        Some(bitmap.advance? * size / bitmap.ppem_x)
    }

    pub fn advance(&self, glyph: u32, size: f32) -> f32 {
        let metrics = self
            .file
            .font
            .glyph_metrics(Size::unscaled(), self.location());
        metrics.advance_width(glyph.into()).unwrap_or(0.) * size / self.units_per_em()
    }
}

static FACES: RwLock<Vec<&'static Face>> = RwLock::new(Vec::new());

pub fn face(id: u32) -> Option<&'static Face> {
    FACES.read().get(id as usize).copied()
}

type Range = (f32, f32);

#[derive(Clone, Copy, PartialEq)]
pub struct Capabilities {
    pub weight: Range,
    pub stretch: Range,
    /// In degrees, with italic as 14.
    pub slope: Range,
}

fn setting_tag(name: &str) -> Option<Tag> {
    Some(Tag::new(name.as_bytes().try_into().ok()?))
}

record! {
    default
    #[derive(Clone, Default)]
    struct Descriptors {
        scope: u32,
        family: String,
        local: Option<String>,
        weight: Option<Range>,
        stretch: Option<Range>,
        style: Option<String>,
        slope: Option<Range>,
        /// Among faces that match as well, the highest wins.
        order: u32,
        unicode_range: Option<Vec<(u32, u32)>>,
        size_adjust: Option<f32>,
        ascent_override: Option<f32>,
        descent_override: Option<f32>,
        line_gap_override: Option<f32>,
        features: Vec<(String, f32)>,
        variations: Vec<(String, f32)>,
    }
}

struct WebFont {
    id: u32,
    file: &'static File,
    capabilities: Capabilities,
    descriptors: Descriptors,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Description {
    pub scope: u32,
    pub families: Vec<u8>,
    pub weight: f32,
    pub stretch: f32,
    pub style: u8,
    pub synthesis: u8,
    pub optical_sizing: bool,
    pub kerning: bool,
    pub oblique_angle: f32,
    pub variations: Vec<abi::FontSetting>,
    pub features: Vec<abi::FontSetting>,
    pub language: Vec<u8>,
    pub device_scale: f32,
    pub language_override: [u8; 4],
    pub size_adjust: (u8, f32),
    pub emoji: u8,
    pub palette_family: Vec<u8>,
    pub palette: Palette,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Palette {
    pub base: u32,
    pub overrides: Vec<[u32; 2]>,
}

impl Description {
    pub fn new(families: &[u8], weight: f32) -> Description {
        Description {
            scope: 0,
            families: families.to_vec(),
            weight,
            stretch: 100.,
            style: abi::FONT_NORMAL,
            synthesis: abi::SYNTHESIZE_WEIGHT | abi::SYNTHESIZE_STYLE,
            optical_sizing: true,
            kerning: true,
            oblique_angle: DEFAULT_OBLIQUE_ANGLE,
            variations: Vec::new(),
            features: Vec::new(),
            language: Vec::new(),
            device_scale: 1.,
            language_override: [0; 4],
            size_adjust: (abi::ADJUST_NONE, 0.),
            emoji: abi::EMOJI_NORMAL,
            palette_family: Vec::new(),
            palette: Palette::default(),
        }
    }

    fn hash(&self) -> u64 {
        let mut hasher = FastHasher::default();
        (self.scope, &self.families, self.style, &self.language).hash(&mut hasher);
        (
            self.weight.to_bits(),
            self.stretch.to_bits(),
            self.size_adjust.1.to_bits(),
            &self.palette,
        )
            .hash(&mut hasher);
        for setting in self.variations.iter().chain(&self.features) {
            (setting.tag, setting.value.to_bits()).hash(&mut hasher);
        }
        hasher.finish()
    }

    fn slope(&self) -> f32 {
        match self.style {
            abi::FONT_ITALIC => DEFAULT_OBLIQUE_ANGLE,
            abi::FONT_OBLIQUE => self.oblique_angle,
            _ => 0.,
        }
    }
}

/// A font that a description can draw with.
pub struct Candidate {
    pub file: &'static File,
    pub size_adjust: f32,
    pub features: Vec<Feature>,
    pub features_hash: u64,
    /// Whether lowercase and uppercase letters are drawn as smaller capitals.
    pub shrinks: [bool; 2],
    palette: Palette,
    web: Option<Arc<WebFont>>,
    variations: Vec<(Tag, f32)>,
    optical_sizing: bool,
    /// Like its counterpart on Windows.
    is_taller: bool,
    embolden: bool,
    skew: bool,
    faces: SmallVec<(u32, &'static Face), 1>,
}

impl Candidate {
    fn is_for(&self, character: char) -> bool {
        let ranges = self
            .web
            .as_ref()
            .and_then(|web| web.descriptors.unicode_range.as_ref());
        ranges.is_none_or(|ranges| {
            ranges
                .iter()
                .any(|(low, high)| (*low..=*high).contains(&(character as u32)))
        })
    }

    pub fn covers(&self, character: char) -> bool {
        self.is_for(character) && self.file.covers(character)
    }

    /// Rounded like Blink's.
    pub fn line_metrics(&self, face: &Face, size: f32, device_scale: f32) -> abi::Face {
        let scale = size * device_scale / face.units_per_em();
        let descriptors = self.web.as_ref().map(|web| &web.descriptors);
        let (mut ascent, mut descent) = (
            (face.metrics.ascent * scale).round(),
            (-face.metrics.descent * scale).round(),
        );
        if cfg!(target_os = "linux")
            && device_scale >= 1.5
            && descent < -face.metrics.descent * scale
            && ascent >= 1.
        {
            (ascent, descent) = (ascent - 1., descent + 1.);
        }
        if self.is_taller {
            ascent += ((ascent + descent) * 0.15 + 0.5).floor();
        }
        let overridden = |value: Option<f32>, otherwise: f32| {
            value.map_or(otherwise, |value| (value * size * device_scale).round()) / device_scale
        };
        abi::Face {
            id: face.id,
            size,
            ascent: overridden(descriptors.and_then(|them| them.ascent_override), ascent),
            descent: overridden(descriptors.and_then(|them| them.descent_override), descent),
            line_gap: overridden(
                descriptors.and_then(|them| them.line_gap_override),
                (face.metrics.leading * scale).round(),
            ),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Presentation {
    Any,
    PrefersColor,
    Color,
    Text,
}

pub struct Resolved {
    pub candidates: Vec<Candidate>,
    /// The ones after these were added as fallbacks.
    listed: usize,
    primary: usize,
    /// The candidate for each ASCII character, plus one, once it is known.
    ascii: [u16; 128],
    fallbacks: FastMap<(char, Presentation), u16>,
    pub language: Option<harfrust::Language>,
    pub device_scale: f32,
    emoji: u8,
}

struct Described {
    description: Description,
    resolved: Option<Resolved>,
}

struct System {
    catalog: Catalog,
    files: FastMap<(u64, u32), Option<&'static File>>,
    families: FastMap<FamilyId, Arc<[(Font, Capabilities)]>>,
    fallbacks: FastMap<(char, bool, u64), Option<FamilyId>>,
}

#[derive(Default)]
struct Instances(FastMap<(usize, Vec<NormalizedCoord>, bool, bool, Palette), &'static Face>);

pub struct Fonts {
    system: System,
    instances: Instances,
    described: Vec<Described>,
    ids: FastMap<u64, SmallVec<u32, 1>>,
    web: Vec<Arc<WebFont>>,
    /// By the address of the data.
    web_files: FastMap<usize, Option<&'static File>>,
    next_web_id: u32,
}

pub static FONTS: LazyLock<Mutex<Fonts>> = LazyLock::new(|| {
    Mutex::new(Fonts {
        system: System {
            catalog: Catalog::new(),
            files: FastMap::default(),
            families: FastMap::default(),
            fallbacks: FastMap::default(),
        },
        instances: Instances::default(),
        described: Vec::new(),
        ids: FastMap::default(),
        web: Vec::new(),
        web_files: FastMap::default(),
        next_web_id: 1,
    })
});

/// Smaller is better: https://drafts.csswg.org/css-fonts-4/#font-style-matching
fn distance(wanted: &Description, offered: &Capabilities) -> (f32, f32, f32) {
    const OTHER_DIRECTION: f32 = 10_000.;
    let directed = |wanted: f32, (low, high): Range, prefers_lower: bool| {
        if wanted > high {
            wanted - high + if prefers_lower { 0. } else { OTHER_DIRECTION }
        } else if wanted < low {
            low - wanted + if prefers_lower { OTHER_DIRECTION } else { 0. }
        } else {
            0.
        }
    };
    let weight = match (wanted.weight, offered.weight) {
        (weight, (low, _)) if (400. ..=500.).contains(&weight) && low > weight => {
            low - weight
                + if low <= 500. {
                    0.
                } else {
                    OTHER_DIRECTION * 2.
                }
        }
        (weight, range) => directed(weight, range, weight < 400.),
    };
    let slope = wanted.slope();
    (
        directed(wanted.stretch, offered.stretch, wanted.stretch <= 100.),
        match slope < 0. {
            true => directed(slope, offered.slope, slope <= -11.),
            false => directed(slope, offered.slope, slope < 11.),
        },
        weight,
    )
}

/// What Chromium gets from Fontconfig for a family of the system.
fn nearest(wanted: &Description, offered: &Capabilities) -> (f32, f32, f32) {
    const WEIGHTS: [(f32, f32); 12] = [
        (100., 0.),
        (200., 40.),
        (300., 50.),
        (350., 55.),
        (380., 75.),
        (400., 80.),
        (500., 100.),
        (600., 180.),
        (700., 200.),
        (800., 205.),
        (900., 210.),
        (1000., 215.),
    ];
    let scaled = |weight: f32| {
        let above = WEIGHTS
            .partition_point(|(css, _)| *css < weight)
            .clamp(1, WEIGHTS.len() - 1);
        let ((from, low), (to, high)) = (WEIGHTS[above - 1], WEIGHTS[above]);
        low + (high - low) * (weight - from) / (to - from)
    };
    let outside = |wanted: f32, (low, high): Range| (low - wanted).max(wanted - high).max(0.);
    let (lightest, boldest) = offered.weight;
    // The bolder one wins a tie.
    let weight = outside(
        scaled(wanted.weight) + 0.01,
        (scaled(lightest), scaled(boldest)),
    );
    (
        distance(wanted, offered).1,
        weight,
        outside(wanted.stretch, offered.stretch),
    )
}

fn best<'a, T>(
    wanted: &Description,
    fonts: &'a [T],
    capabilities: impl Fn(&T) -> Capabilities,
    is_system: bool,
) -> Option<&'a T> {
    let distance = if is_system && cfg!(not(any(target_os = "macos", target_os = "windows"))) {
        nearest
    } else {
        distance
    };
    fonts.iter().min_by(|a, b| {
        let (a, b) = (
            distance(wanted, &capabilities(a)),
            distance(wanted, &capabilities(b)),
        );
        a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
    })
}

/// What Chromium accepts from fontconfig in place of the family that was asked for.
fn metric_aliases(name: &str) -> &'static [&'static str] {
    match name.to_ascii_lowercase().as_str() {
        "arial" | "helvetica" => &["Arial", "Liberation Sans", "Arimo"],
        "times new roman" | "times" => &["Times New Roman", "Liberation Serif", "Tinos"],
        "courier new" | "courier" => &["Courier New", "Liberation Mono", "Cousine"],
        "calibri" => &["Carlito"],
        "cambria" => &["Caladea"],
        "georgia" => &["Gelasio"],
        _ => &[],
    }
}

impl System {
    fn file(&mut self, font: &Font) -> Option<&'static File> {
        *self
            .files
            .entry(Catalog::identity(font))
            .or_insert_with(|| {
                let (data, index) = self.catalog.load(font)?;
                File::load(data, index)
            })
    }

    fn fonts(&mut self, family: FamilyId) -> Arc<[(Font, Capabilities)]> {
        self.families
            .entry(family)
            .or_insert_with(|| self.catalog.fonts(family))
            .clone()
    }

    fn named(&mut self, name: &str) -> Option<FamilyId> {
        if cfg!(target_os = "macos") && name.eq_ignore_ascii_case("BlinkMacSystemFont") {
            return self.generic("system-ui");
        }
        let aliases = metric_aliases(name)
            .iter()
            .filter(|_| cfg!(all(unix, not(target_os = "macos"))));
        std::iter::once(&name)
            .chain(aliases)
            .find_map(|name| self.catalog.family(name))
    }

    /// With the defaults of Chromium's settings.
    fn generic(&mut self, name: &str) -> Option<FamilyId> {
        let by_platform = |macos, windows, other| match std::env::consts::OS {
            "macos" => macos,
            "windows" => windows,
            _ => other,
        };
        let preferred = match name {
            "serif" => by_platform("Times", "Times New Roman", "Times New Roman"),
            "sans-serif" => by_platform("Helvetica", "Arial", "Arial"),
            "monospace" => by_platform("Menlo", "Consolas", ""),
            "cursive" => {
                return self.named(by_platform(
                    "Apple Chancery",
                    "Comic Sans MS",
                    "Comic Sans MS",
                ));
            }
            "fantasy" => return self.named(by_platform("Papyrus", "Impact", "Impact")),
            "system-ui" | "emoji" | "math" | "fangsong" => "",
            // Chromium does not know the `ui-*` families, and style sheets list what it is to use after them.
            _ => return None,
        };
        self.named(preferred).or_else(|| self.catalog.generic(name))
    }

    fn covers(&mut self, family: FamilyId, character: char, color: bool) -> bool {
        let regular = self.regular_candidate(family, &Description::new(&[], 400.));
        regular.is_some_and(|regular| regular.file.has_color == color && regular.covers(character))
    }

    fn fallback(&mut self, character: char, color: bool, language: &[u8]) -> Option<FamilyId> {
        let language = if Script::of(character) == Script::HAN {
            language
        } else {
            &[]
        };
        let mut hasher = FastHasher::default();
        language.hash(&mut hasher);
        let key = (character, color, hasher.finish());
        if let Some(found) = self.fallbacks.get(&key) {
            return *found;
        }
        let families = self.catalog.fallbacks(character, color, language);
        let found = families
            .into_iter()
            .find(|family| self.covers(*family, character, color));
        crate::diagnostics::log!("fallback for {character:?}: {found:?}");
        self.fallbacks.insert(key, found);
        found
    }

    /// `local()` names a face by its full or PostScript name.
    fn local(&mut self, name: &str) -> Option<&'static File> {
        let font = self.catalog.by_full_name(name)?;
        self.file(&font)
    }

    fn candidate(&mut self, family: FamilyId, wanted: &Description) -> Option<Candidate> {
        let fonts = self.fonts(family);
        let (font, capabilities) = best(wanted, &fonts, |(_, capabilities)| *capabilities, true)?;
        Some(candidate(self.file(font)?, *capabilities, None, wanted))
    }

    /// It tends to have more characters than the other faces.
    fn regular_candidate(&mut self, family: FamilyId, wanted: &Description) -> Option<Candidate> {
        let fonts = self.fonts(family);
        let (font, capabilities) = best(
            &Description::new(&[], 400.),
            &fonts,
            |(_, capabilities)| *capabilities,
            true,
        )?;
        Some(candidate(self.file(font)?, *capabilities, None, wanted))
    }
}

fn candidate(
    file: &'static File,
    offered: Capabilities,
    web: Option<Arc<WebFont>>,
    wanted: &Description,
) -> Candidate {
    let clamp = |value: f32, (low, high): Range| value.max(low).min(high);
    let slope = clamp(wanted.slope(), offered.slope);
    let mut variations = vec![
        (Tag::new(b"wght"), clamp(wanted.weight, offered.weight)),
        (Tag::new(b"wdth"), clamp(wanted.stretch, offered.stretch)),
    ];
    if wanted.style == abi::FONT_ITALIC && slope > 0. && file.axis(b"ital").is_some() {
        variations.push((Tag::new(b"ital"), 1.));
    } else {
        variations.push((Tag::new(b"slnt"), -slope));
    }
    let mut features = Vec::new();
    if !wanted.kerning {
        features.push((Tag::new(b"kern"), 0.));
    }
    if let Some(web) = &web {
        let settings = |settings: &[(String, f32)]| {
            let settings = settings
                .iter()
                .filter_map(|(name, value)| Some((setting_tag(name)?, *value)));
            settings.collect::<Vec<_>>()
        };
        variations.extend(settings(&web.descriptors.variations));
        features.extend(settings(&web.descriptors.features));
    }
    variations.extend(
        wanted
            .variations
            .iter()
            .map(|setting| (Tag::new(&setting.tag), setting.value)),
    );
    features.extend(
        wanted
            .features
            .iter()
            .map(|setting| (Tag::new(&setting.tag), setting.value)),
    );
    let has_optical_size = variations.iter().any(|(tag, _)| *tag == Tag::new(b"opsz"));

    let lacks = |tags: [&[u8; 4]; 2]| {
        wanted.synthesis & abi::SYNTHESIZE_SMALL_CAPS != 0
            && features
                .iter()
                .any(|(tag, value)| *value > 0. && tags.map(Tag::new).contains(tag))
            && !tags.iter().any(|tag| file.substitutes(tag))
    };
    let [lower, upper] = [lacks([b"smcp", b"pcap"]), lacks([b"c2sc", b"c2pc"])];
    let is_for_capitals = |tag: &Tag| [b"c2sc", b"c2pc"].map(Tag::new).contains(tag);
    let shrinks = [
        lower || upper,
        upper || lower && features.iter().any(|(tag, _)| is_for_capitals(tag)),
    ];
    if shrinks[0] {
        features.retain(|(tag, _)| {
            !is_for_capitals(tag) && ![b"smcp", b"pcap"].map(Tag::new).contains(tag)
        });
    }
    for (petite, small) in [(b"pcap", b"smcp"), (b"c2pc", b"c2sc")] {
        for (tag, _) in features
            .iter_mut()
            .filter(|(tag, _)| *tag == Tag::new(petite) && !file.substitutes(petite))
        {
            *tag = Tag::new(small);
        }
    }
    let mut hasher = FastHasher::default();
    (&wanted.language, wanted.language_override).hash(&mut hasher);
    for (tag, value) in &features {
        (tag, *value as u32).hash(&mut hasher);
    }
    let size_adjust = file
        .aspect(wanted.size_adjust.0, &variations)
        .map(|aspect| wanted.size_adjust.1 / aspect);
    Candidate {
        file,
        shrinks,
        palette: if file.has_color && wanted.palette_family.is_empty() {
            wanted.palette.clone()
        } else {
            Palette::default()
        },
        size_adjust: size_adjust
            .or(web.as_ref().and_then(|web| web.descriptors.size_adjust))
            .unwrap_or(1.),
        features: features
            .iter()
            .map(|(tag, value)| Feature::new(*tag, *value as u32, ..))
            .collect(),
        features_hash: hasher.finish(),
        variations,
        optical_sizing: wanted.optical_sizing && !has_optical_size && file.axis(b"opsz").is_some(),
        is_taller: cfg!(target_os = "macos")
            && web.is_none()
            && (file
                .font
                .localized_strings(StringId::FAMILY_NAME)
                .english_or_first())
            .is_some_and(|name| matches!(&*name.to_string(), "Times" | "Helvetica" | "Courier")),
        embolden: wanted.synthesis & abi::SYNTHESIZE_WEIGHT != 0
            && wanted.weight >= BOLD_THRESHOLD
            && offered.weight.1 < BOLD_THRESHOLD
            && !file.has_color,
        skew: wanted.synthesis & abi::SYNTHESIZE_STYLE != 0
            && wanted.slope() > 0.
            && offered.slope.1 <= 0.,
        web,
        faces: SmallVec::new(),
    }
}

impl Instances {
    fn get(&mut self, candidate: &Candidate, size: f32) -> &'static Face {
        let file = candidate.file;
        let optical_size = candidate
            .optical_sizing
            .then_some((Tag::new(b"opsz"), size));
        let settings = candidate.variations.iter().copied().chain(optical_size);
        let coords = file.font.axes().location(settings).coords().to_vec();
        let key = (
            std::ptr::from_ref(file).addr(),
            coords,
            candidate.embolden,
            candidate.skew,
            candidate.palette.clone(),
        );
        self.0.entry(key).or_insert_with_key(|(_, coords, ..)| {
            let instance = ShaperInstance::from_coords(&file.font, coords.iter().copied());
            let instance: &'static ShaperInstance = Box::leak(Box::new(instance));
            let mut faces = FACES.write();
            let face = Box::leak(Box::new(Face {
                id: faces.len() as u32,
                file,
                embolden: candidate.embolden,
                skew: candidate.skew,
                palette: candidate.palette.clone(),
                shaper: file
                    .shaper_data
                    .shaper(&file.font)
                    .instance(Some(instance))
                    .build(),
                instance,
                metrics: file
                    .font
                    .metrics(Size::unscaled(), LocationRef::new(coords)),
                plans: Mutex::default(),
            }));
            faces.push(face);
            face
        })
    }
}

fn family_names(families: &[u8]) -> impl Iterator<Item = (bool, &str)> {
    families
        .split(|byte| *byte == 0)
        .filter_map(|name| match name {
            [] => None,
            [abi::GENERIC_FAMILY, name @ ..] => Some((true, std::str::from_utf8(name).ok()?)),
            name => Some((false, std::str::from_utf8(name).ok()?)),
        })
}

fn resolve(wanted: &Description, system: &mut System, web: &[Arc<WebFont>]) -> Resolved {
    let mut candidates = Vec::new();
    let mut with_palette = 0..0;
    for (is_generic, name) in family_names(&wanted.families) {
        with_palette.end = with_palette.end.min(candidates.len());
        if name.as_bytes() == wanted.palette_family {
            with_palette = candidates.len()..usize::MAX;
        }
        let mut declared: Vec<_> = (web.iter().rev())
            .filter(|font| !is_generic && font.descriptors.scope == wanted.scope)
            .filter(|font| font.descriptors.family.eq_ignore_ascii_case(name))
            .collect();
        declared.sort_by_key(|font| std::cmp::Reverse(font.descriptors.order));
        if let Some(chosen) = best(wanted, &declared, |font| font.capabilities, false) {
            let segments = declared
                .iter()
                .filter(|font| font.capabilities == chosen.capabilities);
            candidates.extend(segments.map(|font| {
                candidate(font.file, font.capabilities, Some((*font).clone()), wanted)
            }));
            continue;
        }
        let family = if is_generic {
            system.generic(name)
        } else {
            system.named(name)
        };
        crate::diagnostics::log!(
            "font family {name:?} is {}",
            if family.is_some() {
                "installed"
            } else {
                "missing"
            }
        );
        candidates.extend(family.and_then(|family| system.candidate(family, wanted)));
    }
    for candidate in candidates
        .iter_mut()
        .take(with_palette.end)
        .skip(with_palette.start)
    {
        candidate.palette = wanted.palette.clone();
    }
    let language = match wanted.language_override {
        [0, ..] => wanted.language.clone(),
        tag => format!("x-hbot-{:08x}", u32::from_be_bytes(tag)).into_bytes(),
    };
    let last_resort = ["Times New Roman", "Times"]
        .into_iter()
        .find_map(|name| system.named(name));
    let last_resort = last_resort.or_else(|| system.generic("sans-serif"));
    candidates.extend(last_resort.and_then(|family| system.candidate(family, wanted)));
    Resolved {
        listed: candidates.len(),
        primary: candidates
            .iter()
            .position(|candidate| candidate.is_for(' '))
            .unwrap_or(0),
        candidates,
        ascii: [0; 128],
        fallbacks: FastMap::default(),
        language: harfrust::Language::new(&language),
        emoji: wanted.emoji,
        device_scale: wanted.device_scale,
    }
}

pub fn is_default_ignorable(character: char) -> bool {
    matches!(character as u32,
        0xAD | 0x34F | 0x61C | 0x115F..=0x1160 | 0x17B4..=0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F
        | 0x202A..=0x202E | 0x2060..=0x206F | 0x3164 | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF0..=0xFFF8
        | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF)
}

impl Fonts {
    pub fn resolved(&mut self, font: u32) -> Option<&mut Resolved> {
        let described = self.described.get_mut(font as usize)?;
        let resolved = (described.resolved)
            .get_or_insert_with(|| resolve(&described.description, &mut self.system, &self.web));
        Some(resolved).filter(|resolved| !resolved.candidates.is_empty())
    }

    pub fn primary(&mut self, font: u32) -> Option<usize> {
        Some(self.resolved(font)?.primary)
    }

    pub fn may_shrink(&mut self, font: u32) -> bool {
        self.resolved(font)
            .is_some_and(|it| it.candidates.iter().any(|it| it.shrinks != [false; 2]))
    }

    pub fn shrinks(&mut self, font: u32, candidate: usize, character: char) -> bool {
        let shrinks = self
            .resolved(font)
            .map_or([false; 2], |it| it.candidates[candidate].shrinks);
        shrinks != [false; 2] && shrinks[usize::from(character.to_uppercase().eq([character]))]
    }

    /// The first candidate, if it has all that is printable of ASCII.
    pub fn primary_for_ascii(&mut self, font: u32) -> Option<usize> {
        const PRINTABLE: u128 = (1 << 0x7F) - (1 << 0x20);
        let first = &self.resolved(font)?.candidates[0];
        let has_ranges = first
            .web
            .as_ref()
            .is_some_and(|web| web.descriptors.unicode_range.is_some());
        (first.file.ascii & PRINTABLE == PRINTABLE && !has_ranges).then_some(0)
    }

    /// The index of the candidate that draws a grapheme cluster. `recent` has the fallbacks for the text before it.
    pub fn select(
        &mut self,
        font: u32,
        cluster: &str,
        presentation: Presentation,
        recent: &mut Vec<usize>,
    ) -> Option<usize> {
        let resolved = self.resolved(font)?;
        if let [byte] = cluster.as_bytes()
            && let Some(index) = resolved.ascii[usize::from(*byte)].checked_sub(1)
        {
            return Some(index.into());
        }
        let first = cluster.chars().next()?;
        let is_open = matches!(presentation, Presentation::Any | Presentation::PrefersColor)
            && unicode::is_emoji(first);
        let presentation = match resolved.emoji {
            abi::EMOJI_AS_TEXT if is_open => Presentation::Text,
            abi::EMOJI_IN_COLOR if is_open && !first.is_ascii() => Presentation::Color,
            _ => presentation,
        };
        let suits = |candidate: &Candidate| match presentation {
            Presentation::Color => candidate.file.has_color,
            Presentation::Text => !candidate.file.has_color,
            _ => true,
        };
        let covers_all = |candidate: &Candidate| {
            (cluster.chars())
                .all(|character| is_default_ignorable(character) || candidate.covers(character))
        };
        let listed = &resolved.candidates[..resolved.listed];
        let found = listed
            .iter()
            .position(|candidate| suits(candidate) && covers_all(candidate));
        let is_text = matches!(presentation, Presentation::Any | Presentation::Text);
        let found = found.or_else(|| {
            recent
                .iter()
                .copied()
                .find(|index| is_text && covers_all(&resolved.candidates[*index]))
        });
        let index = found.unwrap_or_else(|| {
            let index = self.select_fallback(font, first, presentation);
            recent.extend(is_text.then_some(index));
            index
        });
        if let [byte] = cluster.as_bytes() {
            self.resolved(font)?.ascii[usize::from(*byte)] = index as u16 + 1;
        }
        Some(index)
    }

    fn select_fallback(&mut self, font: u32, character: char, presentation: Presentation) -> usize {
        let Described {
            description,
            resolved,
        } = &mut self.described[font as usize];
        let resolved = resolved.as_mut().expect("`select` resolved it");
        if let Some(index) = resolved.fallbacks.get(&(character, presentation)) {
            return (*index).into();
        }
        let color = matches!(
            presentation,
            Presentation::Color | Presentation::PrefersColor
        );
        let mut listed = resolved.candidates[..resolved.listed].iter();
        let listed = listed.position(|candidate| candidate.covers(character));
        let mut from_system = |color: bool| {
            let family = self
                .system
                .fallback(character, color, &description.language)?;
            let fallback = self
                .system
                .candidate(family, description)
                .filter(|it| it.covers(character));
            let fallback =
                fallback.or_else(|| self.system.regular_candidate(family, description))?;
            let mut added = resolved.candidates[resolved.listed..].iter();
            let existing = added.position(|candidate| std::ptr::eq(candidate.file, fallback.file));
            Some(
                existing
                    .map(|index| index + resolved.listed)
                    .unwrap_or_else(|| {
                        resolved.candidates.push(fallback);
                        resolved.candidates.len() - 1
                    }),
            )
        };
        // A listed font that has the base character lacks a mark, or has the other presentation.
        let index = match presentation {
            Presentation::Any | Presentation::PrefersColor => listed.or_else(|| from_system(color)),
            _ => from_system(color).or(listed),
        };
        let index = index
            .or_else(|| from_system(!color))
            .unwrap_or(resolved.primary);
        resolved
            .fallbacks
            .insert((character, presentation), index as u16);
        index
    }

    /// `size` is before `size-adjust`.
    pub fn instance(&mut self, font: u32, index: usize, size: f32) -> (&Resolved, &'static Face) {
        let resolved = self.described[font as usize]
            .resolved
            .as_mut()
            .expect("it was resolved");
        let candidate = &mut resolved.candidates[index];
        let key = if candidate.optical_sizing {
            size.to_bits()
        } else {
            0
        };
        let known = candidate
            .faces
            .iter()
            .find(|(size, _)| *size == key)
            .map(|(_, face)| *face);
        let face = known.unwrap_or_else(|| {
            let face = self.instances.get(candidate, size);
            candidate.faces.truncate(15);
            candidate.faces.insert(0, (key, face));
            face
        });
        (resolved, face)
    }

    fn invalidate(&mut self, scope: u32) {
        for described in &mut self.described {
            if described.description.scope == scope {
                described.resolved = None;
            }
        }
    }

    fn register(&mut self, arguments: &Value) -> Result<u32> {
        let descriptors = Descriptors::deserialize(arguments)?;
        let file = match &descriptors.local {
            Some(name) => self
                .system
                .local(name)
                .context("there is no such local font")?,
            None => {
                let data = decoded::decode(bridge::blob(&arguments["blob"])?, true);
                let file = data.and_then(|data| {
                    *self
                        .web_files
                        .entry(data.as_ptr() as usize)
                        .or_insert_with(|| File::load(data, 0))
                });
                file.context("the font could not be decoded")?
            }
        };
        Ok(self.add_web_font(file, descriptors))
    }

    fn add_web_font(&mut self, file: &'static File, descriptors: Descriptors) -> u32 {
        let axis = |tag, normal: f32| {
            file.axis(tag)
                .map_or((normal, normal), |axis| (axis.min, axis.max))
        };
        let ordered = |(a, b): Range| (a.min(b), a.max(b));
        let capabilities = Capabilities {
            weight: descriptors
                .weight
                .map_or_else(|| axis(b"wght", 400.), ordered),
            stretch: descriptors
                .stretch
                .map_or_else(|| axis(b"wdth", 100.), ordered),
            slope: match descriptors.style.as_deref() {
                Some("italic" | "oblique") => descriptors
                    .slope
                    .map_or((DEFAULT_OBLIQUE_ANGLE, DEFAULT_OBLIQUE_ANGLE), ordered),
                Some(_) => (0., 0.),
                None => file
                    .axis(b"slnt")
                    .map_or((0., 0.), |axis| (-axis.max, -axis.min)),
            },
        };
        let id = self.next_web_id;
        self.next_web_id += 1;
        self.invalidate(descriptors.scope);
        self.web.push(Arc::new(WebFont {
            id,
            file,
            capabilities,
            descriptors,
        }));
        id
    }
}

/// Lists the system's fonts and opens the one that most interfaces use, on another thread.
pub fn prewarm() {
    let work = || {
        let candidate = {
            let system = &mut FONTS.lock().system;
            let family = system.generic("system-ui");
            family.and_then(|family| system.candidate(family, &Description::new(&[], 400.)))
        };
        if let Some(candidate) = candidate {
            candidate.file.reach();
            if !cfg!(target_os = "macos") {
                candidate.file.glyph_styles();
            }
        }
    };
    std::thread::Builder::new()
        .name("fonts".into())
        .spawn(work)
        .ok();
}

pub fn describe(description: Description) -> u32 {
    let fonts = &mut *FONTS.lock();
    let ids = fonts.ids.entry(description.hash()).or_default();
    let known = ids
        .iter()
        .find(|id| fonts.described[**id as usize].description == description);
    known.copied().unwrap_or_else(|| {
        ids.push(fonts.described.len() as u32);
        fonts.described.push(Described {
            description,
            resolved: None,
        });
        fonts.described.len() as u32 - 1
    })
}

record! {
    required
    /// A font for the next run.
    pub struct Recipe {
        families: Vec<u8>,
        numbers: [f32; 4],
        style: [u8; 2],
        switches: [bool; 2],
        settings: [Vec<([u8; 4], f32)>; 2],
        language: Vec<u8>,
        web: Option<Descriptors>,
        pub size_adjust: f32,
    }
}

impl Recipe {
    /// With the file, if the system does not have it.
    pub fn of(face: u32) -> Option<(Recipe, Option<&'static [u8]>)> {
        FONTS.lock().described.iter().rev().find_map(
            |Described {
                 description: it,
                 resolved,
             }| {
                let resolved = resolved
                    .as_ref()
                    .filter(|_| it.size_adjust.0 == abi::ADJUST_NONE)?;
                let candidate = resolved.candidates[..resolved.listed]
                    .iter()
                    .find(|it| it.faces.iter().any(|(_, it)| it.id == face))?;
                let web = candidate.web.as_ref().map(|web| web.descriptors.clone());
                let file = web
                    .as_ref()
                    .filter(|web| web.local.is_none())
                    .map(|_| candidate.file.data);
                let recipe = Recipe {
                    families: it.families.clone(),
                    numbers: [it.weight, it.stretch, it.oblique_angle, it.device_scale],
                    style: [it.style, it.synthesis],
                    switches: [it.optical_sizing, it.kerning],
                    settings: [&it.variations, &it.features]
                        .map(|it| it.iter().map(|it| (it.tag, it.value)).collect()),
                    language: it.language.clone(),
                    web,
                    size_adjust: candidate.size_adjust,
                };
                Some((recipe, file))
            },
        )
    }

    pub fn describe(&self, file: &std::path::Path) -> Option<u32> {
        const SCOPE: u32 = u32::MAX;
        if let Some(web) = &self.web {
            let fonts = &mut *FONTS.lock();
            let file = match &web.local {
                Some(name) => fonts.system.local(name)?,
                None => File::load(decoded::map(file)?, 0)?,
            };
            fonts.add_web_font(
                file,
                Descriptors {
                    scope: SCOPE,
                    ..web.clone()
                },
            );
        }
        let ([weight, stretch, oblique_angle, device_scale], [style, synthesis]) =
            (self.numbers, self.style);
        let settings = |it: &[([u8; 4], f32)]| {
            it.iter()
                .map(|&(tag, value)| abi::FontSetting { tag, value })
                .collect()
        };
        Some(describe(Description {
            scope: SCOPE,
            stretch,
            style,
            synthesis,
            optical_sizing: self.switches[0],
            kerning: self.switches[1],
            oblique_angle,
            variations: settings(&self.settings[0]),
            features: settings(&self.settings[1]),
            language: self.language.clone(),
            device_scale,
            ..Description::new(&self.families, weight)
        }))
    }
}

pub fn metrics(font: u32, size: f32) -> FontMetrics {
    let fonts = &mut *FONTS.lock();
    let Some(primary) = fonts.primary(font) else {
        return FontMetrics {
            ascent: (size * 0.8).round(),
            descent: (size * 0.2).round(),
            x_height: size * 0.5,
            cap_height: size * 0.7,
            zero_advance: size * 0.5,
            ideograph_advance: size,
            space_advance: size * 0.25,
            underline_offset: size * 0.1,
            underline_thickness: size / 16.,
            average_advance: size * 0.5,
            widest_advance: size * 0.5,
            ..FontMetrics::default()
        };
    };
    let (resolved, face) = fonts.instance(font, primary, size);
    let candidate = &resolved.candidates[primary];
    let size = size * candidate.size_adjust;
    let (line, scale) = (
        candidate.line_metrics(face, size, resolved.device_scale),
        size / face.units_per_em(),
    );
    let advance = |character, otherwise: f32| {
        (face.file.glyph(character)).map_or(otherwise, |glyph| face.advance(glyph, size))
    };
    let height = |declared: Option<f32>, character, otherwise: f32| {
        let measured = || {
            let glyphs = face
                .file
                .font
                .glyph_metrics(Size::unscaled(), face.location());
            Some(glyphs.bounds(face.file.glyph(character)?.into())?.y_max)
        };
        let declared = declared
            .filter(|height| *height > 0.)
            .map(|height| height * scale);
        declared
            .or_else(|| Some((measured()? * scale).round()))
            .unwrap_or(otherwise)
    };
    let underline = face
        .metrics
        .underline
        .filter(|underline| underline.thickness > 0.);
    let (zero_advance, is_apple) = (advance('0', size * 0.5), cfg!(target_os = "macos"));
    let declared = face
        .metrics
        .average_width
        .filter(|width| *width > 0. && !is_apple)
        .map(|width| width * scale);
    let average = declared.unwrap_or_else(|| advance('x', size * 0.5));
    let bounds = face.metrics.bounds.filter(|_| !is_apple);
    let widest = bounds.map_or(line.ascent, |bounds| {
        ((bounds.x_max - bounds.x_min) * scale).round()
    });
    let is_usable = average <= zero_advance * 1.7;
    FontMetrics {
        average_advance: if is_usable {
            average.max(average.round())
        } else {
            zero_advance
        },
        widest_advance: if is_usable { widest } else { zero_advance },
        ascent: line.ascent,
        descent: line.descent,
        line_gap: line.line_gap,
        x_height: height(face.metrics.x_height, 'x', line.ascent * 0.56),
        cap_height: height(face.metrics.cap_height, 'H', line.ascent),
        zero_advance,
        ideograph_advance: advance('水', size),
        space_advance: advance(' ', size * 0.25),
        underline_offset: underline.map_or(size * 0.1, |underline| -underline.offset * scale),
        underline_thickness: underline.map_or(size / 16., |underline| underline.thickness * scale),
    }
}

/// The ascent and the descent, scaled to add up to the size.
pub fn em_box(font: u32, size: f32) -> (f32, f32) {
    let fonts = &mut *FONTS.lock();
    let Some(primary) = fonts.primary(font) else {
        return (size * 0.8, size * 0.2);
    };
    let (resolved, face) = fonts.instance(font, primary, size);
    let size = size * resolved.candidates[primary].size_adjust;
    let typographic = face.file.font.os2().ok();
    let typographic = typographic.map(|os2| {
        (
            f32::from(os2.s_typo_ascender()),
            -f32::from(os2.s_typo_descender()),
        )
    });
    let is_usable =
        |(ascent, descent): &(f32, f32)| *ascent >= 0. && *descent >= 0. && ascent + descent > 0.;
    let (ascent, descent) = typographic
        .filter(is_usable)
        .unwrap_or((face.metrics.ascent, -face.metrics.descent));
    let ascent = (ascent * size / (ascent + descent).max(1.) * 64.).round() / 64.;
    (ascent, size - ascent)
}

pub fn command(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    if name == "decode" {
        let bytes = bridge::blob(arguments)?;
        let Some(reply) = reply else {
            return Ok(decoded::decode(bytes, false).is_some().into());
        };
        bridge::in_background(reply, move || {
            Ok(decoded::decode(bytes, true).is_some().into())
        });
        return Ok(Value::Null);
    }
    let fonts = &mut *FONTS.lock();
    let number = |key: &str| arguments[key].as_u64().unwrap_or(0) as u32;
    match name {
        "register" => return Ok(fonts.register(arguments)?.into()),
        "unregister" => {
            if let Some(index) = fonts.web.iter().position(|font| font.id == number("id")) {
                let font = fonts.web.remove(index);
                fonts.invalidate(font.descriptors.scope);
            }
        }
        "order" => {
            let Some(font) = fonts.web.iter_mut().find(|font| font.id == number("id")) else {
                return Ok(false.into());
            };
            let descriptors = Descriptors {
                order: number("order"),
                ..font.descriptors.clone()
            };
            *font = Arc::new(WebFont {
                id: font.id,
                file: font.file,
                capabilities: font.capabilities,
                descriptors,
            });
            let font = font.clone();
            let is_rival = |it: &Arc<WebFont>| {
                let (a, b) = (&it.descriptors, &font.descriptors);
                it.id != font.id
                    && a.scope == b.scope
                    && it.capabilities == font.capabilities
                    && a.family.eq_ignore_ascii_case(&b.family)
            };
            let matters = fonts.web.iter().any(is_rival);
            if matters {
                fonts.invalidate(font.descriptors.scope);
            }
            return Ok(matters.into());
        }
        "dropScope" => {
            fonts
                .web
                .retain(|font| font.descriptors.scope != number("scope"));
            fonts.invalidate(number("scope"));
        }
        "families" => {
            let mut names: Vec<&str> = fonts.system.catalog.family_names().collect();
            names.sort_unstable();
            return Ok(json!(names));
        }
        _ => bail!("unknown command font.{name}"),
    }
    Ok(Value::Null)
}

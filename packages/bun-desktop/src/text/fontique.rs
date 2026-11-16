//! The system's fonts.

use std::sync::Arc;

use fontique::{
    Collection, CollectionOptions, FallbackKey, FontStyle, GenericFamily, Language, SourceCache,
};
pub use fontique::{FamilyId, FontInfo as Font};
use rustc_hash::FxHashMap;
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider as _, Tag};
use unicode_script::{Script, UnicodeScript as _};

use super::fonts::{Capabilities, DEFAULT_OBLIQUE_ANGLE};

const SYMBOL_FAMILIES: &[&str] = &[
    "Segoe UI",
    "Segoe UI Symbol",
    "Cambria Math",
    "Lucida Sans Unicode",
    "Microsoft YaHei",
    "Segoe UI Historic",
];

pub struct Catalog {
    collection: Collection,
    sources: SourceCache,
    full_names: Option<FxHashMap<String, Font>>,
}

impl Catalog {
    pub fn new() -> Catalog {
        let collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: true,
        });
        Catalog {
            collection,
            sources: SourceCache::default(),
            full_names: None,
        }
    }

    pub fn identity(font: &Font) -> (u64, u32) {
        (font.source().id().to_u64(), font.index())
    }

    pub fn load(&mut self, font: &Font) -> Option<(&'static [u8], u32)> {
        Some((
            Box::leak(Box::new(font.load(Some(&mut self.sources))?)).data(),
            font.index(),
        ))
    }

    pub fn family(&mut self, name: &str) -> Option<FamilyId> {
        self.collection.family_id(name)
    }

    pub fn family_names(&mut self) -> impl Iterator<Item = &str> {
        self.collection.family_names()
    }

    pub fn generic(&mut self, name: &str) -> Option<FamilyId> {
        self.collection
            .generic_families(GenericFamily::parse(name)?)
            .next()
    }

    pub fn fonts(&mut self, family: FamilyId) -> Arc<[(Font, Capabilities)]> {
        let info = self.collection.family(family);
        info.iter()
            .flat_map(|info| info.fonts())
            .map(|font| (font.clone(), capabilities(font)))
            .collect()
    }

    /// The families that may have the character, the best one first.
    pub fn fallbacks(&mut self, character: char, color: bool, language: &[u8]) -> Vec<FamilyId> {
        let script = character.script();
        let mut families: Vec<FamilyId> = Vec::new();
        if color {
            families.extend(self.collection.generic_families(GenericFamily::Emoji));
        } else {
            if !matches!(script, Script::Common | Script::Inherited | Script::Unknown) {
                let language = std::str::from_utf8(language).ok();
                let language =
                    language.and_then(|language| Some(Language::parse_prefix(language).ok()?.0));
                let script = fontique::Script::from_bytes(script.as_iso15924_tag().to_be_bytes());
                families.extend(
                    self.collection
                        .fallback_families(FallbackKey::new(script, language.as_ref())),
                );
            }
            families.extend(
                SYMBOL_FAMILIES
                    .iter()
                    .filter_map(|name| self.collection.family_id(name)),
            );
            families.extend(self.collection.generic_families(GenericFamily::SansSerif));
        }
        if !matches!(character as u32, 0xE000..=0xF8FF | 0xF0000..) && script != Script::Unknown {
            let mut names: Vec<String> =
                self.collection.family_names().map(str::to_owned).collect();
            names.sort_unstable();
            families.extend(
                names
                    .iter()
                    .filter_map(|name| self.collection.family_id(name)),
            );
        }
        families
    }

    pub fn by_full_name(&mut self, name: &str) -> Option<Font> {
        if self.full_names.is_none() {
            let families: Vec<String> = self.collection.family_names().map(str::to_owned).collect();
            let mut names = FxHashMap::default();
            for family in families {
                let Some(family) = self.collection.family_by_name(&family) else {
                    continue;
                };
                for info in family.fonts() {
                    let Some(blob) = info.load(None) else {
                        continue;
                    };
                    let Ok(font) = FontRef::from_index(blob.data(), info.index()) else {
                        continue;
                    };
                    for id in [StringId::FULL_NAME, StringId::POSTSCRIPT_NAME] {
                        for name in font.localized_strings(id) {
                            names.insert(name.to_string().to_lowercase(), info.clone());
                        }
                    }
                }
            }
            self.full_names = Some(names);
        }
        self.full_names.as_ref()?.get(&name.to_lowercase()).cloned()
    }
}

fn capabilities(font: &Font) -> Capabilities {
    let axis = |tag: &[u8; 4]| font.axes().iter().find(|axis| axis.tag == Tag::new(tag));
    let range = |tag, fixed: f32| axis(tag).map_or((fixed, fixed), |axis| (axis.min, axis.max));
    let slope = match font.style() {
        FontStyle::Normal => 0.,
        FontStyle::Italic => DEFAULT_OBLIQUE_ANGLE,
        FontStyle::Oblique(angle) => angle.map_or(DEFAULT_OBLIQUE_ANGLE, |_| DEFAULT_OBLIQUE_ANGLE),
    };
    Capabilities {
        weight: range(b"wght", font.weight().value()),
        stretch: range(b"wdth", font.width().percentage()),
        slope: match (axis(b"slnt"), axis(b"ital")) {
            (Some(slant), _) => (-slant.max, -slant.min),
            (None, Some(italic)) => (
                italic.min * DEFAULT_OBLIQUE_ANGLE,
                italic.max * DEFAULT_OBLIQUE_ANGLE,
            ),
            _ => (slope, slope),
        },
    }
}

//! Remembers how words were shaped.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::ops::Range;

use harfrust::{
    BufferFlags, Direction, Feature, Language, ShapeOptions, ShapePlan, Tag, UnicodeBuffer,
};
use rustc_hash::{FxHashMap, FxHasher};
use unicode_script::Script;

use super::fonts::Face;
use super::reach::Reach;

/// What variations add to kerning is not a whole number of font units.
pub const STEPS_PER_UNIT: i32 = 64;

/// In steps.
#[derive(Clone, Copy)]
pub struct Placed {
    pub cluster: u32,
    pub advance: i32,
    pub id: u16,
    pub dx: i32,
    pub dy: i32,
}

#[derive(Clone, Copy)]
pub struct Shaping<'a> {
    pub face: &'static Face,
    pub size: f32,
    pub script: Script,
    pub is_rtl: bool,
    pub is_vertical: bool,
    pub capitalizes: bool,
    pub language: Option<&'a Language>,
    pub features: &'a [Feature],
    pub features_hash: u64,
}

impl Shaping<'_> {
    fn run(
        &self,
        text: &str,
        range: Range<usize>,
        buffer: &mut Option<UnicodeBuffer>,
        to: &mut Vec<Placed>,
    ) {
        let direction = match (self.is_vertical, self.is_rtl) {
            (true, _) => Direction::TopToBottom,
            (_, true) => Direction::RightToLeft,
            _ => Direction::LeftToRight,
        };
        let script =
            harfrust::Script::from_iso15924_tag(Tag::from_u32(self.script.as_iso15924_tag()));
        let mut input = buffer.take().unwrap_or_default();
        for (offset, character) in text[range.clone()].char_indices() {
            match self.capitalizes {
                true => character
                    .to_uppercase()
                    .for_each(|it| input.add(it, (range.start + offset) as u32)),
                false => input.add(character, (range.start + offset) as u32),
            }
        }
        input.set_pre_context(&text[..range.start]);
        input.set_post_context(&text[range.end..]);
        input.set_direction(direction);
        input.set_flags(BufferFlags::REMOVE_DEFAULT_IGNORABLES);
        if let Some(script) = script {
            input.set_script(script);
        }
        if let Some(language) = self.language {
            input.set_language(language.clone());
        }
        let plan = self
            .face
            .plan((self.script, self.is_rtl, self.features_hash), || {
                ShapePlan::new(
                    &self.face.shaper,
                    direction,
                    script,
                    self.language,
                    self.features,
                )
            });
        let options = ShapeOptions::new()
            .plan(Some(&plan))
            .features(self.features)
            .point_size(Some(self.size));
        let options = options.scale(Some(self.face.shaper.units_per_em() * STEPS_PER_UNIT));
        let shaped = self.face.shaper.shape(input, options);
        to.extend(
            shaped
                .glyph_infos()
                .iter()
                .zip(shaped.glyph_positions())
                .map(|(info, position)| Placed {
                    cluster: info.cluster,
                    advance: position.x_advance - position.y_advance,
                    id: info.glyph_id as u16,
                    dx: position.x_offset,
                    dy: position.y_offset,
                }),
        );
        *buffer = Some(shaped.clear());
    }

    fn identity(&self) -> u64 {
        let mut hasher = FxHasher::default();
        let size = if self.face.file.has_tracking {
            self.size.to_bits()
        } else {
            0
        };
        (self.face.id, self.script, self.features_hash, size).hash(&mut hasher);
        hasher.finish()
    }
}

/// A word and the space after it.
struct Word {
    shaping: u64,
    /// With what it depends on around it.
    text: Range<u32>,
    glyphs: Range<u32>,
}

#[derive(Default)]
pub struct Words {
    known: FxHashMap<u64, Word>,
    text: Vec<u8>,
    glyphs: Vec<Placed>,
    buffer: Option<UnicodeBuffer>,
    unknown: Vec<Unknown>,
    scratch: Vec<Placed>,
}

struct Unknown {
    hash: u64,
    shaping: u64,
    word: Range<usize>,
    context: Range<usize>,
}

thread_local! {
    pub static WORDS: RefCell<Words> = RefCell::default();
}

/// Adds the space before `word` and what is in reach, as far as it is in `item`.
fn widen(text: &str, word: &Range<usize>, item: &Range<usize>, reach: Reach) -> Range<usize> {
    let before = text[item.start..word.start]
        .chars()
        .rev()
        .take(reach.before + 1);
    let after = text[word.end..item.end].chars().take(reach.after);
    word.start - before.map(char::len_utf8).sum::<usize>()
        ..word.end + after.map(char::len_utf8).sum::<usize>()
}

impl Words {
    /// Shapes the words that were not found, which follow each other.
    fn learn(&mut self, shaping: &Shaping, text: &str, to: &mut Vec<Placed>) {
        let (Some(first), Some(last)) = (self.unknown.first(), self.unknown.last()) else {
            return;
        };
        self.scratch.clear();
        shaping.run(
            text,
            first.context.start..last.context.end,
            &mut self.buffer,
            &mut self.scratch,
        );
        let mut rest = &self.scratch[self
            .scratch
            .partition_point(|it| (it.cluster as usize) < first.word.start)..];
        for Unknown {
            hash,
            shaping,
            word,
            context,
        } in self.unknown.drain(..)
        {
            let (glyphs, after) =
                rest.split_at(rest.partition_point(|it| (it.cluster as usize) < word.end));
            rest = after;
            to.extend(glyphs);
            let (text_start, glyphs_start) = (self.text.len() as u32, self.glyphs.len() as u32);
            self.text.extend(text[context].as_bytes());
            self.glyphs.extend(glyphs.iter().map(|it| Placed {
                cluster: it.cluster - word.start as u32,
                ..*it
            }));
            let (text, glyphs) = (
                text_start..self.text.len() as u32,
                glyphs_start..self.glyphs.len() as u32,
            );
            self.known.insert(
                hash,
                Word {
                    shaping,
                    text,
                    glyphs,
                },
            );
        }
    }

    pub fn shape(
        &mut self,
        shaping: &Shaping,
        text: &str,
        item: Range<usize>,
        to: &mut Vec<Placed>,
    ) {
        const MAX_GLYPHS: usize = 1 << 16;
        const MAX_REACH: usize = 12;
        let has_words = matches!(
            shaping.script,
            Script::Latin | Script::Common | Script::Cyrillic | Script::Greek
        );
        let reach = (has_words && !shaping.is_rtl)
            .then(|| shaping.face.file.reach())
            .flatten();
        let Some(reach) = reach.filter(|reach| reach.before + reach.after <= MAX_REACH) else {
            return shaping.run(text, item, &mut self.buffer, to);
        };
        if self.glyphs.len() > MAX_GLYPHS {
            self.known.clear();
            self.text.clear();
            self.glyphs.clear();
        }
        let (identity, bytes, mut start) = (shaping.identity(), text.as_bytes(), item.start);
        while start < item.end {
            let space = bytes[start..item.end].iter().position(|byte| *byte == b' ');
            let mut end = space.map_or(item.end, |space| start + space + 1);
            // A mark goes on the space before it.
            while end < item.end
                && !bytes[end].is_ascii()
                && !text[end..].starts_with(char::is_alphanumeric)
            {
                let space = bytes[end..item.end].iter().position(|byte| *byte == b' ');
                end = space.map_or(item.end, |space| end + space + 1);
            }
            let word = start..end;
            let context = widen(text, &word, &item, reach);
            let identity =
                identity ^ (start - context.start) as u64 ^ ((context.end - end) as u64) << 8;
            let mut hasher = FxHasher::default();
            (identity, &bytes[context.clone()]).hash(&mut hasher);
            let hash = hasher.finish();
            let is_it = |known: &&Word| {
                known.shaping == identity
                    && self.text[known.text.start as usize..known.text.end as usize]
                        == bytes[context.clone()]
            };
            match self
                .known
                .get(&hash)
                .filter(is_it)
                .map(|known| known.glyphs.clone())
            {
                Some(glyphs) => {
                    self.learn(shaping, text, to);
                    let glyphs = &self.glyphs[glyphs.start as usize..glyphs.end as usize];
                    to.extend(glyphs.iter().map(|it| Placed {
                        cluster: it.cluster + start as u32,
                        ..*it
                    }));
                }
                None => self.unknown.push(Unknown {
                    hash,
                    shaping: identity,
                    word,
                    context,
                }),
            }
            start = end;
        }
        self.learn(shaping, text, to);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::fonts::FONTS;
    use crate::text::{Description, command, describe};

    #[test]
    fn makes_no_difference() {
        let text = "To  AVAT. \"Type\" Y a -> b => c != d, (A) fi ffl 1/2 x:y 12:30 - T - Te\u{301}st W. A' T' -- www <!-- x --> \
            1 000 000 \u{301}a A - B a - b A : B ( A ) x * 2 2 x 2 \u{2192} f f i T o Another , . ! ? L ' T \
            averyveryveryveryveryveryveryveryveryveryveryverylongword T ";
        let families = command("families", &serde_json::Value::Null, None).unwrap();
        let (mut words, mut buffer) = (Words::default(), None);
        for family in families.as_array().unwrap() {
            let font = describe(Description::new(family.as_str().unwrap().as_bytes(), 400.));
            let fonts = &mut *FONTS.lock();
            let Some(primary) = fonts.primary(font) else {
                continue;
            };
            let (face, script) = (fonts.instance(font, primary, 16.).1, Script::Latin);
            let shaping = Shaping {
                face,
                size: 16.,
                script,
                is_rtl: false,
                is_vertical: false,
                capitalizes: false,
                language: None,
                features: &[],
                features_hash: 0,
            };
            for (start, _) in text.char_indices().step_by(2) {
                let (mut expected, mut actual) = (Vec::new(), Vec::new());
                shaping.run(text, start..text.len(), &mut buffer, &mut expected);
                words.shape(&shaping, text, start..text.len(), &mut actual);
                let plain = |glyphs: Vec<Placed>| -> Vec<_> {
                    glyphs
                        .iter()
                        .map(|it| (it.cluster, it.id, it.advance, it.dx, it.dy))
                        .collect()
                };
                assert_eq!(plain(actual), plain(expected), "{family} from {start}");
            }
        }
    }
}

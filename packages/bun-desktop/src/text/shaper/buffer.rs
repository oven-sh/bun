//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use std::ops::Range;

use crate::unicode::{self, category};

pub const IGNORABLE: u16 = 1;
/// Ignorable, but it takes part in matching.
pub const HIDDEN: u16 = 2;
/// Of a grapheme cluster.
pub const CONTINUES: u16 = 4;
pub const JOINER: u16 = 8;
pub const NON_JOINER: u16 = 16;
pub const IS_MISSING_SPACE: u16 = 32;

pub const BASE: u16 = 2;
pub const LIGATURE: u16 = 4;
pub const MARK: u16 = 8;
pub const SUBSTITUTED: u16 = 16;
pub const LIGATED: u16 = 32;
pub const MULTIPLIED: u16 = 64;

#[derive(Clone, Copy, Default, PartialEq)]
pub enum Attachment {
    #[default]
    None,
    Mark,
    Cursive,
}

#[derive(Clone, Copy, Default)]
pub struct Glyph {
    pub character: u32,
    pub id: u32,
    pub cluster: u32,
    /// The features that apply.
    pub mask: u32,
    pub flags: u16,
    /// With the mark attachment class in the high half.
    pub class: u16,
    pub category: u8,
    pub combining: u8,
    /// An id in the 3 high bits, whether this is the ligature, and then how many components it has or which one this belongs to.
    pub ligature: u8,
    pub syllable: u8,
    /// For the rules of a script.
    pub kind: u8,
    pub place: u8,
    pub attachment: Attachment,
    pub attached_to: i16,
    pub advance: [i32; 2],
    pub offset: [i32; 2],
}

/// Puts marks in the order that fonts expect.
fn modified_combining_class(character: u32) -> u8 {
    const HEBREW_AND_ARABIC: [u8; 27] = [
        22, 15, 16, 17, 23, 18, 19, 20, 21, 14, 24, 12, 25, 13, 10, 11, 26, 28, 29, 30, 31, 32, 33,
        27, 34, 35, 36,
    ];
    match (character, unicode::combining_class(character)) {
        (0x1A60 | 0xFC6, _) => 254,
        (0xF39, _) => 127,
        (_, class @ 10..=36) => HEBREW_AND_ARABIC[usize::from(class) - 10],
        (_, 84) => 4,
        (_, 91) => 5,
        (_, 103) => 3,
        (_, 130) => 132,
        (_, 132) => 131,
        (_, class) => class,
    }
}

impl Glyph {
    pub fn set_character(&mut self, character: u32) {
        (self.character, self.category, self.flags, self.combining) =
            (character, category::of(character), 0, 0);
        if character < 0x80 {
            return;
        }
        if unicode::is_invisible(character) {
            self.flags = IGNORABLE
                | match character {
                    0x200C => NON_JOINER,
                    0x200D => JOINER,
                    0x34F | 0x180B..=0x180D | 0x180F | 0xE0020..=0xE007F => HIDDEN,
                    _ => 0,
                };
        }
        if self.is_unicode_mark() {
            self.flags |= CONTINUES;
            self.combining = modified_combining_class(character);
        }
    }

    pub fn is_unicode_mark(&self) -> bool {
        matches!(
            self.category,
            category::NON_SPACING_MARK | category::ENCLOSING_MARK | category::SPACING_MARK
        )
    }

    pub fn is_ignorable(&self) -> bool {
        self.flags & IGNORABLE != 0 && self.class & SUBSTITUTED == 0
    }

    pub fn is_mark(&self) -> bool {
        self.class & MARK != 0
    }

    pub fn ligature_id(&self) -> u8 {
        self.ligature >> 5
    }

    pub fn component(&self) -> u8 {
        if self.ligature & 16 != 0 {
            0
        } else {
            self.ligature & 15
        }
    }

    pub fn component_count(&self) -> u8 {
        if self.class & LIGATURE != 0 && self.ligature & 16 != 0 {
            self.ligature & 15
        } else {
            1
        }
    }
}

#[derive(Default)]
pub struct Buffer {
    pub glyphs: Vec<Glyph>,
    /// Up to 5 characters before, from the nearest one on, and after.
    pub context: [Vec<u32>; 2],
    pub max_len: usize,
    /// What a font may still have done.
    pub budget: i64,
    serial: u8,
}

impl Buffer {
    pub fn start(&mut self) {
        let len = self.glyphs.len();
        (self.max_len, self.budget, self.serial) =
            ((len * 32).max(8192), (len as i64 * 1024).max(16384), 0);
    }

    pub fn next_ligature_id(&mut self) -> u8 {
        self.serial = self.serial % 7 + 1;
        self.serial
    }

    pub fn merge_clusters(&mut self, Range { mut start, mut end }: Range<usize>) {
        let glyphs = &mut self.glyphs;
        let Some(cluster) = glyphs[start..end]
            .iter()
            .map(|it| it.cluster)
            .min()
            .filter(|_| end - start > 1)
        else {
            return;
        };
        while end < glyphs.len()
            && glyphs[end - 1].cluster != cluster
            && glyphs[end - 1].cluster == glyphs[end].cluster
        {
            end += 1;
        }
        while start > 0
            && glyphs[start].cluster != cluster
            && glyphs[start - 1].cluster == glyphs[start].cluster
        {
            start -= 1;
        }
        glyphs[start..end]
            .iter_mut()
            .for_each(|it| it.cluster = cluster);
    }

    pub fn remove(&mut self, index: usize) -> Glyph {
        self.budget -= (self.glyphs.len() - index) as i64 / 64;
        self.glyphs.remove(index)
    }

    pub fn replace(&mut self, range: Range<usize>, with: impl IntoIterator<Item = Glyph>) {
        self.budget -= (self.glyphs.len() - range.end) as i64 / 64;
        self.glyphs.splice(range, with);
    }

    /// The text of what is deleted goes to a neighbor.
    fn give_cluster_away(&mut self, kept: usize, index: usize) {
        let (cluster, glyphs) = (self.glyphs[index].cluster, &mut self.glyphs);
        if glyphs
            .get(index + 1)
            .is_some_and(|it| it.cluster == cluster)
        {
            return;
        }
        match kept.checked_sub(1).map(|it| glyphs[it].cluster) {
            Some(before) if cluster < before => glyphs[..kept]
                .iter_mut()
                .rev()
                .take_while(|it| it.cluster == before)
                .for_each(|it| it.cluster = cluster),
            None if index + 1 < glyphs.len() => self.merge_clusters(index..index + 2),
            _ => {}
        }
    }

    pub fn delete(&mut self, index: usize) {
        self.give_cluster_away(index, index);
        self.remove(index);
    }

    pub fn delete_all(&mut self, is_deleted: impl Fn(&Glyph) -> bool) {
        let mut kept = 0;
        for index in 0..self.glyphs.len() {
            if is_deleted(&self.glyphs[index]) {
                self.give_cluster_away(kept, index);
            } else {
                self.glyphs[kept] = self.glyphs[index];
                kept += 1;
            }
        }
        self.glyphs.truncate(kept);
    }

    /// A stable sort.
    pub fn sort(&mut self, range: Range<usize>, key: impl Fn(&Glyph) -> u8) {
        for index in range.start + 1..range.end {
            let to = (range.start..index)
                .rfind(|it| key(&self.glyphs[*it]) <= key(&self.glyphs[index]))
                .map_or(range.start, |it| it + 1);
            if to < index {
                self.merge_clusters(to..index + 1);
                self.glyphs[to..=index].rotate_right(1);
            }
        }
    }

    /// Where the run of glyphs from `start` on ends for which `goes_on` holds.
    pub fn end_of_run(&self, start: usize, goes_on: impl Fn(&Glyph) -> bool) -> usize {
        start
            + 1
            + self.glyphs[start + 1..]
                .iter()
                .take_while(|it| goes_on(it))
                .count()
    }

    pub fn end_of_syllable(&self, start: usize) -> usize {
        self.end_of_run(start, |it| it.syllable == self.glyphs[start].syllable)
    }
}

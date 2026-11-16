//! Turns characters into glyphs with positions. It follows the rules of HarfBuzz, which fonts are made for.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

mod apple;
mod arabic;
mod buffer;
mod fallback;
pub mod language;
pub mod layout;
mod normalize;
mod pattern;
mod plan;
mod position;
mod scripts;
mod substitute;
mod syllabic;

pub use buffer::{Buffer, Glyph};
use std::sync::atomic::Ordering::Relaxed;

use layout::{Apply, Definitions, Digest, Options, Table};
use plan::Kerning;
pub use plan::Plan;

use super::sfnt::variations::Coords;
use super::sfnt::{Data, Font, Tag};
use crate::unicode::{self, Script, category};

/// What variations add to kerning is not a whole number of font units.
pub const STEPS_PER_UNIT: i32 = 64;

#[derive(Clone, Copy, PartialEq)]
pub enum Direction {
    Right,
    Left,
    Down,
}

#[derive(Clone, Copy)]
pub struct Feature {
    pub tag: Tag,
    pub value: u32,
}

/// What a script needs beyond the lookups of the font.
#[derive(Clone, Copy, PartialEq)]
enum Rules {
    Default,
    /// The font has it all.
    None,
    Arabic,
    Hangul,
    Hebrew,
    Thai,
    Indic,
    Khmer,
    Myanmar,
    Universal,
}

#[derive(PartialEq)]
enum When {
    Early,
    Late,
}

impl Rules {
    fn of(script: Script, is_horizontal: bool, in_font: Option<Tag>) -> Rules {
        const UNIVERSAL: &str = "Tibt Mong Sinh Buhd Hano Tglg Tagb Limb Tale Bugi Khar Sylo Tfng Bali Nkoo Phag Cham Kali Lepc Rjng Saur \
            Sund Egyp Java Kthi Mtei Lana Tavt Batk Brah Mand Cakm Plrd Shrd Takr Dupl Gran Khoj Sind Mahj Mani Modi Hmng Phlp Sidd Tirh \
            Ahom Mult Adlm Bhks Marc Newa Gonm Soyo Zanb Dogr Gong Rohg Maka Medf Sogo Sogd Elym Nand Hmnp Wcho Chrs Diak Kits Yezi Cpmn \
            Ougr Tnsa Toto Vith Kawi Nagm Gara Gukh Krai Onao Sunu Todr Tutg Berf Sidt Tayo Tols";
        let is_generic = matches!(in_font.as_ref(), Some(b"DFLT" | b"latn"));
        match &script.0 {
            b"Arab" | b"Syrc"
                if is_horizontal && (script.0 == *b"Arab" || in_font != Some(*b"DFLT")) =>
            {
                Rules::Arabic
            }
            b"Thai" | b"Laoo" => Rules::Thai,
            b"Hang" => Rules::Hangul,
            b"Hebr" => Rules::Hebrew,
            b"Khmr" => Rules::Khmer,
            _ if is_generic => Rules::Default,
            b"Beng" | b"Deva" | b"Gujr" | b"Guru" | b"Knda" | b"Mlym" | b"Orya" | b"Taml"
            | b"Telu" => {
                if in_font.is_some_and(|it| it[3] == b'3') {
                    Rules::Universal
                } else {
                    Rules::Indic
                }
            }
            b"Mymr" if in_font != Some(*b"mymr") => Rules::Myanmar,
            tag if UNIVERSAL.split(' ').any(|it| it.as_bytes() == tag) => Rules::Universal,
            _ => Rules::Default,
        }
    }

    fn zeroes_marks(self) -> Option<When> {
        match self {
            Rules::Default | Rules::Arabic | Rules::Hebrew | Rules::Thai => Some(When::Late),
            Rules::Myanmar | Rules::Universal => Some(When::Early),
            _ => None,
        }
    }

    fn has_fallback_positions(self) -> bool {
        matches!(
            self,
            Rules::Default | Rules::Arabic | Rules::Hangul | Rules::Hebrew
        )
    }
}

/// Of a font file.
pub struct Tables {
    /// `GSUB` and `GPOS`
    pub layout: [Option<Table>; 2],
    definitions: Definitions,
    morx: Option<Data>,
    feat: Option<Data>,
    kerx: Option<Data>,
    ankr: Option<Data>,
    kern: Option<Data>,
    trak: Option<Data>,
}

impl Tables {
    pub fn new(font: &Font) -> Tables {
        Tables {
            layout: [b"GSUB", b"GPOS"].map(|it| Table::new(font, it)),
            definitions: Definitions::new(font),
            morx: font.table(b"morx"),
            feat: font.table(b"feat"),
            kerx: font.table(b"kerx"),
            ankr: font.table(b"ankr"),
            kern: font.table(b"kern"),
            trak: font
                .table(b"trak")
                .filter(|_| font.table(b"STAT").is_some()),
        }
    }
}

pub struct Shaper<'a> {
    pub font: &'a Font,
    pub tables: &'a Tables,
    pub coords: &'a Coords,
    pub plan: &'a Plan,
    pub size: f32,
}

fn is_written_leftwards(script: Script) -> Option<bool> {
    const LEFTWARDS: &str = "Arab Hebr Syrc Thaa Cprt Khar Phnx Nkoo Lydi Avst Armi Phli Prti Sarb Orkh Samr Mand Merc Mero Mani Mend Nbat \
        Narb Palm Phlp Hatr Adlm Rohg Sogo Sogd Elym Chrs Yezi Ougr Gara Sidt";
    let is_open = matches!(&script.0, b"Hung" | b"Ital" | b"Runr" | b"Tfng");
    (!is_open).then(|| {
        !matches!(&script.0, b"Latn" | b"Zyyy" | b"Hani")
            && LEFTWARDS.split(' ').any(|it| it.as_bytes() == script.0)
    })
}

fn form_clusters(buffer: &mut Buffer) {
    let is_flag = |glyph: &Glyph| (0x1F1E6..=0x1F1FF).contains(&glyph.character);
    let mut start = 0;
    for index in 0..buffer.glyphs.len() {
        let (before, glyph) = (
            index.checked_sub(1).map(|it| buffer.glyphs[it]),
            &mut buffer.glyphs[index],
        );
        glyph.set_character(glyph.character);
        let continues = match glyph.character {
            ..0xA9 => false,
            0x200D | 0xFF9E..=0xFF9F | 0x1F3FB..=0x1F3FF | 0xE0020..=0xE007F => true,
            _ if is_flag(glyph) => {
                before.is_some_and(|it| is_flag(&it) && it.flags & buffer::CONTINUES == 0)
            }
            character => {
                before.is_some_and(|it| it.character == 0x200D)
                    && unicode::is_pictographic(character)
            }
        };
        glyph.flags |= if continues { buffer::CONTINUES } else { 0 };
        start = if glyph.flags & buffer::CONTINUES == 0 || index == 0 {
            glyph.cluster
        } else {
            start
        };
        glyph.cluster = start;
    }
}

/// Fonts expect text in the direction of its script.
fn turn_to_native(buffer: &mut Buffer, script: Script, direction: Direction) -> Direction {
    let Some(mut is_leftwards) =
        is_written_leftwards(script).filter(|_| direction != Direction::Down)
    else {
        return direction;
    };
    if is_leftwards && direction == Direction::Right {
        let has = |test: fn(&Glyph) -> bool| buffer.glyphs.iter().any(test);
        let is_numeric =
            has(|it| it.category == category::DIGIT || (0x1F1E6..=0x1F1FF).contains(&it.character));
        is_leftwards = !is_numeric || has(|it| category::is_letter(it.category));
    }
    if is_leftwards == (direction == Direction::Left) {
        return direction;
    }
    buffer
        .glyphs
        .chunk_by_mut(|_, next| next.flags & buffer::CONTINUES != 0)
        .for_each(<[Glyph]>::reverse);
    buffer.glyphs.reverse();
    if is_leftwards {
        Direction::Left
    } else {
        Direction::Right
    }
}

fn vertical_form(character: u32) -> Option<u32> {
    const FORMS: [(u16, u16); 35] = [
        (0x2013, 0xFE32),
        (0x2014, 0xFE31),
        (0x2025, 0xFE30),
        (0x2026, 0xFE19),
        (0x3001, 0xFE11),
        (0x3002, 0xFE12),
        (0x3008, 0xFE3F),
        (0x3009, 0xFE40),
        (0x300A, 0xFE3D),
        (0x300B, 0xFE3E),
        (0x300C, 0xFE41),
        (0x300D, 0xFE42),
        (0x300E, 0xFE43),
        (0x300F, 0xFE44),
        (0x3010, 0xFE3B),
        (0x3011, 0xFE3C),
        (0x3014, 0xFE39),
        (0x3015, 0xFE3A),
        (0x3016, 0xFE17),
        (0x3017, 0xFE18),
        (0xFE4F, 0xFE34),
        (0xFF01, 0xFE15),
        (0xFF08, 0xFE35),
        (0xFF09, 0xFE36),
        (0xFF0C, 0xFE10),
        (0xFF1A, 0xFE13),
        (0xFF1B, 0xFE14),
        (0xFF1F, 0xFE16),
        (0xFF3B, 0xFE47),
        (0xFF3D, 0xFE48),
        (0xFF3F, 0xFE33),
        (0xFF5B, 0xFE37),
        (0xFF5D, 0xFE38),
        (0xFF5F, 0xFF5F),
        (0xFF60, 0xFF60),
    ];
    FORMS
        .iter()
        .find(|it| u32::from(it.0) == character)
        .map(|it| it.1.into())
}

impl Shaper<'_> {
    fn advance(&self, glyph: u32) -> i32 {
        let slot = &self.plan.advances[glyph as usize % self.plan.advances.len()];
        let (key, known) = (u64::from(!glyph) << 32, slot.load(Relaxed));
        if known >> 32 == key >> 32 {
            return known as i32;
        }
        let advance = self
            .font
            .advance(glyph, self.coords)
            .map_or(i32::from(self.font.units_per_em / 2), |it| {
                it.clamp(-65536., 65536.) as i32
            })
            * STEPS_PER_UNIT;
        slot.store(key | u64::from(advance as u32), Relaxed);
        advance
    }

    fn rotate(&self, buffer: &mut Buffer) {
        let has_glyph = |it: &u32| self.font.glyph(*it).is_some();
        if self.plan.direction == Direction::Left {
            let mask = self.plan.bit(b"rtlm");
            for glyph in &mut buffer.glyphs {
                match Some(unicode::mirror(glyph.character))
                    .filter(|it| *it != glyph.character && has_glyph(it))
                {
                    Some(mirrored) => glyph.character = mirrored,
                    None => glyph.mask |= mask,
                }
            }
        } else if self.plan.direction == Direction::Down && self.plan.mask(b"vert") == 0 {
            buffer.glyphs.iter_mut().for_each(|it| {
                it.character = vertical_form(it.character)
                    .filter(has_glyph)
                    .unwrap_or(it.character)
            });
        }
    }

    fn set_fraction_masks(&self, glyphs: &mut [Glyph], direction: Direction) {
        let [fraction, upper, lower] = [b"frac", b"numr", b"dnom"].map(|it| self.plan.bit(it));
        let (before, after) = if direction == Direction::Left {
            (lower, upper)
        } else {
            (upper, lower)
        };
        for slash in (0..glyphs.len()).filter(|_| fraction != 0 || upper != 0 && lower != 0) {
            if glyphs[slash].character != 0x2044 {
                continue;
            }
            let (first, rest) = glyphs.split_at_mut(slash);
            let is_digit = |it: &&mut Glyph| it.category == category::DIGIT;
            if first.last_mut().is_some_and(|it| is_digit(&it))
                && rest.get_mut(1).is_some_and(|it| is_digit(&it))
            {
                first
                    .iter_mut()
                    .rev()
                    .take_while(is_digit)
                    .for_each(|it| it.mask |= fraction | before);
                rest[0].mask |= fraction;
                rest[1..]
                    .iter_mut()
                    .take_while(is_digit)
                    .for_each(|it| it.mask |= fraction | after);
            }
        }
    }

    fn apply(
        &self,
        table: usize,
        lookups: &[(u16, Options)],
        buffer: &mut Buffer,
        direction: Direction,
    ) {
        let (Some(table), Some(&(_, options))) = (&self.tables.layout[table], lookups.first())
        else {
            return;
        };
        let mut digest = Digest::default();
        buffer.glyphs.iter().for_each(|it| digest.add(it.id, it.id));
        let (definitions, coords, last_base) = (&self.tables.definitions, self.coords, (None, 0));
        let mut context = Apply {
            table,
            definitions,
            coords,
            direction,
            buffer,
            digest,
            at: 0,
            options,
            flags: 0,
            depth: 0,
            random: 1,
            last_base,
        };
        lookups
            .iter()
            .for_each(|&(index, options)| context.apply(index, options));
    }

    fn substitute(&self, buffer: &mut Buffer, direction: Direction) {
        for glyph in &mut buffer.glyphs {
            glyph.class = match self.tables.definitions.classes {
                Some(_) => self.tables.definitions.class(glyph.id),
                None if glyph.category == category::NON_SPACING_MARK && !glyph.is_ignorable() => {
                    buffer::MARK
                }
                None => buffer::BASE,
            };
        }
        if let Some(flags) = &self.plan.morx_flags {
            apple::substitute(self, flags, buffer, direction);
            for glyph in buffer
                .glyphs
                .iter_mut()
                .filter(|it| it.id == apple::DELETED)
            {
                (glyph.flags, glyph.category, glyph.combining) =
                    (glyph.flags | buffer::HIDDEN, category::FORMAT, 0);
            }
            return;
        }
        for stage in &self.plan.substitutions {
            self.apply(0, &stage.lookups, buffer, direction);
            stage
                .then
                .into_iter()
                .for_each(|step| syllabic::take(step, self, buffer));
        }
    }

    fn position(&self, buffer: &mut Buffer, direction: Direction) {
        let (plan, lines) = (
            self.plan,
            (direction == Direction::Down).then(|| self.font.em_lines()),
        );
        for glyph in &mut buffer.glyphs {
            let Some([ascent, descent]) = lines else {
                glyph.advance[0] = self.advance(glyph.id);
                continue;
            };
            let (height, steps) = (ascent - descent, |units: f32| {
                units.clamp(-65536., 65536.) as i32 * STEPS_PER_UNIT
            });
            let centered = || {
                self.font
                    .bounds(glyph.id, self.coords)
                    .map(|it| it.y + it.height + ((height - it.height) / 2.).floor())
            };
            let top = self
                .font
                .vertical_origin(glyph.id, self.coords)
                .or_else(centered)
                .unwrap_or(ascent);
            glyph.advance[1] = -steps(
                self.font
                    .vertical_advance(glyph.id, self.coords)
                    .unwrap_or(height),
            );
            glyph.offset = [
                self.advance(glyph.id) / STEPS_PER_UNIT / -2 * STEPS_PER_UNIT,
                -steps(top),
            ];
        }
        buffer
            .glyphs
            .iter_mut()
            .filter(|it| it.id == apple::DELETED)
            .for_each(|it| it.advance = [0; 2]);
        fallback::size_spaces(self, &mut buffer.glyphs, direction);
        let moves_marks = plan.moves_zeroed_marks && direction != Direction::Left;
        let zero_marks = |buffer: &mut Buffer, when: When| {
            for mark in buffer.glyphs.iter_mut().filter(|it| {
                plan.zeroes_marks
                    && plan.rules.zeroes_marks().as_ref() == Some(&when)
                    && it.is_mark()
            }) {
                fallback::zero(mark, moves_marks);
            }
        };
        zero_marks(buffer, When::Early);
        if plan.uses_gpos {
            self.apply(1, &plan.positions, buffer, direction);
        }
        match plan.kerning {
            Kerning::Kerx if !plan.uses_gpos => apple::kern_with_kerx(self, buffer, direction),
            Kerning::Kern => apple::kern(self, buffer, direction),
            _ => None,
        };
        apple::track(self, &mut buffer.glyphs, direction);
        zero_marks(buffer, When::Late);
        for glyph in buffer.glyphs.iter_mut().filter(|it| it.is_ignorable()) {
            (glyph.advance, glyph.offset) = ([0; 2], [0; 2]);
        }
        position::finish(&mut buffer.glyphs, direction);
        if plan.places_marks {
            fallback::place_marks(self, &mut buffer.glyphs, direction, moves_marks);
        }
    }

    /// The glyphs have a character and a cluster, and end up in visual order.
    pub fn shape(&self, buffer: &mut Buffer) {
        let plan = self.plan;
        buffer.start();
        buffer
            .glyphs
            .iter_mut()
            .for_each(|it| it.mask = plan.global_mask);
        form_clusters(buffer);
        let direction = turn_to_native(buffer, plan.script, plan.direction);
        match plan.rules {
            Rules::Hangul => scripts::compose_hangul(self, buffer),
            Rules::Thai => {
                scripts::decompose_sara_am(buffer);
                if plan.script.0 == *b"Thai" && plan.chosen_script != Some(*b"thai") {
                    scripts::shift_thai_marks(self, buffer);
                }
            }
            Rules::Indic | Rules::Universal => syllabic::separate_vowels(buffer),
            _ => {}
        }
        self.rotate(buffer);
        normalize::normalize(self, buffer);
        self.set_fraction_masks(&mut buffer.glyphs, direction);
        match plan.rules {
            Rules::Arabic => {
                let forms = arabic::set_masks(plan, buffer);
                arabic::use_presentation_forms(self.font, plan, buffer, &forms);
            }
            Rules::Hangul => scripts::set_hangul_masks(plan, buffer),
            _ => syllabic::classify(plan, buffer),
        }
        if plan.places_marks {
            fallback::reclassify_marks(&mut buffer.glyphs);
        }
        self.substitute(buffer, direction);
        if plan.morx_flags.is_some() && plan.uses_gpos {
            buffer.delete_all(|it| it.id == apple::DELETED);
        }
        self.position(buffer, direction);
        if direction == Direction::Left {
            buffer.glyphs.reverse();
        }
        buffer.delete_all(|it| {
            it.is_ignorable() || it.id == apple::DELETED && plan.morx_flags.is_some()
        });
    }
}

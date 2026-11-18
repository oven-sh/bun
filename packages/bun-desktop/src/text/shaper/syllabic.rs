//! Scripts that are shaped syllable by syllable.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

mod indic;
mod kinds;

use std::collections::BTreeSet;
use std::ops::Range;
use std::sync::LazyLock;

use super::buffer::{Buffer, Glyph, LIGATED, SUBSTITUTED};
use super::pattern::Pattern;
use super::plan::{Builder, GLOBAL, MANUAL, MANUAL_JOINERS, PER_SYLLABLE, Plan};
use super::{Rules, Shaper, arabic};
use crate::unicode;
use kinds::place;

#[derive(Clone, Copy)]
pub enum Step {
    Find,
    Reorder,
    ReorderAgain,
    Forget,
    ForgetSubstitutions,
    NoteRepha,
    NotePreBase,
}

pub fn add_features(rules: Rules, builder: &mut Builder) {
    const BY_SYLLABLE: u8 = GLOBAL | MANUAL_JOINERS | PER_SYLLABLE;
    if !matches!(
        rules,
        Rules::Indic | Rules::Khmer | Rules::Myanmar | Rules::Universal
    ) {
        return;
    }
    builder.pause(Some(Step::Find));
    if rules == Rules::Khmer {
        builder.pause(Some(Step::Reorder));
    }
    builder.add(&[b"locl", b"ccmp"], GLOBAL | PER_SYLLABLE);
    match rules {
        Rules::Indic => indic::add_features(builder),
        Rules::Khmer => {
            builder.add(
                &[b"pref", b"blwf", b"abvf", b"pstf", b"cfar"],
                MANUAL | PER_SYLLABLE,
            );
            builder.pause(Some(Step::Forget));
            builder.add(&[b"pres", b"abvs", b"blws", b"psts"], GLOBAL | MANUAL);
        }
        Rules::Myanmar => {
            builder.pause(Some(Step::Reorder));
            for feature in [b"rphf", b"pref", b"blwf", b"pstf"] {
                builder.add(&[feature], BY_SYLLABLE);
                builder.pause(None);
            }
            builder.pause(Some(Step::Forget));
            builder.add(
                &[b"pres", b"abvs", b"blws", b"psts"],
                GLOBAL | MANUAL_JOINERS,
            );
        }
        _ => {
            builder.add(&[b"nukt"], GLOBAL | PER_SYLLABLE);
            builder.add(&[b"akhn"], BY_SYLLABLE);
            builder.pause(Some(Step::ForgetSubstitutions));
            builder.add(&[b"rphf"], BY_SYLLABLE & !GLOBAL);
            builder.pause(Some(Step::NoteRepha));
            builder.pause(Some(Step::ForgetSubstitutions));
            builder.add(&[b"pref"], BY_SYLLABLE);
            builder.pause(Some(Step::NotePreBase));
            builder.add(
                &[
                    b"rkrf", b"abvf", b"blwf", b"half", b"pstf", b"vatu", b"cjct",
                ],
                BY_SYLLABLE,
            );
            builder.pause(Some(Step::Reorder));
            builder.pause(Some(Step::Forget));
            builder.add(&[b"isol", b"init", b"medi", b"fina"], 0);
            builder.pause(None);
            builder.add(
                &[b"abvs", b"blws", b"haln", b"pres", b"psts"],
                GLOBAL | MANUAL_JOINERS,
            );
        }
    }
}

pub fn override_features(rules: Rules, builder: &mut Builder) {
    match rules {
        Rules::Hangul if builder.is_on(b"calt") => builder.add(&[b"calt"], 0),
        Rules::Indic => {
            builder.disable(b"liga");
            builder.pause(Some(Step::Forget));
        }
        Rules::Khmer => {
            builder.add(&[b"clig"], GLOBAL);
            builder.disable(b"liga");
        }
        _ => {}
    }
}

pub fn decompose(rules: Rules, character: u32) -> Option<(u32, u32)> {
    match (rules, character) {
        (Rules::Indic, 0x931 | 0x9DC | 0x9DD | 0xB94) => None,
        (Rules::Khmer, 0x17BE..=0x17C0 | 0x17C4 | 0x17C5) => Some((0x17C1, character)),
        _ => unicode::decompose(character),
    }
}

/// Some sequences look like another vowel, and get a dotted circle in between.
pub fn separate_vowels(buffer: &mut Buffer) {
    /// A character, and what may not follow it.
    const INVALID: &str = "\u{b85}\u{bc2} \
        \u{905}\u{93a}\u{93b}\u{93e}\u{945}\u{946}\u{949}\u{94a}\u{94b}\u{94c}\u{94f}\u{956}\u{957} \
        \u{906}\u{93a}\u{945}\u{946}\u{947}\u{948} \u{909}\u{941} \u{90f}\u{945}\u{946}\u{947} \u{985}\u{9be} \u{98b}\u{9c3} \
        \u{98c}\u{9e2} \u{a05}\u{a3e}\u{a48}\u{a4c} \u{a72}\u{a3f}\u{a40}\u{a47} \u{a73}\u{a41}\u{a42}\u{a4b} \
        \u{a85}\u{abe}\u{ac5}\u{ac7}\u{ac8}\u{ac9}\u{acb}\u{acc} \u{ac5}\u{abe} \u{b05}\u{b3e} \u{b0f}\u{b57} \u{b13}\u{b57} \
        \u{c12}\u{c4c}\u{c55} \u{c3f}\u{c55} \u{c46}\u{c55} \u{c4a}\u{c55} \u{c89}\u{cbe} \u{c8b}\u{cbe} \u{c92}\u{ccc} \u{d07}\u{d57} \
        \u{d09}\u{d57} \u{d0e}\u{d46} \u{d12}\u{d3e}\u{d57} \u{d85}\u{dcf}\u{dd0}\u{dd1} \u{d8b}\u{ddf} \u{d8f}\u{ddf} \u{d94}\u{ddf} \
        \u{d8d}\u{dd8} \u{d91}\u{dca}\u{dd9}\u{dda}\u{ddc}\u{ddd}\u{dde} \u{11005}\u{11038} \u{1100b}\u{1103e} \u{1100f}\u{11042} \
        \u{11200}\u{1122c}\u{11231}\u{11233} \u{11206}\u{1122c} \u{1122c}\u{11230}\u{11231} \u{11240}\u{1122e} \
        \u{112b0}\u{112e0}\u{112e5}\u{112e6}\u{112e7}\u{112e8} \u{11481}\u{114b0} \u{1148b}\u{114ba} \u{1148d}\u{114ba} \
        \u{114aa}\u{114b5}\u{114b6} \u{11600}\u{11639}\u{1163a} \u{11601}\u{11639}\u{1163a} \u{11680}\u{116ad}\u{116b4}\u{116b5} \
        \u{11686}\u{116b2}";
    static PAIRS: LazyLock<BTreeSet<(u32, u32)>> = LazyLock::new(|| {
        INVALID
            .split(' ')
            .flat_map(|it| it.chars().take(1).cycle().zip(it.chars().skip(1)))
            .map(|(a, b)| (a.into(), b.into()))
            .collect()
    });
    let mut at = 1;
    while let Some(&[first, second]) = buffer.glyphs.get(at - 1..).and_then(|it| it.first_chunk()) {
        let is_after_repha = (first.character, second.character) == (0x94D, 0x907)
            && at > 1
            && buffer.glyphs[at - 2].character == 0x930;
        if is_after_repha || PAIRS.contains(&(first.character, second.character)) {
            let mut circle = second;
            circle.set_character(0x25CC);
            buffer.replace(at..at, [circle]);
            at += 2;
        }
        at += 1;
    }
}

fn joins_like_arabic(plan: &Plan) -> bool {
    let joining: [&[u8; 4]; 13] = [
        b"Adlm", b"Arab", b"Chrs", b"Rohg", b"Mand", b"Mani", b"Mong", b"Nkoo", b"Ougr", b"Phag",
        b"Phlp", b"Sogd", b"Syrc",
    ];
    joining.contains(&&plan.script.0)
}

pub fn classify(plan: &Plan, buffer: &mut Buffer) {
    match plan.rules {
        Rules::Indic | Rules::Khmer | Rules::Myanmar => buffer
            .glyphs
            .iter_mut()
            .for_each(|it| (it.kind, it.place) = kinds::indic(it.character)),
        Rules::Universal => {
            if joins_like_arabic(plan) {
                arabic::set_masks(plan, buffer);
            }
            buffer
                .glyphs
                .iter_mut()
                .for_each(|it| it.kind = kinds::universal(it.character, it.category));
        }
        _ => {}
    }
}

/// The types of syllables.
const REORDERED: u8 = 0;
const BROKEN: u8 = 1;
const AS_IT_IS: u8 = 2;
const OTHER: u8 = 3;

type Grammar = LazyLock<Vec<(Pattern, u8)>>;

fn grammar<const N: usize>(rules: [(String, u8); N]) -> Vec<(Pattern, u8)> {
    rules
        .iter()
        .map(|(source, kind)| (Pattern::new(source), *kind))
        .collect()
}

static INDIC: Grammar = LazyLock::new(|| {
    let modifier = "(n?r)?(NN?)?";
    let (consonant, halant, end) = (
        format!("[CR]j?{modifier}"),
        "[jn]?H(jN?)?",
        "([jn]?[St][St]?n?)?A*",
    );
    let tail = format!("({halant}{consonant})*c?({halant}|Hn|([jn]*(M|[St]?m)N?H?)*){end}");
    grammar([
        (format!("[ps]?{consonant}{tail}"), REORDERED),
        (format!("(RH|p)?V{modifier}(j|{tail})"), REORDERED),
        (format!("([ps]?P|(RH|p)?D){modifier}{tail}"), REORDERED),
        (format!("YN?{end}"), AS_IT_IS),
        ("t".into(), OTHER),
        (format!("(RH|p)?{modifier}{tail}"), BROKEN),
    ])
});

static KHMER: Grammar = LazyLock::new(|| {
    let (consonant, signs) = ("[CRV]([jn]?O)?", "([jn]*X)*");
    let rest = format!(
        "O?(H{consonant})*(H|{signs}e?{signs}b?{signs}([jn]?a)?{signs}o?{signs}(H[CRV])?y*)"
    );
    grammar([
        (format!("({consonant}|[PD]){rest}"), REORDERED),
        (rest, BROKEN),
    ])
});

static MYANMAR: Grammar = LazyLock::new(|| {
    let tail = "(H[CRV]v?)*(H|Z*i?Z?u?((wh?l?|hl?|l)Z?)?(ev?)*a*b*A*(NZ?)?(oh?l?Z*a*A*(NZ?)?)*([St]|TA*N?Z?)*[jn]?)";
    grammar([
        (format!("(RZH|s)?[CRVPD]v?{tail}"), REORDERED),
        ("[jnt]".into(), OTHER),
        (format!("(RZH)?v?{tail}"), BROKEN),
    ])
});

static UNIVERSAL: Grammar = LazyLock::new(|| {
    let modifiers = "4*5*(([HQIK]B|U)4*5*)*";
    let complex =
        format!("{modifiers}([Ik]|d?a?b?c?(e*p*q*r*|H)Q?w*t*u*v*(KB)*(K|1*2*3*(8*9*|0?)))");
    let tail = format!("({complex}|6+7*|7+)");
    grammar([
        (format!("[Rs]?[BG]{complex}n?"), REORDERED),
        ("N(hN)*h?n?".into(), AS_IT_IS),
        (format!("[OG<]{tail}?n?"), AS_IT_IS),
        ("<*ET?M?>*(J<*(ET?M?>*)?)*n?".into(), OTHER),
        ("0".into(), OTHER),
        (format!("R?({tail}|(hN)*h|(hN)+)n?"), BROKEN),
    ])
});

fn find_syllables(rules: Rules, glyphs: &mut [Glyph]) {
    let grammar = match rules {
        Rules::Indic => &INDIC,
        Rules::Khmer => &KHMER,
        Rules::Myanmar => &MYANMAR,
        _ => &UNIVERSAL,
    };
    let is_before_mark = |at: usize| {
        glyphs[at + 1..]
            .iter()
            .find(|it| it.kind != b'g')
            .is_some_and(Glyph::is_unicode_mark)
    };
    let counts = |at: &usize| {
        rules != Rules::Universal
            || glyphs[*at].kind != b'g' && !(glyphs[*at].kind == b'n' && is_before_mark(*at))
    };
    let indexes: Vec<usize> = (0..glyphs.len()).filter(counts).collect();
    let kinds: Vec<u8> = indexes.iter().map(|it| glyphs[*it].kind).collect();
    let (mut start, mut serial) = (0, 0);
    while start < kinds.len() {
        let longest = grammar
            .iter()
            .rev()
            .map(|(pattern, kind)| (pattern.longest(&kinds[start..]), *kind))
            .max_by_key(|it| it.0);
        let (len, kind) = longest.filter(|it| it.0 > 0).unwrap_or((1, OTHER));
        serial = serial % 15 + 1;
        let end = indexes.get(start + len).map_or(glyphs.len(), |it| *it);
        glyphs[indexes[start]..end]
            .iter_mut()
            .for_each(|it| it.syllable = serial << 4 | kind);
        start += len;
    }
}

fn each_syllable(buffer: &mut Buffer, mut visit: impl FnMut(&mut Buffer, Range<usize>)) {
    let mut start = 0;
    while start < buffer.glyphs.len() {
        let end = buffer.end_of_syllable(start);
        visit(buffer, start..end);
        start = end;
    }
}

fn mend_broken_syllables(shaper: &Shaper, buffer: &mut Buffer) {
    let (kind, repha) = if shaper.plan.rules == Rules::Universal {
        (b'B', b'R')
    } else {
        (b'D', b'p')
    };
    let Some(id) = shaper
        .font
        .glyph(0x25CC)
        .filter(|_| buffer.glyphs.iter().any(|it| it.syllable & 15 == BROKEN))
    else {
        return;
    };
    let mut mended = Vec::with_capacity(buffer.glyphs.len() + 4);
    for syllable in buffer.glyphs.chunk_by(|a, b| a.syllable == b.syllable) {
        let Glyph {
            cluster,
            mask,
            syllable: number,
            ..
        } = syllable[0];
        let (before, after) =
            syllable.split_at(syllable.iter().take_while(|it| it.kind == repha).count());
        let circle = Glyph {
            id,
            kind,
            cluster,
            mask,
            syllable: number,
            place: place::END,
            ..Glyph::default()
        };
        mended.extend(
            before
                .iter()
                .chain((number & 15 == BROKEN).then_some(&circle))
                .chain(after),
        );
    }
    buffer.glyphs = mended;
}

/// Vowels that were sorted before the base are in the wrong order.
fn flip_vowels_before(glyphs: &mut [Glyph], is_vowel: impl Fn(&Glyph) -> bool) {
    let is_before = |it: &Glyph| it.place == place::PRE_M;
    if let Some((first, last)) = glyphs
        .iter()
        .position(is_before)
        .zip(glyphs.iter().rposition(is_before))
    {
        glyphs[first..=last].reverse();
        glyphs[first..=last]
            .split_inclusive_mut(&is_vowel)
            .filter(|it| is_vowel(&it[it.len() - 1]))
            .for_each(<[Glyph]>::reverse);
    }
}

fn is_one_of(glyph: &Glyph, kinds: &[u8]) -> bool {
    glyph.class & LIGATED == 0 && kinds.contains(&glyph.kind)
}

fn is_consonant(glyph: &Glyph) -> bool {
    is_one_of(glyph, b"CsRcVPD")
}

fn reorder_khmer(plan: &Plan, buffer: &mut Buffer, Range { start, end }: Range<usize>) {
    let mask = plan.bit(b"blwf") | plan.bit(b"abvf") | plan.bit(b"pstf");
    buffer.glyphs[start + 1..end]
        .iter_mut()
        .for_each(|it| it.mask |= mask);
    let mut subscripts = 0;
    for at in start + 1..end {
        if buffer.glyphs[at].kind == b'H' && subscripts <= 2 && at + 1 < end {
            subscripts += 1;
            if buffer.glyphs[at + 1].kind == b'R' {
                buffer.glyphs[at..at + 2]
                    .iter_mut()
                    .for_each(|it| it.mask |= plan.bit(b"pref"));
                buffer.merge_clusters(start..at + 2);
                buffer.glyphs[start..at + 2].rotate_right(2);
                buffer.glyphs[at + 2..end]
                    .iter_mut()
                    .for_each(|it| it.mask |= plan.bit(b"cfar"));
                subscripts = 2;
            }
        } else if buffer.glyphs[at].kind == b'e' {
            buffer.merge_clusters(start..at + 1);
            buffer.glyphs[start..=at].rotate_right(1);
        }
    }
}

fn reorder_myanmar(buffer: &mut Buffer, range: Range<usize>) {
    let glyphs = &mut buffer.glyphs[range.clone()];
    let kinzi = if glyphs.iter().take(3).map(|it| it.kind).eq(*b"RZH") {
        3
    } else {
        0
    };
    let base = glyphs[kinzi..]
        .iter()
        .position(is_consonant)
        .map_or(0, |it| kinzi + it)
        .max(kinzi);
    let mut current = place::AFTER_MAIN;
    for at in 0..glyphs.len() {
        glyphs[at].place = match (glyphs[at].kind, current) {
            _ if at < kinzi => place::AFTER_MAIN,
            _ if at < base => place::PRE_C,
            _ if at == base => place::BASE,
            (b'u', _) => place::PRE_C,
            (b'e', _) => place::PRE_M,
            (b'v', _) => glyphs[at - 1].place,
            (b'A', place::BELOW_C) => place::BEFORE_SUB,
            (kind, place::AFTER_MAIN | place::BELOW_C) => {
                current = if kind == b'b' {
                    place::BELOW_C
                } else if current == place::BELOW_C {
                    place::AFTER_SUB
                } else {
                    current
                };
                current
            }
            _ => current,
        };
    }
    buffer.sort(range.clone(), |it| it.place);
    flip_vowels_before(&mut buffer.glyphs[range], |it| it.kind == b'e');
}

fn reorder_universal(buffer: &mut Buffer, Range { start, end }: Range<usize>) {
    let is_halant = |it: &Glyph| is_one_of(it, b"HQI");
    if buffer.glyphs[start].kind == b'R' && end - start > 1 {
        let is_after_base = |it: &Glyph| b"123890abcdpqretuvw".contains(&it.kind) || is_halant(it);
        let to = start
            + 1
            + buffer.glyphs[start + 1..end]
                .iter()
                .take_while(|it| !is_after_base(it))
                .count();
        buffer.merge_clusters(start..to);
        buffer.glyphs[start..to].rotate_left(1);
    }
    let mut to = start;
    for at in start..end {
        let glyph = &buffer.glyphs[at];
        if is_halant(glyph) {
            to = at + 1;
        } else if matches!(glyph.kind, b'e' | b'w') && glyph.component() == 0 && to < at {
            buffer.merge_clusters(to..at + 1);
            buffer.glyphs[to..=at].rotate_right(1);
        }
    }
}

fn set_universal_masks(plan: &Plan, buffer: &mut Buffer) {
    let (repha, forms) = (
        plan.bit(b"rphf"),
        [b"isol", b"init", b"medi", b"fina"].map(|it| {
            Some(plan.bit(it))
                .filter(|it| *it != plan.global_mask)
                .unwrap_or(0)
        }),
    );
    let (all, mut last) = (
        if joins_like_arabic(plan) {
            0
        } else {
            forms.iter().fold(0, |all, it| all | it)
        },
        None,
    );
    each_syllable(buffer, |buffer, range| {
        let count = if buffer.glyphs[range.start].kind == b'R' {
            1
        } else {
            3
        };
        buffer.glyphs[range.clone()]
            .iter_mut()
            .take(count)
            .for_each(|it| it.mask |= repha);
        if all == 0 || buffer.glyphs[range.start].syllable & 15 == OTHER {
            return last = None;
        }
        let mut set = |range: Range<usize>, form: usize| {
            buffer.glyphs[range]
                .iter_mut()
                .for_each(|it| it.mask = it.mask & !all | forms[form])
        };
        set(range.clone(), if last.is_some() { 3 } else { 0 });
        let is_joined = last
            .take()
            .map(|(before, is_joined)| set(before, if is_joined { 2 } else { 1 }))
            .is_some();
        last = Some((range, is_joined));
    });
}

pub fn take(step: Step, shaper: &Shaper, buffer: &mut Buffer) {
    let plan = shaper.plan;
    let note = |buffer: &mut Buffer, mask: u32, kind: u8| {
        for syllable in buffer.glyphs.chunk_by_mut(|a, b| a.syllable == b.syllable) {
            let substituted = syllable
                .iter_mut()
                .take_while(|it| it.mask & mask != 0)
                .find(|it| it.class & SUBSTITUTED != 0);
            substituted.into_iter().for_each(|it| it.kind = kind);
        }
    };
    match step {
        Step::Find => {
            find_syllables(plan.rules, &mut buffer.glyphs);
            if plan.rules == Rules::Universal {
                set_universal_masks(plan, buffer);
            }
        }
        Step::Reorder => {
            if plan.rules == Rules::Indic {
                indic::place_consonants(shaper, &mut buffer.glyphs);
            }
            mend_broken_syllables(shaper, buffer);
            each_syllable(buffer, |buffer, range| match plan.rules {
                _ if buffer.glyphs[range.start].syllable & 15 > BROKEN => {}
                Rules::Indic => indic::reorder(shaper, buffer, range),
                Rules::Khmer => reorder_khmer(plan, buffer, range),
                Rules::Myanmar => reorder_myanmar(buffer, range),
                _ => reorder_universal(buffer, range),
            });
        }
        Step::ReorderAgain => each_syllable(buffer, |buffer, range| {
            indic::reorder_again(shaper, buffer, range)
        }),
        Step::Forget => buffer.glyphs.iter_mut().for_each(|it| it.syllable = 0),
        Step::ForgetSubstitutions => buffer
            .glyphs
            .iter_mut()
            .for_each(|it| it.class &= !SUBSTITUTED),
        Step::NoteRepha => note(buffer, plan.bit(b"rphf"), b'R'),
        Step::NotePreBase => note(buffer, u32::MAX, b'e'),
    }
}

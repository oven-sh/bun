//! Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada and Malayalam.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use std::ops::Range;

use super::super::buffer::{Buffer, Glyph, LIGATED, MULTIPLIED, SUBSTITUTED};
use super::super::plan::{Builder, GLOBAL, MANUAL, PER_SYLLABLE};
use super::super::{Shaper, substitute};
use super::kinds::place::*;
use super::{Step, flip_vowels_before, is_consonant, is_one_of};
use crate::text::sfnt::Tag;
use crate::unicode::category;

pub fn add_features(builder: &mut Builder) {
    builder.pause(Some(Step::Reorder));
    for feature in [
        b"nukt", b"akhn", b"rphf", b"rkrf", b"pref", b"blwf", b"abvf", b"half", b"pstf", b"vatu",
        b"cjct",
    ] {
        let is_global = matches!(feature, b"nukt" | b"akhn" | b"rkrf" | b"vatu" | b"cjct");
        builder.add(
            &[feature],
            MANUAL | PER_SYLLABLE | if is_global { GLOBAL } else { 0 },
        );
        builder.pause(None);
    }
    builder.pause(Some(Step::ReorderAgain));
    builder.add(&[b"init"], MANUAL | PER_SYLLABLE);
    builder.add(
        &[b"pres", b"abvs", b"blws", b"psts", b"haln"],
        GLOBAL | MANUAL | PER_SYLLABLE,
    );
}

fn virama(shaper: &Shaper) -> Option<u32> {
    let scripts = [
        b"Deva", b"Beng", b"Guru", b"Gujr", b"Orya", b"Taml", b"Telu", b"Knda", b"Mlym",
    ];
    shaper
        .font
        .glyph(0x94D + scripts.iter().position(|it| **it == shaper.plan.script.0)? as u32 * 0x80)
}

/// For fonts that were made for the first version of the specification.
fn is_old(shaper: &Shaper) -> bool {
    shaper.plan.chosen_script.is_none_or(|it| it[3] != b'2')
}

fn would_substitute(shaper: &Shaper, feature: &Tag, glyphs: &[u32]) -> bool {
    let has_no_context = is_old(shaper) && shaper.plan.script.0 != *b"Mlym";
    let lookups = shaper
        .plan
        .lookups_with(feature)
        .iter()
        .filter_map(|it| shaper.tables.layout[0].as_ref()?.lookup(it.0.into()));
    { lookups }.any(|it| substitute::would_apply(it, glyphs, has_no_context))
}

pub fn place_consonants(shaper: &Shaper, glyphs: &mut [Glyph]) {
    let Some(virama) = virama(shaper) else { return };
    for glyph in glyphs.iter_mut().filter(|it| it.place == BASE) {
        let has = |feature| {
            would_substitute(shaper, feature, &[virama, glyph.id])
                || would_substitute(shaper, feature, &[glyph.id, virama])
        };
        glyph.place = if has(b"blwf") || has(b"vatu") {
            BELOW_C
        } else if has(b"pstf") || has(b"pref") {
            POST_C
        } else {
            BASE
        };
    }
}

fn is_joiner(glyph: &Glyph) -> bool {
    is_one_of(glyph, b"jn")
}

fn is_halant(glyph: &Glyph) -> bool {
    is_one_of(glyph, b"H")
}

fn is_vowel_sign(glyph: &Glyph) -> bool {
    matches!(glyph.kind, b'M' | b'm')
}

/// How many glyphs at the start become a reph.
fn reph_length(shaper: &Shaper, glyphs: &[Glyph]) -> usize {
    let (script, forms) = (&shaper.plan.script.0, |count: usize| {
        would_substitute(
            shaper,
            b"rphf",
            &glyphs[..count].iter().map(|it| it.id).collect::<Vec<_>>(),
        )
    });
    let count = match glyphs.get(2).filter(|_| shaper.plan.bit(b"rphf") != 0) {
        _ if script == b"Mlym" => usize::from(glyphs[0].kind == b'p'),
        Some(third) if script == b"Telu" => {
            usize::from(third.kind == b'j' && (forms(2) || forms(3))) * 2
        }
        Some(third) => usize::from(!is_joiner(third) && forms(2)) * 2,
        None => 0,
    };
    if count == 0 {
        0
    } else {
        count
            + glyphs[count..]
                .iter()
                .take_while(|it| is_joiner(it))
                .count()
    }
}

fn find_base(glyphs: &[Glyph], reph: usize) -> usize {
    let (mut base, mut has_below) = (if reph > 0 { 0 } else { glyphs.len() }, false);
    for at in (reph.min(glyphs.len() - 1)..glyphs.len()).rev() {
        if is_consonant(&glyphs[at]) {
            base = at;
            if glyphs[at].place != BELOW_C && (glyphs[at].place != POST_C || has_below) {
                break;
            }
            has_below |= glyphs[at].place == BELOW_C;
        } else if at > 0 && glyphs[at].kind == b'j' && glyphs[at - 1].kind == b'H' {
            break;
        }
    }
    base
}

fn place_marks(glyphs: &mut [Glyph], base: usize) {
    let mut last = START;
    for at in 0..glyphs.len() {
        if b"jnNrcH".contains(&glyphs[at].kind) {
            let before = glyphs[..at]
                .iter()
                .rfind(|it| it.place != PRE_M)
                .filter(|_| glyphs[at].kind == b'H' && last == PRE_M);
            glyphs[at].place = before.map_or(last, |it| it.place);
        } else if glyphs[at].place != SMVD {
            last = glyphs[at].place;
            if glyphs[at].kind == b'm' && at > 0 && glyphs[at - 1].kind == b'S' {
                glyphs[at - 1].place = last;
            }
        }
    }
    let mut last = base;
    for at in base + 1..glyphs.len() {
        if is_consonant(&glyphs[at]) {
            let place = glyphs[at].place;
            glyphs[last + 1..at]
                .iter_mut()
                .filter(|it| it.place < SMVD)
                .for_each(|it| it.place = place);
            last = at;
        } else if is_vowel_sign(&glyphs[at]) {
            last = at;
        }
    }
}

/// Returns where the base ends up.
fn sort(buffer: &mut Buffer, Range { start, end }: Range<usize>, merges_all: bool) -> usize {
    let glyphs = &mut buffer.glyphs[start..end];
    let syllable = glyphs[0].syllable;
    glyphs
        .iter_mut()
        .enumerate()
        .for_each(|(index, it)| it.syllable = index as u8);
    glyphs.sort_by_key(|it| it.place);
    let base = glyphs
        .iter()
        .position(|it| it.place == BASE)
        .unwrap_or(glyphs.len());
    flip_vowels_before(&mut glyphs[..base], is_vowel_sign);
    let mut origins: Vec<usize> = glyphs
        .iter_mut()
        .map(|it| std::mem::replace(&mut it.syllable, syllable).into())
        .collect();
    if merges_all || origins.len() > 127 {
        buffer.merge_clusters(start + base..end);
        return base;
    }
    for at in base..origins.len() {
        let (mut low, mut high, mut next) = (at, at, origins[at]);
        while next != at {
            (low, high) = (low.min(next), high.max(next));
            next = std::mem::replace(&mut origins[next], next);
        }
        buffer.merge_clusters(start + low.max(base)..start + high + 1);
        origins[at] = at;
    }
    base
}

pub fn reorder(shaper: &Shaper, buffer: &mut Buffer, range: Range<usize>) {
    let (plan, script, is_old) = (shaper.plan, &shaper.plan.script.0, is_old(shaper));
    let starts_with = |kinds: &[u8]| {
        buffer.glyphs[range.clone()]
            .iter()
            .zip(kinds)
            .filter(|(it, kind)| is_one_of(it, &[**kind]))
            .count()
            == kinds.len()
    };
    if script == b"Knda" && starts_with(b"RHj") {
        buffer.merge_clusters(range.start + 1..range.start + 3);
        buffer.glyphs.swap(range.start + 1, range.start + 2);
    }
    let glyphs = &mut buffer.glyphs[range.clone()];
    let reph = reph_length(shaper, glyphs);
    let base = find_base(glyphs, reph);
    glyphs[..base]
        .iter_mut()
        .for_each(|it| it.place = it.place.min(PRE_C));
    glyphs
        .get_mut(base)
        .into_iter()
        .for_each(|it| it.place = BASE);
    if reph > 0 && (base > 0 || reph > 2) {
        glyphs[0].place = REPH;
    }
    if let Some(halant) = (base + 1..glyphs.len()).find(|it| is_old && glyphs[*it].kind == b'H') {
        let last = (halant + 1..glyphs.len()).rfind(|it| {
            is_consonant(&glyphs[*it]) || script == b"Knda" && glyphs[*it].kind == b'H'
        });
        last.filter(|it| glyphs[*it].kind != b'H')
            .into_iter()
            .for_each(|it| glyphs[halant..=it].rotate_left(1));
    }
    place_marks(glyphs, base);
    let base = sort(buffer, range.clone(), is_old);

    let glyphs = &mut buffer.glyphs[range];
    let [half, below, pre_base] = [b"half", b"blwf", b"pref"].map(|it| plan.bit(it));
    glyphs
        .iter_mut()
        .take_while(|it| it.place == REPH)
        .for_each(|it| it.mask |= plan.bit(b"rphf"));
    let before = half
        | if is_old || matches!(script, b"Telu" | b"Knda") {
            0
        } else {
            below
        };
    glyphs[..base].iter_mut().for_each(|it| it.mask |= before);
    let after = below | plan.bit(b"abvf") | plan.bit(b"pstf");
    glyphs
        .iter_mut()
        .skip(base + 1)
        .for_each(|it| it.mask |= after);
    for at in (0..base.saturating_sub(1)).filter(|_| is_old && script == b"Deva") {
        if [glyphs[at].kind, glyphs[at + 1].kind] == *b"RH"
            && (at + 2 == base || glyphs[at + 2].kind != b'j')
        {
            glyphs[at..at + 2]
                .iter_mut()
                .for_each(|it| it.mask |= below);
        }
    }
    let is_pre_base = |at: &usize| {
        pre_base != 0 && would_substitute(shaper, b"pref", &[glyphs[*at].id, glyphs[at + 1].id])
    };
    if let Some(at) = (base + 1..glyphs.len() - 1).find(is_pre_base) {
        glyphs[at..at + 2]
            .iter_mut()
            .for_each(|it| it.mask |= pre_base);
    }
    for at in 1..glyphs.len() {
        if is_one_of(&glyphs[at], b"n") {
            let consonant = glyphs[..at].iter().rposition(is_consonant).unwrap_or(0);
            glyphs[consonant..at]
                .iter_mut()
                .for_each(|it| it.mask &= !half);
        }
    }
}

fn was_only_ligated(glyph: &Glyph) -> bool {
    glyph.class & (LIGATED | MULTIPLIED) == LIGATED
}

/// With whether a consonant after it has taken its pre-base form.
fn find_base_again(glyphs: &mut [Glyph], pre_base: u32, is_malayalam: bool) -> (usize, bool) {
    let (end, mut has_pre_base) = (glyphs.len(), pre_base != 0);
    let mut base = glyphs.iter().position(|it| it.place >= BASE).unwrap_or(end);
    let candidate = (base + 1..end).find(|it| glyphs[*it].mask & pre_base != 0);
    if let Some(at) = candidate
        .filter(|it| glyphs[*it].class & SUBSTITUTED == 0 || !was_only_ligated(&glyphs[*it]))
    {
        base = at + glyphs[at..].iter().take_while(|it| is_halant(it)).count();
        glyphs
            .get_mut(base)
            .into_iter()
            .for_each(|it| it.place = BASE);
        has_pre_base = false;
    }
    let mut at = base + 1;
    while is_malayalam && at < end {
        let after_joiners =
            |at: usize| at + glyphs[at..].iter().take_while(|it| is_joiner(it)).count();
        at = after_joiners(at);
        if !glyphs.get(at).is_some_and(is_halant) {
            break;
        }
        at = after_joiners(at + 1);
        if glyphs
            .get(at)
            .is_some_and(|it| is_consonant(it) && it.place == BELOW_C)
        {
            (base, glyphs[at].place) = (at, BASE);
        }
        at += 1;
    }
    if base > 0
        && glyphs
            .get(base)
            .map_or_else(|| is_one_of(&glyphs[base - 1], b"j"), |it| it.place > BASE)
    {
        base -= 1;
    }
    while 0 < base && base < end && is_one_of(&glyphs[base], b"NH") {
        base -= 1;
    }
    (base, has_pre_base)
}

fn place_of_reph(glyphs: &[Glyph], base: usize, script: &Tag) -> usize {
    if let Some(halant) = (1..base).find(|it| is_halant(&glyphs[*it])) {
        return halant + usize::from(halant + 1 < base && is_joiner(&glyphs[halant + 1]));
    }
    let after = |goes_on: fn(u8) -> bool| {
        base + glyphs[base + 1..]
            .iter()
            .take_while(|it| goes_on(it.place))
            .count()
    };
    match script {
        b"Orya" | b"Mlym" if base < glyphs.len() => after(|it| it <= AFTER_MAIN),
        b"Beng" if base < glyphs.len() => after(|it| !matches!(it, POST_C | AFTER_POST | SMVD)),
        _ => {
            let last = glyphs.iter().rposition(|it| it.place != SMVD).unwrap_or(0);
            let vowels = glyphs[..last]
                .iter()
                .skip(base + 1)
                .filter(|it| is_vowel_sign(it))
                .count();
            last - if is_halant(&glyphs[last]) { vowels } else { 0 }
        }
    }
}

pub fn reorder_again(shaper: &Shaper, buffer: &mut Buffer, Range { start, end }: Range<usize>) {
    let (script, pre_base, virama) = (
        &shaper.plan.script.0,
        shaper.plan.bit(b"pref"),
        virama(shaper),
    );
    for glyph in &mut buffer.glyphs[start..end] {
        if Some(glyph.id) == virama && glyph.class & (LIGATED | MULTIPLIED) == LIGATED | MULTIPLIED
        {
            (glyph.kind, glyph.class) = (b'H', glyph.class & !(LIGATED | MULTIPLIED));
        }
    }
    let (base, has_pre_base) =
        find_base_again(&mut buffer.glyphs[start..end], pre_base, script == b"Mlym");
    let (mut base, has_half_forms) = (start + base, !matches!(script, b"Mlym" | b"Taml"));
    if start + 1 < end && start < base {
        let (glyphs, mut to) = (&buffer.glyphs, base - if base == end { 2 } else { 1 });
        let mut searches = has_half_forms;
        while std::mem::take(&mut searches) {
            to = (start..=to)
                .rfind(|it| is_one_of(&glyphs[*it], b"MmH"))
                .unwrap_or(start);
            if !is_halant(&glyphs[to]) || glyphs[to].place == PRE_M {
                to = start;
            } else if to + 1 < end && glyphs[to + 1].kind == b'j' && to > start {
                (to, searches) = (to - 1, true);
            }
        }
        if start < to && glyphs[to].place != PRE_M {
            for from in (start..to).rev() {
                if buffer.glyphs[from].place == PRE_M {
                    base -= usize::from(from < base && base <= to);
                    buffer.glyphs[from..=to].rotate_left(1);
                    buffer.merge_clusters(to..end.min(base + 1).max(to));
                    to -= 1;
                }
            }
        } else if let Some(vowel) = (start..base).find(|it| glyphs[*it].place == PRE_M) {
            buffer.merge_clusters(vowel..end.min(base + 1));
        }
    }
    let first = buffer.glyphs[start];
    if start + 1 < end && first.place == REPH && (first.kind == b'p') != was_only_ligated(&first) {
        let to = start + place_of_reph(&buffer.glyphs[start..end], base - start, script);
        buffer.merge_clusters(start..to + 1);
        buffer.glyphs[start..=to].rotate_left(1);
        base -= usize::from(start < base && base <= to);
    }
    let candidate =
        (base + 1..end).find(|it| has_pre_base && buffer.glyphs[*it].mask & pre_base != 0);
    if let Some(from) = candidate.filter(|it| was_only_ligated(&buffer.glyphs[*it])) {
        let before =
            (start..base).rfind(|it| !has_half_forms || is_one_of(&buffer.glyphs[*it], b"MmH"));
        let mut to = before.map_or(start, |it| it + 1);
        to += usize::from(
            to > start && is_halant(&buffer.glyphs[to - 1]) && is_joiner(&buffer.glyphs[to]),
        );
        buffer.merge_clusters(to..from + 1);
        buffer.glyphs[to..=from].rotate_right(1);
    }
    if buffer.glyphs[start].place == PRE_M
        && (start == 0 || !category::is_in_word(buffer.glyphs[start - 1].category))
    {
        buffer.glyphs[start].mask |= shaper.plan.bit(b"init");
    }
}

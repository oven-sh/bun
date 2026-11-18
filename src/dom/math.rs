//! MathML Core.

use std::rc::Rc;

use crate::abi::{self, Face, Glyph, Rect};
use crate::boxes::{BoxId, Kind};
use crate::document::Document;
use crate::layout::{Edges, Input, Output, Widths};
use crate::name::{Name, is_name, name};
use crate::order::Order as _;
use crate::platform::{font_table, glyph_extent, word};
use crate::positioned::Edge;
use crate::properties::{Id, Style};
use crate::tree::{Element, Namespace, NodeId};
use crate::types::*;
use crate::values::{Css, Ctx, Lp, parse_all};

#[derive(Clone, Copy, PartialEq)]
enum Form {
    Infix,
    Postfix,
    Prefix,
}

const STRETCHY: u8 = 1;
const SYMMETRIC: u8 = 2;
const LARGE: u8 = 4;
const MOVABLE: u8 = 8;

/// The spaces around it in eighteenths of an em, and its properties.
fn look_up(form: Form, character: char) -> Option<([u8; 2], u8)> {
    Some(match (form, character as u32) {
        (Form::Infix, 0x5c | 0x5f | 0x2061..=0x2064 | 0x2206) => ([0, 0], 0),
        (Form::Infix, 0x2c | 0x3a..=0x3b) => ([0, 3], 0),
        (
            Form::Infix,
            0x25
            | 0x2a
            | 0x2e
            | 0x3f..=0x40
            | 0x5e
            | 0xb7
            | 0xd7
            | 0x2022
            | 0x2043
            | 0x2217..=0x2219
            | 0x2240
            | 0x2297
            | 0x2299..=0x229b
            | 0x22a0..=0x22a1
            | 0x22ba
            | 0x22c4..=0x22c7
            | 0x22c9..=0x22cc
            | 0x2305..=0x2306
            | 0x27cb
            | 0x27cd
            | 0x29c6..=0x29c8
            | 0x29d4..=0x29d7
            | 0x29e2
            | 0x2a1d..=0x2a1e
            | 0x2a2f..=0x2a37
            | 0x2a3b..=0x2a3d
            | 0x2a3f
            | 0x2a50
            | 0x2a64..=0x2a65
            | 0x2adc..=0x2add
            | 0x2afe,
        ) => ([3, 3], 0),
        (
            Form::Infix,
            0x2b
            | 0x2d
            | 0x2f
            | 0xb1
            | 0xf7
            | 0x2044
            | 0x2212..=0x2216
            | 0x2227..=0x222a
            | 0x2236
            | 0x2238
            | 0x228c..=0x228e
            | 0x2293..=0x2296
            | 0x2298
            | 0x229d..=0x229f
            | 0x22bb..=0x22bd
            | 0x22ce..=0x22cf
            | 0x22d2..=0x22d3
            | 0x2795..=0x2797
            | 0x29b8
            | 0x29bc
            | 0x29c4..=0x29c5
            | 0x29f5..=0x29fb
            | 0x2a1f..=0x2a2e
            | 0x2a38..=0x2a3a
            | 0x2a3e
            | 0x2a40..=0x2a4f
            | 0x2a51..=0x2a63
            | 0x2adb
            | 0x2af6
            | 0x2afb
            | 0x2afd,
        ) => ([4, 4], 0),
        (Form::Infix, 0x7c | 0x223c) => ([5, 5], 0),
        (
            Form::Infix,
            0x2190..=0x2195
            | 0x219a..=0x21ae
            | 0x21b0..=0x21b5
            | 0x21b9
            | 0x21bc..=0x21d5
            | 0x21da..=0x21f0
            | 0x21f3..=0x21ff
            | 0x2794
            | 0x2799
            | 0x279b..=0x27a1
            | 0x27a5..=0x27a6
            | 0x27a8..=0x27af
            | 0x27b1
            | 0x27b3
            | 0x27b5
            | 0x27b8
            | 0x27ba..=0x27be
            | 0x27f0..=0x27f1
            | 0x27f4..=0x27ff
            | 0x2900..=0x2920
            | 0x2934..=0x2937
            | 0x2942..=0x2975
            | 0x297c..=0x297f
            | 0x2b04..=0x2b07
            | 0x2b0c..=0x2b11
            | 0x2b30..=0x2b3e
            | 0x2b40..=0x2b4c
            | 0x2b60..=0x2b65
            | 0x2b6a..=0x2b6d
            | 0x2b70..=0x2b73
            | 0x2b7a..=0x2b7d
            | 0x2b80..=0x2b87
            | 0x2b95
            | 0x2ba0..=0x2baf
            | 0x2bb8,
        ) => ([5, 5], STRETCHY),
        (
            Form::Postfix,
            0x21..=0x22
            | 0x25..=0x27
            | 0x60
            | 0xa8
            | 0xb0
            | 0xb2..=0xb4
            | 0xb8..=0xb9
            | 0x2ca..=0x2cb
            | 0x2d8..=0x2da
            | 0x2dd
            | 0x311
            | 0x2019..=0x201b
            | 0x201d..=0x201f
            | 0x2032..=0x2037
            | 0x2057
            | 0x20db..=0x20dc
            | 0x23cd,
        ) => ([0, 0], 0),
        (
            Form::Postfix,
            0x5e..=0x5f
            | 0x7e
            | 0xaf
            | 0x2c6..=0x2c7
            | 0x2c9
            | 0x2cd
            | 0x2dc
            | 0x2f7
            | 0x302
            | 0x203e
            | 0x2322..=0x2323
            | 0x23b4..=0x23b5
            | 0x23dc..=0x23e1
            | 0x1eef0..=0x1eef1,
        ) => ([0, 0], STRETCHY),
        (
            Form::Postfix,
            0x29
            | 0x5d
            | 0x7c..=0x7d
            | 0x2016
            | 0x2309
            | 0x230b
            | 0x232a
            | 0x2773
            | 0x27e7
            | 0x27e9
            | 0x27eb
            | 0x27ed
            | 0x27ef
            | 0x2980
            | 0x2984
            | 0x2986
            | 0x2988
            | 0x298a
            | 0x298c
            | 0x298e
            | 0x2990
            | 0x2992
            | 0x2994
            | 0x2996
            | 0x2998..=0x2999
            | 0x29d9
            | 0x29db
            | 0x29fd,
        ) => ([0, 0], STRETCHY | SYMMETRIC),
        (
            Form::Prefix,
            0x21
            | 0x2b
            | 0x2d
            | 0xac
            | 0xb1
            | 0x2018
            | 0x201c
            | 0x2200..=0x2201
            | 0x2203..=0x2204
            | 0x2207
            | 0x2212..=0x2213
            | 0x221f..=0x2222
            | 0x2234..=0x2235
            | 0x223c
            | 0x22be..=0x22bf
            | 0x2310
            | 0x2319
            | 0x2795..=0x2796
            | 0x27c0
            | 0x299b..=0x29af
            | 0x2aec..=0x2aed,
        ) => ([0, 0], 0),
        (
            Form::Prefix,
            0x28
            | 0x5b
            | 0x7b..=0x7c
            | 0x2016
            | 0x2308
            | 0x230a
            | 0x2329
            | 0x2772
            | 0x27e6
            | 0x27e8
            | 0x27ea
            | 0x27ec
            | 0x27ee
            | 0x2980
            | 0x2983
            | 0x2985
            | 0x2987
            | 0x2989
            | 0x298b
            | 0x298d
            | 0x298f
            | 0x2991
            | 0x2993
            | 0x2995
            | 0x2997
            | 0x2999
            | 0x29d8
            | 0x29da
            | 0x29fc,
        ) => ([0, 0], STRETCHY | SYMMETRIC),
        (Form::Prefix, 0x2145..=0x2146 | 0x2202 | 0x221a..=0x221c) => ([3, 0], 0),
        (Form::Prefix, 0x222b..=0x2233 | 0x2a0b..=0x2a1c) => ([3, 3], SYMMETRIC | LARGE),
        (
            Form::Prefix,
            0x220f..=0x2211 | 0x22c0..=0x22c3 | 0x2a00..=0x2a0a | 0x2a1d..=0x2a1e | 0x2afc | 0x2aff,
        ) => ([3, 3], SYMMETRIC | LARGE | MOVABLE),
        _ => return None,
    })
}

fn look_up_text(form: Form, text: &str) -> Option<([u8; 2], u8)> {
    let mut characters = text.chars();
    let spaces = match (form, text) {
        (Form::Infix, "**" | "<>") => [3, 3],
        (Form::Infix, "&&") => [4, 4],
        (Form::Infix, "||") => [5, 5],
        (Form::Postfix, "!!" | "++" | "--" | "||") => [0, 0],
        (Form::Prefix, "||") => [0, 0],
        _ => {
            let first = characters
                .next()
                .filter(|it| !matches!(it, '\u{320}'..='\u{3ff}'))?;
            return matches!(characters.as_str(), "" | "\u{338}" | "\u{20d2}")
                .then(|| look_up(form, first))?;
        }
    };
    Some((spaces, 0))
}

fn stretches_horizontally(character: char) -> bool {
    matches!(character as u32,
        0x3d | 0x5e..=0x5f | 0x7e | 0xaf | 0x2c6..=0x2c7 | 0x2c9 | 0x2cd | 0x2dc | 0x2f7 | 0x302 | 0x203e | 0x2190 | 0x2192 | 0x2194
        | 0x2198..=0x219e | 0x21a0 | 0x21a2..=0x21a4 | 0x21a6 | 0x21a9..=0x21ae | 0x21b4 | 0x21b9 | 0x21bc..=0x21bd | 0x21c0..=0x21c1
        | 0x21c4 | 0x21c6..=0x21c7 | 0x21c9 | 0x21cb..=0x21d0 | 0x21d2 | 0x21d4 | 0x21da..=0x21dd | 0x21e0 | 0x21e2 | 0x21e4..=0x21e6
        | 0x21e8 | 0x21f0 | 0x21f4 | 0x21f6..=0x21ff | 0x2322..=0x2323 | 0x23b4..=0x23b5 | 0x23dc..=0x23e1 | 0x2794 | 0x2799
        | 0x279b..=0x27a1 | 0x27a5..=0x27a6 | 0x27a8..=0x27af | 0x27b1 | 0x27b3 | 0x27b5 | 0x27b8 | 0x27ba..=0x27be | 0x27f4..=0x27ff
        | 0x2900..=0x2907 | 0x290c..=0x2911 | 0x2914..=0x2920 | 0x2942..=0x2948 | 0x294a..=0x294b | 0x294e | 0x2950 | 0x2952..=0x2953
        | 0x2956..=0x2957 | 0x295a..=0x295b | 0x295e..=0x295f | 0x2962 | 0x2964 | 0x2966..=0x296d | 0x2970..=0x2975 | 0x297c..=0x297d
        | 0x2b04..=0x2b05 | 0x2b0c | 0x2b30..=0x2b3e | 0x2b40..=0x2b4c | 0x2b60 | 0x2b62 | 0x2b64 | 0x2b6a | 0x2b6c | 0x2b70 | 0x2b72
        | 0x2b7a | 0x2b7c | 0x2b80 | 0x2b82 | 0x2b84 | 0x2b86 | 0x2b95 | 0x1eef0..=0x1eef1)
}

/// In the order of the `MathConstants` table.
#[derive(Clone, Copy)]
enum Constant {
    AxisHeight = 1,
    AccentBaseHeight,
    SubscriptShiftDown = 4,
    SubscriptTopMax,
    SubscriptBaselineDropMin,
    SuperscriptShiftUp,
    SuperscriptShiftUpCramped,
    SuperscriptBottomMin,
    SuperscriptBaselineDropMax,
    SubSuperscriptGapMin,
    SuperscriptBottomMaxWithSubscript,
    SpaceAfterScript,
    UpperLimitGapMin,
    UpperLimitBaselineRiseMin,
    LowerLimitGapMin,
    LowerLimitBaselineDropMin,
    StackTopShiftUp,
    StackBottomShiftDown = 20,
    StackGapMin = 22,
    StretchStackTopShiftUp = 24,
    StretchStackBottomShiftDown,
    StretchStackGapAboveMin,
    StretchStackGapBelowMin,
    NumeratorShiftUp,
    DenominatorShiftDown = 30,
    NumeratorGapMin = 32,
    FractionRuleThickness = 34,
    DenominatorGapMin,
    OverbarVerticalGap = 39,
    OverbarExtraAscender = 41,
    UnderbarVerticalGap,
    UnderbarExtraDescender = 44,
    RadicalVerticalGap,
    RadicalRuleThickness = 47,
    RadicalExtraAscender,
    RadicalKernBeforeDegree,
    RadicalKernAfterDegree,
}
use Constant::*;

fn signed(table: &[u8], at: usize) -> Option<f32> {
    Some((word(table, at)? as i16).into())
}

/// The one whose offset is at `at`.
fn subtable(table: &[u8], at: usize) -> Option<&[u8]> {
    table.get(word(table, at).filter(|it| *it != 0)?..)
}

fn coverage(table: &[u8], glyph: u32) -> Option<usize> {
    let (glyph, mut records) = (glyph as usize, 0..word(table, 2)?);
    match word(table, 0)? {
        1 => records.position(|it| word(table, 4 + 2 * it) == Some(glyph)),
        _ => records.find_map(|it| {
            let [first, last, index] = [4, 6, 8].map(|field| word(table, field + 6 * it));
            (first?..=last?)
                .contains(&glyph)
                .then_some(index? + glyph.saturating_sub(first?))
        }),
    }
}

struct MathFont {
    face: Face,
    table: &'static [u8],
    /// Pixels per font unit.
    scale: f32,
    x_height: f32,
    rule: f32,
    is_display: bool,
}

/// The origin is on the baseline.
#[derive(Default)]
struct Stretched {
    glyphs: Vec<Glyph>,
    advance: f32,
    ascent: f32,
    descent: f32,
    italic: f32,
}

struct Part {
    glyph: u32,
    connectors: [f32; 2],
    advance: f32,
    extends: bool,
}

impl MathFont {
    fn get(&self, constant: Constant, fallback: f32) -> f32 {
        self.value(8 + 4 * constant as usize)
            .map_or(fallback, |it| it * self.scale)
    }

    /// The one for display style comes after the other.
    fn styled(&self, constant: Constant, fallbacks: [f32; 2]) -> f32 {
        let next = usize::from(self.is_display);
        self.value(8 + 4 * (constant as usize + next))
            .map_or(fallbacks[next], |it| it * self.scale)
    }

    fn value(&self, at: usize) -> Option<f32> {
        signed(subtable(self.table, 4)?, at)
    }

    fn axis(&self) -> f32 {
        self.get(AxisHeight, self.x_height / 2.0)
    }

    fn italic(&self, glyph: u32) -> Option<f32> {
        let info = subtable(subtable(self.table, 6)?, 0)?;
        Some(signed(info, 4 + 4 * coverage(subtable(info, 0)?, glyph)?)? * self.scale)
    }

    fn construction(&self, glyph: u32, is_vertical: bool) -> Option<&'static [u8]> {
        let variants = subtable(self.table, 8)?;
        let index = coverage(subtable(variants, if is_vertical { 2 } else { 4 })?, glyph)?;
        subtable(
            variants,
            10 + 2 * (index + if is_vertical { 0 } else { word(variants, 6)? }),
        )
    }

    fn variants(&self, glyph: u32, is_vertical: bool) -> impl Iterator<Item = u32> {
        let table = self.construction(glyph, is_vertical).unwrap_or_default();
        core::iter::once(glyph).chain(
            (0..word(table, 2).unwrap_or(0))
                .filter_map(move |it| Some(word(table, 4 + 4 * it)? as u32)),
        )
    }

    fn parts(&self, glyph: u32, is_vertical: bool) -> Option<(Vec<Part>, f32)> {
        let table = subtable(self.construction(glyph, is_vertical)?, 0)?;
        let part = |index: usize| {
            let [glyph, start, end, advance, flags] =
                [6, 8, 10, 12, 14].map(|field| word(table, field + 10 * index));
            let connectors = [start? as f32 * self.scale, end? as f32 * self.scale];
            Some(Part {
                glyph: glyph? as u32,
                connectors,
                advance: advance? as f32 * self.scale,
                extends: flags? & 1 != 0,
            })
        };
        Some((
            (0..word(table, 4)?).map(part).collect::<Option<_>>()?,
            signed(table, 0)? * self.scale,
        ))
    }

    fn assemble(&self, glyph: u32, is_vertical: bool, target: f32) -> Option<Stretched> {
        const MOST_GLYPHS: usize = 10_000;
        let (parts, italic) = self.parts(glyph, is_vertical)?;
        let least = word(subtable(self.table, 8)?, 0)? as f32 * self.scale;
        let joints = parts
            .iter()
            .zip(parts.iter().skip(1))
            .chain(parts.iter().filter(|it| it.extends).map(|it| (it, it)));
        let most = joints
            .map(|(a, b)| a.connectors[1].min(b.connectors[0]))
            .fold(f32::MAX, f32::min);
        let [fixed, extenders] =
            [false, true].map(|extends| parts.iter().filter(move |it| it.extends == extends));
        let (counts, sums) = (
            [fixed.clone().count(), extenders.clone().count()],
            [fixed, extenders].map(|it| it.map(|it| it.advance).sum::<f32>()),
        );
        let gain = sums[1] - least * counts[1] as f32;
        if counts[1] == 0 || most < least || gain <= 0.0 {
            return None;
        }
        let repeats = (((target - sums[0] + least * (counts[0] as f32 - 1.0)) / gain)
            .ceil()
            .max(0.0) as usize)
            .min(MOST_GLYPHS / counts[1]);
        let (joints, total) = (
            (counts[0] + repeats * counts[1]) as f32 - 1.0,
            sums[0] + repeats as f32 * sums[1],
        );
        let overlap = if joints > 0.0 {
            ((total - target) / joints).min(most).max(least)
        } else {
            most
        };
        let (mut out, mut at) = (
            Stretched {
                italic,
                ..Stretched::default()
            },
            0.0,
        );
        for part in &parts {
            let ink = glyph_extent(&self.face, part.glyph).ink;
            (out.advance, out.ascent, out.descent) = (
                out.advance.max(ink.right()),
                out.ascent.max(-ink.y),
                out.descent.max(ink.bottom()),
            );
            for _ in 0..if part.extends { repeats } else { 1 } {
                out.glyphs.push(if is_vertical {
                    Glyph {
                        id: part.glyph,
                        x: 0.0,
                        y: -at - ink.bottom(),
                    }
                } else {
                    Glyph {
                        id: part.glyph,
                        x: at,
                        y: 0.0,
                    }
                });
                at += part.advance - overlap;
            }
        }
        match is_vertical {
            true => (out.ascent, out.descent) = (total - overlap * joints, 0.0),
            false => out.advance = total - overlap * joints,
        }
        Some(out)
    }

    fn stretch(&self, glyph: u32, is_vertical: bool, target: f32) -> Stretched {
        let mut last = Stretched::default();
        for id in self.variants(glyph, is_vertical) {
            let abi::GlyphExtent { advance, ink } = glyph_extent(&self.face, id);
            let (glyphs, italic) = (
                vec![Glyph { id, x: 0.0, y: 0.0 }],
                self.italic(id).unwrap_or(0.0),
            );
            last = Stretched {
                glyphs,
                advance,
                ascent: -ink.y,
                descent: ink.bottom(),
                italic,
            };
            if target <= if is_vertical { ink.height } else { ink.width } {
                return last;
            }
        }
        self.assemble(glyph, is_vertical, target).unwrap_or(last)
    }

    fn widest_vertical(&self, glyph: u32) -> f32 {
        let parts = self
            .parts(glyph, true)
            .into_iter()
            .flat_map(|it| it.0)
            .map(|it| it.glyph);
        self.variants(glyph, true)
            .chain(parts)
            .map(|it| glyph_extent(&self.face, it).advance)
            .fold(0.0, f32::max)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Stretch {
    Width(f32),
    /// Above and below the baseline.
    Height(f32, f32),
}

/// Relative to the border box.
#[derive(Default)]
pub(crate) struct MathBox {
    stretch: Option<Stretch>,
    italic: f32,
    pub(crate) glyphs: Option<(Face, Vec<Glyph>)>,
    pub(crate) bar: Rect,
}

#[derive(Clone, Copy)]
struct Operator {
    spaces: [f32; 2],
    flags: u8,
    is_vertical: bool,
}

impl Operator {
    fn stretches(&self, vertically: bool) -> bool {
        self.flags & STRETCHY != 0 && self.is_vertical == vertically
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Schema {
    Row,
    Fraction,
    Radical,
    Space,
    Padded,
    Scripts,
    UnderOver,
}

/// The sizes include the margins.
#[derive(Clone, Copy, Default)]
struct Piece {
    id: BoxId,
    margin: Edges,
    width: f32,
    ascent: f32,
    descent: f32,
    italic: f32,
}

struct Scripts {
    /// The subscript and the superscript, of which one can be 0.
    pairs: Vec<[BoxId; 2]>,
    /// The `mprescripts` element, and how many pairs are before it.
    prescripts: Option<(BoxId, usize)>,
}

fn is_grouping(tag: Name) -> bool {
    !is_name!(
        tag,
        "mi" | "mn"
            | "mo"
            | "ms"
            | "mtext"
            | "mspace"
            | "mfrac"
            | "mroot"
            | "msqrt"
            | "mpadded"
            | "mtable"
            | "mtr"
            | "mtd"
    ) && !is_scripted(tag)
}

fn is_scripted(tag: Name) -> bool {
    is_name!(
        tag,
        "msub" | "msup" | "msubsup" | "munder" | "mover" | "munderover" | "mmultiscripts"
    )
}

pub(crate) fn is_token(element: &Element) -> bool {
    is_name!(
        element.tag,
        "mi" | "mn" | "mo" | "ms" | "mtext" | "annotation" | "annotation-xml"
    )
}

pub(crate) fn has_anonymous_row(element: &Element) -> bool {
    element.namespace == Namespace::MathMl && is_name!(element.tag, "msqrt" | "mpadded" | "mtd")
}

pub(crate) fn hints(element: &Element, declare: &mut dyn FnMut(&str, &str)) {
    let length = |name: Name| {
        element.attribute(name).filter(|it| {
            parse_all(it.as_bytes(), |p| Lp::parse(p, &Ctx::dummy())).is_some()
                && !it.trim_ascii_end().ends_with(')')
        })
    };
    let absolute = |name: Name| length(name).filter(|it| !it.trim_ascii_end().ends_with('%'));
    for attribute in &element.attributes {
        let value = &*attribute.value;
        let is = |known: &str| value.eq_ignore_ascii_case(known);
        match &*attribute.qualified() {
            "dir" if is("ltr") || is("rtl") => declare("direction", value),
            "mathcolor" => declare("color", value),
            "mathbackground" => declare("background-color", value),
            "mathsize" => length(name!("mathsize"))
                .into_iter()
                .for_each(|it| declare("font-size", it)),
            "displaystyle" if is("true") => declare("math-style", "normal"),
            "displaystyle" if is("false") => declare("math-style", "compact"),
            "scriptlevel" => {
                let value = value.trim_ascii();
                let digits = value.strip_prefix(['+', '-']);
                if digits
                    .unwrap_or(value)
                    .bytes()
                    .all(|it| it.is_ascii_digit())
                {
                    declare(
                        "math-depth",
                        &if digits.is_some() {
                            format!("add({value})")
                        } else {
                            value.into()
                        },
                    );
                }
            }
            "mathvariant" if element.tag == name!("mi") && is("normal") => {
                declare("text-transform", "none")
            }
            "width" if is_name!(element.tag, "mspace" | "mpadded") => absolute(name!("width"))
                .into_iter()
                .for_each(|it| declare("width", it)),
            _ => {}
        }
    }
    if element.tag == name!("mspace") {
        let [height, depth] = [name!("height"), name!("depth")]
            .map(|it| absolute(it).filter(|it| !it.trim_ascii_start().starts_with('-')));
        match height.zip(depth) {
            Some((height, depth)) => declare("height", &format!("calc({height} + {depth})")),
            None => height
                .or(depth)
                .into_iter()
                .for_each(|it| declare("height", it)),
        }
    }
}

fn is_display(style: &Style) -> bool {
    style.other(Id::MathStyle) == "normal"
}

impl Document {
    fn math_font(&self, style: &Style) -> MathFont {
        let shaped = self.shape_plain(" ", style);
        let face = shaped.faces[shaped
            .clusters()
            .first()
            .map_or(0, |it| usize::from(it.face))];
        let units = word(font_table(&face, *b"head"), 18).unwrap_or(1000).max(1) as f32;
        let (x_height, rule) = (style.metrics.x_height, style.metrics.underline_thickness);
        MathFont {
            face,
            table: font_table(&face, *b"MATH"),
            scale: face.size / units,
            x_height,
            rule,
            is_display: is_display(style),
        }
    }

    /// For `font-size: math`.
    pub(crate) fn script_scale(&self, style: &Style, parent: &Style) -> f32 {
        let [from, to] =
            [parent, style].map(|it| it.other(Id::MathDepth).parse::<i32>().unwrap_or(0));
        let (low, high) = (from.min(to), from.max(to));
        let (mut scale, mut levels) = (1.0, high.saturating_sub(low));
        if let Some(font) = (levels > 0)
            .then(|| self.math_font(parent))
            .filter(|it| !it.table.is_empty())
        {
            let [once, twice] = [(0, 0.71), (2, 0.5041)].map(|(at, or)| {
                font.value(at)
                    .filter(|it| *it != 0.0)
                    .map_or(or, |it| it / 100.0)
            });
            (scale, levels) = match (low, high) {
                (..=0, 2..) => (twice, levels - 2),
                (1, _) => (twice / once, levels - 1),
                (_, 1) => (once, levels - 1),
                _ => (1.0, levels),
            };
        }
        (scale * 0.71f32.powi(levels)).powi(if to < from { -1 } else { 1 })
    }

    fn math_element(&self, id: BoxId) -> Option<&Element> {
        self.tree
            .element(self.boxes[id].node)
            .filter(|it| it.namespace == Namespace::MathMl)
    }

    fn math_tag(&self, id: BoxId) -> Name {
        self.math_element(id).map_or(Name::NONE, |it| it.tag)
    }

    fn in_flow(&self, id: BoxId) -> Vec<BoxId> {
        self.boxes[id]
            .children
            .iter()
            .copied()
            .filter(|it| !self.boxes[*it].style.is_out_of_flow())
            .collect()
    }

    fn math_length(&self, id: BoxId, name: Name) -> Option<Lp> {
        let (style, value) = (
            &self.boxes[id].style,
            self.math_element(id)?.attribute(name)?,
        );
        let (metrics, viewport) = (|| style.metrics, self.environment.viewport);
        let cx = Ctx {
            font: style.font_units(),
            root: self.environment.root_font,
            metrics: &metrics,
            viewport,
            zoom: style.zoom,
            ..Ctx::dummy()
        };
        parse_all(value.as_bytes(), |p| Lp::parse(p, &cx))
            .filter(|_| !value.trim_ascii_end().ends_with(')'))
    }

    fn math_flag(&self, id: BoxId, name: Name) -> Option<bool> {
        let value = self.math_element(id)?.attribute(name)?;
        ["false", "true"]
            .iter()
            .position(|it| value.eq_ignore_ascii_case(it))
            .map(|it| it == 1)
    }

    fn token_text(&self, id: BoxId) -> Option<String> {
        let texts = self
            .tree
            .children(self.boxes[id].node)
            .map(|it| self.tree[it].text().map(crate::values::text));
        Some(texts.collect::<Option<String>>()?.trim_ascii().into())
    }

    fn is_space_like(&self, id: BoxId) -> bool {
        let tag = self.math_tag(id);
        is_name!(tag, "mtext" | "mspace")
            || self.boxes[id].kind == Kind::Math
                && (is_grouping(tag) || tag == name!("mpadded"))
                && self.in_flow(id).iter().all(|it| self.is_space_like(*it))
    }

    /// The child through which it is an embellished operator, if that child is one.
    fn embellished_child(&self, id: BoxId) -> Option<BoxId> {
        let (tag, mut children) = (self.math_tag(id), self.in_flow(id).into_iter());
        match () {
            () if self.boxes[id].kind != Kind::Math => None,
            () if is_scripted(tag) || tag == name!("mfrac") => children.next(),
            () if is_grouping(tag) || tag == name!("mpadded") => {
                let mut others = children.filter(|it| !self.is_space_like(*it));
                others.next().filter(|_| others.next().is_none())
            }
            () => None,
        }
    }

    fn form_by_position(&self, mut id: BoxId) -> Form {
        let mut parent = self.boxes[id].parent;
        while self.embellished_child(parent) == Some(id) {
            (id, parent) = (parent, self.boxes[parent].parent);
        }
        let (tag, mut siblings) = (self.math_tag(parent), self.in_flow(parent));
        if self.boxes[parent].kind != Kind::Math || !is_grouping(tag) {
            return if is_scripted(tag) {
                Form::Postfix
            } else {
                Form::Infix
            };
        }
        siblings.retain(|it| !self.is_space_like(*it));
        if siblings.first() == Some(&id) {
            Form::Prefix
        } else if siblings.last() == Some(&id) {
            Form::Postfix
        } else {
            Form::Infix
        }
    }

    /// Of an embellished operator.
    fn operator(&self, id: BoxId) -> Option<Operator> {
        let core = core::iter::successors(Some(id), |it| self.embellished_child(*it)).last()?;
        let element = self
            .math_element(core)
            .filter(|it| it.tag == name!("mo") && self.boxes[core].style.display().is_math())?;
        let text = self.token_text(core).unwrap_or_default();
        let forms = [
            ("infix", Form::Infix),
            ("postfix", Form::Postfix),
            ("prefix", Form::Prefix),
        ];
        let explicit = element.attribute(name!("form")).and_then(|value| {
            forms
                .into_iter()
                .find(|it| value.eq_ignore_ascii_case(it.0))
        });
        let entry = match explicit {
            Some((_, form)) => look_up_text(form, &text),
            None => [self.form_by_position(core)]
                .into_iter()
                .chain(forms.map(|it| it.1))
                .find_map(|form| look_up_text(form, &text)),
        };
        let (spaces, mut flags) = entry.unwrap_or(([5; 2], 0));
        for (name, flag) in [
            (name!("stretchy"), STRETCHY),
            (name!("symmetric"), SYMMETRIC),
            (name!("largeop"), LARGE),
            (name!("movablelimits"), MOVABLE),
        ] {
            flags = self
                .math_flag(core, name)
                .map_or(flags, |it| if it { flags | flag } else { flags & !flag });
        }
        let spaces =
            [(name!("lspace"), spaces[0]), (name!("rspace"), spaces[1])].map(|(name, default)| {
                let default = f32::from(default) * self.boxes[core].style.font.size.0 / 18.0;
                self.math_length(core, name)
                    .map_or(default, |it| it.resolve(default).max(0.0))
            });
        let mut characters = text.chars();
        let only = characters.next().filter(|_| characters.next().is_none());
        Some(Operator {
            spaces,
            flags,
            is_vertical: !only.is_some_and(stretches_horizontally),
        })
    }

    fn glyph_in(&self, font: &MathFont, text: &str, style: &Style) -> Option<u32> {
        let shaped = self.shape(
            text,
            &[crate::inline::text_run(style, text.len())],
            if style.is_rtl() {
                abi::DIRECTION_RTL
            } else {
                abi::DIRECTION_LTR
            },
        );
        match (shaped.glyphs(), shaped.faces.first()) {
            ([glyph], Some(face)) if face.id == font.face.id && glyph.id != 0 => Some(glyph.id),
            _ => None,
        }
    }

    /// For an `mo` element that does not show its text as it is.
    fn shaped_operator(&self, id: BoxId) -> Option<(Operator, MathFont, u32)> {
        let style = &self.boxes[id].style;
        let operator = (self.math_tag(id) == name!("mo")).then(|| self.operator(id))??;
        let font = (operator.flags & STRETCHY != 0
            || operator.flags & LARGE != 0 && is_display(style))
        .then(|| self.math_font(style))?;
        let glyph = self.glyph_in(
            &font,
            &self.token_text(id).filter(|it| it.chars().count() == 1)?,
            style,
        )?;
        Some((operator, font, glyph))
    }

    fn scripts(&self, id: BoxId) -> Option<Scripts> {
        let (tag, children) = (self.math_tag(id), self.in_flow(id));
        let is_delimiter = |it: &BoxId| self.math_tag(*it) == name!("mprescripts");
        let pairs = match children[..] {
            [base, ref rest @ ..] if tag == name!("mmultiscripts") => {
                let at = rest.iter().position(is_delimiter);
                let (after, before) =
                    at.map_or((rest, &[][..]), |at| (&rest[..at], &rest[at + 1..]));
                let is_valid = !is_delimiter(&base)
                    && after.len() % 2 == 0
                    && before.len() % 2 == 0
                    && !before.iter().any(is_delimiter);
                let pairs = after
                    .as_chunks()
                    .0
                    .iter()
                    .chain(before.as_chunks().0)
                    .copied()
                    .collect();
                return is_valid.then(|| Scripts {
                    pairs,
                    prescripts: at.map(|at| (rest[at], at / 2)),
                });
            }
            [_, script] if is_name!(tag, "msub" | "munder") => [script, 0],
            [_, script] if is_name!(tag, "msup" | "mover") => [0, script],
            [_, below, above] if is_name!(tag, "msubsup" | "munderover") => [below, above],
            _ => return None,
        };
        Some(Scripts {
            pairs: vec![pairs],
            prescripts: None,
        })
    }

    fn schema(&self, id: BoxId) -> Schema {
        let tag = self.math_tag(id);
        match () {
            () if tag == name!("mspace") => Schema::Space,
            () if tag == name!("mpadded") && !self.in_flow(id).is_empty() => Schema::Padded,
            () if tag == name!("msqrt") && !self.in_flow(id).is_empty()
                || tag == name!("mroot") && self.in_flow(id).len() == 2 =>
            {
                Schema::Radical
            }
            () if tag == name!("mfrac") && self.in_flow(id).len() == 2 => Schema::Fraction,
            () if !is_scripted(tag) || self.scripts(id).is_none() => Schema::Row,
            () if !is_name!(tag, "munder" | "mover" | "munderover") => Schema::Scripts,
            () if !is_display(&self.boxes[id].style)
                && self.operator(id).is_some_and(|it| it.flags & MOVABLE != 0) =>
            {
                Schema::Scripts
            }
            () => Schema::UnderOver,
        }
    }

    /// What `lspace` and `rspace` put around a child of a row.
    fn spaces_in_row(&self, id: BoxId) -> impl Fn(&Document, BoxId) -> [f32; 2] + use<> {
        let is_outermost = self.boxes[self.boxes[id].parent].kind != Kind::Math
            || self.operator(id).is_none()
            || self.math_tag(self.boxes[id].parent) == name!("msqrt");
        move |document, child| {
            document
                .operator(child)
                .filter(|_| is_outermost)
                .map_or([0.0; 2], |it| it.spaces)
        }
    }

    fn italic_for_widths(&self, id: BoxId) -> f32 {
        let large = self
            .shaped_operator(id)
            .filter(|it| it.0.flags & STRETCHY == 0);
        large.map_or(0.0, |(_, font, glyph)| {
            font.stretch(glyph, true, font.value(6).unwrap_or(0.0) * font.scale)
                .italic
        })
    }

    pub(crate) fn token_widths(&self, id: BoxId) -> Option<Widths> {
        let (operator, font, glyph) = self.shaped_operator(id)?;
        let width = match (operator.flags & STRETCHY != 0, operator.is_vertical) {
            (true, true) => font.widest_vertical(glyph),
            (true, false) => glyph_extent(&font.face, glyph).advance,
            (false, _) => {
                font.stretch(glyph, true, font.value(6).unwrap_or(0.0) * font.scale)
                    .advance
            }
        };
        Some(Widths {
            sizes: [width; 2],
            uses_height: false,
        })
    }

    pub(crate) fn math_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let (children, style, mut out) = (
            self.in_flow(id),
            Rc::clone(&self.boxes[id].style),
            Widths::default(),
        );
        let all: Vec<_> = children
            .iter()
            .map(|it| self.contribution(*it, height, None))
            .collect();
        out.uses_height = all.iter().any(|it| it.uses_height);
        let (schema, font) = (self.schema(id), self.math_font(&style));
        out.sizes = [0, 1].map(|which| {
            let width = |child: BoxId| {
                children
                    .iter()
                    .position(|it| *it == child)
                    .map_or(0.0, |it| all[it].sizes[which])
            };
            match schema {
                Schema::Space => 0.0,
                Schema::Row | Schema::Padded => {
                    let spaces = self.spaces_in_row(id);
                    let around = |child: BoxId| {
                        if schema == Schema::Row {
                            spaces(self, child).iter().sum()
                        } else {
                            0.0
                        }
                    };
                    children
                        .iter()
                        .zip(&all)
                        .map(|(child, own)| own.sizes[which] + around(*child))
                        .sum()
                }
                Schema::Fraction => width(children[0]).max(width(children[1])),
                Schema::UnderOver => {
                    let italic = self.italic_for_widths(children[0]);
                    children
                        .iter()
                        .skip(1)
                        .map(|it| width(*it) + italic)
                        .fold(width(children[0]), f32::max)
                }
                Schema::Radical => {
                    let index = children.get(1).map_or(0.0, |it| {
                        width(*it) + radical_kerns(&font, width(*it)).iter().sum::<f32>()
                    });
                    index
                        + self
                            .glyph_in(&font, "√", &style)
                            .map_or(0.0, |it| font.widest_vertical(it))
                        + width(children[0])
                }
                Schema::Scripts => {
                    let (base, space) = (
                        width(children[0]),
                        font.get(SpaceAfterScript, font.face.size / 5.0),
                    );
                    let italic = self.italic_for_widths(children[0]).min(base);
                    let scripts = self.scripts(id).into_iter().flat_map(|it| {
                        let after = it.prescripts.map_or(usize::MAX, |it| it.1);
                        it.pairs.into_iter().enumerate().map(move |(index, pair)| {
                            (pair, if index < after { italic } else { 0.0 })
                        })
                    });
                    base + scripts
                        .map(|([below, above], italic)| {
                            (width(below) - italic).max(width(above)) + space
                        })
                        .sum::<f32>()
                }
            }
        });
        out
    }

    fn lay_out_piece(
        &mut self,
        id: BoxId,
        stretch: Option<Stretch>,
        basis: (f32, Option<f32>),
        output: &mut Output,
    ) -> Piece {
        if id == 0 {
            return Piece::default();
        }
        if self.boxes.math.get(&id).and_then(|it| it.stretch) != stretch {
            self.boxes.math.entry(id).or_default().stretch = stretch;
            self.boxes[id].cache.forget_layout();
        }
        let (margin, mut width, own) = self.lay_out_shrunk(id, basis);
        self.absorb(id, &own, output);
        width = width.max(self.boxes[id].layout.size.width);
        let (baseline, italic) = (
            own.baselines[0].unwrap_or(own.height),
            self.boxes.math.get(&id).map_or(0.0, |it| it.italic),
        );
        Piece {
            id,
            margin,
            width: width + margin.sums()[0],
            ascent: margin.top + baseline,
            descent: own.height - baseline + margin.bottom,
            italic,
        }
    }

    /// Those that stretch get as large as the others.
    fn lay_out_stretched(
        &mut self,
        id: BoxId,
        vertically: bool,
        basis: (f32, Option<f32>),
        output: &mut Output,
    ) -> Vec<Piece> {
        let (children, inherited) = (
            self.in_flow(id),
            self.boxes.math.get(&id).and_then(|it| it.stretch),
        );
        let embellished = inherited.and_then(|_| self.embellished_child(id));
        let stretches = |document: &Document, it: BoxId| {
            document
                .operator(it)
                .is_some_and(|it| it.stretches(vertically))
        };
        let takes_part = |it: BoxId| {
            Some(it) != embellished || matches!(inherited, Some(Stretch::Width(_))) != vertically
        };
        let (mut stretchy, mut others): (Vec<_>, Vec<_>) = children
            .iter()
            .filter(|it| takes_part(**it) || !vertically)
            .partition(|it| stretches(self, **it));
        let mut target = None;
        if !stretchy.is_empty() {
            let least = others.is_empty().then_some(if vertically {
                Stretch::Height(0.0, 0.0)
            } else {
                Stretch::Width(0.0)
            });
            others = if least.is_some() {
                stretchy.clone()
            } else {
                others
            };
            let measured: Vec<_> = others
                .into_iter()
                .map(|it| {
                    self.lay_out_piece(
                        it,
                        least.or_else(|| inherited.filter(|_| Some(it) == embellished)),
                        basis,
                        output,
                    )
                })
                .collect();
            let most = |of: fn(&Piece) -> f32| measured.iter().map(of).fold(0.0, f32::max);
            target = Some(match (vertically, inherited) {
                (true, _) => Stretch::Height(most(|it| it.ascent), most(|it| it.descent)),
                (false, Some(Stretch::Width(width))) => {
                    Stretch::Width(width.max(if least.is_some() {
                        0.0
                    } else {
                        most(|it| it.width)
                    }))
                }
                (false, _) => Stretch::Width(most(|it| it.width)),
            });
        }
        stretchy.order_by(Ord::cmp);
        let stretch = |it: BoxId| {
            if stretchy.binary_search(&it).is_ok() {
                target
            } else {
                inherited.filter(|_| Some(it) == embellished)
            }
        };
        children
            .iter()
            .map(|it| self.lay_out_piece(*it, stretch(*it), basis, output))
            .collect()
    }

    #[inline(never)]
    pub(crate) fn lay_out_math(&mut self, id: BoxId, input: &Input) -> Output {
        let it = &self.boxes[id];
        let (style, inset) = (Rc::clone(&it.style), it.inset(input.basis.0));
        let basis = (
            (input.width - inset.sums()[0]).max(0.0),
            it.inner_height(input, inset),
        );
        let (children, font, mut output) =
            (self.in_flow(id), self.math_font(&style), Output::default());
        let inherited = self.boxes.math.get(&id).and_then(|it| it.stretch);
        let length = |document: &Document, name| {
            document
                .math_length(id, name)
                .and_then(|it| if let Lp::Px(px) = it { Some(px) } else { None })
        };
        // From the start of the content box, and from the baseline down.
        let (mut placed, mut bar, mut surd) = (Vec::<(Piece, f32, f32)>::new(), None, None);
        let (mut width, mut italic) = (basis.0, 0.0);
        let [ascent, descent] = match self.schema(id) {
            Schema::Space => {
                let (height, total) = (
                    length(self, name!("height")).unwrap_or(0.0).max(0.0),
                    basis.1.unwrap_or(0.0),
                );
                [height, total - height]
            }
            Schema::Row => {
                let (pieces, spaces, mut x) = (
                    self.lay_out_stretched(id, true, basis, &mut output),
                    self.spaces_in_row(id),
                    0.0,
                );
                for piece in &pieces {
                    let [before, after] = spaces(self, piece.id);
                    placed.push((*piece, x + before, 0.0));
                    x += before + piece.width + after;
                }
                if self.math_tag(id) == name!("math") {
                    placed
                        .iter_mut()
                        .for_each(|it| it.1 += ((basis.0 - x) / 2.0).max(0.0));
                }
                width = if inherited.is_some() {
                    width.max(x)
                } else {
                    width
                };
                italic = if let [only] = pieces[..] {
                    only.italic
                } else {
                    0.0
                };
                [
                    pieces.iter().map(|it| it.ascent).fold(0.0, f32::max),
                    pieces.iter().map(|it| it.descent).fold(0.0, f32::max),
                ]
            }
            Schema::Padded => {
                let content = self.lay_out_piece(children[0], inherited, basis, &mut output);
                placed.push((
                    content,
                    length(self, name!("lspace")).unwrap_or(0.0).max(0.0),
                    -length(self, name!("voffset")).unwrap_or(0.0),
                ));
                [
                    (name!("height"), content.ascent),
                    (name!("depth"), content.descent),
                ]
                .map(|(name, own)| length(self, name).map_or(own, |it| it.max(0.0)))
            }
            Schema::Fraction => {
                let [above, below] = [(0, inherited), (1, None)].map(|(it, stretch)| {
                    self.lay_out_piece(children[it], stretch, basis, &mut output)
                });
                let (default, axis, rule) = (
                    font.get(FractionRuleThickness, font.rule),
                    font.axis(),
                    font.rule,
                );
                let thickness = self
                    .math_length(id, name!("linethickness"))
                    .map_or(default, |it| it.resolve(default).max(0.0));
                let (mut up, mut down);
                if thickness > 0.0 {
                    let [over, under] = [NumeratorGapMin, DenominatorGapMin]
                        .map(|it| font.styled(it, [rule, 3.0 * rule]) + thickness / 2.0);
                    up = font
                        .styled(NumeratorShiftUp, [0.0; 2])
                        .max(axis + over + above.descent);
                    down = font
                        .styled(DenominatorShiftDown, [0.0; 2])
                        .max(under + below.ascent - axis);
                    bar = Some([0.0, -axis - thickness / 2.0, basis.0, thickness]);
                } else {
                    [up, down] =
                        [StackTopShiftUp, StackBottomShiftDown].map(|it| font.styled(it, [0.0; 2]));
                    let missing = (font.styled(StackGapMin, [3.0 * rule, 7.0 * rule])
                        - (down - below.ascent + up - above.descent))
                        .max(0.0);
                    [up, down] = [up + missing / 2.0, down + missing / 2.0];
                }
                placed.extend([
                    (above, (basis.0 - above.width) / 2.0, -up),
                    (below, (basis.0 - below.width) / 2.0, down),
                ]);
                let around_bar = if thickness > 0.0 {
                    [axis + thickness / 2.0, thickness / 2.0 - axis]
                } else {
                    [0.0; 2]
                };
                [
                    (up + above.ascent)
                        .max(below.ascent - down)
                        .max(around_bar[0])
                        .max(0.0),
                    (above.descent - up)
                        .max(down + below.descent)
                        .max(around_bar[1])
                        .max(0.0),
                ]
            }
            Schema::Radical => {
                let [base, index] = [0, 1].map(|it| {
                    self.lay_out_piece(
                        children.get(it).copied().unwrap_or(0),
                        None,
                        basis,
                        &mut output,
                    )
                });
                let (glyph, mut x) = (self.glyph_in(&font, "√", &style), 0.0);
                let [gap, thickness, extra] = match glyph {
                    Some(_) => [
                        font.styled(
                            RadicalVerticalGap,
                            [font.rule * 1.25, font.rule + font.x_height / 4.0],
                        ),
                        font.get(RadicalRuleThickness, font.rule),
                        font.get(RadicalExtraAscender, font.rule),
                    ],
                    None => [0.0; 3],
                };
                let shaped = glyph.map_or_else(Stretched::default, |it| {
                    font.stretch(it, true, base.ascent + base.descent + gap + thickness)
                });
                let (size, top) = (
                    shaped.ascent + shaped.descent,
                    base.ascent + gap + thickness,
                );
                let mut extent = [top + extra, base.descent.max(size - top)];
                if index.id != 0 {
                    let ([before, after], raise) = (
                        radical_kerns(&font, index.width),
                        font.value(8 + 4 * 51).map_or(0.6, |it| it / 100.0) * size,
                    );
                    let baseline = extent[1] - raise - index.descent;
                    placed.push((index, before, baseline));
                    extent = [
                        extent[0].max(index.ascent - baseline),
                        extent[1].max(baseline + index.descent),
                    ];
                    x = before + index.width + after;
                }
                placed.push((base, x + shaped.advance, 0.0));
                bar = Some([x + shaped.advance, -top, base.width, thickness]);
                surd = Some((x, shaped.ascent - top, shaped));
                extent
            }
            Schema::Scripts => {
                let Scripts { pairs, prescripts } = self.scripts(id).unwrap_or(Scripts {
                    pairs: Vec::new(),
                    prescripts: None,
                });
                let base = self.lay_out_piece(children[0], inherited, basis, &mut output);
                let pairs: Vec<_> = pairs
                    .into_iter()
                    .map(|it| it.map(|it| self.lay_out_piece(it, None, basis, &mut output)))
                    .collect();
                let (x_height, space) = (
                    font.x_height,
                    font.get(SpaceAfterScript, font.face.size / 5.0),
                );
                let shift_up = if style.other(Id::MathShift) == "compact" {
                    SuperscriptShiftUpCramped
                } else {
                    SuperscriptShiftUp
                };
                let least_down = font
                    .get(SubscriptShiftDown, x_height / 3.0)
                    .max(base.descent + font.get(SubscriptBaselineDropMin, x_height / 2.0));
                let least_up = font
                    .get(shift_up, x_height)
                    .max(base.ascent - font.get(SuperscriptBaselineDropMax, x_height / 2.0));
                let (mut down, mut up, mut extent) = (
                    least_down,
                    least_up,
                    [base.ascent.max(0.0), base.descent.max(0.0)],
                );
                for [below, above] in &pairs {
                    let mut own_down =
                        least_down.max(below.ascent - font.get(SubscriptTopMax, x_height * 0.8));
                    let mut own_up = least_up
                        .max(above.descent + font.get(SuperscriptBottomMin, x_height / 4.0));
                    let missing = font.get(SubSuperscriptGapMin, 4.0 * font.rule)
                        - (own_down - below.ascent + own_up - above.descent);
                    if below.id != 0 && above.id != 0 && missing > 0.0 {
                        let raised = (font.get(SuperscriptBottomMaxWithSubscript, x_height * 0.8)
                            - (own_up - above.descent))
                            .clamp(0.0, missing);
                        (own_up, own_down) = (own_up + raised, own_down + missing - raised);
                    }
                    (down, up) = (down.max(own_down), up.max(own_up));
                }
                let (after, before) = pairs.split_at(prescripts.map_or(pairs.len(), |it| it.1));
                let mut x = 0.0;
                for [below, above] in before {
                    x += space + below.width.max(above.width);
                    placed.extend([
                        (*below, x - below.width, down),
                        (*above, x - above.width, -up),
                    ]);
                }
                if let Some((delimiter, _)) = prescripts {
                    placed.push((
                        self.lay_out_piece(delimiter, None, basis, &mut output),
                        x,
                        0.0,
                    ));
                }
                placed.push((base, x, 0.0));
                x += base.width;
                let italic = base.italic.min(base.width);
                for [below, above] in after {
                    placed.extend([(*below, (x - italic).max(0.0), down), (*above, x, -up)]);
                    x += space + (below.width - italic).max(above.width);
                }
                for [below, above] in &pairs {
                    extent[0] = if above.id == 0 {
                        extent[0]
                    } else {
                        extent[0].max(above.ascent + up)
                    };
                    extent[1] = if below.id == 0 {
                        extent[1]
                    } else {
                        extent[1].max(below.descent + down)
                    };
                }
                width = if inherited.is_some() {
                    width.max(x)
                } else {
                    width
                };
                extent
            }
            Schema::UnderOver => {
                let pieces = self.lay_out_stretched(id, false, basis, &mut output);
                let [below, above] = self
                    .scripts(id)
                    .map_or([0; 2], |it| it.pairs[0])
                    .map(|id| pieces.iter().find(|it| it.id == id));
                let (base, operator, rule) = (
                    pieces[0],
                    self.operator(id).filter(|_| !font.table.is_empty()),
                    font.rule,
                );
                let limits = match operator {
                    Some(it) if it.flags & LARGE != 0 => Some([
                        LowerLimitGapMin,
                        LowerLimitBaselineDropMin,
                        UpperLimitGapMin,
                        UpperLimitBaselineRiseMin,
                    ]),
                    Some(it) if it.stretches(false) => Some([
                        StretchStackGapBelowMin,
                        StretchStackBottomShiftDown,
                        StretchStackGapAboveMin,
                        StretchStackTopShiftUp,
                    ]),
                    _ => None,
                };
                let (limits, mut extent) = (
                    limits.map(|it| it.map(|it| font.get(it, 0.0))),
                    [base.ascent, base.descent],
                );
                width = if inherited.is_some() {
                    pieces.iter().map(|it| it.width).fold(width, f32::max)
                } else {
                    width
                };
                let centered = |it: &Piece, shift: f32| (width - it.width + shift) / 2.0;
                placed.push((base, centered(&base, 0.0), 0.0));
                if let Some(above) = above {
                    let (gap, extra) = match (limits, self.math_flag(id, name!("accent"))) {
                        (Some([_, _, gap, shift]), _) => {
                            (gap.max(shift - above.descent + above.margin.bottom), 0.0)
                        }
                        (_, Some(true)) => (
                            (font.get(AccentBaseHeight, font.x_height) - base.ascent).max(0.0),
                            font.get(OverbarExtraAscender, rule),
                        ),
                        _ => (
                            font.get(OverbarVerticalGap, 3.0 * rule),
                            font.get(OverbarExtraAscender, rule),
                        ),
                    };
                    placed.push((
                        *above,
                        centered(above, base.italic),
                        -base.ascent - gap - above.descent,
                    ));
                    extent[0] += gap + above.descent + above.ascent + extra;
                }
                if let Some(below) = below {
                    let (gap, extra) = match (limits, self.math_flag(id, name!("accentunder"))) {
                        (Some([gap, shift, ..]), _) => {
                            (gap.max(shift - below.ascent + below.margin.top), 0.0)
                        }
                        (_, Some(true)) => (0.0, font.get(UnderbarExtraDescender, rule)),
                        _ => (
                            font.get(UnderbarVerticalGap, 3.0 * rule),
                            font.get(UnderbarExtraDescender, rule),
                        ),
                    };
                    placed.push((
                        *below,
                        centered(below, -base.italic),
                        base.descent + gap + below.ascent,
                    ));
                    extent[1] += gap + below.ascent + below.descent + extra;
                }
                extent
            }
        };
        let (baseline, rtl) = (inset.top + ascent, style.is_rtl());
        let left = |x: f32, own: f32| inset.left + if rtl { width - x - own } else { x };
        for (piece, x, y) in placed.into_iter().filter(|it| it.0.id != 0) {
            let at = [
                left(x, piece.width) + piece.margin.left,
                baseline + y - piece.ascent + piece.margin.top,
            ];
            self.place_child(piece.id, at, piece.margin, basis);
        }
        for child in self.boxes[id].children.clone() {
            let it = &mut self.boxes[child];
            if it.style.is_out_of_flow() {
                it.static_position = [
                    (left(0.0, 0.0), Edge::from(AlignName::Start, rtl)),
                    (inset.top, Edge::Near),
                ];
                output.escapes |= it.out_of_flow();
            }
        }
        let own = self.boxes.math.entry(id).or_default();
        own.italic = italic;
        own.bar = bar.map_or_else(Rect::default, |[x, y, width, height]| {
            Rect::new([left(x, width), baseline + y, width, height])
        });
        own.glyphs = surd.map(|(x, y, it)| {
            (
                font.face,
                moved(it.glyphs, left(x, it.advance), baseline + y),
            )
        });
        self.boxes[id].layout.size.width = width + inset.sums()[0];
        (output.intrinsic, output.baselines) =
            (baseline + descent + inset.bottom, [Some(baseline); 2]);
        self.finish_height(id, input, inset, &mut output);
        output
    }

    /// After its contents have been laid out as those of a block.
    pub(crate) fn finish_token(&mut self, id: BoxId, input: &Input, output: &mut Output) {
        let (inset, shaped) = (
            self.boxes[id].inset(input.basis.0),
            self.shaped_operator(id),
        );
        let own = self.boxes.math.entry(id).or_default();
        let stretch = own.stretch;
        (own.glyphs, own.italic) = (None, 0.0);
        let [ascent, descent] = if let Some((operator, font, glyph)) = shaped {
            let (axis, is_symmetric) = (font.axis(), operator.flags & SYMMETRIC != 0);
            let (mut target, mut wanted) = (0.0, None);
            match stretch {
                _ if operator.flags & STRETCHY == 0 => {
                    target = font.value(6).unwrap_or(0.0) * font.scale
                }
                Some(Stretch::Width(width)) => target = width,
                Some(Stretch::Height(mut above, mut below)) => {
                    if is_symmetric {
                        let half = (above - axis).max(below + axis);
                        (above, below) = (half + axis, half - axis);
                    }
                    let plain = font.stretch(glyph, true, 0.0);
                    let [min, max] = [name!("minsize"), name!("maxsize")].map(|it| {
                        Some(
                            self.math_length(id, it)?
                                .resolve(plain.ascent + plain.descent),
                        )
                    });
                    let min = min.unwrap_or(plain.ascent + plain.descent).max(0.0);
                    target = (above + below).clamp(min, max.unwrap_or(f32::MAX).max(min));
                    above = axis
                        + if above + below <= 0.0 {
                            target / 2.0
                        } else {
                            (above - axis) * target / (above + below)
                        };
                    wanted = Some(2.0 * above - target);
                }
                None => {}
            }
            let is_vertical = operator.is_vertical || operator.flags & STRETCHY == 0;
            let it = font.stretch(glyph, is_vertical, target);
            let centered = (operator.flags & STRETCHY == 0 && is_symmetric).then_some(2.0 * axis);
            let shift = wanted
                .or(centered)
                .map_or(0.0, |wanted| (it.ascent - it.descent - wanted) / 2.0);
            let width = if is_vertical {
                input.width
            } else {
                it.advance + inset.sums()[0]
            };
            let x = inset.left + (width - inset.sums()[0] - it.advance) / 2.0;
            self.boxes[id].layout.size.width = width;
            let own = self.boxes.math.entry(id).or_default();
            (own.glyphs, own.italic) = (
                Some((font.face, moved(it.glyphs, x, inset.top + it.ascent))),
                it.italic,
            );
            [it.ascent - shift, it.descent + shift]
        } else if let (Some(_), [lines]) = (self.token_text(id), &self.boxes[id].children[..]) {
            let paragraphs = self.boxes[*lines]
                .inline
                .iter()
                .flat_map(|it| &it.clusters.paragraphs)
                .map(|it| &it.shaped);
            let glyphs = paragraphs.flat_map(|it| {
                it.clusters().iter().flat_map(move |cluster| {
                    it.glyphs()[cluster.glyphs.range()]
                        .iter()
                        .map(move |glyph| (it, cluster, glyph))
                })
            });
            let inks = glyphs.map(|(it, cluster, glyph)| {
                glyph_extent(&it.faces[usize::from(cluster.face)], glyph.id)
                    .ink
                    .moved([0.0, glyph.y])
            });
            let ink = inks
                .filter(|it| !it.is_empty())
                .reduce(|a, b| a.union(&b))
                .unwrap_or_default();
            [-ink.y, ink.bottom()]
        } else {
            return;
        };
        let baseline = inset.top + ascent;
        self.shift_children(
            id,
            baseline - output.baselines[0].unwrap_or(baseline),
            output,
            None,
        );
        (output.intrinsic, output.baselines) =
            (baseline + descent + inset.bottom, [Some(baseline); 2]);
        self.finish_height(id, input, inset, output);
    }

    pub(crate) fn math_table_baseline(&self, id: BoxId, height: f32) -> Option<f32> {
        (self.math_tag(id) == name!("mtable"))
            .then(|| height / 2.0 + self.math_font(&self.boxes[id].style).axis())
    }

    /// What an operator is like depends on the elements around it.
    pub(crate) fn math_changed(&mut self, id: NodeId) {
        let is_math = |it: &NodeId| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.namespace == Namespace::MathMl)
        };
        let formula = core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .take_while(is_math)
            .last();
        self.changed_formulas.extend(formula);
        self.needs_layout = true;
    }

    pub(crate) fn forget_math_layout(&mut self, id: BoxId) {
        self.boxes[id].cache.clear();
        self.boxes.note_new_part(id);
        self.repaint_box(id);
        for index in 0..self.boxes[id].children.len() {
            self.forget_math_layout(self.boxes[id].children[index]);
        }
    }
}

fn radical_kerns(font: &MathFont, index: f32) -> [f32; 2] {
    let em = font.face.size / 18.0;
    [
        font.get(RadicalKernBeforeDegree, 5.0 * em).max(0.0),
        font.get(RadicalKernAfterDegree, -10.0 * em).max(-index),
    ]
}

fn moved(glyphs: Vec<Glyph>, x: f32, y: f32) -> Vec<Glyph> {
    glyphs
        .into_iter()
        .map(|it| Glyph {
            x: it.x + x,
            y: it.y + y,
            ..it
        })
        .collect()
}

//! Line breaking, and the placement of what is on each line.

use core::hint::select_unpredictable;
use core::ops::Range;
use std::rc::Rc;

use smallvec::{SmallVec, smallvec};

use crate::abi::{CLUSTER_BREAK_BEFORE, CLUSTER_SOFT_HYPHEN, CLUSTER_SPACE, Cluster, Letter, Rect};
use crate::block::{Floats, clears};
use crate::boxes::{BoxId, Kind};
use crate::characters::{Punctuation, is_blank, is_cursive, is_ideographic};
use crate::document::{Document, Quirks};
use crate::fragment::Breaks;
use crate::inline::{
    COMBINED, Clusters, IDEOGRAPHIC_SPACE, Inline, Item, ItemKind, OPENING, TRIMS, UPRIGHT,
};
use crate::layout::{
    Claims, Edges, Input, Output, Traits, Widths, at_least, at_most, ceil_to_unit, resolve,
    resolve_if_definite, unit,
};
use crate::order::Order as _;
use crate::platform::Shaped;
use crate::positioned::Edge;
use crate::properties::Style;
use crate::tree::NodeId;
use crate::types::*;
use crate::values::{Auto, Lp};

const TOLERANCE: f32 = 1.0 / 64.0;

#[derive(Clone)]
pub(crate) enum FragmentKind {
    /// The last `hidden` clusters take no room.
    Text {
        clusters: Range<u32>,
        rtl: bool,
        hidden: u8,
    },
    /// Whether it has its left and its right edge.
    Box(bool, bool),
    Atomic(BoxId),
    Hyphen(Rc<Shaped>),
}

/// Relative to the `Lines` box.
#[derive(Clone)]
pub(crate) struct Fragment {
    pub(crate) kind: FragmentKind,
    pub(crate) item: u32,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) width: f32,
    pub(crate) height: f32,
    pub(crate) baseline: f32,
    /// The inline element that is painted apart, if it is in one.
    pub(crate) layer: NodeId,
}

pub(crate) struct Truncation {
    /// Nothing is painted past it.
    pub(crate) limit: f32,
    pub(crate) x: f32,
    pub(crate) ellipsis: Rc<Shaped>,
}

pub(crate) struct Line {
    pub(crate) y: f32,
    pub(crate) height: f32,
    pub(crate) baseline: f32,
    /// The space that it had.
    pub(crate) left: f32,
    pub(crate) right: f32,
    pub(crate) rtl: bool,
    has_content: bool,
    /// Where the spaces that hang begin.
    end: f32,
    pub(crate) clusters: Range<u32>,
    pub(crate) fragments: Range<u32>,
    pub(crate) overflow: Option<Box<Truncation>>,
    pub(crate) clamp: Option<Box<Truncation>>,
}

#[derive(Default)]
pub(crate) struct Lines {
    pub(crate) lines: SmallVec<[Line; 1]>,
    pub(crate) fragments: SmallVec<[Fragment; 1]>,
    /// For each cluster, with tabs, justification and collapsed spaces. Empty if they are those of the clusters.
    pub(crate) advances: Vec<f32>,
    /// Of the lines, and of the text and the inline boxes that stick out of them.
    pub(crate) bounds: Rect,
    /// Of the line boxes, as wide as what is on them.
    pub(crate) flow: Rect,
    /// How many `-webkit-line-clamp` leaves.
    pub(crate) visible: Option<u32>,
    /// The least and the greatest width for which they are the same.
    holds: Option<[f32; 2]>,
}

impl Line {
    pub(crate) fn translate(&mut self, [x, y]: [f32; 2]) {
        (self.left, self.right, self.end, self.y, self.baseline) = (
            self.left + x,
            self.right + x,
            self.end + x,
            self.y + y,
            self.baseline + y,
        );
        self.overflow
            .iter_mut()
            .for_each(|it| (it.limit, it.x) = (it.limit + x, it.x + x));
    }
}

impl Lines {
    pub(crate) fn fragments_of(&self, line: &Line) -> &[Fragment] {
        &self.fragments[line.fragments.start as usize..line.fragments.end as usize]
    }

    /// The left edge and the advance of each cluster, in logical order.
    fn positions<'a>(
        &'a self,
        all: &'a [Cluster],
        fragment: &'a Fragment,
    ) -> impl Iterator<Item = (u32, f32, f32)> + 'a {
        let (clusters, rtl, shown) = match &fragment.kind {
            FragmentKind::Text {
                clusters,
                rtl,
                hidden,
            } => (clusters.clone(), *rtl, clusters.end - u32::from(*hidden)),
            _ => (0..0, false, 0),
        };
        let mut x = fragment.x + if rtl { fragment.width } else { 0.0 };
        clusters.map(move |cluster| {
            let advance = self
                .advances
                .get(cluster as usize)
                .copied()
                .unwrap_or_else(|| {
                    if cluster < shown {
                        all[cluster as usize].advance
                    } else {
                        0.0
                    }
                });
            let left = if rtl { x - advance } else { x };
            x = if rtl { left } else { left + advance };
            (cluster, left, advance)
        })
    }
}

impl Inline {
    pub(crate) fn positions<'a>(
        &'a self,
        fragment: &'a Fragment,
    ) -> impl Iterator<Item = (u32, f32, f32)> + 'a {
        self.lines.positions(&self.clusters, fragment)
    }

    /// One of the fragments has the cluster.
    pub(crate) fn advance(&self, fragments: &[Fragment], cluster: u32) -> f32 {
        let is_hidden = |it: &Fragment| matches!(&it.kind, FragmentKind::Text { clusters, hidden, .. } if (clusters.end - u32::from(*hidden)..clusters.end).contains(&cluster));
        let own = || {
            if fragments.iter().any(is_hidden) {
                0.0
            } else {
                self.clusters[cluster as usize].advance
            }
        };
        self.lines
            .advances
            .get(cluster as usize)
            .copied()
            .unwrap_or_else(own)
    }
}

impl Truncation {
    pub(crate) fn shows(&self, left: f32, width: f32, rtl: bool) -> bool {
        match rtl {
            true => left >= self.limit - TOLERANCE,
            false => left + width <= self.limit + TOLERANCE,
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Cut {
    item: usize,
    cluster: u32,
}

struct Broken {
    start: Cut,
    /// One past the last item.
    end_item: usize,
    next: Cut,
    /// Without the spaces that hang.
    width: f32,
    is_forced: bool,
    has_hyphen: bool,
}

#[derive(Clone, Copy, Default)]
struct Embedded {
    size: [f32; 2],
    /// Top, right, bottom, left.
    margin: [f32; 4],
    /// From the top of the margin box.
    baseline: f32,
}

impl Embedded {
    /// Above and below the baseline.
    fn extent(&self) -> [f32; 2] {
        [
            self.baseline,
            self.margin[0] + self.size[1] + self.margin[2] - self.baseline,
        ]
    }
}

#[derive(Clone, Copy)]
struct Source<'a> {
    inline: &'a Inline,
    root: &'a Style,
    /// For each item, the width of its edge or of its margin box. For text, what a ruby adds to each opportunity.
    /// If there are rubies, then for each item how far it hangs over what follows.
    widths: &'a [f32],
}

impl<'a> Source<'a> {
    fn style_of(&self, parent: u32) -> &'a Style {
        match parent {
            0 => self.root,
            parent => &self.inline.items[parent as usize - 1].style,
        }
    }
}

type ItemWidths = SmallVec<[f32; 8]>;

/// For the first line, and for the others.
type Sources<'a> = [Source<'a>; 2];

/// For the first line, after a forced break, and after another one.
type Indents = [f32; 3];

impl Cut {
    fn is_start(self) -> bool {
        self.item == 0 && self.cluster == 0
    }
}

struct Breaker<'a, 'b> {
    sources: Sources<'a>,
    /// From the content edge, which tab stops start at, to the start of the line.
    offset: f32,
    advances: &'b mut [f32],
    is_min_content: bool,
    hyphen: &'a dyn Fn(&Style) -> f32,
    candidates: Option<&'b mut Vec<Candidate>>,
}

/// An opportunity to break.
struct Candidate {
    /// Where a line would start after it, and end before it.
    start: f32,
    end: f32,
    has_hyphen: bool,
}

/// Blink's `ScoreLineBreaker`. Returns the widths of the lines.
fn best_widths(
    candidates: &[Candidate],
    available: f32,
    root: &Style,
    is_balanced: bool,
) -> Vec<f32> {
    let unit = available * root.font.size.0 / root.zoom;
    let (for_hyphen, for_line) = if root.text.align == TextAlign::Justify {
        (unit / 2.0, 0.0)
    } else {
        (unit * 2.0, unit * 4.0)
    };
    let last = candidates.len() - 1;
    let last_word = candidates[..last]
        .iter()
        .rposition(|it| !it.has_hyphen)
        .unwrap_or(0);
    let penalty = |index: usize| {
        let for_orphan = if (last_word..last).contains(&index) {
            10_000.0 * root.zoom
        } else {
            0.0
        };
        for_orphan
            + if candidates[index].has_hyphen {
                for_hyphen
            } else {
                0.0
            }
    };
    let mut scores = vec![(0.0f32, 0)];
    for end in 1..=last {
        let score = |start: usize| {
            let free = candidates[start].start + available + TOLERANCE - candidates[end].end;
            scores[start].0
                + match () {
                    () if free < 0.0 => 1e12,
                    () if end == last && !is_balanced => 4.0 * penalty(start),
                    () => free * free,
                }
        };
        let best = (0..end)
            .rev()
            .map(|start| (score(start), start))
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .unwrap_or_default();
        scores.push((best.0 + penalty(end) + for_line, best.1));
    }
    let breaks = core::iter::successors(Some(last), |it| (*it > 0).then_some(scores[*it].1));
    let mut widths: Vec<_> = breaks
        .take_while(|it| *it > 0)
        .map(|it| candidates[it].end - candidates[scores[it].1].start)
        .collect();
    widths.reverse();
    widths
}

fn wraps(style: &Style) -> bool {
    style.text.wrap == TextWrapMode::Wrap
}

fn is_space(inline: &Inline, cluster: u32) -> bool {
    inline.clusters[cluster as usize].flags & CLUSTER_SPACE != 0
}

/// To the sides of the contents of their elements, wherever those have ended up.
fn move_edges_outside(inline: &Inline, pieces: &mut [Piece]) {
    let element = |index: usize| match inline.items[index].kind {
        ItemKind::Open(_) => Some(index),
        ItemKind::Close(_) => Some(inline.items[index].parent as usize - 1),
        _ => None,
    };
    let mut edges: Vec<_> = pieces
        .iter()
        .filter(|it| it.width != 0.0)
        .filter_map(|it| Some((element(it.item)?, it.item)))
        .collect();
    edges.order_by(|a, b| b.cmp(a));
    for (open, edge) in edges {
        let inside = inline.inside(open);
        let Some(from) = pieces.iter().position(|it| it.item == edge) else {
            continue;
        };
        let belongs = |it: &Piece| (open..=inside.end).contains(&it.item);
        let [first, last] = [
            pieces.iter().position(belongs),
            pieces.iter().rposition(belongs),
        ]
        .map(|it| it.unwrap_or(from));
        match (edge == open) != inline.items[edge].style.is_rtl() {
            true => pieces[first..=from].rotate_right(1),
            false => pieces[from..=last].rotate_left(1),
        }
    }
}

/// Whether justification puts space between the cluster and the next one.
fn expands_after(inline: &Inline, justify: TextJustify, at: u32) -> bool {
    let (character, next) = (inline.character(at), inline.character(at + 1));
    let joins = inline.clusters[at as usize + 1].flags & COMBINED != 0
        && inline.clusters[at as usize + 1].advance == 0.0;
    match justify {
        _ if joins || character == '\t' || [character, next] == ['\u{fffc}'; 2] => false,
        TextJustify::None => false,
        TextJustify::InterCharacter => !is_cursive(character) || !is_cursive(next),
        TextJustify::InterWord => matches!(
            character,
            ' ' | '\u{a0}' | '\u{1361}' | '\u{10100}' | '\u{10101}' | '\u{1039f}' | '\u{1091f}'
        ),
        TextJustify::Auto => {
            matches!(character, ' ' | '\u{a0}') || is_ideographic(character) || is_ideographic(next)
        }
    }
}

fn tab_advance(style: &Style, root: &Style, x: f32) -> f32 {
    let space = root.metrics.space_advance + root.letter_spacing() + root.word_spacing();
    let interval = match style.text.tab_size {
        TabSize::Spaces(count) => count * space,
        TabSize::Px(px) => px,
    };
    if interval <= 0.0 {
        return 0.0;
    }
    let advance = interval - x.rem_euclid(interval);
    if advance < root.metrics.zero_advance / 2.0 {
        advance + interval
    } else {
        advance
    }
}

impl<'a> Breaker<'a, '_> {
    fn next_line_of_prose(&mut self, start: Cut, indent: f32, available: f32) -> Option<Broken> {
        let Source { inline, root, .. } = self.sources[1];
        let prose = inline.prose(root).filter(|_| self.candidates.is_none())?;
        let first = prose
            .runs
            .binary_search_by_key(&(start.item as u32, start.cluster), |it| {
                (it.item, it.start)
            })
            .ok()?;
        let (end, width, is_forced) = prose.break_line(
            first,
            indent,
            available,
            prose.breaks_words[usize::from(self.is_min_content)],
        )?;
        let next = prose.runs.get(end).map_or(
            Cut {
                item: inline.items.len(),
                cluster: inline.clusters.len() as u32,
            },
            |it| Cut {
                item: it.item as usize,
                cluster: it.start,
            },
        );
        let range = start.cluster as usize..next.cluster as usize;
        self.advances[range.clone()]
            .iter_mut()
            .zip(&inline.clusters[range])
            .for_each(|it| *it.0 = it.1.advance);
        prose.runs[first..end]
            .iter()
            .filter(|it| it.part == Part::Atomic)
            .for_each(|it| self.advances[it.start as usize] = it.width);
        if let Some(last) = prose.runs[first..end]
            .iter()
            .rfind(|it| it.part != Part::Close)
            .filter(|it| it.part == Part::LastOfLine)
        {
            self.advances[inline.items[last.item as usize]
                .clusters
                .end
                .min(next.cluster) as usize
                - 1] = 0.0;
        }
        let end_item = if end == prose.runs.len() {
            next.item
        } else {
            prose.runs[end - 1].item as usize + 1
        };
        Some(Broken {
            start,
            end_item: end_item.max(next.item),
            next,
            width,
            is_forced,
            has_hyphen: false,
        })
    }

    /// `float` places the float of an item if it fits after so much of the line, and returns the width that is left.
    fn next_line(
        &mut self,
        start: Cut,
        indent: f32,
        mut available: f32,
        float: &mut dyn FnMut(usize, f32) -> Option<f32>,
    ) -> Broken {
        let source = self.sources[usize::from(!start.is_start())];
        let Source {
            inline,
            root,
            widths,
        } = source;
        if let Some(line) = self.next_line_of_prose(start, indent, available) {
            return line;
        }
        let items = &inline.items;
        let (mut x, mut hanging, mut has_content) = (indent, 0.0, false);
        let mut opportunity: Option<(Cut, f32, bool)> = None;
        let (mut last_resort, mut broke_words) = (None, false);
        let mut opens: Option<(usize, f32)> = None;
        let mut previous: Option<(&Item, u8)> = None;
        let (mut common_wraps, mut overhang) = (true, 0.0);
        let end = |cut: Cut, width, has_hyphen| Broken {
            start,
            end_item: cut.item + usize::from(items[cut.item].clusters.start < cut.cluster),
            next: cut,
            width,
            is_forced: false,
            has_hyphen,
        };
        for (index, item) in items.iter().enumerate().skip(start.item) {
            match item.kind {
                ItemKind::Open(_) | ItemKind::RubyBase => {
                    opens.get_or_insert((index, x - hanging));
                    x += widths[index];
                    continue;
                }
                ItemKind::Close(_) => {
                    opens = None;
                    x += widths[index];
                    common_wraps = wraps(source.style_of(items[item.parent as usize - 1].parent));
                    if x - hanging > available + TOLERANCE
                        && let Some((cut, width, has_hyphen)) = opportunity
                    {
                        return end(cut, width, has_hyphen);
                    }
                    continue;
                }
                ItemKind::Annotation(..) => {
                    x += widths[index];
                    overhang = widths[items.len() + index];
                    if x > available + TOLERANCE
                        && let Some((cut, width, has_hyphen)) = opportunity
                    {
                        return end(cut, width, has_hyphen);
                    }
                    continue;
                }
                ItemKind::Float(_) => {
                    available = float(index, x - hanging).unwrap_or(available);
                    continue;
                }
                ItemKind::OutOfFlow(_) => continue,
                _ => {}
            }
            let is_atomic = matches!(item.kind, ItemKind::Atomic(_));
            let style = if is_atomic {
                source.style_of(item.parent)
            } else {
                &*item.style
            };
            let text = &style.text;
            let breaks_spaces = text.collapse == WhiteSpaceCollapse::BreakSpaces;
            let breaks_words = !is_atomic
                && (text.overflow_wrap == OverflowWrap::Anywhere
                    || text.word_break == WordBreak::BreakWord
                    || text.overflow_wrap == OverflowWrap::BreakWord && !self.is_min_content);
            let (item_wraps, keeps_spaces) = (wraps(style), text.collapse.preserves_spaces());
            let is_ordinary = item.kind == ItemKind::Text
                && !breaks_spaces
                && widths[index] == 0.0
                && self.candidates.is_none();
            let mut next = item.clusters.start.max(start.cluster);
            while next < item.clusters.end {
                let at = next;
                next += 1;
                let cluster = &inline.clusters[at as usize];
                let is_first = at == item.clusters.start;
                let cut = match opens.filter(|_| is_first) {
                    Some((item, width)) => (Cut { item, cluster: at }, width),
                    None => (
                        Cut {
                            item: index,
                            cluster: at,
                        },
                        x - hanging,
                    ),
                };
                if let Some((before, flags)) = previous {
                    let after_space = flags & CLUSTER_SPACE != 0;
                    let is_allowed = match (is_first, after_space) {
                        (false, _) => item_wraps,
                        (true, true) => wraps(&before.style),
                        (true, false) => common_wraps,
                    };
                    let is_hyphen = flags & CLUSTER_SOFT_HYPHEN != 0;
                    if is_allowed
                        && has_content
                        && (cluster.flags & CLUSTER_BREAK_BEFORE != 0
                            || breaks_spaces && after_space)
                        && !(is_hyphen && before.style.text.hyphens == Hyphens::None)
                    {
                        let width = cut.1
                            + if is_hyphen {
                                (self.hyphen)(&before.style)
                            } else {
                                0.0
                            };
                        if let Some(candidates) = &mut self.candidates {
                            candidates.push(Candidate {
                                start: cut.1 + hanging,
                                end: width,
                                has_hyphen: is_hyphen,
                            });
                        }
                        if !is_hyphen || width <= available + TOLERANCE || opportunity.is_none() {
                            opportunity = Some((cut.0, width, is_hyphen));
                        }
                    }
                }
                if has_content
                    && if is_first {
                        common_wraps && (breaks_words || broke_words)
                    } else {
                        item_wraps && breaks_words
                    }
                {
                    last_resort = Some(cut);
                }
                let byte = inline.text.as_bytes()[cluster.start as usize];
                if byte == b'\n' {
                    self.advances[at as usize] = 0.0;
                    let mut next = Cut {
                        item: index,
                        cluster: at + 1,
                    };
                    if next.cluster == item.clusters.end {
                        next.item += 1;
                        while items
                            .get(next.item)
                            .is_some_and(|it| matches!(it.kind, ItemKind::Close(_)))
                        {
                            x += widths[next.item];
                            next.item += 1;
                        }
                    }
                    let fits = x <= available + TOLERANCE;
                    return Broken {
                        start,
                        end_item: next.item.max(index + 1),
                        next,
                        width: if fits {
                            x
                        } else {
                            (x - hanging).max(available.min(x))
                        },
                        is_forced: true,
                        has_hyphen: false,
                    };
                }
                let mut advance = match byte {
                    _ if is_atomic => widths[index],
                    b'\t' => tab_advance(style, root, x + self.offset + overhang),
                    _ if widths[index] != 0.0 && expands_in_base(inline, at) => {
                        cluster.advance + widths[index]
                    }
                    _ => cluster.advance,
                };
                if cluster.flags & OPENING != 0 {
                    advance -= inline.trimmed_start(at, style, at == start.cluster);
                } else if cluster.flags & TRIMS != 0
                    && item_wraps
                    && x + advance > available + TOLERANCE
                {
                    let trimmed = advance - inline.trimmed_start(at, style, false);
                    let ends = inline.clusters.get(at as usize + 1).is_none_or(|it| {
                        it.flags & CLUSTER_BREAK_BEFORE != 0 || inline.is_newline(at + 1)
                    });
                    advance = if ends && x + trimmed <= available + TOLERANCE {
                        trimmed
                    } else {
                        advance
                    };
                }
                if cluster.flags & CLUSTER_SPACE == 0 {
                    overhang = 0.0;
                }
                self.advances[at as usize] = advance;
                previous = Some((item, cluster.flags));
                let hangs = !breaks_spaces
                    && cluster.flags & CLUSTER_SPACE != 0
                    && (item_wraps || !keeps_spaces && byte != 0xe3);
                if hangs {
                    hanging += advance;
                } else {
                    let autospace = inline.autospace_after(at);
                    if x + advance - autospace > available + TOLERANCE && advance > 0.0 {
                        if let Some((cut, width, has_hyphen)) = opportunity {
                            return end(cut, width, has_hyphen);
                        }
                        if let Some((cut, width)) = last_resort {
                            return end(cut, width, false);
                        }
                    }
                    if advance > 0.0 || is_atomic {
                        hanging = autospace;
                    }
                }
                x += advance;
                has_content |= item.kind != ItemKind::Control;
                if is_ordinary && overhang == 0.0 && cluster.flags & CLUSTER_SOFT_HYPHEN == 0 {
                    let last = (item.clusters.end - u32::from(breaks_words)).max(next);
                    let (rest, limit, mut flags) = (
                        next as usize..last as usize,
                        available + TOLERANCE,
                        cluster.flags,
                    );
                    let mut bound = if opportunity.is_none()
                        && last_resort.is_none()
                        && !(breaks_words && item_wraps)
                    {
                        f32::INFINITY
                    } else {
                        limit
                    };
                    for (cluster, advance) in inline.clusters[rest.clone()]
                        .iter()
                        .zip(&mut self.advances[rest])
                    {
                        match cluster.flags {
                            _ if cluster.advance <= 0.0 => break,
                            CLUSTER_SPACE if item_wraps || !keeps_spaces => {
                                hanging += cluster.advance
                            }
                            CLUSTER_BREAK_BEFORE if item_wraps => {
                                let cut = Cut {
                                    item: index,
                                    cluster: next,
                                };
                                if x + cluster.advance > limit {
                                    return end(cut, x - hanging, false);
                                }
                                (opportunity, hanging, bound) =
                                    (Some((cut, x - hanging, false)), 0.0, limit);
                            }
                            0 | CLUSTER_SPACE | CLUSTER_BREAK_BEFORE
                                if x + cluster.advance <= bound =>
                            {
                                hanging = 0.0
                            }
                            _ => break,
                        }
                        (*advance, flags) = (cluster.advance, cluster.flags);
                        x += cluster.advance;
                        next += 1;
                    }
                    previous = Some((item, flags));
                }
            }
            if !item.clusters.is_empty() {
                (opens, broke_words) = (None, breaks_words);
                common_wraps = wraps(source.style_of(item.parent));
            }
        }
        let cluster = inline.clusters.len() as u32;
        Broken {
            start,
            end_item: items.len(),
            next: Cut {
                item: items.len(),
                cluster,
            },
            width: if x <= available + TOLERANCE {
                x
            } else {
                (x - hanging).max(available.min(x))
            },
            is_forced: true,
            has_hyphen: false,
        }
    }

    /// For `text-wrap: pretty` and `balance`: from which cluster on the lines of a paragraph get which widths.
    fn improve(
        sources: Sources<'a>,
        hyphen: &'a dyn Fn(&Style) -> f32,
        advances: &mut [f32],
        indents: Indents,
        available: f32,
    ) -> Vec<(u32, Vec<f32>)> {
        let root = sources[1].root;
        let is_balanced = root.text.wrap_style == TextWrapStyle::Balance;
        let (mut all, mut improved) = (Vec::new(), Vec::new());
        let mut breaker = Breaker {
            sources,
            offset: 0.0,
            advances,
            is_min_content: false,
            hyphen,
            candidates: None,
        };
        breaker.visit_lines(indents, available, |line| {
            all.push((line.start, line.width, line.is_forced, line.has_hyphen))
        });
        let advances = breaker.advances;
        for paragraph in all.split_inclusive(|it| it.2) {
            let lines =
                &paragraph[paragraph
                    .len()
                    .saturating_sub(if is_balanced { 6 } else { 4 })..];
            let [(start, ..), .., last] = lines else {
                continue;
            };
            if lines.iter().any(|it| it.1 > available + TOLERANCE)
                || is_balanced && lines.len() < paragraph.len()
            {
                continue;
            }
            let mut collect = |from: Cut, indent: f32| {
                let mut candidates = vec![Candidate {
                    start: 0.0,
                    end: 0.0,
                    has_hyphen: false,
                }];
                let mut breaker = Breaker {
                    sources,
                    offset: 0.0,
                    advances: &mut *advances,
                    is_min_content: false,
                    hyphen,
                    candidates: Some(&mut candidates),
                };
                let end = breaker
                    .next_line(from, indent, f32::INFINITY, &mut |_, _| None)
                    .width;
                candidates.push(Candidate {
                    start: end,
                    end,
                    has_hyphen: false,
                });
                candidates
            };
            let has_hyphens = matches!(lines, [.., a, b, _] if a.3 && b.3);
            if is_balanced
                || has_hyphens
                || last.1 < available / 3.0 && collect(last.0, 0.0).len() == 2
            {
                let candidates = collect(*start, indents[usize::from(!start.is_start())]);
                let best = if candidates.len() >= 4 {
                    best_widths(&candidates, available, root, is_balanced)
                } else {
                    Vec::new()
                };
                if best.len() == lines.len() {
                    improved.push((start.cluster, best));
                }
            }
        }
        improved
    }

    fn visit_lines(&mut self, indents: Indents, available: f32, mut visit: impl FnMut(&Broken)) {
        let (mut at, mut indent) = (Cut::default(), indents[0]);
        while at.item < self.sources[1].inline.items.len() {
            let line = self.next_line(at, indent, available, &mut |_, _| None);
            visit(&line);
            (at, indent) = (line.next, indents[2 - usize::from(line.is_forced)]);
        }
    }
}

fn expands_in_base(inline: &Inline, at: u32) -> bool {
    let is_last =
        |it: &Item| matches!(it.kind, ItemKind::Annotation(..)) && it.clusters.start == at + 1;
    !inline.items.iter().any(is_last) && expands_after(inline, TextJustify::Auto, at)
}

/// What `ruby-align` puts before and after the text, and at each of the `count` opportunities in it.
fn align_ruby(align: RubyAlign, free: f32, count: usize, most: f32) -> [f32; 3] {
    match align {
        RubyAlign::Start => [0.0, free, 0.0],
        RubyAlign::SpaceAround if count > 0 => {
            let inset = (free / (count + 1) as f32).min(most);
            [inset / 2.0, inset / 2.0, (free - inset) / count as f32]
        }
        RubyAlign::SpaceBetween if count > 0 => [0.0, 0.0, free / count as f32],
        _ => [free / 2.0, free / 2.0, 0.0],
    }
}

/// Makes room for annotations that are wider than their bases, and leaves the width of each column in `columns`.
fn widen_bases(
    inline: &Inline,
    root: &Style,
    widths: &mut ItemWidths,
    columns: &mut Vec<(usize, f32)>,
) {
    let (items, mut advances) = (
        &inline.items,
        inline
            .clusters
            .iter()
            .map(|it| it.advance)
            .collect::<Vec<_>>(),
    );
    widths.resize(items.len() * 2, 0.0);
    let (mut x, mut start, mut pending) = (0.0, 0.0, 0.0);
    for (index, item) in items.iter().enumerate() {
        let ItemKind::Annotation(_, base) = item.kind else {
            if item.kind == ItemKind::RubyBase {
                start = x;
            }
            if item.kind != ItemKind::Text {
                x += widths[index];
            }
            for at in item.clusters.clone() {
                match inline.character(at) {
                    '\t' => advances[at as usize] = tab_advance(&item.style, root, x),
                    '\n' => x = 0.0,
                    it if !is_blank(it) => x -= core::mem::take(&mut pending),
                    _ => {}
                }
                if inline.clusters[at as usize].flags & OPENING != 0 {
                    advances[at as usize] -= inline.trimmed_start(at, &item.style, false);
                }
                x += advances[at as usize];
            }
            continue;
        };
        let (first, annotation) = (base as usize, core::mem::take(&mut widths[index]));
        let texts = || (first..index).filter(|it| items[*it].kind == ItemKind::Text);
        let advance = |at: u32, extra: f32| {
            advances[at as usize]
                + if extra != 0.0 && expands_in_base(inline, at) {
                    extra
                } else {
                    0.0
                }
        };
        let in_texts: f32 = texts()
            .flat_map(|it| items[it].clusters.clone().map(move |at| (at, it)))
            .map(|(at, it)| advance(at, widths[it]))
            .sum();
        let others: f32 = (first + 1..index)
            .filter(|it| items[*it].kind != ItemKind::Text)
            .map(|it| widths[it])
            .sum();
        let (ruby, free) = (&items[first].style, annotation - in_texts - others);
        columns.push((index, annotation.max(in_texts + others)));
        if free <= 0.0 {
            continue;
        }
        let count = texts()
            .flat_map(|it| items[it].clusters.clone())
            .filter(|at| expands_in_base(inline, *at))
            .count();
        let [before, after, each] = align_ruby(ruby.text.ruby_align, free, count, f32::INFINITY);
        texts().for_each(|it| widths[it] += each);
        let room = |beside: &mut dyn Iterator<Item = &Item>, mut end: Option<f32>| {
            let is_empty = |it: &&Item| {
                matches!(
                    it.kind,
                    ItemKind::Open(_) | ItemKind::Close(_) | ItemKind::RubyBase
                ) || it.kind == ItemKind::Text && it.clusters.is_empty()
            };
            let mut texts = beside
                .filter(|it| !is_empty(it))
                .take_while(|it| it.kind == ItemKind::Text);
            if ruby.text.ruby_overhang == RubyOverhang::Auto {
                let next = texts
                    .next()
                    .filter(|it| it.style.font.size.0 <= ruby.font.size.0);
                return next
                    .map_or(0.0, |it| {
                        it.clusters
                            .clone()
                            .map(|at| advances[at as usize])
                            .sum::<f32>()
                    })
                    .min(item.style.font.size.0 / 2.0);
            }
            let mut room = 0.0;
            for text in texts {
                for step in 0..text.clusters.len() as u32 {
                    let at = if end.is_some() {
                        text.clusters.start + step
                    } else {
                        text.clusters.end - 1 - step
                    };
                    let (character, mut advance) = (inline.character(at), advances[at as usize]);
                    if !is_blank(character) {
                        let flags = inline.clusters[at as usize].flags;
                        let is_full = advance >= text.style.font.size.0 * 0.9
                            && flags & (OPENING | TRIMS) != OPENING | TRIMS;
                        return room
                            + advance
                                * match inline.spacing_of(at, &text.style).0 {
                                    Punctuation::Middle => 0.25,
                                    it if is_full
                                        && it
                                            == if end.is_some() {
                                                Punctuation::Opening
                                            } else {
                                                Punctuation::Closing
                                            } =>
                                    {
                                        0.5
                                    }
                                    _ => 0.0,
                                };
                    }
                    if let Some(end) = &mut end {
                        advance = if character == '\t' {
                            tab_advance(&text.style, root, *end)
                        } else {
                            advance
                        };
                        *end += advance;
                    }
                    room += advance;
                }
            }
            if end.is_some() { 0.0 } else { room }
        };
        let back = before.min(room(&mut items[..first].iter().rev(), None));
        x = start - back + annotation;
        pending = after.min(room(&mut items[index + 1..].iter(), Some(x)));
        (widths[first], widths[index], widths[items.len() + index]) =
            (before - back, after - pending, pending);
    }
}

/// Above and below the baseline, adding up to the font size before they are rounded.
pub(crate) fn em_box(metrics: &crate::abi::FontMetrics, size: f32) -> [f32; 2] {
    [metrics.ascent, metrics.descent].map(|it| {
        (it * size / (metrics.ascent + metrics.descent).max(1.0) - 0.01)
            .ceil()
            .min(it)
    })
}

fn margin(value: &Auto<Lp>, basis: f32) -> f32 {
    value.0.as_ref().map_or(0.0, |it| resolve(it, basis))
}

/// The margin, and the border with the padding.
pub(crate) fn edge(style: &Style, is_left: bool, basis: f32) -> (f32, f32) {
    let l = &style.layout;
    let (outside, border, border_style, inside) = match is_left {
        true => (
            &l.margin_left,
            l.border_left,
            l.border_left_style,
            &l.padding_left,
        ),
        false => (
            &l.margin_right,
            l.border_right,
            l.border_right_style,
            &l.padding_right,
        ),
    };
    (
        margin(outside, basis),
        if border_style.is_none() {
            0.0
        } else {
            border.0
        } + resolve(&inside.0, basis),
    )
}

#[inline(always)]
pub(crate) fn relative_offset(style: &Style, width: f32, height: Option<f32>) -> [f32; 2] {
    if style.layout.position == PositionKind::Relative {
        resolve_offset(style, width, height)
    } else {
        [0.0; 2]
    }
}

fn resolve_offset(style: &Style, width: f32, height: Option<f32>) -> [f32; 2] {
    let resolve = |inset: &Inset, basis: Option<f32>| match inset {
        Inset::Length(length) => resolve_if_definite(length, basis),
        _ => None,
    };
    let l = &style.layout;
    let (left, right) = (
        resolve(&l.left, Some(width)),
        resolve(&l.right, Some(width)).map(|it| -it),
    );
    let x = if style.is_rtl() {
        right.or(left)
    } else {
        left.or(right)
    };
    let y = resolve(&l.top, height).or_else(|| resolve(&l.bottom, height).map(|it| -it));
    [x.unwrap_or(0.0), y.unwrap_or(0.0)]
}

struct Piece {
    item: usize,
    clusters: Range<u32>,
    width: f32,
    level: u8,
    is_hyphen: bool,
}

/// An inline box on the line. The first one is the root.
struct InlineBox {
    /// As in `Item::parent`.
    key: u32,
    /// The box that `shift` is relative to: the root, or one that is aligned to the top or the bottom of the line.
    origin: usize,
    shift: f32,
    /// Above and below the baseline of an origin.
    extent: [f32; 2],
    offset: [f32; 2],
    range: [f32; 2],
    edges: [bool; 2],
    layer: NodeId,
}

fn reorder(pieces: &mut [Piece]) {
    let highest = pieces.iter().map(|it| it.level).max().unwrap_or(0);
    let lowest_odd = pieces.iter().map(|it| it.level | 1).min().unwrap_or(1);
    for level in (lowest_odd..=highest).rev() {
        pieces
            .split_mut(|it| it.level < level)
            .for_each(<[Piece]>::reverse);
    }
}

/// How far below the baseline of its parent a box has its own.
fn baseline_shift(style: &Style, parent: &Style, [above, below]: [f32; 2], scale: f32) -> f32 {
    match &style.layout.vertical_align {
        VerticalAlign::Length(length) => -length.resolve(style.line_height()),
        VerticalAlign::Keyword(keyword) => match keyword {
            VerticalAlignName::Sub => parent.font.size.0 / 5.0 + 1.0 / scale,
            VerticalAlignName::Super => -(parent.font.size.0 / 3.0 + 1.0 / scale),
            VerticalAlignName::TextTop => above - parent.metrics.ascent,
            VerticalAlignName::TextBottom => parent.metrics.descent - below,
            VerticalAlignName::Middle if parent.has_central_baseline() => (above - below) / 2.0,
            VerticalAlignName::Middle => (above - below - parent.metrics.x_height) / 2.0,
            _ => 0.0,
        },
    }
}

/// Above and below the baseline, as `text-box-edge` has it.
fn text_edges(document: &Document, style: &Style) -> [f32; 2] {
    let (metrics, TextBoxEdge(over, is_alphabetic)) = (&style.metrics, style.text.box_edge);
    let raised = document
        .fonts
        .metrics(style.font_id, style.font.size.0)
        .ascent
        - metrics.ascent;
    let above = match over {
        OverEdge::Cap => metrics.cap_height - raised,
        OverEdge::Ex => metrics.x_height - raised,
        _ => metrics.ascent,
    };
    [
        above,
        if is_alphabetic {
            raised
        } else {
            metrics.descent
        },
    ]
}

/// What `text-box-trim` takes from the start or the end of the line.
pub(crate) fn trimmed(
    document: &Document,
    root: &Style,
    side: usize,
    flips: bool,
    line: &Line,
) -> f32 {
    let side = side ^ usize::from(flips);
    [line.baseline - line.y, line.y + line.height - line.baseline][side]
        - text_edges(document, root)[side]
}

impl TextBoxTrim {
    pub(crate) fn sides(self) -> [bool; 2] {
        [
            matches!(self, TextBoxTrim::TrimStart | TextBoxTrim::TrimBoth),
            matches!(self, TextBoxTrim::TrimEnd | TextBoxTrim::TrimBoth),
        ]
    }
}

fn line_relative(style: &Style) -> Option<VerticalAlignName> {
    match style.layout.vertical_align {
        VerticalAlign::Keyword(it @ (VerticalAlignName::Top | VerticalAlignName::Bottom)) => {
            Some(it)
        }
        _ => None,
    }
}

struct Placement<'a> {
    document: &'a Document,
    inline: &'a Inline,
    root: &'a Style,
    widths: &'a [f32],
    embedded: &'a [Embedded],
    /// The room below the text of the line before that annotations may take. Negative if they stick out of it.
    room_for_annotations: f32,
    trim: [bool; 2],
    flips: bool,
    /// An inline box without text and without edges has no height.
    has_quirks: bool,
    is_list_item: bool,
    is_annotation: bool,
    size: (f32, Option<f32>),
    lines: Lines,
    /// The item, the static position, and the edges that are there.
    out_of_flow: Vec<(usize, [f32; 2], [Edge; 2])>,
}

impl<'a> Placement<'a> {
    fn with_leading(&self, ascent: f32, descent: f32, line_height: f32) -> [f32; 2] {
        self.document.with_leading(ascent, descent, line_height)
    }

    fn strut(&self, style: &Style) -> [f32; 2] {
        self.document.strut(style)
    }

    fn style_of(&self, key: u32) -> &'a Style {
        match key {
            0 => self.root,
            key => &self.inline.items[key as usize - 1].style,
        }
    }

    fn pieces(&mut self, line: &Broken, base_level: u8) -> SmallVec<[Piece; 4]> {
        let (inline, mut pieces) = (self.inline, SmallVec::<[Piece; 4]>::new());
        let items = inline.items[..line.end_item]
            .iter()
            .enumerate()
            .skip(line.start.item);
        let is_blank = |at: &u32| {
            inline.clusters[*at as usize].flags & CLUSTER_SPACE != 0 || inline.is_newline(*at)
        };
        let trailing = (line.start.cluster..line.next.cluster)
            .rfind(|it| !is_blank(it))
            .map_or(line.start.cluster, |it| it + 1);
        if trailing > line.start.cluster && trailing == line.next.cluster {
            self.lines.advances[trailing as usize - 1] -= inline.autospace_after(trailing - 1);
        }
        for (index, item) in items.clone().rev() {
            let range = item.clusters.start.max(line.start.cluster)
                ..item.clusters.end.min(line.next.cluster);
            let is_space = |at: &u32| {
                inline.clusters[*at as usize].flags & (CLUSTER_SPACE | IDEOGRAPHIC_SPACE)
                    == CLUSTER_SPACE
            };
            let spaces = range.clone().rev().take_while(is_space).count();
            if !inline.items[index].style.text.collapse.preserves_spaces() {
                range
                    .clone()
                    .rev()
                    .take(spaces)
                    .for_each(|at| self.lines.advances[at as usize] = 0.0);
            }
            if spaces < range.len() && item.kind != ItemKind::Control {
                break;
            }
        }
        for (index, item) in items {
            let range = item.clusters.start.max(line.start.cluster)
                ..item.clusters.end.min(line.next.cluster);
            let mut push = |clusters, width, level| {
                let is_hyphen = false;
                pieces.push(Piece {
                    item: index,
                    clusters,
                    width,
                    level,
                    is_hyphen,
                });
            };
            match item.kind {
                ItemKind::Control
                    if inline.has_bidi
                        && range
                            .clone()
                            .any(|it| matches!(inline.character(it), '\u{2066}'..='\u{2069}')) =>
                {
                    push(
                        0..0,
                        0.0,
                        range
                            .map(|it| inline.clusters[it as usize].bidi_level)
                            .min()
                            .unwrap_or(base_level),
                    );
                }
                ItemKind::Control | ItemKind::Float(_) => {}
                ItemKind::Open(_)
                | ItemKind::Close(_)
                | ItemKind::RubyBase
                | ItemKind::Annotation(..) => push(0..0, self.widths[index], u8::MAX),
                ItemKind::OutOfFlow(_) => push(0..0, 0.0, u8::MAX),
                _ => {
                    let mut start = range.start;
                    while start < range.end {
                        let first = &inline.clusters[start as usize];
                        let same = inline.clusters[start as usize..range.end as usize].iter();
                        let same = same.take_while(|it| {
                            (it.face, it.bidi_level, it.flags & (UPRIGHT | COMBINED))
                                == (
                                    first.face,
                                    first.bidi_level,
                                    first.flags & (UPRIGHT | COMBINED),
                                )
                        });
                        let mut end = if item.is_uniform {
                            range.end
                        } else {
                            start + same.count() as u32
                        };
                        let trailing = if item.style.text.collapse.preserves_spaces() {
                            trailing
                        } else {
                            u32::MAX
                        };
                        if first.bidi_level != base_level && start < trailing {
                            end = end.min(trailing);
                        }
                        let width = self.lines.advances[start as usize..end as usize]
                            .iter()
                            .sum();
                        push(
                            start..end,
                            width,
                            if start < trailing {
                                first.bidi_level
                            } else {
                                base_level
                            },
                        );
                        start = end;
                    }
                }
            }
        }
        if line.has_hyphen
            && let Some(last) = pieces.iter().rposition(|it| !it.clusters.is_empty())
        {
            let (item, level) = (pieces[last].item, pieces[last].level);
            let width = self.document.hyphen(&inline.items[item].style).1;
            pieces.insert(
                last + 1,
                Piece {
                    item,
                    clusters: 0..0,
                    width,
                    level,
                    is_hyphen: true,
                },
            );
        }
        if !inline.has_bidi && base_level == 0 {
            pieces.iter_mut().for_each(|it| it.level = 0);
        } else {
            let mut next = base_level;
            for piece in pieces.iter_mut().rev() {
                match inline.items[piece.item].kind {
                    ItemKind::Close(_) | ItemKind::Annotation(..) | ItemKind::Control => {}
                    _ if piece.level == u8::MAX => piece.level = next,
                    _ => next = piece.level,
                }
            }
            let mut previous = base_level;
            for piece in &mut pieces {
                if piece.level == u8::MAX {
                    piece.level = previous;
                }
                previous = piece.level;
            }
            reorder(&mut pieces);
            pieces.retain(|it| it.is_hyphen || inline.items[it.item].kind != ItemKind::Control);
            move_edges_outside(inline, &mut pieces);
        }
        pieces
    }

    fn inline_box(&self, boxes: &mut SmallVec<[InlineBox; 4]>, key: u32) -> usize {
        if let Some(found) = boxes.iter().rposition(|it| it.key == key) {
            return found;
        }
        let item = &self.inline.items[key as usize - 1];
        let parent = self.inline_box(boxes, item.parent);
        let extent = self.strut(&item.style);
        let (origin, shift) = match line_relative(&item.style) {
            Some(_) => (boxes.len(), 0.0),
            None => (
                boxes[parent].origin,
                boxes[parent].shift
                    + baseline_shift(
                        &item.style,
                        self.style_of(item.parent),
                        extent,
                        self.document.environment.scale,
                    ),
            ),
        };
        let own = relative_offset(&item.style, self.size.0, self.size.1);
        let is_layer = crate::inline::is_layer(&item.style);
        boxes.push(InlineBox {
            key,
            origin,
            shift,
            extent: [f32::MIN; 2],
            offset: [0, 1].map(|axis| boxes[parent].offset[axis] + own[axis]),
            range: [f32::MAX, f32::MIN],
            edges: [false; 2],
            layer: if is_layer {
                item.node
            } else {
                boxes[parent].layer
            },
        });
        if !self.has_quirks {
            let grown = &mut boxes[origin].extent;
            *grown = [
                grown[0].max(extent[0] - shift),
                grown[1].max(extent[1] + shift),
            ];
        }
        boxes.len() - 1
    }

    /// `place` for a line that has a single piece of text.
    fn place_words(
        &mut self,
        line: &Broken,
        item: &Item,
        [x, y]: [f32; 2],
        [left, right]: [f32; 2],
        indent: f32,
    ) -> f32 {
        let (inline, clusters) = (self.inline, line.start.cluster..line.next.cluster);
        let range = clusters.start as usize..clusters.end as usize;
        let (all, advances) = (
            &inline.clusters[range.clone()],
            &mut self.lines.advances[range],
        );
        let spaces = all
            .iter()
            .rev()
            .take_while(|it| it.flags & (CLUSTER_SPACE | IDEOGRAPHIC_SPACE) == CLUSTER_SPACE)
            .count();
        advances[all.len() - spaces..].fill(0.0);
        advances[all.len() - 1] -= inline.autospace_after(clusters.end - 1);
        let width = advances.iter().sum();
        let [mut above, mut below] = self.strut(self.root);
        if item.style.font.line_height == LineHeight::Normal
            && let Some(face) = inline
                .paragraph_of(clusters.start)
                .shaped
                .faces
                .get(usize::from(all[0].face))
        {
            let extent = self.with_leading(
                face.ascent,
                face.descent,
                face.ascent + face.descent + face.line_gap,
            );
            (above, below) = (above.max(extent[0]), below.max(extent[1]));
        }
        let (first, baseline, metrics) = (
            self.lines.fragments.len() as u32,
            y + above,
            &item.style.metrics,
        );
        self.lines.fragments.push(Fragment {
            kind: FragmentKind::Text {
                clusters: clusters.clone(),
                rtl: false,
                hidden: 0,
            },
            item: line.start.item as u32,
            x,
            y: baseline - metrics.ascent,
            width,
            height: metrics.ascent + metrics.descent,
            baseline,
            layer: 0,
        });
        let (height, end) = (above + below, x - indent + line.width);
        self.lines.lines.push(Line {
            y,
            height,
            baseline,
            left,
            right,
            rtl: false,
            has_content: true,
            end,
            clusters,
            fragments: first..first + 1,
            overflow: None,
            clamp: None,
        });
        y + height - self.room_for_annotations.min(0.0)
    }

    /// Returns where the line ends.
    fn place(&mut self, line: &Broken, mut y: f32, [left, right]: [f32; 2], indent: f32) -> f32 {
        let (inline, root) = (self.inline, self.root);
        let base_level = match inline.clusters.paragraphs.is_empty() {
            true => u8::from(root.is_rtl()),
            false => inline.paragraph_of(line.start.cluster).shaped.base_level,
        };
        let rtl = base_level == 1;
        let free = right - left - line.width;
        let (align, mut before) = alignment(root, line.is_forced, rtl, free);
        if let [
            item @ Item {
                kind: ItemKind::Text,
                parent: 0,
                is_uniform: true,
                ..
            },
        ] = &inline.items[line.start.item..line.end_item]
            && !(rtl
                || inline.has_bidi
                || line.has_hyphen
                || self.has_quirks
                || self.trim[0]
                || self.document.boxes.has_annotations)
            && align != TextAlign::Justify
            && item.style.text.collapse == WhiteSpaceCollapse::Collapse
            && !item.style.has_central_baseline()
            && inline.clusters[line.start.cluster as usize..line.next.cluster as usize]
                .first()
                .is_some_and(|it| it.advance > 0.0 && it.flags & CLUSTER_SPACE == 0)
        {
            return self.place_words(
                line,
                item,
                [left + before + indent, y],
                [left, right],
                indent,
            );
        }
        let mut pieces = self.pieces(line, base_level);
        let mut is_justified = false;
        let is_annotation = self.is_annotation;
        if (align == TextAlign::Justify || is_annotation) && free > 0.0 {
            let advances = &mut self.lines.advances;
            let justify = |piece: &Piece| match inline.items[piece.item].kind {
                _ if is_annotation => TextJustify::Auto,
                ItemKind::Text => inline.items[piece.item].style.text.justify,
                _ => root.text.justify,
            };
            let last = (line.start.cluster..line.next.cluster)
                .rfind(|at| !is_space(inline, *at) && !inline.is_newline(*at));
            let expands = |at: u32, justify, advances: &[f32]| {
                Some(at) < last && advances[at as usize] > 0.0 && expands_after(inline, justify, at)
            };
            let count: usize = pieces
                .iter()
                .map(|it| {
                    it.clusters
                        .clone()
                        .filter(|at| expands(*at, justify(it), advances))
                        .count()
                })
                .sum();
            let mut each = free / count as f32;
            if is_annotation {
                [before, _, each] =
                    align_ruby(root.text.ruby_align, free, count, root.font.size.0 * 2.0);
            } else if count > 0 {
                (before, is_justified) = (0.0, true);
            }
            for piece in &mut pieces {
                let justify = justify(piece);
                for at in piece.clusters.clone() {
                    if expands(at, justify, advances) {
                        advances[at as usize] += each;
                        piece.width += each;
                    }
                }
            }
        }
        let mut x = left + before + if rtl { 0.0 } else { indent };
        let used = if is_justified {
            right - left
        } else {
            line.width
        };
        let end = if rtl { x } else { x - indent + used };
        if rtl {
            x -= pieces.iter().map(|it| it.width).sum::<f32>() + indent - used;
        }

        let mut boxes = smallvec![InlineBox {
            key: 0,
            origin: 0,
            shift: 0.0,
            extent: if self.has_quirks && !self.is_list_item && !inline.force_line {
                [f32::MIN; 2]
            } else {
                self.strut(root)
            },
            offset: [0.0; 2],
            range: [0.0; 2],
            edges: [false; 2],
            layer: 0,
        }];
        let (mut content, mut has_content) = (SmallVec::<[_; 4]>::new(), inline.force_line);
        let (first_out_of_flow, mut first_after_content) = (self.out_of_flow.len(), usize::MAX);
        for piece in &pieces {
            let item = &inline.items[piece.item];
            let key = match item.kind {
                ItemKind::Open(_) => piece.item as u32 + 1,
                _ => item.parent,
            };
            let owner = self.inline_box(&mut boxes, key);
            let (mut origin, mut shift) = (boxes[owner].origin, boxes[owner].shift);
            let mut own_range = [x, x + piece.width];
            let mut extent = None;
            if self.has_quirks {
                let strut = match item.kind {
                    ItemKind::Break
                        if content
                            .iter()
                            .all(|it: &(&Piece, _, _, _, _)| it.0.width == 0.0) =>
                    {
                        Some(&*item.style)
                    }
                    ItemKind::Text
                        if piece.width > 0.0 || item.style.text.collapse.preserves_spaces() =>
                    {
                        Some(self.style_of(key))
                    }
                    ItemKind::Open(_) | ItemKind::Close(_) if piece.width != 0.0 => {
                        Some(&*item.style)
                    }
                    _ => None,
                };
                if let Some([above, below]) = strut.map(|it| self.strut(it)) {
                    let grown = &mut boxes[origin].extent;
                    *grown = [grown[0].max(above - shift), grown[1].max(below + shift)];
                }
            }
            match item.kind {
                ItemKind::Open(has_edge) | ItemKind::Close(has_edge) => {
                    let is_left = matches!(item.kind, ItemKind::Open(_)) == (piece.level % 2 == 0);
                    let side = usize::from(!is_left);
                    boxes[owner].edges[side] |= has_edge;
                    if has_edge {
                        let is_start = matches!(item.kind, ItemKind::Open(_));
                        let margin =
                            edge(&item.style, is_start != item.style.is_rtl(), self.size.0).0;
                        own_range[side] += if is_left { margin } else { -margin };
                    }
                    has_content |= piece.width != 0.0
                        || has_edge && edge(&item.style, is_left, self.size.0).1 != 0.0;
                }
                ItemKind::RubyBase | ItemKind::Annotation(..) => {}
                ItemKind::OutOfFlow(_) => {
                    let (is_inline, offset) = (item.style.was_inline, boxes[owner].offset);
                    let x = offset[0] + x;
                    if has_content {
                        first_after_content = first_after_content.min(self.out_of_flow.len());
                    }
                    let is_rtl = if is_inline { piece.level % 2 == 1 } else { rtl };
                    let edges = [item.style.layout.justify_self, item.style.layout.align_self];
                    let edges = [0, 1].map(|axis| {
                        Edge::from(
                            edges[axis].resolved(
                                axis,
                                is_rtl,
                                axis == 0 && item.style.is_rtl(),
                                0.0,
                            ),
                            axis == 0 && is_rtl,
                        )
                    });
                    let x = if is_inline {
                        x
                    } else {
                        offset[0] + edges[0].of([0.0, self.size.0])
                    };
                    self.out_of_flow.push((
                        piece.item,
                        [x, y + if self.flips { -offset[1] } else { offset[1] }],
                        edges,
                    ));
                }
                ItemKind::Atomic(_) => {
                    let own = self.embedded[piece.item].extent();
                    if line_relative(&item.style).is_some() {
                        (origin, shift) = (boxes.len(), 0.0);
                        boxes.push(InlineBox {
                            key: piece.item as u32 + 1,
                            origin,
                            shift,
                            extent: own,
                            ..boxes[owner]
                        });
                    } else {
                        shift += baseline_shift(
                            &item.style,
                            self.style_of(item.parent),
                            own,
                            self.document.environment.scale,
                        );
                    }
                    extent = Some(own);
                    has_content = true;
                }
                _ => {
                    has_content |= piece.width > 0.0
                        || item.style.text.collapse.preserves_spaces()
                        || piece
                            .clusters
                            .clone()
                            .any(|at| inline.clusters[at as usize].flags & CLUSTER_SPACE == 0);
                    if item.style.font.line_height == LineHeight::Normal
                        && !piece.is_hyphen
                        && (!self.has_quirks || piece.width > 0.0)
                    {
                        let cluster = &inline.clusters[piece.clusters.start as usize];
                        let faces = &inline.paragraph_of(piece.clusters.start).shaped.faces;
                        extent = faces.get(usize::from(cluster.face)).map(|face| {
                            let [ascent, descent] = match item.style.has_central_baseline() {
                                true => crate::writing::centered(face.ascent, face.descent),
                                false => [face.ascent, face.descent],
                            };
                            self.with_leading(ascent, descent, ascent + descent + face.line_gap)
                        });
                    }
                }
            }
            if let Some(extent) = extent {
                let grown = &mut boxes[origin].extent;
                *grown = [
                    grown[0].max(extent[0] - shift),
                    grown[1].max(extent[1] + shift),
                ];
            }
            let (mut at, mut range) = (key, own_range);
            while at != 0 {
                let index = self.inline_box(&mut boxes, at);
                let grown = &mut boxes[index].range;
                *grown = [grown[0].min(range[0]), grown[1].max(range[1])];
                (at, range) = (inline.items[at as usize - 1].parent, [x, x + piece.width]);
            }
            content.push((piece, x, owner, origin, shift));
            x += piece.width;
        }

        for it in boxes
            .iter_mut()
            .filter(|it| self.has_quirks && it.extent[0] == f32::MIN)
        {
            it.extent = [0.0; 2];
        }
        let [mut above, mut below] = boxes[0].extent;
        let aligned = |index: usize| {
            line_relative(&inline.items[(boxes[index].key as usize).checked_sub(1)?].style)
        };
        let origins = || (1..boxes.len()).filter(|index| boxes[*index].origin == *index);
        for index in origins() {
            let missing =
                (boxes[index].extent[0] + boxes[index].extent[1] - above - below).max(0.0);
            match aligned(index) {
                Some(VerticalAlignName::Top) => below += missing,
                _ => above += missing,
            }
        }
        let height = if has_content { above + below } else { 0.0 };
        let is_trimmed = has_content && core::mem::take(&mut self.trim[0]);
        if is_trimmed {
            y -= [above, below][usize::from(self.flips)]
                - text_edges(self.document, root)[usize::from(self.flips)];
        }
        let mut annotations = Vec::new();
        if self.document.boxes.has_annotations && has_content {
            let mut extents: Vec<(usize, [f32; 2])> = Vec::new();
            for (piece, _, _, origin, shift) in content
                .iter()
                .filter(|it| it.3 == 0 || aligned(it.3).is_none())
            {
                let (item, embedded) = (
                    &inline.items[piece.item],
                    self.embedded.get(piece.item).copied().unwrap_or_default(),
                );
                let [up, down] = match item.kind {
                    ItemKind::Text => em_box(&item.style.metrics, item.style.font.size.0),
                    ItemKind::Atomic(_) => embedded.extent(),
                    _ => continue,
                };
                extents.extend((*origin == 0).then_some((piece.item, [up - shift, down + shift])));
            }
            let widest = |all: &mut dyn Iterator<Item = [f32; 2]>| {
                all.reduce(|a, b| [a[0].max(b[0]), a[1].max(b[1])])
                    .unwrap_or_default()
            };
            let text = widest(&mut extents.iter().map(|it| it.1));
            for index in line.start.item..line.end_item {
                let ItemKind::Annotation(_, base) = inline.items[index].kind else {
                    continue;
                };
                let around = widest(
                    &mut extents
                        .iter()
                        .filter(|it| (base as usize..index).contains(&it.0))
                        .map(|it| it.1),
                );
                let [up, down] = em_box(
                    &inline.items[index].style.metrics,
                    inline.items[index].style.font.size.0,
                );
                let baseline = match inline.items[base as usize].style.text.ruby_position {
                    RubyPosition::Over => -around[0] - down,
                    RubyPosition::Under => around[1] + up,
                };
                extents.push((index, [up - baseline, down + baseline]));
                annotations.push((index, baseline));
            }
            for (index, extent) in &mut extents {
                let item = &inline.items[*index];
                if let Some((_, is_under)) = self
                    .document
                    .emphasis_mark(&item.style)
                    .filter(|_| item.kind == ItemKind::Text)
                {
                    extent[usize::from(is_under)] += item.style.font.size.0 / 2.0;
                }
            }
            let all = widest(&mut extents.iter().map(|it| it.1));
            let sticks_out = |side: usize| {
                if all[side] > text[side] {
                    all[side] - [above, below][side]
                } else {
                    (all[side] - [above, below][side]).min(0.0)
                }
            };
            let (start, end) = (
                sticks_out(usize::from(self.flips)),
                sticks_out(usize::from(!self.flips)),
            );
            y += match (start > 0.0, self.room_for_annotations) {
                _ if is_trimmed => 0.0,
                (true, room) => (start - room.max(0.0)).max(0.0),
                (false, room) => start.max(room.min(0.0)),
            };
            self.room_for_annotations = -end;
        }
        let baseline_of = |origin: usize| match (origin, aligned(origin)) {
            (0, _) => y + above,
            (_, Some(VerticalAlignName::Top)) => y + boxes[origin].extent[0],
            _ => y + above + below - boxes[origin].extent[1],
        };

        let first = self.lines.fragments.len() as u32;
        let mut order: SmallVec<[_; 4]> = boxes[1..].iter().collect();
        order.order_by_key(|it| it.key);
        for it in order {
            let item = &inline.items[it.key as usize - 1];
            if !matches!(item.kind, ItemKind::Open(_)) {
                continue;
            }
            let (l, metrics) = (&item.style.layout, &item.style.metrics);
            let baseline = baseline_of(it.origin) + it.shift + it.offset[1];
            let mut text = [metrics.ascent, metrics.descent];
            if item.style.rare.box_trim != TextBoxTrim::None {
                let (sides, edges) = (
                    item.style.rare.box_trim.sides(),
                    text_edges(self.document, &item.style),
                );
                text = [0, 1].map(|side| {
                    if sides[side ^ usize::from(self.flips)] {
                        edges[side]
                    } else {
                        text[side]
                    }
                });
            }
            let above = text[0] + item.style.border()[0] + l.padding_top.0.resolve(self.size.0);
            let below = text[1] + item.style.border()[2] + l.padding_bottom.0.resolve(self.size.0);
            self.lines.fragments.push(Fragment {
                kind: FragmentKind::Box(it.edges[0], it.edges[1]),
                item: it.key - 1,
                x: it.range[0] + it.offset[0],
                y: baseline - above,
                width: (it.range[1] - it.range[0]).max(0.0),
                height: if has_content { above + below } else { 0.0 },
                baseline,
                layer: it.layer,
            });
        }
        let column = |base: u32, index: usize| {
            let inside = content
                .iter()
                .filter(|it| (base as usize..=index).contains(&it.0.item));
            inside
                .map(|it| [it.1, it.1 + it.0.width])
                .reduce(|a, b| [a[0].min(b[0]), a[1].max(b[1])])
                .unwrap_or_default()
        };
        for (index, below_baseline) in annotations {
            let (ItemKind::Annotation(id, base), it) =
                (inline.items[index].kind, &self.embedded[index])
            else {
                continue;
            };
            let ([left, right], baseline) = (column(base, index), y + above + below_baseline);
            let [before, after] = [self.widths[base as usize], self.widths[index]];
            let overhang = it.size[0] - (right - left);
            let x = match inline.items[base as usize].style.text.ruby_align {
                RubyAlign::Start => left,
                _ => {
                    left - (overhang + after - before) / 2.0 * if rtl { -1.0 } else { 1.0 }
                        - if rtl { overhang } else { 0.0 }
                }
            };
            let [width, height] = it.size;
            let fragment = Fragment {
                kind: FragmentKind::Atomic(id),
                item: index as u32,
                x,
                y: baseline - it.baseline,
                width,
                height,
                baseline,
                layer: 0,
            };
            self.lines.fragments.push(fragment);
        }
        for (piece, x, owner, origin, shift) in content {
            let item = &inline.items[piece.item];
            let (offset, layer) = (boxes[owner].offset, boxes[owner].layer);
            let (x, baseline) = (x + offset[0], baseline_of(origin) + shift + offset[1]);
            let (ascent, descent) = (item.style.metrics.ascent, item.style.metrics.descent);
            let mut rect = [x, baseline - ascent, piece.width, ascent + descent];
            let kind = match item.kind {
                _ if piece.is_hyphen => FragmentKind::Hyphen(self.document.hyphen(&item.style).0),
                ItemKind::Text | ItemKind::Break => FragmentKind::Text {
                    clusters: piece.clusters.clone(),
                    rtl: piece.level % 2 == 1,
                    hidden: 0,
                },
                ItemKind::Atomic(id) => {
                    let it = &self.embedded[piece.item];
                    let own = relative_offset(&item.style, self.size.0, self.size.1);
                    let top = baseline - it.baseline + it.margin[0];
                    rect = [
                        x + it.margin[3] + own[0],
                        top + own[1],
                        it.size[0],
                        it.size[1],
                    ];
                    FragmentKind::Atomic(id)
                }
                _ => continue,
            };
            let baseline = if item.style.has_central_baseline() {
                rect[1] + self.document.current_style(item).metrics.ascent
            } else {
                baseline
            };
            let ([x, y, width, height], item) = (rect, piece.item as u32);
            self.lines.fragments.push(Fragment {
                kind,
                item,
                x,
                y,
                width,
                height,
                baseline,
                layer,
            });
        }
        for (index, (item, position, edges)) in self
            .out_of_flow
            .iter_mut()
            .enumerate()
            .skip(first_out_of_flow)
        {
            if inline.items[*item].style.was_inline {
                position[1] += edges[1].of([0.0, height]);
            } else if index >= first_after_content {
                position[1] += height;
            }
        }
        self.lines.lines.push(Line {
            y,
            height,
            baseline: y + above,
            left,
            right,
            rtl,
            has_content,
            end,
            clusters: line.start.cluster..line.next.cluster,
            fragments: first..self.lines.fragments.len() as u32,
            overflow: None,
            clamp: None,
        });
        y + height
            - if has_content {
                self.room_for_annotations.min(0.0)
            } else {
                0.0
            }
    }
}

/// And the space before the line.
fn alignment(root: &Style, is_forced: bool, rtl: bool, free: f32) -> (TextAlign, f32) {
    let align = match (is_forced, root.text.align_last, root.text.align) {
        (true, TextAlignLast::Auto, TextAlign::Justify) | (true, TextAlignLast::Start, _) => {
            TextAlign::Start
        }
        (true, TextAlignLast::End, _) => TextAlign::End,
        (true, TextAlignLast::Left, _) => TextAlign::Left,
        (true, TextAlignLast::Right, _) => TextAlign::Right,
        (true, TextAlignLast::Center, _) => TextAlign::Center,
        (true, TextAlignLast::Justify, _) => TextAlign::Justify,
        (_, _, align) => align,
    };
    let before = match (align, rtl) {
        _ if free <= 0.0 => {
            if rtl {
                free
            } else {
                0.0
            }
        }
        (TextAlign::Center | TextAlign::WebkitCenter, _) => unit(free / 2.0),
        (TextAlign::Left | TextAlign::WebkitLeft, _) | (TextAlign::End, true) => 0.0,
        (TextAlign::Right | TextAlign::WebkitRight, _) | (TextAlign::End, false) | (_, true) => {
            free
        }
        (_, false) => 0.0,
    };
    (align, before)
}

struct Word {
    width: f32,
    /// Of the spaces after it.
    spaces: f32,
}

/// A few words in ASCII and in one face.
#[derive(Clone, Copy)]
pub(crate) struct Label {
    /// The min-content and max-content widths.
    widths: [f32; 2],
    /// On a line.
    width: f32,
    /// The ascent, the descent and the line gap of the face.
    face: [f32; 3],
}

impl Label {
    pub(crate) fn new(
        text: &str,
        clusters: &[Letter],
        faces: &[crate::abi::Face],
    ) -> Option<Label> {
        let is_word = |it: &Letter| it.flags & CLUSTER_SPACE == 0;
        (clusters.len() < 64
            && faces.len() == 1
            && is_word(clusters.first()?)
            && is_word(clusters.last()?)
            && text.bytes().all(|it| (b' '..0x7f).contains(&it)))
        .then_some(())?;
        Some(Label {
            widths: widths_of_words(clusters)?,
            width: clusters.iter().fold(0.0, |all, it| all + it.advance),
            face: [faces[0].ascent, faces[0].descent, faces[0].line_gap],
        })
    }
}

impl Inline {
    /// If there is nothing but text whose spaces collapse.
    fn only_text(&self) -> Option<&Style> {
        let (
            [
                Item {
                    kind: ItemKind::Text,
                    style,
                    ..
                },
            ],
            None,
        ) = (&self.items[..], &self.first_line)
        else {
            return None;
        };
        (style.text.collapse == WhiteSpaceCollapse::Collapse).then_some(style)
    }

    pub(crate) fn find_label(&self) -> Option<Label> {
        self.clusters.label().filter(|_| self.only_text().is_some())
    }

    /// The min-content and max-content widths of a label.
    pub(crate) fn widths_of_label(&self, root: &Style) -> Option<[f32; 2]> {
        let (label, style) = (
            self.label
                .filter(|_| matches!(root.text.indent.length, Lp::Px(0.0)))?,
            &self.items[0].style,
        );
        let breaks_words = style.text.overflow_wrap == OverflowWrap::Anywhere
            || style.text.word_break == WordBreak::BreakWord;
        (if wraps(style) {
            (!breaks_words).then_some(label.widths)
        } else {
            Some([label.width; 2])
        })
        .map(|it| it.map(ceil_to_unit))
    }

    fn widths_of_prose(&self, root: &Style) -> Option<[f32; 2]> {
        let prose = self
            .prose(root)
            .filter(|it| !it.has_atomics && matches!(root.text.indent.length, Lp::Px(0.0)))?;
        Some([prose.widest_line(0.0)?, prose.widest_line(f32::INFINITY)?].map(ceil_to_unit))
    }
}

/// Fails unless there is nothing else.
fn visit_words(clusters: &[Letter], mut visit: impl FnMut(Word)) -> Option<()> {
    let mut word = Word {
        width: 0.0,
        spaces: 0.0,
    };
    for cluster in clusters {
        match cluster.flags {
            _ if cluster.advance <= 0.0 => return None,
            0 => word.width += core::mem::take(&mut word.spaces) + cluster.advance,
            CLUSTER_SPACE => word.spaces += cluster.advance,
            CLUSTER_BREAK_BEFORE => visit(core::mem::replace(
                &mut word,
                Word {
                    width: cluster.advance,
                    spaces: 0.0,
                },
            )),
            _ => return None,
        }
    }
    visit(word);
    Some(())
}

/// How many letters the line has, and its width without and with the spaces at the end of the last one. Fails unless there is nothing but words, and the first one fits.
#[inline(never)]
fn fit_words(letters: &[Letter], limit: f32) -> Option<(usize, f32, f32)> {
    // The bits of positive numbers are in the order of the numbers.
    let (mut x, mut used, mut cut, mut odd, limit) = (0.0, 0, (0, 0), 0, limit.to_bits());
    for (at, it) in letters.iter().enumerate() {
        cut = select_unpredictable(it.flags == CLUSTER_BREAK_BEFORE, (at, used), cut);
        x += it.advance;
        used = select_unpredictable(it.flags == CLUSTER_SPACE, used, f32::to_bits(x));
        odd |= it.advance.to_bits().wrapping_sub(1) >> 29 & 4 | (u32::from(it.flags) + 1);
        if used > limit {
            return (odd < 4 && cut.0 > 0).then_some((cut.0, f32::from_bits(cut.1), x));
        }
    }
    (odd < 4).then_some((letters.len(), f32::from_bits(used), x))
}

#[derive(Clone, Copy, PartialEq)]
enum Part {
    Open,
    Close,
    Text,
    Atomic,
    /// With a forced break at its end.
    LastOfLine,
}

/// An edge of an inline element, or text that stays together.
#[derive(Clone, Copy)]
struct Run {
    item: u32,
    start: u32,
    width: f32,
    /// Of the spaces that hang after it, and how many of them collapse at the end of a line.
    spaces: f32,
    collapsing: u8,
    part: Part,
    may_start_line: bool,
    face: u8,
}

/// Text from left to right, in inline elements of a fixed size that are aligned to the baseline.
pub(crate) struct Prose {
    runs: Vec<Run>,
    /// In a layout, and for the min-content width.
    breaks_words: [bool; 2],
    /// Its lines only change where they are broken differently.
    can_hold: bool,
    has_one_face: bool,
    has_atomics: bool,
    /// They all take up space.
    is_sized: bool,
}

impl Prose {
    fn new(inline: &Inline, root: &Style) -> Option<Prose> {
        (!inline.has_bidi
            && !inline.has_layers
            && inline.first_line.is_none()
            && !bun_core::strings::contains_char(inline.text.as_bytes(), b'\t'))
        .then_some(())?;
        let (items, style_of) = (&inline.items, |parent: u32| {
            parent
                .checked_sub(1)
                .map_or(root, |it| &*inline.items[it as usize].style)
        });
        let mut prose = Prose {
            runs: Vec::with_capacity(items.len() + inline.clusters.len() / 5),
            breaks_words: [false; 2],
            can_hold: inline.text.is_ascii(),
            has_one_face: true,
            has_atomics: false,
            is_sized: true,
        };
        let (mut opens, mut common_wraps, mut previous, mut kinds) =
            (None, true, None::<(bool, bool)>, [false; 2]);
        let mut ends = inline
            .clusters
            .paragraphs
            .iter()
            .skip(1)
            .map(|it| it.first_cluster)
            .chain(
                inline
                    .text
                    .ends_with('\n')
                    .then_some(inline.clusters.len() as u32),
            );
        let (mut end_of_paragraph, letters) = (
            ends.next().unwrap_or(u32::MAX),
            inline.clusters.as_letters()?,
        );
        for (item, index) in items.iter().zip(0..) {
            let (style, new) = (&*item.style, |part, start| Run {
                item: index,
                start,
                width: 0.0,
                spaces: 0.0,
                collapsing: 0,
                part,
                may_start_line: false,
                face: 0,
            });
            let text = &style.text;
            match item.kind {
                ItemKind::Open(has_edge) | ItemKind::Close(has_edge) => {
                    let (fixed, is_start) = (style.fixed(), matches!(item.kind, ItemKind::Open(_)));
                    (fixed
                        .traits
                        .contains(Traits::HAS_FIXED_PADDING | Traits::HAS_FIXED_MARGIN)
                        && fixed.margin.left >= 0.0
                        && fixed.margin.right >= 0.0
                        && matches!(
                            style.layout.vertical_align,
                            VerticalAlign::Keyword(VerticalAlignName::Baseline)
                        )
                        && style.rare.decoration_break != DecorationBreak::Clone
                        && style.rare.box_trim == TextBoxTrim::None
                        && !style.is_rtl())
                    .then_some(())?;
                    let (margin, rest) = if has_edge {
                        edge(style, is_start, 0.0)
                    } else {
                        (0.0, 0.0)
                    };
                    if is_start {
                        opens.get_or_insert(prose.runs.len());
                    } else {
                        (opens, common_wraps) = (
                            None,
                            wraps(style_of(items[item.parent as usize - 1].parent)),
                        );
                    }
                    prose.runs.push(Run {
                        width: margin + rest,
                        spaces: margin,
                        ..new(
                            if is_start { Part::Open } else { Part::Close },
                            item.clusters.start,
                        )
                    });
                    continue;
                }
                ItemKind::Atomic(_)
                    if item.clusters.len() == 1
                        && !style.has_central_baseline()
                        && style_of(item.parent).text.collapse
                            != WhiteSpaceCollapse::BreakSpaces =>
                {
                    let breaks = letters[item.clusters.start as usize].flags & CLUSTER_BREAK_BEFORE
                        != 0
                        && previous.is_some_and(
                            |(is_space, wraps)| if is_space { wraps } else { common_wraps },
                        );
                    opens
                        .filter(|_| breaks)
                        .into_iter()
                        .for_each(|it| prose.runs[it].may_start_line = true);
                    prose.runs.push(Run {
                        may_start_line: breaks && opens.is_none(),
                        ..new(Part::Atomic, item.clusters.start)
                    });
                    (opens, common_wraps, previous, prose.has_atomics) = (
                        None,
                        wraps(style_of(item.parent)),
                        Some((false, false)),
                        true,
                    );
                    continue;
                }
                ItemKind::Text | ItemKind::Break
                    if text.collapse != WhiteSpaceCollapse::BreakSpaces
                        && !style.has_central_baseline() => {}
                _ => return None,
            }
            let clusters = &letters[item.clusters.start as usize..item.clusters.end as usize];
            let Some(first) = clusters.first() else {
                continue;
            };
            let (item_wraps, keeps_spaces) = (wraps(style), text.collapse.preserves_spaces());
            let anywhere = text.overflow_wrap == OverflowWrap::Anywhere
                || text.word_break == WordBreak::BreakWord;
            prose.breaks_words = [
                prose.breaks_words[0] || anywhere || text.overflow_wrap == OverflowWrap::BreakWord,
                prose.breaks_words[1] || anywhere,
            ];
            (prose.can_hold, prose.has_one_face) = (
                prose.can_hold && !(item_wraps && keeps_spaces),
                prose.has_one_face && item.is_uniform,
            );
            kinds[usize::from(keeps_spaces)] |=
                !keeps_spaces || clusters.iter().all(|it| it.flags & CLUSTER_SPACE != 0);
            let breaks = first.flags & CLUSTER_BREAK_BEFORE != 0
                && previous
                    .is_some_and(|(is_space, wraps)| if is_space { wraps } else { common_wraps });
            opens
                .filter(|_| breaks)
                .into_iter()
                .for_each(|it| prose.runs[it].may_start_line = true);
            let mut run = Run {
                face: first.face,
                may_start_line: breaks && opens.is_none(),
                ..new(Part::Text, item.clusters.start)
            };
            let (hanging, breaking) = (
                if item_wraps || !keeps_spaces {
                    CLUSTER_SPACE
                } else {
                    0
                },
                if item_wraps { CLUSTER_BREAK_BEFORE } else { 0 },
            );
            let (mut at, mut least) = (item.clusters.start, f32::INFINITY);
            while at < item.clusters.end {
                let cluster = letters[at as usize];
                if at > run.start && (cluster.flags & breaking != 0 || run.part == Part::LastOfLine)
                {
                    prose.runs.push(core::mem::replace(
                        &mut run,
                        Run {
                            may_start_line: true,
                            face: cluster.face,
                            ..new(Part::Text, at)
                        },
                    ));
                }
                at += 1;
                if at == end_of_paragraph {
                    (run.collapsing == 0).then_some(())?;
                    (run.part, end_of_paragraph) =
                        (Part::LastOfLine, ends.next().unwrap_or(u32::MAX));
                    continue;
                }
                (cluster.flags & !(CLUSTER_SPACE | CLUSTER_BREAK_BEFORE) == 0).then_some(())?;
                least = at_most(least, cluster.advance);
                if cluster.flags & hanging != 0 {
                    (run.spaces, run.collapsing) = (
                        run.spaces + cluster.advance,
                        run.collapsing.checked_add(u8::from(!keeps_spaces))?,
                    );
                    continue;
                }
                let mut width = run.width + run.spaces + cluster.advance;
                for it in letters[at as usize..item.clusters.end.min(end_of_paragraph - 1) as usize]
                    .iter()
                    .take_while(|it| it.flags == 0)
                {
                    (width, least, at) = (width + it.advance, at_most(least, it.advance), at + 1);
                }
                (run.width, run.spaces, run.collapsing) = (width, 0.0, 0);
            }
            (least > 0.0).then_some(())?;
            prose.runs.push(run);
            previous = Some((
                clusters[clusters.len() - 1].flags & CLUSTER_SPACE != 0,
                item_wraps,
            ));
            (opens, common_wraps) = (None, wraps(style_of(item.parent)));
        }
        (kinds != [true; 2]).then_some(prose)
    }

    /// The run after the line, its width, and whether the break is forced.
    #[inline]
    fn break_line(
        &self,
        first: usize,
        indent: f32,
        available: f32,
        breaks_words: bool,
    ) -> Option<(usize, f32, bool)> {
        let (mut x, mut hanging, mut opportunity, mut has_content, mut end, limit) = (
            indent,
            0.0,
            None,
            false,
            self.runs.len(),
            available + TOLERANCE,
        );
        for (index, run) in self.runs.iter().enumerate().skip(first) {
            if run.may_start_line && has_content {
                opportunity = Some((index, x - hanging, false));
            }
            if let Part::Open | Part::Close = run.part {
                x += run.width;
                if run.part == Part::Close && x - hanging > limit && opportunity.is_some() {
                    return opportunity;
                }
                continue;
            }
            if run.width > 0.0 {
                if x + run.width > limit && (opportunity.is_some() || breaks_words) {
                    return opportunity;
                }
                hanging = 0.0;
            }
            (x, hanging, has_content) = (x + run.width + run.spaces, hanging + run.spaces, true);
            if run.part == Part::LastOfLine {
                let closing = self.runs[index + 1..]
                    .iter()
                    .take_while(|it| it.part == Part::Close);
                (x, end) = closing.fold((x, index + 1), |all, it| (all.0 + it.width, all.1 + 1));
                break;
            }
        }
        Some((
            end,
            if x <= limit {
                x
            } else {
                (x - hanging).max(available.min(x))
            },
            true,
        ))
    }

    fn widest_line(&self, available: f32) -> Option<f32> {
        let (mut first, mut widest) = (0, 0.0f32);
        while first < self.runs.len() {
            let (end, width, _) = self.break_line(
                first,
                0.0,
                available,
                available == 0.0 && self.breaks_words[1],
            )?;
            (first, widest) = (end, widest.max(width));
        }
        Some(widest)
    }
}

impl Inline {
    fn prose(&self, root: &Style) -> Option<&Prose> {
        self.prose
            .get_or_init(|| Prose::new(self, root))
            .as_ref()
            .filter(|it| it.is_sized)
    }

    /// `widths` has those of the items.
    fn size_atomics(&mut self, root: &Style, widths: &[f32]) {
        self.prose(root);
        let Some(prose) = self
            .prose
            .get_mut()
            .and_then(Option::as_mut)
            .filter(|it| it.has_atomics)
        else {
            return;
        };
        prose.is_sized = true;
        for it in prose.runs.iter_mut().filter(|it| it.part == Part::Atomic) {
            it.width = widths[it.item as usize];
            prose.is_sized &= it.width > 0.0;
        }
    }
}

/// The min-content and max-content widths.
fn widths_of_words(clusters: &[Letter]) -> Option<[f32; 2]> {
    let mut widths = [0.0f32; 2];
    visit_words(clusters, |it| {
        widths = [widths[0].max(it.width), widths[1] + it.width + it.spaces]
    })?;
    Some(widths)
}

fn sources<'a>(
    inline: &'a Inline,
    root: &'a Style,
    widths: &'a [f32],
    first_widths: Option<&'a [f32]>,
) -> Sources<'a> {
    let others = Source {
        inline,
        root,
        widths,
    };
    let first = inline.first_line.as_deref().zip(first_widths);
    [
        first.map_or(others, |((inline, root), widths)| Source {
            inline,
            root,
            widths,
        }),
        others,
    ]
}

impl Inline {
    fn initial_letter(&self) -> Option<(usize, InitialLetter)> {
        let (index, item) = self
            .items
            .iter()
            .enumerate()
            .take_while(|it| it.1.clusters.start == 0)
            .find(|it| matches!(it.1.kind, ItemKind::Float(_)) && it.1.node == 0)?;
        Some((index, item.style.rare.initial_letter.0?))
    }
}

impl Item {
    fn embedded(&self) -> BoxId {
        match self.kind {
            ItemKind::Atomic(id)
            | ItemKind::Float(id)
            | ItemKind::OutOfFlow(id)
            | ItemKind::Annotation(id, _) => id,
            _ => 0,
        }
    }
}

impl Document {
    /// How far the glyphs of an initial letter go below the baseline.
    fn ink_descent(&self, id: BoxId) -> f32 {
        let paragraphs = self.boxes[id]
            .children
            .iter()
            .flat_map(|it| &self.boxes[*it].inline)
            .flat_map(|it| &it.clusters.paragraphs);
        let depth = |shaped: &Shaped| {
            let face = shaped.faces.first()?;
            (1..=face.descent.ceil() as u32)
                .rev()
                .map(|it| it as f32)
                .find(|it| {
                    !crate::platform::ink_spans(face, shaped.glyphs(), it - 1.0, *it).is_empty()
                })
        };
        paragraphs
            .filter_map(|it| depth(&it.shaped))
            .fold(0.0, f32::max)
    }

    fn hyphen(&self, style: &Style) -> (Rc<Shaped>, f32) {
        let shaped = match &style.text.hyphen.0 {
            Some(custom) => self.shape_plain(&custom.0, style),
            None => {
                let (hyphen, minus) = (
                    self.shape_plain("\u{2010}", style),
                    self.shape_plain("-", style),
                );
                if hyphen.faces == minus.faces && hyphen.glyphs().iter().all(|it| it.id != 0) {
                    hyphen
                } else {
                    minus
                }
            }
        };
        let width = shaped.clusters().iter().map(|it| it.advance).sum();
        (shaped, width)
    }

    /// `is_forced` puts an ellipsis on a line that fits, too.
    pub(crate) fn truncate(
        &self,
        lines: &Lines,
        clusters: &Clusters,
        line: &Line,
        style: &Style,
        is_forced: bool,
    ) -> Option<Box<Truncation>> {
        if !is_forced
            && !line.rtl
            && lines
                .fragments_of(line)
                .iter()
                .all(|it| it.x + it.width <= line.right)
        {
            return None;
        }
        let ellipsis = self.shape_plain("…", style);
        let width: f32 = ellipsis.clusters().iter().map(|it| it.advance).sum();
        let pieces = || {
            lines.fragments_of(line).iter().flat_map(|fragment| {
                let atomic = matches!(fragment.kind, FragmentKind::Atomic(_))
                    .then_some((fragment.x, fragment.width));
                lines
                    .positions(clusters, fragment)
                    .map(|it| (it.1, it.2))
                    .chain(atomic)
                    .filter(|it| it.1 > 0.0)
            })
        };
        let overflows = |(left, advance): (f32, f32)| {
            left + advance > line.right + TOLERANCE && !line.rtl
                || left < line.left - TOLERANCE && line.rtl
        };
        if !is_forced && !pieces().any(overflows) {
            return None;
        }
        let limit = match line.rtl {
            true => pieces()
                .map(|it| it.0)
                .reduce(f32::max)
                .map_or(line.left + width, |first| first.min(line.left + width)),
            false => pieces()
                .map(|it| it.0 + it.1)
                .reduce(f32::min)
                .map_or(line.right - width, |first| first.max(line.right - width)),
        };
        let mut truncation = Truncation {
            limit,
            x: 0.0,
            ellipsis,
        };
        let shown = pieces().filter(|(left, advance)| truncation.shows(*left, *advance, line.rtl));
        truncation.x = match line.rtl {
            true => shown.map(|it| it.0).reduce(f32::min).unwrap_or(line.right) - width,
            false => shown
                .map(|it| it.0 + it.1)
                .reduce(f32::max)
                .unwrap_or(line.left),
        };
        Some(Box::new(truncation))
    }

    fn lay_out_embedded(
        &mut self,
        id: BoxId,
        basis: (f32, Option<f32>),
        output: &mut Output,
    ) -> Embedded {
        let (mut margin, width, own) = self.lay_out_shrunk(id, basis);
        self.absorb(id, &own, output);
        let it = &self.boxes[id];
        let mut baseline = match it.style.display() {
            _ if it.style.rare.baseline_source == BaselineSource::First => {
                own.baselines[0].map(|baseline| it.clamp_baseline(baseline, own.height))
            }
            _ if it.style.rare.baseline_source == BaselineSource::Last => own
                .last_baseline
                .map(|baseline| it.clamp_baseline(baseline, own.height)),
            Display::InlineBlock | Display::Inline if it.scrolls() && !it.shrinks_to_fit => None,
            Display::InlineBlock | Display::Inline | Display::InlineBlockListItem => {
                own.baselines[1]
            }
            _ => own.baselines[0].map(|baseline| it.clamp_baseline(baseline, own.height)),
        };
        let lines = &self.boxes[it.parent];
        if lines.mode.flips_lines() && !it.style.is_floating() {
            core::mem::swap(&mut margin.top, &mut margin.bottom);
            baseline = baseline.map(|it| own.height - it);
        }
        let synthesized = (own.height + margin.sums()[1])
            / if lines.style.has_central_baseline() {
                2.0
            } else {
                1.0
            };
        let baseline = baseline
            .or_else(|| {
                it.style.look.is_checkable().then(|| {
                    own.height
                        / if lines.style.has_central_baseline() {
                            2.0
                        } else {
                            1.0
                        }
                })
            })
            .map_or(synthesized, |it| margin.top + it);
        Embedded {
            size: [width, own.height],
            margin: margin.to_array(),
            baseline,
        }
    }

    #[inline(never)]
    pub(crate) fn lay_out_lines(
        &mut self,
        id: BoxId,
        input: &Input,
        floats: Option<&mut Floats>,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let Some(mut inline) = self.boxes[id].inline.take() else {
            return Output::default();
        };
        let (owns_floats, mut own) = (floats.is_none(), Floats::default());
        let output = self.lay_out_inline(
            id,
            &mut inline,
            input,
            floats.unwrap_or(&mut own),
            owns_floats,
            breaks,
        );
        self.boxes[id].inline = Some(inline);
        output
    }

    fn with_leading(&self, ascent: f32, descent: f32, line_height: f32) -> [f32; 2] {
        let scale = self.environment.scale;
        let above =
            ascent + ((line_height - ascent - descent) / 2.0 * scale + 0.001).floor() / scale;
        [above, line_height - above]
    }

    #[inline]
    fn strut(&self, style: &Style) -> [f32; 2] {
        if style.plainness.5.get().0 != self.environment.scale {
            style.plainness.5.set((
                self.environment.scale,
                self.with_leading(
                    style.metrics.ascent,
                    style.metrics.descent,
                    unit(style.line_height() + 0.0001),
                ),
            ));
        }
        style.plainness.5.get().1
    }

    /// If nothing around the lines makes a difference but their width: whether they may end with an ellipsis.
    #[inline]
    fn has_plain_lines(&self, id: BoxId, input: &Input) -> Option<bool> {
        let it = &self.boxes[id];
        let (root, container) = (&*it.style, &self.boxes[it.parent]);
        (!(self.boxes.has_annotations
            || input.trim != [false; 2]
            || root.is_rtl()
            || it.has_turned_children)
            && [it.mode, it.turned, container.mode, root.text.writing_mode]
                == [WritingMode::HorizontalTb; 4]
            && matches!(root.text.indent.length, Lp::Px(0.0))
            && matches!(
                root.text.wrap_style,
                TextWrapStyle::Auto | TextWrapStyle::Stable
            )
            && self.environment.quirks == Quirks::None)
            .then(|| {
                container.overflow[0] != Overflow::Visible
                    && container.style.layout.text_overflow == TextOverflow::Ellipsis
            })
    }

    /// What `run_algorithm` comes to for prose that no float is in the way of, and what the fragments cover.
    #[inline(never)]
    pub(crate) fn lay_out_prose(&mut self, id: BoxId, input: &Input) -> Option<(Output, Rect)> {
        let has_ellipsis = self
            .has_plain_lines(id, input)
            .filter(|_| self.boxes[id].children.is_empty() && self.boxes.is_unbroken(id))?;
        let mut inline = self.boxes[id].inline.take()?;
        let mut lines = core::mem::take(&mut inline.lines);
        let (root, is_new) = (
            &self.boxes[id].style,
            lines.lines.is_empty() && !has_ellipsis && inline.prose.get().is_none(),
        );
        let filled = if is_new {
            self.fill_lines_with_text(&inline, root, input.width, &mut lines)
        } else {
            None
        };
        let filled = filled.or_else(|| {
            self.fill_lines(
                &inline,
                root,
                (input.width, None),
                has_ellipsis,
                &[],
                &mut lines,
            )
        });
        let baselines = [lines.lines.first(), lines.lines.last()].map(|it| Some(it?.baseline));
        inline.lines = lines;
        let it = &mut self.boxes[id];
        it.inline = Some(inline);
        let (height, covered) = filled?;
        let used = input.height.unwrap_or(height);
        (it.layout.size.width, it.layout.size.height) = (input.width, used);
        Some((
            Output {
                height: used,
                intrinsic: height,
                baselines,
                last_baseline: baselines[1],
                ..Output::default()
            },
            covered,
        ))
    }

    /// `fill_lines` for nothing but words, which may never be broken again.
    fn fill_lines_with_text(
        &self,
        inline: &Inline,
        root: &Style,
        width: f32,
        out: &mut Lines,
    ) -> Option<(f32, Rect)> {
        let ([item], [paragraph]) = (&inline.items[..], &inline.clusters.paragraphs[..]) else {
            return None;
        };
        let (style, letters) = (&*item.style, inline.clusters.letters(&item.clusters)?);
        (item.kind == ItemKind::Text
            && item.is_uniform
            && wraps(style)
            && style.text.collapse == WhiteSpaceCollapse::Collapse
            && style.text.overflow_wrap == OverflowWrap::Normal
            && style.text.word_break != WordBreak::BreakWord
            && !style.has_central_baseline()
            && inline.first_line.is_none()
            && root.text.align != TextAlign::Justify
            && root.text.align_last != TextAlignLast::Justify
            && letters.first()?.flags & CLUSTER_SPACE == 0)
            .then_some(())?;
        let ([mut above, mut below], metrics) = (self.strut(root), &style.metrics);
        if let Some(face) = paragraph
            .shaped
            .faces
            .get(usize::from(letters[0].face))
            .filter(|_| style.font.line_height == LineHeight::Normal)
        {
            let [up, down] = self.with_leading(
                face.ascent,
                face.descent,
                face.ascent + face.descent + face.line_gap,
            );
            (above, below) = (above.max(up), below.max(down));
        }
        let count = 1 + letters
            .len()
            .min((letters.len() as f32 * metrics.average_advance / width) as usize);
        out.lines.reserve_exact(count);
        out.fragments.reserve_exact(count);
        let (mut first, mut y, mut holds, mut across) =
            (0, 0.0, [0.0f32, f32::INFINITY], [f32::MAX, f32::MIN]);
        while first < letters.len() {
            let (count, own, x) = fit_words(&letters[first..], width + TOLERANCE)?;
            let (end, is_last) = (first + count, first + count == letters.len());
            let used = if !is_last {
                own
            } else if x <= width + TOLERANCE {
                x
            } else {
                own.max(width.min(x))
            };
            let hidden = letters[..end]
                .iter()
                .rev()
                .take_while(|it| it.flags == CLUSTER_SPACE)
                .count()
                .try_into()
                .ok()?;
            let (start, clusters, index) = (
                alignment(root, is_last, false, width - used).1,
                first as u32..end as u32,
                out.lines.len() as u32,
            );
            let kind = FragmentKind::Text {
                clusters: clusters.clone(),
                rtl: false,
                hidden,
            };
            out.fragments.push(Fragment {
                kind,
                item: 0,
                x: start,
                y: y + above - metrics.ascent,
                width: own,
                height: metrics.ascent + metrics.descent,
                baseline: y + above,
                layer: 0,
            });
            out.lines.push(Line {
                y,
                height: above + below,
                baseline: y + above,
                left: 0.0,
                right: width,
                rtl: false,
                has_content: true,
                end: start + used,
                clusters,
                fragments: index..index + 1,
                overflow: None,
                clamp: None,
            });
            (first, y, holds, across) = (
                end,
                y + (above + below),
                [holds[0].max(used), if is_last { holds[1] } else { width }],
                [across[0].min(start), across[1].max(start + own)],
            );
        }
        let covered = Rect::from_edges(
            across[0],
            out.fragments[0].y,
            across[1],
            out.fragments.last()?.rect().bottom(),
        );
        let starts_left = matches!(root.text.align, TextAlign::Start | TextAlign::Left)
            && root.text.align_last == TextAlignLast::Auto;
        let strip = Rect::new([0.0, 0.0, 0.0, y]);
        (out.bounds, out.flow) = (
            if covered.height > 0.0 {
                covered.union(&strip)
            } else {
                strip
            },
            Rect::from_edges(across[0].min(0.0), 0.0, across[1].max(0.0), y),
        );
        (out.visible, out.holds) = (
            None,
            (starts_left && holds[0] <= width && inline.text.is_ascii()).then_some(holds),
        );
        Some((y, covered))
    }

    /// Returns their height, and what the fragments cover.
    fn fill_lines(
        &self,
        inline: &Inline,
        root: &Style,
        (width, basis): (f32, Option<f32>),
        has_ellipsis: bool,
        embedded: &[Embedded],
        out: &mut Lines,
    ) -> Option<(f32, Rect)> {
        let prose = inline.prose(root).filter(|it| {
            it.has_one_face
                && !it.runs.is_empty()
                && root.text.align != TextAlign::Justify
                && root.text.align_last != TextAlignLast::Justify
        })?;
        let Lines {
            lines, fragments, ..
        } = out;
        lines.clear();
        fragments.clear();
        lines.reserve(1 + inline.clusters.len() / 128);
        fragments.reserve(inline.items.len() + inline.clusters.len() / 128);
        let (strut, mut texts, mut open) = (
            self.strut(root),
            SmallVec::<[Fragment; 16]>::new(),
            SmallVec::<[usize; 8]>::new(),
        );
        let (mut first, mut y, mut holds, mut across, mut bounds) = (
            0,
            0.0,
            [0.0f32, f32::INFINITY],
            [0.0f32; 2],
            Rect::default(),
        );
        let mut covered = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        while first < prose.runs.len() {
            let (end, used, is_forced) =
                prose.break_line(first, 0.0, width, prose.breaks_words[0])?;
            let (runs, start, base) = (
                &prose.runs[first..end],
                alignment(root, is_forced, false, width - used).1,
                fragments.len(),
            );
            let after = prose
                .runs
                .get(end)
                .map_or(inline.clusters.len() as u32, |it| it.start);
            let at_end = runs
                .iter()
                .rposition(|it| {
                    it.part == Part::LastOfLine
                        || it.width > 0.0 && matches!(it.part, Part::Text | Part::Atomic)
                })
                .unwrap_or(0);
            let ([mut above, mut below], mut x, mut has_content) =
                (strut, start, inline.force_line);
            let mut enter =
                |fragments: &mut SmallVec<[Fragment; 1]>, item: u32, x: f32, has_edge: bool| {
                    let [up, down] = self.strut(&inline.items[item as usize].style);
                    (above, below) = (above.max(up), below.max(down));
                    fragments.push(Fragment {
                        kind: FragmentKind::Box(has_edge, false),
                        item,
                        x,
                        y: 0.0,
                        width: 0.0,
                        height: 0.0,
                        baseline: 0.0,
                        layer: 0,
                    });
                    fragments.len() - 1
                };
            if let Some(parent) = inline.items[runs[0].item as usize].parent.checked_sub(1) {
                let around = core::iter::successors(Some(parent), |it| {
                    inline.items[*it as usize].parent.checked_sub(1)
                });
                for item in around.collect::<SmallVec<[u32; 8]>>().into_iter().rev() {
                    open.push(enter(fragments, item, x, false));
                }
            }
            let mut faces = [f32::MIN; 2];
            let mut index = 0;
            while let Some(run) = runs.get(index) {
                let item = &inline.items[run.item as usize];
                if let ItemKind::Open(has_edge) = item.kind {
                    open.push(enter(fragments, run.item, x + run.spaces, has_edge));
                } else if let ItemKind::Close(has_edge) = item.kind {
                    let it = &mut fragments[open.pop()?];
                    it.width = (x + run.width - run.spaces - it.x).max(0.0);
                    if let FragmentKind::Box(_, right) = &mut it.kind {
                        *right = has_edge;
                    }
                } else if let ItemKind::Atomic(child) = item.kind {
                    let (own, mut shift) = (embedded.get(run.item as usize)?, 0.0);
                    if line_relative(&item.style).is_none() {
                        let parent = item
                            .parent
                            .checked_sub(1)
                            .map_or(root, |it| &*inline.items[it as usize].style);
                        shift = baseline_shift(
                            &item.style,
                            parent,
                            own.extent(),
                            self.environment.scale,
                        );
                        faces = [
                            faces[0].max(own.extent()[0] - shift),
                            faces[1].max(own.extent()[1] + shift),
                        ];
                    }
                    let atomic = Fragment {
                        kind: FragmentKind::Atomic(child),
                        item: run.item,
                        x: x + own.margin[3],
                        y: 0.0,
                        width: own.size[0],
                        height: own.size[1],
                        baseline: shift,
                        layer: 0,
                    };
                    texts.push(atomic);
                } else {
                    let (count, mut own) = (
                        runs[index..]
                            .iter()
                            .take_while(|it| it.item == run.item)
                            .count(),
                        0.0,
                    );
                    let (last, inner) = runs[index..index + count].split_last()?;
                    inner.iter().for_each(|it| own += it.width + it.spaces);
                    index += count;
                    let collapsed = if index > at_end { last.collapsing } else { 0 };
                    own += last.width + if collapsed > 0 { 0.0 } else { last.spaces };
                    let kind = FragmentKind::Text {
                        clusters: run.start..runs.get(index).map_or(after, |it| it.start),
                        rtl: false,
                        hidden: collapsed + u8::from(last.part == Part::LastOfLine),
                    };
                    let text = Fragment {
                        kind,
                        item: run.item,
                        x,
                        y: 0.0,
                        width: own,
                        height: 0.0,
                        baseline: 0.0,
                        layer: 0,
                    };
                    if inline.items.len() == 1 {
                        fragments.push(text)
                    } else {
                        texts.push(text)
                    }
                    if item.style.font.line_height == LineHeight::Normal
                        && let Some(face) = inline
                            .paragraph_of(run.start)
                            .shaped
                            .faces
                            .get(usize::from(run.face))
                    {
                        let [up, down] = self.with_leading(
                            face.ascent,
                            face.descent,
                            face.ascent + face.descent + face.line_gap,
                        );
                        faces = [faces[0].max(up), faces[1].max(down)];
                    }
                    (x, has_content) = (
                        x + own,
                        has_content || own > 0.0 || last.part == Part::LastOfLine,
                    );
                    continue;
                }
                (x, has_content, index) =
                    (x + run.width, has_content || run.width != 0.0, index + 1);
            }
            has_content.then_some(())?;
            while let Some(it) = open.pop() {
                fragments[it].width = (x - fragments[it].x).max(0.0);
            }
            (above, below) = (above.max(faces[0]), below.max(faces[1]));
            for it in runs
                .iter()
                .filter(|it| prose.has_atomics && it.part == Part::Atomic)
            {
                let missing = (embedded[it.item as usize].extent()[0]
                    + embedded[it.item as usize].extent()[1]
                    - above
                    - below)
                    .max(0.0);
                match line_relative(&inline.items[it.item as usize].style) {
                    Some(VerticalAlignName::Top) => below += missing,
                    Some(_) => above += missing,
                    None => {}
                }
            }
            let (baseline, height, line_end) = (y + above, above + below, start + used);
            if !texts.is_empty() {
                fragments.reserve(texts.len());
                texts.iter().for_each(|it| fragments.push(it.clone()));
                texts.clear();
            }
            for it in &mut fragments[base..] {
                let style = &inline.items[it.item as usize].style;
                if let FragmentKind::Atomic(_) = it.kind {
                    let (own, offset) = (
                        &embedded[it.item as usize],
                        relative_offset(style, width, basis),
                    );
                    it.baseline = match line_relative(style) {
                        Some(VerticalAlignName::Top) => y + own.baseline,
                        Some(_) => baseline + below - own.extent()[1],
                        None => baseline + it.baseline,
                    };
                    (it.x, it.y) = (
                        it.x + offset[0],
                        it.baseline - own.baseline + own.margin[0] + offset[1],
                    );
                    continue;
                }
                let [mut up, mut down] = [style.metrics.ascent, style.metrics.descent];
                if let FragmentKind::Box(..) = it.kind {
                    let border = style.fixed().border;
                    (up, down) = (
                        up + border.top + style.layout.padding_top.0.resolve(width),
                        down + border.bottom + style.layout.padding_bottom.0.resolve(width),
                    );
                }
                (it.y, it.height, it.baseline) = (baseline - up, up + down, baseline);
                let rect = it.rect();
                covered = [
                    at_most(covered[0], rect.x),
                    at_most(covered[1], rect.y),
                    at_least(covered[2], rect.right()),
                    at_least(covered[3], rect.bottom()),
                ];
                let rect = rect.shrunk([
                    0.0,
                    (rect.right() - line_end).min(rect.width).max(0.0),
                    0.0,
                    0.0,
                ]);
                bounds = if it.height > 0.0 {
                    bounds.union(&rect)
                } else {
                    bounds
                };
                across = [across[0].min(rect.x), across[1].max(rect.right())];
            }
            let (clusters, fragments) = (runs[0].start..after, base as u32..fragments.len() as u32);
            lines.push(Line {
                y,
                height,
                baseline,
                left: 0.0,
                right: width,
                rtl: false,
                has_content,
                end: line_end,
                clusters,
                fragments,
                overflow: None,
                clamp: None,
            });
            (first, y, holds) = (
                end,
                y + height,
                [holds[0].max(used), if is_forced { holds[1] } else { width }],
            );
        }
        let starts_left = matches!(root.text.align, TextAlign::Start | TextAlign::Left)
            && root.text.align_last == TextAlignLast::Auto;
        (out.bounds, out.flow, out.advances) = (
            bounds.union(&Rect::new([0.0, 0.0, 0.0, y])),
            Rect::from_edges(across[0], 0.0, across[1], y),
            Vec::new(),
        );
        (out.visible, out.holds) = (
            None,
            (starts_left && !has_ellipsis && holds[0] <= width && prose.can_hold).then_some(holds),
        );
        for index in 0..if has_ellipsis { out.lines.len() } else { 0 } {
            out.lines[index].overflow =
                self.truncate(out, &inline.clusters, &out.lines[index], root, false);
        }
        Some((
            y,
            Rect::from_edges(covered[0], covered[1], covered[2], covered[3]),
        ))
    }

    /// What `run_algorithm` comes to for a label on a single line that no float is in the way of.
    #[inline]
    pub(crate) fn lay_out_label(&mut self, id: BoxId, input: &Input) -> Option<Output> {
        let it = &self.boxes[id];
        let inline = it.inline.as_ref()?;
        let (
            label,
            Item {
                style, clusters, ..
            },
        ) = (inline.label?, &inline.items[0]);
        let (root, width, has_ellipsis) = (
            &*it.style,
            input.width,
            self.has_plain_lines(id, input)
                .filter(|_| self.boxes.is_unbroken(id))?,
        );
        let (align, x) = alignment(root, true, false, width - label.width);
        ((label.width <= width + TOLERANCE || !wraps(style) && !has_ellipsis)
            && align != TextAlign::Justify)
            .then_some(())?;
        let [mut above, mut below] = self.strut(root);
        if style.font.line_height == LineHeight::Normal {
            let [ascent, descent, line_gap] = label.face;
            let extent = self.with_leading(ascent, descent, ascent + descent + line_gap);
            (above, below) = (above.max(extent[0]), below.max(extent[1]));
        }
        let (clusters, height, metrics) = (clusters.clone(), above + below, &style.metrics);
        let kind = FragmentKind::Text {
            clusters: clusters.clone(),
            rtl: false,
            hidden: 0,
        };
        let fragment = Fragment {
            kind,
            item: 0,
            x,
            y: above - metrics.ascent,
            width: label.width,
            height: metrics.ascent + metrics.descent,
            baseline: above,
            layer: 0,
        };
        let line = Line {
            y: 0.0,
            height,
            baseline: above,
            left: 0.0,
            right: width,
            rtl: false,
            has_content: true,
            end: x + label.width,
            clusters,
            fragments: 0..1,
            overflow: None,
            clamp: None,
        };
        let (strip, mut rect) = (Rect::new([0.0, 0.0, 0.0, height]), fragment.rect());
        rect = rect.shrunk([
            0.0,
            (rect.right() - line.end).min(rect.width).max(0.0),
            0.0,
            0.0,
        ]);
        let starts_left = matches!(root.text.align, TextAlign::Start | TextAlign::Left)
            && root.text.align_last == TextAlignLast::Auto;
        let it = &mut self.boxes[id];
        let lines = &mut it.inline.as_mut()?.lines;
        lines.bounds = if fragment.height > 0.0 {
            strip.union(&rect)
        } else {
            strip
        };
        lines.flow = Rect::from_edges(rect.x.min(0.0), 0.0, rect.right().max(0.0), height);
        (lines.visible, lines.holds) = (
            None,
            (starts_left && !has_ellipsis && label.width <= width)
                .then_some([label.width, f32::INFINITY]),
        );
        if lines.lines.spilled() {
            lines.lines.clear();
            lines.lines.push(line);
            lines.fragments.clear();
            lines.fragments.push(fragment);
        } else {
            (lines.lines, lines.fragments) =
                (SmallVec::from_buf([line]), SmallVec::from_buf([fragment]));
        }
        lines.advances = Vec::new();
        let used = input.height.unwrap_or(height);
        (it.layout.size.width, it.layout.size.height) = (width, used);
        Some(Output {
            height: used,
            intrinsic: height,
            baselines: [Some(above); 2],
            last_baseline: Some(above),
            room_for_annotations: input.room_for_annotations.max(0.0),
            ..Output::default()
        })
    }

    /// Whether the lines could stay as they are.
    pub(crate) fn resize_lines(&mut self, id: BoxId, width: f32) -> bool {
        let it = &mut self.boxes[id];
        let holds = |lines: &Lines| {
            lines.visible.is_none()
                && lines
                    .holds
                    .is_some_and(|[least, most]| (least..=most).contains(&width))
        };
        let Some(inline) = it.inline.as_mut().filter(|it| holds(&it.lines)) else {
            return false;
        };
        inline
            .lines
            .lines
            .iter_mut()
            .for_each(|it| it.right = width);
        it.layout.size.width = width;
        true
    }

    fn item_widths(
        inline: &Inline,
        basis: f32,
        mut embedded: impl FnMut(usize, BoxId) -> f32,
    ) -> ItemWidths {
        let widths = inline
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| match item.kind {
                ItemKind::Open(has_edge) | ItemKind::Close(has_edge)
                    if has_edge || item.style.rare.decoration_break == DecorationBreak::Clone =>
                {
                    let is_start = matches!(item.kind, ItemKind::Open(_));
                    let (margin, rest) = edge(&item.style, is_start != item.style.is_rtl(), basis);
                    margin + rest
                }
                ItemKind::Atomic(id) | ItemKind::Float(id) | ItemKind::Annotation(id, _) => {
                    embedded(index, id)
                }
                _ => 0.0,
            });
        widths.collect()
    }

    fn text_indents(&self, id: BoxId, width: f32) -> Indents {
        let indent = &self.boxes[id].style.text.indent;
        let (length, siblings) = (
            resolve(&indent.length, width),
            &self.boxes[self.boxes[id].parent].children,
        );
        let first = || {
            siblings.iter().find(|it| {
                !self.boxes[**it].style.is_out_of_flow() && !self.boxes[**it].style.is_floating()
            })
        };
        let is_first =
            length != 0.0 && (!self.boxes[id].is_in_block(&self.boxes) || first() == Some(&id));
        [is_first || indent.each_line, indent.each_line, false]
            .map(|it| if it != indent.hangs { length } else { 0.0 })
    }

    pub(crate) fn lines_widths(&mut self, id: BoxId, height: Option<f32>) -> Widths {
        let it = &self.boxes[id];
        if let Some(sizes) = it.inline.as_ref().and_then(|inline| {
            inline
                .widths_of_label(&it.style)
                .or_else(|| inline.widths_of_prose(&it.style))
        }) {
            return Widths {
                sizes,
                uses_height: false,
            };
        }
        let Some(mut inline) = self.boxes[id].inline.take() else {
            return Widths::default();
        };
        let (root, mut uses_height) = (Rc::clone(&self.boxes[id].style), false);
        let mut advances = Vec::new();
        let sizes = [0, 1].map(|which| {
            let mut widths_of = |inline: &Inline| {
                let mut widths = Self::item_widths(inline, 0.0, |index, child| {
                    let own = self.contribution(child, height, None);
                    uses_height |= own.uses_height
                        && (self.boxes[child].uses_parent[1] || self.boxes[child].passes_height);
                    own.sizes[if let ItemKind::Annotation(..) = inline.items[index].kind {
                        1
                    } else {
                        which
                    }]
                });
                if inline.has_ruby {
                    widen_bases(inline, &root, &mut widths, &mut Vec::new());
                }
                widths
            };
            let (widths, first_widths) = (
                widths_of(&inline),
                inline.first_line.as_ref().map(|it| widths_of(&it.0)),
            );
            inline.size_atomics(&root, &widths);
            let prose = inline
                .prose(&root)
                .filter(|_| matches!(root.text.indent.length, Lp::Px(0.0)));
            if let Some(widest) = prose.and_then(|it| it.widest_line([0.0, f32::INFINITY][which])) {
                return ceil_to_unit(widest);
            }
            advances.resize(inline.clusters.len(), 0.0);
            let sources = sources(&inline, &root, &widths, first_widths.as_deref());
            let (is_min_content, hyphen) = (which == 0, &|style: &Style| self.hyphen(style).1);
            let mut breaker = Breaker {
                sources,
                offset: 0.0,
                advances: &mut advances,
                is_min_content,
                hyphen,
                candidates: None,
            };
            let (mut widest, mut floats) = (0.0f32, [0.0f32; 2]);
            let limit = if is_min_content { 0.0 } else { f32::INFINITY };
            breaker.visit_lines(self.text_indents(id, 0.0), limit, |line| {
                for (item, width) in inline.items[..line.next.item]
                    .iter()
                    .zip(&widths)
                    .skip(line.start.item)
                {
                    if let ItemKind::Float(_) = item.kind {
                        let cleared = clears(&item.style);
                        widest = widest.max(if is_min_content {
                            *width
                        } else {
                            floats[0] + floats[1]
                        });
                        floats = [0, 1].map(|side| if cleared[side] { 0.0 } else { floats[side] });
                        floats[usize::from(item.style.floats_right())] += width.max(0.0);
                    }
                }
                widest = widest.max(
                    line.width
                        + if is_min_content {
                            0.0
                        } else {
                            floats[0] + floats[1]
                        },
                );
                floats = [0.0; 2];
            });
            ceil_to_unit(widest)
        });
        self.boxes[id].inline = Some(inline);
        Widths { sizes, uses_height }
    }

    fn lay_out_inline(
        &mut self,
        id: BoxId,
        inline: &mut Inline,
        input: &Input,
        floats: &mut Floats,
        owns_floats: bool,
        breaks: Option<&mut Breaks>,
    ) -> Output {
        let root = Rc::clone(&self.boxes[id].style);
        let (width, mut output) = (input.width, Output::default());
        let (basis, is_plain_flow) = (
            (width, input.basis.1),
            breaks.is_none() && !floats.are_in_the_way(),
        );
        let Lines {
            lines: mut old_lines,
            fragments: mut old_fragments,
            mut advances,
            ..
        } = core::mem::take(&mut inline.lines);
        old_lines.clear();
        old_fragments.clear();
        old_lines.reserve_exact(1 + inline.clusters.len() / 128);
        old_fragments.reserve_exact(inline.items.len() + inline.clusters.len() / 128);
        let mut embedded = Vec::new();
        let mut widths = Self::item_widths(inline, width, |index, child| {
            embedded.resize(inline.items.len(), Embedded::default());
            if let ItemKind::Annotation(..) = inline.items[index].kind {
                return self.contribution(child, None, None).sizes[1];
            }
            let own = self.lay_out_embedded(child, basis, &mut output);
            embedded[index] = own;
            own.margin[3] + own.size[0] + own.margin[1]
        });
        let mut first_widths = inline
            .first_line
            .as_ref()
            .map(|it| Self::item_widths(&it.0, width, |index, _| widths[index]));
        if inline.has_ruby {
            let mut columns = Vec::new();
            inline
                .first_line
                .iter()
                .zip(&mut first_widths)
                .for_each(|(it, widths)| widen_bases(&it.0, &it.1, widths, &mut Vec::new()));
            widen_bases(inline, &root, &mut widths, &mut columns);
            for (index, width) in columns {
                let ItemKind::Annotation(child, _) = inline.items[index].kind else {
                    continue;
                };
                let own = self.lay_out(
                    child,
                    Input {
                        width,
                        basis,
                        ..Input::default()
                    },
                    None,
                );
                self.absorb(child, &own, &mut output);
                let baseline = own.baselines[0].unwrap_or(own.height);
                let baseline = if self.boxes[id].mode.flips_lines() {
                    own.height - baseline
                } else {
                    baseline
                };
                embedded[index] = Embedded {
                    size: [width, own.height],
                    margin: [0.0; 4],
                    baseline,
                };
            }
        }
        inline.size_atomics(&root, &widths);
        let may_be_prose = (breaks.is_some() || !embedded.is_empty())
            && !floats.are_in_the_way()
            && self.has_plain_lines(id, input).is_some();
        advances.resize(
            if may_be_prose {
                0
            } else {
                inline.clusters.len()
            },
            0.0,
        );
        let sources = sources(inline, &root, &widths, first_widths.as_deref());
        output.uses_height |= inline.has_positioned_elements();

        let container = &self.boxes[self.boxes[id].parent];
        let indents = self.text_indents(id, width);
        let has_ellipsis = container.style.layout.text_overflow == TextOverflow::Ellipsis
            && container.overflow[0] != Overflow::Visible;
        let hyphen = |style: &Style| self.hyphen(style).1;
        macro_rules! breaker {
            ($advances:expr, $offset:expr) => {
                Breaker {
                    sources,
                    offset: $offset,
                    advances: $advances,
                    is_min_content: false,
                    hyphen: &hyphen,
                    candidates: None,
                }
            };
        }
        let mut narrowest = f32::INFINITY;
        let (is_plain, mut improved) = (wraps(&root) && !floats.are_in_the_way(), Vec::new());
        let bisects = root.text.wrap_style == TextWrapStyle::Balance
            && !(0..inline.clusters.len() as u32).any(|it| inline.is_newline(it));
        if is_plain
            && !bisects
            && matches!(
                root.text.wrap_style,
                TextWrapStyle::Balance | TextWrapStyle::Pretty
            )
        {
            improved = Breaker::improve(sources, &hyphen, &mut advances, indents, width);
        } else if is_plain && bisects {
            let mut count_at = |available| {
                let mut count = 0;
                breaker!(&mut advances, 0.0).visit_lines(indents, available, |_| count += 1);
                count
            };
            let count = count_at(width);
            if (2..=6).contains(&count) {
                let (mut low, mut high) = (width / count as f32 / 2.0, width);
                while high - low > (high * f32::EPSILON).max(1.0) {
                    let middle = (low + high) / 2.0;
                    if count_at(middle) > count {
                        low = middle
                    } else {
                        high = middle
                    }
                }
                narrowest = high;
            }
        }

        let mut placement = Placement {
            document: self,
            inline,
            root: &root,
            widths: &widths,
            embedded: &embedded,
            room_for_annotations: input.room_for_annotations,
            trim: input.trim,
            flips: container.mode.flips_lines(),
            has_quirks: self.environment.quirks != Quirks::None,
            is_list_item: container.style.display().is_list_item(),
            is_annotation: container.style.display() == Display::RubyText,
            size: basis,
            lines: Lines {
                lines: old_lines,
                fragments: old_fragments,
                advances,
                ..Lines::default()
            },
            out_of_flow: Vec::new(),
        };
        let mut float_positions: Vec<(usize, [f32; 2])> = Vec::new();
        let (mut flow, mut columns) = (
            breaks.map(|it| self.flow(id, input, Edges::default(), it)),
            Vec::new(),
        );
        let fragmented = flow
            .as_ref()
            .map_or(Vec::new(), |it| it.fragmented_floats());
        let place_float = |floats: &mut Floats,
                           float_positions: &mut Vec<(usize, [f32; 2])>,
                           index: usize,
                           y: f32| {
            let (it, style) = (&embedded[index], &inline.items[index].style);
            if let Some(letter) = style
                .rare
                .initial_letter
                .0
                .filter(|_| inline.items[index].node == 0)
            {
                let (metrics, line_height, is_left) = (
                    &root.metrics,
                    unit(root.line_height()),
                    !style.floats_right(),
                );
                let after_baseline = ((line_height - metrics.ascent - metrics.descent) / 2.0)
                    .ceil()
                    + metrics.descent;
                let baseline = y + line_height * letter.size.ceil() - after_baseline;
                let (slot, around) = (
                    floats.slot([0.0, width], y, 0.0),
                    self.boxes[inline.items[index].embedded()].layout,
                );
                let indent = if is_left { indents[0] } else { -indents[0] };
                let x = indent
                    + if is_left {
                        slot.x
                    } else {
                        slot.x + slot.width - widths[index]
                    };
                let descent = self.ink_descent(inline.items[index].embedded());
                let bottom = baseline
                    + descent
                    + around.padding.bottom
                    + around.border.bottom
                    + it.margin[2];
                floats.exclude(
                    is_left,
                    if is_left { x + widths[index] } else { x } - indent,
                    [y, bottom],
                );
                return float_positions.push((
                    index,
                    [x + it.margin[3], baseline - it.baseline + it.margin[0]],
                ));
            }
            let known = fragmented
                .iter()
                .rfind(|known| known.0 == inline.items[index].embedded());
            let (y, height) = known
                .map_or((y, it.margin[0] + it.size[1] + it.margin[2]), |known| {
                    (known.1 - it.margin[0], it.margin[0] + known.2)
                });
            let size = [widths[index], height];
            let at = floats.place(
                style,
                [0.0, width],
                y,
                size,
                self.float_area(
                    inline.items[index].embedded(),
                    Edges::new(it.margin),
                    size,
                    width,
                ),
            );
            float_positions.push((index, [at[0] + it.margin[3], at[1] + it.margin[0]]));
        };
        let strut = unit(root.line_height());
        let space_at =
            |floats: &Floats, y: f32, height: f32| floats.slot_for([0.0, width], y, height, true);
        let (mut at, mut y, mut next_float, mut indent) = (Cut::default(), 0.0, 0, indents[0]);
        if let Some((index, letter)) = inline.initial_letter() {
            place_float(floats, &mut float_positions, index, y);
            let sink = if letter.sink > 0 {
                letter.sink as f32
            } else {
                letter.size.floor()
            };
            (y, next_float) = (strut * (letter.size.ceil() - sink).max(0.0), index + 1);
        }
        let (mut needs_line, mut known_height, mut cleared) = (inline.force_line, 0.0, f32::MIN);
        let mut holds = [0.0f32, f32::INFINITY];
        let (mut improved, mut chosen) = (improved.into_iter().peekable(), Vec::new().into_iter());
        if may_be_prose
            && let Some((height, _)) =
                self.fill_lines(inline, &root, basis, false, &embedded, &mut placement.lines)
        {
            let (
                Lines {
                    lines, fragments, ..
                },
                mut by,
            ) = (&mut placement.lines, 0.0);
            if let Some(flow) = &mut flow {
                for line in lines {
                    let mut top = line.y + by;
                    while let Some(resumed) =
                        flow.break_before_line(id, &columns, [top, top + line.height], &root.text)
                    {
                        top = resumed;
                    }
                    columns.push(flow.column);
                    by = top - line.y;
                    (line.y, line.baseline) = (top, line.baseline + by);
                    fragments[line.fragments.start as usize..line.fragments.end as usize]
                        .iter_mut()
                        .for_each(|it| (it.y, it.baseline) = (it.y + by, it.baseline + by));
                }
            }
            (at.item, needs_line, y) = (inline.items.len(), false, height + by);
        } else if may_be_prose {
            placement.lines.lines.clear();
            placement.lines.fragments.clear();
            placement.lines.advances.resize(inline.clusters.len(), 0.0);
        }
        while at.item < inline.items.len() || needs_line {
            let was_needed = core::mem::take(&mut needs_line);
            let mut height = core::mem::take(&mut known_height);
            let mut slot = space_at(floats, y, height);
            let mut postponed = Vec::new();
            if let Some((_, widths)) = improved.next_if(|it| it.0 == at.cluster) {
                chosen = widths.into_iter();
            }
            let narrowest = chosen.next().unwrap_or(narrowest);
            let line = loop {
                let available = slot.width.min(narrowest);
                let line = breaker!(
                    &mut placement.lines.advances,
                    if root.is_rtl() {
                        width - slot.x - slot.width
                    } else {
                        slot.x
                    }
                )
                .next_line(at, indent, available, &mut |index, used| {
                    if index < next_float {
                        return None;
                    }
                    next_float = index + 1;
                    if !postponed.is_empty()
                        || used > indent && used + widths[index] > slot.width + TOLERANCE
                    {
                        postponed.push(index);
                        return None;
                    }
                    place_float(floats, &mut float_positions, index, slot.y);
                    slot = space_at(floats, slot.y, height);
                    Some(slot.width)
                });
                if next_float > line.next.item {
                    next_float = line.next.item;
                    postponed.retain(|it| *it < next_float);
                    while float_positions.pop_if(|it| it.0 >= next_float).is_some() {
                        floats.truncate(floats.len() - 1);
                    }
                    slot = space_at(floats, slot.y, height);
                }
                if let Some(next) = slot.next.filter(|_| {
                    line.width > slot.width.max(0.0) + TOLERANCE
                        && slot.width < width
                        && wraps(&root)
                }) {
                    height = 0.0;
                    slot = space_at(floats, next, height);
                    continue;
                }
                break line;
            };
            Source {
                inline: placement.inline,
                root: placement.root,
                widths: placement.widths,
            } = sources[usize::from(!at.is_start())];
            let (out_of_flow, state) = (
                placement.out_of_flow.len(),
                (placement.trim, placement.room_for_annotations),
            );
            holds = [
                holds[0].max(line.width),
                if line.is_forced { holds[1] } else { width },
            ];
            y = placement.place(&line, slot.y, [slot.x, slot.x + slot.width], indent);
            if y - slot.y > height
                && floats.len() > 0
                && space_at(floats, slot.y, y - slot.y).width < slot.width
            {
                let first = placement
                    .lines
                    .lines
                    .pop()
                    .map_or(0, |it| it.fragments.start);
                placement.lines.fragments.truncate(first as usize);
                placement.out_of_flow.truncate(out_of_flow);
                (placement.trim, placement.room_for_annotations) = state;
                (y, known_height, needs_line, next_float) = (
                    slot.y,
                    y - slot.y,
                    was_needed,
                    postponed.first().copied().unwrap_or(next_float),
                );
                continue;
            }
            if let (Some(flow), Some(last)) = (&mut flow, placement.lines.lines.last()) {
                if let Some(resumed) = flow
                    .break_before_line(id, &columns, [slot.y, y], &root.text)
                    .filter(|_| last.has_content)
                {
                    placement
                        .lines
                        .fragments
                        .truncate(last.fragments.start as usize);
                    placement.lines.lines.pop();
                    placement.out_of_flow.truncate(out_of_flow);
                    (y, needs_line, next_float) = (
                        resumed,
                        was_needed,
                        postponed.first().copied().unwrap_or(next_float),
                    );
                    continue;
                }
                columns.push(flow.column);
            }
            postponed
                .into_iter()
                .for_each(|index| place_float(floats, &mut float_positions, index, y));
            if let Some(last) = inline.items[line.start.item..line.end_item]
                .iter()
                .rfind(|it| !it.clusters.is_empty())
                && last.kind == ItemKind::Break
            {
                cleared = floats.clearance(clears(&last.style)).unwrap_or(cleared);
                y = y.max(cleared);
            }
            (at, indent) = (line.next, indents[2 - usize::from(line.is_forced)]);
        }
        if let Some(last) = placement.lines.lines.iter().rfind(|it| it.has_content) {
            let room = placement.room_for_annotations;
            if placement.trim[1] {
                y = (last.y + last.height - trimmed(self, &root, 1, placement.flips, last))
                    .max(cleared);
            } else if room < 0.0 && container.children.last() == Some(&id) {
                y -= (-room).min(container.layout.padding.bottom);
            }
            output.room_for_annotations = room.max(0.0);
        }
        let Placement {
            mut lines,
            out_of_flow,
            ..
        } = placement;

        let visible = || lines.lines.iter().filter(|line| line.has_content);
        output.intrinsic = if owns_floats {
            y.max(floats.clearance([true; 2]).unwrap_or(y))
        } else {
            y
        };
        output.height = input.height.unwrap_or(output.intrinsic);
        output.baselines = [visible().next(), visible().next_back()].map(|it| Some(it?.baseline));
        output.collapses_through = output.baselines[0].is_none() && y == 0.0;

        lines.bounds = Rect::new([if root.is_rtl() { width } else { 0.0 }, 0.0, 0.0, y]);
        let flips = self.boxes[id].mode.flips_lines();
        if flips {
            let baseline = |it: &Line| 2.0 * it.y + it.height - it.baseline;
            output.baselines = [visible().next(), visible().next_back()].map(|it| it.map(baseline));
            lines.bounds.y = output.height - y;
            for line in &mut lines.lines {
                let by = output.height - 2.0 * line.y - line.height;
                (line.y, line.baseline) = (line.y + by, line.baseline + by);
                for it in
                    &mut lines.fragments[line.fragments.start as usize..line.fragments.end as usize]
                {
                    (it.y, it.baseline) = (it.y + by, it.baseline + by);
                }
            }
        }
        lines.flow = lines.bounds;
        let on_lines = lines
            .lines
            .iter()
            .flat_map(|line| line.fragments.clone().map(move |it| (line, it as usize)));
        for (line, fragment) in on_lines.map(|(line, index)| (line, &lines.fragments[index])) {
            let mut rect = fragment.rect();
            if fragment.layer == 0 {
                let beyond = if line.rtl {
                    line.end - rect.x
                } else {
                    rect.right() - line.end
                }
                .min(rect.width)
                .max(0.0);
                rect = rect.shrunk(if line.rtl {
                    [0.0, 0.0, 0.0, beyond]
                } else {
                    [0.0, beyond, 0.0, 0.0]
                });
            }
            if let FragmentKind::Atomic(child) = fragment.kind {
                let margin = Edges::new(embedded[fragment.item as usize].margin);
                let offset =
                    relative_offset(&inline.items[fragment.item as usize].style, width, basis.1);
                match (flips, [fragment.x - offset[0], fragment.y - offset[1]]) {
                    (true, [x, y]) => self.place_child(
                        child,
                        [x, output.height - y - fragment.height],
                        Edges {
                            top: margin.bottom,
                            bottom: margin.top,
                            ..margin
                        },
                        basis,
                    ),
                    (false, at) => self.place_child(child, at, margin, basis),
                }
                rect = fragment
                    .rect()
                    .moved(offset.map(|it| -it))
                    .shrunk(margin.to_array().map(|it| -it.max(0.0)));
            }
            if fragment.height > 0.0 {
                lines.bounds = lines.bounds.union(&rect);
            }
            lines.flow = Rect::from_edges(
                lines.flow.x.min(rect.x),
                lines.flow.y,
                lines.flow.right().max(rect.right()),
                lines.flow.bottom(),
            );
        }
        for (index, at) in float_positions {
            if let ItemKind::Float(child) = inline.items[index].kind {
                flow.iter_mut()
                    .for_each(|flow| self.fragment_float_in_lines(child, basis, flow, at[1]));
                self.place_child(child, at, Edges::new(embedded[index].margin), basis);
                flow.iter_mut()
                    .for_each(|it| it.shift(child, self.boxes[child].layout.location.y - at[1]));
            }
        }
        for (index, [x, y], edges) in out_of_flow {
            if let ItemKind::OutOfFlow(child) = inline.items[index].kind {
                let it = &mut self.boxes[child];
                it.static_position = [(x, edges[0]), (y, edges[1])];
                output.escapes |= it.out_of_flow();
                flow.iter_mut()
                    .for_each(|it| it.note_static_position_at(child, y));
            }
        }
        if let Some(mut flow) = flow {
            flow.extend_to(output.intrinsic);
            flow.finish_lines(id, columns, &root.text, &mut output);
        }
        if has_ellipsis {
            for index in 0..lines.lines.len() {
                let style = inline
                    .first_line
                    .as_ref()
                    .filter(|_| index == 0)
                    .map_or(&root, |it| &it.1);
                lines.lines[index].overflow =
                    self.truncate(&lines, &inline.clusters, &lines.lines[index], style, false);
            }
        }
        if let (Some(first_line), Some(line)) = (&mut inline.first_line, lines.lines.first()) {
            first_line.0.lines.fragments = lines.fragments_of(line).into();
            first_line.0.lines.advances = lines.advances[..line.clusters.end as usize].to_vec();
        }
        output.last_baseline = output.baselines[1];
        let is_fixed = |it: &Item| match it.kind {
            ItemKind::Text | ItemKind::Break => {
                !wraps(&it.style) || !it.style.text.collapse.preserves_spaces()
            }
            ItemKind::Open(_) | ItemKind::Close(_) => {
                !it.style.is_positioned()
                    && it
                        .style
                        .fixed()
                        .traits
                        .contains(Traits::HAS_FIXED_PADDING | Traits::HAS_FIXED_MARGIN)
            }
            _ => false,
        };
        let starts_left = matches!(root.text.align, TextAlign::Start | TextAlign::Left)
            && root.text.align_last == TextAlignLast::Auto
            && !root.is_rtl()
            && !inline.has_bidi;
        let is_simple = is_plain_flow
            && !self.boxes.has_annotations
            && !has_ellipsis
            && !flips
            && inline.first_line.is_none()
            && indents == [0.0; 3]
            && matches!(root.text.indent.length, Lp::Px(_));
        let is_greedy = matches!(
            root.text.wrap_style,
            TextWrapStyle::Auto | TextWrapStyle::Stable
        ) && inline.text.is_ascii();
        lines.holds = (starts_left
            && is_simple
            && holds[0] <= width
            && is_greedy
            && inline.items.iter().all(is_fixed))
        .then_some(holds);
        inline.lines = lines;
        output
    }

    /// Lays out the boxes whose containing blocks are inline elements.
    pub(crate) fn claim_by_inline_elements(
        &mut self,
        id: BoxId,
        output: &mut Output,
        mut breaks: Option<&mut Breaks>,
    ) {
        let Some(inline) = self.boxes[id]
            .inline
            .take_if(|_| !output.escapes.is_empty())
        else {
            return;
        };
        let (mut escapes, lines, flips) = (
            Claims::empty(),
            &inline.lines,
            self.boxes[id].mode.flips_lines(),
        );
        let is_among_blocks = self.boxes[self.boxes[id].parent].splits_layers;
        for item in &inline.items {
            let (mut wanted, child) = match item.kind {
                ItemKind::OutOfFlow(child) => (self.boxes[child].out_of_flow(), child),
                ItemKind::Atomic(child)
                | ItemKind::Float(child)
                | ItemKind::Annotation(child, _) => (self.boxes[child].cache.escapes(), child),
                _ => continue,
            };
            let (mut key, mut claimed) = (item.parent, Claims::empty());
            while key != 0 && !wanted.is_empty() {
                let around = &inline.items[key as usize - 1];
                if is_among_blocks && self.boxes.split.contains(&around.node) {
                    break;
                }
                let claims = crate::layout::claims(&around.style, true) - claimed;
                let mut own = lines
                    .fragments
                    .iter()
                    .filter(|it| it.item == key - 1 && matches!(it.kind, FragmentKind::Box(..)));
                if claims.intersects(wanted)
                    && let Some(first) = own.next()
                {
                    let (last, rtl) = (own.next_back().unwrap_or(first), around.style.is_rtl());
                    let [top, right, bottom, left] = around.style.border();
                    let [start, end] = match rtl {
                        true => [
                            (last.x + left).min(first.x + first.width - right),
                            first.x + first.width - right,
                        ],
                        false => [
                            first.x + left,
                            (last.x + last.width - right).max(first.x + left),
                        ],
                    };
                    let [near, far] = match flips {
                        true => [first.y + first.height - bottom, last.y + top]
                            .map(|it| output.height - it),
                        false => [first.y + top, last.y + last.height - bottom],
                    };
                    let area = Rect::from_edges(start, near, end, far);
                    wanted = (wanted - claims)
                        | self.lay_out_positioned_in_inline(
                            id,
                            child,
                            claims,
                            area,
                            rtl,
                            breaks.as_deref_mut(),
                        );
                    claimed |= claims;
                }
                key = around.parent;
            }
            self.boxes[child].claimed_by_inline = claimed;
            escapes |= wanted;
        }
        (output.escapes, self.boxes[id].inline) = (escapes, Some(inline));
    }

    /// The inline elements with blocks inside that `child`, or else the lines that it is in, is in. Innermost first.
    pub(crate) fn split_elements_around(
        &self,
        child: BoxId,
        block: BoxId,
    ) -> impl Iterator<Item = (NodeId, &Rc<Style>)> {
        let around = self
            .tree
            .flat_ancestors(self.boxes[child].node)
            .take_while(move |it| *it != self.boxes[block].node && self.own_box(*it).is_none());
        around
            .filter(|it| self.boxes.split.contains(it))
            .filter_map(|it| Some((it, self.tree.style(it)?)))
    }

    /// Likewise, for the children of a block.
    pub(crate) fn claim_by_split_elements(
        &mut self,
        id: BoxId,
        output: &mut Output,
        mut breaks: Option<&mut Breaks>,
    ) {
        let inside = |child: &BoxId| {
            if self.boxes[*child].kind == Kind::Lines {
                self.boxes[*child].children.clone()
            } else {
                smallvec![*child]
            }
        };
        let (mode, size, mut escapes) = (
            self.boxes[id].turned,
            self.boxes[id].size(),
            Claims::empty(),
        );
        for child in self.boxes[id]
            .children
            .iter()
            .flat_map(inside)
            .collect::<Vec<_>>()
        {
            let it = &self.boxes[child];
            let mut claimed = if it.parent == id {
                Claims::empty()
            } else {
                it.claimed_by_inline
            };
            let mut wanted = (if it.style.is_out_of_flow() {
                it.out_of_flow()
            } else {
                it.cache.escapes()
            }) - claimed;
            let elements: Vec<_> = self
                .split_elements_around(child, id)
                .map(|it| (it.0, Rc::clone(it.1)))
                .collect();
            for (node, style) in elements {
                let claims = crate::layout::claims(&style, true) - claimed;
                if !claims.intersects(wanted) {
                    continue;
                }
                let turned = invert(&mode.to_physical(size)).unwrap_or(IDENTITY);
                let own = self.lines_with(node).flat_map(|(lines, inline)| {
                    let is_own = move |it: &&Fragment| {
                        inline.items[it.item as usize].node == node
                            && matches!(it.kind, FragmentKind::Box(..))
                    };
                    inline
                        .lines
                        .fragments
                        .iter()
                        .filter(is_own)
                        .map(move |it| (lines, it.rect()))
                });
                let placed = |(lines, rect): (BoxId, Rect)| {
                    let at = self.boxes[lines].layout.location;
                    self.from_lines(lines, rect)
                        .moved([at.x, at.y])
                        .transformed(&turned)
                };
                let rects: Vec<_> = own.map(placed).collect();
                let (Some(first), Some(last), rtl) = (rects.first(), rects.last(), style.is_rtl())
                else {
                    continue;
                };
                let [top, right, bottom, left] = mode.turn_sides(&style.border());
                let [start, end] = match rtl {
                    true => [
                        (last.x + left).min(first.right() - right),
                        first.right() - right,
                    ],
                    false => [first.x + left, (last.right() - right).max(first.x + left)],
                };
                let area = Rect::from_edges(
                    start,
                    first.y + top,
                    end,
                    (last.bottom() - bottom).max(first.y + top),
                );
                wanted = (wanted - claims)
                    | self.lay_out_positioned_in_inline(
                        id,
                        child,
                        claims,
                        area,
                        rtl,
                        breaks.as_deref_mut(),
                    );
                claimed |= claims;
            }
            self.boxes[child].claimed_by_inline = claimed;
            escapes |= wanted;
        }
        output.escapes = escapes;
    }
}

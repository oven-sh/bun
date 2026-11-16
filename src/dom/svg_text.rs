//! https://svgwg.org/svg2-draft/text.html#TextLayoutAlgorithm

use core::f32::consts::FRAC_PI_2;
use core::ops::Range;
use std::rc::Rc;

use crate::abi::{self, Matrix, Rect, TextRun};
use crate::document::Document;
use crate::geometry::translation;
use crate::name::{Name, is_name, name};
use crate::path::{Numbers, Path, Piece, at_distance};
use crate::platform::Shaped;
use crate::svg::{Node, href, passes_tests, rotation, scaling, unite};
use crate::svg_values::*;
use crate::tree::{Namespace, NodeId};
use crate::types::*;

/// A text content element.
pub(crate) struct Run<'a> {
    pub(crate) node: Node<'a>,
    pub(crate) parent: Option<usize>,
    characters: Range<usize>,
    /// By how much the baseline is raised.
    shift: f32,
    pub(crate) ascent: f32,
    pub(crate) descent: f32,
    path: Option<usize>,
}

#[derive(Default)]
struct Character {
    byte: usize,
    run: usize,
    at: [Option<f32>; 2],
    delta: [f32; 2],
    degrees: Option<f32>,
    /// In UTF-16.
    length: u8,
}

/// A typographic character.
pub(crate) struct Placed {
    pub(crate) cluster: usize,
    pub(crate) run: usize,
    characters: Range<usize>,
    /// Of the side where it starts if it is left-to-right.
    pub(crate) at: [f32; 2],
    pub(crate) radians: f32,
    pub(crate) advance: f32,
    pub(crate) stretch: f32,
    pub(crate) is_hidden: bool,
    pub(crate) is_upright: bool,
    is_rtl: bool,
    starts_chunk: bool,
}

struct TextPath {
    pieces: Vec<Piece>,
    length: f32,
    offset: f32,
}

#[derive(Default)]
pub(crate) struct TextLayout<'a> {
    pub(crate) runs: Vec<Run<'a>>,
    pub(crate) placed: Vec<Placed>,
    pub(crate) shaped: Rc<Shaped>,
    /// What the font sizes are multiplied with in `shaped`.
    pub(crate) scale: f32,
    characters: Vec<Character>,
    is_vertical: bool,
}

#[derive(Default)]
struct Collector<'a> {
    text: String,
    text_runs: Vec<TextRun>,
    paths: Vec<Option<TextPath>>,
    is_after_space: bool,
    layout: TextLayout<'a>,
}

impl<'a> TextLayout<'a> {
    /// From a space with the origin on the baseline, in which the text goes to the right.
    pub(crate) fn matrix(&self, it: &Placed) -> Matrix {
        let turn = rotation(it.radians + if self.is_vertical { FRAC_PI_2 } else { 0.0 });
        let placed = multiply(
            &multiply(&translation(it.at), &turn),
            &translation([0.0, -self.runs[it.run].shift]),
        );
        multiply(&placed, &scaling(it.stretch, 1.0))
    }

    fn extent(&self, it: &Placed) -> Rect {
        let run = &self.runs[it.run];
        Rect::new([
            0.0,
            -run.ascent,
            it.advance / it.stretch,
            run.ascent + run.descent,
        ])
    }

    pub(crate) fn around(&self, run: usize) -> impl Iterator<Item = &Run<'a>> {
        core::iter::successors(Some(&self.runs[run]), |it| Some(&self.runs[it.parent?]))
    }

    fn within(&self, id: NodeId) -> impl Iterator<Item = &Placed> {
        self.placed
            .iter()
            .filter(move |it| self.around(it.run).any(|it| it.node.id == id))
    }

    pub(crate) fn bounds(&self, id: NodeId) -> Option<Rect> {
        self.within(id)
            .filter(|it| !it.is_hidden)
            .map(|it| self.extent(it).transformed(&self.matrix(it)))
            .reduce(unite)
    }

    fn placed_in(&self, characters: &Range<usize>) -> Range<usize> {
        let first = |character: usize| {
            self.placed
                .partition_point(|it| it.characters.start < character)
        };
        first(characters.start)..first(characters.end)
    }

    fn apply_text_length(&mut self, document: &Document, index: usize) {
        let (run, axis) = (&self.runs[index], usize::from(self.is_vertical));
        let Some(wanted) = document
            .svg_length(&run.node, name!("textLength"), axis)
            .filter(|it| *it >= 0.0)
        else {
            return;
        };
        let range = self.placed_in(&run.characters);
        let own = &self.placed[range.clone()];
        let start = own.iter().map(|it| it.at[axis]).fold(f32::MAX, f32::min);
        let length = own
            .iter()
            .map(|it| it.at[axis] + it.advance)
            .fold(f32::MIN, f32::max)
            - start;
        if own.is_empty() || length <= 0.0 {
            return;
        }
        let stretches = document
            .tree
            .element(run.node.id)
            .and_then(|it| it.attribute(name!("lengthAdjust")))
            == Some("spacingAndGlyphs");
        let has_length = |it: &&Run| {
            it.node.id != run.node.id
                && document
                    .tree
                    .element(it.node.id)
                    .is_some_and(|it| it.has(name!("textLength")))
        };
        let unit = |it: &Placed| {
            self.around(it.run)
                .take_while(|it| it.node.id != run.node.id)
                .filter(has_length)
                .last()
                .map(|it| it.node.id)
        };
        let mut order: Vec<_> = range
            .clone()
            .map(|it| (it, unit(&self.placed[it])))
            .collect();
        order.sort_by(|a, b| self.placed[a.0].at[axis].total_cmp(&self.placed[b.0].at[axis]));
        let gaps = order
            .iter()
            .zip(&order[1..])
            .filter(|(a, b)| a.1.is_none() || a.1 != b.1)
            .count();
        let (step, mut shift, mut previous) = ((wanted - length) / (gaps + 1) as f32, 0.0, None);
        for (index, unit) in order {
            let it = &mut self.placed[index];
            if stretches {
                it.at[axis] = start + (it.at[axis] - start) * wanted / length;
                (it.advance, it.stretch) =
                    (it.advance * wanted / length, it.stretch * wanted / length);
                continue;
            }
            shift += if previous.is_some_and(|it: Option<NodeId>| it.is_none() || it != unit) {
                step
            } else {
                0.0
            };
            it.at[axis] += shift;
            previous = Some(unit);
        }
        let end = start + length;
        let later = self
            .placed
            .iter_mut()
            .enumerate()
            .filter(|it| !range.contains(&it.0) && it.1.at[axis] >= end - 1e-3);
        later.for_each(|it| it.1.at[axis] += wanted - length);
    }

    fn position(&mut self, document: &Document, paths: &[Option<TextPath>], is_rtl: bool) {
        let (axis, mut shift) = (usize::from(self.is_vertical), [0.0; 2]);
        let path_of = |runs: &[Run], it: &Placed| runs[it.run].path;
        let mut previous = None;
        for it in &mut self.placed {
            let (path, delta) = (
                path_of(&self.runs, it),
                self.characters[it.characters.start].delta,
            );
            if path.is_some() && path != previous {
                shift = [0.0; 2];
            }
            shift = [shift[0] + delta[0], shift[1] + delta[1]];
            it.at = [it.at[0] + shift[0], it.at[1] + shift[1]];
            previous = path;
        }
        (0..self.runs.len())
            .rev()
            .for_each(|index| self.apply_text_length(document, index));
        (shift, previous) = ([0.0; 2], None);
        for (index, it) in self.placed.iter_mut().enumerate() {
            let (path, character) = (
                path_of(&self.runs, it),
                &self.characters[it.characters.start],
            );
            let (mut at, is_first) = (
                character.at,
                index == 0 || path.is_some() && path != previous,
            );
            if path.is_some() {
                at[1 - axis] = (path != previous).then_some(0.0);
            }
            if is_first {
                at = at.map(|it| it.or(Some(0.0)));
            }
            it.starts_chunk = is_first
                || path != previous
                || character.at[axis].is_some()
                || path.is_none() && character.at[1 - axis].is_some();
            for side in 0..2 {
                let edge = it.at[side]
                    + if side == axis && is_rtl {
                        it.advance
                    } else {
                        0.0
                    };
                shift[side] = at[side].map_or(shift[side], |at| at + character.delta[side] - edge);
                it.at[side] += shift[side];
            }
            previous = path;
        }
        for chunk in self.placed.chunk_by_mut(|_, next| !next.starts_chunk) {
            let low = chunk.iter().map(|it| it.at[axis]).fold(f32::MAX, f32::min);
            let high = chunk
                .iter()
                .map(|it| it.at[axis] + it.advance)
                .fold(f32::MIN, f32::max);
            let start = chunk[0].at[axis] + if is_rtl { chunk[0].advance } else { 0.0 };
            let style = &self.runs[chunk[0].run].node.style;
            let edge = match (style.svg.text_anchor, style.is_rtl()) {
                (TextAnchor::Middle, _) => (low + high) / 2.0,
                (TextAnchor::Start, false) | (TextAnchor::End, true) => low,
                _ => high,
            };
            chunk.iter_mut().for_each(|it| it.at[axis] += start - edge);
        }
        let (mut end, mut after): (Option<[f32; 2]>, [Option<f32>; 2]) = (None, [None; 2]);
        for it in &mut self.placed {
            let Some(path) = path_of(&self.runs, it) else {
                if let Some(end) = end.take() {
                    after = [0, 1].map(|side| {
                        Some(
                            end[side] - it.at[side]
                                + self.characters[it.characters.start].delta[side],
                        )
                    });
                }
                for side in 0..2 {
                    after[side] = after[side]
                        .filter(|_| self.characters[it.characters.start].at[side].is_none());
                    it.at[side] += after[side].unwrap_or(0.0);
                }
                continue;
            };
            let Some(path) = &paths[path] else {
                it.is_hidden = true;
                continue;
            };
            let middle = it.at[axis] + it.advance / 2.0 + path.offset;
            it.is_hidden = !(0.0..=path.length).contains(&middle);
            let Some((point, radians)) = at_distance(&path.pieces, middle) else {
                continue;
            };
            let across = if self.is_vertical {
                -it.at[0]
            } else {
                it.at[1]
            };
            it.at = apply(
                &multiply(&translation(point), &rotation(radians)),
                [-it.advance / 2.0, across],
            );
            it.radians += radians - if self.is_vertical { FRAC_PI_2 } else { 0.0 };
            end = path.pieces.last().map(|it| it.to);
        }
    }
}

impl Document {
    fn text_path(&self, node: &Node) -> Option<TextPath> {
        let element = node.element;
        let (scale, path) = match element
            .attribute(name!("path"))
            .map(Path::parse)
            .filter(|it| !it.verbs.is_empty())
        {
            Some(path) => (1.0, path),
            None => {
                let target = href(element)
                    .filter(|it| self.fragment_of(it).is_some())
                    .and_then(|it| self.svg_reference(node.id, it))?;
                let path = self
                    .svg_path(&target)
                    .filter(|_| target.tag == name!("path"))?;
                (
                    self.path_scale(target.id, &path),
                    path.transformed(&self.svg_transform(&target)),
                )
            }
        };
        let mut pieces = path.pieces();
        if element.attribute(name!("side")) == Some("right") {
            pieces = pieces
                .into_iter()
                .rev()
                .map(|it| Piece {
                    from: it.to,
                    to: it.from,
                })
                .collect();
        }
        let (length, offset) = (
            path.length(),
            element
                .attribute(name!("startOffset"))
                .and_then(|it| self.parse_svg_length(node, it)),
        );
        let offset = offset.map_or(0.0, |it| {
            it.resolve(0.0) / node.style.zoom * scale + it.resolve(length) - it.resolve(0.0)
        });
        Some(TextPath {
            pieces,
            length,
            offset,
        })
    }

    fn collect_text<'a>(&'a self, node: &Node<'a>, parent: Option<usize>, to: &mut Collector<'a>) {
        let (style, id, scale) = (
            Rc::clone(&node.style),
            node.id,
            to.layout.scale / node.style.zoom,
        );
        let metrics = self.fonts.metrics(style.font_id, style.font.size.0 * scale);
        let [ascent, descent, x_height] =
            [metrics.ascent, metrics.descent, metrics.x_height].map(|it| it / to.layout.scale);
        let (size, above) = (
            style.font.size.0 / style.zoom,
            parent.map(|it| &to.layout.runs[it]),
        );
        let raised = match &style.shape.baseline_shift {
            BaselineShift::Sub => -(ascent + descent) / 2.0,
            BaselineShift::Super => (ascent + descent) / 2.0,
            BaselineShift::Length(length) => length.resolve(size * style.zoom) / style.zoom,
        };
        let baseline =
            |style: &crate::properties::Style, ascent: f32, descent: f32, x_height: f32| {
                use DominantBaseline as D;
                match style.svg.dominant_baseline {
                    D::Auto if to.layout.is_vertical && style.has_central_baseline() => {
                        (ascent - descent) / 2.0
                    }
                    D::Central => (ascent - descent) / 2.0,
                    D::Middle => x_height / 2.0,
                    D::Mathematical => ascent * 0.5,
                    D::Hanging => ascent * 0.8,
                    D::TextBeforeEdge => ascent,
                    D::TextAfterEdge | D::Ideographic => -descent,
                    _ => 0.0,
                }
            };
        let aligned = match style.shape.alignment_baseline {
            _ if parent.is_none() => None,
            AlignmentBaseline::Auto | AlignmentBaseline::Baseline => None,
            AlignmentBaseline::Alphabetic => Some(0.0),
            AlignmentBaseline::Middle => Some(x_height / 2.0),
            AlignmentBaseline::Central => Some((ascent - descent) / 2.0),
            AlignmentBaseline::Mathematical => Some(ascent * 0.5),
            AlignmentBaseline::Hanging => Some(ascent * 0.8),
            AlignmentBaseline::BeforeEdge | AlignmentBaseline::TextBeforeEdge => Some(ascent),
            _ => Some(-descent),
        };
        let inherited = above.map_or(0.0, |it| {
            it.shift + baseline(&it.node.style, it.ascent, it.descent, x_height)
        });
        let shift = inherited + if parent.is_some() { raised } else { 0.0 }
            - aligned.unwrap_or_else(|| baseline(&style, ascent, descent, x_height));
        let mut path = above.and_then(|it| it.path);
        if node.tag == name!("textPath") {
            path = Some(to.paths.len());
            to.paths.push(self.text_path(node));
        }
        let (index, first) = (to.layout.runs.len(), to.layout.characters.len());
        to.layout.runs.push(Run {
            node: node.clone(),
            parent,
            characters: first..first,
            shift,
            ascent,
            descent,
            path,
        });
        let (open, close) = crate::inline::bidi_controls(&style);
        to.text.push_str(open);
        for child in self.tree.children(id) {
            let Some(text) = self.tree[child].text() else {
                let is_content = |it: &&crate::tree::Element| {
                    it.namespace == Namespace::Svg
                        && (is_name!(it.tag, "tspan" | "a")
                            || it.tag == name!("textPath") && path.is_none())
                        && passes_tests(it)
                };
                if let Some(child) = self
                    .tree
                    .element(child)
                    .filter(is_content)
                    .and_then(|_| self.svg_child(node, child, node.viewport))
                {
                    self.collect_text(&child, Some(index), to);
                }
                continue;
            };
            let keeps_spaces = style.text.collapse.preserves_spaces();
            for character in crate::values::text(text).chars() {
                let is_space = matches!(character, ' ' | '\t' | '\n' | '\r');
                if is_space && !keeps_spaces && to.is_after_space {
                    continue;
                }
                to.is_after_space = is_space && !keeps_spaces;
                let length = character.len_utf16() as u8;
                to.layout.characters.push(Character {
                    byte: to.text.len(),
                    run: index,
                    length,
                    ..Character::default()
                });
                match style.text.transform {
                    _ if is_space => to.text.push(' '),
                    TextTransform::Uppercase => to.text.extend(character.to_uppercase()),
                    TextTransform::Lowercase => to.text.extend(character.to_lowercase()),
                    _ => to.text.push(character),
                }
            }
            let run = crate::inline::text_run(&style, to.text.len());
            let [size, letter_spacing, word_spacing] =
                [run.size, run.letter_spacing, run.word_spacing].map(|it| it * scale);
            let word_break = run.word_break
                | if style.has_central_baseline() {
                    abi::RUN_VERTICAL
                } else {
                    0
                };
            to.text_runs.push(TextRun {
                size,
                letter_spacing,
                word_spacing,
                word_break,
                ..run
            });
        }
        to.text.push_str(close);
        to.layout.runs[index].characters.end = to.layout.characters.len();
    }

    fn apply_positions(&self, layout: &mut TextLayout) {
        for run in layout
            .runs
            .iter()
            .filter(|it| is_name!(it.node.tag, "text" | "tspan"))
        {
            let Some(element) = self.tree.element(run.node.id) else {
                continue;
            };
            let list = |name: Name, axis: usize| -> Vec<f32> {
                let values = bun_core::strings::tokenize_any(
                    element.attribute(name).unwrap_or_default().as_bytes(),
                    b", \t\r\n",
                );
                let lengths = values.map(|it| {
                    Some(run.node.resolve(
                        &self.parse_svg_length(&run.node, crate::values::text(it))?,
                        axis,
                    ))
                });
                lengths.collect::<Option<_>>().unwrap_or_default()
            };
            let own = &mut layout.characters[run.characters.clone()];
            for (axis, at, delta) in [(0, name!("x"), name!("dx")), (1, name!("y"), name!("dy"))] {
                own.iter_mut()
                    .zip(list(at, axis))
                    .for_each(|(it, value)| it.at[axis] = Some(value));
                own.iter_mut()
                    .zip(list(delta, axis))
                    .for_each(|(it, value)| it.delta[axis] = value);
            }
            let degrees = element
                .attribute(name!("rotate"))
                .and_then(Numbers::all)
                .unwrap_or_default();
            if let Some(last) = degrees.last() {
                own.iter_mut()
                    .zip(degrees.iter().chain(core::iter::repeat(last)))
                    .for_each(|(it, value)| it.degrees = Some(*value));
            }
        }
    }

    /// `scale` is how large a user unit is on the screen.
    pub(crate) fn lay_out_svg_text<'a>(&'a self, text: &Node<'a>, scale: f32) -> TextLayout<'a> {
        let is_precise = text.style.svg.text_rendering == TextRendering::GeometricPrecision;
        let mut to = Collector {
            is_after_space: true,
            ..Collector::default()
        };
        to.layout.scale = if is_precise || !scale.is_normal() {
            1.0
        } else {
            scale
        };
        to.layout.is_vertical = text.style.text.writing_mode.is_vertical();
        self.collect_text(text, None, &mut to);
        let Collector {
            text: mut source,
            mut text_runs,
            paths,
            mut layout,
            is_after_space,
        } = to;
        if let Some(space) = layout.characters.pop_if(|_| is_after_space) {
            source.remove(space.byte);
            text_runs
                .iter_mut()
                .filter(|it| it.end as usize > space.byte)
                .for_each(|it| it.end -= 1);
            let count = layout.characters.len();
            layout.runs.iter_mut().for_each(|it| {
                it.characters = it.characters.start.min(count)..it.characters.end.min(count)
            });
        }
        let Some(last) = text_runs
            .last_mut()
            .filter(|_| !layout.characters.is_empty())
        else {
            return layout;
        };
        last.end = source.len() as u32;
        text_runs.dedup_by_key(|it| it.end);
        self.apply_positions(&mut layout);
        let is_rtl = text.style.is_rtl();
        layout.shaped = self.shape(
            &source,
            &text_runs,
            if is_rtl {
                abi::DIRECTION_RTL
            } else {
                abi::DIRECTION_LTR
            },
        );
        let (clusters, mut next) = (&layout.shaped.clusters, 0);
        for (index, cluster) in clusters.iter().enumerate() {
            let end = clusters
                .get(index + 1)
                .map_or(source.len(), |it| it.start as usize);
            let characters = next..next
                + layout.characters[next..]
                    .iter()
                    .take_while(|it| it.byte < end)
                    .count();
            next = characters.end;
            let Some(first) = layout
                .characters
                .get(characters.start)
                .filter(|_| !characters.is_empty())
            else {
                continue;
            };
            let (run, mut advance) = (&layout.runs[first.run], cluster.advance / layout.scale);
            let is_upright = layout.is_vertical
                && run.node.style.has_central_baseline()
                && (run.node.style.text.orientation == TextOrientation::Upright
                    || source[first.byte..]
                        .chars()
                        .next()
                        .is_some_and(crate::characters::is_upright));
            if is_upright && advance > 0.0 {
                advance = run.ascent
                    + run.descent
                    + run.node.style.letter_spacing() / run.node.style.zoom;
            }
            let has_glyphs = cluster.glyphs.start < cluster.glyphs.end
                || cluster.flags != 0
                || cluster.advance == 0.0;
            match layout
                .placed
                .last_mut()
                .filter(|it| !has_glyphs && it.run == first.run && !layout.shaped.glyphs.is_empty())
            {
                Some(ligature) => {
                    (ligature.advance, ligature.characters.end) =
                        (ligature.advance + advance, characters.end)
                }
                None => layout.placed.push(Placed {
                    cluster: index,
                    run: first.run,
                    at: [0.0; 2],
                    radians: first.degrees.unwrap_or(0.0).to_radians(),
                    advance,
                    stretch: 1.0,
                    is_hidden: false,
                    is_upright,
                    is_rtl: cluster.bidi_level % 2 == 1,
                    starts_chunk: false,
                    characters,
                }),
            }
        }
        let level = |it: usize| clusters[layout.placed[it].cluster].bidi_level;
        let mut order: Vec<_> = (0..layout.placed.len()).collect();
        for at_least in (1..=order.iter().map(|it| level(*it)).max().unwrap_or(0)).rev() {
            order
                .chunk_by_mut(|a, b| (level(*a) >= at_least) == (level(*b) >= at_least))
                .filter(|it| level(it[0]) >= at_least)
                .for_each(<[_]>::reverse);
        }
        let mut pen = 0.0;
        for index in order {
            layout.placed[index].at[usize::from(layout.is_vertical)] = pen;
            pen += layout.placed[index].advance;
        }
        layout.position(self, &paths, is_rtl);
        layout
    }

    pub(crate) fn screen_scale(&self, matrix: &Matrix) -> f32 {
        (matrix[..4].iter().map(|it| it * it).sum::<f32>() / 2.0).sqrt() * self.environment.scale
    }

    fn text_layout_of<'a>(&'a self, node: &Node<'a>) -> Option<TextLayout<'a>> {
        let is_text = |it: &NodeId| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.tag == name!("text"))
        };
        let text = if node.tag == name!("text") {
            node.clone()
        } else {
            self.svg_node(self.tree.flat_ancestors(node.id).find(is_text)?)?
        };
        Some(self.lay_out_svg_text(&text, self.screen_scale(&self.svg_matrix(text.id))))
    }

    pub(crate) fn svg_text_bounds<'a>(&'a self, node: &Node<'a>) -> Option<Rect> {
        self.text_layout_of(node)?.bounds(node.id)
    }

    pub(crate) fn svg_text_at<'a>(&'a self, node: &Node<'a>, point: [f32; 2]) -> Option<NodeId> {
        use PointerEvents as P;
        let layout = self.text_layout_of(node)?;
        let hit = layout
            .placed
            .iter()
            .rev()
            .filter(|it| !it.is_hidden)
            .find(|it| {
                let style = &layout.runs[it.run].node.style;
                let (events, svg) = (style.ink.pointer_events, &style.svg);
                let needs_visibility = matches!(
                    events,
                    P::Auto | P::VisiblePainted | P::VisibleFill | P::VisibleStroke | P::Visible
                );
                let needs_paint = matches!(events, P::Auto | P::VisiblePainted | P::Painted);
                events != P::None
                    && (style.is_visible() || !needs_visibility)
                    && !(needs_paint && svg.fill == SvgPaint::None && svg.stroke == SvgPaint::None)
                    && invert(&layout.matrix(it))
                        .is_some_and(|inverse| layout.extent(it).contains(apply(&inverse, point)))
            });
        hit.map(|it| layout.runs[it.run].node.id)
    }

    /// For each UTF-16 code unit: the start, the end, the extent, the rotation in degrees, and the advance.
    pub(crate) fn svg_characters(&self, id: NodeId) -> Vec<f32> {
        let Some(layout) = self.svg_node(id).and_then(|it| self.text_layout_of(&it)) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for it in layout.within(id) {
            let (matrix, extent) = (layout.matrix(it), layout.extent(it));
            let [near, far] = if it.is_rtl {
                [extent.width, 0.0]
            } else {
                [0.0, extent.width]
            };
            let units: usize = layout.characters[it.characters.clone()]
                .iter()
                .map(|it| usize::from(it.length))
                .sum();
            for unit in 0..units {
                out.extend(
                    [apply(&matrix, [near, 0.0]), apply(&matrix, [far, 0.0])].as_flattened(),
                );
                out.extend(extent.transformed(&matrix).to_array());
                let turn = if layout.is_vertical && !it.is_upright {
                    90.0
                } else {
                    0.0
                };
                out.extend([
                    it.radians.to_degrees() + turn,
                    if unit == 0 {
                        it.advance / it.stretch
                    } else {
                        0.0
                    },
                ]);
            }
        }
        out
    }
}

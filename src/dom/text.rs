//! Paints what is on lines.

use core::ops::Range;

use smallvec::SmallVec;

use crate::abi::{Face, Glyph, Item, LineStyle, Rect, RoundedRect, Span};
use crate::background::Frame;
use crate::boxes::{BoxId, Kind};
use crate::editing::Mark;
use crate::inline::{COMBINED, Inline, ItemKind, OPENING, UPRIGHT};
use crate::lines::{Fragment, FragmentKind, Line, em_box};
use crate::paint::{Painter, Space, alpha, resolve_padding, rounded, square};
use crate::platform::Shaped;
use crate::properties::{Id, Style, Value};
use crate::selector::Pseudo;
use crate::svg_values::PaintKind;
use crate::tree::NodeId;
use crate::types::*;
use crate::values::Color;

type Decorations<'a> = SmallVec<[&'a Style; 2]>;

#[derive(Clone, Copy)]
struct Decorating<'a> {
    by: &'a Style,
    /// Of the inline box that the lines belong to.
    font: &'a Style,
    baseline: f32,
}

struct Marked {
    clusters: Range<u32>,
    rect: Rect,
    background: u32,
    color: Option<u32>,
    style: Option<Style>,
    is_composing: bool,
    is_misspelled: bool,
}

fn visible_lines(inline: &Inline) -> &[Line] {
    &inline.lines.lines[..inline
        .lines
        .visible
        .unwrap_or(usize::MAX)
        .min(inline.lines.lines.len())]
}

impl<'a> Painter<'a> {
    fn block_decorations(&self, mut id: BoxId) -> Decorations<'a> {
        let (boxes, mut found) = (&self.document.boxes, Decorations::new());
        while id != 0 {
            let it = &boxes[id];
            if !it.style.paint.decoration_line.is_empty() {
                found.push(&it.style);
            }
            if it.style.is_out_of_flow()
                || it.style.is_floating()
                || boxes[it.parent].kind == Kind::Lines
            {
                break;
            }
            id = it.parent;
        }
        found
    }

    /// The fragments that are in the inline element `layer`, or in none.
    pub(crate) fn lines(&mut self, id: BoxId, layer: NodeId, physical: &Space) {
        let (document, space) = (self.document, &self.along_lines(id, physical));
        let Some(inline) = document.boxes[id].inline.as_deref() else {
            return;
        };
        let mut decorations = self.block_decorations(id);
        let is_under_text = self.out.caret.is_some_and(|it| it.0 == id)
            && document
                .inherited_style(id)
                .other_if_set(crate::properties::Id::CaretShape)
                == Some("block");
        if layer == 0 && is_under_text {
            self.caret_in(id, physical);
        }
        let node_of = |item: &crate::inline::Item| {
            if item.node == 0 {
                document.boxes[document.boxes[id].parent].node
            } else {
                item.node
            }
        };
        for line in visible_lines(inline) {
            let truncation = line.clamp.as_ref().or(line.overflow.as_ref());
            let first_line = inline
                .first_line
                .as_ref()
                .filter(|_| line.fragments.start == 0)
                .map(|it| &*it.1);
            let (inline, outer) = (inline.for_line(line), decorations.len());
            if let Some(style) = first_line {
                decorations.extend(Some(style).filter(|it| !it.paint.decoration_line.is_empty()));
                let all = inline
                    .lines
                    .fragments
                    .iter()
                    .map(Fragment::rect)
                    .reduce(|a, b| a.union(&b))
                    .filter(|_| layer == 0);
                let metrics = &style.metrics;
                if let Some(all) = all.map(|it| Rect {
                    y: line.baseline - metrics.ascent,
                    height: metrics.ascent + metrics.descent,
                    ..it
                }) {
                    let shape =
                        square(self.snap_rect(document.from_lines(id, all).moved(physical.origin)));
                    self.frame(
                        style,
                        &Frame {
                            shape,
                            border: [0.0; 4],
                            padding: [0.0; 4],
                            scrolled: None,
                            whole: None,
                        },
                        true,
                        physical,
                        &mut |_| {},
                    );
                }
            }
            let mut fragments: SmallVec<[_; 8]> = inline
                .lines
                .fragments_of(line)
                .iter()
                .filter(|it| it.layer == layer)
                .collect();
            if fragments
                .first()
                .is_some_and(|it| matches!(it.kind, FragmentKind::Box(..)))
            {
                fragments.sort_by_key(|it| it.item);
            }
            for fragment in fragments {
                let item = &inline.items[fragment.item as usize];
                let (style, rect) = (
                    document.current_style(item),
                    fragment.rect().moved(space.origin),
                );
                if let FragmentKind::Atomic(child) = fragment.kind {
                    if truncation.is_none_or(|it| it.shows(fragment.x, fragment.width, line.rtl)) {
                        if self.document.marks.is_selected(item.node) {
                            self.fill(
                                square(rect),
                                self.selection_background(item.node, style),
                                space,
                            );
                        }
                        self.embedded(child, physical);
                        if document.boxes[child].is_replaced() {
                            self.highlight_replaced(item.node, style, rect, space);
                        }
                    }
                    continue;
                }
                if !style.is_visible()
                    || !rect
                        .grown(style.font.size.0.max(document.decoration_reach) + 64.0)
                        .touches(&space.visible)
                {
                    continue;
                }
                match &fragment.kind {
                    FragmentKind::Box(left, right) => {
                        self.inline_box(id, inline, line, fragment, [*left, *right], physical)
                    }
                    FragmentKind::Hyphen(shaped) => {
                        let origin = [rect.x, space.origin[1] + fragment.baseline];
                        self.shaped(
                            shaped,
                            origin,
                            style.ink.text_fill_color.resolve(style.color()),
                            space,
                        );
                    }
                    _ => {
                        self.hit(node_of(item), style, square(rect), space);
                        self.text(
                            inline,
                            line,
                            fragment,
                            style,
                            (
                                &decorations,
                                first_line.unwrap_or_else(|| document.inherited_style(id)),
                            ),
                            space,
                        );
                    }
                }
            }
            decorations.truncate(outer);
            if let (Some(truncation), 0) = (truncation, layer) {
                let style = first_line.unwrap_or_else(|| document.inherited_style(id));
                if style.is_visible() {
                    let origin = [
                        space.origin[0] + truncation.x,
                        space.origin[1] + line.baseline,
                    ];
                    self.shaped(
                        &truncation.ellipsis,
                        origin,
                        style.ink.text_fill_color.resolve(style.color()),
                        space,
                    );
                }
            }
        }
        if layer == 0 && !is_under_text {
            self.caret_in(id, physical);
        }
    }

    fn highlight_replaced(&mut self, node: NodeId, style: &Style, rect: Rect, space: &Space) {
        let (document, mut below) = (self.document, style.color());
        for (_, mark) in document.marks.of(node) {
            if let Mark::Highlight(name) = mark
                && let Some(highlight) = document.highlight(node, Pseudo::Highlight(*name))
            {
                let own = highlight.style(style, &document.styles.initial, below);
                below = own.color();
                self.fill(
                    square(self.snap_rect(rect)),
                    own.paint.background_color.resolve(own.color()),
                    space,
                );
            }
        }
    }

    fn inline_box(
        &mut self,
        id: BoxId,
        inline: &'a Inline,
        line: &Line,
        fragment: &Fragment,
        edges: [bool; 2],
        space: &Space,
    ) {
        let mode = self.document.boxes[id].mode.of_lines();
        let width = mode.turn_axes(self.document.boxes[id].size())[0];
        let item = &inline.items[fragment.item as usize];
        let (style, mut rect) = (self.document.current_style(item), fragment.rect());
        if line.clamp.is_some() || line.overflow.is_some() {
            let (left, right) = if line.rtl {
                (line.left, f32::MAX)
            } else {
                (f32::MIN, line.right)
            };
            rect = Rect::from_edges(
                rect.x.max(left),
                rect.y,
                rect.right().min(right),
                rect.bottom(),
            );
        }
        let rect = self.document.from_lines(id, rect).moved(space.origin);
        let (mut shape, mut border, mut padding) = (
            rounded(self.snap_rect(rect), style),
            style.border(),
            resolve_padding(style, width),
        );
        let mut cut = [false; 4];
        if style.rare.decoration_break == DecorationBreak::Slice && edges != [true; 2] {
            let (p, whole) = (&style.paint, shape.rect);
            let mut radii = [&p.top_left, &p.top_right, &p.bottom_right, &p.bottom_left]
                .map(|it| [it.0.0.resolve(whole.width), it.1.0.resolve(whole.height)]);
            for side in [3, 1]
                .into_iter()
                .filter(|it| !edges[usize::from(*it == 1)])
                .map(|it| mode.sides()[it])
            {
                (border[side], padding[side], cut[side]) = (0.0, 0.0, true);
                [side, (side + 1) % 4]
                    .into_iter()
                    .for_each(|corner| radii[corner] = [0.0; 2]);
            }
            shape = crate::paint::fit(whole, radii);
        }
        if item.node != 0 {
            self.hit(item.node, style, shape, space);
        }
        let (outside, mut inside) = (space, *space);
        if cut.contains(&true) && !style.paint.box_shadow.0.is_empty() {
            let reach = style
                .paint
                .box_shadow
                .0
                .iter()
                .map(|it| it.offset[0].abs() + it.offset[1].abs() + it.spread.abs() + it.blur * 2.0)
                .fold(0.0, f32::max)
                .ceil();
            self.clip(
                square(
                    shape
                        .rect
                        .shrunk(cut.map(|it| if it { 0.0 } else { -reach })),
                ),
                &mut inside,
            );
            shape.rect = shape
                .rect
                .shrunk(cut.map(|it| if it { -reach } else { 0.0 }));
        }
        let space = &inside;
        let has_image = style.background.border_image.0.is_some()
            || style.background.image.iter().any(|it| it.0.is_some());
        let whole = (has_image
            && edges != [true; 2]
            && style.rare.decoration_break == DecorationBreak::Slice)
            .then(|| {
                let slices = || {
                    inline.lines.fragments.iter().filter(|it| {
                        it.item == fragment.item && matches!(it.kind, FragmentKind::Box(..))
                    })
                };
                let (before, total) = (
                    slices()
                        .take_while(|it| !core::ptr::eq(*it, fragment))
                        .map(|it| it.width)
                        .sum::<f32>(),
                    slices().map(|it| it.width).sum::<f32>(),
                );
                let x = if style.is_rtl() {
                    fragment.x + fragment.width + before - total
                } else {
                    fragment.x - before
                };
                let rect = self
                    .document
                    .from_lines(
                        id,
                        Rect {
                            x,
                            width: total,
                            ..fragment.rect()
                        },
                    )
                    .moved(space.origin);
                (
                    self.snap_rect(rect),
                    style.border(),
                    resolve_padding(style, width),
                )
            });
        let frame = Frame {
            shape,
            border,
            padding,
            scrolled: None,
            whole,
        };
        self.frame(style, &frame, true, space, &mut |painter| {
            let space = &painter.along_lines(id, space);
            for text in inline.lines.fragments_of(line) {
                let mut around =
                    core::iter::successors(Some(inline.items[text.item as usize].parent), |key| {
                        Some(inline.items[(*key as usize).checked_sub(1)?].parent)
                    });
                if around.any(|key| key == fragment.item + 1) {
                    painter.glyphs(
                        inline,
                        line,
                        text,
                        0..u32::MAX,
                        0xff,
                        0.0,
                        space.origin,
                        space,
                    );
                }
            }
        });
        self.border(style, &frame, space);
        self.outline(style, rect, outside);
    }

    /// The text in the box, opaque.
    pub(crate) fn text_mask(&mut self, id: BoxId, space: &Space) {
        self.depends_on_contents();
        let document = self.document;
        let (it, physical, space) = (&document.boxes[id], space, &self.along_lines(id, space));
        for (inline, line) in it.inline.iter().flat_map(|it| {
            visible_lines(it)
                .iter()
                .map(move |line| (it.for_line(line), line))
        }) {
            for fragment in inline.lines.fragments_of(line) {
                self.glyphs(
                    inline,
                    line,
                    fragment,
                    0..u32::MAX,
                    0xff,
                    0.0,
                    space.origin,
                    space,
                );
                if let FragmentKind::Text { clusters, .. } = &fragment.kind {
                    self.emphasis_marks(
                        inline,
                        line,
                        fragment,
                        clusters,
                        document.current_style(&inline.items[fragment.item as usize]),
                        Some(0xff),
                        space,
                    );
                }
            }
            if let Some(truncation) = line.clamp.as_ref().or(line.overflow.as_ref()) {
                let origin = [
                    space.origin[0] + truncation.x,
                    space.origin[1] + line.baseline,
                ];
                self.shaped(&truncation.ellipsis, origin, 0xff, space);
            }
        }
        for child in it
            .children
            .iter()
            .filter(|it| !document.boxes[**it].style.is_out_of_flow())
        {
            let (mut inside, offset) = (*physical, document.offset_in_container(*child));
            inside.origin = [
                physical.origin[0] + offset[0],
                physical.origin[1] + offset[1],
            ];
            self.text_mask(*child, &inside);
        }
    }

    fn shaped(&mut self, shaped: &Shaped, origin: [f32; 2], color: u32, space: &Space) {
        let mut x = origin[0];
        for cluster in &shaped.clusters {
            let (face, start) = (
                &shaped.faces[usize::from(cluster.face)],
                self.out.glyphs.len() as u32,
            );
            self.out
                .glyphs
                .extend_from_slice(&shaped.glyphs[cluster.glyphs.range()]);
            let glyphs = Span {
                start,
                end: self.out.glyphs.len() as u32,
            };
            let bounds = Rect::new([
                x,
                origin[1] - face.ascent,
                cluster.advance,
                face.ascent + face.descent,
            ])
            .grown(face.size);
            let origin = [x, self.snap(origin[1])];
            self.emit(
                &Item::Text {
                    origin,
                    bounds,
                    face: face.id,
                    size: face.size,
                    glyphs,
                    color,
                    blur: 0.0,
                },
                space,
            );
            x += cluster.advance;
        }
    }

    fn glyphs(
        &mut self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        only: Range<u32>,
        color: u32,
        blur: f32,
        origin: [f32; 2],
        space: &Space,
    ) {
        if let FragmentKind::Text { clusters, .. } = &fragment.kind
            && inline.clusters[clusters.start as usize].flags & (UPRIGHT | COMBINED) != 0
        {
            return self.upright_glyphs(inline, line, fragment, only, color, blur, origin, space);
        }
        if alpha(color) > 0
            && let Some((face, glyphs)) =
                self.add_glyphs(inline, line, fragment, only, blur, origin, space)
        {
            let bounds = fragment.rect().moved(origin).grown(face.size / 2.0 + blur);
            let origin = [
                origin[0] + fragment.x,
                self.snap(origin[1] + fragment.baseline),
            ];
            self.emit(
                &Item::Text {
                    origin,
                    bounds,
                    face: face.id,
                    size: face.size,
                    glyphs,
                    color,
                    blur,
                },
                space,
            );
        }
    }

    fn text_stroke(
        &mut self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        only: Range<u32>,
        style: &Style,
        space: &Space,
    ) {
        let width = style.text_stroke_width();
        if width > 0.0
            && let Some(color) = style
                .parse_other::<Color>(Id::WebkitTextStrokeColor)
                .map(|it| it.resolve(style.color()))
            && let Some((face, glyphs)) =
                self.add_glyphs(inline, line, fragment, only, width, space.origin, space)
        {
            let bounds = fragment
                .rect()
                .moved(space.origin)
                .grown(face.size / 2.0 + width);
            let origin = [
                space.origin[0] + fragment.x,
                self.snap(space.origin[1] + fragment.baseline),
            ];
            let stroke = crate::abi::Stroke {
                width,
                miter_limit: 4.0,
                ..Default::default()
            };
            self.emit(
                &Item::TextStroke {
                    origin,
                    bounds,
                    face: face.id,
                    size: face.size,
                    glyphs,
                    color,
                    stroke,
                },
                space,
            );
        }
    }

    fn emphasis_marks(
        &mut self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        only: &Range<u32>,
        style: &Style,
        color: Option<u32>,
        space: &Space,
    ) {
        let Some((mark, is_under)) = self.document.emphasis_mark(style) else {
            return;
        };
        let (Some(face), Some(own)) = (
            mark.faces.first(),
            style.parse_other::<Color>(Id::TextEmphasisColor),
        ) else {
            return;
        };
        let (color, width) = (
            color.unwrap_or_else(|| own.resolve(style.color())),
            mark.clusters.iter().map(|it| it.advance).sum::<f32>(),
        );
        let metrics = self.document.fonts.metrics(style.font_id, face.size);
        let ([up, down], [own_up, own_down]) = (
            em_box(&style.metrics, style.font.size.0),
            em_box(&metrics, face.size),
        );
        let below = if is_under {
            down + own_up
        } else {
            -up - own_down
        };
        let (truncation, is_vertical) = (
            line.clamp.as_ref().or(line.overflow.as_ref()),
            style.has_central_baseline(),
        );
        for (at, left, advance) in inline
            .lines
            .positions(fragment)
            .filter(|it| only.contains(&it.0) && it.2 > 0.0)
        {
            let character = inline.character(at);
            let is_symbol = matches!(
                character,
                '#' | '%'
                    | '&'
                    | '@'
                    | '\u{a7}'
                    | '\u{b6}'
                    | '\u{2030}'
                    | '\u{2031}'
                    | '\u{204a}'
                    | '\u{204b}'
                    | '\u{2053}'
                    | '\u{303d}'
            );
            let is_skipped = character.is_whitespace()
                || crate::characters::is_control_or_unassigned(character)
                || crate::characters::is_punctuation(character) && !is_symbol;
            if is_skipped || !truncation.is_none_or(|it| it.shows(left, advance, line.rtl)) {
                continue;
            }
            let center = left + (advance - style.letter_spacing()) / 2.0;
            if is_vertical {
                let middle = fragment.y
                    + style.metrics.ascent
                    + style.font.size.0 * if is_under { 0.75 } else { -0.75 };
                let upright = self.transformed(&[0.0, -1.0, 1.0, 0.0, center, middle], space);
                self.shaped(
                    &mark,
                    [
                        upright.origin[0] - width / 2.0,
                        upright.origin[1] + (face.ascent - face.descent) / 2.0,
                    ],
                    color,
                    &upright,
                );
            } else {
                self.shaped(
                    &mark,
                    [
                        space.origin[0] + center - width / 2.0,
                        space.origin[1] + fragment.baseline + below,
                    ],
                    color,
                    space,
                );
            }
        }
    }

    fn blurred(
        &mut self,
        rect: Rect,
        blur: f32,
        space: &Space,
        paint: impl FnOnce(&mut Self, Rect, &Space),
    ) {
        if blur <= 0.0 {
            return paint(self, rect, space);
        }
        let start = self.out.filters.len() as u32;
        self.out.filters.push(crate::abi::Filter::Blur(blur / 2.0));
        let base = self.begin_group(
            rect.grown(rect.height * 4.0 + blur * 2.0),
            1.0,
            crate::abi::BlendMode::Normal,
            Span {
                start,
                end: start + 1,
            },
            space,
        );
        paint(self, rect, space);
        self.end_group(base);
    }

    fn upright_glyphs(
        &mut self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        only: Range<u32>,
        color: u32,
        blur: f32,
        origin: [f32; 2],
        space: &Space,
    ) {
        let FragmentKind::Text { clusters, .. } = &fragment.kind else {
            return;
        };
        let (paragraph, style) = (
            inline.paragraph_of(clusters.start),
            &inline.items[fragment.item as usize].style,
        );
        let shaped = |at: u32| &paragraph.shaped.clusters[(at - paragraph.first_cluster) as usize];
        let width = |at: u32| shaped(at).advance - style.letter_spacing();
        let (first, size) = (&inline.clusters[clusters.start as usize], style.font.size.0);
        let (face, is_combined) = (
            paragraph.shaped.faces[usize::from(first.face)],
            first.flags & COMBINED != 0,
        );
        let total: f32 = clusters.clone().map(width).sum();
        let scale = if is_combined {
            (size * 1.1 / total).min(1.0)
        } else {
            1.0
        };
        let center = origin[1] + fragment.y + style.metrics.ascent;
        let at = [
            origin[0] - space.origin[0] + fragment.x,
            center - space.origin[1],
        ];
        let space = self.transformed(&[0.0, -scale, 1.0, 0.0, at[0], at[1]], space);
        let (start, mut x) = (self.out.glyphs.len() as u32, -total / 2.0);
        for (at, left, _) in inline.lines.positions(fragment) {
            let [dx, dy] = match is_combined {
                true => [x, (size + face.ascent - face.descent) / 2.0],
                false => [0.0, left - fragment.x - trimmed(inline, line, fragment, at)],
            };
            let glyphs = paragraph.shaped.glyphs[shaped(at).glyphs.range()]
                .iter()
                .filter(|_| only.contains(&at));
            self.out.glyphs.extend(glyphs.map(|it| Glyph {
                x: it.x + dx,
                y: it.y + dy,
                ..*it
            }));
            x += width(at);
        }
        let glyphs = Span {
            start,
            end: self.out.glyphs.len() as u32,
        };
        let bounds = Rect::new([-total, 0.0, total * 2.0, fragment.width]).grown(face.size + blur);
        self.emit(
            &Item::Text {
                origin: [0.0; 2],
                bounds,
                face: face.id,
                size: face.size,
                glyphs,
                color,
                blur,
            },
            &space,
        );
    }

    /// Of those of the clusters that are in the fragment.
    fn add_glyphs(
        &mut self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        only: Range<u32>,
        blur: f32,
        origin: [f32; 2],
        space: &Space,
    ) -> Option<(Face, Span)> {
        let FragmentKind::Text { clusters, rtl } = &fragment.kind else {
            return None;
        };
        let (shaped, start) = (
            &inline.paragraph_of(clusters.start).shaped,
            self.out.glyphs.len() as u32,
        );
        let truncation = line.clamp.as_ref().or(line.overflow.as_ref());
        let [near, far] = space
            .visible
            .grown(fragment.height * 4.0 + blur)
            .span(0)
            .map(|it| it - origin[0]);
        for (at, left, advance) in inline.lines.positions(fragment) {
            let cluster = &inline.clusters[at as usize];
            if only.contains(&at)
                && left + advance >= near
                && left <= far
                && truncation.is_none_or(|it| it.shows(left, advance, line.rtl))
            {
                let mut x = left - fragment.x - trimmed(inline, line, fragment, at);
                if *rtl {
                    let joined = (at + 1..clusters.end).take_while(|it| {
                        let next = &inline.clusters[*it as usize];
                        next.glyphs.start == next.glyphs.end
                            && next.flags == 0
                            && next.advance > 0.0
                    });
                    x -= joined
                        .map(|it| inline.lines.advances[it as usize])
                        .sum::<f32>();
                }
                self.out.glyphs.extend(
                    shaped.glyphs[cluster.glyphs.range()]
                        .iter()
                        .map(|it| Glyph { x: it.x + x, ..*it }),
                );
            }
        }
        let glyphs = Span {
            start,
            end: self.out.glyphs.len() as u32,
        };
        let face = shaped
            .faces
            .get(usize::from(inline.clusters[clusters.start as usize].face))?;
        (glyphs.end > start || crate::platform::renderer().is_none() && fragment.width > 0.0)
            .then_some((*face, glyphs))
    }

    /// The background, and the color of the text.
    fn selection_colors(&self, style: &Style) -> (u32, Option<u32>) {
        let environment = &self.document.environment;
        match (cfg!(target_os = "macos"), environment.is_active, style.dark) {
            (true, true, false) => (0x80bc_fe99, None),
            (true, true, true) => (0x3f63_8bcc, None),
            (true, false, false) => (0xc4c4_c499, None),
            (true, false, true) => (0x4646_46cc, None),
            (false, true, false) => (0x3367_d1ff, Some(0xffff_ffff)),
            (false, true, true) => (0x0539_a3ff, Some(0xffff_ffff)),
            (false, false, _) => (0xc8c8_c8ff, Some(0x3232_32ff)),
        }
    }

    fn extent(
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        clusters: &Range<u32>,
    ) -> Option<[f32; 2]> {
        let truncation = line.clamp.as_ref().or(line.overflow.as_ref());
        let shown = inline
            .lines
            .positions(fragment)
            .filter(|(at, left, advance)| {
                clusters.contains(at)
                    && truncation.is_none_or(|it| it.shows(*left, *advance, line.rtl))
            });
        shown
            .map(|it| [it.1, it.1 + it.2])
            .reduce(|a, b| [a[0].min(b[0]), a[1].max(b[1])])
    }

    fn marked(
        &self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        style: &Style,
        space: &Space,
    ) -> SmallVec<[Marked; 1]> {
        let (document, item, mut marked) = (
            self.document,
            &inline.items[fragment.item as usize],
            SmallVec::new(),
        );
        for (range, mark) in document.marks.of(item.node) {
            let clusters = match item.kind {
                ItemKind::Break => item.clusters.clone(),
                _ => {
                    inline.cluster_at(inline.text_offset(item, range.start))
                        ..inline.cluster_at(inline.text_offset(item, range.end))
                }
            };
            let Some([mut left, mut right]) = Painter::extent(inline, line, fragment, &clusters)
            else {
                continue;
            };
            let parent = document.tree.flat_parent(item.node);
            let below = marked
                .iter()
                .rev()
                .find_map(|it: &Marked| it.color.filter(|_| it.clusters.contains(&clusters.start)));
            let of = |pseudo, default: (u32, Option<u32>)| match document.highlight(parent, pseudo)
            {
                None => (None, default.0, default.1),
                Some(highlight) => {
                    let own = highlight.style(
                        style,
                        &document.styles.initial,
                        below.unwrap_or_else(|| style.color()),
                    );
                    let (background, color) = match highlight.has_colors {
                        true => (
                            own.paint.background_color.resolve(own.color()),
                            highlight.sets(Id::Color).then(|| own.color()),
                        ),
                        false => default,
                    };
                    (Some(own), background, color)
                }
            };
            let (custom, background, color) = match mark {
                Mark::Selection
                    if style.ink.user_select == UserSelect::None && !style.is_editable()
                        || document.is_inert(item.node, style) =>
                {
                    continue;
                }
                Mark::Selection => {
                    let last = clusters.end - 1;
                    let FragmentKind::Text { clusters: all, rtl } = &fragment.kind else {
                        continue;
                    };
                    let is_after = |it: &Fragment| match &it.kind {
                        FragmentKind::Text { clusters, .. } => clusters.start >= all.end,
                        FragmentKind::Atomic(_) => {
                            inline.items[it.item as usize].clusters.start >= all.end
                        }
                        _ => false,
                    };
                    let goes_on = (range.end == u32::MAX || last >= all.end)
                        && *rtl == line.rtl
                        && !inline.lines.fragments_of(line).iter().any(is_after);
                    let ends_inline_block = || {
                        line.clusters.end == inline.clusters.len() as u32
                            && document
                                .tree
                                .style(parent)
                                .is_some_and(|it| it.display() == Display::InlineBlock)
                    };
                    if all.end - 1 <= last && inline.is_newline(all.end - 1)
                        || goes_on && !ends_inline_block()
                    {
                        let width = style.metrics.space_advance;
                        if line.rtl {
                            left -= width
                        } else {
                            right += width
                        }
                    }
                    of(Pseudo::Selection, self.selection_colors(style))
                }
                Mark::Composition => (None, 0, None),
                Mark::Highlight(name) if *name == crate::name::name!("::target-text") => {
                    of(Pseudo::Highlight(*name), (0xe9d2_fdff, Some(0x0000_00ff)))
                }
                Mark::Highlight(name) => of(Pseudo::Highlight(*name), (0, None)),
            };
            let (top, bottom) = match mark {
                Mark::Selection => (
                    line.y.min(fragment.y),
                    (line.y + line.height).max(fragment.y + fragment.height),
                ),
                _ => (fragment.y, fragment.y + fragment.height),
            };
            let rect =
                self.snap_rect(Rect::from_edges(left, top, right, bottom).moved(space.origin));
            let is_misspelled = *mark == Mark::Highlight(crate::name::name!("::spelling-error"));
            marked.push(Marked {
                clusters,
                rect,
                background,
                color,
                style: custom,
                is_composing: *mark == Mark::Composition,
                is_misspelled,
            });
        }
        marked
    }

    fn decoration(
        &mut self,
        of: Decorating,
        mut line: DecorationLine,
        [left, right]: [f32; 2],
        on: (&Inline, &Line, &Fragment),
        text: &Style,
        shadow: Option<&Shadow>,
        space: &Space,
    ) {
        let (fragment, Decorating { by, font, baseline }) = (on.2, of);
        let (size, ascent) = (font.font.size.0, text.metrics.ascent);
        let scale = self.document.environment.scale;
        let (offset, mut position) = (
            by.ink
                .underline_offset
                .0
                .as_ref()
                .map(|it| it.resolve(size)),
            by.ink.underline_position,
        );
        let mut flips = false;
        if text.has_central_baseline() {
            let is_right_by_default = ["ja", "ko"]
                .into_iter()
                .any(|it| crate::inline::speaks(font, it));
            flips = position.contains(UnderlinePosition::RIGHT)
                || is_right_by_default && !position.contains(UnderlinePosition::LEFT);
            position = UnderlinePosition::UNDER;
        }
        if flips && line != DecorationLine::LINE_THROUGH {
            line = (DecorationLine::UNDERLINE | DecorationLine::OVERLINE) - line;
        }
        let of_em = |style: &Style, part: f32| {
            part * style.font.size.0 / (style.metrics.ascent + style.metrics.descent).max(1.0)
        };
        let automatic = if by.paint.decoration_thickness.1 {
            font.metrics.underline_thickness
        } else {
            size / 10.0
        };
        let thickness = by
            .paint
            .decoration_thickness
            .0
            .as_ref()
            .map_or(automatic, |it| self.snap(it.resolve(size)))
            .max(1.0 / scale);
        let below = if line == DecorationLine::OVERLINE && flips {
            (((-of_em(text, ascent) - offset.unwrap_or(0.0)) * scale).floor()
                - 1.0
                - (thickness * scale).floor())
                / scale
        } else if line == DecorationLine::OVERLINE {
            -ascent - (thickness * scale).floor() / scale
        } else if line == DecorationLine::LINE_THROUGH {
            -ascent / 3.0 - thickness / 2.0
        } else {
            let offset = offset.filter(|_| !flips);
            let shift = self.snap(space.origin[1] + baseline)
                - self.snap(space.origin[1] + fragment.baseline);
            match offset {
                _ if position.contains(UnderlinePosition::UNDER) => {
                    (((of_em(text, text.metrics.descent) + offset.unwrap_or(0.0)) * scale).floor()
                        + 1.0)
                        / scale
                }
                _ if position.contains(UnderlinePosition::FROM_FONT) => {
                    shift + font.metrics.underline_offset + offset.unwrap_or(0.0)
                }
                Some(offset) => shift + self.snap(offset),
                None => shift + (thickness * scale / 2.0).ceil().max(1.0) / scale,
            }
        };
        let style = match by.paint.decoration_style {
            DecorationStyle::Solid => LineStyle::Solid,
            DecorationStyle::Double => LineStyle::Double,
            DecorationStyle::Dotted => LineStyle::Dotted,
            DecorationStyle::Dashed => LineStyle::Dashed,
            DecorationStyle::Wavy => LineStyle::Wavy,
        };
        let color = by.paint.decoration_color.resolve(by.color());
        let (height, beside) = (
            (thickness * scale).floor().max(1.0) / scale,
            thickness + 1.0 / scale,
        );
        let moved = match (style, line) {
            (LineStyle::Wavy, DecorationLine::UNDERLINE) => beside,
            (LineStyle::Wavy | LineStyle::Double, DecorationLine::OVERLINE) => -beside,
            _ => 0.0,
        };
        let y = self.snap(space.origin[1] + fragment.baseline) + below + moved;
        let mut gaps = Vec::new();
        if line != DecorationLine::LINE_THROUGH
            && text.ink.skip_ink != SkipInk::None
            && let Some((face, glyphs)) =
                self.add_glyphs(on.0, on.1, fragment, 0..u32::MAX, 0.0, space.origin, space)
        {
            gaps = crate::platform::ink_spans(
                &face,
                &self.out.glyphs[glyphs.range()],
                below + moved.min(0.0),
                below + height + moved.max(0.0),
            );
            self.out.glyphs.truncate(glyphs.start as usize);
        }
        let (mut from, margin) = (left, thickness.min(13.0 / scale));
        for [start, end] in gaps
            .into_iter()
            .map(|it| [fragment.x + it[0] - margin, fragment.x + it[1] + margin])
            .chain([[right; 2]])
        {
            let to = start.min(right);
            if alpha(color) > 0 && to > from {
                let rect = Rect::new([space.origin[0] + from, y, to - from, thickness]);
                match shadow {
                    Some(it) => self.blurred(
                        rect.moved(it.offset),
                        it.blur,
                        space,
                        |painter, rect, space| {
                            painter.emit(
                                &Item::Line {
                                    rect,
                                    color: it.color.resolve(text.color()),
                                    style,
                                },
                                space,
                            );
                        },
                    ),
                    None => self.emit(&Item::Line { rect, color, style }, space),
                }
            }
            from = from.max(end);
        }
    }

    fn text_shadows(
        &mut self,
        inline: &Inline,
        line: &Line,
        fragment: &Fragment,
        clusters: Range<u32>,
        style: &Style,
        decorations: &[Decorating],
        space: &Space,
    ) {
        for shadow in style.ink.text_shadow.0.0.iter().rev() {
            let (text, extent) = (
                self.document
                    .current_style(&inline.items[fragment.item as usize]),
                Painter::extent(inline, line, fragment, &clusters),
            );
            for (by, extent) in decorations.iter().filter_map(|it| Some((it, extent?))) {
                let kinds = [
                    DecorationLine::UNDERLINE,
                    DecorationLine::OVERLINE,
                    DecorationLine::LINE_THROUGH,
                ];
                for kind in kinds
                    .into_iter()
                    .filter(|it| by.by.paint.decoration_line.contains(*it))
                {
                    self.decoration(
                        *by,
                        kind,
                        extent,
                        (inline, line, fragment),
                        text,
                        Some(shadow),
                        space,
                    );
                }
            }
            let origin = [
                space.origin[0] + shadow.offset[0],
                space.origin[1] + shadow.offset[1],
            ];
            self.glyphs(
                inline,
                line,
                fragment,
                clusters.clone(),
                shadow.color.resolve(style.color()),
                shadow.blur,
                origin,
                space,
            );
        }
    }

    fn selection_background(&self, node: NodeId, style: &Style) -> u32 {
        let highlight = self
            .document
            .highlight(node, Pseudo::Selection)
            .filter(|it| it.has_colors);
        let own = highlight.map(|it| it.style(style, &self.document.styles.initial, style.color()));
        own.map_or_else(
            || self.selection_colors(style).0,
            |it| it.paint.background_color.resolve(it.color()),
        )
    }

    fn text(
        &mut self,
        inline: &'a Inline,
        line: &Line,
        fragment: &Fragment,
        style: &Style,
        outer: (&Decorations<'a>, &Style),
        space: &Space,
    ) {
        let FragmentKind::Text { clusters, .. } = &fragment.kind else {
            return;
        };
        let marked = self.marked(inline, line, fragment, style, space);
        let (mut decorations, mut key) = (
            SmallVec::<[Decorating; 2]>::new(),
            inline.items[fragment.item as usize].parent,
        );
        while key != 0 {
            let (item, by) = (
                &inline.items[key as usize - 1],
                &**self.document.current_style(&inline.items[key as usize - 1]),
            );
            if !by.paint.decoration_line.is_empty() {
                let own = inline
                    .lines
                    .fragments_of(line)
                    .iter()
                    .find(|it| it.item == key - 1 && it.layer == fragment.layer);
                decorations.push(Decorating {
                    by,
                    font: by,
                    baseline: own.unwrap_or(fragment).baseline,
                });
            }
            key = item.parent;
        }
        let baseline = if fragment.layer == 0 {
            line.baseline
        } else {
            fragment.baseline
        };
        decorations.extend(outer.0.iter().map(|by| Decorating {
            by,
            font: outer.1,
            baseline,
        }));
        self.text_shadows(
            inline,
            line,
            fragment,
            clusters.clone(),
            style,
            &decorations,
            space,
        );
        let color = style.ink.text_fill_color.resolve(style.color());
        let paint = |painter: &mut Self, run: Range<u32>, over: &[&Marked]| {
            let extent = if decorations.is_empty() && over.is_empty() {
                None
            } else {
                Painter::extent(inline, line, fragment, &run)
            };
            let highlighted = over.iter().rev().find_map(|it| it.color);
            let recolors = highlighted.or_else(|| {
                over.iter()
                    .any(|it| it.style.is_some())
                    .then(|| style.color())
            });
            let decorate = |painter: &mut Self, kind: DecorationLine| {
                let Some(extent) = extent else { return };
                for of in decorations
                    .iter()
                    .rev()
                    .filter(|it| it.by.paint.decoration_line.contains(kind))
                {
                    let recolored = recolors.map(|color| {
                        let mut it = Style::clone(of.by);
                        it.groups
                            .set(&Value::TextDecorationColor(Color::Rgba(color)));
                        it
                    });
                    painter.decoration(
                        Decorating {
                            by: recolored.as_ref().unwrap_or(of.by),
                            ..*of
                        },
                        kind,
                        extent,
                        (inline, line, fragment),
                        style,
                        None,
                        space,
                    );
                }
                for it in over {
                    if let Some(by) = it
                        .style
                        .as_ref()
                        .filter(|it| it.paint.decoration_line.contains(kind))
                    {
                        painter.decoration(
                            Decorating {
                                by,
                                font: by,
                                baseline: fragment.baseline,
                            },
                            kind,
                            extent,
                            (inline, line, fragment),
                            style,
                            None,
                            space,
                        );
                    }
                    if it.is_composing && kind == DecorationLine::UNDERLINE {
                        let y = painter.snap(space.origin[1] + fragment.y + fragment.height - 1.0);
                        let rect =
                            Rect::new([space.origin[0] + extent[0], y, extent[1] - extent[0], 1.0]);
                        painter.emit(
                            &Item::Line {
                                rect,
                                color: style.color(),
                                style: LineStyle::Solid,
                            },
                            space,
                        );
                    }
                    if it.is_misspelled && kind == DecorationLine::UNDERLINE {
                        let y = painter.snap(
                            space.origin[1]
                                + (fragment.baseline + 2.0).min(fragment.y + fragment.height - 3.0),
                        );
                        let (left, right) =
                            (space.origin[0] + extent[0], space.origin[0] + extent[1]);
                        let dots = (0..)
                            .map(|at| it.rect.x + at as f32 * 4.0)
                            .skip_while(|x| *x < left - 0.5)
                            .take_while(|x| *x < right - 0.5);
                        for x in dots.take_while(|x| x + 3.0 <= it.rect.x + it.rect.width) {
                            painter.fill(
                                RoundedRect {
                                    rect: Rect::new([x, y, 3.0, 3.0]),
                                    radii: [[1.5; 2]; 4],
                                },
                                0xfb2d_1ddb,
                                space,
                            );
                        }
                    }
                }
            };
            decorate(painter, DecorationLine::UNDERLINE);
            decorate(painter, DecorationLine::OVERLINE);
            let strokes_first = style
                .svg
                .paint_order
                .0
                .iter()
                .find(|it| **it != PaintKind::Markers)
                == Some(&PaintKind::Stroke);
            for strokes in [strokes_first, !strokes_first] {
                match strokes {
                    true => painter.text_stroke(inline, line, fragment, run.clone(), style, space),
                    false => painter.glyphs(
                        inline,
                        line,
                        fragment,
                        run.clone(),
                        highlighted.unwrap_or(color),
                        0.0,
                        space.origin,
                        space,
                    ),
                }
            }
            painter.emphasis_marks(inline, line, fragment, &run, style, highlighted, space);
            decorate(painter, DecorationLine::LINE_THROUGH);
        };
        if marked.is_empty() {
            return paint(self, clusters.clone(), &[]);
        }
        let inside = |at: u32| at.clamp(clusters.start, clusters.end);
        let edges = marked
            .iter()
            .flat_map(|it| [inside(it.clusters.start), inside(it.clusters.end)]);
        let mut edges: SmallVec<[u32; 4]> = edges.chain([clusters.start, clusters.end]).collect();
        edges.sort_unstable();
        edges.dedup();
        let over = |at: u32| {
            marked
                .iter()
                .filter(|it| it.clusters.contains(&at))
                .collect::<SmallVec<[&Marked; 2]>>()
        };
        let (plain, highlighted): (SmallVec<[_; 2]>, _) = edges
            .array_windows()
            .map(|&[from, to]| (from..to, over(from)))
            .partition(|it| it.1.is_empty());
        plain.into_iter().for_each(|(run, _)| paint(self, run, &[]));
        for it in &marked {
            self.fill(square(it.rect), it.background, space);
            if let Some(by) = &it.style {
                self.text_shadows(
                    inline,
                    line,
                    fragment,
                    inside(it.clusters.start)..inside(it.clusters.end),
                    by,
                    &decorations,
                    space,
                );
            }
        }
        highlighted
            .into_iter()
            .for_each(|(run, over)| paint(self, run, &over));
    }
}

fn trimmed(inline: &Inline, line: &Line, fragment: &Fragment, at: u32) -> f32 {
    match inline.clusters[at as usize].flags & OPENING {
        0 => 0.0,
        _ => inline.trimmed_start(
            at,
            &inline.items[fragment.item as usize].style,
            at == line.clusters.start,
        ),
    }
}

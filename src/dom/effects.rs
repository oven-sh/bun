//! `clip-path`, `filter` and `mask`, for boxes and for the elements in an `svg`.

use crate::abi::{self, BlendMode, Item, Matrix, Outline, Rect, RoundedRect, Span};
use crate::background::Frame;
use crate::contour::{Contour, Edge};
use crate::document::Document;
use crate::name::name;
use crate::paint::{Painter, Space, blend_mode, square};
use crate::path::Path;
use crate::properties::Style;
use crate::shapes::Resolved;
use crate::svg::{Bounds, Node, scaling};
use crate::svg_filter::Input;
use crate::tree::NodeId;
use crate::types::*;

pub(crate) const BLACK: u32 = 0xff;

pub(crate) enum Areas<'a, 'b> {
    /// With the margin.
    Css(Frame, [f32; 4]),
    Svg(&'b Node<'a>),
}

pub(crate) struct Subject<'a, 'b> {
    pub(crate) document: &'a Document,
    pub(crate) node: NodeId,
    pub(crate) style: &'b Style,
    pub(crate) areas: Areas<'a, 'b>,
}

/// Where SVG resources are put.
#[derive(Clone, Copy)]
pub(crate) struct UserSpace {
    pub(crate) matrix: Matrix,
    /// What `objectBoundingBox` refers to.
    pub(crate) bounds: Rect,
}

impl<'a, 'b> Subject<'a, 'b> {
    pub(crate) fn svg(node: &'b Node<'a>) -> Self {
        Subject {
            document: node.document,
            node: node.id,
            style: &node.style,
            areas: Areas::Svg(node),
        }
    }

    /// What the lengths in the style are multiplied with.
    fn scale(&self) -> f32 {
        if let Areas::Svg(_) = self.areas {
            1.0 / self.style.zoom
        } else {
            1.0
        }
    }

    /// In the units of the style.
    pub(crate) fn area(&self, area: BoxArea) -> RoundedRect {
        match (&self.areas, area) {
            (Areas::Css(frame, margin), BoxArea::MarginBox) => frame.shape.outset(*margin),
            (Areas::Css(frame, _), _) => frame.area(area),
            (Areas::Svg(node), _) => square(
                self.document
                    .svg_reference_box(node, area)
                    .transformed(&scaling(self.style.zoom, self.style.zoom)),
            ),
        }
    }

    pub(crate) fn mask_element(&self, url: &str) -> Option<Node<'a>> {
        bun_core::strings::contains_char(url.as_bytes(), b'#')
            .then(|| self.document.svg_resource(self.node, url, name!("mask")))?
    }

    fn is_masked(&self) -> bool {
        let is_valid = |it: &Image| match it {
            Image::Url(url) if self.mask_element(url).is_some() => true,
            Image::Url(url) => {
                self.document.fragment_of(url).is_none()
                    && self.document.image(url).is_none_or(|it| it.image != 0)
            }
            _ => true,
        };
        self.style.has_mask()
            && (matches!(self.areas, Areas::Css(..))
                || self
                    .style
                    .mask
                    .image
                    .iter()
                    .any(|it| it.0.as_ref().is_some_and(is_valid)))
    }

    pub(crate) fn user_space(&self) -> UserSpace {
        match &self.areas {
            Areas::Css(frame, _) => UserSpace::of_box(frame.shape.rect, self.style.zoom),
            Areas::Svg(node) => UserSpace {
                matrix: IDENTITY,
                bounds: self
                    .document
                    .svg_bounds(node, Bounds::Fill)
                    .unwrap_or_default(),
            },
        }
    }
}

impl UserSpace {
    pub(crate) fn of_box(rect: Rect, zoom: f32) -> UserSpace {
        UserSpace {
            matrix: [zoom, 0.0, 0.0, zoom, rect.x, rect.y],
            bounds: Rect::new([0.0, 0.0, rect.width / zoom, rect.height / zoom]),
        }
    }
}

pub(crate) struct Effects<'a> {
    /// The bases to go back to.
    groups: [Option<u32>; 2],
    inputs: Vec<Input<'a>>,
    clips_with_mask: bool,
}

impl Effects<'_> {
    pub(crate) fn is_nested(&self) -> bool {
        self.groups.iter().all(Option::is_some)
    }
}

impl Document {
    /// What `ink` becomes. `reference` is the border box.
    pub(crate) fn filtered(&self, node: NodeId, style: &Style, ink: Rect, reference: Rect) -> Rect {
        style
            .effects
            .filter
            .0
            .iter()
            .fold(ink, |ink, filter| match filter {
                Filter::Amount(FilterName::Blur, radius) => ink.grown(radius * 3.0),
                Filter::DropShadow(it) => ink.union(&ink.moved(it.offset).grown(it.blur * 3.0)),
                Filter::Url(url) => {
                    self.svg_resource(node, url, name!("filter"))
                        .map_or(ink, |filter| {
                            let user = UserSpace::of_box(reference, style.zoom);
                            ink.union(
                                &filter
                                    .document
                                    .resource_region(&filter, name!("filterUnits"), user.bounds)
                                    .transformed(&user.matrix),
                            )
                        })
                }
                Filter::Amount(..) => ink,
            })
    }

    /// `None` if they take more than an intersection of shapes.
    fn clip_shapes(&self, subject: &Subject) -> Option<Vec<Resolved>> {
        let (style, mut shapes) = (subject.style, Vec::new());
        if let (Some(ClipRect([top, right, bottom, left])), true, Areas::Css(frame, _)) =
            (style.effects.clip.0, style.is_out_of_flow(), &subject.areas)
        {
            let border = frame.shape.rect;
            let clip = Rect::from_edges(
                left.unwrap_or(0.0),
                top.unwrap_or(0.0),
                right.unwrap_or(border.width),
                bottom.unwrap_or(border.height),
            );
            shapes.push(Resolved::Rounded(square(clip.moved([border.x, border.y]))));
        }
        match style.effects.clip_path.0.as_deref() {
            None => {}
            Some((Shape::Url(url), _)) => {
                if let Some(clip) = self.svg_resource(subject.node, url, name!("clipPath")) {
                    let user = subject.user_space();
                    let (path, rule) = clip.document.clip_outline(&clip)?;
                    let path = path.transformed(&multiply(
                        &user.matrix,
                        &clip.document.clip_matrix(&clip, user.bounds),
                    ));
                    shapes.push(path.as_rect().map_or(Resolved::Path(path, rule), |it| {
                        Resolved::Rounded(square(it))
                    }));
                }
            }
            Some((Shape::Box, area))
                if let Areas::Css(frame, margin) = &subject.areas
                    && let Some(contour) = Contour::of(style, frame) =>
            {
                let edge = if *area == BoxArea::MarginBox {
                    Edge::Outer(margin[0])
                } else {
                    Edge::from(*area)
                };
                shapes.push(Resolved::Path(
                    contour.edge(frame, edge).0,
                    FillRule::Nonzero,
                ));
            }
            Some((shape, area)) => {
                let resolved = crate::shapes::resolve(shape, &subject.area(*area), style.zoom);
                shapes.push(resolved.scaled(subject.scale()));
            }
        }
        Some(shapes)
    }

    /// Relative to the border box.
    pub(crate) fn clip_bounds(&self, id: crate::boxes::BoxId) -> Option<Rect> {
        let (it, margin) = (&self.boxes[id], self.boxes[id].layout.margin);
        it.style.effects.clip_path.0.as_ref()?;
        let areas = Areas::Css(
            self.frame_of(id, self.border_box(id)),
            [margin.top, margin.right, margin.bottom, margin.left],
        );
        let shapes = self.clip_shapes(&Subject {
            document: self,
            node: it.node,
            style: &it.style,
            areas,
        })?;
        shapes
            .into_iter()
            .map(|it| it.into_path().0.bounds().unwrap_or_default())
            .reduce(|a, b| a.intersection(&b))
    }

    /// If the `clipPath` is no more than that.
    fn clip_outline<'a>(&'a self, clip: &Node<'a>) -> Option<(Path, FillRule)> {
        clip.style.effects.clip_path.0.is_none().then_some(())?;
        match &self.svg_children(clip)[..] {
            [] => Some((Path::default(), FillRule::Nonzero)),
            [only] if only.style.effects.clip_path.0.is_none() && only.style.is_visible() => {
                Some((
                    self.rendered_path(only)?
                        .transformed(&self.svg_transform(only)),
                    only.style.svg.clip_rule,
                ))
            }
            _ => None,
        }
    }
}

impl<'a> Painter<'a> {
    pub(crate) fn outline_of(&mut self, path: &Path, rule: FillRule) -> Outline {
        let start = self.out.verbs.len() as u32;
        self.out.verbs.extend_from_slice(&path.verbs);
        let verbs = Span {
            start,
            end: self.out.verbs.len() as u32,
        };
        Outline {
            verbs,
            bounds: path.bounds().unwrap_or_default(),
            even_odd: rule == FillRule::Evenodd,
            ..Outline::default()
        }
    }

    pub(crate) fn floats(&mut self, numbers: impl IntoIterator<Item = f32>) -> Span {
        let start = self.out.bytes.len() as u32;
        self.out
            .bytes
            .extend(numbers.into_iter().flat_map(f32::to_ne_bytes));
        Span {
            start,
            end: self.out.bytes.len() as u32,
        }
    }

    pub(crate) fn clip_to(&mut self, shape: Resolved, space: &mut Space) {
        match shape {
            Resolved::Rounded(shape) => self.clip(shape, space),
            Resolved::Path(path, rule) => {
                let outline = self.outline_of(&path, rule);
                space.visible = space.visible.intersection(&outline.bounds.grown(1.0));
                self.link(Item::PushClipOutline(outline), space);
            }
        }
    }

    /// Whether that is left to `begin_effects`. What `escapes` is not painted in the space.
    pub(crate) fn clip_subject(
        &mut self,
        subject: &Subject,
        escapes: bool,
        space: &mut Space,
    ) -> bool {
        if subject.style.effects.clip_path.0.is_none() && subject.style.effects.clip.0.is_none() {
            return false;
        }
        let Some(shapes) = subject.document.clip_shapes(subject) else {
            return true;
        };
        let clips = !shapes.is_empty();
        shapes.into_iter().for_each(|it| self.clip_to(it, space));
        escapes && clips
    }

    /// What is black is kept.
    fn clip_mask(&mut self, subject: &Subject<'a, '_>, space: &Space) {
        if let Some((Shape::Url(url), _)) = subject.style.effects.clip_path.0.as_deref()
            && subject.document.clip_shapes(subject).is_none()
        {
            self.svg_clip(
                subject.document,
                subject.node,
                url,
                &subject.user_space(),
                space,
            );
        } else {
            self.fill(square(space.visible), BLACK, space);
        }
    }

    pub(crate) fn filters(
        &mut self,
        filters: &Filters,
        subject: &Subject<'a, '_>,
    ) -> (Span, Vec<Input<'a>>) {
        let (start, scale, mut inputs, mut is_tainted) = (
            self.out.filters.len() as u32,
            subject.scale(),
            Vec::new(),
            false,
        );
        for filter in filters.0.iter() {
            self.out.filters.push(match filter {
                Filter::Url(url) => {
                    let found = subject
                        .document
                        .svg_resource(subject.node, url, name!("filter"));
                    found
                        .into_iter()
                        .for_each(|it| self.svg_filter(&it, subject, &mut inputs, &mut is_tainted));
                    continue;
                }
                Filter::DropShadow(it) => abi::Filter::DropShadow {
                    offset: it.offset.map(|it| it * scale),
                    blur: it.blur * scale,
                    color: it.color.resolve(subject.style.color()),
                },
                Filter::Amount(FilterName::Blur, radius) => abi::Filter::Blur(radius * scale),
                Filter::Amount(name, amount) => (match name {
                    FilterName::Blur => abi::Filter::Blur,
                    FilterName::Brightness => abi::Filter::Brightness,
                    FilterName::Contrast => abi::Filter::Contrast,
                    FilterName::Grayscale => abi::Filter::Grayscale,
                    FilterName::HueRotate => abi::Filter::HueRotate,
                    FilterName::Invert => abi::Filter::Invert,
                    FilterName::Opacity => abi::Filter::Opacity,
                    FilterName::Saturate => abi::Filter::Saturate,
                    FilterName::Sepia => abi::Filter::Sepia,
                })(*amount),
            });
        }
        (
            Span {
                start,
                end: self.out.filters.len() as u32,
            },
            inputs,
        )
    }

    /// The first item is the layer that has the opacity, if there are any.
    pub(crate) fn begin_effects(
        &mut self,
        subject: &Subject<'a, '_>,
        clips_with_mask: bool,
        opacity: f32,
        isolates: bool,
        bounds: Rect,
        space: &Space,
    ) -> Effects<'a> {
        let (e, has_mask) = (&subject.style.effects, subject.is_masked());
        let (filters, inputs) = self.filters(&e.filter, subject);
        let fades = subject.document.opacity_in_cross_fade(subject.node);
        let opacity = fades.unwrap_or(opacity);
        let (blend, has_inner) = (
            if subject.node == self.captures || fades.is_some() {
                BlendMode::Normal
            } else {
                blend_mode(e.blend)
            },
            filters.start < filters.end || has_mask,
        );
        let groups = match clips_with_mask {
            true => [
                Some(self.begin_group(
                    space.visible.union(&bounds),
                    opacity,
                    blend,
                    Span::default(),
                    space,
                )),
                has_inner.then(|| self.begin_group(bounds, 1.0, BlendMode::Normal, filters, space)),
            ],
            false if has_inner || isolates || opacity < 1.0 || blend != BlendMode::Normal => [
                None,
                Some(self.begin_group(bounds, opacity, blend, filters, space)),
            ],
            false => [None; 2],
        };
        Effects {
            groups,
            inputs,
            clips_with_mask,
        }
    }

    /// `pieces` are what is masked if that is not the subject.
    pub(crate) fn end_effects(
        &mut self,
        subject: &Subject<'a, '_>,
        effects: &Effects<'a>,
        pieces: &[Subject<'a, '_>],
        space: &Space,
    ) {
        if let Some(base) = effects.groups[1] {
            effects
                .inputs
                .iter()
                .for_each(|it| self.filter_input(it, space));
            if subject.is_masked() {
                self.marker(Item::Mask { luminance: false });
                self.painted_node = 0;
                let mut inside = *space;
                if subject.scale() != 1.0 {
                    self.vector(scaling(subject.scale(), subject.scale()), &mut inside);
                }
                match pieces {
                    [] => self.mask_layers(subject, &inside, space),
                    pieces => pieces
                        .iter()
                        .for_each(|it| self.mask_layers(it, &inside, space)),
                }
            }
            self.end_group(base);
        }
        if let (Some(base), true) = (effects.groups[0], effects.clips_with_mask) {
            self.marker(Item::Mask { luminance: false });
            self.clip_mask(subject, space);
            self.end_group(base);
        }
    }
}

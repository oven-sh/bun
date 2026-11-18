//! Paints inline SVG.

use core::cell::OnceCell;
use core::ops::Range;
use std::rc::Rc;

use crate::abi::{self, BlendMode, GradientStop, Item, Matrix, Outline, Rect, Span, Stroke, Tile};
use crate::boxes::BoxId;
use crate::document::Document;
use crate::effects::{BLACK, Subject, UserSpace};
use crate::geometry::translation;
use crate::name::{Map, Name, is_name, name};
use crate::paint::{Painter, Picture, Space, alpha, square};
use crate::path::Path;
use crate::properties::Style;
use crate::segments::Shown;
use crate::selector::Pseudo;
use crate::svg::{
    Bounds, Node, fit_view, href, is_graphic, onto, passes_tests, rotation, scaling, view_box,
};
use crate::svg_text::{Placed, TextLayout};
use crate::svg_values::*;
use crate::tree::{Element, Namespace, NodeId, Tree};
use crate::types::*;
use crate::values::mix;

const MIN_PARTS: usize = 32;

/// What an `svg` has painted, with the origin in the corner of its border box.
pub(crate) struct Recording {
    picture: Picture,
    size: [f32; 4],
    scale: f32,
    /// If it depends on what is outside.
    generation: Option<u32>,
    /// `None` if it has colors that are not those of shapes.
    tints: Option<Vec<Tint>>,
    reads: Reads,
    blends: bool,
    /// Unless it is small.
    parts: Vec<Part>,
    /// The elements that have changed, and whether it is not only something in them.
    changed: Map<NodeId, bool>,
}

bitflags::bitflags! {
    /// What a picture depends on, other than the elements that it shows and the size of their viewport.
    #[derive(Clone, Copy, Default, PartialEq)]
    pub(crate) struct Reads: u8 {
        const REFERENCES = 1;
        const MATRIX = 1 << 1;
        const VISIBLE = 1 << 2;
        const ANYTHING = 1 << 3;
    }
}

/// What an element has painted, up to the `start` of the `next`. After the last child comes one without a node.
#[derive(Clone, Copy)]
struct Part {
    node: NodeId,
    start: Shown,
    tints: u32,
    next: u32,
    viewport: [f32; 2],
    reads: Reads,
}

struct Previous {
    recording: Recording,
    by_node: OnceCell<Map<NodeId, u32>>,
}

impl Previous {
    /// `expected` are the siblings that are left.
    fn find(&self, node: NodeId, expected: &Range<u32>) -> Option<u32> {
        let parts = &self.recording.parts;
        if expected.is_empty() || parts[expected.start as usize].node == node {
            return (!expected.is_empty()).then_some(expected.start);
        }
        self.by_node
            .get_or_init(|| parts.iter().map(|it| it.node).zip(0..).collect())
            .get(&node)
            .copied()
    }
}

/// The fill or the stroke of a shape.
#[derive(Clone, Copy)]
struct Tint {
    node: NodeId,
    kind: PaintKind,
    /// `None` if it is transparent.
    item: Option<u32>,
}

impl Recording {
    pub(crate) fn can_be_tinted(&self) -> bool {
        self.tints.is_some() && self.changed.is_empty()
    }

    /// False if it is of no use any more.
    pub(crate) fn note_change(
        &mut self,
        tree: &Tree,
        mut id: NodeId,
        outer: NodeId,
        is_itself: bool,
    ) -> bool {
        if self.changed.len() >= self.parts.len() / 2 {
            return false;
        }
        *self.changed.entry(id).or_default() |= is_itself;
        while id != outer {
            id = tree[id].parent;
            if self.changed.try_insert(id, false).is_err() {
                break;
            }
        }
        true
    }

    /// Also in `shown`, which begins with a copy of the items. False if it has to be recorded again.
    pub(crate) fn tint(&mut self, document: &Document, mut shown: Option<&mut [Item]>) -> bool {
        self.tints.iter().flatten().all(|it| {
            let new = Some(it.node)
                .filter(|it| document.tree.contains(*it))
                .and_then(|node| solid(document.tree.style(node)?, it.kind));
            let Some(at) = it.item else {
                return new.is_some_and(|it| alpha(it) == 0);
            };
            let Some(new) = new.filter(|it| alpha(*it) > 0) else {
                return false;
            };
            for item in [Some(&mut self.picture.items[..]), shown.as_deref_mut()]
                .into_iter()
                .flatten()
            {
                if let Item::Path { color, .. } | Item::Fill { color, .. } = &mut item[at as usize]
                {
                    *color = new;
                }
            }
            true
        })
    }
}

fn solid(style: &Style, kind: PaintKind) -> Option<u32> {
    let (paint, opacity) = if kind == PaintKind::Fill {
        (&style.svg.fill, style.svg.fill_opacity.0)
    } else {
        (&style.svg.stroke, style.svg.stroke_opacity.0)
    };
    if let SvgPaint::Color(color) = paint {
        Some(faded(color.resolve(style.color()), opacity))
    } else {
        None
    }
}

/// What `context-fill` and `context-stroke` refer to.
pub(crate) struct Context<'a> {
    node: Node<'a>,
    matrix: Matrix,
    outer: Option<Rc<Context<'a>>>,
}

#[derive(Default)]
pub(crate) struct Vector<'a> {
    /// Nothing is moved to whole pixels.
    pub(crate) is_on: bool,
    /// Only the outlines count.
    is_clip: bool,
    /// From the viewport to the outermost `svg`.
    to_root: Option<Matrix>,
    context: Option<Rc<Context<'a>>>,
    /// Those that are being painted.
    resources: Vec<(*const Document, NodeId)>,
    tints: Option<Vec<Tint>>,
    /// While it is recorded.
    parts: Option<Vec<Part>>,
    previous: Option<Rc<Previous>>,
    /// The previous parts of the children of the element that is being painted.
    inside: Range<u32>,
    outdated: Reads,
}

enum Brush<'a> {
    Color(u32),
    Shade {
        from: [f32; 3],
        to: [f32; 3],
        matrix: Matrix,
        stops: Vec<GradientStop>,
        spread: u8,
    },
    Pattern {
        content: Node<'a>,
        tile: Rect,
        matrix: Matrix,
        inside: Matrix,
        opacity: f32,
    },
}

fn faded(color: u32, opacity: f32) -> u32 {
    color & !0xff | (alpha(color) as f32 * opacity).round() as u32
}

fn in_linear_light(stops: &[GradientStop]) -> Vec<GradientStop> {
    let linear = |it: f32| {
        if it <= 0.04045 {
            it / 12.92
        } else {
            ((it + 0.055) / 1.055).powf(2.4)
        }
    };
    let encoded = |it: f32| {
        if it <= 0.003_130_8 {
            it * 12.92
        } else {
            1.055 * it.powf(1.0 / 2.4) - 0.055
        }
    };
    let between = stops.array_windows().flat_map(|[from, to]| {
        let [a, b] = [from, to].map(|it| it.color.to_be_bytes().map(|it| f32::from(it) / 255.0));
        (1..=64).map(move |step| {
            let at = step as f32 / 64.0;
            let part = |it: usize| {
                if it == 3 {
                    mix(a[3], b[3], at)
                } else {
                    encoded(mix(linear(a[it]), linear(b[it]), at))
                }
            };
            GradientStop {
                offset: mix(from.offset, to.offset, at),
                color: u32::from_be_bytes([0, 1, 2, 3].map(|it| (part(it) * 255.0).round() as u8)),
            }
        })
    });
    stops.first().copied().into_iter().chain(between).collect()
}

fn has_transform((node, element): &(Node, &Element)) -> bool {
    node.style.has_transform() || crate::svg::transform_attribute(element).is_some()
}

impl Document {
    pub(crate) fn svg_has_read(&self, what: Reads) {
        self.svg_reads.update(|it| it | what);
    }

    /// Whether what was painted last has nothing that is adapted to pixels.
    pub(crate) fn is_only_shapes(&self) -> bool {
        self.own_box(self.tree.root_element()).is_some_and(|it| {
            let reads = self.boxes.recordings.borrow().get(&it).map(|it| it.reads);
            self.boxes[it].children.is_empty()
                && self.boxes[it].style.is_bare()
                && reads.is_some_and(|it| !it.intersects(Reads::MATRIX | Reads::ANYTHING))
        })
    }

    /// `index` is that of `x`, `y`, `width` or `height`.
    pub(crate) fn length_in_units(
        &self,
        node: &Node,
        value: &str,
        index: usize,
        relative_to: Option<Rect>,
    ) -> Option<f32> {
        let (length, zoom) = (self.parse_svg_length(node, value)?, node.style.zoom);
        Some(relative_to.map_or_else(
            || node.resolve(&length, index % 2),
            |bounds| {
                let [x, y, width, height] = bounds.to_array();
                [x, y, 0.0, 0.0][index] + length.resolve(zoom) / zoom * [width, height][index % 2]
            },
        ))
    }

    /// Of a `filter` or a `mask`.
    pub(crate) fn resource_region(&self, node: &Node, units: Name, bounds: Rect) -> Rect {
        let attribute = |name| node.element.attribute(name);
        let relative_to = (attribute(units) != Some("userSpaceOnUse")).then_some(bounds);
        let parts = [
            (name!("x"), "-10%"),
            (name!("y"), "-10%"),
            (name!("width"), "120%"),
            (name!("height"), "120%"),
        ];
        Rect::new([0, 1, 2, 3].map(|it| {
            let resolve = |value| self.length_in_units(node, value, it, relative_to);
            attribute(parts[it].0)
                .and_then(resolve)
                .or_else(|| resolve(parts[it].1))
                .unwrap_or(0.0)
        }))
    }

    /// The paint server, and those that it takes what it lacks from.
    fn templates<'a>(&'a self, first: Node<'a>) -> Vec<(Node<'a>, &'a Element)> {
        let (is_pattern, mut chain, mut next) = (
            first.tag == name!("pattern"),
            Vec::<(Node, &Element)>::new(),
            Some(first),
        );
        while let Some(node) = next
            .take()
            .filter(|it| chain.len() < 64 && chain.iter().all(|known| known.0.id != it.id))
        {
            let element = node.element;
            let is_alike = |it: &Node| {
                if is_pattern {
                    it.tag == name!("pattern")
                } else {
                    is_name!(it.tag, "linearGradient" | "radialGradient")
                }
            };
            next = href(element)
                .and_then(|it| {
                    self.svg_node(self.svg_element_by_id(node.id, self.fragment_of(it)?)?)
                })
                .filter(is_alike);
            chain.push((node, element));
        }
        chain
    }

    fn gradient<'a>(
        &'a self,
        server: Node<'a>,
        user: &UserSpace,
        opacity: f32,
    ) -> Option<Brush<'a>> {
        let (tag, chain) = (server.tag, self.templates(server));
        let attribute = |name, valid: &[&str]| {
            chain
                .iter()
                .find_map(|it| it.1.attribute(name).filter(|it| valid.contains(it)))
        };
        let is_relative = attribute(
            name!("gradientUnits"),
            &["userSpaceOnUse", "objectBoundingBox"],
        ) != Some("userSpaceOnUse");
        (!is_relative || !user.bounds.is_empty()).then_some(())?;
        let resolve = |node: &Node, value, axis| {
            let length = self.parse_svg_length(node, value)?;
            Some(if is_relative {
                length.resolve(node.style.zoom) / node.style.zoom
            } else {
                node.resolve(&length, axis)
            })
        };
        let given = |name, axis| {
            chain
                .iter()
                .filter(|it| it.0.tag == tag)
                .find_map(|it| resolve(&it.0, it.1.attribute(name)?, axis))
        };
        let length = |name, axis, default| {
            given(name, axis)
                .or_else(|| resolve(&chain[0].0, default, axis))
                .unwrap_or(0.0)
        };
        let is_stop = |it: &NodeId| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.tag == name!("stop") && it.namespace == Namespace::Svg)
        };
        let (mut stops, mut offset) = (Vec::new(), 0.0f32);
        let owner = chain
            .iter()
            .find(|it| self.tree.element_children(it.0.id).any(|it| is_stop(&it)));
        for stop in owner
            .into_iter()
            .flat_map(|it| self.tree.element_children(it.0.id))
            .filter(is_stop)
        {
            let (value, style) = (
                self.tree
                    .element(stop)?
                    .attribute(name!("offset"))
                    .unwrap_or_default()
                    .trim_ascii(),
                self.style_on_demand(stop)?,
            );
            let own = value.strip_suffix('%').map_or_else(
                || value.parse().ok(),
                |it| Some(it.parse::<f32>().ok()? / 100.0),
            );
            offset = offset.max(own.unwrap_or(0.0).min(1.0));
            stops.push(GradientStop {
                offset,
                color: faded(
                    style.shape.stop_color.resolve(style.color()),
                    style.shape.stop_opacity.0 * opacity,
                ),
            });
        }
        if chain[0].0.style.svg.color_interpolation == ColorInterpolation::LinearRgb {
            stops = in_linear_light(&stops);
        }
        let Some(last) = stops.last().map(|it| it.color) else {
            return Some(Brush::Color(0));
        };
        let (from, to) = if tag == name!("linearGradient") {
            (
                [
                    length(name!("x1"), 0, "0%"),
                    length(name!("y1"), 1, "0%"),
                    -1.0,
                ],
                [
                    length(name!("x2"), 0, "100%"),
                    length(name!("y2"), 1, "0%"),
                    -1.0,
                ],
            )
        } else {
            let to = [
                length(name!("cx"), 0, "50%"),
                length(name!("cy"), 1, "50%"),
                length(name!("r"), 2, "50%").max(0.0),
            ];
            (
                [
                    given(name!("fx"), 0).unwrap_or(to[0]),
                    given(name!("fy"), 1).unwrap_or(to[1]),
                    length(name!("fr"), 2, "0%").max(0.0),
                ],
                to,
            )
        };
        if stops.len() == 1 || from == to || to[2] == 0.0 && from[2] == 0.0 {
            return Some(Brush::Color(last));
        }
        let own = chain
            .iter()
            .find(|it| has_transform(it))
            .map_or(IDENTITY, |it| self.resource_transform(&it.0, user.bounds));
        let matrix = multiply(
            &user.matrix,
            &multiply(
                &if is_relative {
                    onto(user.bounds)
                } else {
                    IDENTITY
                },
                &own,
            ),
        );
        let spread = match attribute(name!("spreadMethod"), &["pad", "reflect", "repeat"]) {
            Some("reflect") => abi::SPREAD_REFLECT,
            Some("repeat") => abi::SPREAD_REPEAT,
            _ => abi::SPREAD_PAD,
        };
        if spread != abi::SPREAD_PAD {
            stops.insert(
                0,
                GradientStop {
                    offset: 0.0,
                    ..stops[0]
                },
            );
            stops.push(GradientStop {
                offset: 1.0,
                color: last,
            });
        }
        invert(&matrix).map(|_| Brush::Shade {
            from,
            to,
            matrix,
            stops,
            spread,
        })
    }

    fn pattern<'a>(
        &'a self,
        server: Node<'a>,
        user: &UserSpace,
        opacity: f32,
    ) -> Option<Brush<'a>> {
        let chain = self.templates(server);
        let units = |name| {
            chain.iter().find_map(|it| {
                it.1.attribute(name)
                    .filter(|it| matches!(*it, "userSpaceOnUse" | "objectBoundingBox"))
            })
        };
        let relative_to =
            (units(name!("patternUnits")) != Some("userSpaceOnUse")).then_some(user.bounds);
        let names = [name!("x"), name!("y"), name!("width"), name!("height")];
        let part = |index: usize| {
            chain.iter().find_map(|it| {
                self.length_in_units(&it.0, it.1.attribute(names[index])?, index, relative_to)
            })
        };
        let origin = relative_to.map_or([0.0; 2], |it| [it.x, it.y]);
        let tile = Rect::new(
            [0, 1, 2, 3].map(|it| part(it).or_else(|| origin.get(it).copied()).unwrap_or(0.0)),
        );
        let content = &chain
            .iter()
            .find(|it| self.tree.element_children(it.0.id).next().is_some())?
            .0;
        let view = chain.iter().find_map(|it| view_box(it.1));
        (!tile.is_empty() && !view.is_some_and(|it| it.is_empty())).then_some(())?;
        let inside = match view {
            Some(view) => fit_view(
                chain
                    .iter()
                    .find(|it| it.1.has(name!("preserveAspectRatio")))
                    .unwrap_or(&chain[0])
                    .1,
                view,
                [tile.width, tile.height],
            ),
            None if units(name!("patternContentUnits")) == Some("objectBoundingBox") => {
                scaling(user.bounds.width, user.bounds.height)
            }
            None => IDENTITY,
        };
        let own = chain
            .iter()
            .find(|it| has_transform(it))
            .map_or(IDENTITY, |it| self.resource_transform(&it.0, user.bounds));
        let (matrix, inside) = (
            multiply(&user.matrix, &own),
            multiply(&translation([tile.x, tile.y]), &inside),
        );
        invert(&matrix)
            .and_then(|_| invert(&inside))
            .map(|_| Brush::Pattern {
                content: content.clone(),
                tile,
                matrix,
                inside,
                opacity,
            })
    }
}

impl<'a> Painter<'a> {
    pub(crate) fn vector(&mut self, matrix: Matrix, space: &mut Space) -> bool {
        let Some(inverse) = invert(&matrix) else {
            return false;
        };
        (space.visible, space.origin) = (space.visible.transformed(&inverse), [0.0; 2]);
        self.link(&Item::PushVector(matrix), space);
        true
    }

    /// Unless that would never end.
    pub(crate) fn with_resource(&mut self, node: &Node, paint: impl FnOnce(&mut Self)) {
        if !self.svg.is_on {
            self.document.reset_svg_budget();
        }
        if self.svg.resources.len() < 16
            && !self.svg.resources.contains(&node.key())
            && self.document.spend_svg_budget()
        {
            let was_on = core::mem::replace(&mut self.svg.is_on, true);
            self.depends_on_outside();
            self.svg.tints = None;
            self.svg.resources.push(node.key());
            paint(self);
            self.svg.resources.pop();
            self.svg.is_on = was_on;
        }
    }

    fn matrix_in_svg(&self, space: &Space) -> Matrix {
        self.document.svg_has_read(Reads::MATRIX);
        multiply(
            &self.svg.to_root.unwrap_or(IDENTITY),
            &self.out.links[space.link as usize].matrix,
        )
    }

    /// `clip` is relative to the border box.
    pub(crate) fn svg_root(&mut self, id: BoxId, space: &Space) {
        let (document, mut inside) = (self.document, *space);
        let it = &document.boxes[id];
        let [x, y, ..] = document.content_box(id);
        let origin = [
            self.snap(space.origin[0] + x) - x,
            self.snap(space.origin[1] + y) - y,
        ];
        self.vector(translation(origin), &mut inside);
        if !it.children.is_empty() {
            self.depends_on_outside();
            self.svg_contents(id, &inside, Vector::default());
            return;
        }
        let (size, scale, known) = (
            document.content_box(id),
            document.environment.scale,
            document.boxes.recordings.borrow_mut().remove(&id),
        );
        let (blends, mut outdated) = (document.blends_in_svg.get(), Reads::ANYTHING);
        if let Some(known) = &known {
            outdated.set(
                Reads::MATRIX | Reads::VISIBLE,
                (known.size, known.scale) != (size, scale)
                    || known.changed.get(&it.node) == Some(&true),
            );
            outdated.set(
                Reads::REFERENCES,
                known
                    .generation
                    .is_some_and(|it| it != document.svg_generation),
            );
        }
        let recording = match known {
            Some(known) if outdated == Reads::ANYTHING && known.changed.is_empty() => known,
            known => {
                let (mut painter, outer) = (
                    Painter::new(document, None, Picture::default(), Default::default()),
                    document.svg_reads.take(),
                );
                let previous = known.filter(|it| !it.parts.is_empty() && it.blends == blends);
                previous
                    .iter()
                    .for_each(|it| painter.out.reserve_like(&it.picture));
                let vector = Vector {
                    tints: previous
                        .as_ref()
                        .is_none_or(|it| it.tints.is_some())
                        .then(Vec::new),
                    parts: Some(Vec::with_capacity(
                        previous.as_ref().map_or(0, |it| it.parts.len() + 8),
                    )),
                    inside: 0..previous.as_ref().map_or(0, |it| it.parts.len() as u32 - 1),
                    previous: previous.map(|recording| {
                        Rc::new(Previous {
                            recording,
                            by_node: OnceCell::new(),
                        })
                    }),
                    outdated,
                    ..Vector::default()
                };
                painter.painted_node = it.node;
                let Vector { tints, parts, .. } = painter.svg_contents(
                    id,
                    &Space {
                        origin: [0.0; 2],
                        link: 0,
                        scroller: abi::NO_SCROLLER,
                        visible: document.ink(id),
                    },
                    vector,
                );
                painter.enter(0);
                if painter.is_volatile {
                    self.depends_on_outside();
                }
                let (reads, parts) = (
                    document.svg_reads.replace(outer),
                    parts.filter(|it| it.len() >= MIN_PARTS).unwrap_or_default(),
                );
                let generation = reads.contains(Reads::REFERENCES).then_some(
                    document
                        .svg_generation
                        .wrapping_sub(painter.is_volatile.into()),
                );
                Recording {
                    picture: painter.out,
                    size,
                    scale,
                    generation,
                    tints: tints.filter(|_| generation.is_none()),
                    reads,
                    blends,
                    parts,
                    changed: Map::default(),
                }
            }
        };
        if !self.is_hidden && !recording.picture.items.is_empty() {
            self.enter(inside.link);
            self.note_recording(id);
            self.out.append(&recording.picture);
        }
        document.boxes.recordings.borrow_mut().insert(id, recording);
    }

    fn svg_contents(&mut self, id: BoxId, space: &Space, vector: Vector<'a>) -> Vector<'a> {
        let document = self.document;
        let Some(root) = document.svg_node(document.boxes[id].node) else {
            return Vector::default();
        };
        let to_root = invert(&self.out.links[space.link as usize].matrix);
        let (outer, mut inside) = (
            core::mem::replace(
                &mut self.svg,
                Vector {
                    is_on: true,
                    to_root,
                    ..vector
                },
            ),
            *space,
        );
        document.reset_svg_budget();
        if document.tree.is_root(root.id) {
            self.clip(square(Rect::new(document.content_box(id))), &mut inside);
        }
        if document
            .svg_to_parent(&root)
            .is_some_and(|it| self.vector(it, &mut inside))
        {
            self.svg_children(&root, &inside);
        }
        core::mem::replace(&mut self.svg, outer)
    }

    fn svg_children(&mut self, node: &Node<'a>, space: &Space) {
        if self.svg.parts.is_some()
            && self.svg.resources.is_empty()
            && !is_name!(node.tag, "use" | "switch")
        {
            return self.record_children(node, space);
        }
        let parts = self.svg.parts.take();
        node.document
            .svg_children(node)
            .iter()
            .for_each(|it| self.svg_element(it, space));
        self.svg.parts = parts;
    }

    fn begin_part(&mut self, node: NodeId, viewport: [f32; 2]) -> usize {
        let (parts, tints) = (
            self.svg.parts.get_or_insert_default(),
            self.svg.tints.as_ref().map_or(0, Vec::len) as u32,
        );
        parts.push(Part {
            node,
            start: Shown::of(&self.out),
            tints,
            next: parts.len() as u32 + 1,
            viewport,
            reads: Reads::empty(),
        });
        parts.len() - 1
    }

    fn copy_parts(&mut self, previous: Option<&Previous>, range: Range<u32>) {
        let Some(Previous {
            recording: from, ..
        }) = previous.filter(|_| !range.is_empty())
        else {
            return;
        };
        let (first, end, start) = (
            &from.parts[range.start as usize],
            &from.parts[range.end as usize],
            Shown::of(&self.out),
        );
        self.out
            .append_part(&from.picture, &first.start, &end.start);
        let (parts, mut first_tint) = (self.svg.parts.get_or_insert_default(), 0);
        if let (Some(tints), Some(from)) = (&mut self.svg.tints, &from.tints) {
            first_tint = tints.len() as u32;
            let moved = |it: &Tint| Tint {
                item: it.item.map(|it| it - first.start.items() + start.items()),
                ..*it
            };
            tints.extend(
                from[first.tints as usize..end.tints as usize]
                    .iter()
                    .map(moved),
            );
        }
        let at = parts.len() as u32;
        parts.extend(
            from.parts[range.start as usize..range.end as usize]
                .iter()
                .map(|it| Part {
                    start: it.start.moved(&first.start, &start),
                    tints: it.tints.wrapping_sub(first.tints).wrapping_add(first_tint),
                    next: it.next - range.start + at,
                    ..*it
                }),
        );
    }

    /// What has not changed is copied.
    fn record_children(&mut self, node: &Node<'a>, space: &Space) {
        let (document, previous, outdated) =
            (self.document, self.svg.previous.clone(), self.svg.outdated);
        let (previous, viewport) = (previous.as_deref(), document.viewport_in(node));
        let (mut expected, mut unchanged) = (core::mem::take(&mut self.svg.inside), 0..0);
        self.enter(space.link);
        for id in document.tree.element_children(node.id) {
            let Some(element) = document.tree.element(id).filter(|it| is_graphic(it)) else {
                continue;
            };
            let known = previous.and_then(|it| {
                it.find(id, &expected)
                    .map(|at| (at, &it.recording.parts[at as usize]))
            });
            let change = previous.and_then(|it| it.recording.changed.get(&id));
            if let Some((_, part)) = known.filter(|it| expected.contains(&it.0)) {
                expected.start = part.next;
            }
            if let Some((at, part)) = known.filter(|(_, it)| {
                change.is_none() && it.viewport == viewport && !it.reads.intersects(outdated)
            }) {
                if unchanged.end != at {
                    self.copy_parts(previous, core::mem::replace(&mut unchanged, at..at));
                }
                unchanged.end = part.next;
                document.svg_has_read(part.reads);
                continue;
            }
            self.copy_parts(previous, core::mem::take(&mut unchanged));
            let (own, reads, was_volatile) = (
                self.begin_part(id, viewport),
                document.svg_reads.take(),
                core::mem::take(&mut self.is_volatile),
            );
            self.svg.inside = known.map_or(0..0, |(at, part)| at + 1..part.next - 1);
            self.svg.outdated = if change == Some(&true) {
                outdated | Reads::MATRIX | Reads::VISIBLE
            } else {
                outdated
            };
            if let Some(child) = passes_tests(element)
                .then(|| document.svg_child(node, id, viewport))
                .flatten()
            {
                self.svg_element(&child, space);
                self.enter(space.link);
            }
            if self.is_volatile || element.style.is_none() {
                document.svg_has_read(Reads::ANYTHING);
            }
            if let Some(parts) = &mut self.svg.parts {
                (parts[own].next, parts[own].reads) =
                    (parts.len() as u32, document.svg_reads.get());
            }
            document.svg_has_read(reads);
            self.is_volatile |= was_volatile;
        }
        self.copy_parts(previous, unchanged);
        self.begin_part(0, viewport);
        self.svg.outdated = outdated;
    }

    fn with_context(&mut self, node: &Node<'a>, space: &Space, paint: impl FnOnce(&mut Self)) {
        let (matrix, outer) = (
            self.out.links[space.link as usize].matrix,
            self.svg.context.take(),
        );
        self.svg.context = Some(Rc::new(Context {
            node: node.clone(),
            matrix,
            outer: outer.clone(),
        }));
        paint(self);
        self.svg.context = outer;
    }

    /// `space` is the user space of the parent.
    pub(crate) fn svg_element(&mut self, node: &Node<'a>, space: &Space) {
        let (document, mut space, is_clip) = (node.document, *space, self.svg.is_clip);
        if node.tag == name!("foreignObject") {
            return self.foreign_object(node, space);
        }
        let Some(mut matrix) = document.svg_to_parent(node) else {
            return;
        };
        let outside = space;
        if node.establishes_viewport() && node.clips_overflow() {
            let own = document.svg_transform(node);
            if own != IDENTITY && !self.vector(own, &mut space) {
                return;
            }
            self.clip(square(document.viewport_rect(node)), &mut space);
            matrix = document.view_transform(node).unwrap_or(IDENTITY);
        }
        let (e, subject) = (&node.style.effects, Subject::svg(node));
        if matrix != IDENTITY && !self.vector(matrix, &mut space) || e.opacity.0 == 0.0 && !is_clip
        {
            return;
        }
        let clips_with_mask = self.clip_subject(&subject, false, &mut space);
        if is_clip {
            let group = clips_with_mask.then(|| {
                self.begin_group(
                    space.visible,
                    1.0,
                    BlendMode::Normal,
                    Span::default(),
                    &space,
                )
            });
            self.svg_graphic(node, &space);
            if let (Some(base), Some((Shape::Url(url), _))) = (group, e.clip_path.0.as_deref()) {
                self.marker(&Item::Mask { luminance: false });
                self.svg_clip(document, node.id, url, &subject.user_space(), &space);
                self.end_group(base);
            }
            return;
        }
        let (isolates, mut source) = (
            e.isolation == Isolation::Isolate
                || e.clip_path.0.is_some() && document.blends_in_svg.get(),
            space,
        );
        if !e.filter.0.is_empty() {
            if is_name!(
                node.tag,
                "rect" | "circle" | "ellipse" | "path" | "polyline" | "polygon" | "image"
            ) && !document.has_geometry(node)
            {
                return;
            }
            source.visible = document.svg_bounds(node, Bounds::Ink).unwrap_or_default();
        }
        if !e.filter.0.is_empty()
            || node.style.has_mask()
            || node.style.outline_width() > 0.0
            || is_name!(node.tag, "use" | "text")
        {
            self.svg.tints = None;
        }
        let effects = self.begin_effects(
            &subject,
            clips_with_mask,
            e.opacity.0,
            isolates,
            source.visible,
            &space,
        );
        self.svg_graphic(node, &source);
        self.end_effects(&subject, &effects, &[], &space);
        if node.style.outline_width() > 0.0
            && let Some(bounds) = document.svg_bounds(node, Bounds::Stroke)
        {
            let (zoom, mut space) = (node.style.zoom, outside);
            self.vector(
                multiply(
                    &document.svg_to_parent(node).unwrap_or(IDENTITY),
                    &scaling(1.0 / zoom, 1.0 / zoom),
                ),
                &mut space,
            );
            self.outline(
                &node.style,
                bounds.transformed(&scaling(zoom, zoom)),
                &space,
            );
        }
    }

    fn svg_graphic(&mut self, node: &Node<'a>, space: &Space) {
        match node.tag {
            tag if tag == name!("use") => {
                self.with_context(node, space, |painter| painter.svg_children(node, space))
            }
            _ if node.is_container() => self.svg_children(node, space),
            tag if tag == name!("text") => self.svg_text(node, space),
            _ if !node.style.is_visible() => {}
            tag if tag == name!("image") => {
                self.svg_image(node, node.document.svg_rect(node), space)
            }
            _ => self.svg_shape(node, space),
        }
    }

    fn foreign_object(&mut self, node: &Node, mut space: Space) {
        let Some(id) = self.document.own_box(node.id).filter(|_| {
            self.svg.resources.is_empty() && core::ptr::eq(self.document, node.document)
        }) else {
            return;
        };
        let zoom = node.style.zoom;
        let matrix = multiply(
            &self.document.svg_transform(node),
            &scaling(1.0 / zoom, 1.0 / zoom),
        );
        let Some(inverse) = invert(&matrix) else {
            return;
        };
        space.visible = space.visible.transformed(&inverse);
        self.link(&Item::PushTransform(matrix), &mut space);
        let outer = core::mem::take(&mut self.svg);
        self.stacking_context(id, self.place(id, &space));
        self.svg = outer;
    }

    pub(crate) fn svg_image(&mut self, node: &Node, rect: Rect, space: &Space) {
        let (Some(image), element) = (
            node.document.svg_image(node).filter(|it| it.image != 0),
            node.element,
        ) else {
            return;
        };
        let [width, height] = crate::background::concrete_size(
            [None; 2],
            image.size,
            image.ratio,
            [rect.width, rect.height],
        );
        let view = Rect::new([0.0, 0.0, width, height]);
        if !rect.is_empty() && !view.is_empty() {
            let shown = view
                .transformed(&fit_view(element, view, [rect.width, rect.height]))
                .moved([rect.x, rect.y]);
            let clip = square(if node.clips_overflow() || node.tag != name!("image") {
                rect
            } else {
                shown
            });
            let (mut inside, zoom) = (*space, node.style.zoom);
            self.clip(clip, &mut inside);
            if crate::embedded::is_vector(image.image) {
                let (rect, stretches) = (
                    shown.transformed(&scaling(zoom, zoom)),
                    element
                        .attribute(name!("preserveAspectRatio"))
                        .is_some_and(|it| it.trim_ascii() == "none"),
                );
                self.vector(scaling(1.0 / zoom, 1.0 / zoom), &mut inside);
                let paint = |painter: &mut Self, space: &Space| {
                    painter.vector_image(
                        image.image,
                        [[rect.width, rect.height]; 2],
                        stretches,
                        &node.style,
                        space,
                    )
                };
                return self.tiled(
                    square(rect),
                    Tile {
                        rect,
                        step: [0.0; 2],
                    },
                    &inside,
                    paint,
                );
            }
            self.vector(onto(shown), &mut inside);
            self.vector(
                scaling(1.0 / width / zoom, 1.0 / height / zoom),
                &mut inside,
            );
            let rect = view.transformed(&scaling(zoom, zoom));
            self.draw_image(
                square(rect),
                Tile {
                    rect,
                    step: [0.0; 2],
                },
                image.image,
                &node.style,
                &inside,
            );
        }
    }

    /// `to_space` is from the user space of the element to where it is painted.
    fn brush(
        &self,
        node: &Node<'a>,
        kind: PaintKind,
        bounds: &dyn Fn() -> Rect,
        to_space: &Matrix,
        space: &Space,
    ) -> Option<Brush<'a>> {
        let of = |node: &'_ Node, kind| {
            (if kind == PaintKind::Fill {
                &node.style.svg.fill
            } else {
                &node.style.svg.stroke
            })
            .clone()
        };
        let opacity = if kind == PaintKind::Fill {
            node.style.svg.fill_opacity.0
        } else {
            node.style.svg.stroke_opacity.0
        };
        let (mut paint, mut owner, mut source, mut context) =
            (of(node, kind), node, None, self.svg.context.as_deref());
        while let SvgPaint::ContextFill | SvgPaint::ContextStroke = paint {
            let found = context?;
            paint = of(
                &found.node,
                if paint == SvgPaint::ContextFill {
                    PaintKind::Fill
                } else {
                    PaintKind::Stroke
                },
            );
            (owner, source, context) = (&found.node, Some(found), found.outer.as_deref());
        }
        let color = match paint {
            SvgPaint::Color(color) => color,
            SvgPaint::Url(url, fallback) => {
                let user = || match source {
                    None => Some(UserSpace {
                        matrix: *to_space,
                        bounds: bounds(),
                    }),
                    Some(source) => Some(UserSpace {
                        matrix: multiply(
                            &invert(&self.out.links[space.link as usize].matrix)?,
                            &source.matrix,
                        ),
                        bounds: owner
                            .document
                            .svg_bounds(owner, Bounds::Fill)
                            .unwrap_or_default(),
                    }),
                };
                let server = owner.document.svg_resource_with(owner.id, &url, |tag| {
                    is_name!(tag, "linearGradient" | "radialGradient" | "pattern")
                });
                let brush = server
                    .filter(|it| !self.svg.resources.contains(&it.key()))
                    .and_then(|server| match server.tag == name!("pattern") {
                        true => server.document.pattern(server, &user()?, opacity),
                        false => server.document.gradient(server, &user()?, opacity),
                    });
                match brush {
                    Some(brush) => return Some(brush),
                    None => fallback?.0?,
                }
            }
            _ => return None,
        };
        Some(Brush::Color(faded(
            color.resolve(node.style.color()),
            opacity,
        )))
    }

    fn cover(&mut self, brush: &Brush<'a>, bounds: Rect, space: &Space) {
        match brush {
            Brush::Color(color) => self.fill(square(bounds), *color, space),
            Brush::Shade {
                from,
                to,
                matrix,
                stops,
                spread,
            } => {
                let start = self.out.stops.len() as u32;
                self.out.stops.extend_from_slice(stops);
                let stops = Span {
                    start,
                    end: self.out.stops.len() as u32,
                };
                self.emit(
                    &Item::Shade {
                        bounds,
                        from: *from,
                        to: *to,
                        matrix: *matrix,
                        stops,
                        spread: *spread,
                    },
                    space,
                );
            }
            Brush::Pattern {
                content,
                tile,
                matrix,
                inside,
                opacity,
            } => {
                let group = (*opacity < 1.0).then(|| {
                    self.begin_group(bounds, *opacity, BlendMode::Normal, Span::default(), space)
                });
                let mut cell = Space {
                    visible: *tile,
                    ..*space
                };
                self.link(
                    &Item::PushPattern {
                        bounds,
                        tile: Tile {
                            rect: *tile,
                            step: [tile.width, tile.height],
                        },
                        matrix: *matrix,
                    },
                    &mut cell,
                );
                self.vector(*inside, &mut cell);
                let context = self.svg.context.take();
                self.with_resource(content, |painter| painter.svg_children(content, &cell));
                self.svg.context = context;
                group.into_iter().for_each(|it| self.end_group(it));
            }
        }
    }

    fn paint_outline(&mut self, outline: Outline, brush: &Brush<'a>, space: &Space) {
        if let Brush::Color(color) = brush {
            if alpha(*color) > 0 {
                self.emit(
                    &Item::Path {
                        outline,
                        color: *color,
                    },
                    space,
                );
            }
            return;
        }
        let mut inside = *space;
        self.link(&Item::PushClipOutline(outline), &mut inside);
        self.cover(brush, outline.bounds, &inside);
    }

    /// `scale` is for everything, and `dash_scale` for the dashes.
    fn stroke_of(&mut self, node: &Node, scale: f32, dash_scale: f32) -> Stroke {
        let svg = &node.style.svg;
        let mut dashes: Vec<_> = svg
            .dasharray
            .0
            .0
            .iter()
            .map(|it| node.resolve(&it.0, 2) * scale * dash_scale)
            .collect();
        if !dashes.iter().sum::<f32>().is_normal() {
            dashes.clear();
        } else if dashes.len() % 2 == 1 {
            dashes.extend_from_within(..);
        }
        Stroke {
            width: node.stroke_width() * scale,
            miter_limit: svg.miterlimit.0,
            dash_offset: node.resolve(&svg.dashoffset.0, 2) * scale * dash_scale,
            dashes: self.floats(dashes),
            cap: match svg.linecap {
                LineCap::Butt => abi::CAP_BUTT,
                LineCap::Round => abi::CAP_ROUND,
                LineCap::Square => abi::CAP_SQUARE,
            },
            join: match svg.linejoin {
                LineJoin::Miter => abi::JOIN_MITER,
                LineJoin::Round => abi::JOIN_ROUND,
                LineJoin::Bevel => abi::JOIN_BEVEL,
            },
        }
    }

    fn svg_shape(&mut self, node: &Node<'a>, space: &Space) {
        let (document, svg) = (node.document, &node.style.svg);
        let Some(path) = document
            .rendered_path(node)
            .filter(|it| !it.verbs.is_empty())
        else {
            return;
        };
        let crisp = matches!(
            svg.shape_rendering,
            ShapeRendering::CrispEdges | ShapeRendering::OptimizeSpeed
        );
        let fill = Outline {
            crisp,
            ..self.outline_of(
                &path,
                if self.svg.is_clip {
                    svg.clip_rule
                } else {
                    svg.fill_rule
                },
            )
        };
        let rect = path.as_rect().filter(|_| !crisp);
        if self.svg.is_clip {
            return self.emit(
                &rect.map_or(
                    Item::Path {
                        outline: fill,
                        color: BLACK,
                    },
                    |it| Item::Fill {
                        shape: square(it),
                        color: BLACK,
                    },
                ),
                space,
            );
        }
        for kind in svg.paint_order.0 {
            if !self.is_hidden {
                self.enter(space.link);
            }
            let before = self.out.items.len();
            match kind {
                PaintKind::Fill => {
                    let brush = self.brush(node, kind, &|| fill.bounds, &IDENTITY, space);
                    match (brush, rect) {
                        (Some(brush @ Brush::Shade { .. }), Some(rect)) => {
                            let mut inside = *space;
                            self.clip(square(rect), &mut inside);
                            self.cover(&brush, rect, &inside);
                        }
                        (Some(brush), Some(rect)) => self.cover(&brush, rect, space),
                        (Some(brush), None) => self.paint_outline(fill, &brush, space),
                        (None, _) => {}
                    }
                }
                PaintKind::Stroke if svg.stroke == SvgPaint::None || node.stroke_width() <= 0.0 => {
                }
                PaintKind::Stroke => {
                    let (mut outline, mut space, mut to_space, mut scale) =
                        (fill, *space, IDENTITY, 1.0);
                    let dash_scale = if svg.dasharray.0.0.is_empty() {
                        1.0
                    } else {
                        document.path_scale(node.id, &path)
                    };
                    if node.style.shape.vector_effect == VectorEffect::NonScalingStroke {
                        (to_space, scale) = (self.matrix_in_svg(&space), node.style.zoom);
                        if !invert(&to_space).is_some_and(|it| self.vector(it, &mut space)) {
                            continue;
                        }
                        outline = Outline {
                            crisp,
                            ..self.outline_of(&path.clone().transformed(&to_space), svg.fill_rule)
                        };
                    }
                    let Some(brush) = self.brush(node, kind, &|| fill.bounds, &to_space, &space)
                    else {
                        continue;
                    };
                    let bounds = outline
                        .bounds
                        .grown(Document::stroke_reach(node, false) * scale);
                    let stroke = self.stroke_of(node, scale, dash_scale);
                    self.paint_outline(
                        Outline {
                            bounds,
                            stroke,
                            ..outline
                        },
                        &brush,
                        &space,
                    );
                }
                PaintKind::Markers
                    if [&svg.marker_start.0, &svg.marker_mid.0, &svg.marker_end.0]
                        == [&None; 3] => {}
                PaintKind::Markers => {
                    for (marker, matrix, clip) in
                        document.svg_markers(node, &self.matrix_in_svg(space))
                    {
                        let mut inside = *space;
                        if self.vector(matrix, &mut inside) {
                            clip.into_iter()
                                .for_each(|it| self.clip(square(it), &mut inside));
                            let paint = |painter: &mut Self| {
                                painter.with_resource(&marker, |painter| {
                                    painter.svg_children(&marker, &inside)
                                })
                            };
                            self.with_context(node, space, paint);
                        }
                    }
                }
            }
            let paint = if kind == PaintKind::Fill {
                &svg.fill
            } else {
                &svg.stroke
            };
            match (kind, paint, solid(&node.style, kind)) {
                (PaintKind::Markers, ..) | (_, SvgPaint::None, _) => {}
                (_, _, Some(color)) if alpha(color) > 0 && self.out.items.len() == before => {}
                (_, _, Some(color)) => {
                    let item = (alpha(color) > 0).then(|| self.out.items.len() as u32 - 1);
                    self.svg.tints.iter_mut().for_each(|it| {
                        it.push(Tint {
                            node: node.id,
                            kind,
                            item,
                        })
                    });
                }
                _ => self.svg.tints = None,
            }
        }
    }

    fn svg_text(&mut self, node: &Node<'a>, space: &Space) {
        let layout = node
            .document
            .lay_out_svg_text(node, self.document.screen_scale(&self.matrix_in_svg(space)));
        let face = |it: &Placed| layout.shaped.clusters()[it.cluster].face;
        let shown: Vec<_> = layout
            .placed
            .iter()
            .filter(|it| !it.is_hidden && layout.runs[it.run].node.style.is_visible())
            .collect();
        let can_be_selected = !node.document.marks.is_empty()
            && node.uses.is_none()
            && !self.svg.is_clip
            && self.svg.resources.is_empty();
        let is_selected = |it: &Placed| {
            let (text, at) = layout.source(it);
            can_be_selected
                && node.document.marks_of(text).any(|it| it.0.contains(&at))
                && layout.runs[it.run].node.style.ink.user_select != UserSelect::None
        };
        let is_alike = |a: &&Placed, b: &&Placed| {
            (a.run, face(a), a.stretch, a.is_upright) == (b.run, face(b), b.stretch, b.is_upright)
                && a.radians == 0.0
                && b.radians == 0.0
                && is_selected(a) == is_selected(b)
        };
        for fragment in shown.chunk_by(is_alike).filter(|it| is_selected(it[0])) {
            let node = &layout.runs[fragment[0].run].node;
            let verbs: Vec<_> = fragment
                .iter()
                .flat_map(|it| {
                    Path::rect(layout.extent(it))
                        .transformed(&layout.matrix(it))
                        .verbs
                })
                .collect();
            let (outline, color) = (
                self.outline_of(&Path::from(&verbs[..]), FillRule::Nonzero),
                self.selection_background(node.id, &node.style),
            );
            self.emit(&Item::Path { outline, color }, space);
        }
        for fragment in shown.chunk_by(is_alike) {
            let node = &layout.runs[fragment[0].run].node;
            let highlight = is_selected(fragment[0])
                .then(|| node.document.highlight(node.id, Pseudo::Selection))
                .flatten();
            let selected = highlight.map(|it| {
                node.with_style(it.style(
                    &node.style,
                    &node.document.styles.initial,
                    node.style.color(),
                ))
            });
            self.svg_fragment(&layout, fragment, selected.as_ref().unwrap_or(node), space);
        }
    }

    /// The characters only differ in where they are.
    fn svg_fragment(
        &mut self,
        layout: &TextLayout<'a>,
        fragment: &[&Placed],
        node: &Node<'a>,
        space: &Space,
    ) {
        let (first, scale, mut space) = (fragment[0], layout.scale, *space);
        let [a, b, c, d, ..] = layout.matrix(first);
        let turn = if first.is_upright {
            rotation(-core::f32::consts::FRAC_PI_2)
        } else {
            IDENTITY
        };
        let along = multiply(&[a, b, c, d, 0.0, 0.0], &scaling(1.0 / scale, 1.0 / scale));
        let Some(to_line) = invert(&along).filter(|_| self.vector(along, &mut space)) else {
            return;
        };
        let Some(face) = layout
            .shaped
            .faces
            .get(usize::from(layout.shaped.clusters()[first.cluster].face))
            .copied()
        else {
            return;
        };
        let start = |it: &Placed| apply(&multiply(&to_line, &layout.matrix(it)), [0.0; 2]);
        let mut extents = Vec::<[f32; 3]>::new();
        for ([x, y], end) in fragment
            .iter()
            .map(|it| (start(it), start(it)[0] + it.advance / it.stretch * scale))
        {
            match extents.last_mut().filter(|it| {
                (it[2] - y).abs() < 0.01 && ((it[1] - x).abs() < 0.01 || (it[0] - end).abs() < 0.01)
            }) {
                Some(last) => (last[0], last[1]) = (last[0].min(x), last[1].max(end)),
                None => extents.push([x, end, y]),
            }
        }
        let text_bounds = || layout.bounds(layout.runs[0].node.id).unwrap_or_default();
        let decorate = |painter: &mut Self, line: DecorationLine| {
            let decorated: Vec<_> = layout
                .around(first.run)
                .filter(|it| {
                    !painter.svg.is_clip && it.node.style.paint.decoration_line.contains(line)
                })
                .collect();
            for by in decorated.iter().rev().map(|it| &it.node) {
                let size = by.style.font.size.0 / by.style.zoom * scale;
                let thickness = by
                    .style
                    .paint
                    .decoration_thickness
                    .0
                    .as_ref()
                    .map_or(size / 10.0, |it| {
                        it.resolve(by.style.font.size.0) / by.style.zoom * scale
                    })
                    .max(1.0);
                let ascent = layout.runs[first.run].ascent * scale;
                let below = match line {
                    DecorationLine::OVERLINE => -ascent,
                    DecorationLine::LINE_THROUGH => -ascent / 3.0 - thickness / 2.0,
                    _ => (thickness / 2.0).ceil().max(1.0),
                };
                for ([left, right, y], kind) in extents
                    .iter()
                    .flat_map(|it| by.style.svg.paint_order.0.map(|kind| (it, kind)))
                {
                    let Some(brush) = (kind != PaintKind::Markers)
                        .then(|| painter.brush(by, kind, &text_bounds, &to_line, &space))
                        .flatten()
                    else {
                        continue;
                    };
                    let mut outline = painter.outline_of(
                        &Path::rect(Rect::new([*left, y + below, right - left, thickness])),
                        FillRule::Nonzero,
                    );
                    if kind == PaintKind::Stroke {
                        outline.stroke = painter.stroke_of(by, scale, 1.0);
                        outline.bounds = outline.bounds.grown(outline.stroke.width);
                    }
                    if kind == PaintKind::Fill || outline.stroke.width > 0.0 {
                        painter.paint_outline(outline, &brush, &space);
                    }
                }
            }
        };
        decorate(self, DecorationLine::UNDERLINE);
        decorate(self, DecorationLine::OVERLINE);
        let (mut upright, back) = (space, invert(&turn).unwrap_or(IDENTITY));
        if first.is_upright {
            self.vector(turn, &mut upright);
        }
        let place = |it: &Placed| {
            let ([x, y], width) = (start(it), layout.shaped.clusters()[it.cluster].advance);
            if it.is_upright {
                apply(
                    &back,
                    [
                        x + face.ascent,
                        y + width / 2.0 - (face.ascent - face.descent) / 2.0,
                    ],
                )
            } else {
                [x, y]
            }
        };
        let (origin, first_glyph, mut bounds) =
            (place(first), self.out.glyphs.len() as u32, Rect::default());
        for it in fragment {
            let ([x, y], glyphs) = (
                place(it),
                &layout.shaped.glyphs()[layout.shaped.clusters()[it.cluster].glyphs.range()],
            );
            self.out.glyphs.extend(glyphs.iter().map(|it| abi::Glyph {
                x: it.x + x - origin[0],
                y: it.y + y - origin[1],
                ..*it
            }));
            bounds = bounds.union(
                &Rect::new([x, y, it.advance / it.stretch * scale, 0.0]).grown(face.size * 1.5),
            );
        }
        let (glyphs, size, to_space) = (
            Span {
                start: first_glyph,
                end: self.out.glyphs.len() as u32,
            },
            face.size,
            multiply(&back, &to_line),
        );
        let text = |origin, color, blur| Item::Text {
            origin,
            bounds,
            face: face.id,
            size,
            glyphs,
            color,
            blur,
        };
        if self.svg.is_clip {
            return self.emit(&text(origin, BLACK, 0.0), &upright);
        }
        for kind in node
            .style
            .svg
            .paint_order
            .0
            .into_iter()
            .filter(|it| *it != PaintKind::Markers)
        {
            let Some(brush) = self.brush(node, kind, &text_bounds, &to_space, &upright) else {
                continue;
            };
            let is_fixed = node.style.shape.vector_effect == VectorEffect::NonScalingStroke;
            let stroke_scale = if is_fixed {
                node.style.zoom * self.document.environment.scale
            } else {
                scale
            };
            let stroke =
                (kind == PaintKind::Stroke).then(|| self.stroke_of(node, stroke_scale, 1.0));
            for shadow in node.style.ink.text_shadow.0.0.iter().rev() {
                let [x, y, blur] = [shadow.offset[0], shadow.offset[1], shadow.blur]
                    .map(|it| it / node.style.zoom * scale);
                let (origin, color) = (
                    [origin[0] + x, origin[1] + y],
                    shadow.color.resolve(node.style.color()),
                );
                let Some(stroke) = stroke else {
                    self.emit(&text(origin, color, blur), &upright);
                    continue;
                };
                let (bounds, start) = (
                    bounds.moved([x, y]).grown(stroke.width),
                    self.out.filters.len() as u32,
                );
                self.out.filters.push(abi::Filter::Blur(blur / 2.0));
                let group = (blur > 0.0).then(|| {
                    self.begin_group(
                        bounds.grown(blur * 1.5),
                        1.0,
                        BlendMode::Normal,
                        Span {
                            start,
                            end: start + 1,
                        },
                        &upright,
                    )
                });
                self.emit(
                    &Item::TextStroke {
                        origin,
                        bounds,
                        face: face.id,
                        size,
                        glyphs,
                        color,
                        stroke,
                    },
                    &upright,
                );
                group.into_iter().for_each(|it| self.end_group(it));
            }
            let item = |color| match stroke {
                None => text(origin, color, 0.0),
                Some(stroke) => Item::TextStroke {
                    origin,
                    bounds,
                    face: face.id,
                    size,
                    glyphs,
                    color,
                    stroke,
                },
            };
            match brush {
                _ if stroke.is_some_and(|it| it.width <= 0.0) => {}
                Brush::Color(color) => self.emit(&item(color), &upright),
                brush => {
                    let bounds =
                        bounds.grown(stroke.map_or(0.0, |it| it.width * it.miter_limit.max(1.0)));
                    let base =
                        self.begin_group(bounds, 1.0, BlendMode::Normal, Span::default(), &upright);
                    self.cover(&brush, bounds, &upright);
                    self.marker(&Item::Mask { luminance: false });
                    self.emit(&item(BLACK), &upright);
                    self.end_group(base);
                }
            }
        }
        decorate(self, DecorationLine::LINE_THROUGH);
    }

    /// Paints black what the `clipPath` keeps.
    pub(crate) fn svg_clip(
        &mut self,
        document: &'a Document,
        from: NodeId,
        url: &str,
        user: &UserSpace,
        space: &Space,
    ) {
        let Some(clip) = document
            .svg_resource(from, url, name!("clipPath"))
            .filter(|it| !self.svg.resources.contains(&it.key()))
        else {
            return self.fill(square(space.visible), BLACK, space);
        };
        self.with_resource(&clip, |painter| {
            let (mut outer, mut group, was_clip) = (
                *space,
                None,
                core::mem::replace(&mut painter.svg.is_clip, true),
            );
            match clip.style.effects.clip_path.0.as_deref() {
                None => {}
                Some((Shape::Url(url), _)) => {
                    group = Some((
                        painter.begin_group(
                            space.visible,
                            1.0,
                            BlendMode::Normal,
                            Span::default(),
                            space,
                        ),
                        url,
                    ))
                }
                Some((shape, _)) => {
                    let zoom = clip.style.zoom;
                    let (path, rule) = crate::shapes::resolve(
                        shape,
                        &square(user.bounds.transformed(&scaling(zoom, zoom))),
                        zoom,
                    )
                    .scaled(1.0 / zoom)
                    .into_path();
                    painter.clip_to(
                        crate::shapes::Resolved::Path(path.transformed(&user.matrix), rule),
                        &mut outer,
                    );
                }
            }
            if painter.vector(
                multiply(&user.matrix, &clip.document.clip_matrix(&clip, user.bounds)),
                &mut outer,
            ) {
                painter.svg_children(&clip, &outer);
            }
            if let Some((base, url)) = group {
                painter.marker(&Item::Mask { luminance: false });
                painter.svg_clip(clip.document, clip.id, url, user, space);
                painter.end_group(base);
            }
            painter.svg.is_clip = was_clip;
        });
    }

    pub(crate) fn svg_mask(&mut self, mask: &Node<'a>, user: &UserSpace, space: &Space) {
        let (document, mut inside) = (mask.document, *space);
        let is_relative =
            mask.element.attribute(name!("maskContentUnits")) == Some("objectBoundingBox");
        self.vector(user.matrix, &mut inside);
        self.clip(
            square(document.resource_region(mask, name!("maskUnits"), user.bounds)),
            &mut inside,
        );
        if !is_relative || self.vector(onto(user.bounds), &mut inside) {
            let context = self.svg.context.take();
            self.with_resource(mask, |painter| painter.svg_children(mask, &inside));
            self.svg.context = context;
        }
    }
}

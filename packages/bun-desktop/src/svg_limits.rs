//! Resvg takes as much time, memory and stack as a document asks for.

use resvg::tiny_skia::Transform;
use resvg::usvg::filter::Kind;
use resvg::usvg::roxmltree::{Document, Node, NodeId};
use resvg::usvg::{self, Group, NonZeroRect, Paint};
use rustc_hash::FxHashMap;
use simplecss::{AttributeOperator, PseudoClass, Rule, StyleSheet};

const MAX_DEPTH: usize = 256;
const MAX_ELEMENTS: f64 = 5e5;
const MAX_VERTICES: f64 = 5e7;
const MAX_PIXELS: f64 = (1 << 25) as f64;
const MAX_WORK: f64 = 2e9;

/// Before the parser, which is recursive.
pub fn is_shallow(source: &str) -> bool {
    let (mut rest, mut depth) = (source, 0usize);
    while let Some((_, after)) = rest.split_once('<') {
        let skip = |start: &str, end: &str| {
            Some(
                after
                    .strip_prefix(start)?
                    .split_once(end)
                    .map_or("", |it| it.1),
            )
        };
        rest = skip("!--", "-->")
            .or_else(|| skip("![CDATA[", "]]>"))
            .or_else(|| skip("?", "?>"))
            .unwrap_or(after);
        if after.starts_with('/') {
            depth = depth.saturating_sub(1);
        } else if !after.starts_with(['!', '?']) {
            let mut quote = 0;
            let end = after.bytes().position(|byte| {
                if byte == quote {
                    quote = 0;
                } else if quote == 0 && matches!(byte, b'"' | b'\'') {
                    quote = byte;
                }
                quote == 0 && byte == b'>'
            });
            let (tag, after) = after.split_at(end.unwrap_or(after.len()));
            (rest, depth) = (after, depth + usize::from(!tag.ends_with('/')));
        }
        if depth > MAX_DEPTH {
            return false;
        }
    }
    true
}

struct Element<'a, 'input>(Node<'a, 'input>);

impl simplecss::Element for Element<'_, '_> {
    fn parent_element(&self) -> Option<Self> {
        self.0.parent_element().map(Element)
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        self.0.prev_sibling_element().map(Element)
    }

    fn has_local_name(&self, name: &str) -> bool {
        self.0.tag_name().name() == name
    }

    fn attribute_matches(&self, name: &str, operator: AttributeOperator<'_>) -> bool {
        self.0
            .attribute(name)
            .is_some_and(|value| operator.matches(value))
    }

    fn pseudo_class_matches(&self, class: PseudoClass<'_>) -> bool {
        class == PseudoClass::FirstChild && self.0.prev_sibling_element().is_none()
    }
}

#[derive(Clone, Copy, Default)]
struct Size {
    elements: f64,
    vertices: f64,
}

impl Size {
    fn add(&mut self, other: Size, times: f64) {
        self.elements += other.elements * times;
        self.vertices += other.vertices * times;
    }
}

struct Expansion<'a, 'input> {
    ids: FxHashMap<&'a str, Node<'a, 'input>>,
    rules: Vec<Rule<'a>>,
    /// `None` while it is being measured.
    sizes: FxHashMap<(NodeId, bool), Option<Size>>,
}

impl<'a, 'input> Expansion<'a, 'input> {
    fn references(&self, node: Node<'a, 'input>) -> Vec<(&'a str, Node<'a, 'input>)> {
        let inline = node
            .attribute("style")
            .into_iter()
            .flat_map(simplecss::DeclarationTokenizer::from);
        let matched = self
            .rules
            .iter()
            .filter(|rule| rule.selector.matches(&Element(node)));
        let declared = inline.chain(matched.flat_map(|rule| rule.declarations.iter().copied()));
        let all = node
            .attributes()
            .map(|it| (it.name(), it.value()))
            .chain(declared.map(|it| (it.name, it.value)));
        let mut found = Vec::new();
        for (name, value) in all.filter(|(name, value)| *name == "href" || value.contains("url")) {
            let ids = value
                .split('#')
                .skip(1)
                .filter_map(|it| it.split([')', '"', '\'', ' ', '\t', '\n', '\r']).next());
            found.extend(ids.filter_map(|id| Some((name, *self.ids.get(id)?))));
        }
        found
    }

    /// What `from` passes on applies to all that is in `size`.
    fn inherit(&mut self, size: &mut Size, from: Node<'a, 'input>, depth: usize) -> Option<()> {
        let before = *size;
        for (name, target) in self.references(from) {
            match name {
                "fill" | "stroke" => size.add(self.measure(target, true, depth)?, before.elements),
                _ if name.starts_with("marker") => {
                    size.add(self.measure(target, true, depth)?, before.vertices)
                }
                _ => {}
            }
        }
        Some(())
    }

    /// `None` for a cycle, or for too much.
    fn measure(
        &mut self,
        node: Node<'a, 'input>,
        is_referenced: bool,
        depth: usize,
    ) -> Option<Size> {
        let (key, depth, name) = (
            (node.id(), is_referenced),
            depth + 1,
            node.tag_name().name(),
        );
        if name.ends_with("Gradient") {
            return Some(Size {
                elements: 1.,
                vertices: 0.,
            });
        }
        let is_definition = matches!(
            name,
            "defs" | "symbol" | "marker" | "pattern" | "mask" | "clipPath" | "filter"
        );
        if is_definition && !is_referenced {
            return Some(Size::default());
        }
        if let Some(size) = self.sizes.get(&key) {
            return *size;
        }
        (depth <= MAX_DEPTH * 2).then_some(())?;
        self.sizes.insert(key, None);
        let data = node
            .attribute("d")
            .or(node.attribute("points"))
            .map_or(0, str::len);
        let mut size = Size {
            elements: 1.,
            vertices: 8. + data as f64 / 2.,
        };
        for child in node.children().filter(Node::is_element) {
            size.add(self.measure(child, false, depth)?, 1.);
        }
        for (property, target) in self.references(node) {
            let is_link = property == "href"
                && matches!(
                    name,
                    "a" | "animate" | "set" | "animateTransform" | "animateMotion"
                );
            if !is_link && matches!(property, "href" | "mask" | "clip-path" | "filter") {
                size.add(self.measure(target, true, depth)?, 1.);
            }
        }
        self.inherit(&mut size, node, depth)?;
        if is_definition {
            for ancestor in node.ancestors().skip(1).filter(Node::is_element) {
                self.inherit(&mut size, ancestor, depth)?;
            }
        }
        (size.elements <= MAX_ELEMENTS && size.vertices <= MAX_VERTICES).then_some(())?;
        self.sizes.insert(key, Some(size));
        Some(size)
    }
}

/// With every reference replaced by what it refers to.
pub fn is_small(document: &Document) -> bool {
    let elements = || document.descendants().filter(Node::is_element);
    let mut sheet = StyleSheet::new();
    for style in elements().filter(|node| node.has_tag_name("style")) {
        sheet.parse_more(style.text().unwrap_or_default());
    }
    if sheet.rules.len() as f64 * elements().count() as f64 > MAX_WORK / 20. {
        return false;
    }
    sheet
        .rules
        .retain(|rule| rule.declarations.iter().any(|it| it.value.contains("url")));
    let ids = elements()
        .filter_map(|node| Some((node.attribute("id")?, node)))
        .collect();
    let mut expansion = Expansion {
        ids,
        rules: sheet.rules,
        sizes: FxHashMap::default(),
    };
    expansion
        .measure(document.root_element(), false, 0)
        .is_some()
}

fn pixels(rect: NonZeroRect, matrix: &Transform) -> f64 {
    let (x, y) = matrix.get_scale();
    f64::from(rect.width() * x).ceil() * f64::from(rect.height() * y).ceil()
}

fn add_work(group: &Group, matrix: &Transform, target: f64, work: &mut f64) {
    let matrix = matrix.pre_concat(group.transform());
    let mut allocate = |pixels: f64, each: f64| {
        *work += if pixels <= MAX_PIXELS {
            pixels * each
        } else {
            f64::INFINITY
        }
    };
    if group.should_isolate() {
        allocate(pixels(group.layer_bounding_box(), &matrix).min(target), 4.);
    }
    for filter in group.filters() {
        let (region, (x, y)) = (pixels(filter.rect(), &matrix), matrix.get_scale());
        for primitive in filter.primitives() {
            let each = match primitive.kind() {
                Kind::Turbulence(it) => f64::from(it.num_octaves()) * 40.,
                Kind::Morphology(it) => {
                    let side = |radius: f32| f64::from(radius * 2. + 1.);
                    (side(it.radius_x().get() * x) * side(it.radius_y().get() * y)).min(region)
                }
                Kind::ConvolveMatrix(it) => it.matrix().data().len() as f64,
                _ => 1.,
            };
            allocate(region, each + 20.);
        }
    }
    for node in group.children() {
        if let usvg::Node::Path(path) = node {
            for paint in [
                path.fill().map(|it| it.paint()),
                path.stroke().map(|it| it.paint()),
            ] {
                let Some(Paint::Pattern(pattern)) = paint else {
                    continue;
                };
                let tile = pixels(pattern.rect(), &matrix.pre_concat(pattern.transform()));
                *work += if tile <= MAX_PIXELS {
                    tile
                } else {
                    f64::INFINITY
                };
            }
        }
        match node {
            usvg::Node::Group(group) => add_work(group, &matrix, target, work),
            _ => *work += 100.,
        }
        node.subroots(|root| add_work(root, &matrix, target, work));
    }
}

/// `target` is the number of pixels that it is drawn to.
pub fn is_cheap(tree: &usvg::Tree, matrix: &Transform, target: i64) -> bool {
    let mut work = 0.;
    add_work(tree.root(), matrix, target as f64, &mut work);
    work <= MAX_WORK
}

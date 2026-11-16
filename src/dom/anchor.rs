//! Anchor positioning. What `anchor()`, `anchor-size()` and the fallbacks come to is found by layout, and becomes the computed style.

use std::rc::Rc;

use crate::abi::Rect;
use crate::boxes::{BoxId, VIEWPORT};
use crate::calc::{Anchor, AnchorSide, AnchorSize, Measure, Node, Unit};
use crate::document::Document;
use crate::fragment::Piece;
use crate::layout::{margins, sizes};
use crate::name::Map;
use crate::positioned::Edge;
use crate::properties::{Id, Style, Value};
use crate::sheet::{AtKind, Block, Defined};
use crate::tree::{Flags, NodeId};
use crate::types::*;
use crate::values::{Auto, Calc, Deps, Lp, MaxSize, NoneOrSpaces, Out, Size, Str, text};

/// What layout needs besides the style. Physical.
#[derive(Default, PartialEq)]
pub(crate) struct Anchored {
    pub(crate) has_default: bool,
    /// What `position-area` takes from the top, right, bottom and left of the containing block.
    pub(crate) area: Option<[f32; 4]>,
    /// For `anchor-center`, from the containing block.
    pub(crate) center: [Option<f32>; 2],
    /// Instead of `normal`, and whether that is unsafe.
    pub(crate) edges: [Option<(Edge, bool)>; 2],
    /// Overflowing the viewport does not put it out of reach.
    pub(crate) scrolls_into_view: [bool; 2],
}

pub(crate) struct Anchoring {
    /// With neither fallbacks nor anchors applied.
    specified: Rc<Style>,
    used: Vec<Value>,
    pub(crate) is_unresolved: bool,
    option: Option<usize>,
    /// As of the last frame.
    successful: Option<Option<usize>>,
    is_settled: bool,
    /// How far the anchors were scrolled when the option was chosen.
    scrolled: Map<NodeId, [f32; 2]>,
    pub(crate) shift: [f32; 2],
    pub(crate) is_hidden: bool,
    /// Those that it refers to.
    pub(crate) anchors: Vec<NodeId>,
    /// Relative to the border box of the container.
    pub(crate) block: Rect,
    /// The size of the inset-modified containing block, and what is left of it around the margin box.
    pub(crate) room: [f32; 2],
    pub(crate) free: [f32; 4],
}

struct Resolved {
    style: Style,
    anchored: Anchored,
    default: Option<NodeId>,
    anchors: Vec<NodeId>,
    shift: [f32; 2],
    /// The sides of the inset-modified containing block that scroll along.
    are_tied: [bool; 4],
}

const INSETS: [Id; 4] = [Id::Top, Id::Right, Id::Bottom, Id::Left];
const MARGINS: [Id; 4] = [
    Id::MarginTop,
    Id::MarginRight,
    Id::MarginBottom,
    Id::MarginLeft,
];
const SIZES: [Id; 6] = [
    Id::Width,
    Id::Height,
    Id::MinWidth,
    Id::MinHeight,
    Id::MaxWidth,
    Id::MaxHeight,
];
const OTHERS: [Id; 4] = [
    Id::JustifySelf,
    Id::AlignSelf,
    Id::PositionArea,
    Id::PositionAnchor,
];

fn accepted() -> impl Iterator<Item = Id> {
    INSETS.into_iter().chain(MARGINS).chain(SIZES).chain(OTHERS)
}

fn insets(style: &Style) -> [&Inset; 4] {
    let l = &style.layout;
    [&l.top, &l.right, &l.bottom, &l.left]
}

fn inset_value(side: usize, it: Inset) -> Value {
    [Value::Top, Value::Right, Value::Bottom, Value::Left][side](it)
}

fn margin_value(side: usize, it: Auto<Lp>) -> Value {
    [
        Value::MarginTop,
        Value::MarginRight,
        Value::MarginBottom,
        Value::MarginLeft,
    ][side](it)
}

fn size_value(index: usize, it: Size) -> Value {
    match index {
        4 => Value::MaxWidth(MaxSize(it)),
        5 => Value::MaxHeight(MaxSize(it)),
        _ => [
            Value::Width,
            Value::Height,
            Value::MinWidth,
            Value::MinHeight,
        ][index](it),
    }
}

fn anchored_margin(margin: &Auto<Lp>) -> Option<&Node> {
    match &margin.0 {
        Some(Lp::Calc(calc)) if let Calc::Tree(node) = &**calc => {
            Some(node).filter(|it| it.has_anchor())
        }
        _ => None,
    }
}

fn is_positioned_by_layout(style: &Style) -> bool {
    style.is_out_of_flow()
        && (style.deps.contains(Deps::ANCHOR)
            || !style.rare.position_area.is_empty()
            || !matches!(&*style.rare.position_anchor.0, "normal" | "none")
            || &*style.rare.position_try.0 != "none"
            || [style.layout.align_self.0, style.layout.justify_self.0]
                .contains(&AlignName::AnchorCenter)
            || style.other_if_set(Id::PositionVisibility).is_some())
}

/// `inset` and `size` are also given the physical side and axis.
fn substitute(
    style: &mut Style,
    inset: &dyn Fn(&Anchor, usize) -> Option<f32>,
    size: &dyn Fn(&Anchor, usize) -> Option<f32>,
) {
    let old = style.clone();
    for side in 0..4 {
        if let Inset::Anchor(node) = insets(&old)[side] {
            let value = node.without_anchors(&|it| inset(it, side));
            style.groups.set(&inset_value(
                side,
                value.map_or(Inset::Auto, |it| Inset::Length(Lp::new(it))),
            ));
        }
        if let Some(node) = anchored_margin(margins(&old)[side]) {
            let value = node.without_anchors(&|it| size(it, 1 - side % 2));
            style.groups.set(&margin_value(
                side,
                Auto(Some(value.map_or(Lp::ZERO, Lp::new))),
            ));
        }
    }
    for (index, value) in sizes(&old).into_iter().enumerate() {
        if let Size::Anchor(node) = value {
            let value = node.without_anchors(&|it| size(it, index % 2));
            style.groups.set(&size_value(
                index,
                value.map_or(Size::Auto, |it| Size::Length(Lp::new(it))),
            ));
        }
    }
}

/// 0 for the inline axis.
fn logical_axis(style: &Style, physical: usize) -> usize {
    physical ^ usize::from(style.text.writing_mode.is_vertical())
}

fn runs_back(style: &Style, physical: usize) -> bool {
    style.runs_back(logical_axis(style, physical))
}

struct Keyword<'a> {
    spans: bool,
    is_own: bool,
    /// `x-`, `y-`, `block-`, `inline-`, or nothing.
    axis: &'a str,
    name: &'a str,
}

impl<'a> Keyword<'a> {
    fn new(word: &'a str) -> Keyword<'a> {
        let strip = |word: &'a str, prefix| {
            word.strip_prefix(prefix)
                .map_or((false, word), |it| (true, it))
        };
        let (spans, word) = strip(word, "span-");
        let (is_own, word) = strip(word, "self-");
        let axis = ["x-", "y-", "block-", "inline-"]
            .into_iter()
            .find(|it| word.starts_with(it))
            .unwrap_or("");
        Keyword {
            spans,
            is_own,
            axis,
            name: &word[axis.len()..],
        }
    }

    fn text(&self) -> Str {
        [
            if self.spans { "span-" } else { "" },
            if self.is_own { "self-" } else { "" },
            self.axis,
            self.name,
        ]
        .concat()
        .into()
    }
}

/// The two keywords, with their physical axes.
fn area_keywords<'a>(area: &'a [Str], own: &Style, block: &Style) -> [(Keyword<'a>, usize); 2] {
    let explicit = |it: &Keyword| match (it.name, it.axis) {
        ("left" | "right", _) | (_, "x-") => Some(0),
        ("top" | "bottom", _) | (_, "y-") => Some(1),
        (_, "") => None,
        (_, axis) => Some(logical_axis(
            if it.is_own { own } else { block },
            usize::from(axis == "block-"),
        )),
    };
    let first = Keyword::new(&area[0]);
    let second = Keyword::new(area.get(1).map_or(
        if explicit(&first).is_some() {
            "span-all"
        } else {
            &area[0]
        },
        |it| it,
    ));
    let by_position = || {
        logical_axis(
            if first.is_own || second.is_own {
                own
            } else {
                block
            },
            1,
        )
    };
    let axis = explicit(&first)
        .or_else(|| explicit(&second).map(|it| 1 - it))
        .unwrap_or_else(by_position);
    [(first, axis), (second, 1 - axis)]
}

/// In its shortest form.
pub(crate) fn write_area(area: &[Str], out: &mut Out) {
    let mut words: Vec<_> = area.iter().map(|it| Keyword::new(it)).collect();
    let is_second =
        |it: &Keyword| matches!(it.name, "top" | "bottom") || matches!(it.axis, "y-" | "inline-");
    let is_first =
        |it: &Keyword| matches!(it.name, "left" | "right") || matches!(it.axis, "x-" | "block-");
    if let [a, b] = &mut words[..] {
        if is_second(a) || is_first(b) {
            core::mem::swap(a, b);
        }
        for (it, other, axis) in [(0, 1, "block-"), (1, 0, "inline-")] {
            match (words[it].axis, words[other].name) {
                ("", "all") if matches!(words[it].name, "start" | "end") => words[it].axis = axis,
                ("block-" | "inline-", other) if other != "all" => words[it].axis = "",
                _ => {}
            }
        }
        if words[0].text() == words[1].text() {
            words.pop();
        } else if !words.iter().any(|it| it.name == "center") {
            words.retain(|it| it.name != "all");
        }
    }
    out.extend(
        words
            .iter()
            .map(|it| it.text().to_string())
            .collect::<Vec<_>>()
            .join(" ")
            .bytes(),
    );
}

/// The first and the last of the three tracks of each axis.
fn tracks(area: &[Str], own: &Style, block: &Style) -> [[usize; 2]; 2] {
    let mut tracks = [[0, 2]; 2];
    for (it, axis) in area_keywords(area, own, block) {
        let track = match it.name {
            "all" => continue,
            "center" => 1,
            "left" | "top" => 0,
            "right" | "bottom" => 2,
            name => {
                2 * usize::from(
                    (name == "end") != runs_back(if it.is_own { own } else { block }, axis),
                )
            }
        };
        tracks[axis] = if it.spans {
            [track.min(1), track.max(1)]
        } else {
            [track; 2]
        };
    }
    tracks
}

/// `to` has the side that each side moves to.
fn flip(style: &mut Style, block: &Style, to: [usize; 4]) {
    let (old, swaps) = (style.clone(), to[0] % 2 == 1);
    let mirrors = |axis: usize| !swaps && to[1 - axis] != 1 - axis;
    let moved = |node: &Node, axis: usize| {
        node.with_anchors(&|anchor| {
            use AnchorSide::*;
            let measure = match &anchor.measure {
                Measure::Side(side)
                    if let Some(from) =
                        [Top, Right, Bottom, Left].iter().position(|it| it == side) =>
                {
                    Measure::Side([Top, Right, Bottom, Left][to[from]])
                }
                Measure::Side(side) if mirrors(axis) => Measure::Side(match side {
                    Start => End,
                    End => Start,
                    SelfStart => SelfEnd,
                    SelfEnd => SelfStart,
                    side => *side,
                }),
                Measure::Percentage(it) if mirrors(axis) => Measure::Percentage(
                    Node::Value(100.0, Unit::Percent).plus(it.clone().times(-1.0)),
                ),
                Measure::Size(Some(size)) if swaps => Measure::Size(Some(match size {
                    AnchorSize::Width => AnchorSize::Height,
                    AnchorSize::Height => AnchorSize::Width,
                    AnchorSize::Block => AnchorSize::Inline,
                    AnchorSize::Inline => AnchorSize::Block,
                    AnchorSize::SelfBlock => AnchorSize::SelfInline,
                    AnchorSize::SelfInline => AnchorSize::SelfBlock,
                })),
                measure => measure.clone(),
            };
            Anchor {
                measure,
                ..anchor.clone()
            }
        })
    };
    for side in 0..4 {
        let (inset, margin, axis) = (insets(&old)[side], margins(&old)[side], 1 - side % 2);
        let inset = if let Inset::Anchor(node) = inset {
            Inset::Anchor(Rc::new(moved(node, axis)))
        } else {
            inset.clone()
        };
        let margin = anchored_margin(margin)
            .map_or_else(|| margin.clone(), |it| Auto(Some(Lp::new(moved(it, axis)))));
        style.groups.set(&inset_value(to[side], inset));
        style.groups.set(&margin_value(to[side], margin));
    }
    for (index, size) in sizes(&old).into_iter().enumerate().filter(|_| swaps) {
        let size = if let Size::Anchor(node) = size {
            Size::Anchor(Rc::new(moved(node, 0)))
        } else {
            size.clone()
        };
        style.groups.set(&size_value(index ^ 1, size));
    }
    let [justify, align] = [0, 1].map(|axis| {
        use AlignName::*;
        let Align(name, safety) =
            [old.layout.justify_self, old.layout.align_self][axis ^ usize::from(swaps)];
        let pairs = [
            [Start, End],
            [SelfStart, SelfEnd],
            [FlexStart, FlexEnd],
            [Left, Right],
        ];
        let opposite = pairs
            .iter()
            .find_map(|it| Some(it[1 - it.iter().position(|it| *it == name)?]));
        let name = match name {
            Left | Right if swaps => {
                if (name == Left) == block.is_rtl() {
                    End
                } else {
                    Start
                }
            }
            _ => opposite
                .filter(|_| mirrors(logical_axis(block, axis)))
                .unwrap_or(name),
        };
        Align(name, safety)
    });
    style.groups.set(&Value::JustifySelf(justify));
    style.groups.set(&Value::AlignSelf(align));
    if old.rare.position_area.is_empty() {
        return;
    }
    let (mut area, physical) = (
        area_keywords(&old.rare.position_area, &old, block),
        ["top", "right", "bottom", "left"],
    );
    for (it, axis) in &mut area {
        match (physical.iter().position(|side| *side == it.name), it.name) {
            (Some(side), _) => it.name = physical[to[side]],
            (_, "start") if mirrors(*axis) => it.name = "end",
            (_, "end") if mirrors(*axis) => it.name = "start",
            _ if swaps => {
                it.axis = match it.axis {
                    "x-" => "y-",
                    "y-" => "x-",
                    "block-" => "inline-",
                    "inline-" => "block-",
                    none => none,
                }
            }
            _ => {}
        }
    }
    let (mut area, is_single) = (area.map(|it| it.0), old.rare.position_area.len() == 1);
    if swaps && !is_single {
        area.swap(0, 1);
    }
    let [first, second] = area.map(|it| it.text());
    let names = if first == second || is_single && &*second == "span-all" {
        vec![first]
    } else {
        vec![first, second]
    };
    style
        .groups
        .set(&Value::PositionArea(NoneOrSpaces(names.into())));
}

fn tactic(word: &str, block: &Style) -> Option<[usize; 4]> {
    let mirror = |axis| {
        if axis == 0 {
            [0, 3, 2, 1]
        } else {
            [2, 1, 0, 3]
        }
    };
    Some(match word {
        "flip-x" => mirror(0),
        "flip-y" => mirror(1),
        "flip-inline" => mirror(logical_axis(block, 0)),
        "flip-block" => mirror(logical_axis(block, 1)),
        "flip-start" if runs_back(block, 0) == runs_back(block, 1) => [3, 2, 1, 0],
        "flip-start" => [1, 0, 3, 2],
        _ => return None,
    })
}

fn options(style: &Style) -> Vec<&str> {
    let all = bun_core::strings::split(style.rare.position_try.0.as_bytes(), b",")
        .map(|it| text(it.trim_ascii()));
    all.filter(|it| *it != "none").collect()
}

impl Document {
    /// For a style that has just been computed.
    pub(crate) fn with_anchors(&mut self, node: NodeId, specified: Rc<Style>) -> Rc<Style> {
        if !is_positioned_by_layout(&specified) || specified.display() == Display::None {
            if !self.anchored.is_empty() && self.anchored.remove(&node).is_some() {
                self.relayout(node);
            }
            if !specified.deps.contains(Deps::ANCHOR) {
                return specified;
            }
            let mut style = Style::clone(&specified);
            substitute(&mut style, &|_, _| None, &|_, _| None);
            return Rc::new(style);
        }
        let state = self.anchored.entry(node).or_insert_with(|| Anchoring {
            specified: Rc::clone(&specified),
            used: Vec::new(),
            is_unresolved: true,
            option: None,
            successful: None,
            is_settled: false,
            scrolled: Map::default(),
            shift: [0.0; 2],
            is_hidden: false,
            anchors: Vec::new(),
            block: Rect::default(),
            room: [0.0; 2],
            free: [0.0; 4],
        });
        let mut relevant =
            accepted().chain([Id::PositionTryFallbacks, Id::PositionTryOrder, Id::Position]);
        if relevant.any(|id| state.specified.get(id) != specified.get(id)) {
            state.successful = None;
        }
        let mut style = Style::clone(&specified);
        state.used.iter().for_each(|it| style.groups.set(it));
        substitute(&mut style, &|_, _| None, &|_, _| None);
        (state.specified, self.needs_layout) = (specified, true);
        Rc::new(style)
    }

    /// For a style with values from keyframes.
    pub(crate) fn with_animated_anchors(&self, node: NodeId, style: Rc<Style>) -> Rc<Style> {
        let has_anchors = insets(&style)
            .iter()
            .any(|it| matches!(it, Inset::Anchor(_)))
            || sizes(&style).iter().any(|it| matches!(it, Size::Anchor(_)))
            || margins(&style)
                .iter()
                .any(|it| anchored_margin(it).is_some());
        match self
            .own_box(node)
            .filter(|_| has_anchors && style.is_out_of_flow())
        {
            Some(id) => Rc::new(self.resolve_anchors(id, Style::clone(&style), false).style),
            None => style,
        }
    }

    /// Whether the fallback in use is that one, or any if `value` is empty.
    pub(crate) fn has_fallback(&self, node: NodeId, value: &str) -> bool {
        let state = self.anchored.get(&node);
        let Some((option, own)) =
            state.and_then(|it| Some((*options(&it.specified).get(it.option?)?, &it.specified)))
        else {
            return value == "none";
        };
        let block = &self.boxes[self.boxes[self.tree[node].layout_box].container].style;
        let words = |it: &str| {
            it.split_ascii_whitespace()
                .map(Str::from)
                .collect::<Vec<_>>()
        };
        let is_area = |it: &str| !it.starts_with("--") && !it.starts_with("flip-");
        let (mut wanted, used) = (words(value), words(option));
        if wanted.is_empty()
            || value == "any"
            || value == "none"
            || is_area(value) != is_area(option)
        {
            return wanted.is_empty() || value == "any" && is_area(option);
        }
        if is_area(value) {
            if wanted.len() == 1 && area_keywords(&wanted, own, block)[1].0.name == "all" {
                wanted.push("any".into());
            }
            let (any, expected, actual) = (
                area_keywords(&wanted, own, block),
                tracks(&wanted, own, block),
                tracks(&used, own, block),
            );
            return any
                .iter()
                .all(|(it, axis)| it.name == "any" || expected[*axis] == actual[*axis]);
        }
        let flips = |words: &[Str]| {
            words
                .iter()
                .filter_map(|it| tactic(it, block))
                .fold([0, 1, 2, 3], |all, it| all.map(|side| it[side]))
        };
        let name = |words: &[Str]| words.iter().find(|it| it.starts_with("--")).cloned();
        (flips(&wanted), name(&wanted)) == (flips(&used), name(&used))
    }

    pub(crate) fn forget_position_options(&mut self) {
        self.anchored
            .values_mut()
            .for_each(|it| it.successful = None);
        self.needs_layout |= !self.anchored.is_empty();
    }

    pub(crate) fn remember_position_options(&mut self) {
        for it in self.anchored.values_mut() {
            (it.successful, it.is_settled) = (Some(it.option), true);
        }
    }

    pub(crate) fn is_hidden_by_anchor(&self, id: BoxId) -> bool {
        self.boxes[id].anchored.is_some()
            && self
                .anchored
                .get(&self.boxes[id].node)
                .is_some_and(|it| it.is_hidden)
    }

    /// Compares in tree order.
    fn flat_path(&self, node: NodeId) -> Vec<usize> {
        let index = |it| {
            self.rendered_children(self.tree.flat_parent(it))
                .take_while(|child| *child != it)
                .count()
        };
        let mut path: Vec<_> = [node]
            .into_iter()
            .chain(self.tree.flat_ancestors(node))
            .map(index)
            .collect();
        path.reverse();
        path
    }

    fn layer_of(&self, node: NodeId) -> Option<usize> {
        [node]
            .into_iter()
            .chain(self.tree.flat_ancestors(node))
            .find_map(|it| self.top_layer.iter().position(|top| *top == it))
    }

    /// Whether it is laid out before.
    fn is_acceptable_anchor(&self, anchor: NodeId, positioned: NodeId) -> bool {
        let (own, from) = (
            self.tree[positioned].layout_box,
            self.tree[anchor].layout_box,
        );
        let container = self.boxes[own].container;
        let mut chain = core::iter::once(from).chain(self.boxes.containers(from));
        let Some(last) = chain.find(|it| {
            self.boxes[*it].container == container
                || *it == container && self.boxes[*it].inline.is_some()
        }) else {
            return false;
        };
        let (node, is_positioned) = (
            self.boxes[last].node,
            self.boxes[last].style.is_out_of_flow(),
        );
        from != 0
            && last != own
            && !self.boxes.is_parked(from)
            && self
                .tree
                .style(anchor)
                .is_some_and(|it| it.display() != Display::Contents)
            && match self.layer_of(anchor).cmp(&self.layer_of(positioned)) {
                core::cmp::Ordering::Equal if is_positioned => {
                    self.flat_path(node) < self.flat_path(positioned)
                }
                order => order.is_le(),
            }
    }

    /// The nearest element, from `node` on, whose `anchor-scope` has the name.
    fn scope_of_name(&self, name: &str, tree: NodeId, node: NodeId) -> Option<NodeId> {
        [node]
            .into_iter()
            .chain(self.tree.flat_ancestors(node))
            .find(|it| {
                let scope = self
                    .tree
                    .style(*it)
                    .and_then(|it| it.other_if_set(Id::AnchorScope));
                scope.is_some_and(|it| {
                    it == "all"
                        || bun_core::strings::tokenize_any(it.as_bytes(), b", ")
                            .any(|it| it == name.as_bytes())
                }) && self.tree_of_value(*it, Id::AnchorScope) == tree
            })
    }

    fn find_named_anchor(&self, name: &str, positioned: NodeId, property: Id) -> Option<NodeId> {
        let tree = self.tree_of_value(positioned, property);
        let scope = self.scope_of_name(name, tree, self.tree.flat_parent(positioned));
        let named = self.anchors.iter().copied().filter(|id| {
            self.tree
                .style(*id)
                .is_some_and(|it| it.rare.anchor_name.iter().any(|it| &**it == name))
                && self.tree_of_value(*id, Id::AnchorName) == tree
                && self.scope_of_name(name, tree, *id) == scope
                && self.is_acceptable_anchor(*id, positioned)
        });
        let candidates: Vec<_> = named.collect();
        match candidates[..] {
            [] => None,
            [only] => Some(only),
            _ => candidates
                .into_iter()
                .max_by_key(|it| (self.layer_of(*it), self.flat_path(*it))),
        }
    }

    fn default_anchor(&self, node: NodeId, style: &Style) -> Option<NodeId> {
        match &*style.rare.position_anchor.0 {
            "none" => None,
            "normal" if style.rare.position_area.is_empty() => None,
            "normal" | "auto" => (self
                .implicit_anchors
                .get(&node)
                .copied()
                .filter(|it| self.tree.contains(*it)))
            .or_else(|| {
                Some(
                    self.tree
                        .element(node)
                        .filter(|it| it.is_generated())?
                        .originator,
                )
            })
            .filter(|it| self.is_acceptable_anchor(*it, node)),
            name => self.find_named_anchor(name, node, Id::PositionAnchor),
        }
    }

    /// The boxes from the anchor up to the containing block of `id`.
    fn way_to_anchor(&self, anchor: NodeId, id: BoxId) -> impl Iterator<Item = BoxId> {
        let (from, container) = (self.tree[anchor].layout_box, self.boxes[id].container);
        core::iter::once(from)
            .chain(self.boxes.containers(from))
            .take_while(move |it| *it != container)
    }

    /// How far scrolling has moved the anchor back.
    fn scrolled_by(&self, anchor: NodeId, id: BoxId) -> [f32; 2] {
        self.way_to_anchor(anchor, id).fold([0.0; 2], |[x, y], it| {
            let scrolls_along = self.boxes[it].container == self.boxes[id].container
                && !self.is_fixed_to_viewport(id);
            let (at, now) = (
                self.boxes[it].layout.location,
                if scrolls_along {
                    self.unscrolled_offset(it, None)
                } else {
                    self.offset_in_container(it)
                },
            );
            [x + at.x - now[0], y + at.y - now[1]]
        })
    }

    fn resolve_anchors(&self, id: BoxId, mut style: Style, is_fresh: bool) -> Resolved {
        let (node, container) = (self.boxes[id].node, self.boxes[id].container);
        let state = self.anchored.get(&node);
        let (block, outer) = (
            state.map_or_else(|| self.client_box(container), |it| it.block),
            &self.boxes[container].style,
        );
        let (mut to_block, is_fixed) = (
            invert(&self.to_viewport(container)).unwrap_or(IDENTITY),
            self.is_fixed_to_viewport(id),
        );
        if !is_fixed {
            to_block = multiply(
                &crate::geometry::translation(self.scroll_offset(self.boxes[container].node)),
                &to_block,
            );
        }
        let moved = |anchor: NodeId| match state
            .and_then(|it| it.scrolled.get(&anchor))
            .filter(|_| !is_fresh)
        {
            Some(then) => [0, 1].map(|axis| self.scrolled_by(anchor, id)[axis] - then[axis]),
            None => [0.0; 2],
        };
        let joined = |anchor: NodeId, pieces: &[Piece]| {
            let away = |piece: &Piece, it: &Rect| {
                (piece.rect.x - it.x).hypot(piece.rect.y - it.y)
                    + if piece.rect.touches(it) { 0.0 } else { 1e6 }
            };
            let rects = self
                .client_rects(anchor)
                .into_iter()
                .map(|it| it.transformed(&to_block));
            let back = |it: Rect| {
                Some(
                    it.moved(
                        pieces
                            .iter()
                            .min_by(|a, b| away(a, &it).total_cmp(&away(b, &it)))?
                            .shift
                            .map(|it| -it),
                    ),
                )
            };
            rects
                .filter_map(back)
                .reduce(|a, b| a.union(&b))
                .unwrap_or_default()
        };
        let rect_of = |anchor: NodeId| {
            let rect = self.pieces(container).map_or_else(
                || self.bounding_rect(anchor).transformed(&to_block),
                |it| joined(anchor, it),
            );
            rect.moved([-block.x, -block.y]).moved(moved(anchor))
        };
        let (default, size) = (
            self.default_anchor(node, &style),
            [block.width, block.height],
        );
        let (mut anchored, mut area) = (
            Anchored {
                has_default: default.is_some(),
                ..Anchored::default()
            },
            [0.0; 4],
        );
        let has_area = default.is_some() && !style.rare.position_area.is_empty();
        let (follows, mut are_tied) = (core::cell::Cell::new([has_area; 2]), [false; 4]);
        for (axis, anchor) in default
            .map(rect_of)
            .iter()
            .flat_map(|it| [(0, it.span(0)), (1, it.span(1))])
        {
            let [first, last] = if has_area {
                tracks(&style.rare.position_area, &style, outer)[axis]
            } else {
                [0, 2]
            };
            let lines = [
                anchor[0].min(0.0),
                anchor[0],
                anchor[1],
                anchor[1].max(size[axis]),
            ];
            let (sides, align) = (
                [3 - axis * 3, 1 + axis],
                [style.layout.justify_self.0, style.layout.align_self.0][logical_axis(outer, axis)],
            );
            let (is_normal, [near, far]) = (
                matches!(align, AlignName::Auto | AlignName::Normal),
                sides.map(|side| *insets(&style)[side] == Inset::Auto),
            );
            if has_area {
                (area[sides[0]], area[sides[1]]) = (lines[first], size[axis] - lines[last + 1]);
                (are_tied[sides[0]], are_tied[sides[1]]) = (first > 0, last < 2);
            }
            if has_area && is_normal && near != far {
                anchored.edges[axis] = Some((if near { Edge::Far } else { Edge::Near }, true));
            } else if align == AlignName::AnchorCenter
                || has_area && is_normal && [first, last] == [0, 2]
            {
                anchored.center[axis] = Some((anchor[0] + anchor[1]) / 2.0);
                follows.update(|it| [it[0] || axis == 0, it[1] || axis == 1]);
            } else if has_area && is_normal {
                anchored.edges[axis] = Some((
                    [Edge::Far, Edge::Far, Edge::Center, Edge::Near, Edge::Near][first + last],
                    false,
                ));
            }
            anchored.scrolls_into_view[axis] =
                is_fixed && self.scroll_range(VIEWPORT)[axis] != [0.0; 2];
        }
        anchored.area = has_area.then_some(area);
        let (own, scroller) = (style.clone(), |it: NodeId| {
            self.boxes
                .containers(self.tree[it].layout_box)
                .find(|it| self.boxes[*it].scrolls())
        });
        let anchors = core::cell::RefCell::new(Vec::from_iter(default));
        let find = |anchor: &Anchor, property| {
            anchor.name.as_ref().map_or(default, |name| {
                self.find_named_anchor(name, node, property)
                    .inspect(|it| anchors.borrow_mut().push(*it))
            })
        };
        let anchor_size = |anchor: &Anchor, axis: usize| {
            let Measure::Size(which) = anchor.measure else {
                return None;
            };
            let rect = rect_of(find(anchor, SIZES[axis])?);
            Some(
                [rect.width, rect.height][match which {
                    None => axis,
                    Some(AnchorSize::Width) => 0,
                    Some(AnchorSize::Height) => 1,
                    Some(AnchorSize::Inline) => logical_axis(outer, 0),
                    Some(AnchorSize::Block) => logical_axis(outer, 1),
                    Some(AnchorSize::SelfInline) => logical_axis(&own, 0),
                    Some(AnchorSize::SelfBlock) => logical_axis(&own, 1),
                }],
            )
        };
        let inset = |anchor: &Anchor, side: usize| {
            let (axis, is_far) = (1 - side % 2, matches!(side, 1 | 2));
            let along = |style: &Style, it: f32| if runs_back(style, axis) { 1.0 - it } else { it };
            let fraction = match &anchor.measure {
                Measure::Size(_) => return anchor_size(anchor, axis),
                Measure::Percentage(it) => along(outer, it.resolve(1.0, 0.0, &|_| None)?),
                Measure::Side(side) => match (side, axis) {
                    (AnchorSide::Top, 1) | (AnchorSide::Left, 0) => 0.0,
                    (AnchorSide::Bottom, 1) | (AnchorSide::Right, 0) => 1.0,
                    (AnchorSide::Inside, _) => f32::from(is_far),
                    (AnchorSide::Outside, _) => f32::from(!is_far),
                    (AnchorSide::Start, _) => along(outer, 0.0),
                    (AnchorSide::End, _) => along(outer, 1.0),
                    (AnchorSide::SelfStart, _) => along(&own, 0.0),
                    (AnchorSide::SelfEnd, _) => along(&own, 1.0),
                    (AnchorSide::Center, _) => 0.5,
                    _ => return None,
                },
            };
            let found = find(anchor, INSETS[side])?;
            if default.is_some_and(|it| scroller(it) == scroller(found)) {
                follows.update(|it| [it[0] || axis == 0, it[1] || axis == 1]);
            }
            let [near, far] = rect_of(found).span(axis);
            let at = crate::values::mix(near, far, fraction);
            Some(if is_far { size[axis] - at } else { at } - area[side])
        };
        substitute(&mut style, &inset, &anchor_size);
        let (moved, follows) = (default.map_or([0.0; 2], moved), follows.get());
        let are_tied =
            [0, 1, 2, 3].map(|side| are_tied[side] || *insets(&style)[side] != Inset::Auto);
        Resolved {
            style,
            anchored,
            default,
            anchors: anchors.take(),
            shift: [0, 1].map(|it| if follows[it] { -moved[it] } else { 0.0 }),
            are_tied,
        }
    }

    /// `None` if it names a rule that does not exist.
    fn fallback_style(&self, id: BoxId, base: &Rc<Style>, option: &str) -> Option<Style> {
        let (node, block) = (
            self.boxes[id].node,
            &self.boxes[self.boxes[id].container].style,
        );
        let words = || option.split_ascii_whitespace();
        let rule = match words().find(|it| it.starts_with("--")) {
            Some(name) => match self
                .find_defined(
                    self.tree_of_value(node, Id::PositionTryFallbacks),
                    AtKind::PositionTry,
                    name,
                )?
                .0
            {
                Defined::Block(block) => Some(block),
                _ => return None,
            },
            None if option.starts_with("flip-") => None,
            None => Some(Rc::new(Block::parse(
                format!("position-area:{option}").as_bytes(),
                Default::default(),
                &Rc::default(),
            ))),
        };
        let mut style = Style::clone(base);
        if let Some(rule) = rule {
            let tried = self.style_with(node, rule)?;
            accepted().for_each(|it| style.groups.set(&tried.get(it)));
        }
        words()
            .filter_map(|it| tactic(it, block))
            .for_each(|it| flip(&mut style, block, it));
        self.important_properties(node)
            .into_iter()
            .filter(|it| accepted().any(|id| id == *it))
            .for_each(|it| style.groups.set(&base.get(it)));
        Some(style)
    }

    /// Lays it out that way. Also returns whether it fits.
    fn try_position(&mut self, id: BoxId, style: &Style, is_fresh: bool) -> (Resolved, bool) {
        let mut attempts = 0;
        let resolved = loop {
            let mut resolved = self.resolve_anchors(id, style.clone(), is_fresh);
            let it = &mut self.boxes[id];
            attempts += 1;
            if attempts == 3
                || it.anchored.as_deref() == Some(&resolved.anchored)
                    && it.style.layout == resolved.style.layout
            {
                break resolved;
            }
            it.uses_parent =
                crate::layout::uses_parent(&resolved.style).map(|uses| uses || it.is_orthogonal());
            (it.anchored, it.style) = (
                Some(Box::new(core::mem::take(&mut resolved.anchored))),
                Rc::new(resolved.style),
            );
            self.boxes.mark_layout(id);
            self.lay_out_viewport();
        };
        let (free, [x, y]) = (self.anchored[&self.boxes[id].node].free, resolved.shift);
        let fits = (0..4).all(|side| {
            free[side]
                + if resolved.are_tied[side] {
                    0.0
                } else {
                    [y, -x, -y, x][side]
                }
                > -0.01
        });
        (resolved, fits)
    }

    fn is_anchor_out_of_sight(&self, anchor: NodeId, id: BoxId) -> bool {
        let (rects, container) = (self.local_rects(anchor), self.boxes[id].container);
        let Some((mut at, mut rect)) = rects.into_iter().reduce(|a, b| {
            if a.0 == b.0 {
                (a.0, a.1.union(&b.1))
            } else {
                a
            }
        }) else {
            return true;
        };
        let is_empty = rect.is_empty();
        while at != container {
            (rect, at) = (
                rect.transformed(&self.to_container(at)),
                self.boxes[at].container,
            );
            if let Some(clip) = self
                .overflow_clip(at)
                .filter(|_| at != container || self.is_fixed_to_viewport(id))
            {
                if !clip.touches(&rect) || !is_empty && rect.intersection(&clip).is_empty() {
                    return true;
                }
                rect = rect.intersection(&clip);
            }
        }
        self.tree.style(anchor).is_some_and(|it| !it.is_visible())
            || self
                .way_to_anchor(anchor, id)
                .any(|it| self.is_hidden_by_anchor(it))
    }

    fn position_anchored_box(&mut self, id: BoxId) {
        let node = self.boxes[id].node;
        let state = &self.anchored[&node];
        let (base, successful, is_settled) = (
            Rc::clone(&state.specified),
            state.successful,
            state.is_settled,
        );
        let options = options(&base);
        let style_for = |document: &Document, option: Option<usize>| match option {
            Some(index) => document.fallback_style(id, &base, options.get(index)?),
            None => Some(Style::clone(&base)),
        };
        let kept = successful.flatten();
        let kept_style = style_for(self, kept).unwrap_or_else(|| Style::clone(&base));
        let (mut chosen, mut is_fresh) = (None, !is_settled);
        if successful.is_some() || options.is_empty() {
            let (resolved, fits) = self.try_position(id, &kept_style, is_fresh);
            chosen = (fits || options.is_empty()).then_some((kept, resolved, fits));
        }
        if chosen.is_none() {
            let block = &self.boxes[self.boxes[id].container].style;
            let axis = match base.other(Id::PositionTryOrder) {
                "most-width" => Some(0),
                "most-height" => Some(1),
                "most-inline-size" => Some(logical_axis(block, 0)),
                "most-block-size" => Some(logical_axis(block, 1)),
                _ => None,
            };
            let mut best = None::<(f32, _, _)>;
            for option in [None].into_iter().chain((0..options.len()).map(Some)) {
                let Some(style) = style_for(self, option) else {
                    continue;
                };
                if self.try_position(id, &style, true).1 {
                    let room = axis.map_or(0.0, |it| self.anchored[&node].room[it]);
                    if best.as_ref().is_none_or(|(most, ..)| room > *most) {
                        best = Some((room, option, style));
                    }
                    if axis.is_none() {
                        break;
                    }
                }
            }
            is_fresh |= best.is_some();
            let (fits, (option, style)) = (
                best.is_some(),
                best.map_or((kept, kept_style), |it| (it.1, it.2)),
            );
            chosen = Some((option, self.try_position(id, &style, is_fresh).0, fits));
        }
        let Some((option, resolved, fits)) = chosen else {
            return;
        };
        let visibility = base.other(Id::PositionVisibility);
        let has = |word| visibility.split_ascii_whitespace().any(|it| it == word);
        let is_hidden = !fits && has("no-overflow")
            || has("anchors-visible")
                && resolved
                    .default
                    .is_some_and(|it| self.is_anchor_out_of_sight(it, id));
        let known = self
            .anchors
            .iter()
            .copied()
            .chain(resolved.default)
            .filter(|it| is_fresh || !self.anchored[&node].scrolled.contains_key(it));
        let scrolled: Vec<_> = known
            .filter(|it| self.tree[*it].layout_box != 0)
            .map(|it| (it, self.scrolled_by(it, id)))
            .collect();
        let used: Vec<_> = accepted().map(|it| resolved.style.get(it)).collect();
        let Some(state) = self.anchored.get_mut(&node) else {
            return;
        };
        state.scrolled.extend(scrolled);
        state.anchors = resolved.anchors;
        if (state.shift, state.is_hidden) != (resolved.shift, is_hidden) {
            (state.shift, state.is_hidden) = (resolved.shift, is_hidden);
            self.boxes.mark_ink(id);
        }
        let is_changed = state.used != used;
        if is_changed {
            state.used = used;
            self.tree.mark_style(node, Flags::RECASCADE);
        }
        if core::mem::replace(&mut state.option, option) != option {
            self.container_changed(node, false);
        }
        if let Some(animated) = self
            .tree
            .style(node)
            .filter(|_| !is_changed && self.tree[node].has(Flags::ANIMATED))
            .cloned()
        {
            self.tree.mark_style(node, Flags::REANIMATE);
            if core::mem::replace(&mut self.boxes[id].style, animated).layout
                != self.boxes[id].style.layout
            {
                self.boxes.mark_layout(id);
                self.lay_out_viewport();
            }
        }
    }

    pub(crate) fn position_anchored_boxes(&mut self) {
        let mut ids: Vec<_> = self
            .anchored
            .keys()
            .filter_map(|it| self.own_box(*it))
            .filter(|it| !self.boxes.is_parked(*it))
            .collect();
        if ids.len() > 1 {
            ids.sort_by_cached_key(|it| {
                (
                    self.layer_of(self.boxes[*it].node),
                    self.flat_path(self.boxes[*it].node),
                )
            });
        }
        ids.into_iter()
            .for_each(|it| self.position_anchored_box(it));
    }
}

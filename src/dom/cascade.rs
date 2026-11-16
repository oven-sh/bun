//! From the rules that apply to an element to its computed style.

use core::cell::{Cell, OnceCell, RefCell};
use core::hash::{Hash, Hasher};
use std::rc::Rc;

use smallvec::SmallVec;

use crate::calc::Node;
use crate::calc::scope_random;
use crate::condition::{Actual, Condition, Feature, Subject};
use crate::custom::{
    Changed, Customs, Entries, Function, Inherited, Lookup, Recent, Registry, Stack, Syntax, Text,
    guarded, has_tainted_url, style_query, untainted,
};
use crate::document::{Document, Environment, Quirks};
use crate::name::{FastHasher, Map, Name, is_name, name};
use crate::properties::{Font, Groups, Id, Ink, Only, Prop, Style, Text as TextGroup, Value};
use crate::rules::{Dependencies, Found, INLINE, Kind, Level, Matched, Query, RuleSet};
use crate::selector::{Bloom, HasResults, Pseudo, ScrollPart};
use crate::sheet::{
    AtKind, Block, Cached, ContainerQuery, Declaration, Declared, Defined, Sheet, Wanted, Wide,
    Within,
};
use crate::theme::{Look, Styled};
use crate::tree::{AFTER, BEFORE, DOCUMENT, Flags, Namespace, NodeId, State};
use crate::types::*;
use crate::values::*;

struct Shared {
    parent: Rc<Style>,
    adjust: Adjust,
    generation: u32,
    style: Rc<Style>,
}

/// The same object for all elements that match the same rules.
pub(crate) struct RuleList {
    matched: Box<[Matched]>,
    /// The `epoch` of the `Stylist` when an element last matched it.
    epoch: Cell<u32>,
    shared: RefCell<SmallVec<[Shared; 1]>>,
    /// Of the declarations of custom properties that win.
    customs: OnceCell<u64>,
    plan: OnceCell<Box<Plan>>,
    other_plans: OnceCell<Box<[OnceCell<Box<Plan>>; Flow::COUNT - 1]>>,
}

impl RuleList {
    /// The properties that animations do not override.
    pub(crate) fn important(&self, flow: Flow) -> SmallVec<[Id; 4]> {
        match self
            .matched
            .iter()
            .any(|it| it.block.declarations().has_important)
        {
            true => self
                .plan(flow)
                .longhands
                .iter()
                .filter(|it| self.declaration(it.1).0.important)
                .map(|it| it.0)
                .collect(),
            false => SmallVec::new(),
        }
    }

    pub(crate) fn references_any(&self, changed: &Changed) -> bool {
        self.matched.iter().any(|it| {
            it.block.declarations().reads_any
                || it
                    .block
                    .declarations()
                    .references
                    .iter()
                    .any(|name| changed.contains(*name))
        })
    }

    fn plan(&self, flow: Flow) -> &Plan {
        let plan = match flow.index().checked_sub(1) {
            None => &self.plan,
            Some(index) => &self.other_plans.get_or_init(Box::default)[index],
        };
        plan.get_or_init(|| Box::new(Plan::new(&self.matched, flow, &[])))
    }

    fn declaration(&self, at: At) -> (&Declaration, &Block) {
        let block = &self.matched[usize::from(at.0)].block;
        (&block.declarations().list[usize::from(at.1)], block)
    }

    pub(crate) fn has_author_rules(&self) -> bool {
        self.matched
            .iter()
            .any(|matched| matched.level != Level::UserAgent)
    }
}

pub(crate) struct Stylist {
    pub(crate) user_agent: RefCell<RuleSet>,
    pub(crate) scopes: Map<NodeId, Rc<RefCell<RuleSet>>>,
    pub(crate) registry: Registry,
    pub(crate) dependencies: RefCell<Dependencies>,
    pub(crate) has_results: HasResults,
    /// What each container has been asked.
    pub(crate) answers: RefCell<Map<NodeId, Vec<(Rc<Wanted>, bool)>>>,
    pub(crate) initial: Rc<Style>,
    /// The computed values of a box that no declaration applies to.
    lists: RefCell<Map<u64, Rc<RuleList>>>,
    /// How often `lists` was cleaned up, and how many it kept the last time.
    epoch: (u32, usize),
    pub(crate) bloom: Option<Bloom>,
    pub(crate) recent_customs: Recent<Inherited>,
    recent_groups: (Recent<Font>, Recent<TextGroup>, Recent<Ink>),
    /// By `RuleList::customs` and what is inherited, both of which the value keeps alive, if they depend on nothing else.
    customs: RefCell<Map<(u64, *const Inherited), (Customs, Rc<Inherited>, Box<[Matched]>)>>,
    blocks: Map<u64, Rc<Block>>,
    substituted: RefCell<Map<u64, (Option<Rc<[Value]>>, Deps, u32)>>,
}

impl Stylist {
    /// What had borrowed is gone.
    pub(crate) fn start_over(&mut self) {
        for rules in self.scopes.values() {
            // SAFETY: nothing refers to the inside of the `Rc` while the document is borrowed mutably.
            unsafe { &mut *Rc::as_ptr(rules).cast_mut() }.undo_leak();
        }
        self.user_agent.undo_leak();
        self.dependencies.undo_leak();
        self.has_results.undo_leak();
        self.lists.undo_leak();
        self.substituted.undo_leak();
        let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut self.customs));
        let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut self.recent_groups));
        let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut self.recent_customs));
    }
}

thread_local! {
    static USER_AGENT: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("user_agent.css"), b"", b"", 0, Default::default()));
    static QUIRKS: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("quirks.css"), b"", b"", 0, Default::default()));
    static MATH: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("math.css"), b"", b"", 0, Default::default()));
}

impl Stylist {
    pub(crate) fn new(environment: &Environment, initial: Style) -> Stylist {
        let mut stylist = Stylist {
            user_agent: RefCell::default(),
            scopes: Map::default(),
            registry: Registry::default(),
            dependencies: RefCell::default(),
            has_results: HasResults::default(),
            answers: Default::default(),
            initial: Rc::new(initial),
            lists: RefCell::default(),
            epoch: (0, 0),
            bloom: None,
            recent_customs: Recent::default(),
            recent_groups: Default::default(),
            customs: RefCell::default(),
            blocks: Map::default(),
            substituted: RefCell::default(),
        };
        stylist.user_agent.get_mut().is_of_user_agent = true;
        stylist.set_user_agent_sheets(environment);
        stylist
    }

    pub(crate) fn set_user_agent_sheets(&mut self, environment: &Environment) {
        let needed = [
            (&USER_AGENT, true),
            (&QUIRKS, environment.quirks == Quirks::All),
            (&MATH, environment.has_math),
        ];
        let sheets: Vec<_> = needed
            .into_iter()
            .filter(|it| it.1)
            .map(|it| it.0.with(Rc::clone))
            .collect();
        self.user_agent
            .get_mut()
            .set_sheets(&sheets, environment, self.dependencies.get_mut());
    }

    /// Equal `style` attributes share a block, and so their elements can share a style.
    pub(crate) fn block(
        &mut self,
        source: &[u8],
        within: Within,
        base_url: &Rc<[u8]>,
    ) -> Option<Rc<Block>> {
        if source.is_empty() {
            return None;
        }
        let block = self
            .blocks
            .entry(bun_wyhash::hash_with_seed(within as u64, source));
        Some(Rc::clone(block.or_insert_with(|| {
            Rc::new(Block::parse(source, within, base_url))
        })))
    }

    pub(crate) fn collect_garbage(&mut self, elements: usize) {
        let lists = self.lists.get_mut();
        let is_due = lists.len() > self.epoch.1 + 512;
        if is_due {
            lists.retain(|_, list| Rc::strong_count(list) > 1 || list.epoch.get() == self.epoch.0);
            self.epoch = (self.epoch.0.wrapping_add(1), lists.len());
        }
        if is_due || self.blocks.len() > 2 * elements + 1024 {
            self.blocks.retain(|_, block| Rc::strong_count(block) > 1);
        }
        if self.substituted.get_mut().len() > 1 << 15 {
            self.substituted.get_mut().clear();
        }
    }

    pub(crate) fn forget_values(&mut self) {
        self.substituted.get_mut().clear();
        self.lists
            .get_mut()
            .values()
            .for_each(|list| list.shared.borrow_mut().clear());
        self.customs.get_mut().clear();
    }

    fn intern(&self, found: Found) -> Rc<RuleList> {
        let mut hasher = FastHasher::default();
        for (_, it) in &found {
            (Rc::as_ptr(&it.block), it.level, it.layer, it.only).hash(&mut hasher);
        }
        let same = |list: &RuleList| {
            list.matched.len() == found.len()
                && (list.matched.iter().zip(&found)).all(|(a, (_, b))| {
                    Rc::ptr_eq(&a.block, &b.block)
                        && (a.level, a.layer, a.only) == (b.level, b.layer, b.only)
                })
        };
        let mut lists = self.lists.borrow_mut();
        if let Some(list) = lists.get(&hasher.finish()).filter(|list| same(list)) {
            list.epoch.set(self.epoch.0);
            return Rc::clone(list);
        }
        let matched = found.into_iter().map(|it| it.1).collect();
        let list = Rc::new(RuleList {
            matched,
            epoch: Cell::new(self.epoch.0),
            shared: RefCell::default(),
            customs: OnceCell::new(),
            plan: OnceCell::new(),
            other_plans: OnceCell::new(),
        });
        lists.insert(hasher.finish(), Rc::clone(&list));
        list
    }
}

impl Subject for Environment {
    fn feature(&self, feature: Feature) -> Option<Actual> {
        use Feature as F;
        let pick = |on: bool, yes, no| Actual::Keyword(if on { yes } else { no });
        let reduce = |on| pick(on, name!("reduce"), name!("no-preference"));
        let [width, height] = self.viewport;
        Some(match feature {
            F::Width => Actual::Number(width),
            F::Height => Actual::Number(height),
            F::AspectRatio => Actual::Number(width / height),
            F::DeviceWidth => Actual::Number(self.screen[0]),
            F::DeviceHeight => Actual::Number(self.screen[1]),
            F::DeviceAspectRatio => Actual::Number(self.screen[0] / self.screen[1]),
            F::Orientation => pick(height >= width, name!("portrait"), name!("landscape")),
            F::Resolution | F::PixelRatio => Actual::Number(self.scale),
            F::Color => Actual::Number(8.0),
            F::ColorIndex | F::Monochrome | F::Grid => Actual::Number(0.0),
            F::HorizontalSegments | F::VerticalSegments | F::Transform3d => Actual::Number(1.0),
            F::DisplayMode => pick(self.fullscreen, name!("fullscreen"), name!("browser")),
            F::Update => Actual::Keyword(name!("fast")),
            F::OverflowBlock | F::OverflowInline => Actual::Keyword(name!("scroll")),
            F::ColorGamut => Actual::Keyword(name!("srgb")),
            F::DynamicRange => Actual::Keyword(name!("standard")),
            F::DevicePosture => Actual::Keyword(name!("continuous")),
            F::Pointer | F::AnyPointer => Actual::Keyword(name!("fine")),
            F::Hover | F::AnyHover => Actual::Keyword(name!("hover")),
            F::Scripting => Actual::Keyword(name!("enabled")),
            F::PrefersReducedMotion => reduce(self.reduced_motion),
            F::PrefersReducedTransparency => reduce(self.reduced_transparency),
            F::PrefersContrast => pick(self.more_contrast, name!("more"), name!("no-preference")),
            F::PrefersColorScheme => pick(self.dark, name!("dark"), name!("light")),
            _ => Actual::Keyword(name!("none")),
        })
    }

    fn compute(&self, value: &Node) -> f64 {
        value.compute(
            &Ctx {
                viewport: self.viewport,
                container: &|| self.viewport,
                ..Ctx::dummy()
            },
            1.0,
        )
    }
}

struct Container<'a> {
    document: &'a Document,
    id: NodeId,
    style: &'a Style,
}

impl Subject for Container<'_> {
    fn feature(&self, feature: Feature) -> Option<Actual> {
        let size = self
            .document
            .tree
            .element(self.id)?
            .container_size?
            .map(|it| it / self.style.zoom);
        let ([width, height], inline) = (size, usize::from(self.style.flow().is_vertical()));
        Some(match feature {
            Feature::Width => Actual::Number(width),
            Feature::Height => Actual::Number(height),
            Feature::InlineSize => Actual::Number(size[inline]),
            Feature::BlockSize => Actual::Number(size[1 - inline]),
            Feature::AspectRatio => Actual::Number(width / height),
            _ => Actual::Keyword(if height >= width {
                name!("portrait")
            } else {
                name!("landscape")
            }),
        })
    }

    fn compute(&self, value: &Node) -> f64 {
        self.document
            .with_context(self.id, self.style, self.style, |cx| value.compute(cx, 1.0))
            / f64::from(self.style.zoom)
    }

    fn other(&self, condition: &Condition) -> Option<bool> {
        match condition {
            Condition::ScrollState(feature, value) => {
                let holds = |value| {
                    self.document
                        .scroll_state(self.id, Name::new(feature.name().as_bytes()), value)
                };
                Some(value.map_or_else(|| !holds(name!("none")), holds))
            }
            Condition::Fallback(value) => Some(
                self.document
                    .has_fallback(self.id, value.as_deref().map_or("", crate::values::text)),
            ),
            _ => self
                .document
                .with_context(self.id, self.style, self.style, |cx| {
                    style_query(
                        condition,
                        &mut self.document.resolver(self.id, &self.style.customs, cx),
                    )
                }),
        }
    }
}

bitflags::bitflags! {
    /// What the computed style depends on besides the rules and the parent's style.
    #[derive(Clone, Copy, PartialEq, Eq)]
    struct Adjust: u16 {
        const BLOCKIFY = 1;
        const ROOT = 1 << 1;
        const TOP_LAYER = 1 << 2;
        const ATOMIC = 1 << 3;
        const IN_SVG = 1 << 4;
        const NORMAL_LINES = 1 << 5;
        const INLINIFY = 1 << 6;
        const LEGEND = 1 << 7;
        const MATH = 1 << 8;
        const TEXT_FIELD = 1 << 9;
        const OUTER_SVG = 1 << 10;
        const INSIDE_MARKER = 1 << 11;
        const SELECT_SIZER = 1 << 12;
        const MARKER_GROUP = 1 << 13;
    }
}

/// What rules say about a highlight pseudo-element of an element, and of its ancestors.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Highlight {
    values: Vec<Value>,
    /// Those of the user agent do not apply.
    pub(crate) has_colors: bool,
}

impl Highlight {
    fn has(id: Id) -> bool {
        matches!(
            id,
            Id::Color
                | Id::BackgroundColor
                | Id::TextShadow
                | Id::TextDecorationLine
                | Id::TextDecorationStyle
                | Id::TextDecorationColor
                | Id::TextDecorationThickness
                | Id::TextUnderlineOffset
                | Id::TextUnderlinePosition
                | Id::TextDecorationSkipInk
                | Id::Fill
                | Id::Stroke
                | Id::StrokeWidth
                | Id::TextEmphasisColor
        )
    }

    /// `below` is what `currentcolor` stands for.
    pub(crate) fn style(&self, originating: &Style, initial: &Style, below: u32) -> Style {
        let mut style = originating.clone();
        let reset = [
            Id::BackgroundColor,
            Id::TextShadow,
            Id::TextDecorationLine,
            Id::TextDecorationStyle,
            Id::TextDecorationColor,
            Id::TextDecorationThickness,
        ];
        reset
            .into_iter()
            .for_each(|it| style.groups.set(&initial.get(it)));
        if below != originating.color() {
            style
                .groups
                .set(&Value::Color(crate::color::Rgba::plain(below)));
        }
        self.values.iter().for_each(|it| style.groups.set(it));
        style
    }

    pub(crate) fn sets(&self, id: Id) -> bool {
        self.values.iter().any(|it| it.id() == id)
    }
}

enum Pending<'a> {
    Declared(&'a Declaration, &'a Block),
    Done(Option<Text>),
}

struct Resolver<'a> {
    document: &'a Document,
    /// The element whose attributes and siblings count.
    id: NodeId,
    parent: NodeId,
    /// The parent's while `declared` is being resolved, and then the element's own.
    customs: &'a Customs,
    declared: Vec<(Name, Pending<'a>)>,
    /// Those whose values have turned out to revert.
    reverting: Vec<(Name, Wide)>,
    cx: &'a Ctx<'a>,
    stack: Stack,
}

impl Resolver<'_> {
    fn declared_value(&mut self, index: usize) -> Option<Text> {
        let (registry, name) = (&self.document.styles.registry, self.declared[index].0);
        let (declaration, block) = match &self.declared[index].1 {
            Pending::Done(value) => return value.clone(),
            Pending::Declared(declaration, block) => (*declaration, *block),
        };
        let registered = registry.get(&name);
        let unset = |customs: &Customs| customs.get(name, registry).cloned();
        let compute = |value: Text, cx: &Ctx| match registered.filter(|it| it.interpolates()) {
            None => Some(value),
            Some(registered) => {
                if let Some(Cached::Registered {
                    by,
                    source,
                    computed,
                }) = declaration.cached.borrow().as_deref()
                    && Rc::ptr_eq(by, registered)
                    && *source == value
                    && cx.zoom == 1.0
                {
                    return computed.clone();
                }
                let own = Ctx {
                    base_url: &block.base_url,
                    deps: Cell::default(),
                    ..*cx
                };
                let computed = match scope_random(Prop::Custom(name), &value) {
                    std::borrow::Cow::Owned(scoped) => {
                        registered.syntax.compute(&scoped.into(), &own)
                    }
                    _ => registered.syntax.compute(&value, &own),
                };
                cx.uses(own.deps.get());
                if own.deps.get().is_empty() && cx.zoom == 1.0 {
                    let by = Rc::clone(registered);
                    declaration
                        .cached
                        .replace(Some(Box::new(Cached::Registered {
                            by,
                            source: value,
                            computed: computed.clone(),
                        })));
                }
                computed
            }
        };
        let value = match &declaration.value {
            Declared::Wide(wide) => self.wide(name, *wide),
            Declared::Text(value) => {
                compute(Rc::clone(value), self.cx).or_else(|| unset(self.customs))
            }
            Declared::Template(template) => {
                let substituted = guarded(self, name, |this| template.value(this));
                if let Some(wide @ (Wide::Revert | Wide::RevertLayer | Wide::RevertRule)) =
                    substituted.as_ref().and_then(|it| Wide::of(it))
                {
                    self.reverting.push((name, wide));
                }
                match substituted.and_then(|it| {
                    Wide::of(&it).map_or_else(|| compute(it, self.cx), |wide| self.wide(name, wide))
                }) {
                    None if registered.is_some() => unset(self.customs),
                    value => value,
                }
            }
        };
        self.declared[index].1 = Pending::Done(value.clone());
        value
    }
}

impl Lookup for Resolver<'_> {
    fn var(&mut self, name: Name) -> Option<Text> {
        match self.declared.binary_search_by_key(&name, |it| it.0) {
            Ok(index) => self.declared_value(index),
            Err(_) => self
                .customs
                .get(name, &self.document.styles.registry)
                .cloned(),
        }
    }

    fn env(&self, name: Name, indices: &[i32]) -> Option<Out> {
        let area = [
            name!("titlebar-area-x"),
            name!("titlebar-area-y"),
            name!("titlebar-area-width"),
            name!("titlebar-area-height"),
        ];
        let mut out = Out::new();
        match area.iter().position(|it| *it == name) {
            _ if !indices.is_empty() => return None,
            Some(index) => {
                self.cx.uses(Deps::VIEWPORT);
                write_px(self.document.environment.titlebar_area?[index], &mut out);
            }
            None if name == name!("preferred-text-scale") => out.push(b'1'),
            None => is_name!(
                name,
                "safe-area-inset-top"
                    | "safe-area-inset-right"
                    | "safe-area-inset-bottom"
                    | "safe-area-inset-left"
                    | "safe-area-max-inset-top"
                    | "safe-area-max-inset-right"
                    | "safe-area-max-inset-bottom"
                    | "safe-area-max-inset-left"
                    | "keyboard-inset-top"
                    | "keyboard-inset-right"
                    | "keyboard-inset-bottom"
                    | "keyboard-inset-left"
                    | "keyboard-inset-width"
                    | "keyboard-inset-height"
            )
            .then(|| out.extend_from_slice(b"0px"))?,
        }
        Some(out)
    }

    fn attr(&self, name: &[u8]) -> Option<Str> {
        self.cx.uses(Deps::ATTRIBUTES);
        let element = self.document.tree.element(self.id)?;
        element
            .attribute(if element.namespace == Namespace::Html {
                Name::lowercase(name)
            } else {
                Name::new(name)
            })
            .map(Str::from)
    }

    fn stack(&mut self) -> &mut Stack {
        &mut self.stack
    }

    fn compute(&self, syntax: &Syntax, value: &Text, base_url: &[u8]) -> Option<Text> {
        let own = Ctx {
            base_url,
            deps: Cell::default(),
            ..*self.cx
        };
        let computed = syntax.compute(value, &own);
        self.cx.uses(own.deps.get());
        computed
    }

    fn syntax_of(&self, name: Name) -> Option<Syntax> {
        self.document
            .styles
            .registry
            .get(&name)
            .map(|it| it.syntax.clone())
    }

    fn wide(&mut self, name: Name, wide: Wide) -> Option<Text> {
        let (tree, registry) = (&self.document.tree, &self.document.styles.registry);
        let registered = registry.get(&name);
        if wide == Wide::Initial
            || wide != Wide::Inherit && registered.is_some_and(|it| !it.inherits)
        {
            return registered?.initial.clone();
        }
        self.cx.uses(Deps::PARENT);
        match tree.style(self.parent) {
            Some(parent) => parent.customs.get(name, registry).cloned(),
            None => registered?.initial.clone(),
        }
    }

    fn matches_media(&self, condition: &Condition) -> bool {
        self.cx.uses(Deps::VIEWPORT);
        condition.evaluate(&self.document.environment) == Some(true)
    }

    fn matches_container(&self, query: &ContainerQuery) -> bool {
        self.cx.uses(Deps::CONTAINER);
        self.document.tree[self.id].set(Flags::QUERIES_CONTAINER | Flags::MEASURES_CONTAINER);
        self.document
            .matches_container(self.id, self.parent == self.id, false, query)
    }

    fn function(&self, name: &str, scope: Option<NodeId>) -> Option<(Rc<Function>, NodeId)> {
        let own = self.document.tree[self.id].scope;
        if own != DOCUMENT {
            self.cx.uses(Deps::ATTRIBUTES);
        }
        match self
            .document
            .find_defined(scope.unwrap_or(own), AtKind::Function, name)?
        {
            (Defined::Function(function), scope) => Some((function, scope)),
            _ => None,
        }
    }

    fn number(&self, value: &Node) -> f64 {
        value.compute(self.cx, 1.0)
    }
}

enum Outcome {
    Wide(Wide),
    Values(Rc<[Value]>),
}

impl Resolver<'_> {
    fn resolve(&mut self, declaration: &Declaration, block: &Block) -> Outcome {
        let (cx, prop) = (self.cx, declaration.prop);
        let is_valid = matches!(declaration.value, Declared::Text(_));
        let parse = |source: &[u8]| {
            let (base_url, deps) = (&*block.base_url, Cell::default());
            let own = Ctx {
                base_url,
                deps,
                ..*cx
            };
            let values = prop.parse(
                &if is_valid {
                    source.into()
                } else {
                    scope_random(prop, source)
                },
                &own,
                is_valid,
            )?;
            Some((values, own.deps.get()))
        };
        let is_usual = cx.zoom == 1.0 && cx.root == self.document.environment.root_font;
        let can_keep = |deps: Deps| is_usual && Deps::OF_DOCUMENT.contains(deps);
        let generations = self.document.environment.generations();
        let (mut out, alias);
        let (source, is_substituted): (&[u8], _) = match &declaration.value {
            Declared::Wide(wide) => return Outcome::Wide(*wide),
            Declared::Text(source) => (source, false),
            Declared::Template(template) => match template.alias() {
                Some(name) => {
                    let Some(value) = self.var(name) else {
                        return Outcome::Wide(Wide::Unset);
                    };
                    alias = value;
                    let source = untainted(&alias);
                    if source.len() < alias.len()
                        && has_tainted_url(source, core::slice::from_ref(&(0..source.len())))
                    {
                        return Outcome::Wide(Wide::Unset);
                    }
                    (source, true)
                }
                None => {
                    out = Out::with_capacity(64);
                    let mut tainted = Vec::new();
                    if template.substitute(self, &mut out, &mut tainted).is_none()
                        || !tainted.is_empty() && has_tainted_url(&out, &tainted)
                    {
                        return Outcome::Wide(Wide::Unset);
                    }
                    (out.trim_ascii(), true)
                }
            },
        };
        let known = match declaration.cached.borrow().as_deref() {
            Some(Cached::Values {
                generation,
                flow,
                substituted,
                values,
                deps,
            }) if (*generation, *flow, true) == (generations(*deps), cx.flow, is_usual)
                && (!is_substituted || **substituted == *source) =>
            {
                Some((Rc::clone(values), *deps))
            }
            _ => None,
        };
        let parsed = match known {
            Some(_) => known,
            None => {
                if is_substituted && let Some(wide) = Wide::of(source) {
                    return Outcome::Wide(wide);
                }
                let parsed = match is_substituted && is_usual {
                    false => parse(source),
                    true => {
                        let mut hasher = FastHasher::default();
                        (prop, cx.flow, source, block.base_url.as_ptr()).hash(&mut hasher);
                        let mut memo = self.document.styles.substituted.borrow_mut();
                        match memo.get(&hasher.finish()) {
                            Some((values, deps, generation))
                                if *generation == generations(*deps) =>
                            {
                                values.clone().map(|it| (it, *deps))
                            }
                            _ => {
                                let parsed = parse(source);
                                let (values, deps) = parsed.clone().unzip();
                                let deps = deps.unwrap_or_default();
                                if can_keep(deps) {
                                    memo.insert(hasher.finish(), (values, deps, generations(deps)));
                                }
                                parsed
                            }
                        }
                    }
                };
                if let Some((values, deps)) = parsed.clone().filter(|it| can_keep(it.1)) {
                    let substituted = if is_substituted {
                        source.into()
                    } else {
                        Box::default()
                    };
                    let (generation, flow) = (generations(deps), cx.flow);
                    *declaration.cached.borrow_mut() = Some(Box::new(Cached::Values {
                        generation,
                        flow,
                        substituted,
                        values,
                        deps,
                    }));
                }
                parsed
            }
        };
        match parsed {
            Some((values, deps)) => {
                cx.uses(deps);
                Outcome::Values(values)
            }
            None => Outcome::Wide(Wide::Unset),
        }
    }
}

/// The index of a block in a list, and of a declaration in the block.
#[derive(Clone, Copy, PartialEq)]
struct At(u16, u16);

/// In the order in which they are computed.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Phase {
    First,
    Font,
    LineHeight,
    Rest,
}

impl Phase {
    fn of(id: Id) -> Phase {
        match id {
            Id::Zoom | Id::ColorScheme | Id::Direction | Id::WritingMode | Id::MathDepth => {
                Phase::First
            }
            Id::LineHeight => Phase::LineHeight,
            _ if Id::FONT_OPTIONS.contains(&id) => Phase::LineHeight,
            _ if id.is_early() => Phase::Font,
            _ => Phase::Rest,
        }
    }
}

/// The declarations that win.
struct Plan {
    /// Sorted.
    customs: Box<[(Name, At)]>,
    /// By phase, and then by declaration.
    longhands: Box<[(Id, At)]>,
    styled: Styled,
}

/// What `revert` and `revert-layer` have ruled out.
struct Reverted<K>(SmallVec<[(K, Wide, Level, u16, u16); 1]>);

impl<K: PartialEq> Reverted<K> {
    fn excludes(&self, key: &K, matched: &Matched, index: u16) -> bool {
        self.0.iter().any(|(it, wide, level, layer, rule)| {
            it == key
                && match wide {
                    Wide::Revert => matched.level != Level::UserAgent || *level == Level::UserAgent,
                    Wide::RevertRule => *rule == index,
                    _ => (matched.level, matched.layer) >= (*level, *layer),
                }
        })
    }
}

impl Plan {
    /// `substituted` has the declarations whose values have turned out to revert.
    fn new(matched: &[Matched], flow: Flow, substituted: &[(At, Wide)]) -> Plan {
        let descending = || {
            (0..matched.len().min(1 << 16))
                .rev()
                .map(|index| (index as u16, &matched[index]))
        };
        let mut ordered: SmallVec<[_; 24]> = descending()
            .filter(|it| it.1.block.declarations().has_important)
            .map(|it| (it, true))
            .collect();
        ordered.sort_by_key(|((_, it), _)| (it.level, it.layer != INLINE, it.layer));
        ordered.extend(descending().map(|it| (it, false)));

        let (mut customs, mut longhands, mut seen) =
            (Vec::new(), Vec::new(), [false; Id::ALL.len()]);
        let (mut reverted_customs, mut reverted) =
            (Reverted(SmallVec::new()), Reverted(SmallVec::new()));
        for ((index, matched), important) in ordered {
            let list = matched
                .block
                .declarations()
                .list
                .iter()
                .take(1 << 16)
                .enumerate()
                .rev();
            for (position, declaration) in list.filter(|it| it.1.important == important) {
                let at = At(index, position as u16);
                let reverts = match declaration.value {
                    Declared::Wide(
                        wide @ (Wide::Revert | Wide::RevertLayer | Wide::RevertRule),
                    ) => Some(wide),
                    _ => substituted.iter().find(|it| it.0 == at).map(|it| it.1),
                };
                if let Prop::Custom(name) = declaration.prop {
                    match reverts {
                        _ if reverted_customs.excludes(&name, matched, index) => {}
                        Some(wide) => reverted_customs.0.push((
                            name,
                            wide,
                            matched.level,
                            matched.layer,
                            index,
                        )),
                        None => customs.push((name, at)),
                    }
                    continue;
                }
                let ids = declaration.prop.longhands(flow);
                let is_all = ids.len() == Id::ALL.len();
                for id in ids.iter().copied() {
                    if seen[id as usize]
                        || is_all && !id.is_in_all()
                        || id == Id::Overlay && matched.level != Level::UserAgent
                        || !matched.only.allows(id)
                        || reverted.excludes(&id, matched, index)
                    {
                        continue;
                    }
                    match reverts {
                        Some(wide) => {
                            reverted
                                .0
                                .push((id, wide, matched.level, matched.layer, index))
                        }
                        None => {
                            seen[id as usize] = true;
                            longhands.push((id, at));
                        }
                    }
                }
            }
        }
        customs.sort_by_key(|it| it.0);
        customs.dedup_by_key(|it| it.0);
        longhands.sort_by_key(|it| Phase::of(it.0));
        let is_for_control = longhands.iter().any(|it| it.0 == Id::Appearance);
        let by_page = longhands
            .iter()
            .filter(|it| is_for_control && matched[usize::from(it.1.0)].level > Level::Hints);
        Plan {
            styled: by_page.map(|it| Styled::by(it.0)).collect(),
            customs: customs.into(),
            longhands: longhands.into(),
        }
    }

    fn phase(&self, phase: Phase) -> &[(Id, At)] {
        let start = self.longhands.partition_point(|it| Phase::of(it.0) < phase);
        &self.longhands[start
            ..self
                .longhands
                .partition_point(|it| Phase::of(it.0) <= phase)]
    }
}

pub(crate) fn snap_border(width: f32, scale: f32) -> f32 {
    match width * scale {
        0.0 => 0.0,
        ..1.0 => 1.0 / scale,
        device => (device + 0.001).floor() / scale,
    }
}

impl Document {
    fn find_container(
        &self,
        id: NodeId,
        inclusive: bool,
        accepts: &dyn Fn(&Style) -> bool,
    ) -> Option<Container<'_>> {
        let candidates = inclusive
            .then_some(id)
            .into_iter()
            .chain(self.tree.flat_ancestors(id));
        candidates
            .filter_map(|id| Some((id, self.tree.style(id)?)))
            .find_map(|(id, style)| {
                accepts(style).then_some(Container {
                    document: self,
                    id,
                    style,
                })
            })
    }

    /// The size of `id` does not count for what `is_beside` it.
    fn matches_container(
        &self,
        id: NodeId,
        inclusive: bool,
        is_beside: bool,
        query: &ContainerQuery,
    ) -> bool {
        let matches = |wanted: &Rc<Wanted>| {
            let container = self.find_container(
                id,
                inclusive && !(is_beside && wanted.axes.contains(&true)),
                &|style| {
                    let (kind, [width, height, inline, block]) =
                        (style.layout.container_type, wanted.axes);
                    let (inline, block) = if style.flow().is_vertical() {
                        (inline || height, block || width)
                    } else {
                        (inline || width, block || height)
                    };
                    (!inline || kind.intersects(ContainerType::SIZE | ContainerType::INLINE_SIZE))
                        && (!block || kind.contains(ContainerType::SIZE))
                        && (!wanted.needs_scroll_state
                            || kind.contains(ContainerType::SCROLL_STATE))
                        && (!wanted.needs_anchor || kind.contains(ContainerType::ANCHORED))
                        && (wanted.name.as_ref())
                            .is_none_or(|name| style.rare.container_name.contains(name))
                },
            );
            let Some(container) = container else {
                return false;
            };
            let known = self
                .styles
                .answers
                .borrow()
                .get(&container.id)
                .and_then(|it| Some(it.iter().find(|it| Rc::ptr_eq(&it.0, wanted))?.1));
            known.unwrap_or_else(|| {
                let answer = wanted.condition.evaluate(&container) == Some(true);
                self.tree[container.id].set(Flags::HAS_ANSWERED);
                self.styles
                    .answers
                    .borrow_mut()
                    .entry(container.id)
                    .or_default()
                    .push((Rc::clone(wanted), answer));
                answer
            })
        };
        query.any_of.iter().any(matches)
            && (query.outer.as_deref())
                .is_none_or(|outer| self.matches_container(id, inclusive, is_beside, outer))
    }

    /// Whether any is different now.
    pub(crate) fn revise_answers(&self, id: NodeId) -> bool {
        let Some(style) = self
            .tree
            .style(id)
            .filter(|_| self.tree[id].has(Flags::HAS_ANSWERED))
        else {
            return false;
        };
        let mut answers = self
            .styles
            .answers
            .borrow_mut()
            .remove(&id)
            .unwrap_or_default();
        let (container, mut has_changed) = (
            Container {
                document: self,
                id,
                style,
            },
            false,
        );
        answers.retain(|it| Rc::strong_count(&it.0) > 1);
        for (wanted, answer) in &mut answers {
            has_changed |=
                core::mem::replace(answer, wanted.condition.evaluate(&container) == Some(true))
                    != *answer;
        }
        self.styles.answers.borrow_mut().insert(id, answers);
        has_changed
    }

    fn container_size(&self, id: NodeId) -> [f32; 2] {
        self.tree[id].set(Flags::MEASURES_CONTAINER);
        [0, 1].map(|axis| {
            let containers = self.tree.flat_ancestors(id).filter(|it| {
                self.tree
                    .style(*it)
                    .is_some_and(|it| it.queried_axes()[axis])
            });
            let mut containers = containers.inspect(|it| self.tree[*it].set(Flags::IS_MEASURED));
            containers
                .find_map(|it| self.tree.element(it)?.container_size)
                .unwrap_or(self.environment.viewport)[axis]
        })
    }

    fn visit_rule_sets(&self, query: &Query, visit: &mut dyn FnMut(&RuleSet, Kind, NodeId, Level)) {
        let (tree, id) = (&self.tree, query.id);
        let mut scoped = |scope: NodeId, kind, level| {
            if let Some(rules) = self.styles.scopes.get(&scope) {
                visit(&rules.borrow(), kind, tree.host_of(scope), level);
            }
        };
        let shadow_root = tree.element(id).map_or(0, |element| element.shadow_root);
        if shadow_root != 0 {
            scoped(shadow_root, Kind::Host, Level::Inner(0));
        }
        if tree[id].slot != 0 && !tree.is_slot(id) {
            let slots: SmallVec<[_; 2]> = (1..=u8::MAX).rev().zip(tree.slots(id)).collect();
            slots.into_iter().rev().for_each(|(level, slot)| {
                scoped(tree[slot].scope, Kind::Slotted, Level::Inner(level))
            });
        }
        let scope = tree[id].scope;
        scoped(scope, Kind::Normal, Level::Own);
        if scope != DOCUMENT && tree.element(id).is_some_and(|it| it.has(name!("part"))) {
            (0..u8::MAX)
                .zip(tree.exporting_hosts(id))
                .for_each(|(level, host)| {
                    scoped(tree[host].scope, Kind::Part, Level::Outer(level))
                });
        }
    }

    fn with_query<R>(
        &self,
        id: NodeId,
        pseudo: Pseudo,
        bloom: Option<&Bloom>,
        read: impl FnOnce(Query) -> R,
    ) -> R {
        read(Query {
            tree: &self.tree,
            id,
            pseudo,
            pseudo_state: State::empty(),
            with_starting: false,
            bloom,
            has_results: &self.styles.has_results,
            roots: &Default::default(),
            signature: bloom
                .filter(|it| it.is_above(&self.tree, id))
                .map_or(Name::NONE, |it| {
                    self.styles
                        .dependencies
                        .borrow()
                        .signature(&self.tree, id, it)
                }),
            container: &|query| {
                self.tree[id].set(Flags::QUERIES_CONTAINER);
                let is_beside = matches!(
                    pseudo,
                    Pseudo::Scroll(ScrollPart::Group | ScrollPart::Button(..))
                ) && !self.tree.is_root(id);
                self.matches_container(id, pseudo != Pseudo::None, is_beside, query)
            },
        })
    }

    /// Parses the rules that have been waiting for something that the element has.
    pub(crate) fn activate_rules(&self, id: NodeId) {
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let dependencies = &mut self.styles.dependencies.borrow_mut();
        self.styles
            .user_agent
            .borrow_mut()
            .activate_for_matching(element, dependencies);
        if let Some(rules) = self.styles.scopes.get(&self.tree[id].scope) {
            rules
                .borrow_mut()
                .activate_for_matching(element, dependencies);
        }
    }

    /// `BEFORE`, `AFTER` and `MARKER`, as bits, if a rule gives them content.
    pub(crate) fn generated_by_rules(&self, id: NodeId, bloom: Option<&Bloom>) -> u8 {
        if let Some(element) = self.tree.element(id).filter(|it| it.pseudo.has_nested()) {
            let has = |pseudo| u8::from(self.has_rules_for(element.pseudo.nested(pseudo)));
            return has(Pseudo::Before) << BEFORE | has(Pseudo::After) << AFTER;
        }
        let found = self.with_query(id, Pseudo::Before, bloom, |query| {
            let mut found = 0;
            if self.has_default_styles(id) {
                self.styles
                    .user_agent
                    .borrow()
                    .generated(&query, Kind::Normal, 0, &mut found);
            }
            self.visit_rule_sets(&query, &mut |rules, kind, host, _| {
                rules.generated(&query, kind, host, &mut found)
            });
            found
        });
        debug_assert!(bloom.is_none() || found == self.generated_by_rules(id, None));
        found
    }

    fn has_default_styles(&self, id: NodeId) -> bool {
        self.tree
            .element(id)
            .is_some_and(|it| it.namespace != Namespace::Other)
    }

    fn collect_rules(&self, query: &Query, matched: &mut Found, hints: Option<&Rc<Block>>) {
        if self.has_default_styles(query.id) {
            self.styles.user_agent.borrow().collect(
                query,
                Kind::Normal,
                0,
                Level::UserAgent,
                matched,
            );
        }
        matched.extend(hints.map(|block| {
            (
                0,
                Matched {
                    block: Rc::clone(block),
                    level: Level::Hints,
                    layer: 0,
                    only: Only::default(),
                },
            )
        }));
        self.visit_rule_sets(query, &mut |rules, kind, host, level| {
            rules.collect(query, kind, host, level, matched);
        });
    }

    pub(crate) fn match_rules(
        &self,
        id: NodeId,
        bloom: Option<&Bloom>,
        with_starting: bool,
    ) -> Rc<RuleList> {
        let mut matched = Found::new();
        let Some(element) = self.tree.element(id) else {
            return self.styles.intern(matched);
        };
        if !element.is_generated() {
            self.activate_rules(id);
            self.with_query(id, Pseudo::None, bloom, |query| {
                self.collect_rules(
                    &Query {
                        with_starting,
                        ..query
                    },
                    &mut matched,
                    element.hints.as_ref(),
                );
                debug_assert!({
                    let mut expected = Found::new();
                    self.collect_rules(
                        &Query {
                            with_starting,
                            signature: Name::NONE,
                            ..query
                        },
                        &mut expected,
                        element.hints.as_ref(),
                    );
                    expected
                        .iter()
                        .map(|it| it.0)
                        .eq(matched.iter().map(|it| it.0))
                });
            });
        }
        if element.pseudo != Pseudo::None {
            let is_transition = matches!(element.pseudo, Pseudo::Transition(..));
            self.tree.matched_part.set(id);
            self.with_query(
                element.originator,
                element.pseudo,
                bloom.filter(|_| !is_transition),
                |query| {
                    let pseudo_state = element.state;
                    let query = Query {
                        with_starting,
                        pseudo_state,
                        ..query
                    };
                    self.collect_rules(
                        &query,
                        &mut matched,
                        element.hints.as_ref().filter(|_| is_transition),
                    );
                },
            );
        }
        if let Some(outer) = self
            .tree
            .element(element.originator)
            .filter(|it| it.pseudo.has_nested())
        {
            self.with_query(
                outer.originator,
                outer.pseudo.nested(element.pseudo),
                None,
                |query| {
                    self.collect_rules(
                        &Query {
                            with_starting,
                            ..query
                        },
                        &mut matched,
                        None,
                    );
                },
            );
        }
        if let Some(block) = &element.inline_style {
            let inline = Matched {
                only: Only::default(),
                block: Rc::clone(block),
                level: Level::Own,
                layer: INLINE,
            };
            matched.insert(
                matched.partition_point(|it| it.1.level <= Level::Own),
                (0, inline),
            );
        }
        if let Some(block) = self.smil.effects.styles.get(&id) {
            matched.push((
                0,
                Matched {
                    block: Rc::clone(block),
                    level: Level::Outer(u8::MAX),
                    layer: INLINE,
                    only: Only::default(),
                },
            ));
        }
        self.styles.intern(matched)
    }

    pub(crate) fn level_of_declaration(&self, id: NodeId, property: Id) -> Option<Level> {
        let (rules, style) = (self.tree.element(id)?.rules.as_ref()?, self.tree.style(id)?);
        let plan = Plan::new(&rules.matched, style.flow(), &[]);
        plan.longhands
            .iter()
            .find(|it| it.0 == property)
            .map(|it| rules.matched[usize::from(it.1.0)].level)
    }

    /// Of a pseudo-element that has no node. `None` if no rule of the author applies to it.
    pub(crate) fn pseudo_style(
        &self,
        id: NodeId,
        pseudo: Pseudo,
        pseudo_state: State,
    ) -> Option<Rc<Style>> {
        self.pseudo_style_under(id, pseudo, pseudo_state, self.tree.style(id)?)
    }

    /// <https://drafts.csswg.org/css-pseudo/#highlight-cascade>
    pub(crate) fn highlight(&self, id: NodeId, pseudo: Pseudo) -> Option<Rc<Highlight>> {
        let is_internal = matches!(pseudo, Pseudo::Highlight(name) if crate::name::is_name!(name, "-internal-match" | "-internal-active-match"));
        (is_internal || self.has_rules_for(pseudo)).then_some(())?;
        let (mut unknown, mut known) = (SmallVec::<[NodeId; 8]>::new(), None);
        for it in core::iter::once(id).chain(self.tree.flat_ancestors(id)) {
            match self
                .marks
                .styles
                .borrow()
                .get(&it)
                .and_then(|all| all.iter().find(|it| it.0 == pseudo))
            {
                Some(found) => {
                    known.clone_from(&found.1);
                    break;
                }
                None => unknown.push(it),
            }
        }
        unknown.into_iter().rfold(known, |parent, it| {
            let own = self.highlight_under(it, pseudo, parent);
            self.marks
                .styles
                .borrow_mut()
                .entry(it)
                .or_default()
                .push((pseudo, own.clone()));
            own
        })
    }

    fn highlight_rules(
        &self,
        id: NodeId,
        pseudo: Pseudo,
        style: &Style,
    ) -> Option<(Rc<RuleList>, Customs)> {
        let mut matched = Found::new();
        self.with_query(id, pseudo, None, |query| {
            self.collect_rules(&query, &mut matched, None)
        });
        let rules = (!matched.is_empty()).then(|| self.styles.intern(matched))?;
        let has_customs = !rules.plan(Flow::DEFAULT).customs.is_empty();
        let customs = if has_customs {
            self.cascade_customs(id, &rules, style, style, &[]).0
        } else {
            style.customs.clone()
        };
        Some((rules, customs))
    }

    pub(crate) fn computed_highlight(&self, id: NodeId, pseudo: Pseudo) -> Option<Style> {
        let (style, highlight) = (
            self.style_on_demand(id)?,
            self.highlight(id, pseudo).unwrap_or_default(),
        );
        let mut own = highlight.style(&style, &self.styles.initial, style.color());
        if let Some((_, customs)) = self.highlight_rules(id, pseudo, &style) {
            own.customs = customs;
        }
        Some(own)
    }

    fn highlight_under(
        &self,
        id: NodeId,
        pseudo: Pseudo,
        parent: Option<Rc<Highlight>>,
    ) -> Option<Rc<Highlight>> {
        const CURRENT: u32 = 0x0102_0304;
        let Some(style) = self
            .tree
            .style(id)
            .cloned()
            .or_else(|| self.style_on_demand(id))
        else {
            return parent;
        };
        let Some((rules, customs)) = self.highlight_rules(id, pseudo, &style) else {
            return parent;
        };
        let mut probe = Style::clone(&style);
        probe
            .groups
            .set(&Value::Color(crate::color::Rgba::plain(CURRENT)));
        let mut highlight = parent.as_deref().cloned().unwrap_or_default();
        self.with_context(id, &style, &probe, |cx| {
            let mut resolver = self.resolver(id, &customs, cx);
            for (property, at) in rules
                .plan(style.flow())
                .longhands
                .iter()
                .filter(|it| Highlight::has(it.0))
            {
                let (declaration, block) = rules.declaration(*at);
                let value = match resolver.resolve(declaration, block) {
                    Outcome::Values(values) => {
                        values.iter().find(|it| it.id() == *property).cloned()
                    }
                    Outcome::Wide(Wide::Initial) => Some(self.styles.initial.get(*property)),
                    Outcome::Wide(wide) => {
                        highlight.has_colors |= wide != Wide::Revert
                            && matches!(property, Id::Color | Id::BackgroundColor);
                        continue;
                    }
                };
                highlight.has_colors |= matches!(property, Id::Color | Id::BackgroundColor);
                highlight.values.retain(|it| it.id() != *property);
                highlight.values.extend(
                    value.filter(|it| !matches!(it, Value::Color(color) if color.0 == CURRENT)),
                );
            }
        });
        Some(
            parent
                .filter(|it| **it == highlight)
                .unwrap_or_else(|| Rc::new(highlight)),
        )
    }

    /// Paints the highlights again if the styles of `changed` made a difference.
    pub(crate) fn update_highlights(&mut self, changed: &[NodeId]) {
        let is_same = changed.iter().all(|id| {
            let old = self.marks.styles.borrow_mut().remove(id);
            old.into_iter()
                .flatten()
                .all(|(pseudo, old)| self.highlight(*id, pseudo) == old)
        });
        if !is_same {
            self.forget_highlights();
        }
    }

    pub(crate) fn is_set_by_author(&self, id: NodeId, property: &[u8]) -> bool {
        let (Some(element), Some(Prop::Long(property))) =
            (self.tree.element(id), Prop::from_name(property))
        else {
            return false;
        };
        element
            .rules
            .as_ref()
            .zip(element.style.as_ref())
            .is_some_and(|(rules, style)| {
                let winner = rules
                    .plan(style.flow())
                    .longhands
                    .iter()
                    .find(|it| it.0 == property);
                winner
                    .is_some_and(|it| rules.matched[usize::from(it.1.0)].level != Level::UserAgent)
            })
    }

    pub(crate) fn has_rules_for(&self, pseudo: Pseudo) -> bool {
        self.styles
            .scopes
            .values()
            .any(|it| it.borrow().has_rules_for(pseudo))
    }

    /// As if `parent` were the style of the parent.
    pub(crate) fn style_under(&self, id: NodeId, parent: &Rc<Style>) -> Rc<Style> {
        let rules = self.tree.element(id).and_then(|it| it.rules.as_ref());
        rules.map_or_else(
            || Rc::clone(parent),
            |rules| self.compute_style(id, rules, parent),
        )
    }

    pub(crate) fn pseudo_style_under(
        &self,
        id: NodeId,
        pseudo: Pseudo,
        pseudo_state: State,
        parent: &Rc<Style>,
    ) -> Option<Rc<Style>> {
        let outer = self.tree.element(id).filter(|it| it.pseudo.has_nested());
        let (id, pseudo) =
            outer.map_or((id, pseudo), |it| (it.originator, it.pseudo.nested(pseudo)));
        let scope = self.styles.scopes.get(&self.tree[id].scope)?;
        scope.borrow().has_rules_for(pseudo).then_some(())?;
        let mut matched = Found::new();
        self.with_query(id, pseudo, None, |query| {
            self.collect_rules(
                &Query {
                    pseudo_state,
                    ..query
                },
                &mut matched,
                None,
            );
        });
        let rules = self.styles.intern(matched);
        rules
            .has_author_rules()
            .then(|| self.shared_style(id, &rules, parent, Adjust::empty()))
    }

    fn adjustments(&self, id: NodeId) -> Adjust {
        let mut adjust = Adjust::empty();
        let Some(element) = self.tree.element(id) else {
            return adjust;
        };
        let moved_to = self.layout_parent_of_part(id);
        let layout_parent = (moved_to
            .into_iter()
            .chain(self.tree.flat_ancestors(moved_to.unwrap_or(id))))
        .filter_map(|ancestor| self.tree.style(ancestor))
        .find(|style| style.display() != Display::Contents);
        let is_math = element.namespace == Namespace::MathMl;
        let is_blockified = layout_parent.is_some_and(|it| {
            it.display().blockifies_children()
                && !it.clamps_lines()
                && (is_math || !it.display().is_math())
        });
        adjust.set(Adjust::MATH, is_math);
        adjust.set(Adjust::BLOCKIFY, is_blockified);
        adjust.set(Adjust::LEGEND, element.html_tag() == name!("legend"));
        adjust.set(
            Adjust::INLINIFY,
            layout_parent.is_some_and(|it| {
                matches!(
                    it.display(),
                    Display::Ruby | Display::BlockRuby | Display::RubyText
                )
            }),
        );
        adjust.set(
            Adjust::TEXT_FIELD,
            element.pseudo == Pseudo::Part(name!("-webkit-textfield-decoration-container")),
        );
        adjust.set(
            Adjust::MARKER_GROUP,
            element.pseudo == Pseudo::Scroll(ScrollPart::Group),
        );
        adjust.set(
            Adjust::SELECT_SIZER,
            element.pseudo == Pseudo::Part(name!("-internal-select-sizer")),
        );
        adjust.set(Adjust::ROOT, self.tree.is_root(id));
        adjust.set(
            Adjust::TOP_LAYER,
            self.tree[id].has(Flags::TOP_LAYER) || element.pseudo == Pseudo::Backdrop,
        );
        if matches!(element.pseudo, Pseudo::Part(part) if part == name!("-internal-editor-container"))
        {
            let clips = |it: &Rc<Style>| match if it.flow().is_vertical() {
                &it.layout.width
            } else {
                &it.layout.height
            } {
                Size::Length(Lp::Px(height)) if *height > it.line_height().floor() => true,
                Size::Length(Lp::Fraction(_) | Lp::Calc(_)) => true,
                _ => {
                    it.metrics.ascent + it.metrics.descent + it.metrics.line_gap > it.line_height()
                }
            };
            adjust.set(
                Adjust::NORMAL_LINES,
                self.tree.style(element.originator).is_some_and(clips),
            );
        }
        let is_svg = |id| {
            self.tree
                .element(id)
                .is_some_and(|it| it.namespace == Namespace::Svg)
        };
        adjust.set(Adjust::IN_SVG, is_svg(id) && is_svg(self.tree[id].parent));
        adjust.set(
            Adjust::OUTER_SVG,
            is_svg(id) && !adjust.contains(Adjust::IN_SVG),
        );
        let is_inside = || {
            self.tree
                .style(element.originator)
                .is_some_and(|it| it.text.list_position == ListStylePosition::Inside)
                || self.tree.html_tag(element.originator) == name!("summary")
        };
        adjust.set(
            Adjust::INSIDE_MARKER,
            element.pseudo == Pseudo::Marker && is_inside(),
        );
        adjust.set(
            Adjust::ATOMIC,
            is_name!(
                element.html_tag(),
                "img"
                    | "video"
                    | "audio"
                    | "canvas"
                    | "iframe"
                    | "embed"
                    | "object"
                    | "input"
                    | "textarea"
                    | "select"
                    | "meter"
                    | "progress"
                    | "br"
                    | "wbr"
            ),
        );
        adjust
    }

    pub(crate) fn compute_style(
        &self,
        id: NodeId,
        rules: &RuleList,
        parent: &Rc<Style>,
    ) -> Rc<Style> {
        self.shared_style(id, rules, parent, self.adjustments(id))
    }

    /// With declarations that win over all that are not important.
    pub(crate) fn style_with(&self, id: NodeId, block: Rc<Block>) -> Option<Style> {
        let (rules, parent) = (
            self.tree.element(id)?.rules.as_ref()?,
            self.tree.style(self.tree.flat_parent(id))?,
        );
        let matched = rules
            .matched
            .iter()
            .cloned()
            .chain([Matched {
                block,
                level: Level::Outer(u8::MAX),
                layer: INLINE - 1,
                only: Only::default(),
            }])
            .collect();
        let rules = RuleList {
            matched,
            epoch: Cell::default(),
            shared: Default::default(),
            customs: Default::default(),
            plan: OnceCell::new(),
            other_plans: OnceCell::new(),
        };
        Some(self.cascade(id, &rules, parent, self.adjustments(id), &[], &[]))
    }

    /// The tree that the names in the value belong to.
    pub(crate) fn tree_of_value(&self, id: NodeId, property: Id) -> NodeId {
        let Some(element) = self.tree.element(id) else {
            return 0;
        };
        let winner = element.rules.as_ref().and_then(|rules| {
            rules
                .plan(element.style.as_ref().map_or(Flow::DEFAULT, |it| it.flow()))
                .longhands
                .iter()
                .find(|it| it.0 == property)
                .map(|it| rules.matched[usize::from(it.1.0)].level)
        });
        let of = if element.is_generated() {
            element.originator
        } else {
            id
        };
        let in_tree = match winner {
            Some(Level::Outer(level)) => self.tree.exporting_hosts(of).nth(level.into()),
            Some(Level::Inner(0)) => return self.tree.element(of).map_or(0, |it| it.shadow_root),
            Some(Level::Inner(level)) => self.tree.slots(of).nth((u8::MAX - level).into()),
            _ => None,
        };
        self.tree[in_tree.unwrap_or(of)].scope
    }

    pub(crate) fn is_set_by_page(&self, id: NodeId, property: Id) -> bool {
        let known = self
            .tree
            .element(id)
            .and_then(|it| it.rules.as_ref().zip(it.style.as_ref()));
        known.is_some_and(|(rules, style)| {
            rules.plan(style.flow()).longhands.iter().any(|it| {
                it.0 == property && rules.matched[usize::from(it.1.0)].level != Level::UserAgent
            })
        })
    }

    pub(crate) fn important_properties(&self, id: NodeId) -> Vec<Id> {
        let Some((rules, style)) = self
            .tree
            .element(id)
            .and_then(|it| it.rules.as_ref().zip(it.style.as_ref()))
        else {
            return Vec::new();
        };
        rules
            .plan(style.flow())
            .longhands
            .iter()
            .filter(|it| rules.declaration(it.1).0.important)
            .map(|it| it.0)
            .collect()
    }

    pub(crate) fn compute_animated_style(
        &self,
        id: NodeId,
        rules: &RuleList,
        parent: &Style,
        customs: &[(Name, Option<Text>)],
        properties: &[Value],
    ) -> Style {
        self.cascade(id, rules, parent, self.adjustments(id), customs, properties)
    }

    fn shared_style(
        &self,
        id: NodeId,
        rules: &RuleList,
        parent: &Rc<Style>,
        adjust: Adjust,
    ) -> Rc<Style> {
        let generations = self.environment.generations();
        let shared = rules.shared.borrow();
        let found = shared.iter().find(|it| {
            (it.adjust, it.generation) == (adjust, generations(it.style.deps))
                && (Rc::ptr_eq(&it.parent, parent)
                    || !it.style.deps.contains(Deps::PARENT)
                        && it.parent.inherits_the_same_as(parent))
        });
        if let Some(found) = found {
            return Rc::clone(&found.style);
        }
        drop(shared);
        let mut style = self.cascade(id, rules, parent, adjust, &[], &[]);
        let mut shared = rules.shared.borrow_mut();
        if let Some(last) = shared.first() {
            style.groups.share_with(&last.style);
        }
        let style = Rc::new(style);
        if !style
            .deps
            .intersects(Deps::ATTRIBUTES | Deps::SIBLINGS | Deps::CONTAINER)
        {
            shared.truncate(5);
            let (parent, generation, style) = (
                Rc::clone(parent),
                generations(style.deps),
                Rc::clone(&style),
            );
            shared.insert(
                0,
                Shared {
                    parent,
                    adjust,
                    generation,
                    style,
                },
            );
        }
        style
    }

    pub(crate) fn with_context<R>(
        &self,
        id: NodeId,
        fonts_from: &Style,
        own: &Style,
        read: impl FnOnce(&Ctx) -> R,
    ) -> R {
        read(&Ctx {
            viewport: [0, 1]
                .map(|axis| self.environment.viewport[axis] - self.root_scrollbars[axis]),
            root: self.environment.root_font,
            font: fonts_from.font_units(),
            metrics: &|| fonts_from.metrics,
            container: &|| self.container_size(id),
            parent: &|property| {
                let mut out = Out::new();
                self.tree
                    .style(self.tree.flat_parent(id))
                    .unwrap_or(&self.styles.initial)
                    .get(property)
                    .write(&mut out);
                out
            },
            siblings: &|| {
                let of = self
                    .tree
                    .element(id)
                    .filter(|it| it.is_generated())
                    .map_or(id, |it| it.originator);
                self.tree[self.tree[of].parent].set(Flags::COUNTED_CHILDREN);
                let index = self.tree.previous_elements(of).count() + 1;
                (index, index + self.tree.next_elements(of).count())
            },
            element: id,
            color: fonts_from.ink.color,
            accent: self.environment.accent,
            dark: own.dark,
            zoom: own.zoom,
            flow: own.flow(),
            base_url: b"",
            deps: Cell::default(),
        })
    }

    fn resolver<'a>(&'a self, id: NodeId, customs: &'a Customs, cx: &'a Ctx<'a>) -> Resolver<'a> {
        let element = self
            .tree
            .element(id)
            .filter(|element| element.is_generated());
        Resolver {
            document: self,
            id: element.map_or(id, |element| element.originator),
            parent: self.tree.flat_parent(id),
            customs,
            declared: Vec::new(),
            reverting: Vec::new(),
            cx,
            stack: Stack::default(),
        }
    }

    fn shared_customs(&self, id: NodeId, rules: &RuleList, parent: &Style) -> (Customs, Deps) {
        let winners = &rules.plan(Flow::DEFAULT).customs;
        if winners.len() < 8 {
            return self.cascade_customs(id, rules, parent, parent, &[]);
        }
        let hash = rules.customs.get_or_init(|| {
            let mut hasher = FastHasher::default();
            winners
                .iter()
                .for_each(|it| core::ptr::from_ref(rules.declaration(it.1).0).hash(&mut hasher));
            hasher.finish()
        });
        let key = (*hash, Rc::as_ptr(&parent.customs.inherited));
        if let Some(known) = self.styles.customs.borrow().get(&key) {
            return (known.0.clone(), Deps::empty());
        }
        let (customs, deps) = self.cascade_customs(id, rules, parent, parent, &[]);
        if deps.is_empty() {
            let mut known = self.styles.customs.borrow_mut();
            if known.len() >= 512 {
                known.clear();
            }
            known.insert(
                key,
                (
                    customs.clone(),
                    Rc::clone(&parent.customs.inherited),
                    rules.matched.clone(),
                ),
            );
        }
        (customs, deps)
    }

    fn cascade_customs(
        &self,
        id: NodeId,
        rules: &RuleList,
        parent: &Style,
        own: &Style,
        animated: &[(Name, Option<Text>)],
    ) -> (Customs, Deps) {
        let (inherited, winners) = (
            Customs::inheriting(&parent.customs),
            &rules.plan(Flow::DEFAULT).customs,
        );
        if winners.is_empty() && animated.is_empty() {
            return (inherited, Deps::empty());
        }
        let (mut substituted, mut again) = (Vec::new(), None);
        self.with_context(id, own, own, |cx| {
            loop {
                let winners = again.as_ref().map_or(winners, |it: &Plan| &it.customs);
                let declared = winners.iter().map(|(name, at)| {
                    let (declaration, block) = rules.declaration(*at);
                    (*name, Pending::Declared(declaration, block))
                });
                let mut declared: Vec<_> = animated
                    .iter()
                    .map(|(name, value)| (*name, Pending::Done(value.clone())))
                    .chain(declared)
                    .collect();
                if !animated.is_empty() {
                    declared.sort_by_key(|it| it.0);
                    declared.dedup_by_key(|it| it.0);
                }
                let mut resolver = Resolver {
                    declared,
                    ..self.resolver(id, &inherited, cx)
                };
                let (mut own, mut local) = (Entries::new(), Entries::new());
                for index in 0..resolver.declared.len() {
                    let (name, value) =
                        (resolver.declared[index].0, resolver.declared_value(index));
                    let is_local = self
                        .styles
                        .registry
                        .get(&name)
                        .is_some_and(|it| !it.inherits);
                    (if is_local { &mut local } else { &mut own }).push((name, value));
                }
                if resolver.reverting.is_empty() {
                    return (
                        Customs::new(&parent.customs, own, local, &self.styles.recent_customs),
                        cx.deps.get(),
                    );
                }
                cx.uses(Deps::PARENT);
                substituted.extend(resolver.reverting.iter().filter_map(|(name, wide)| {
                    Some((winners.iter().find(|it| it.0 == *name)?.1, *wide))
                }));
                again = Some(Plan::new(&rules.matched, Flow::DEFAULT, &substituted));
            }
        })
    }

    /// `fonts_from` is the style itself if it is `None`.
    fn cascade_phase(
        &self,
        id: NodeId,
        rules: &RuleList,
        phase: Phase,
        parent: &Style,
        style: &mut Style,
        fonts_from: Option<&Style>,
    ) {
        let (flow, initial) = (style.flow(), &self.styles.initial.groups);
        let mut winners = rules.plan(flow).phase(phase);
        if winners.is_empty() {
            return;
        }
        let (mut substituted, mut again) = (Vec::new(), None);
        loop {
            let (mut groups, known) = (style.groups.clone(), substituted.len());
            let deps = self.with_context(id, fonts_from.unwrap_or(style), style, |cx| {
                let (mut font, mut root) = (cx.font, cx.root);
                if phase == Phase::LineHeight {
                    font.line_height = parent.line_height() * style.zoom / parent.zoom;
                }
                if core::ptr::eq(parent, &raw const *self.styles.initial) {
                    root = if fonts_from.is_some() {
                        parent
                    } else {
                        &*style
                    }
                    .root_units();
                    root.line_height = font.line_height / style.zoom;
                }
                let cx = &Ctx {
                    font,
                    root,
                    deps: Cell::default(),
                    ..*cx
                };
                let mut resolver = self.resolver(id, &style.customs, cx);
                for won in winners.chunk_by(|a, b| a.1 == b.1) {
                    let (declaration, block) = rules.declaration(won[0].1);
                    match resolver.resolve(declaration, block) {
                        Outcome::Values(values) if values.len() == won.len() => {
                            values.iter().for_each(|it| groups.set(it))
                        }
                        Outcome::Values(values) => {
                            let has_won = |it: &&Value| won.iter().any(|won| won.0 == it.id());
                            values.iter().filter(has_won).for_each(|it| groups.set(it));
                        }
                        Outcome::Wide(
                            wide @ (Wide::Revert | Wide::RevertLayer | Wide::RevertRule),
                        ) => substituted.push((won[0].1, wide)),
                        Outcome::Wide(wide) => {
                            for (id, _) in won {
                                match (wide, id.is_inherited()) {
                                    (Wide::Initial, true) => {
                                        groups.set(&initial.get(*id).zoomed(cx.zoom))
                                    }
                                    (Wide::Inherit, false) => {
                                        cx.uses(Deps::PARENT);
                                        groups.set(&parent.get(*id).zoomed(cx.zoom / parent.zoom));
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                cx.deps.get()
            });
            style.deps |= deps;
            if substituted.len() == known {
                style.groups = groups;
                return;
            }
            winners = again
                .insert(Plan::new(&rules.matched, flow, &substituted))
                .phase(phase);
        }
    }

    pub(crate) fn resolve_font(&self, id: NodeId, style: &mut Style, parent: &Style) {
        let has_same_options = Rc::ptr_eq(&style.svg, &parent.svg)
            || Id::FONT_OPTIONS
                .iter()
                .all(|it| style.other_if_set(*it) == parent.other_if_set(*it));
        if style.font == parent.font && has_same_options {
            (style.font_id, style.metrics) = (parent.font_id, parent.metrics);
            style.groups.font = Rc::clone(&parent.font);
        } else {
            style.font_id = self
                .fonts
                .describe(style, &self.defined_for_font(id, style));
            style.metrics = self.fonts.metrics(style.font_id, style.font.size.0);
        }
    }

    fn cascade(
        &self,
        id: NodeId,
        rules: &RuleList,
        parent: &Style,
        adjust: Adjust,
        animated_customs: &[(Name, Option<Text>)],
        animated: &[Value],
    ) -> Style {
        let (customs, deps) = match animated_customs.is_empty() && parent.zoom == 1.0 {
            true => self.shared_customs(id, rules, parent),
            false => self.cascade_customs(id, rules, parent, parent, animated_customs),
        };
        let animate = |style: &mut Style, phase| {
            animated
                .iter()
                .filter(|it| Phase::of(it.id()) == phase)
                .for_each(|it| style.groups.set(it))
        };
        let mut style = Style {
            groups: Groups::inheriting(parent, &self.styles.initial),
            customs,
            deps,
            was_inline: false,
            is_atomic: false,
            computed_sides: (Float::None, Clear::None),
            look: Look::None,
            plainness: Default::default(),
            animates: Default::default(),
            ..*parent
        };
        if core::ptr::eq(parent, &raw const *self.styles.initial) {
            style.dark = self.environment.is_dark(ColorScheme::empty());
        }
        if rules
            .plan(Flow::DEFAULT)
            .longhands
            .first()
            .is_some_and(|it| Phase::of(it.0) != Phase::Rest)
            || !animated.is_empty()
        {
            self.cascade_phase(id, rules, Phase::First, parent, &mut style, Some(parent));
            animate(&mut style, Phase::First);
            let (scheme, zoom) = (style.ink.color_scheme, style.rare.zoom.0);
            style.dark = self.environment.is_dark(scheme);
            let mut zoomed = None;
            if zoom != 1.0 {
                style.zoom *= zoom;
                let mut inherited = vec![Id::FontSize, Id::StrokeWidth];
                parent.differences(&self.styles.initial, |it| {
                    inherited
                        .extend((it.is_inherited() && Phase::of(it) != Phase::First).then_some(it))
                });
                inherited
                    .into_iter()
                    .for_each(|it| style.groups.set(&parent.get(it).zoomed(zoom)));
                zoomed = Some(style.clone());
            }
            let fonts_from = zoomed.as_ref().unwrap_or(parent);
            self.cascade_phase(id, rules, Phase::Font, parent, &mut style, Some(fonts_from));
            if style.deps.contains(Deps::MATH_FONT_SIZE) {
                style.groups.set(&Value::FontSize(FontSize(
                    style.font.size.0 * self.script_scale(&style, parent),
                )));
            }
            let is_keyword = style.deps.contains(Deps::FONT_SIZE_KEYWORD);
            style.has_absolute_font_size = style.deps.contains(Deps::ABSOLUTE_FONT_SIZE)
                || parent.has_absolute_font_size && !is_keyword;
            let default_size = |style: &Style| {
                if *style.font.family.0 == *b"\x01monospace\0" {
                    13.0
                } else {
                    16.0
                }
            };
            let scale = default_size(&style)
                / if is_keyword {
                    16.0
                } else {
                    default_size(parent)
                };
            if scale != 1.0 && !style.has_absolute_font_size {
                style
                    .groups
                    .set(&Value::FontSize(FontSize(style.font.size.0 * scale)));
            }
            animate(&mut style, Phase::Font);
            if rules
                .plan(style.flow())
                .phase(Phase::LineHeight)
                .iter()
                .any(|it| it.0 == Id::FontSizeAdjust)
            {
                let mut plain = style.clone();
                plain
                    .groups
                    .set(&self.styles.initial.get(Id::FontSizeAdjust));
                self.resolve_font(id, &mut plain, parent);
                style.metrics = plain.metrics;
            }
            self.cascade_phase(id, rules, Phase::LineHeight, parent, &mut style, None);
            animate(&mut style, Phase::LineHeight);
            self.resolve_font(id, &mut style, parent);
            if deps.contains(Deps::FONT_UNITS) && !Rc::ptr_eq(&style.font, &parent.font)
                || !deps.is_empty() && (style.dark, style.zoom) != (parent.dark, parent.zoom)
            {
                style.customs = self
                    .cascade_customs(id, rules, parent, &style, animated_customs)
                    .0;
            }
        }
        if parent.layout.justify_items.is_legacy() {
            style
                .groups
                .set(&Value::JustifyItems(parent.layout.justify_items));
            style.deps |= Deps::PARENT;
        }
        if style.zoom != 1.0 {
            let widths = [
                Id::BorderTopWidth,
                Id::BorderRightWidth,
                Id::BorderBottomWidth,
                Id::BorderLeftWidth,
                Id::OutlineWidth,
                Id::ColumnRuleWidth,
            ];
            widths.into_iter().for_each(|it| {
                style
                    .groups
                    .set(&self.styles.initial.get(it).zoomed(style.zoom))
            });
        }
        self.cascade_phase(id, rules, Phase::Rest, parent, &mut style, None);
        animate(&mut style, Phase::Rest);
        match (style.ink.interactivity, parent.ink.interactivity) {
            (Interactivity::Escapes, _) => {
                style.groups.set(&Value::Interactivity(Interactivity::Auto))
            }
            (Interactivity::Auto | Interactivity::Inert, Interactivity::InertSubtree) => style
                .groups
                .set(&Value::Interactivity(Interactivity::InertSubtree)),
            _ => {}
        }
        if style.layout.appearance != Appearance::None {
            let look = self.tree.element(id).map_or(Look::None, Look::of);
            style.look = look.used(style.layout.appearance, rules.plan(style.flow()).styled);
            self.adjust_control(&mut style);
        }
        self.adjust(&mut style, parent, adjust);
        let (recent, groups) = (&self.styles.recent_groups, &mut style.groups);
        if !Rc::ptr_eq(&groups.font, &parent.font) {
            recent.0.share(&mut groups.font);
        }
        if !Rc::ptr_eq(&groups.text, &parent.text) {
            recent.1.share(&mut groups.text);
        }
        if !Rc::ptr_eq(&groups.ink, &parent.ink) {
            recent.2.share(&mut groups.ink);
        }
        style
    }

    fn adjust_control(&self, style: &mut Style) {
        let (layout, initial, is_control) = (
            Rc::clone(&style.layout),
            &self.styles.initial.groups,
            style.look != Look::None,
        );
        let [width, height] = style.look.size(style);
        let mut set = |value| style.groups.set(&value);
        match layout.display.0 {
            Display::Table | Display::ListItem if is_control => {
                set(Value::Display(DisplayValue(Display::Block)))
            }
            Display::Inline | Display::InlineTable if is_control => {
                set(Value::Display(DisplayValue(Display::InlineBlock)))
            }
            display if is_control && display.name().starts_with("table-") => {
                set(Value::Display(DisplayValue(Display::InlineBlock)))
            }
            _ => {}
        }
        if let Some(width) = width {
            set(Value::Width(Size::Length(Lp::Px(width))));
        }
        if let Some(height) = height {
            set(Value::Height(Size::Length(Lp::Px(height))));
        }
        if style.look.is_checkable() {
            let is_reset = |id: &&Id| {
                id.name().starts_with("padding-")
                    || id.name().starts_with("border-") && Styled::by(**id).bits() > 0
            };
            Id::ALL
                .iter()
                .filter(is_reset)
                .for_each(|id| set(initial.get(*id)));
        }
    }

    fn adjust(&self, style: &mut Style, parent: &Style, adjust: Adjust) {
        let (layout, rtl) = (Rc::clone(&style.layout), parent.is_rtl());
        let has_own_writing_mode = style.text.writing_mode != parent.text.writing_mode;
        let intrinsic_size = [style.rare.intrinsic_width, style.rare.intrinsic_height];
        let is_unused = adjust.contains(Adjust::SELECT_SIZER)
            && style.rare.field_sizing == FieldSizing::Content;
        let mut set = |value| style.groups.set(&value);
        let mut display = if is_unused {
            Display::None
        } else {
            layout.display.0
        };
        if display == Display::Contents && adjust.contains(Adjust::ATOMIC) {
            display = Display::None;
        }
        if display.is_math() && !adjust.contains(Adjust::MATH) {
            display = if display == Display::Math {
                Display::Inline
            } else {
                Display::Block
            };
        } else if display == Display::Contents && adjust.contains(Adjust::MATH) {
            display = Display::None;
        }
        if adjust.contains(Adjust::INSIDE_MARKER) {
            display = Display::Inline;
        }
        let mut position = layout.position;
        if adjust.contains(Adjust::TOP_LAYER) && position != PositionKind::Fixed {
            position = PositionKind::Absolute;
        }
        let is_out_of_flow = matches!(position, PositionKind::Absolute | PositionKind::Fixed);
        let float = match (layout.float, rtl) {
            _ if is_out_of_flow || adjust.intersects(Adjust::BLOCKIFY | Adjust::INLINIFY) => {
                Float::None
            }
            (Float::InlineStart, false) | (Float::InlineEnd, true) => Float::Left,
            (Float::InlineStart, true) | (Float::InlineEnd, false) => Float::Right,
            (float, _) => float,
        };
        let was_inline = display.is_inline_level();
        if adjust.intersects(Adjust::ROOT | Adjust::TOP_LAYER) && display == Display::Contents {
            display = Display::Block;
        }
        if !adjust.contains(Adjust::IN_SVG)
            && (is_out_of_flow
                || float != Float::None
                || adjust.intersects(
                    Adjust::BLOCKIFY | Adjust::ROOT | Adjust::LEGEND | Adjust::MARKER_GROUP,
                ))
        {
            display = display.blockified();
        }
        if adjust.contains(Adjust::INLINIFY) && !is_out_of_flow {
            display = display.inlinified();
        }
        if display == Display::Inline && has_own_writing_mode && !adjust.contains(Adjust::IN_SVG) {
            display = Display::InlineBlock;
        }
        set(Value::Display(DisplayValue(display)));
        set(Value::Position(position));
        set(Value::Float(float));
        match (layout.clear, rtl) {
            (Clear::InlineStart, false) | (Clear::InlineEnd, true) => {
                set(Value::Clear(Clear::Left))
            }
            (Clear::InlineStart, true) | (Clear::InlineEnd, false) => {
                set(Value::Clear(Clear::Right))
            }
            _ => {}
        }
        if layout.content_visibility == ContentVisibility::Auto {
            set(Value::ContainIntrinsicWidth(IntrinsicSize {
                remembers: true,
                ..intrinsic_size[0]
            }));
            set(Value::ContainIntrinsicHeight(IntrinsicSize {
                remembers: true,
                ..intrinsic_size[1]
            }));
        }
        if adjust.contains(Adjust::MARKER_GROUP) {
            set(Value::Contain(
                layout.contain
                    | if is_out_of_flow {
                        Contain::LAYOUT
                    } else {
                        Contain::LAYOUT | Contain::SIZE
                    },
            ));
        }
        if adjust.contains(Adjust::NORMAL_LINES) {
            set(Value::LineHeight(LineHeight::Normal));
        }

        let with_other = |this: Overflow, other: Overflow| match this {
            Overflow::Visible if other.scrolls() => Overflow::Auto,
            this => this,
        };
        set(Value::OverflowX(with_other(
            layout.overflow_x,
            layout.overflow_y,
        )));
        set(Value::OverflowY(with_other(
            layout.overflow_y,
            layout.overflow_x,
        )));

        let scale = self.environment.scale;
        let snapped = |width: BorderWidth| BorderWidth(snap_border(width.0, scale));
        set(Value::BorderTopWidth(snapped(layout.border_top)));
        set(Value::BorderRightWidth(snapped(layout.border_right)));
        set(Value::BorderBottomWidth(snapped(layout.border_bottom)));
        set(Value::BorderLeftWidth(snapped(layout.border_left)));
        style
            .groups
            .set(&Value::OutlineWidth(snapped(style.paint.outline_width)));
        let offset = style.paint.outline_offset.0;
        style.groups.set(&Value::OutlineOffset(Px(
            snap_border(offset.abs(), scale).copysign(offset)
        )));
        if style.text.align == TextAlign::MatchParent {
            style.groups.set(&Value::TextAlign(
                match (parent.text.align, parent.is_rtl()) {
                    (TextAlign::Start, false) | (TextAlign::End, true) => TextAlign::Left,
                    (TextAlign::Start, true) | (TextAlign::End, false) => TextAlign::Right,
                    (align, _) => align,
                },
            ));
        }
        if style.text.align == TextAlign::InternalCenter {
            style.groups.set(&Value::TextAlign(
                if parent.text.align == TextAlign::Start {
                    TextAlign::Center
                } else {
                    parent.text.align
                },
            ));
        }
        if adjust.contains(Adjust::TEXT_FIELD) {
            style.deps |= Deps::PARENT;
            let line = parent.line_height();
            let is_taller = match &parent.layout.height {
                Size::Length(Lp::Px(height)) => *height > line,
                Size::Length(_) => true,
                _ => false,
            };
            if is_taller || parent.font.size.0 >= line {
                style.groups.set(&Value::LineHeight(LineHeight::Normal));
            }
        }
        style.was_inline = was_inline;
        style.is_atomic = adjust.intersects(Adjust::ATOMIC | Adjust::OUTER_SVG);
        style.computed_sides = (
            if is_out_of_flow {
                Float::None
            } else {
                layout.float
            },
            layout.clear,
        );
    }

    pub(crate) fn adjust_animated(&self, id: NodeId, style: &mut Style, parent: &Style) {
        let old = (style.was_inline, style.computed_sides);
        self.adjust(style, parent, self.adjustments(id));
        (style.was_inline, style.computed_sides) = old;
    }

    pub(crate) fn has_starting_styles(&self) -> bool {
        self.styles
            .scopes
            .values()
            .any(|rules| rules.borrow().has_starting_styles())
    }

    /// The values of a keyframe, or of `@position-try`.
    pub(crate) fn compute_block(
        &self,
        id: NodeId,
        block: &Block,
        style: &Style,
        parent: &Style,
    ) -> (Vec<Value>, Entries, Deps) {
        let (mut values, mut customs, mut deps) = (Vec::new(), Vec::new(), Deps::empty());
        for declaration in block.declarations().list.iter().filter(|it| !it.important) {
            let ids = declaration.prop.longhands(style.flow());
            let fonts_from = if ids.iter().any(|id| id.is_early()) {
                parent
            } else {
                style
            };
            deps |= self.with_context(id, fonts_from, style, |cx| {
                let mut resolver = self.resolver(id, &style.customs, cx);
                if let Prop::Custom(name) = declaration.prop {
                    resolver
                        .declared
                        .push((name, Pending::Declared(declaration, block)));
                    customs.push((name, resolver.var(name)));
                    return cx.deps.get();
                }
                match resolver.resolve(declaration, block) {
                    Outcome::Values(resolved) => values.extend(resolved.iter().cloned()),
                    Outcome::Wide(wide) => values.extend(ids.iter().map(|id| match wide {
                        Wide::Inherit => parent.computed(*id),
                        Wide::Unset if id.is_inherited() => parent.computed(*id),
                        Wide::Initial | Wide::Unset => self.styles.initial.get(*id),
                        _ => style.computed(*id),
                    })),
                }
                cx.deps.get()
                    | if matches!(declaration.value, Declared::Text(_)) {
                        Deps::empty()
                    } else {
                        Deps::PARENT
                    }
            });
        }
        (values, customs, deps)
    }

    pub(crate) fn anonymous_style(&self, parent: &Style, display: Display) -> Rc<Style> {
        let mut style = Style {
            groups: Groups::inheriting(parent, &self.styles.initial),
            customs: Customs::inheriting(&parent.customs),
            deps: Deps::empty(),
            was_inline: false,
            is_atomic: false,
            computed_sides: (Float::None, Clear::None),
            look: Look::None,
            plainness: Default::default(),
            animates: Default::default(),
            ..*parent
        };
        style.groups.set(&Value::Display(DisplayValue(display)));
        Rc::new(style)
    }

    /// Also for an element that is not rendered.
    pub(crate) fn style_on_demand(&self, id: NodeId) -> Option<Rc<Style>> {
        self.tree.element(id)?;
        let elements = || {
            core::iter::once(id)
                .chain(self.tree.flat_ancestors(id))
                .take_while(|it| self.tree.element(*it).is_some())
        };
        let unstyled: Vec<_> = elements()
            .take_while(|it| self.tree.style(*it).is_none())
            .collect();
        let known = elements()
            .find_map(|it| self.tree.style(it))
            .unwrap_or(&self.styles.initial);
        Some(unstyled.into_iter().rfold(Rc::clone(known), |parent, it| {
            self.compute_style(it, &self.match_rules(it, None, false), &parent)
        }))
    }
}

impl Style {
    pub(crate) fn inherits_the_same_properties_as(&self, other: &Style) -> bool {
        Rc::ptr_eq(&self.font, &other.font)
            && Rc::ptr_eq(&self.text, &other.text)
            && Rc::ptr_eq(&self.ink, &other.ink)
            && Rc::ptr_eq(&self.svg, &other.svg)
            && (self.zoom, self.dark, self.metrics) == (other.zoom, other.dark, other.metrics)
            && self.has_absolute_font_size == other.has_absolute_font_size
    }

    pub(crate) fn inherits_the_same_as(&self, other: &Style) -> bool {
        self.inherits_the_same_properties_as(other)
            && self.layout.justify_items.is_legacy() == other.layout.justify_items.is_legacy()
            && Rc::ptr_eq(&self.customs.inherited, &other.customs.inherited)
    }
}

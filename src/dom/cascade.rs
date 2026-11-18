//! From the rules that apply to an element to its computed style.

mod forced_colors;

use core::cell::{Cell, OnceCell, RefCell};
use core::hash::{Hash, Hasher};
use std::rc::Rc;

use smallvec::SmallVec;

use crate::calc::Node;
use crate::calc::scope_random;
use crate::condition::{Actual, Condition, Feature, Subject};
use crate::custom::{
    Changed, Customs, Entries, Function, Inherited, Lookup, Recent, Registry, Stack, Syntax, Text,
    guarded, has_tainted_url, mark, style_query, untainted,
};
use crate::declarations::InlineBlocks;
use crate::document::{Document, Environment, Quirks};
use crate::name::{FastHasher, Map, Name, is_name, keyed_hasher, name};
use crate::order::Order as _;
use crate::properties::{Font, Groups, Id, Ink, Only, Prop, Style, Text as TextGroup, Value};
use crate::rules::{
    Decided, Dependencies, Found, INLINE, Kind, Level, Matched, Memo, Query, RuleSet, last_version,
};
use crate::selector::{Bloom, HasResults, Pseudo, ScrollPart};
use crate::sheet::{
    AtKind, Block, Cached, ContainerQuery, Declaration, Declared, Defined, Sheet, Wanted, Wide,
    Within,
};
use crate::theme::{Look, Styled};
use crate::tree::{AFTER, BEFORE, DOCUMENT, Element, Flags, Namespace, NodeId, State};
use crate::types::*;
use crate::values::*;

struct Shared {
    parent: Rc<Style>,
    adjust: Adjust,
    /// Of `style`
    deps: Deps,
    generation: u32,
    style: Rc<Style>,
}

/// The style of an element in one that has `display: none`.
pub(crate) struct Hidden {
    versions: [u32; 3],
    by: (NodeId, Rc<Style>),
    pub(crate) style: Rc<Style>,
}

#[derive(Default)]
pub(crate) struct HiddenStyles {
    all: Vec<(NodeId, Hidden)>,
    /// The index by the node, if that entry agrees.
    places: Vec<u32>,
}

impl HiddenStyles {
    #[inline]
    pub(crate) fn get(&self, id: NodeId) -> Option<&Hidden> {
        self.all
            .get(*self.places.get(id as usize)? as usize)
            .filter(|it| it.0 == id)
            .map(|it| &it.1)
    }

    fn insert(&mut self, id: NodeId, it: Hidden) {
        self.places
            .resize(self.places.len().max(id as usize + 1), 0);
        match self
            .all
            .get_mut(self.places[id as usize] as usize)
            .filter(|it| it.0 == id)
        {
            Some(known) => known.1 = it,
            None => {
                self.places[id as usize] = self.all.len() as u32;
                self.all.push((id, it));
            }
        }
    }

    pub(crate) fn clear(&mut self) {
        self.all = Vec::new();
    }
}

/// The same object for all elements that match the same rules.
#[repr(C)]
pub(crate) struct RuleList {
    matched: Box<[Matched]>,
    /// In `Stylist::lists`, or 0.
    key: u64,
    /// The address of the last block, once that has been amended.
    amended_block: usize,
    /// The declarations of the `style` attribute that have another value than the style was computed with, as bits.
    pub(crate) amended: Cell<u32>,
    /// `Plain::epoch`, and how many values there were after the last one that is for this.
    plain: (u32, u32),
    has_important: OnceCell<bool>,
    may_have_shared: Cell<bool>,
    /// The `epoch` of the `Stylist` when an element last matched it.
    epoch: Cell<u32>,
    shared: RefCell<SmallVec<[Shared; 1]>>,
    /// Of the declarations of custom properties that win.
    customs: OnceCell<u64>,
    /// `custom::mark` of what any of the blocks references.
    marks: OnceCell<u64>,
    readers: OnceCell<Box<Readers>>,
    plan: OnceCell<Box<Plan>>,
    other_plans: OnceCell<Box<[OnceCell<Box<Plan>>; Flow::COUNT - 1]>>,
}

#[derive(Clone, Copy)]
enum Reader {
    /// It gives it a value.
    Sets,
    Custom,
    /// A range in `Plan::longhands`
    Longhands(u16, u16),
}

/// What the declarations that win in `Flow::DEFAULT` do with custom properties.
struct Readers {
    named: Vec<(Name, Reader)>,
    reads_any: bool,
}

/// The values that `RuleList::amended` refers to, as they were parsed without a zoom. They are kept until styles are next updated.
#[derive(Default)]
pub(crate) struct Plain {
    epoch: u32,
    /// With the bit, and `RuleList::plain` as it was.
    values: Vec<(Cell<Option<Value>>, Id, u32, u32)>,
}

impl Plain {
    pub(crate) fn clear(&mut self) {
        self.epoch += 1;
        self.values.clear();
        self.values.shrink_to(256);
    }

    fn of(&self, rules: &RuleList) -> impl Iterator<Item = &(Cell<Option<Value>>, Id, u32, u32)> {
        let at = |count: u32| self.values.get((count as usize).wrapping_sub(1));
        core::iter::successors(
            at(rules.plain.1).filter(|_| rules.plain.0 == self.epoch),
            move |it| at(it.3),
        )
    }

    pub(crate) fn last_of(&self, rules: &RuleList) -> Option<Id> {
        self.of(rules).next().map(|it| it.1)
    }

    /// `None` unless it has all of them.
    fn take(&self, rules: &RuleList) -> Option<SmallVec<[Value; 2]>> {
        let (mut values, mut seen) = (SmallVec::new(), 0);
        for (value, _, bit, _) in self.of(rules) {
            if seen & bit == 0 {
                values.push(value.take()?);
                seen |= bit;
            }
        }
        (seen == rules.amended.get()).then_some(values)
    }
}

/// What is different about a style.
#[derive(Default)]
pub(crate) struct Amendments {
    pub(crate) values: SmallVec<[Value; 2]>,
    pub(crate) deps: Deps,
    pub(crate) customs: Option<Customs>,
    /// The custom properties that it gives other values.
    pub(crate) names: SmallVec<[Name; 2]>,
}

impl RuleList {
    fn new(matched: Box<[Matched]>, epoch: u32) -> RuleList {
        RuleList {
            matched,
            amended: Cell::new(0),
            key: 0,
            amended_block: 0,
            plain: (0, 0),
            may_have_shared: Cell::new(false),
            epoch: Cell::new(epoch),
            has_important: OnceCell::new(),
            shared: RefCell::default(),
            customs: OnceCell::new(),
            marks: OnceCell::new(),
            readers: OnceCell::new(),
            plan: OnceCell::new(),
            other_plans: OnceCell::new(),
        }
    }

    fn has_important(&self) -> bool {
        *self.has_important.get_or_init(|| {
            self.matched
                .iter()
                .any(|it| it.block.declarations().has_important)
        })
    }

    /// The properties that animations do not override.
    pub(crate) fn is_important_custom(&self, name: Name) -> bool {
        self.plan(Flow::DEFAULT)
            .customs
            .iter()
            .any(|it| it.0 == name && self.declaration(it.1).0.important)
    }

    pub(crate) fn important(&self, flow: Flow) -> SmallVec<[Id; 4]> {
        match self.has_important() {
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

    pub(crate) fn last_style(&self) -> Option<Rc<Style>> {
        Some(Rc::clone(&self.shared.borrow().first()?.style))
    }

    pub(crate) fn prefetch_styles(&self) {
        self.shared
            .borrow()
            .iter()
            .take(2)
            .for_each(|it| crate::forecast::prefetch_style(&it.style));
    }

    pub(crate) fn prefetch_last(&self) {
        self.matched
            .last()
            .into_iter()
            .for_each(crate::forecast::prefetch);
    }

    fn readers(&self) -> &Readers {
        self.readers.get_or_init(|| {
            let (plan, mut names, mut end) = (self.plan(Flow::DEFAULT), Vec::new(), 0);
            let mut it = Readers {
                named: plan.customs.iter().map(|it| (it.0, Reader::Sets)).collect(),
                reads_any: false,
            };
            let longhands = plan.longhands.chunk_by(|a, b| a.1 == b.1).map(|won| {
                end += won.len() as u16;
                (won[0].1, Reader::Longhands(end - won.len() as u16, end))
            });
            for (at, reader) in plan
                .customs
                .iter()
                .map(|it| (it.1, Reader::Custom))
                .chain(longhands)
            {
                if let Declared::Template(template) = &self.declaration(at).0.value {
                    it.reads_any |= template.references(&mut names);
                    it.named.extend(names.drain(..).map(|it| (it, reader)));
                }
            }
            Box::new(it)
        })
    }

    #[inline]
    pub(crate) fn references_any(&self, changed: &Changed) -> bool {
        let marks = |it: &Matched| {
            if it.block.declarations().reads_any {
                !0
            } else {
                it.block
                    .declarations()
                    .references
                    .iter()
                    .fold(0, |all, it| all | mark(*it))
            }
        };
        self.marks
            .get_or_init(|| self.matched.iter().map(marks).fold(0, |a, b| a | b))
            & changed.marks
            != 0
            && self.has_references_to(changed)
    }

    fn has_references_to(&self, changed: &Changed) -> bool {
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

    pub(crate) fn has_amended(&self, block: &Rc<Block>) -> bool {
        self.amended.get() != 0 && self.amended_block == Rc::as_ptr(block).addr()
    }

    pub(crate) fn len(&self) -> usize {
        self.matched.len()
    }

    pub(crate) fn has_author_rules(&self) -> bool {
        self.matched
            .iter()
            .any(|matched| matched.level != Level::UserAgent)
    }
}

pub(crate) struct Stylist {
    /// And of the user.
    pub(crate) user_agent: RefCell<RuleSet>,
    pub(crate) user_sheets: Vec<Rc<Sheet>>,
    pub(crate) scopes: Map<NodeId, Rc<RefCell<RuleSet>>>,
    pub(crate) registry: Registry,
    pub(crate) dependencies: RefCell<Dependencies>,
    pub(crate) has_results: HasResults,
    /// What each container has been asked.
    pub(crate) answers: RefCell<Map<NodeId, Vec<(Rc<Wanted>, bool)>>>,
    pub(crate) initial: Rc<Style>,
    anonymous_block: Rc<crate::properties::Layout>,
    effects_in_user_space: Rc<crate::properties::Effects>,
    /// The computed values of a box that no declaration applies to.
    lists: RefCell<Map<u64, Rc<RuleList>>>,
    /// How often `lists` was cleaned up, and how many it kept the last time.
    epoch: (u32, usize),
    pub(crate) bloom: Option<Bloom>,
    pub(crate) recent_customs: Recent<Inherited>,
    pub(crate) plain: Plain,
    /// The `mark` of each name that `attr()` has been given.
    pub(crate) attributes_read: Cell<u64>,
    recent_groups: (Recent<Font>, Recent<TextGroup>, Recent<Ink>),
    /// By `RuleList::customs` and what is inherited, both of which the value keeps alive, if they depend on nothing else.
    customs: RefCell<Map<(u64, *const Inherited), (Customs, Rc<Inherited>, Box<[Matched]>)>>,
    pub(crate) blocks: InlineBlocks,
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

static USER_AGENT_SOURCE: &[u8] = include_bytes!("user_agent.css");

/// The source of the SVG image, if it is one of the user agent's.
pub(crate) fn image_of_user_agent(url: &str) -> Option<&str> {
    let source = url
        .strip_prefix("data:image/svg+xml,")
        .filter(|it| it.starts_with("<svg ") && it.ends_with("</svg>"))?;
    bun_core::strings::contains(USER_AGENT_SOURCE, url.as_bytes()).then_some(source)
}

thread_local! {
    static FIXED_TEXT_AREAS: Rc<Sheet> = Rc::new(Sheet::parse(b"textarea{resize:none}", b"", Default::default()));
    static USER_AGENT: Rc<Sheet> = Rc::new(Sheet::parse(USER_AGENT_SOURCE, b"", crate::sheet::Within::UserAgent));
    static QUIRKS: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("quirks.css"), b"", crate::sheet::Within::UserAgent));
    static FORCED_COLORS: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("forced_colors.css"), b"", crate::sheet::Within::UserAgent));
    static MATH: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("math.css"), b"", crate::sheet::Within::UserAgent));
    static MEDIA: Rc<Sheet> = Rc::new(Sheet::parse(include_bytes!("media.css"), b"", crate::sheet::Within::UserAgent));
    static HAS_STYLIST: Cell<bool> = const { Cell::new(false) };
    static FIRST_RULES: Box<(RuleSet, Dependencies)> = Box::new(USER_AGENT.with(RuleSet::of_user_agent));
}

impl Stylist {
    pub(crate) fn new(environment: &Environment, initial: Style) -> Stylist {
        let (rules, dependencies) = if HAS_STYLIST.replace(true) {
            FIRST_RULES.with(|it| (**it).clone())
        } else {
            USER_AGENT.with(RuleSet::of_user_agent)
        };
        let mut stylist = Stylist {
            user_agent: RefCell::new(rules),
            user_sheets: Vec::new(),
            scopes: Map::default(),
            registry: Registry::default(),
            dependencies: RefCell::new(dependencies),
            has_results: HasResults::default(),
            answers: Default::default(),
            anonymous_block: Rc::new(crate::properties::Layout {
                display: DisplayValue(Display::Block),
                ..(*initial.layout).clone()
            }),
            effects_in_user_space: Rc::new(crate::properties::Effects {
                origin: crate::transform::TransformOrigin(
                    crate::values::Position(Lp::ZERO, Lp::ZERO),
                    0.0,
                ),
                ..(*initial.effects).clone()
            }),
            initial: Rc::new(initial),
            lists: RefCell::default(),
            epoch: (0, 0),
            bloom: None,
            recent_customs: Recent::default(),
            plain: Plain::default(),
            attributes_read: Cell::new(0),
            recent_groups: Default::default(),
            customs: RefCell::default(),
            blocks: InlineBlocks::default(),
            substituted: RefCell::default(),
        };
        stylist.set_user_agent_sheets(environment);
        stylist
    }

    pub(crate) fn set_user_agent_sheets(&mut self, environment: &Environment) {
        let needed = [
            (&USER_AGENT, true),
            (&QUIRKS, environment.quirks == Quirks::All),
            (&MATH, environment.has_math),
            (&MEDIA, environment.has_media),
            (&FORCED_COLORS, environment.forces_colors),
            (&FIXED_TEXT_AREAS, environment.fixes_text_areas),
        ];
        let mut sheets: Vec<_> = needed
            .into_iter()
            .filter(|it| it.1)
            .map(|it| it.0.with(Rc::clone))
            .collect();
        let rules = self.user_agent.get_mut();
        rules.is_of_user_agent = self.user_sheets.is_empty();
        rules.first_of_user = (!rules.is_of_user_agent).then_some(sheets.len() as u16);
        sheets.extend(self.user_sheets.iter().cloned());
        rules.set_sheets(&sheets, environment, self.dependencies.get_mut());
    }

    pub(crate) fn block(
        &mut self,
        source: &[u8],
        within: Within,
        base_url: &Rc<[u8]>,
    ) -> Option<Rc<Block>> {
        (!source.is_empty()).then(|| self.blocks.parse(source, within, base_url))
    }

    pub(crate) fn collect_garbage(&mut self, elements: usize) {
        let lists = self.lists.get_mut();
        let is_due = lists.len() > self.epoch.1 + 512.max(elements / 4);
        if is_due {
            let next = self.epoch.0.wrapping_add(1);
            lists.retain(|_, list| Rc::strong_count(list) > 1 || list.epoch.get() == self.epoch.0);
            lists
                .values()
                .filter(|it| Rc::strong_count(it) > 1)
                .for_each(|it| it.epoch.set(next));
            self.epoch = (next, lists.len());
        }
        if is_due || self.blocks.len() > 2 * elements + 1024 {
            self.blocks.forget_unused();
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

    /// If no other element has it.
    fn take_over<'a>(&mut self, list: &'a mut Rc<RuleList>) -> Option<&'a mut RuleList> {
        if let Some(key) = Some(list.key).filter(|it| *it != 0 && Rc::strong_count(list) == 2) {
            let lists = self.lists.get_mut();
            lists.get(&key).filter(|it| Rc::ptr_eq(it, list))?;
            lists.remove(&key);
        }
        let own = Rc::get_mut(list)?;
        own.key = 0;
        Some(own)
    }

    fn intern(&self, found: &Found) -> Rc<RuleList> {
        self.intern_all(found.iter().map(|it| &it.1))
    }

    fn intern_all<'a>(&self, found: impl Iterator<Item = &'a Matched> + Clone) -> Rc<RuleList> {
        let mut hasher = FastHasher::default();
        for it in found.clone() {
            (Rc::as_ptr(&it.block), it.level, it.layer, it.only).hash(&mut hasher);
        }
        let identity = |it: &Matched| (Rc::as_ptr(&it.block), it.level, it.layer, it.only);
        let same = |list: &RuleList| {
            list.matched
                .iter()
                .map(identity)
                .eq(found.clone().map(identity))
        };
        let mut lists = self.lists.borrow_mut();
        if let Some(list) = lists.get(&hasher.finish()).filter(|list| same(list)) {
            list.epoch.set(self.epoch.0);
            return Rc::clone(list);
        }
        let list = Rc::new(RuleList {
            key: hasher.finish(),
            ..RuleList::new(found.cloned().collect(), self.epoch.0)
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
            F::ForcedColors => pick(self.forces_colors, name!("active"), name!("none")),
            F::PrefersColorScheme => pick(self.dark, name!("dark"), name!("light")),
            _ => Actual::Keyword(name!("none")),
        })
    }

    fn compute(&self, value: &Node) -> f64 {
        let RootUnits {
            size,
            line_height,
            metrics: [x_height, zero_advance, cap_height, ideograph_advance],
        } = self.initial_font;
        let (font, metrics) = (
            FontUnits {
                size,
                line_height,
                weight: 400.0,
            },
            || crate::abi::FontMetrics {
                x_height,
                zero_advance,
                cap_height,
                ideograph_advance,
                ..Default::default()
            },
        );
        value.compute(
            &Ctx {
                viewport: self.viewport,
                container: &|| self.viewport,
                root: self.initial_font,
                font,
                metrics: &metrics,
                ..Ctx::dummy()
            },
            1.0,
        )
    }
}

impl Document {
    fn default_font_size(&self, style: &Style) -> f32 {
        self.fonts.medium_sizes()[usize::from(style.font.family.is_monospace())]
    }

    fn size_of_keyword(&self, style: &Style, keyword: u8) -> FontSize {
        FontSize::of_keyword(
            keyword,
            self.default_font_size(style),
            self.environment.quirks == Quirks::All,
            style.zoom,
        )
    }

    fn apply_minimum_font_size(&self, style: &mut Style) {
        const LOGICAL: f32 = 6.0;
        let FontSize(_, size, keyword) = style.font.size;
        let logical = if style.has_absolute_font_size {
            0.0
        } else {
            LOGICAL
        };
        let least = logical.max(
            self.fonts
                .settings
                .as_ref()
                .map_or(0.0, |it| it.minimum_size),
        ) * style.zoom;
        let used = FontSize(
            if size == 0.0 { size } else { size.max(least) },
            size,
            keyword,
        );
        if used != style.font.size {
            style.groups.set(&Value::FontSize(used));
        }
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
    struct Adjust: u32 {
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
        /// An SVG element without a box.
        const IN_USER_SPACE = 1 << 14;
        /// The root in a frame without a box.
        const UNDISPLAYED = 1 << 15;
        const SHOWS_ALT_TEXT = 1 << 20;
        const ALT_TEXT = 1 << 16;
        const ALT_ICON = 1 << 17;
        /// So it takes the room of the image, if that is known.
        const LACKS_ALT = 1 << 18;
        const REPRESENTS_NOTHING = 1 << 19;
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
    /// With `Stack::open_cycle`.
    InCycle(Option<Text>, Name),
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
            Pending::InCycle(value, start) => {
                let mut start = *start;
                while !self.stack.reaches(start)
                    && let Ok(index) = self.declared.binary_search_by_key(&start, |it| it.0)
                    && let Pending::InCycle(_, outer) = self.declared[index].1
                {
                    start = outer;
                }
                return value.clone();
            }
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
                }) = &*declaration.cached.borrow()
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
                    declaration.cached.replace(Some(Cached::Registered {
                        by,
                        source: value,
                        computed: computed.clone(),
                    }));
                }
                computed
            }
        };
        let mut open_cycle = None;
        let value = match &declaration.value {
            Declared::Wide(wide) => self.wide(name, *wide),
            Declared::Text(value) => {
                compute(Rc::clone(value), self.cx).or_else(|| unset(self.customs))
            }
            Declared::Template(template) => {
                let substituted = guarded(self, name, |this| template.value(this));
                open_cycle = self.stack.open_cycle.take();
                if let Some(wide @ (Wide::Revert | Wide::RevertLayer | Wide::RevertRule)) =
                    substituted.as_ref().and_then(|it| Wide::of(it))
                {
                    self.reverting.push((name, wide));
                }
                match substituted.and_then(|it| {
                    Wide::of(&it).map_or_else(|| compute(it, self.cx), |wide| self.wide(name, wide))
                }) {
                    None if registered.is_some_and(|it| it.interpolates()) => unset(self.customs),
                    value => value,
                }
            }
        };
        self.declared[index].1 = match open_cycle {
            Some(start) => Pending::InCycle(value.clone(), start),
            None => Pending::Done(value.clone()),
        };
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
        let name = if element.namespace == Namespace::Html {
            Name::lowercase(name)
        } else {
            Name::new(name)
        };
        self.document
            .styles
            .attributes_read
            .update(|it| it | mark(name));
        element.attribute(name).map(Str::from)
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
        let can_keep = |deps: Deps| is_usual && (Deps::OF_DOCUMENT | Deps::SCHEME).contains(deps);
        let generations = self.document.environment.generations();
        let generations = |deps: Deps| {
            (if deps.intersects(Deps::ROOT | Deps::VIEWPORT) {
                generations(deps)
            } else {
                0
            }) ^ u32::from(cx.dark && deps.contains(Deps::SCHEME)) << 31
        };
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
        let known = match &*declaration.cached.borrow() {
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
                        let mut hasher = keyed_hasher();
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
                    *declaration.cached.borrow_mut() = Some(Cached::Values {
                        generation,
                        flow,
                        substituted,
                        values,
                        deps,
                    });
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
        static PHASES: std::sync::LazyLock<Vec<Phase>> =
            std::sync::LazyLock::new(|| Id::ALL.iter().map(|it| Phase::find(*it)).collect());
        PHASES[id as usize]
    }

    fn find(id: Id) -> Phase {
        match id {
            Id::Zoom | Id::ColorScheme | Id::Direction | Id::WritingMode | Id::MathDepth => {
                Phase::First
            }
            Id::LineHeight => Phase::LineHeight,
            _ if Id::FONT_OPTIONS.contains(&id) || id == Id::TextRendering => Phase::LineHeight,
            _ if id.is_early() => Phase::Font,
            _ => Phase::Rest,
        }
    }
}

fn is_ink(id: Id) -> bool {
    (Id::Color as u16..=Id::ScrollbarColor as u16).contains(&(id as u16))
}

/// The declarations that win.
struct Plan {
    /// Sorted.
    customs: Box<[(Name, At)]>,
    /// By phase, and then by declaration.
    longhands: Box<[(Id, At)]>,
    styled: Styled,
    /// The properties of `Groups::ink` that it sets.
    inks: Box<[Id]>,
}

/// What `revert` and `revert-layer` have ruled out.
struct Reverted<K>(SmallVec<[(K, Wide, Level, u16, u16); 1]>);

impl<K: PartialEq> Reverted<K> {
    fn excludes(&self, key: &K, matched: &Matched, index: u16) -> bool {
        self.0.iter().any(|(it, wide, level, layer, rule)| {
            it == key
                && match wide {
                    Wide::Revert => matched.level >= Level::Hints.min(*level),
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
        ordered.order_by_key(|((_, it), _)| (it.level, it.layer != INLINE, it.layer));
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
                let ids = declaration.longhands(flow);
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
        customs.order_by_key(|it| it.0);
        customs.dedup_by_key(|it| it.0);
        longhands.order_by_key(|it| Phase::of(it.0));
        let is_for_control = longhands.iter().any(|it| it.0 == Id::Appearance);
        let by_page = longhands
            .iter()
            .filter(|it| is_for_control && matched[usize::from(it.1.0)].level > Level::Hints);
        let inherits = |at: At| {
            matches!(
                matched[usize::from(at.0)].block.declarations().list[usize::from(at.1)].value,
                Declared::Wide(Wide::Inherit | Wide::Unset)
            )
        };
        let inks = longhands
            .iter()
            .filter(|it| is_ink(it.0) && !inherits(it.1))
            .map(|it| it.0)
            .collect();
        Plan {
            styled: by_page.map(|it| Styled::by(it.0)).collect(),
            inks,
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
        self.size_of_container_from(self.tree.flat_parent(id))
    }

    fn size_of_container_from(&self, first: NodeId) -> [f32; 2] {
        [0, 1].map(|axis| {
            let containers = core::iter::once(first)
                .chain(self.tree.flat_ancestors(first))
                .filter(|it| {
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
    /// Of an element whose other keys have been.
    pub(crate) fn activate_key(&self, id: NodeId, key: Name) {
        let dependencies = &mut self.styles.dependencies.borrow_mut();
        for rules in [
            Some(&self.styles.user_agent),
            self.styles.scopes.get(&self.tree[id].scope).map(|it| &**it),
        ]
        .into_iter()
        .flatten()
        {
            rules.borrow_mut().activate_key(key, dependencies);
        }
    }

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
        let known = bloom
            .and_then(|it| it.last_generated.take())
            .filter(|it| it.0 == id)
            .map(|it| it.1);
        let found = known.unwrap_or_else(|| {
            self.with_query(id, Pseudo::Before, bloom, |query| {
                let (mut found, user_agent) = (0, self.styles.user_agent.borrow());
                if self.has_default_styles(id) {
                    user_agent.generated(&query, Kind::Normal, 0, &mut found);
                }
                self.visit_rule_sets(&query, &mut |rules, kind, host, _| {
                    rules.generated(&query, kind, host, &mut found)
                });
                if query.signature != Name::NONE
                    && self
                        .tree
                        .element(id)
                        .is_some_and(|it| self.has_rules_of_one_scope(id, it))
                    && user_agent.always_generates_the_same(query.signature)
                    && let Some(rules) = self.styles.scopes.get(&self.tree[id].scope)
                {
                    rules.borrow().note_generated(
                        query.signature,
                        user_agent.version_of_memos.get(),
                        found,
                    );
                }
                found
            })
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
        if let Some(element) = self.tree.element(id).filter(|it| !it.is_generated()) {
            // The element that the memos were made for has activated the same.
            if element.has_only_classes()
                && !self.has_own_declarations(element)
                && let Some(known) = bloom
                    .filter(|_| !with_starting)
                    .and_then(|it| self.known_rules(id, element, it).ok())
            {
                known.epoch.set(self.styles.epoch.0);
                return known;
            }
            self.activate_rules(id);
        }
        self.match_active_rules(id, bloom, with_starting)
    }

    /// For an element that no rule is waiting for.
    pub(crate) fn match_active_rules(
        &self,
        id: NodeId,
        bloom: Option<&Bloom>,
        with_starting: bool,
    ) -> Rc<RuleList> {
        let mut matched = Found::new();
        let Some(element) = self.tree.element(id) else {
            return self.styles.intern(&matched);
        };
        if !element.is_generated() {
            let known = bloom
                .filter(|_| !with_starting)
                .map_or(Err(None), |it| self.known_rules(id, element, it));
            let of_sheets = known.or_else(|decided| {
                self.with_query(id, Pseudo::None, bloom, |query| {
                    let hints = element.hints.as_ref().filter(|_| decided.is_none());
                    self.collect_rules(
                        &Query {
                            with_starting,
                            ..query
                        },
                        &mut matched,
                        hints,
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
                            hints,
                        );
                        expected
                            .iter()
                            .map(|it| it.0)
                            .eq(matched.iter().map(|it| it.0))
                    });
                });
                let (memo, key) = decided.ok_or(())?;
                let list = self.styles.intern(&matched);
                matched.clear();
                memo.keep(key, &list);
                Ok::<_, ()>(list)
            });
            if let Ok(list) = of_sheets {
                list.epoch.set(self.styles.epoch.0);
                if !self.has_own_declarations(element) {
                    return list;
                }
                matched.extend(list.matched.iter().map(|it| (0, it.clone())));
                if let Some(block) = &element.hints {
                    let hints = Matched {
                        block: Rc::clone(block),
                        level: Level::Hints,
                        layer: 0,
                        only: Only::default(),
                    };
                    matched.insert(
                        matched.partition_point(|it| it.1.level < Level::Hints),
                        (0, hints),
                    );
                }
            }
        }
        if element.pseudo != Pseudo::None {
            let is_transition = matches!(element.pseudo, Pseudo::Transition(..));
            self.tree.matched_part.set(id);
            let decided = bloom
                .filter(|_| !with_starting)
                .and_then(|it| self.decide_rules_of_generated(element, it));
            if let Some(list) = decided.as_ref().and_then(|(memo, key)| memo.list(*key)) {
                list.epoch.set(self.styles.epoch.0);
                return list;
            }
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
            if let Some((memo, key)) = decided {
                let list = self.styles.intern(&matched);
                memo.keep(key, &list);
                return list;
            }
        }
        if let Some(originator) = self.originator_for_cue_styles(id, element) {
            let mut embedded = Found::new();
            self.activate_rules(originator);
            self.with_query(originator, element.pseudo, None, |query| {
                self.collect_rules(
                    &Query {
                        with_starting,
                        ..query
                    },
                    &mut embedded,
                    None,
                )
            });
            matched.insert_many(
                matched.partition_point(|it| it.1.level <= Level::Own),
                embedded,
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
        self.styles.intern(&matched)
    }

    /// https://w3c.github.io/webvtt/#css-extensions-introduction. It is in the shadow tree of what follows the root of the cue.
    fn originator_for_cue_styles(&self, id: NodeId, element: &Element) -> Option<NodeId> {
        matches!(element.pseudo, Pseudo::Part(part) if crate::name::is_name!(part, "cue" | "-internal-cue-node")).then_some(())?;
        let root = core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .find(|it| self.tree.is_root_of_cue(*it))?;
        Some(self.tree[self.tree.element(self.tree[root].next)?.shadow_root].first_child)
    }

    pub(crate) fn has_own_declarations(&self, element: &Element) -> bool {
        element.hints.is_some()
            || element.inline_style.is_some()
            || !self.smil.effects.styles.is_empty()
    }

    /// Whether no sheets apply to it but those of the user agent and of its scope.
    fn has_rules_of_one_scope(&self, id: NodeId, element: &Element) -> bool {
        let node = &self.tree[id];
        element.shadow_root == 0
            && node.slot == 0
            && (node.scope == DOCUMENT || !element.has(name!("part")))
    }

    /// Or else where they are to be kept.
    #[inline]
    fn known_rules(
        &self,
        id: NodeId,
        element: &Element,
        bloom: &Bloom,
    ) -> Result<Rc<RuleList>, Option<(Rc<Memo>, (u32, u32, u32))>> {
        if let Some(list) = self.recall_rules(id, element, bloom) {
            return Ok(list);
        }
        let (memo, key) = self.decide_rules(id, element, bloom).ok_or(None)?;
        let Some(list) = memo.list(key) else {
            return Err(Some((memo, key)));
        };
        self.remember_rules(id, element, bloom, &list);
        Ok(list)
    }

    fn versions_of_memos(&self, id: NodeId) -> Option<[u32; 2]> {
        Some([
            self.styles.user_agent.borrow().version_of_memos.get(),
            self.styles
                .scopes
                .get(&self.tree[id].scope)?
                .borrow()
                .version_of_memos
                .get(),
        ])
    }

    #[inline]
    fn recall_rules(&self, id: NodeId, element: &Element, bloom: &Bloom) -> Option<Rc<RuleList>> {
        let classes = element.classes.as_ref()?;
        (element.pseudo == Pseudo::None
            && bloom.is_above(&self.tree, id)
            && self.has_rules_of_one_scope(id, element))
        .then_some(())?;
        let (signature, versions) = (
            self.styles
                .dependencies
                .borrow()
                .signature(&self.tree, id, bloom),
            self.versions_of_memos(id)?,
        );
        let known = classes.decided.borrow();
        let known = known
            .iter()
            .find(|it| (it.signature, it.versions) == (signature, versions))?;
        let list = known.list.upgrade()?;
        bloom.last_generated.set(Some((id, known.generates)));
        bloom.last_decided.set(id);
        Some(list)
    }

    /// After `decide_rules`.
    fn remember_rules(&self, id: NodeId, element: &Element, bloom: &Bloom, list: &Rc<RuleList>) {
        if bloom.last_decided.get() == id
            && let (Some(classes), Some((of, generates)), Some(versions)) = (
                &element.classes,
                bloom.last_generated.get(),
                self.versions_of_memos(id),
            )
            && of == id
        {
            let signature = self
                .styles
                .dependencies
                .borrow()
                .signature(&self.tree, id, bloom);
            let mut known = classes.decided.borrow_mut();
            known.swap(0, 1);
            known[0] = Decided {
                signature,
                versions,
                list: Rc::downgrade(list),
                generates,
            };
        }
    }

    fn decide_rules_of_generated(
        &self,
        element: &Element,
        bloom: &Bloom,
    ) -> Option<(Rc<Memo>, (u32, u32, u32))> {
        let (id, outer) = (element.originator, self.tree.element(element.originator)?);
        (element.is_generated()
            && element.state.is_empty()
            && !self.has_own_declarations(element)
            && outer.pseudo == Pseudo::None
            && self.has_rules_of_one_scope(id, outer))
        .then_some(())?;
        let (scope, user_agent) = (self.tree[id].scope, self.styles.user_agent.borrow());
        self.with_query(id, element.pseudo, Some(bloom), |query| {
            (query.signature != Name::NONE).then_some(())?;
            let (memo, own) = self
                .styles
                .scopes
                .get(&scope)?
                .borrow()
                .decide(&query, self.tree.host_of(scope))?;
            Some((
                memo,
                (
                    user_agent.version_of_memos.get(),
                    user_agent.decide(&query, 0)?.1,
                    own,
                ),
            ))
        })
    }

    fn decide_rules(
        &self,
        id: NodeId,
        element: &Element,
        bloom: &Bloom,
    ) -> Option<(Rc<Memo>, (u32, u32, u32))> {
        (element.pseudo == Pseudo::None && self.has_rules_of_one_scope(id, element))
            .then_some(())?;
        let (scope, user_agent) = (self.tree[id].scope, self.styles.user_agent.borrow());
        self.with_query(id, Pseudo::None, Some(bloom), |query| {
            (query.signature != Name::NONE).then_some(())?;
            let (memo, own) = self
                .styles
                .scopes
                .get(&scope)?
                .borrow()
                .decide(&query, self.tree.host_of(scope))?;
            let version = user_agent.version_of_memos.get();
            bloom.last_generated.set(
                memo.always_generates
                    .get()
                    .filter(|it| it.0 == version)
                    .map(|it| (id, it.1)),
            );
            if memo.is_alone_in_deciding.get() == Some(version) {
                bloom.last_decided.set(
                    if memo.is_decided() && bloom.last_generated.get().is_some() {
                        id
                    } else {
                        0
                    },
                );
                return Some((memo, (version, 0, own)));
            }
            bloom.last_decided.set(0);
            let (defaults, matching) = user_agent.decide(&query, 0)?;
            memo.is_alone_in_deciding
                .set(defaults.is_decided().then_some(version));
            Some((memo, (version, matching, own)))
        })
    }

    /// `None` if `old` already has the `style` attribute as it is.
    pub(crate) fn with_inline_style(&self, id: NodeId, old: &RuleList) -> Option<Rc<RuleList>> {
        let (block, known) = (
            self.tree.element(id)?.inline_style.as_ref(),
            old.matched.iter().rposition(Matched::is_inline),
        );
        if block.map(Rc::as_ptr) == known.map(|it| Rc::as_ptr(&old.matched[it].block)) {
            return None;
        }
        let (before, after) = old.matched.split_at(
            known.unwrap_or_else(|| old.matched.partition_point(|it| it.level <= Level::Own)),
        );
        let inline = block.map(|it| Matched {
            only: Only::default(),
            block: Rc::clone(it),
            level: Level::Own,
            layer: INLINE,
        });
        let all = before
            .iter()
            .chain(&inline)
            .chain(&after[usize::from(known.is_some())..]);
        Some(match block.is_some_and(|it| Rc::strong_count(it) == 2) {
            true => Rc::new(RuleList::new(all.cloned().collect(), 0)),
            false => self.styles.intern_all(all),
        })
    }

    /// Gives another value to a property in the `style` attribute of an element that shares its rules with no other. Whether that changes anything.
    pub(crate) fn amend_inline_style(
        &mut self,
        id: NodeId,
        property: Prop,
        source: &[u8],
    ) -> Option<bool> {
        let is_amendable = if let Prop::Long(it) = property {
            it.stands_alone()
        } else {
            matches!(property, Prop::Custom(_))
        };
        let element = self
            .tree
            .element_to_style(id)
            .filter(|it| !it.is_unprepared && is_amendable)?;
        let (block, rules) = element.inline_style.as_ref().zip(element.rules.as_mut())?;
        rules
            .matched
            .last()
            .filter(|it| Rc::ptr_eq(&it.block, block) && it.is_inline())?;
        let place = block.place_of(property)?;
        let rules = self.styles.take_over(rules)?;
        let block = &mut rules.matched.last_mut()?.block;
        element.inline_style = None;
        let value = if let Prop::Long(property) = property {
            property.parse_plain(crate::scan::trim(source), 1.0)
        } else {
            None
        };
        let has_changed = self
            .styles
            .blocks
            .amend(block, place, source, value.is_some());
        rules.amended_block = Rc::as_ptr(block).addr();
        element.inline_style = Some(Rc::clone(block));
        if has_changed == Some(true) {
            let (plain, bit) = (&mut self.styles.plain, 1 << place.declaration);
            rules.plain = match value.filter(|_| plain.values.len() < 1 << 16) {
                Some(value) => {
                    let (id, before) = (
                        value.id(),
                        if rules.amended.get() != 0 && rules.plain.0 == plain.epoch {
                            rules.plain.1
                        } else {
                            0
                        },
                    );
                    plain.values.push((Cell::new(Some(value)), id, bit, before));
                    (plain.epoch, plain.values.len() as u32)
                }
                None => (0, 0),
            };
            rules.amended.update(|it| it | bit);
            if rules.may_have_shared.take() {
                rules.shared.get_mut().clear();
            }
            if let Prop::Custom(_) = property {
                rules.customs.take();
            }
        }
        has_changed
    }

    fn can_be_amended(&self, id: NodeId, style: &Style) -> bool {
        !(style.layout.appearance != Appearance::None
            || style.deps.contains(Deps::ANCHOR)
            || !self.anchored.is_empty() && self.anchored.contains_key(&id)
            || self.tree.is_root(id)
            || self.environment.forces_colors
            || self
                .tree
                .element(id)
                .is_none_or(|it| it.pseudo != Pseudo::None || self.shows_alt_text(it)))
    }

    /// What follows from the declarations that `RuleList::amended` names, if there is nothing else to them.
    pub(crate) fn amendments(
        &self,
        id: NodeId,
        rules: &RuleList,
        style: &Style,
        parent: &Style,
    ) -> Option<Amendments> {
        (!rules.has_important()).then_some(())?;
        if let Some(values) = (style.zoom == 1.0)
            .then(|| self.styles.plain.take(rules))
            .flatten()
        {
            return self.if_amendable(
                id,
                style,
                Amendments {
                    values,
                    ..Amendments::default()
                },
            );
        }
        let block = &rules.matched.last().filter(|it| it.is_inline())?.block;
        let amended = block
            .declarations()
            .list
            .iter()
            .take(32)
            .enumerate()
            .filter(|it| rules.amended.get() >> it.0 & 1 != 0);
        let (mut it, mut customs) = (Amendments::default(), SmallVec::<[_; 2]>::new());
        for (_, declaration) in amended {
            let (source, property) = match (&declaration.value, declaration.prop) {
                (Declared::Text(source), Prop::Long(property)) => (source, property),
                (Declared::Text(source), Prop::Custom(name))
                    if !self.styles.registry.contains_key(&name) =>
                {
                    customs.push((name, Rc::clone(source)));
                    continue;
                }
                _ => return None,
            };
            match property.parse_plain(source, style.zoom) {
                Some(plain) => it.values.push(plain),
                None => {
                    it.deps |= self.with_context(id, style, style, |cx| {
                        let Outcome::Values(resolved) = self
                            .resolver(id, &style.customs, cx)
                            .resolve(declaration, block)
                        else {
                            return None;
                        };
                        it.values.extend(resolved.iter().cloned());
                        Some(cx.deps.get())
                    })?
                }
            }
        }
        if let Some(changed) = Changed::new(customs.iter().map(|it| it.0), None) {
            (!style.deps.contains(Deps::ANCHOR) && !self.anchored.contains_key(&id))
                .then_some(())?;
            let new =
                style
                    .customs
                    .amended(&parent.customs, &customs, &self.styles.recent_customs)?;
            self.substitute_anew(id, rules, style, &new, &changed, true, &mut it)?;
            (it.customs, it.names) = (Some(new), changed.names().collect());
        }
        self.if_amendable(id, style, it)
    }

    /// What follows from the custom properties that it inherits, if there is nothing else to them.
    pub(crate) fn inherited_amendments(
        &self,
        id: NodeId,
        rules: &RuleList,
        style: &Style,
        parent: &Style,
        changed: &Changed,
    ) -> Option<Amendments> {
        let (mut it, new) = (
            Amendments::default(),
            style
                .customs
                .reparented(&parent.customs, &self.styles.recent_customs),
        );
        self.substitute_anew(id, rules, style, &new, changed, false, &mut it)?;
        it.customs = Some(new);
        self.if_amendable(id, style, it)
    }

    fn if_amendable(&self, id: NodeId, style: &Style, it: Amendments) -> Option<Amendments> {
        (it.values.is_empty()
            || self.can_be_amended(id, style)
                && !it
                    .deps
                    .intersects(Deps::ATTRIBUTES | Deps::SIBLINGS | Deps::CONTAINER | Deps::ANCHOR))
        .then_some(it)
    }

    fn substitute_anew(
        &self,
        id: NodeId,
        rules: &RuleList,
        style: &Style,
        customs: &Customs,
        changed: &Changed,
        sets_them: bool,
        out: &mut Amendments,
    ) -> Option<()> {
        let readers = rules.readers();
        (!readers.reads_any
            && !style.deps.contains(Deps::REVERTED)
            && style.flow() == Flow::DEFAULT
            && !self.environment.forces_colors)
            .then_some(())?;
        for (_, reader) in readers.named.iter().filter(|it| changed.contains(it.0)) {
            let won = match *reader {
                Reader::Sets if sets_them => continue,
                Reader::Longhands(start, end) => {
                    &rules.plan(Flow::DEFAULT).longhands[start.into()..end.into()]
                }
                _ => return None,
            };
            let (declaration, block) = won
                .iter()
                .all(|it| it.0.stands_alone())
                .then(|| rules.declaration(won[0].1))?;
            out.deps |= self.with_context(id, style, style, |cx| {
                let Outcome::Values(resolved) =
                    self.resolver(id, customs, cx).resolve(declaration, block)
                else {
                    return None;
                };
                out.values.extend(
                    resolved
                        .iter()
                        .filter(|it| won.iter().any(|won| won.0 == it.id()))
                        .cloned(),
                );
                Some(cx.deps.get())
            })?;
        }
        Some(())
    }

    /// If all that has happened to the `style` attribute is that properties that nothing depends on were given values.
    pub(crate) fn amended_style(
        &self,
        id: NodeId,
        old: &RuleList,
        new: &RuleList,
        style: &Style,
        parent: &Style,
    ) -> Option<Style> {
        if core::ptr::eq(old, new) {
            let (it, mut amended) = (self.amendments(id, new, style, parent)?, style.clone());
            it.values.iter().for_each(|it| amended.groups.set(it));
            (amended.deps, amended.customs) =
                (style.deps | it.deps, it.customs.unwrap_or(amended.customs));
            amended.keep_findings_of(style);
            return Some(amended);
        }
        let block = &new.matched.last().filter(|it| it.is_inline())?.block;
        let before = old
            .matched
            .last()
            .filter(|it| it.is_inline())
            .map_or(&[][..], |it| &it.block.declarations().list);
        let after = &block.declarations().list;
        if after.len() < before.len()
            || block.declarations().has_important
            || old.has_important()
            || !self.can_be_amended(id, style)
        {
            return None;
        }
        _ = new.has_important.set(false);
        let mut amended = style.clone();
        amended.deps |= self.with_context(id, style, style, |cx| {
            let mut resolver = self.resolver(id, &style.customs, cx);
            for (index, declaration) in after.iter().enumerate() {
                let is_applied = old.amended.get().checked_shr(index as u32).unwrap_or(0) & 1 == 0;
                if is_applied
                    && before
                        .get(index)
                        .is_some_and(|it| Rc::ptr_eq(it, declaration))
                {
                    continue;
                }
                let (Declared::Text(text), Prop::Long(property)) =
                    (&declaration.value, declaration.prop)
                else {
                    return None;
                };
                match before.get(index).map(|it| (it.prop, &it.value)) {
                    Some((Prop::Long(other), Declared::Text(same)))
                        if other == property && same == text && is_applied =>
                    {
                        continue;
                    }
                    Some((Prop::Long(other), Declared::Text(_))) if other == property => {}
                    Some(_) => return None,
                    None => {}
                }
                let is_repeated = after[index + 1..]
                    .iter()
                    .any(|it| it.longhands(cx.flow).contains(&property));
                let Outcome::Values(values) = resolver.resolve(declaration, block) else {
                    return None;
                };
                (property.stands_alone() && !is_repeated).then_some(())?;
                values.iter().for_each(|it| amended.groups.set(it));
            }
            Some(cx.deps.get())
        })?;
        amended.keep_findings_of(style);
        (!amended
            .deps
            .intersects(Deps::ATTRIBUTES | Deps::SIBLINGS | Deps::CONTAINER | Deps::ANCHOR))
        .then_some(amended)
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
        let rules = (!matched.is_empty()).then(|| self.styles.intern(&matched))?;
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
            let cx = &Ctx {
                container: &|| self.size_of_container_from(id),
                deps: Cell::default(),
                ..*cx
            };
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
        highlight.has_colors &= !(self.environment.forces_colors
            && pseudo == Pseudo::Selection
            && style.takes_forced_colors());
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

    pub(crate) fn has_plain_markers(&self) -> bool {
        self.styles.user_sheets.is_empty() && !self.has_rules_for(Pseudo::Marker)
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
        let rules = self.styles.intern(&matched);
        rules
            .has_author_rules()
            .then(|| self.shared_style(id, &rules, parent, Adjust::empty()))
    }

    fn adjustments(&self, id: NodeId) -> Adjust {
        let mut adjust = Adjust::empty();
        let Some(element) = self.tree.element(id) else {
            return adjust;
        };
        let moved_to = if element.pseudo == Pseudo::None {
            None
        } else {
            self.layout_parent_of_part(id)
        };
        let mut above = moved_to.unwrap_or_else(|| self.tree.flat_parent(id));
        while above != 0
            && self
                .tree
                .style(above)
                .is_none_or(|it| it.display() == Display::Contents)
        {
            above = self.tree.flat_parent(above);
        }
        let is_math = element.namespace == Namespace::MathMl;
        let of_root = self.style_of_undisplayed(above);
        if let Some(it) = of_root.as_ref().or_else(|| self.tree.style(above)) {
            adjust.set(
                Adjust::BLOCKIFY,
                it.display().blockifies_children()
                    && !it.clamps_lines()
                    && (is_math || !it.display().is_math()),
            );
            adjust.set(
                Adjust::INLINIFY,
                matches!(
                    it.display(),
                    Display::Ruby | Display::BlockRuby | Display::RubyText
                ),
            );
        }
        adjust.set(Adjust::ROOT, self.tree.is_root(id));
        adjust.set(
            Adjust::UNDISPLAYED,
            adjust.contains(Adjust::ROOT) && self.offset_when_displayed.is_some(),
        );
        adjust.set(Adjust::TOP_LAYER, self.tree[id].has(Flags::TOP_LAYER));
        match element.pseudo {
            Pseudo::Part(part) if part == name!("-webkit-textfield-decoration-container") => {
                adjust |= Adjust::TEXT_FIELD
            }
            Pseudo::Part(part) if part == name!("-internal-select-sizer") => {
                adjust |= Adjust::SELECT_SIZER
            }
            Pseudo::Part(part) if part == name!("-internal-editor-container") => {
                let clips = |it: &Rc<Style>| match if it.flow().is_vertical() {
                    &it.layout.width
                } else {
                    &it.layout.height
                } {
                    Size::Length(Lp::Px(height)) if *height > it.line_height().floor() => true,
                    Size::Length(Lp::Fraction(_) | Lp::Calc(_)) => true,
                    _ => {
                        it.metrics.ascent + it.metrics.descent + it.metrics.line_gap
                            > it.line_height()
                    }
                };
                adjust.set(
                    Adjust::NORMAL_LINES,
                    self.tree.style(element.originator).is_some_and(clips),
                );
            }
            Pseudo::Part(part) if part == name!("-internal-alt-text") => {
                adjust |= Adjust::ALT_TEXT | self.alt_of(element.originator)
            }
            Pseudo::Part(part) if part == name!("-internal-alt-icon") => {
                adjust |= Adjust::ALT_ICON | self.alt_of(element.originator)
            }
            Pseudo::Scroll(ScrollPart::Group) => adjust |= Adjust::MARKER_GROUP,
            Pseudo::Backdrop => adjust |= Adjust::TOP_LAYER,
            Pseudo::Marker => {
                let is_inside = self
                    .tree
                    .style(element.originator)
                    .is_some_and(|it| it.text.list_position == ListStylePosition::Inside);
                adjust.set(
                    Adjust::INSIDE_MARKER,
                    is_inside || self.tree.html_tag(element.originator) == name!("summary"),
                );
            }
            _ => {}
        }
        match element.namespace {
            Namespace::Html => {
                adjust.set(Adjust::LEGEND, element.tag == name!("legend"));
                adjust.set(
                    Adjust::ATOMIC,
                    is_name!(
                        element.tag,
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
                if adjust.contains(Adjust::ATOMIC) && self.shows_alt_text(element) {
                    adjust |= Adjust::SHOWS_ALT_TEXT | self.alt_of(id);
                }
            }
            Namespace::Svg
                if self
                    .tree
                    .element(self.tree[id].parent)
                    .is_some_and(|it| it.namespace == Namespace::Svg) =>
            {
                adjust |= Adjust::IN_SVG
            }
            Namespace::Svg => adjust |= Adjust::OUTER_SVG,
            Namespace::MathMl => adjust |= Adjust::MATH,
            Namespace::Other => {}
        }
        let is_outer_svg = element.tag == name!("svg")
            && !self
                .tree
                .element(self.tree[id].parent)
                .is_some_and(crate::svg::has_svg_children);
        adjust.set(
            Adjust::IN_USER_SPACE,
            element.namespace == Namespace::Svg && !is_outer_svg,
        );
        adjust
    }

    pub(crate) fn shows_alt_text(&self, element: &Element) -> bool {
        let first = || {
            self.tree
                .element(self.tree[element.shadow_root].first_child)
        };
        element.shadow_root != 0
            && element.replaced.is_none()
            && first().is_some_and(|it| it.pseudo == Pseudo::Part(name!("-internal-alt-text")))
    }

    #[cold]
    fn alt_of(&self, id: NodeId) -> Adjust {
        let (Some(element), mut adjust) = (self.tree.element(id), Adjust::empty()) else {
            return Adjust::empty();
        };
        let [alt, title, value] =
            [name!("alt"), name!("title"), name!("value")].map(|it| element.attribute(it));
        adjust.set(
            Adjust::LACKS_ALT,
            alt.is_none_or(str::is_empty) || self.environment.quirks == Quirks::All,
        );
        adjust.set(
            Adjust::REPRESENTS_NOTHING,
            match (alt.or(title), element.tag == name!("input")) {
                (Some(text), _) => text.is_empty(),
                (None, true) => value == Some(""),
                (None, false) => element.attribute(name!("src")).is_none_or(str::is_empty),
            },
        );
        adjust
    }

    #[cold]
    fn adjust_alt_text(&self, style: &mut Style, parent: &Style, adjust: Adjust) {
        let has_room = |it: &Style| {
            let [width, height] = [&it.layout.width, &it.layout.height].map(|it| *it != Size::Auto);
            adjust.contains(Adjust::LACKS_ALT)
                && (width && height || it.layout.aspect_ratio.ratio.is_some() && (width || height))
        };
        let initial = &self.styles.initial.groups;
        if adjust.contains(Adjust::SHOWS_ALT_TEXT) {
            match (style.layout.width.clone(), style.layout.height.clone()) {
                _ if self.environment.quirks != Quirks::All => {}
                (width, Size::Auto) => style.groups.set(&Value::Height(width)),
                (Size::Auto, height) => style.groups.set(&Value::Width(height)),
                _ => {}
            }
            if !has_room(style) && style.display() == Display::Inline {
                [Id::Width, Id::Height, Id::AspectRatio]
                    .into_iter()
                    .for_each(|id| style.groups.set(&initial.get(id)));
            }
            return;
        }
        style.deps |= Deps::PARENT;
        if adjust.contains(Adjust::ALT_ICON) {
            if if parent.display() == Display::Inline {
                adjust.contains(Adjust::REPRESENTS_NOTHING)
            } else {
                parent.layout.border_top.0 == 0.0
            } {
                style
                    .groups
                    .set(&Value::Display(DisplayValue(Display::None)));
            }
            return;
        }
        let is_small = |it: &Size| matches!(it, Size::Length(Lp::Px(size)) if *size < 18.0);
        if !has_room(parent) {
            style
                .groups
                .set(&Value::Display(DisplayValue(Display::Inline)));
        }
        if !has_room(parent) || is_small(&parent.layout.width) || is_small(&parent.layout.height) {
            [
                Id::PaddingTop,
                Id::PaddingRight,
                Id::PaddingBottom,
                Id::PaddingLeft,
            ]
            .into_iter()
            .for_each(|id| style.groups.set(&initial.get(id)));
            [
                Value::BorderTopWidth,
                Value::BorderRightWidth,
                Value::BorderBottomWidth,
                Value::BorderLeftWidth,
            ]
            .into_iter()
            .for_each(|it| style.groups.set(&it(BorderWidth(0.0))));
        }
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
        let rules = RuleList::new(matched, 0);
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
            (it.adjust, it.generation) == (adjust, generations(it.deps))
                && (Rc::ptr_eq(&it.parent, parent)
                    || !it.deps.contains(Deps::PARENT) && it.parent.inherits_the_same_as(parent))
        });
        if let Some(found) = found {
            return Rc::clone(&found.style);
        }
        let similar = shared.first().filter(|it| {
            (it.adjust, it.generation) == (adjust, generations(it.deps))
                && !it.deps.intersects(Deps::PARENT | Deps::INK)
                && it.style.zoom == it.parent.zoom
                && it.parent.inherits_the_same_but_ink(parent)
        });
        let inked = similar.map(|it| {
            let mut style = Style::clone(&it.style);
            style.groups.ink = Rc::clone(&parent.ink);
            rules
                .plan(style.flow())
                .inks
                .iter()
                .for_each(|id| style.groups.set(&it.style.get(*id)));
            match Rc::ptr_eq(&style.ink, &parent.ink) {
                false if style.ink == it.style.ink => return Rc::clone(&it.style),
                false => self.styles.recent_groups.2.share(&mut style.groups.ink),
                true => {}
            }
            Rc::new(style)
        });
        drop(shared);
        debug_assert!(inked.as_ref().is_none_or(|it| {
            let mut count = 0;
            it.differences(&self.cascade(id, rules, parent, adjust, &[], &[]), |_| {
                count += 1
            });
            count == 0
        }));
        let style = inked.unwrap_or_else(|| {
            let mut style = self.cascade(id, rules, parent, adjust, &[], &[]);
            rules
                .shared
                .borrow()
                .first()
                .into_iter()
                .for_each(|last| style.groups.share_with(&last.style));
            Rc::new(style)
        });
        let mut shared = rules.shared.borrow_mut();
        if !style
            .deps
            .intersects(Deps::ATTRIBUTES | Deps::SIBLINGS | Deps::CONTAINER)
        {
            rules.may_have_shared.set(true);
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
                    deps: style.deps,
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
            viewport: [
                self.environment.viewport[0] - self.root_scrollbars[0],
                self.environment.viewport[1] - self.root_scrollbars[1],
            ],
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
            highlight: self.environment.highlight[0],
            dark: own.dark,
            forces_colors: self.environment.forces_colors,
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
            let mut hasher = keyed_hasher();
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
                    declared.order_by_key(|it| it.0);
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
                cx.uses(Deps::PARENT | Deps::REVERTED);
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
                    let outcome = resolver.resolve(declaration, block);
                    if matches!(outcome, Outcome::Wide(_))
                        && !matches!(declaration.value, Declared::Wide(_))
                        && won.iter().any(|it| is_ink(it.0))
                    {
                        cx.uses(Deps::INK);
                    }
                    match outcome {
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
                                    (Wide::Initial, _) if *id == Id::Color => id
                                        .parse(b"canvastext", cx)
                                        .iter()
                                        .for_each(|it| groups.set(it)),
                                    (Wide::Initial, true) => {
                                        groups.set(&initial.get(*id).zoomed(1.0, cx.zoom))
                                    }
                                    (Wide::Initial | Wide::Unset, false)
                                        if *id == Id::TransformOrigin =>
                                    {
                                        groups.set(&initial.get(*id))
                                    }
                                    (Wide::Inherit, false) => {
                                        cx.uses(Deps::PARENT);
                                        groups.set(&parent.get(*id).zoomed(parent.zoom, cx.zoom));
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
            style.deps |= Deps::REVERTED;
            winners = again
                .insert(Plan::new(&rules.matched, flow, &substituted))
                .phase(phase);
        }
    }

    pub(crate) fn resolve_font(&self, id: NodeId, style: &mut Style, parent: &Style) {
        let has_same_options = Rc::ptr_eq(&style.svg, &parent.svg)
            || style.svg.text_rendering == parent.svg.text_rendering
                && Id::FONT_OPTIONS
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
            measures: Default::default(),
            animates: Default::default(),
            ..*parent
        };
        if adjust.contains(Adjust::IN_USER_SPACE) {
            style.groups.effects = Rc::clone(&self.styles.effects_in_user_space);
        }
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
                inherited.into_iter().for_each(|it| {
                    style
                        .groups
                        .set(&parent.get(it).zoomed(parent.zoom, style.zoom))
                });
                zoomed = Some(style.clone());
            }
            let fonts_from = zoomed.as_ref().unwrap_or(parent);
            self.cascade_phase(id, rules, Phase::Font, parent, &mut style, Some(fonts_from));
            if style.deps.contains(Deps::MATH_FONT_SIZE) {
                style.groups.set(&Value::FontSize(FontSize::new(
                    style.font.size.1 * self.script_scale(&style, parent),
                )));
            }
            let FontSize(_, size, keyword) = style.font.size;
            style.has_absolute_font_size = style.deps.contains(Deps::ABSOLUTE_FONT_SIZE)
                || parent.has_absolute_font_size && keyword.is_none();
            let scaled = match keyword {
                Some(keyword) => self.size_of_keyword(&style, keyword),
                None => FontSize::new(
                    size * (self.default_font_size(&style) / self.default_font_size(parent)),
                ),
            };
            if scaled.1 != size && !style.has_absolute_font_size {
                style.groups.set(&Value::FontSize(scaled));
            }
            animate(&mut style, Phase::Font);
            self.apply_minimum_font_size(&mut style);
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
                    .set(&self.styles.initial.get(it).zoomed(1.0, style.zoom))
            });
        }
        self.cascade_phase(id, rules, Phase::Rest, parent, &mut style, None);
        animate(&mut style, Phase::Rest);
        if self.environment.forces_colors {
            self.force_colors(id, rules, parent, adjust, &mut style);
        }
        match (style.ink.interactivity, parent.ink.interactivity) {
            (Interactivity::Escapes, _) => {
                style.groups.set(&Value::Interactivity(Interactivity::Auto))
            }
            (
                Interactivity::Auto,
                Interactivity::InertSubtree | Interactivity::AutoInInertSubtree,
            ) => style
                .groups
                .set(&Value::Interactivity(Interactivity::AutoInInertSubtree)),
            (
                Interactivity::Inert,
                Interactivity::InertSubtree | Interactivity::AutoInInertSubtree,
            ) => style
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
        if matches!(style.look, Look::MenuList | Look::MenuListButton) {
            set(Value::LineHeight(LineHeight::Normal));
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
        if adjust.contains(Adjust::UNDISPLAYED) {
            display = Display::None;
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
        if adjust.intersects(Adjust::SHOWS_ALT_TEXT | Adjust::ALT_TEXT | Adjust::ALT_ICON) {
            self.adjust_alt_text(style, parent, adjust);
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

    pub(crate) fn may_have_starting_style(&self, id: NodeId, bloom: &Bloom) -> bool {
        let is_plain = |it: &Element| {
            it.pseudo == Pseudo::None
                && !self.tree[id].has(Flags::ANIMATED)
                && self.has_rules_of_one_scope(id, it)
        };
        if !self.tree.element(id).is_some_and(is_plain) {
            return self
                .styles
                .scopes
                .values()
                .any(|rules| rules.borrow().has_starting_styles());
        }
        let scope = self.tree[id].scope;
        let has = |rules: &Rc<RefCell<RuleSet>>| {
            self.with_query(id, Pseudo::None, Some(bloom), |query| {
                rules
                    .borrow()
                    .has_starting_style(&query, self.tree.host_of(scope))
            })
        };
        self.styles.scopes.get(&scope).is_some_and(has)
    }

    /// The values of a keyframe, or of `@position-try`.
    pub(crate) fn compute_block(
        &self,
        id: NodeId,
        block: &Rc<Block>,
        style: &Style,
        parent: &Style,
    ) -> (Vec<Value>, Entries, Deps) {
        let (mut values, mut customs, mut deps) = (Vec::new(), Vec::new(), Deps::empty());
        for declaration in block.declarations().list.iter().filter(|it| !it.important) {
            let ids = declaration.longhands(style.flow());
            let fonts_from = if ids.iter().any(|id| Phase::of(*id) <= Phase::Font) {
                parent
            } else {
                style
            };
            deps |= self.with_context(id, fonts_from, style, |cx| {
                let mut resolver = self.resolver(id, &style.customs, cx);
                if let Prop::Custom(name) = declaration.prop {
                    if !matches!(
                        declaration.value,
                        Declared::Wide(Wide::RevertLayer | Wide::RevertRule)
                    ) {
                        resolver
                            .declared
                            .push((name, Pending::Declared(declaration, block)));
                    }
                    customs.push((name, resolver.var(name)));
                    return cx.deps.get()
                        | if matches!(declaration.value, Declared::Text(_)) {
                            Deps::empty()
                        } else {
                            Deps::PARENT
                        };
                }
                let (start, outcome) = (values.len(), resolver.resolve(declaration, block));
                match outcome {
                    Outcome::Values(resolved) => {
                        values.extend(resolved.iter().filter(|it| ids.contains(&it.id())).cloned())
                    }
                    Outcome::Wide(Wide::Revert)
                        if let Some(reverted) = self.style_with(id, Rc::clone(block)) =>
                    {
                        values.extend(ids.iter().map(|it| reverted.computed(*it)))
                    }
                    Outcome::Wide(wide) => values.extend(ids.iter().map(|id| match wide {
                        Wide::Inherit => parent.computed(*id),
                        Wide::Unset if id.is_inherited() => parent.computed(*id),
                        Wide::Initial | Wide::Unset => self.styles.initial.get(*id),
                        _ => style.computed(*id),
                    })),
                }
                if let Some(Value::FontSize(size)) = values[start..]
                    .iter_mut()
                    .find(|it| it.id() == Id::FontSize)
                    && let Some(keyword) = size.2
                {
                    *size = self.size_of_keyword(style, keyword);
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
            measures: Default::default(),
            animates: Default::default(),
            ..*parent
        };
        match display {
            Display::Block => style.groups.layout = Rc::clone(&self.styles.anonymous_block),
            _ => style.groups.set(&Value::Display(DisplayValue(display))),
        }
        Rc::new(style)
    }

    /// Also for an element that is not rendered.
    #[inline]
    pub(crate) fn style_on_demand(&self, id: NodeId) -> Option<Rc<Style>> {
        let style = self
            .style_of_undisplayed(id)
            .or_else(|| self.tree.style(id).cloned());
        self.tree
            .element(id)
            .map(|_| style.unwrap_or_else(|| self.style_of_unstyled(id)))
    }

    /// And with its own animations.
    pub(crate) fn animated_on_demand(&mut self, id: NodeId) -> Option<Rc<Style>> {
        let base = self.style_on_demand(id)?;
        if self.tree.style(id).is_some() || !self.tree[id].has(Flags::ANIMATED) {
            return Some(base);
        }
        let parent = self
            .style_on_demand(self.tree.flat_parent(id))
            .unwrap_or_else(|| Rc::clone(&self.styles.initial));
        Some(self.animate(id, &self.rules_on_demand(id), &parent, &base))
    }

    /// What the root would have.
    #[inline]
    fn style_of_undisplayed(&self, id: NodeId) -> Option<Rc<Style>> {
        let rules = self
            .tree
            .element(
                self.offset_when_displayed
                    .map(|_| id)
                    .filter(|it| self.tree.is_root(*it))?,
            )?
            .rules
            .as_ref()?;
        Some(self.shared_style(
            id,
            rules,
            &self.styles.initial,
            self.adjustments(id) - Adjust::UNDISPLAYED,
        ))
    }

    fn versions_of_hidden(&self) -> [u32; 3] {
        [
            last_version(),
            self.environment.generation,
            self.environment.viewport_generation,
        ]
    }

    #[inline]
    pub(crate) fn recall_hidden<R>(
        &self,
        id: NodeId,
        read: impl FnOnce(&Hidden) -> R,
    ) -> Option<R> {
        let hidden = self.tree.found().hidden.borrow();
        hidden
            .get(id)
            .filter(|it| {
                it.versions == self.versions_of_hidden()
                    && self
                        .tree
                        .style(it.by.0)
                        .is_some_and(|by| Rc::ptr_eq(by, &it.by.1))
            })
            .map(read)
    }

    fn style_of_unstyled(&self, id: NodeId) -> Rc<Style> {
        let recall = |it: NodeId| {
            self.recall_hidden(it, |known| {
                (Rc::clone(&known.style), Some(known.by.clone()))
            })
        };
        let styled = |it: NodeId| {
            self.tree.style(it).map(|style| {
                (
                    self.style_of_undisplayed(it)
                        .unwrap_or_else(|| Rc::clone(style)),
                    (style.display() == Display::None).then(|| (it, Rc::clone(style))),
                )
            })
        };
        let (mut unstyled, mut known) = (SmallVec::<[NodeId; 8]>::new(), None);
        for it in core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .take_while(|it| self.tree.element(*it).is_some())
        {
            known = styled(it).or_else(|| recall(it));
            if known.is_some() {
                break;
            }
            unstyled.push(it);
        }
        let (mut style, mut by) = known.unwrap_or_else(|| (Rc::clone(&self.styles.initial), None));
        for it in unstyled.into_iter().rev() {
            style = self.compute_style(it, &self.rules_on_demand(it), &style);
            by = by.filter(|_| {
                !style.deps.contains(Deps::CONTAINER)
                    && self.tree.found().rules.borrow().contains_key(&it)
            });
            if let Some(by) = by.clone() {
                self.tree.found().hidden.borrow_mut().insert(
                    it,
                    Hidden {
                        versions: self.versions_of_hidden(),
                        by,
                        style: Rc::clone(&style),
                    },
                );
            }
        }
        style
    }

    fn rules_on_demand(&self, id: NodeId) -> Rc<RuleList> {
        let known = self
            .tree
            .found()
            .rules
            .borrow()
            .get(&id)
            .filter(|it| it.0 == last_version())
            .map(|it| Rc::clone(&it.1));
        debug_assert!(
            known.as_ref().is_none_or(
                |it| it.matched.len() == self.match_rules(id, None, false).matched.len()
            )
        );
        known.unwrap_or_else(|| {
            let rules = self.match_rules(id, None, false);
            let mut known = self.tree.found().rules.borrow_mut();
            _ = match !self.tree[id].has(Flags::QUERIES_CONTAINER)
                && self.smil.effects.styles.is_empty()
                && self.tree.element(id).is_some_and(|it| !it.is_generated())
            {
                true => known.insert(id, (last_version(), Rc::clone(&rules))),
                false => known.remove(&id),
            };
            rules
        })
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

    pub(crate) fn inherits_the_same_but_ink(&self, other: &Style) -> bool {
        Rc::ptr_eq(&self.font, &other.font)
            && Rc::ptr_eq(&self.text, &other.text)
            && Rc::ptr_eq(&self.svg, &other.svg)
            && Rc::ptr_eq(&self.customs.inherited, &other.customs.inherited)
            && (
                self.zoom,
                self.dark,
                self.metrics,
                self.has_absolute_font_size,
            ) == (
                other.zoom,
                other.dark,
                other.metrics,
                other.has_absolute_font_size,
            )
            && (self.ink.interactivity, self.ink.color_scheme)
                == (other.ink.interactivity, other.ink.color_scheme)
            && self.layout.justify_items.is_legacy() == other.layout.justify_items.is_legacy()
    }

    pub(crate) fn inherits_the_same_as(&self, other: &Style) -> bool {
        self.inherits_the_same_properties_as(other)
            && self.layout.justify_items.is_legacy() == other.layout.justify_items.is_legacy()
            && Rc::ptr_eq(&self.customs.inherited, &other.customs.inherited)
    }
}

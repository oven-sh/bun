//! Style sheets, flattened into what the cascade reads.

use core::cell::{Cell, OnceCell, RefCell};
use core::ops::Range;
use std::rc::{Rc, Weak};

use bun_css::Token;

use crate::condition::{self, Condition, ContainerCondition, Feature};
use crate::counter_style::CounterStyle;
use crate::custom::{Function, Registered, Template, Text};
use crate::grammar::{Mode, definition, is_reserved, split_list};
use crate::name::{Map, Name};
use crate::properties::{Id, Prop, Value};
use crate::scan::{self, Next, Required};
use crate::selector::{List, Selector};
use crate::selector_parser::{Namespaces, Parser};
use crate::tree::NodeId;
use crate::types::{Easing, RangeName};
use crate::values::*;

keywords! {
    Wide { Initial = "initial", Inherit = "inherit", Unset = "unset", Revert = "revert", RevertLayer = "revert-layer",
        RevertRule = "revert-rule" }
}

impl Wide {
    pub(crate) fn of(source: &[u8]) -> Option<Wide> {
        let is_escaped = || source.len() < 128 && bun_core::strings::contains_char(source, b'\\');
        Wide::from_name(source)
            .or_else(|| is_escaped().then(|| parse_all(source, |p| Wide::from_name(ident(p)?)))?)
    }
}

pub(crate) enum Declared {
    Wide(Wide),
    Text(Text),
    Template(Template),
}

pub(crate) enum Cached {
    Values {
        generation: u32,
        flow: Flow,
        substituted: Box<[u8]>,
        values: Rc<[Value]>,
        deps: Deps,
    },
    Registered {
        by: Rc<Registered>,
        source: Text,
        computed: Option<Text>,
    },
}

pub(crate) struct Declaration {
    pub(crate) prop: Prop,
    pub(crate) important: bool,
    pub(crate) value: Declared,
    pub(crate) cached: RefCell<Option<Box<Cached>>>,
}

impl Declared {
    pub(crate) fn parse(prop: Prop, source: &[u8]) -> Option<Declared> {
        if let Some(wide) = Wide::of(source) {
            return Some(Declared::Wide(wide));
        }
        let is_custom = matches!(prop, Prop::Custom(_));
        if let Some(template) = Template::parse(source, is_custom).ok()? {
            return Some(Declared::Template(template));
        }
        let source = if is_custom {
            source.into()
        } else {
            crate::calc::scope_random(prop, source)
        };
        prop.accepts(&source)
            .then(|| Declared::Text((*source).into()))
    }

    pub(crate) fn parse_within(prop: Prop, source: &[u8], within: Within) -> Option<Declared> {
        Declared::parse(prop, source).or_else(|| {
            Declared::parse(
                prop,
                &without_quirks(prop.name(), source).filter(|_| within == Within::Quirks)?,
            )
        })
    }

    pub(crate) fn custom(source: &[u8]) -> Option<Declared> {
        Declared::parse(Prop::Custom(Name::NONE), source)
    }
}

/// https://quirks.spec.whatwg.org/#the-hashless-hex-color-quirk and the unitless length quirk
fn without_quirks(name: &str, source: &[u8]) -> Option<Out> {
    const LENGTHS: &str = "background-position border-spacing bottom clip font-size height left letter-spacing margin max-height max-width \
        min-height min-width padding right text-indent top vertical-align width word-spacing border-width";
    fn visit(p: &mut P, source: &[u8], is_color: bool, out: &mut Out) {
        loop {
            let start = p.position();
            let Ok(token) = p.next_including_whitespace().copied() else {
                return;
            };
            let digits = |value: Option<i32>, unit: &[u8]| {
                Some(
                    format!(
                        "{:0>6}",
                        format!("{}{}", value.filter(|it| *it >= 0)?, text(unit))
                    )
                    .into_bytes(),
                )
            };
            let hex = match token {
                Token::Ident(name) => Some(name.to_vec()),
                Token::Number(it) => digits(it.int_value, b""),
                Token::Dimension(it) => digits(it.num.int_value, it.unit),
                _ => None,
            };
            match (
                token,
                hex.filter(|it| {
                    is_color && matches!(it.len(), 3 | 6) && it.iter().all(u8::is_ascii_hexdigit)
                }),
            ) {
                (_, Some(hex)) => out.extend([b"#", &hex[..]].concat()),
                (Token::Number(_), _) if !is_color => {
                    out.extend([&source[start..p.position()], b"px"].concat())
                }
                (Token::Function(name), _) if eq(name, "rect") => {
                    out.extend_from_slice(b"rect(");
                    nested(p, |p| Some(visit(p, source, is_color, out)));
                    out.push(b')');
                }
                _ => {
                    if let Token::Function(_) = token {
                        nested(p, |p| Raw::parse(p, &Ctx::dummy()));
                    }
                    out.extend_from_slice(&source[start..p.position()]);
                }
            }
        }
    }
    let name = ["-top", "-right", "-bottom", "-left"]
        .iter()
        .fold(name.to_owned(), |name, side| name.replace(side, ""));
    let is_color = matches!(&*name, "color" | "background-color" | "border-color");
    (is_color || LENGTHS.split_ascii_whitespace().any(|it| it == name)).then_some(())?;
    let mut out = Out::new();
    with_parser(source, |p| visit(p, source, is_color, &mut out));
    Some(out)
}

pub(crate) fn supports_declaration(name: &[u8], value: &[u8]) -> bool {
    Prop::from_name(name).is_some_and(|prop| Declared::parse(prop, scan::trim(value)).is_some())
}

pub(crate) struct Declarations {
    pub(crate) list: Box<[Declaration]>,
    pub(crate) has_important: bool,
    pub(crate) sets_content: bool,
    /// The custom properties that are read or set. Sorted.
    pub(crate) references: Box<[Name]>,
    /// There is no telling which are read.
    pub(crate) reads_any: bool,
}

/// What a block is in, if that rules out some declarations.
#[derive(Clone, Copy, PartialEq, Default, Hash)]
pub(crate) enum Within {
    #[default]
    Style,
    /// A style rule or attribute in a document that is in quirks mode.
    Quirks,
    Keyframe,
    PositionTry,
}

impl Within {
    pub(crate) fn allows(self, prop: Prop, important: bool) -> bool {
        let name = prop.name();
        match self {
            Within::Style | Within::Quirks => true,
            Within::Keyframe => {
                !important
                    && (!name.starts_with("animation")
                        || matches!(name, "animation-timing-function" | "animation-composition"))
            }
            Within::PositionTry => {
                let is_allowed = |id: &Id| {
                    let is_in =
                        |first: Id, last: Id| (first as u16..=last as u16).contains(&(*id as u16));
                    is_in(Id::Width, Id::MarginLeft)
                        || is_in(Id::Top, Id::Left)
                        || matches!(
                            id,
                            Id::AlignSelf | Id::JustifySelf | Id::PositionAnchor | Id::PositionArea
                        )
                };
                !important
                    && !name.is_empty()
                    && prop.longhands(Flow::DEFAULT).iter().all(is_allowed)
            }
        }
    }
}

unsafe extern "C" {
    fn Bun__Desktop__mappedResource(bytes: *const u8, len: usize) -> *const u8;
}

#[derive(Clone)]
enum Source {
    Owned(Rc<[u8]>),
    /// The pages of a file that ships with the program.
    Mapped(&'static [u8]),
}

impl Source {
    fn of_sheet(bytes: &[u8]) -> Source {
        let bytes = &bytes[..bytes.len().min(u32::MAX as usize)];
        // SAFETY: a live slice, which is only read.
        let mapped = unsafe { Bun__Desktop__mappedResource(bytes.as_ptr(), bytes.len()) };
        match mapped.is_null() {
            true => Source::Owned(bytes.into()),
            // SAFETY: a mapping of this length that is never unmapped.
            false => Source::Mapped(unsafe { core::slice::from_raw_parts(mapped, bytes.len()) }),
        }
    }
}

impl Default for Source {
    fn default() -> Source {
        Source::Mapped(b"")
    }
}

impl core::ops::Deref for Source {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            Source::Owned(bytes) => bytes,
            Source::Mapped(bytes) => bytes,
        }
    }
}

/// Parsed when it first applies.
pub(crate) struct Block {
    source: Cell<Option<(Source, Range<u32>, Within)>>,
    pub(crate) base_url: Rc<[u8]>,
    parsed: OnceCell<Declarations>,
}

fn slice<'a>(source: &'a [u8], range: &Range<u32>) -> &'a [u8] {
    &source[range.start as usize..range.end as usize]
}

impl Block {
    fn new(source: &Source, range: Range<usize>, within: Within, base_url: &Rc<[u8]>) -> Block {
        let source = Cell::new(Some((
            source.clone(),
            range.start as u32..range.end as u32,
            within,
        )));
        Block {
            source,
            base_url: Rc::clone(base_url),
            parsed: OnceCell::new(),
        }
    }

    pub(crate) fn parse(source: &[u8], within: Within, base_url: &Rc<[u8]>) -> Block {
        Block::new(
            &Source::Owned(source.into()),
            0..source.len(),
            within,
            base_url,
        )
    }

    pub(crate) fn declarations(&self) -> &Declarations {
        self.parsed.get_or_init(|| {
            let mut list = Vec::new();
            if let Some((source, range, within)) = self.source.take() {
                visit_declarations(slice(&source, &range), |name, value, important| {
                    let prop = Prop::from_name(name).filter(|it| within.allows(*it, important));
                    if name.starts_with(b"--") {
                        crate::custom::remember(name);
                    }
                    let declared = prop.and_then(|prop| {
                        Some((prop, Declared::parse_within(prop, value, within)?))
                    });
                    list.extend(declared.map(|(prop, value)| Declaration {
                        prop,
                        important,
                        value,
                        cached: RefCell::default(),
                    }));
                });
            }
            let mut reads_any = false;
            let mut references = Vec::new();
            for declaration in &list {
                if let Prop::Custom(name) = declaration.prop {
                    references.push(name);
                }
                if let Declared::Template(template) = &declaration.value {
                    reads_any |= template.references(&mut references);
                }
            }
            references.sort_unstable();
            references.dedup();
            Declarations {
                has_important: list.iter().any(|it| it.important),
                sets_content: list
                    .iter()
                    .any(|it| matches!(it.prop, Prop::Long(Id::Content) | Prop::All)),
                references: references.into(),
                reads_any,
                list: list.into(),
            }
        })
    }
}

/// The name, the value, and whether it is important.
pub(crate) fn visit_declarations(source: &[u8], mut visit: impl FnMut(&[u8], &[u8], bool)) {
    let mut at = 0;
    loop {
        at = match scan::next_item(source, at) {
            Next::End(_) => return,
            Next::Block { start, brace } if source[start] == b'@' => {
                scan::end_of_block(source, brace).0 + 1
            }
            Next::Block { brace, .. } => scan::end_of_statement(source, brace),
            Next::Statement { start, end } => {
                if let Some((name, value)) = scan::declaration(&source[start..end]) {
                    let (value, important) = scan::without_priority(value);
                    match name.iter().all(|it| !matches!(it, b'\\' | 0)) {
                        true => visit(name, value, important),
                        false => {
                            _ = parse_all(name, |p| {
                                ident(p).map(|name| visit(name, value, important))
                            })
                        }
                    }
                }
                end
            }
        };
    }
}

pub(crate) struct ContainerQuery {
    pub(crate) any_of: Vec<Rc<Wanted>>,
    pub(crate) outer: Option<Rc<ContainerQuery>>,
}

pub(crate) struct Wanted {
    pub(crate) name: Option<Str>,
    pub(crate) condition: Condition,
    /// Width, height, inline and block.
    pub(crate) axes: [bool; 4],
    pub(crate) needs_scroll_state: bool,
    pub(crate) needs_anchor: bool,
}

impl ContainerQuery {
    pub(crate) fn new(
        list: Vec<ContainerCondition>,
        outer: Option<Rc<ContainerQuery>>,
    ) -> ContainerQuery {
        let wanted = |ContainerCondition {
                          name, condition, ..
                      }| {
            let mut axes = [false; 4];
            condition.any_leaf(&mut |it| {
                match it {
                    Condition::Boolean(feature) | Condition::Compare(feature, ..) => {
                        match feature {
                            Feature::Width => axes[0] = true,
                            Feature::Height => axes[1] = true,
                            Feature::InlineSize => axes[2] = true,
                            Feature::BlockSize => axes[3] = true,
                            _ => axes = [true; 4],
                        }
                    }
                    _ => {}
                }
                false
            });
            let is_unknown = condition.any_leaf(&mut |it| matches!(it, Condition::Constant(None)));
            Wanted {
                name,
                axes,
                needs_scroll_state: condition
                    .any_leaf(&mut |it| matches!(it, Condition::ScrollState(..))),
                needs_anchor: condition.any_leaf(&mut |it| matches!(it, Condition::Fallback(_))),
                condition: if is_unknown {
                    Condition::Constant(None)
                } else {
                    condition
                },
            }
        };
        ContainerQuery {
            any_of: list.into_iter().map(wanted).map(Rc::new).collect(),
            outer,
        }
    }
}

pub(crate) struct ScopeRule {
    pub(crate) start: Option<List>,
    pub(crate) end: Option<List>,
    pub(crate) outer: Option<Rc<ScopeRule>>,
    /// The root, if there is no `start`.
    pub(crate) owner: NodeId,
}

// ───────────────────────────── sheets ─────────────────────────────

pub(crate) struct Rule {
    pub(crate) selector: Selector,
    pub(crate) block: Rc<Block>,
    pub(crate) context: Rc<Context>,
    /// In the sheet.
    pub(crate) order: u32,
}

/// The rules that a rule is in.
#[derive(Clone, Default)]
pub(crate) struct Context {
    pub(crate) layer: u16,
    pub(crate) media: u16,
    pub(crate) container: Option<Rc<ContainerQuery>>,
    pub(crate) scope: Option<Rc<ScopeRule>>,
    pub(crate) is_starting: bool,
}

struct RawRule {
    start: u32,
    brace: u32,
    end: u32,
    order: u32,
    context: u16,
    is_list: bool,
}

/// A selector that is not parsed until an element has what it requires.
pub(crate) struct Deferred {
    rule: u32,
    first_key: u32,
    selector: u16,
    keys: u8,
    /// Whether the first key is one that the subject has to have.
    pub(crate) has_own_key: bool,
    is_class: bool,
}

keywords! {
    AtKind { Keyframes = "keyframes" | "-webkit-keyframes", PositionTry = "position-try", CounterStyle = "counter-style",
        Function = "function", Property = "property", FontFace = "font-face", FontFeatureValues = "font-feature-values",
        FontPaletteValues = "font-palette-values", ViewTransition = "view-transition" }
}

/// One that defines something, which is parsed when it is used.
pub(crate) struct AtRule {
    pub(crate) kind: AtKind,
    pub(crate) name: Str,
    pub(crate) media: u16,
    pub(crate) layer: u16,
    prelude: Range<u32>,
    body: Range<u32>,
    defined: OnceCell<Defined>,
}

#[derive(Clone)]
pub(crate) enum Defined {
    Keyframes(Rc<[Keyframe]>),
    Block(Rc<Block>),
    Function(Rc<Function>),
    Property(Rc<Registered>),
    FontFace(Rc<FontFace>),
    CounterStyle(Rc<CounterStyle>),
    Descriptors(Rc<[(Str, Str)]>),
    /// The name of the at-rule, the name of the value, and the value.
    FeatureValues(Rc<[(Out, Out, Vec<u32>)]>),
    Invalid,
}

pub(crate) struct Keyframe {
    pub(crate) offset: f32,
    /// What `offset` is a fraction of, if not of the animation.
    pub(crate) range: Option<RangeName>,
    pub(crate) block: Rc<Block>,
    pub(crate) easing: Option<Easing>,
    /// `None` is as the animation says.
    pub(crate) adds: Option<Composite>,
}

pub(crate) struct FontFace {
    pub(crate) family: Str,
    /// What `src/js/internal/desktop/dom/fonts.ts` loads.
    pub(crate) json: Str,
    pub(crate) weight: [f32; 2],
    pub(crate) is_italic: bool,
}

pub(crate) struct Import {
    pub(crate) url: Str,
    /// What to wrap the imported sheet in.
    pub(crate) prelude: Out,
}

#[derive(Default)]
pub(crate) struct Sheet {
    within: Within,
    source: Source,
    base_url: Rc<[u8]>,
    pub(crate) rules: Vec<Rc<Rule>>,
    pub(crate) deferred: Vec<Deferred>,
    keys: Vec<Name>,
    raw: Vec<RawRule>,
    contexts: Vec<Rc<Context>>,
    lists: RefCell<Map<u32, Option<(List, Rc<Block>)>>>,
    /// Dotted names, in the order in which they are declared. The first one is no layer.
    pub(crate) layers: Vec<Vec<u8>>,
    /// Each layer with the media query that it is mentioned in.
    pub(crate) mentions: Vec<(u16, u16)>,
    /// Each with the one that it is in. The first one is no query.
    pub(crate) media: Vec<(Condition, u16)>,
    pub(crate) at_rules: Vec<AtRule>,
    namespaces: Namespaces,
    pub(crate) imports: Vec<Import>,
    pub(crate) uses_owner: bool,
}

struct Builder {
    sheet: Sheet,
    order: u32,
    owner: NodeId,
    /// By the prelude and the outer context. `None` if nothing in it applies.
    groups: Map<(Name, u16), Option<u16>>,
}

enum Step {
    Statement(Range<u32>),
    /// The prelude and its hash.
    Enter(Range<u32>, Name),
    Leave,
    /// The start, the brace and the end of one that takes a parser.
    Rule([u32; 3]),
    Raw(Range<u32>),
    Keyless(u32, u16),
}

/// What it takes no parser to tell.
#[derive(Default)]
struct Outline {
    steps: Vec<Step>,
    raw: Vec<RawRule>,
    deferred: Vec<Deferred>,
    keys: Vec<Name>,
}

impl Outline {
    fn new(source: &[u8]) -> Outline {
        let (mut outline, mut at, mut depth) = (Outline::default(), 0, 0);
        let (mut unescaped, mut required) = (Vec::new(), Vec::new());
        loop {
            let (start, brace) = match scan::next_rule(source, at, depth > 0) {
                Next::End(_) if depth == 0 => break,
                Next::End(end) => {
                    (at, depth) = (end, depth - 1);
                    outline.steps.push(Step::Leave);
                    continue;
                }
                Next::Statement { start, end } => {
                    at = end;
                    outline
                        .steps
                        .push(Step::Statement(start as u32..end as u32));
                    continue;
                }
                Next::Block { start, brace } => (start, brace),
            };
            let prelude = &source[start..brace];
            let name = (prelude[0] == b'@').then(|| scan::at_keyword(prelude));
            if name.is_some_and(|name| {
                ["media", "supports", "layer", "container", "starting-style"]
                    .iter()
                    .any(|it| eq(name, it))
            }) {
                (at, depth) = (brace + 1, depth + 1);
                outline
                    .steps
                    .push(Step::Enter(start as u32..brace as u32, Name::new(prelude)));
                continue;
            }
            let (end, has_blocks) = scan::end_of_block(source, brace);
            at = (end + 1).min(source.len());
            let range = [start, brace, end].map(|it| it as u32);
            match name.is_none()
                && !has_blocks
                && end > brace + 1
                && scan::requirements(prelude, &mut unescaped, &mut required)
            {
                true => outline.defer(range, &required),
                false => outline.steps.push(Step::Rule(range)),
            }
        }
        outline.deferred.shrink_to_fit();
        outline.raw.shrink_to_fit();
        outline.keys.shrink_to_fit();
        outline
    }

    fn defer(&mut self, [start, brace, end]: [u32; 3], required: &[Required]) {
        let rule = self.raw.len() as u32;
        self.raw.push(RawRule {
            start,
            brace,
            end,
            order: 0,
            context: 0,
            is_list: required.len() > 1,
        });
        match self.steps.last_mut() {
            Some(Step::Raw(range)) => range.end += 1,
            _ => self.steps.push(Step::Raw(rule..rule + 1)),
        }
        for (selector, required) in (0..=u16::MAX).zip(required) {
            let first_key = self.keys.len();
            self.keys
                .extend(required.own.iter().chain(&required.others));
            match (self.keys.len() - first_key) as u8 {
                0 => self.steps.push(Step::Keyless(rule, selector)),
                keys => self.deferred.push(Deferred {
                    rule,
                    first_key: first_key as u32,
                    selector,
                    keys,
                    has_own_key: required.own.is_some(),
                    is_class: required.is_class,
                }),
            }
        }
    }
}

/// The source of a sheet that another thread scans.
pub(crate) struct Prepared {
    source: Source,
    thread: Option<std::thread::JoinHandle<Option<Outline>>>,
}

impl Prepared {
    pub(crate) const WORTHWHILE: usize = 128 << 10;

    pub(crate) fn cannot_import(source: &[u8]) -> bool {
        let Next::Block { start, brace } = scan::next_rule(source, 0, false) else {
            return false;
        };
        crate::cssom::prelude(
            &source[start..brace],
            b"",
            Some(b""),
            &Namespaces::default(),
        )
        .is_some()
    }

    pub(crate) fn new(source: &[u8]) -> Prepared {
        let source = Source::of_sheet(source);
        // SAFETY: the bytes are not freed before the thread is joined.
        let bytes: &'static [u8] = unsafe { &*core::ptr::from_ref::<[u8]>(&source) };
        let thread = std::thread::Builder::new()
            .name("CSS".into())
            .stack_size(4 << 20);
        Prepared {
            source,
            thread: thread
                .spawn(move || crate::recovery::attempt(|| Outline::new(bytes)))
                .ok(),
        }
    }

    pub(crate) fn source(&self) -> &[u8] {
        &self.source
    }

    fn join(&mut self) -> Option<Outline> {
        self.thread.take()?.join().ok()?
    }
}

impl Drop for Prepared {
    fn drop(&mut self) {
        self.join();
    }
}

thread_local! {
    static SHARED: RefCell<Map<u64, Weak<Sheet>>> = RefCell::default();
}

impl Sheet {
    /// By the hash of what it is parsed with.
    pub(crate) fn shared(hash: u64, owner: NodeId) -> Option<Rc<Sheet>> {
        SHARED.with_borrow(|all| {
            [hash, hash ^ (u64::from(owner) + 1)]
                .iter()
                .find_map(|it| all.get(it)?.upgrade())
        })
    }

    pub(crate) fn share(self, hash: u64, owner: NodeId) -> Rc<Sheet> {
        let sheet = Rc::new(self);
        if sheet.layers.iter().any(|it| it.first() == Some(&0)) {
            return sheet;
        }
        SHARED.with_borrow_mut(|all| {
            if all.len() == all.capacity() {
                all.retain(|_, it| it.strong_count() > 0);
            }
            all.insert(
                if sheet.uses_owner {
                    hash ^ (u64::from(owner) + 1)
                } else {
                    hash
                },
                Rc::downgrade(&sheet),
            );
        });
        sheet
    }

    pub(crate) fn parse(
        source: &[u8],
        base_url: &[u8],
        media: &[u8],
        owner: NodeId,
        within: Within,
    ) -> Sheet {
        let source = Source::of_sheet(source);
        Sheet::finish(
            Prepared {
                source,
                thread: None,
            },
            base_url,
            media,
            owner,
            within,
        )
    }

    pub(crate) fn finish(
        mut prepared: Prepared,
        base_url: &[u8],
        media: &[u8],
        owner: NodeId,
        within: Within,
    ) -> Sheet {
        let source = prepared.source.clone();
        let Outline {
            steps,
            raw,
            deferred,
            keys,
        } = prepared.join().unwrap_or_else(|| Outline::new(&source));
        let sheet = Sheet {
            source: source.clone(),
            base_url: base_url.into(),
            raw,
            deferred,
            keys,
            within,
            ..Sheet::default()
        };
        let mut builder = Builder {
            sheet,
            order: 0,
            owner,
            groups: Map::default(),
        };
        builder.sheet.layers.push(Vec::new());
        builder
            .sheet
            .media
            .push((condition::media_list(media).0, 0));
        builder.sheet.contexts.push(Rc::default());
        builder.build(&source, steps);
        builder.sheet
    }

    pub(crate) fn source(&self) -> &[u8] {
        &self.source
    }

    fn compile(&self, rule: u32, selector: u16, class: Option<Name>) -> Option<Rc<Rule>> {
        let raw = &self.raw[rule as usize];
        let parser = Parser {
            namespaces: &self.namespaces,
            ..Parser::default()
        };
        let list = || parser.parse(slice(&self.source, &(raw.start..raw.brace)));
        let block = || {
            Rc::new(Block::new(
                &self.source,
                raw.brace as usize + 1..raw.end as usize,
                self.within,
                &self.base_url,
            ))
        };
        let (selector, block) = match (class, raw.is_list) {
            (Some(class), _) => (Selector::class(class), block()),
            (None, false) => (list()?.first()?.clone(), block()),
            (None, true) => {
                let mut lists = self.lists.borrow_mut();
                let (list, block) = lists
                    .entry(rule)
                    .or_insert_with(|| Some((list()?, block())))
                    .as_ref()?;
                (list.get(usize::from(selector))?.clone(), Rc::clone(block))
            }
        };
        let context = Rc::clone(&self.contexts[usize::from(raw.context)]);
        Some(Rc::new(Rule {
            selector,
            block,
            context,
            order: raw.order,
        }))
    }

    pub(crate) fn activate(&self, deferred: &Deferred) -> Option<Rc<Rule>> {
        self.compile(
            deferred.rule,
            deferred.selector,
            deferred.is_class.then(|| self.keys(deferred)[0]),
        )
    }

    pub(crate) fn keys(&self, deferred: &Deferred) -> &[Name] {
        &self.keys[deferred.first_key as usize..][..usize::from(deferred.keys)]
    }

    pub(crate) fn has(&self, kind: AtKind) -> bool {
        self.at_rules.iter().any(|it| it.kind == kind)
    }

    pub(crate) fn defined(&self, rule: &AtRule) -> Defined {
        let define = || {
            let (prelude, body) = (
                slice(&self.source, &rule.prelude),
                slice(&self.source, &rule.body),
            );
            let range = rule.body.start as usize..rule.body.end as usize;
            Some(match rule.kind {
                AtKind::Keyframes => Defined::Keyframes(self.frames(range)),
                AtKind::PositionTry => Defined::Block(Rc::new(Block::new(
                    &self.source,
                    range,
                    Within::PositionTry,
                    &self.base_url,
                ))),
                AtKind::Function => {
                    Defined::Function(Rc::new(Function::parse(prelude, body, &self.base_url)?))
                }
                AtKind::Property => {
                    Defined::Property(Rc::new(Registered::from_rule(body, &self.base_url)?))
                }
                AtKind::FontFace => Defined::FontFace(Rc::new(self.font_face(body)?)),
                AtKind::CounterStyle => Defined::CounterStyle(Rc::new(CounterStyle::parse(
                    &descriptors("counter-style", body),
                )?)),
                AtKind::FontPaletteValues => {
                    Defined::Descriptors(descriptors("font-palette-values", body).into())
                }
                AtKind::FontFeatureValues => Defined::FeatureValues(feature_values(body).into()),
                _ => Defined::Invalid,
            })
        };
        rule.defined
            .get_or_init(|| define().unwrap_or(Defined::Invalid))
            .clone()
    }

    fn frames(&self, range: Range<usize>) -> Rc<[Keyframe]> {
        let (source, mut at, mut frames) = (&self.source[..range.end], range.start, Vec::new());
        while let Next::Block { start, brace } = scan::next_rule(source, at, true) {
            let end = scan::end_of_block(source, brace).0;
            at = end + 1;
            let Some(offsets) = keyframe_selectors(&source[start..brace]) else {
                continue;
            };
            let (mut easing, mut adds) = (None, None);
            visit_declarations(&source[brace + 1..end], |name, value, important| {
                if eq(name, "animation-timing-function")
                    && !important
                    && supports_declaration(name, value)
                {
                    easing = parse_all(split_list(value)[0], |p| Easing::parse(p, &Ctx::dummy()));
                } else if eq(name, "animation-composition") && !important {
                    adds = Composite::from_name(split_list(value)[0]).or(adds);
                }
            });
            let block = Rc::new(Block::new(
                &self.source,
                brace + 1..end,
                Within::Keyframe,
                &self.base_url,
            ));
            let frame = |(range, offset)| Keyframe {
                offset,
                range,
                block: Rc::clone(&block),
                easing: easing.clone(),
                adds,
            };
            frames.extend(offsets.into_iter().map(frame));
        }
        frames.sort_by(|a, b| a.offset.total_cmp(&b.offset));
        frames.into()
    }

    fn font_face(&self, body: &[u8]) -> Option<FontFace> {
        let (all, cx) = (
            descriptors("font-face", body),
            Ctx {
                base_url: &self.base_url,
                ..Ctx::dummy()
            },
        );
        let get = |name: &str| {
            all.iter()
                .find(|it| &*it.0 == name)
                .map(|it| it.1.as_bytes())
        };
        let family = parse_all(get("font-family")?, crate::hooks::family_name)?;
        let mut json = b"{\"src\":[".to_vec();
        for source in split_list(get("src")?) {
            let (kind, value) = with_parser(source, |p| match url(p, &cx) {
                Some(url) => ("url", url),
                None => (
                    "local",
                    function(p)
                        .and_then(|_| nested(p, string))
                        .map_or("", text)
                        .into(),
                ),
            });
            json.extend(format!("{{\"{kind}\":").bytes());
            crate::json_string(value.as_bytes(), &mut json);
            json.extend_from_slice(b"},");
        }
        json.extend_from_slice(b"null]");
        for (name, value) in all.iter().filter(|it| &*it.0 != "src") {
            let computed = definition(&format!("@font-face/{name}"))
                .and_then(|it| it.write(value.as_bytes(), Mode::Computed(&cx)));
            json.extend(format!(",\"{name}\":").bytes());
            crate::json_string(
                if &**name == "font-family" {
                    &family
                } else {
                    computed.as_deref().unwrap_or_default()
                },
                &mut json,
            );
        }
        json.push(b'}');
        let weight = with_parser(get("font-weight").unwrap_or_default(), |p| {
            match (keyword(p, "bold"), number(p, &cx), number(p, &cx)) {
                (true, ..) => [700.0; 2],
                (_, Some(a), b) => [a.min(b.unwrap_or(a)), a.max(b.unwrap_or(a))],
                _ => [400.0; 2],
            }
        });
        let is_italic = get("font-style").is_some_and(|it| !matches!(it, b"normal" | b"auto"));
        Some(FontFace {
            family: text(&family).into(),
            json: text(&json).into(),
            weight,
            is_italic,
        })
    }
}

pub(crate) fn descriptor(rule: &str, name: &[u8], value: &[u8]) -> Option<Out> {
    let needs_element = |it: &&[u8]| bun_core::strings::contains_case_insensitive_ascii(value, it);
    (![&b"random("[..], b"sibling-index(", b"sibling-count("]
        .iter()
        .any(needs_element))
    .then_some(())?;
    definition(text(
        &[b"@", rule.as_bytes(), b"/", &name.to_ascii_lowercase()].concat(),
    ))?
    .write(value, Mode::Specified)
}

fn descriptors(rule: &str, body: &[u8]) -> Vec<(Str, Str)> {
    let mut all: Vec<(Str, Str)> = Vec::new();
    visit_declarations(body, |name, value, important| {
        if let Some(value) = descriptor(rule, name, value).filter(|_| !important) {
            all.retain(|it| !eq(name, &it.0));
            all.push((text(&name.to_ascii_lowercase()).into(), text(&value).into()));
        }
    });
    all
}

fn feature_values(body: &[u8]) -> Vec<(Out, Out, Vec<u32>)> {
    let (mut at, mut all) = (0, Vec::new());
    while let Next::Block { start, brace } = scan::next_rule(body, at, true) {
        let end = scan::end_of_block(body, brace).0;
        at = end + 1;
        let kind = body[start..brace].trim_ascii().to_ascii_lowercase();
        visit_declarations(&body[brace + 1..end], |name, value, _| {
            let numbers: Option<Vec<u32>> = text(value)
                .split_ascii_whitespace()
                .map(|it| it.parse().ok())
                .collect();
            all.extend(numbers.map(|it| (kind.clone(), name.to_vec(), it)));
        });
    }
    all
}

pub(crate) fn keyframe_selectors(source: &[u8]) -> Option<Vec<(Option<RangeName>, f32)>> {
    let literal = |p: &mut P| {
        if let Token::Percentage { unit_value, .. } = *p.next().ok()? {
            Some(unit_value)
        } else {
            None
        }
    };
    parse_all(source, |p| {
        commas(p, |p| match () {
            () if keyword(p, "from") => Some((None, 0.0)),
            () if keyword(p, "to") => Some((None, 1.0)),
            () => match RangeName::parse(p, &Ctx::dummy()) {
                Some(range) => Some((Some(range), percentage(p, &Ctx::dummy())?)),
                None => Some((None, literal(p).filter(|it| (0.0..=1.0).contains(it))?)),
            },
        })
    })
}

/// Of a rule that defines something.
pub(crate) fn defined_name(kind: AtKind, prelude: &[u8]) -> Option<Str> {
    const FIXED_STYLES: [&str; 7] = [
        "none",
        "decimal",
        "disc",
        "square",
        "circle",
        "disclosure-open",
        "disclosure-closed",
    ];
    let name = parse_all(prelude, |p| {
        Some(match kind {
            AtKind::Keyframes => match string(p) {
                Some(name) => Some(name).filter(|it| !it.is_empty())?.to_vec(),
                None => ident(p)
                    .filter(|it| !is_reserved(it) && !eq(it, "none"))?
                    .to_vec(),
            },
            AtKind::CounterStyle => {
                let name = ident(p).filter(|it| {
                    !is_reserved(it) && !FIXED_STYLES.iter().any(|fixed| eq(it, fixed))
                })?;
                crate::counter_style::canonical_name(&text(name).into())
                    .as_bytes()
                    .to_vec()
            }
            AtKind::Function => {
                let name = function(p)?.to_vec();
                while p.next().is_ok() {}
                name
            }
            AtKind::FontFeatureValues => {
                definition("@font-palette-values/font-family")?.write_from(p, Mode::Specified)?
            }
            AtKind::FontFace | AtKind::ViewTransition => Out::new(),
            _ => ident(p)
                .filter(|it| it.starts_with(b"--") && it.len() > 2)?
                .to_vec(),
        })
    });
    name.map(|it| text(&it).into())
}

/// Each is a path.
pub(crate) fn layer_names(p: &mut P) -> Option<Vec<Vec<Out>>> {
    commas(p, |p| {
        let mut path = vec![ident(p)?.to_vec()];
        while attempt(p, |p| {
            matches!(p.next_including_whitespace().ok()?, Token::Delim(0x2e)).then_some(())
        })
        .is_some()
        {
            let Token::Ident(part) = *p.next_including_whitespace().ok()? else {
                return None;
            };
            path.push(part.to_vec());
        }
        Some(path)
    })
}

/// The selectors before and after `to`, parsed and as they are written.
pub(crate) fn scope_limits(prelude: &[u8], parser: Parser) -> Option<[Option<(List, Out)>; 2]> {
    parse_all(prelude, |p| {
        let limit = |p: &mut P, parser: Parser| {
            let source = nested(p, |p| Raw::parse(p, &Ctx::dummy()))?;
            parser.boundary(source.0.as_bytes())
        };
        let opens = |p: &mut P| {
            attempt(p, |p| {
                matches!(p.next().ok()?, Token::OpenParen).then_some(())
            })
            .is_some()
        };
        let start = if opens(p) {
            Some(limit(p, parser)?)
        } else {
            None
        };
        let inner = Parser {
            parent: None,
            in_scope_rule: true,
            ..parser
        };
        Some([
            start,
            if keyword(p, "to") {
                Some(opens(p).then(|| limit(p, inner))??)
            } else {
                None
            },
        ])
    })
}

pub(crate) struct ImportRule {
    pub(crate) url: Out,
    /// Empty for an anonymous one.
    pub(crate) layer: Option<Vec<Out>>,
    pub(crate) supports: Option<Out>,
    pub(crate) media: Out,
}

pub(crate) fn import_rule(prelude: &[u8]) -> Option<ImportRule> {
    parse_all(prelude, |p| {
        let url = string(p).or_else(|| Some(link(p)?.0))?.to_vec();
        let argument = |p: &mut P, name: &str| {
            attempt(p, |p| p.expect_function_matching(name.as_bytes()).ok()).is_some()
        };
        let layer = match keyword(p, "layer") {
            true => Some(Vec::new()),
            false => attempt(p, |p| {
                argument(p, "layer")
                    .then(|| nested(p, layer_names).filter(|it| it.len() == 1)?.pop())?
            }),
        };
        let raw = |p: &mut P| Raw::parse(p, &Ctx::dummy()).map(|it| it.0.as_bytes().to_vec());
        let supports = if argument(p, "supports") {
            Some(nested(p, raw).filter(|it| condition::supports_import(it).is_some())?)
        } else {
            None
        };
        Some(ImportRule {
            url,
            layer,
            supports,
            media: raw(p).unwrap_or_default(),
        })
    })
}

pub(crate) fn namespace_rule(prelude: &[u8]) -> Option<(Box<[u8]>, Str)> {
    parse_all(prelude, |p| {
        Some((
            ident(p).unwrap_or_default().into(),
            text(string(p).or_else(|| p.expect_url().ok())?).into(),
        ))
    })
}

/// The name in lowercase, and the rest.
pub(crate) fn at_rule(prelude: &[u8]) -> (Out, &[u8]) {
    with_parser(prelude, |p| match p.next().copied() {
        Ok(Token::AtKeyword(name)) => (
            name.to_ascii_lowercase(),
            scan::trim(&prelude[p.position()..]),
        ),
        _ => (b"@".to_vec(), prelude),
    })
}

const MAX_NESTING: u8 = 64;

impl Builder {
    fn build(&mut self, source: &[u8], steps: Vec<Step>) {
        let (mut context, mut outer, mut skipped, mut has_skipped) = (0, Vec::new(), 0, false);
        let (mut allows_imports, mut allows_namespaces) = (true, true);
        let is_valid = |[start, brace]: [u32; 2], sheet: &Sheet| {
            crate::cssom::prelude(
                slice(source, &(start..brace)),
                b"",
                Some(b""),
                &sheet.namespaces,
            )
            .is_some()
        };
        for step in steps {
            match step {
                Step::Enter(..) if skipped > 0 => skipped += 1,
                Step::Leave if skipped > 0 => skipped -= 1,
                _ if skipped > 0 => {}
                Step::Leave => context = outer.pop().unwrap_or(0),
                Step::Statement(range) => {
                    let statement = slice(source, &range);
                    match at_rule(statement.strip_suffix(b";").unwrap_or(statement)) {
                        (name, rest) if name == b"import" && allows_imports => self.import(rest),
                        (name, rest)
                            if name == b"namespace"
                                && allows_namespaces
                                && let Some(rule) = namespace_rule(rest) =>
                        {
                            allows_imports = false;
                            self.sheet.namespaces.push(rule);
                        }
                        (name, rest) if name == b"layer" => {
                            let has_imports =
                                !self.sheet.imports.is_empty() || !self.sheet.namespaces.is_empty();
                            let cx = &self.sheet.contexts[usize::from(context)];
                            if self.layers(rest, (cx.layer, cx.media)) && has_imports {
                                (allows_imports, allows_namespaces) = (false, false);
                            }
                        }
                        _ => {}
                    }
                }
                Step::Enter(prelude, name) => {
                    allows_namespaces =
                        allows_namespaces && !is_valid([prelude.start, prelude.end], &self.sheet);
                    match self.group(slice(source, &prelude), name, context) {
                        Some(inner) => outer.push(core::mem::replace(&mut context, inner)),
                        None => (skipped, has_skipped) = (1, true),
                    }
                }
                Step::Rule([start, brace, end]) => {
                    allows_namespaces = allows_namespaces && !is_valid([start, brace], &self.sheet);
                    let cx = Rc::clone(&self.sheet.contexts[usize::from(context)]);
                    self.rule(
                        source,
                        [start, brace, end].map(|it| it as usize),
                        None,
                        &cx,
                        0,
                    );
                }
                Step::Raw(range) => {
                    let range = range.start as usize..range.end as usize;
                    allows_namespaces = allows_namespaces
                        && !self.sheet.raw[range.clone()]
                            .iter()
                            .any(|it| is_valid([it.start, it.brace], &self.sheet));
                    for raw in &mut self.sheet.raw[range] {
                        self.order += 1;
                        (raw.order, raw.context) = (self.order, context);
                    }
                }
                Step::Keyless(rule, selector) => {
                    let rule = self.sheet.compile(rule, selector, None);
                    self.sheet.rules.extend(rule);
                }
            }
            allows_imports &= allows_namespaces;
        }
        let Sheet {
            raw,
            deferred,
            namespaces,
            ..
        } = &mut self.sheet;
        if has_skipped {
            deferred.retain(|it| raw[it.rule as usize].order != 0);
        }
        if !namespaces.is_empty() {
            deferred.iter_mut().for_each(|it| it.is_class = false);
        }
    }

    fn group(&mut self, prelude: &[u8], hash: Name, outer: u16) -> Option<u16> {
        let key = (hash, outer);
        if let Some(known) = self.groups.get(&key) {
            return *known;
        }
        let ((name, rest), cx) = (
            at_rule(prelude),
            Rc::clone(&self.sheet.contexts[usize::from(outer)]),
        );
        let index = self.enter(&name, rest, None, &cx).and_then(|inner| {
            self.sheet.contexts.push(Rc::new(inner));
            u16::try_from(self.sheet.contexts.len() - 1).ok()
        });
        if !rest.is_empty() {
            self.groups.insert(key, index);
        }
        index
    }

    /// Of a rule that has rules in it, if they can apply.
    fn enter(
        &mut self,
        name: &[u8],
        prelude: &[u8],
        parent: Option<&List>,
        cx: &Context,
    ) -> Option<Context> {
        let parser = Parser {
            parent,
            in_scope_rule: cx.scope.is_some(),
            namespaces: &self.sheet.namespaces,
            is_strict: false,
        };
        Some(match name {
            b"media" => {
                self.sheet
                    .media
                    .push((condition::media_list(prelude).0, cx.media));
                Context {
                    media: u16::try_from(self.sheet.media.len() - 1).ok()?,
                    ..cx.clone()
                }
            }
            b"supports" => condition::supports(
                prelude,
                Parser {
                    parent: None,
                    in_scope_rule: false,
                    ..parser
                },
            )?
            .then(|| cx.clone())?,
            b"layer" if prelude.is_empty() => Context {
                layer: self.layer((cx.layer, cx.media), &[]),
                ..cx.clone()
            },
            b"layer" => match &parse_all(prelude, layer_names)?[..] {
                [path] => Context {
                    layer: self.layer((cx.layer, cx.media), path),
                    ..cx.clone()
                },
                _ => return None,
            },
            b"container" => {
                let query =
                    ContainerQuery::new(condition::container_list(prelude)?, cx.container.clone());
                Context {
                    container: Some(Rc::new(query)),
                    ..cx.clone()
                }
            }
            b"scope" => {
                let [start, end] = scope_limits(prelude, parser)?.map(|it| it.map(|it| it.0));
                let start = start.or_else(|| parent.cloned());
                self.sheet.uses_owner |= start.is_none();
                Context {
                    scope: Some(Rc::new(ScopeRule {
                        start,
                        end,
                        outer: cx.scope.clone(),
                        owner: self.owner,
                    })),
                    ..cx.clone()
                }
            }
            b"starting-style" if prelude.is_empty() => Context {
                is_starting: true,
                ..cx.clone()
            },
            _ => return None,
        })
    }

    /// An anonymous one has no path.
    fn layer(&mut self, (outer, media): (u16, u16), path: &[Out]) -> u16 {
        let mut full = self.sheet.layers[usize::from(outer)].clone();
        let anonymous = [format!(
            "\0{:p}{}",
            Rc::as_ptr(&self.sheet.base_url),
            self.sheet.layers.len()
        )
        .into_bytes()];
        for part in if path.is_empty() { &anonymous } else { path } {
            if !full.is_empty() {
                full.push(b'.');
            }
            full.extend(part.iter().map(|it| if *it == b'.' { 1 } else { *it }));
        }
        let layers = &mut self.sheet.layers;
        let index = layers.iter().position(|it| *it == full).unwrap_or_else(|| {
            layers.push(full);
            layers.len() - 1
        });
        let index = index.min(usize::from(u16::MAX)) as u16;
        if !self
            .sheet
            .mentions
            .iter()
            .any(|it| *it == (index, 0) || *it == (index, media))
        {
            self.sheet.mentions.push((index, media));
        }
        index
    }

    fn layers(&mut self, prelude: &[u8], outer: (u16, u16)) -> bool {
        parse_all(prelude, layer_names)
            .map(|all| all.iter().for_each(|path| _ = self.layer(outer, path)))
            .is_some()
    }

    fn import(&mut self, prelude: &[u8]) {
        let Some(rule) = import_rule(prelude) else {
            return;
        };
        if rule
            .supports
            .is_some_and(|it| condition::supports_import(&it) != Some(true))
        {
            return;
        }
        let mut prelude = Out::new();
        for name in &self.sheet.layers[1..] {
            prelude.extend_from_slice(b"@layer ");
            let unescaped = |it: &[u8]| {
                it.iter()
                    .map(|it| if *it == 1 { b'.' } else { *it })
                    .collect::<Out>()
            };
            write_list(
                &bun_core::strings::split(name, b".").collect::<Vec<_>>(),
                ".",
                &mut prelude,
                |it, out| write_ident(&unescaped(it), out),
            );
            prelude.push(b';');
        }
        if !rule.media.is_empty() {
            prelude.extend(
                [
                    b"@media ",
                    &condition::media_list(&rule.media).1.join(&b',')[..],
                    b"{",
                ]
                .concat(),
            );
        }
        if let Some(path) = &rule.layer {
            if rule.media.is_empty() && !path.is_empty() {
                self.layer((0, 0), path);
            }
            prelude.extend_from_slice(b"@layer ");
            write_list(path, ".", &mut prelude, |it, out| write_ident(it, out));
            prelude.push(b'{');
        }
        let url = Ctx {
            base_url: &self.sheet.base_url,
            ..Ctx::dummy()
        }
        .url(&rule.url);
        self.sheet.imports.push(Import { url, prelude });
    }

    fn declarations(&mut self, selectors: Option<&List>, range: Range<usize>, cx: &Rc<Context>) {
        let Some(selectors) = selectors.filter(|_| !range.is_empty()) else {
            return;
        };
        let block = Rc::new(Block::new(
            &self.sheet.source,
            range,
            self.sheet.within,
            &self.sheet.base_url,
        ));
        self.order += 1;
        self.sheet.rules.extend(selectors.iter().map(|selector| {
            let (selector, block, context) = (selector.clone(), Rc::clone(&block), Rc::clone(cx));
            Rc::new(Rule {
                selector,
                block,
                context,
                order: self.order,
            })
        }));
    }

    fn rule(
        &mut self,
        source: &[u8],
        [start, brace, end]: [usize; 3],
        parent: Option<&List>,
        cx: &Rc<Context>,
        depth: u8,
    ) {
        let prelude = &source[start..brace];
        if prelude.first() != Some(&b'@') {
            let parser = Parser {
                parent,
                in_scope_rule: cx.scope.is_some(),
                namespaces: &self.sheet.namespaces,
                is_strict: false,
            };
            if let Some(selectors) = parser
                .parse(prelude)
                .filter(|it| depth < 4 || crate::selector::fits(it, &mut (1 << 14)))
            {
                self.contents(
                    &source[..end],
                    brace + 1,
                    Some(&selectors),
                    Some(&selectors),
                    cx,
                    depth,
                );
            }
            return;
        }
        let (name, rest) = at_rule(prelude);
        if let Some(kind) = AtKind::from_name(&name).filter(|_| parent.is_none()) {
            let offset = rest.as_ptr().addr() - source.as_ptr().addr();
            self.sheet
                .at_rules
                .extend(defined_name(kind, rest).map(|name| AtRule {
                    kind,
                    name,
                    media: cx.media,
                    layer: cx.layer,
                    prelude: offset as u32..(offset + rest.len()) as u32,
                    body: brace as u32 + 1..end as u32,
                    defined: OnceCell::new(),
                }));
        } else if let Some(inner) = self.enter(&name, rest, parent, cx) {
            let parent = parent.filter(|_| name != b"scope");
            let root = inner
                .scope
                .as_ref()
                .and_then(|_| Parser::default().parse(b":where(:scope)"));
            self.contents(
                &source[..end],
                brace + 1,
                parent,
                parent.or(root.as_ref()),
                &Rc::new(inner),
                depth,
            );
        }
    }

    /// `owner` is what the declarations apply to.
    fn contents(
        &mut self,
        source: &[u8],
        mut at: usize,
        parent: Option<&List>,
        owner: Option<&List>,
        cx: &Rc<Context>,
        depth: u8,
    ) {
        let mut declarations = at..at;
        while depth < MAX_NESTING {
            match if owner.is_some() {
                scan::next_item(source, at)
            } else {
                scan::next_rule(source, at, true)
            } {
                Next::End(_) => break,
                Next::Statement { start, end } => {
                    (at, declarations.end) = (end, end);
                    let statement = &source[start..end];
                    if statement[0] == b'@'
                        && parent.is_none()
                        && let (name, rest) =
                            at_rule(statement.strip_suffix(b";").unwrap_or(statement))
                        && name == b"layer"
                    {
                        self.layers(rest, (cx.layer, cx.media));
                    }
                }
                Next::Block { start, brace } => {
                    self.declarations(owner, declarations, cx);
                    let end = scan::end_of_block(source, brace).0;
                    self.rule(source, [start, brace, end], parent, cx, depth + 1);
                    at = (end + 1).min(source.len());
                    declarations = at..at;
                }
            }
        }
        self.declarations(owner, declarations, cx);
    }
}

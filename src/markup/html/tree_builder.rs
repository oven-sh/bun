use std::borrow::Cow;

use super::tags::{svg_attribute_name, svg_tag_name};
use super::{
    Attribute, AttributeNamespace, Dom, ElementName, Kind, NameOf, Namespace, NewElement, NodeOf,
    Options, Patch, Place, Position, Quirks, ShortName, Sink, Stop, Tag, find_attribute, quirks,
};
use crate::{Chars, Text};

/// What is deeper becomes a sibling, as in Chromium.
const MAX_DEPTH: usize = 512;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Mode {
    Initial,
    BeforeHtml,
    BeforeHead,
    InHead,
    InHeadNoscript,
    AfterHead,
    InBody,
    Text,
    InTable,
    InCaption,
    InColumnGroup,
    InTableBody,
    InRow,
    InCell,
    InTemplate,
    AfterBody,
    InFrameset,
    AfterFrameset,
    AfterAfterBody,
    AfterAfterFrameset,
}

/// With the element that an end tag has to name. `Other` is never named.
#[derive(Clone, Copy)]
pub(super) enum Content {
    Data,
    Rcdata(Tag),
    Rawtext(Tag),
    Script,
    Plaintext,
}

/// Its attributes are in `State::attributes`.
pub(super) struct StartTag<N> {
    pub(super) tag: Tag,
    /// If `tag` is `Other`.
    pub(super) name: Option<N>,
    pub(super) is_self_closing: bool,
}

impl<N> StartTag<N> {
    fn known(tag: Tag) -> Self {
        StartTag {
            tag,
            name: None,
            is_self_closing: false,
        }
    }
}

struct Open<D: Dom> {
    node: D::Node,
    /// Tells it from every other element, whatever has become of their nodes.
    serial: u32,
    /// In any namespace.
    tag: Tag,
    namespace: Namespace,
    kind: Kind,
    /// In lowercase, if `tag` is `Other`.
    name: Option<D::Name>,
}

impl<D: Dom> Open<D> {
    #[inline]
    fn html(&self) -> Tag {
        if self.namespace == Namespace::Html {
            self.tag
        } else {
            Tag::Other
        }
    }

    #[inline]
    fn is(&self, tag: Tag) -> bool {
        self.tag == tag && self.namespace == Namespace::Html
    }

    #[inline]
    fn has(&self, kind: Kind) -> bool {
        self.kind.intersects(kind)
    }

    #[inline]
    fn is_named(&self, tag: Tag, name: Chars<'_>) -> bool {
        self.tag == tag
            && self
                .name
                .as_ref()
                .is_none_or(|it| D::chars_of_name(it) == name)
    }
}

fn kind_of<D: Dom>(tag: Tag, namespace: Namespace, attributes: &[Attribute<D>]) -> Kind {
    let boundary = Kind::SPECIAL | Kind::SCOPE;
    match (namespace, tag) {
        (Namespace::Html, _) => tag.kind() - Kind::MATH_TEXT,
        (Namespace::Svg, Tag::ForeignObject | Tag::Desc) => boundary | Kind::HTML_INTEGRATION,
        (Namespace::Svg, Tag::Title) => boundary | Kind::HTML_INTEGRATION | Kind::REPORTS_END,
        (Namespace::Svg, Tag::Script | Tag::Style) => Kind::REPORTS_END,
        (Namespace::MathMl, Tag::AnnotationXml) => {
            let encoding =
                find_attribute(attributes, "encoding").map_or(Chars::EMPTY, D::chars_of_text);
            if encoding.is_ignoring_case(b"text/html")
                || encoding.is_ignoring_case(b"application/xhtml+xml")
            {
                boundary | Kind::HTML_INTEGRATION
            } else {
                boundary
            }
        }
        (Namespace::MathMl, _) if tag.is(Kind::MATH_TEXT) => boundary | Kind::MATH_TEXT,
        _ => Kind::empty(),
    }
}

struct Formatting<D: Dom> {
    serial: u32,
    tag: Tag,
    attributes: Vec<Attribute<D>>,
    stencil: Option<D::Stencil>,
}

impl<D: Dom> Formatting<D> {
    fn all_attributes(&self) -> Cow<'_, [Attribute<D>]> {
        self.stencil
            .as_ref()
            .map_or(Cow::Borrowed(&self.attributes), |it| {
                D::attributes_of(it).into()
            })
    }

    fn is_like(&self, other: &Self) -> bool {
        if self.tag != other.tag {
            return false;
        }
        let (own, others) = (self.all_attributes(), other.all_attributes());
        own.len() == others.len()
            && own.iter().all(|a| {
                others.iter().any(|b| {
                    a.name == b.name && D::chars_of_text(&a.value) == D::chars_of_text(&b.value)
                })
            })
    }
}

/// The context element of a fragment.
pub struct Context<D: Dom> {
    pub node: D::Node,
    pub tag: Tag,
    /// `None` if it is another one.
    pub namespace: Option<Namespace>,
    /// Only `encoding` matters.
    pub attributes: Vec<Attribute<D>>,
    pub form: Option<D::Node>,
}

pub(super) struct State<D: Dom> {
    options: Options,
    pub(super) content: Content,
    pub(super) attributes: Vec<Attribute<D>>,
    /// In place of `attributes`.
    pub(super) stencil: Option<D::Stencil>,
    pub(super) position: Position,
    pub(super) had_duplicate_attributes: bool,
    mode: Mode,
    original_mode: Mode,
    template_modes: Vec<Mode>,
    open: Vec<Open<D>>,
    /// How many HTML elements with each name are open.
    open_counts: [u32; Tag::ALL.len()],
    next_serial: u32,
    /// `None` is a marker.
    active: Vec<Option<Formatting<D>>>,
    spare_attributes: Vec<Vec<Attribute<D>>>,
    /// With the serial of the template.
    patches: Vec<(u32, Patch<D::Node>)>,
    head: Option<D::Node>,
    /// With its serial.
    form: Option<(D::Node, u32)>,
    context: Option<Open<D>>,
    pending_table_text: Text,
    deferred: Option<(D::Node, Place<D::Node>)>,
    script: Option<D::Node>,
    is_frameset_ok: bool,
    fosters: bool,
    skips_newline: bool,
    has_finished: bool,
}

impl<D: Dom> State<D> {
    pub(super) fn new(options: Options) -> Self {
        State {
            options,
            content: Content::Data,
            attributes: Vec::new(),
            stencil: None,
            position: Position::default(),
            had_duplicate_attributes: false,
            mode: Mode::Initial,
            original_mode: Mode::Initial,
            template_modes: Vec::new(),
            open: Vec::new(),
            open_counts: [0; Tag::ALL.len()],
            next_serial: 1,
            active: Vec::new(),
            spare_attributes: Vec::new(),
            patches: Vec::new(),
            head: None,
            form: None,
            context: None,
            pending_table_text: Text::default(),
            deferred: None,
            script: None,
            is_frameset_ok: true,
            fosters: false,
            skips_newline: false,
            has_finished: false,
        }
    }

    pub(super) fn for_fragment(options: Options, context: &Context<D>, root: D::Node) -> Self {
        let mut state = State::new(options);
        let (tag, namespace) = match context.namespace {
            Some(namespace) => (context.tag, namespace),
            None => (Tag::Other, Namespace::Html),
        };
        let kind = kind_of(tag, namespace, &context.attributes);
        let element = Open {
            node: context.node,
            serial: 0,
            tag,
            namespace,
            kind,
            name: None,
        };
        match element.html() {
            Tag::Title | Tag::Textarea => state.content = Content::Rcdata(Tag::Other),
            Tag::Noscript if options.scripting => state.content = Content::Plaintext,
            Tag::Template => state.template_modes.push(Mode::InTemplate),
            tag if tag.is(Kind::RAW_TEXT) => state.content = Content::Plaintext,
            _ => {}
        }
        state.context = Some(element);
        state.form = context.form.map(|it| (it, 0));
        state.push(
            root,
            StartTag::known(Tag::Html),
            Namespace::Html,
            Tag::Html.kind(),
        );
        state.reset_mode();
        state
    }

    pub(super) fn current_node(&self) -> Option<D::Node> {
        self.open.last().map(|it| it.node)
    }

    pub(super) fn is_open(&self, node: D::Node) -> bool {
        self.open.iter().any(|it| it.node == node)
    }

    pub(super) fn nodes(&self) -> impl Iterator<Item = D::Node> + '_ {
        let patches = self
            .patches
            .iter()
            .flat_map(|(_, it)| [Some(it.target), Some(it.start), it.end]);
        let pointers = [self.head, self.form.map(|it| it.0)];
        self.open
            .iter()
            .map(|it| it.node)
            .chain(patches.chain(pointers).flatten())
    }

    #[inline]
    fn has_open(&self, tag: Tag) -> bool {
        self.open_counts[tag as usize] > 0
    }

    #[inline]
    fn context_is(&self, tag: Tag) -> bool {
        self.context.as_ref().is_some_and(|it| it.is(tag))
    }

    pub(super) fn is_in_template(&self) -> bool {
        self.has_open(Tag::Template) || self.context_is(Tag::Template)
    }

    fn entry(
        &mut self,
        node: D::Node,
        tag: StartTag<D::Name>,
        namespace: Namespace,
        kind: Kind,
    ) -> Open<D> {
        let entry = Open {
            node,
            serial: self.next_serial,
            tag: tag.tag,
            namespace,
            kind,
            name: tag.name,
        };
        self.next_serial += 1;
        self.open_counts[entry.html() as usize] += 1;
        entry
    }

    #[inline]
    fn push(
        &mut self,
        node: D::Node,
        tag: StartTag<D::Name>,
        namespace: Namespace,
        kind: Kind,
    ) -> u32 {
        let entry = self.entry(node, tag, namespace, kind);
        let serial = entry.serial;
        self.open.push(entry);
        serial
    }

    #[inline]
    fn adjusted_current(&self) -> Option<&Open<D>> {
        match &self.context {
            Some(context) if self.open.len() == 1 => Some(context),
            _ => self.open.last(),
        }
    }

    #[inline]
    fn current_is(&self, tag: Tag) -> bool {
        self.open.last().is_some_and(|it| it.is(tag))
    }

    #[inline]
    fn current_has(&self, kind: Kind) -> bool {
        self.open.last().is_some_and(|it| it.has(kind))
    }

    fn index_of(&self, serial: u32) -> Option<usize> {
        self.open.iter().rposition(|it| it.serial == serial)
    }

    fn last_open(&self, tag: Tag) -> Option<usize> {
        if self.has_open(tag) {
            self.open.iter().rposition(|it| it.is(tag))
        } else {
            None
        }
    }

    fn has_in_scope(&self, scope: Kind, is_wanted: impl Fn(&Open<D>) -> bool) -> bool {
        self.open
            .iter()
            .rev()
            .find(|it| is_wanted(it) || it.has(scope))
            .is_some_and(is_wanted)
    }

    #[inline]
    fn in_scope(&self, tag: Tag, scope: Kind) -> bool {
        self.has_open(tag) && self.has_in_scope(scope, |it| it.is(tag))
    }

    fn active_index_of(&self, serial: u32) -> Option<usize> {
        self.active
            .iter()
            .rposition(|it| it.as_ref().is_some_and(|it| it.serial == serial))
    }

    fn since_marker(&self) -> impl Iterator<Item = (usize, &Formatting<D>)> {
        self.active
            .iter()
            .enumerate()
            .rev()
            .map_while(|(index, it)| Some((index, it.as_ref()?)))
    }

    fn find_formatting(&self, tag: Tag) -> Option<(usize, u32)> {
        self.since_marker()
            .find(|it| it.1.tag == tag)
            .map(|(index, it)| (index, it.serial))
    }

    /// There is nothing to reconstruct.
    #[inline(always)]
    fn is_formatting_open(&self) -> bool {
        !matches!(self.active.last(), Some(Some(last)) if self.index_of(last.serial).is_none())
    }

    #[inline(always)]
    fn copy_attributes(&mut self) -> Vec<Attribute<D>> {
        if self.attributes.is_empty() {
            return Vec::new();
        }
        let mut attributes = self.spare_attributes.pop().unwrap_or_default();
        attributes.extend_from_slice(&self.attributes);
        attributes
    }

    #[inline(always)]
    fn recycle(&mut self, entry: Option<Formatting<D>>) {
        if let Some(Formatting { mut attributes, .. }) = entry
            && attributes.capacity() > 0
        {
            attributes.clear();
            self.spare_attributes.push(attributes);
        }
    }

    fn clear_formatting(&mut self) {
        while let Some(Some(_)) = self.active.pop() {}
    }

    fn reset_mode(&mut self) {
        for (index, entry) in self.open.iter().enumerate().rev() {
            let is_last = index == 0;
            let entry = if is_last {
                self.context.as_ref().unwrap_or(entry)
            } else {
                entry
            };
            self.mode = match entry.html() {
                Tag::Td | Tag::Th if !is_last => Mode::InCell,
                Tag::Tr => Mode::InRow,
                Tag::Tbody | Tag::Tfoot | Tag::Thead => Mode::InTableBody,
                Tag::Caption => Mode::InCaption,
                Tag::Colgroup => Mode::InColumnGroup,
                Tag::Table => Mode::InTable,
                Tag::Template => self.template_modes.last().copied().unwrap_or(Mode::InBody),
                Tag::Head if !is_last => Mode::InHead,
                Tag::Body => Mode::InBody,
                Tag::Frameset => Mode::InFrameset,
                Tag::Html if self.head.is_none() => Mode::BeforeHead,
                Tag::Html => Mode::AfterHead,
                _ => continue,
            };
            return;
        }
        self.mode = Mode::InBody;
    }

    #[inline]
    pub(super) fn forget_attributes(&mut self) {
        if !self.attributes.is_empty() {
            self.attributes.clear();
        }
        self.stencil = None;
        self.had_duplicate_attributes = false;
    }

    /// Whether a start tag can only become an HTML element, and nothing here looks at its attributes.
    #[inline]
    pub(super) fn takes_stencil(&self, tag: Tag) -> bool {
        !matches!(
            tag,
            Tag::Other | Tag::Html | Tag::Body | Tag::Template | Tag::Svg | Tag::Math
        ) && (tag != Tag::Input
            || !self.is_frameset_ok
                && matches!(self.mode, Mode::InBody | Mode::InCell | Mode::InCaption))
            && self
                .adjusted_current()
                .is_some_and(|it| it.namespace == Namespace::Html)
    }

    fn attribute(&self, name: &str) -> Option<Chars<'_>> {
        find_attribute(&self.attributes, name).map(D::chars_of_text)
    }

    fn is_hidden_input(&self) -> bool {
        self.attribute("type")
            .is_some_and(|it| it.is_ignoring_case(b"hidden"))
    }
}

/// In the body.
#[derive(Clone, Copy, PartialEq)]
enum Starts {
    Block,
    Formatting,
    Phrase,
    Item,
    Control,
    Otherwise,
}

const fn for_each_tag<T: Copy, const N: usize>(
    mut all: [T; Tag::ALL.len()],
    value: T,
    tags: [Tag; N],
) -> [T; Tag::ALL.len()] {
    let mut index = 0;
    while index < N {
        all[tags[index] as usize] = value;
        index += 1;
    }
    all
}

static STARTS: [Starts; Tag::ALL.len()] = {
    use Tag::*;
    let all = for_each_tag(
        [Starts::Otherwise; _],
        Starts::Block,
        [
            Address, Article, Aside, Blockquote, Div, Dl, Figcaption, Figure, Footer, Header, Main,
            Nav, Ol, P, Section, Ul,
        ],
    );
    let all = for_each_tag(
        all,
        Starts::Formatting,
        [
            A, B, Big, Code, Em, Font, I, S, Small, Strike, Strong, Tt, U,
        ],
    );
    let all = for_each_tag(all, Starts::Item, [Dd, Dt, Li]);
    let all = for_each_tag(all, Starts::Control, [Button, Input]);
    for_each_tag(
        all,
        Starts::Phrase,
        [
            Abbr, Cite, Del, Dfn, Ins, Kbd, Label, Mark, Q, Samp, Span, Sub, Sup, Time, Var,
        ],
    )
};

/// The name and `>`, the first character in the lowest byte.
static SIMPLE_ENDS: [u64; Tag::ALL.len()] = {
    use Tag::*;
    let (mut all, others, mut index) = (
        [0; _],
        for_each_tag([false; _], true, [H1, H2, H3, H4, H5, H6, Pre]),
        0,
    );
    while index < all.len() {
        let name = Tag::ALL[index].name().as_bytes();
        if name.len() < 8 && (others[index] || !matches!(STARTS[index], Starts::Otherwise)) {
            all[index] = ShortName::of_ascii(name).0 | (b'>' as u64) << (8 * name.len());
        }
        index += 1;
    }
    all
};

const DEFAULT_SCOPE: Kind = Kind::SCOPE;
const LIST_ITEM_SCOPE: Kind = Kind::SCOPE.union(Kind::LIST_SCOPE);
const BUTTON_SCOPE: Kind = Kind::SCOPE.union(Kind::BUTTON_SCOPE);
const TABLE_SCOPE: Kind = Kind::TABLE_SCOPE;

fn at_end_of<N>(parent: N) -> Place<N> {
    Place {
        parent,
        before: None,
    }
}

fn filtered(text: Chars<'_>, map: impl Fn(u16) -> Option<u16>) -> Text {
    let mut out = Text::with_capacity(text.len());
    text.units()
        .filter_map(map)
        .for_each(|it| out.push_unit(it));
    out
}

fn is_space(unit: u16) -> bool {
    matches!(unit, 9 | 10 | 12 | 13 | 32)
}

#[derive(Clone, Copy, Default)]
pub(super) struct TextIs {
    pub(super) has_nul: bool,
    pub(super) may_continue: bool,
}

pub(super) struct Builder<'a, S: Sink> {
    pub(super) state: &'a mut State<S::Dom>,
    pub(super) sink: &'a mut S,
}

type Start<S> = StartTag<NameOf<S>>;

impl<S: Sink> Builder<'_, S> {
    #[inline]
    pub(super) fn take_stop(&mut self) -> Option<Stop<NodeOf<S>>> {
        if let Some((node, place)) = self.state.deferred.take() {
            return Some(Stop::Insert(node, place));
        }
        if let Some(script) = self.state.script.take() {
            return Some(Stop::Script(script));
        }
        self.sink.wants_to_pause().then_some(Stop::Paused)
    }

    pub(super) fn allows_cdata(&self) -> bool {
        self.state
            .adjusted_current()
            .is_some_and(|it| it.namespace != Namespace::Html)
    }

    #[inline]
    fn insert_deferred(&mut self) {
        if let Some((node, place)) = self.state.deferred.take() {
            self.sink.insert_element(node, place);
        }
    }

    /// Before anything that can run a script.
    #[inline]
    pub(super) fn pin_open(&mut self) {
        for it in self.state.open.iter_mut().rev() {
            if self.sink.is_pinned(it.node) {
                break;
            }
            it.node = self.sink.pin(it.node);
        }
        self.sink.publish();
    }

    #[inline]
    fn pinned(&mut self, place: Place<NodeOf<S>>) -> Place<NodeOf<S>> {
        let place = Place {
            parent: self.sink.pin(place.parent),
            before: place.before.map(|it| self.sink.pin(it)),
        };
        self.pin_open();
        place
    }

    #[inline]
    fn is_quiet(&self, place: Place<NodeOf<S>>) -> bool {
        let is_pinned = |node| self.sink.is_pinned(node);
        place.before.is_none()
            && self.state.deferred.is_none()
            && (!is_pinned(place.parent) || self.state.current_node().is_none_or(is_pinned))
    }

    fn append_quietly(
        &mut self,
        name: ElementName<'_, S::Dom>,
        namespace: Namespace,
        place: Place<NodeOf<S>>,
    ) -> Option<NodeOf<S>> {
        self.is_quiet(place).then_some(())?;
        let (attributes, stencil, position) = (
            &mut self.state.attributes,
            self.state.stencil.as_ref(),
            self.state.position,
        );
        self.sink.append_element_quietly(NewElement {
            name,
            namespace,
            attributes,
            stencil,
            intended_parent: place.parent,
            position,
            had_duplicate_attributes: false,
        })
    }

    // The stack of open elements

    #[inline]
    fn pop(&mut self) -> Option<Open<S::Dom>> {
        let entry = self.state.open.pop()?;
        self.closed(&entry);
        Some(entry)
    }

    fn remove_open(&mut self, index: usize) {
        let entry = self.state.open.remove(index);
        self.closed(&entry);
    }

    #[inline]
    fn closed(&mut self, entry: &Open<S::Dom>) {
        self.state.open_counts[entry.html() as usize] -= 1;
        if entry.has(Kind::REPORTS_END) && self.sink.is_pinned(entry.node) {
            self.pin_open();
            self.insert_deferred();
            self.sink.finished(entry.node);
        }
    }

    fn pop_to_len(&mut self, len: usize) {
        while self.state.open.len() > len {
            self.pop();
        }
    }

    fn pop_until(&mut self, tag: Tag) {
        while self.pop().is_some_and(|it| !it.is(tag)) {}
    }

    fn pop_until_kind(&mut self, kind: Kind) {
        while self.pop().is_some_and(|it| !it.has(kind)) {}
    }

    /// "Clear the stack back to a table context" and the like.
    fn clear_back_to(&mut self, is_context: impl Fn(Tag) -> bool) {
        let stays = |tag| matches!(tag, Tag::Html | Tag::Template) || is_context(tag);
        while self.state.open.last().is_some_and(|it| !stays(it.html())) {
            self.pop();
        }
    }

    #[inline]
    fn generate_implied_end_tags(&mut self, except: Tag) {
        while self.state.current_has(Kind::IMPLIED_END) && !self.state.current_is(except) {
            self.pop();
        }
    }

    #[inline]
    fn close_p(&mut self) {
        if self.state.in_scope(Tag::P, BUTTON_SCOPE) {
            self.pop_until(Tag::P);
        }
    }

    // Creating and inserting nodes

    fn inside_template(&mut self, node: NodeOf<S>, serial: u32) -> Place<NodeOf<S>> {
        match self.state.patches.last() {
            Some((of, patch)) if *of == serial => {
                let before = patch
                    .end
                    .filter(|it| self.sink.parent(*it) == Some(patch.target));
                Place {
                    parent: patch.target,
                    before,
                }
            }
            _ => at_end_of(self.sink.template_contents(node).unwrap_or(node)),
        }
    }

    #[inline]
    fn inside(&mut self, index: usize) -> Place<NodeOf<S>> {
        let parent = &self.state.open[index];
        if parent.is(Tag::Template) {
            self.inside_template(parent.node, parent.serial)
        } else {
            at_end_of(parent.node)
        }
    }

    /// The appropriate place for inserting a node.
    #[inline]
    fn place_for(&mut self, index: usize) -> Place<NodeOf<S>> {
        if self.state.fosters && self.state.open[index].has(Kind::FOSTERS) {
            self.foster_place()
        } else {
            self.inside(index)
        }
    }

    #[inline]
    fn place(&mut self) -> Place<NodeOf<S>> {
        self.place_for(self.state.open.len() - 1)
    }

    #[inline]
    fn place_within_depth(&mut self) -> Place<NodeOf<S>> {
        let len = self.state.open.len();
        self.place_for(if len > MAX_DEPTH {
            MAX_DEPTH - 1
        } else {
            len - 1
        })
    }

    fn foster_place(&mut self) -> Place<NodeOf<S>> {
        match (
            self.state.last_open(Tag::Template),
            self.state.last_open(Tag::Table),
        ) {
            (Some(template), table) if Some(template) > table => self.inside(template),
            (_, None) => self.inside(0),
            (_, Some(index)) => {
                let table = self.state.open[index].node;
                let Some(parent) = self.sink.parent(table) else {
                    return self.inside(index - 1);
                };
                match self.sink.template_contents(parent) {
                    Some(contents) => at_end_of(contents),
                    None => Place {
                        parent,
                        before: Some(table),
                    },
                }
            }
        }
    }

    #[inline]
    fn create(
        &mut self,
        name: ElementName<'_, S::Dom>,
        namespace: Namespace,
        parent: NodeOf<S>,
    ) -> NodeOf<S> {
        self.insert_deferred();
        let (attributes, stencil, position) = (
            &mut self.state.attributes,
            self.state.stencil.as_ref(),
            self.state.position,
        );
        self.sink.create_element(NewElement {
            name,
            namespace,
            attributes,
            stencil,
            intended_parent: parent,
            position,
            had_duplicate_attributes: self.state.had_duplicate_attributes,
        })
    }

    #[inline]
    fn insert(&mut self, node: NodeOf<S>, place: Place<NodeOf<S>>) {
        if self.sink.runs_script_when_inserted(node) {
            self.state.deferred = Some((node, place));
        } else {
            self.sink.insert_element(node, place);
        }
    }

    #[inline]
    fn insert_element(&mut self, tag: Start<S>) -> NodeOf<S> {
        let place = self.place_within_depth();
        let kind = tag.tag.kind() - Kind::MATH_TEXT;
        if tag.name.is_none()
            && !(kind.contains(Kind::FORM_ASSOCIATED) && self.state.form.is_some())
            && let Some(node) =
                self.append_quietly(ElementName::Known(tag.tag), Namespace::Html, place)
        {
            self.state.push(node, tag, Namespace::Html, kind);
            return node;
        }
        self.insert_element_at(tag, kind, place)
    }

    fn insert_element_at(
        &mut self,
        tag: Start<S>,
        kind: Kind,
        place: Place<NodeOf<S>>,
    ) -> NodeOf<S> {
        let place = self.pinned(place);
        let may_be_custom = tag.name.is_some();
        let name = tag
            .name
            .as_ref()
            .map_or(ElementName::Known(tag.tag), ElementName::Other);
        let node = self.create(name, Namespace::Html, place.parent);
        if let Some((form, serial)) = self.state.form
            && (may_be_custom || kind.contains(Kind::FORM_ASSOCIATED))
            && self.state.context.is_none()
            && !self.state.has_open(Tag::Template)
            && self.state.index_of(serial).is_none()
        {
            self.sink.associate_with_form(node, form, place.parent);
        }
        self.insert(node, place);
        self.state.push(node, tag, Namespace::Html, kind);
        node
    }

    /// With other attributes than those of the current token.
    fn with_attributes<R>(
        &mut self,
        attributes: Vec<Attribute<S::Dom>>,
        run: impl FnOnce(&mut Self) -> R,
    ) -> R {
        let of_token = (
            core::mem::replace(&mut self.state.attributes, attributes),
            self.state.stencil.take(),
        );
        let result = run(self);
        (self.state.attributes, self.state.stencil) = of_token;
        result
    }

    fn insert_implied(&mut self, tag: Tag) -> NodeOf<S> {
        self.with_attributes(Vec::new(), |it| it.insert_element(StartTag::known(tag)))
    }

    fn insert_void(&mut self, tag: Start<S>) {
        self.insert_element(tag);
        self.pop();
    }

    fn insert_text_only(&mut self, tag: Start<S>, content: Content) {
        self.insert_element(tag);
        self.state.content = content;
        self.state.original_mode = core::mem::replace(&mut self.state.mode, Mode::Text);
    }

    fn adjust_foreign_attributes(&mut self, namespace: Namespace) {
        for index in 0..self.state.attributes.len() {
            let held = self.state.attributes[index].name.clone();
            let name = S::Dom::chars_of_name(&held);
            let is_one_of = |prefix: &str, locals: &[&str]| {
                name.starts_with(prefix.as_bytes())
                    && locals
                        .iter()
                        .any(|it| name.skip(prefix.len()).is(it.as_bytes()))
            };
            let (local, in_namespace) = if name.at(0) != b'x'.into() || name.len() < 5 {
                (None, AttributeNamespace::None)
            } else if is_one_of(
                "xlink:",
                &[
                    "actuate", "arcrole", "href", "role", "show", "title", "type",
                ],
            ) {
                (Some(name.skip(6)), AttributeNamespace::XLink)
            } else if is_one_of("xml:", &["lang", "space"]) {
                (Some(name.skip(4)), AttributeNamespace::Xml)
            } else if name.is(b"xmlns:xlink") {
                (Some(name.skip(6)), AttributeNamespace::Xmlns)
            } else if name.is(b"xmlns") {
                (None, AttributeNamespace::Xmlns)
            } else {
                (None, AttributeNamespace::None)
            };
            let local = local.or_else(|| match namespace {
                Namespace::Svg => svg_attribute_name(name).map(Chars::from),
                _ => name.is(b"definitionurl").then(|| "definitionURL".into()),
            });
            if let Some(local) = local {
                self.state.attributes[index].name = self.sink.name(local, None);
            }
            self.state.attributes[index].namespace = in_namespace;
        }
    }

    fn insert_foreign(&mut self, tag: Start<S>, namespace: Namespace) {
        self.adjust_foreign_attributes(namespace);
        let lowercase = tag
            .name
            .as_ref()
            .map_or_else(|| tag.tag.name().into(), S::Dom::chars_of_name);
        let adjusted = if namespace == Namespace::Svg {
            svg_tag_name(lowercase)
        } else {
            None
        };
        let adjusted = adjusted.map(|it| self.sink.name(it.into(), None));
        let name = || {
            adjusted
                .as_ref()
                .or(tag.name.as_ref())
                .map_or(ElementName::Known(tag.tag), ElementName::Other)
        };
        let kind = kind_of(tag.tag, namespace, &self.state.attributes);
        let place = self.place_within_depth();
        let node = self
            .append_quietly(name(), namespace, place)
            .unwrap_or_else(|| {
                let place = self.pinned(place);
                let node = self.create(name(), namespace, place.parent);
                self.insert(node, place);
                node
            });
        let is_self_closing = tag.is_self_closing;
        self.state.push(node, tag, namespace, kind);
        if is_self_closing {
            self.pop_foreign(self.state.open.len() - 1);
        }
    }

    fn pop_foreign(&mut self, index: usize) {
        let entry = &self.state.open[index];
        if index + 1 == self.state.open.len()
            && entry.tag == Tag::Script
            && entry.namespace == Namespace::Svg
        {
            self.state.script = Some(entry.node);
        }
        self.pop_to_len(index);
    }

    #[inline]
    fn insert_text(&mut self, text: Chars<'_>) {
        if !text.is_empty() {
            self.insert_deferred();
            let place = self.place();
            if !(self.is_quiet(place) && self.sink.append_text_quietly(text, place.parent)) {
                let place = self.pinned(place);
                self.sink.insert_text(text, place);
            }
        }
    }

    // The list of active formatting elements

    #[inline]
    fn reconstruct_formatting(&mut self) {
        if !self.state.is_formatting_open() {
            self.reopen_formatting();
        }
    }

    #[cold]
    fn reopen_formatting(&mut self) {
        let closed = self
            .state
            .since_marker()
            .take_while(|it| self.state.index_of(it.1.serial).is_none())
            .count();
        for index in self.state.active.len() - closed..self.state.active.len() {
            let Some(entry) = &self.state.active[index] else {
                continue;
            };
            let (tag, attributes, serial) = (
                entry.tag,
                entry.all_attributes().into_owned(),
                self.state.next_serial,
            );
            self.with_attributes(attributes, |it| it.insert_element(StartTag::known(tag)));
            if let Some(entry) = &mut self.state.active[index] {
                entry.serial = serial;
            }
        }
    }

    fn push_formatting(&mut self, tag: Start<S>) {
        let state = &mut *self.state;
        let attributes = state.copy_attributes();
        let entry = Formatting {
            serial: state.next_serial,
            tag: tag.tag,
            attributes,
            stencil: state.stencil.clone(),
        };
        if state.active.len() >= 3 {
            let third = state
                .since_marker()
                .filter(|it| entry.is_like(it.1))
                .nth(2)
                .map(|it| it.0);
            if let Some(index) = third {
                state.active.remove(index);
            }
        }
        state.active.push(Some(entry));
        self.insert_element(tag);
    }

    /// An element like the one of an entry of the list.
    fn clone_formatting(&mut self, index: usize, parent: NodeOf<S>) -> Option<Open<S::Dom>> {
        let entry = self.state.active[index].as_ref()?;
        let (tag, attributes) = (entry.tag, entry.all_attributes().into_owned());
        let node = self.with_attributes(attributes, |it| {
            it.create(ElementName::Known(tag), Namespace::Html, parent)
        });
        let clone = self
            .state
            .entry(node, StartTag::known(tag), Namespace::Html, tag.kind());
        self.state.active[index].as_mut()?.serial = clone.serial;
        Some(clone)
    }

    #[inline]
    fn adoption_agency(&mut self, tag: Tag) {
        if let Some(current) = self.state.open.last()
            && current.is(tag)
        {
            let serial = current.serial;
            if matches!(self.state.active.last(), Some(Some(last)) if last.serial == serial) {
                let entry = self.state.active.pop().flatten();
                self.state.recycle(entry);
                self.pop();
                return;
            }
            if self.state.active_index_of(serial).is_none() {
                self.pop();
                return;
            }
        }
        for _ in 0..8 {
            if self.adopt_once(tag).is_none() {
                return;
            }
        }
    }

    /// The outer loop. `None` ends it.
    fn adopt_once(&mut self, tag: Tag) -> Option<()> {
        let Some((in_list, serial)) = self.state.find_formatting(tag) else {
            self.any_other_end_tag(tag, Chars::EMPTY);
            return None;
        };
        let Some(index) = self.state.index_of(serial) else {
            self.state.active.remove(in_list);
            return None;
        };
        if !self
            .state
            .has_in_scope(DEFAULT_SCOPE, |it| it.serial == serial)
        {
            return None;
        }
        let Some(distance) = self.state.open[index + 1..]
            .iter()
            .position(|it| it.has(Kind::SPECIAL))
        else {
            self.pop_to_len(index);
            self.state.active.remove(in_list);
            return None;
        };
        self.pin_open();
        let mut furthest_index = index + 1 + distance;
        let (element, furthest) = (
            self.state.open[index].node,
            self.state.open[furthest_index].node,
        );
        let (mut bookmark, mut last) = (in_list, furthest);
        for (inner, at) in (index + 1..furthest_index).rev().enumerate() {
            let mut entry = self.state.active_index_of(self.state.open[at].serial);
            if let Some(entry) = entry.take_if(|_| inner >= 3) {
                self.state.active.remove(entry);
                bookmark -= usize::from(entry < bookmark);
            }
            let Some(entry) = entry else {
                self.remove_open(at);
                furthest_index -= 1;
                continue;
            };
            let clone = self.clone_formatting(entry, element)?;
            let node = clone.node;
            let replaced = core::mem::replace(&mut self.state.open[at], clone);
            self.state.open_counts[replaced.html() as usize] -= 1;
            if last == furthest {
                bookmark = entry + 1;
            }
            self.sink.reparent(last, at_end_of(node));
            last = node;
        }
        let place = self.place_for(index - 1);
        self.sink.reparent(last, place);
        let old = self.state.active_index_of(serial)?;
        let replacement = self.clone_formatting(old, element)?;
        let node = replacement.node;
        let entry = self.state.active.remove(old);
        self.state
            .active
            .insert(bookmark - usize::from(old < bookmark), entry);
        self.state.open.insert(furthest_index + 1, replacement);
        self.sink.reparent_children(furthest, node);
        self.sink.reparent(node, at_end_of(furthest));
        self.remove_open(index);
        Some(())
    }

    #[inline]
    fn any_other_end_tag(&mut self, tag: Tag, name: Chars<'_>) {
        for (index, entry) in self.state.open.iter().enumerate().rev() {
            if entry.namespace == Namespace::Html && entry.is_named(tag, name) {
                return self.pop_to_len(index);
            }
            if entry.has(Kind::SPECIAL) {
                return;
            }
        }
    }

    // Tokens other than tags

    /// The "anything else" of the modes before the body.
    fn advance(&mut self) {
        self.state.mode = match self.state.mode {
            Mode::Initial => {
                self.set_quirks(Quirks::Full);
                Mode::BeforeHtml
            }
            Mode::BeforeHtml => return self.with_attributes(Vec::new(), Self::start_html),
            Mode::BeforeHead => {
                self.state.head = Some(self.insert_implied(Tag::Head));
                Mode::InHead
            }
            Mode::InHead => {
                self.pop();
                Mode::AfterHead
            }
            Mode::InHeadNoscript => {
                self.pop();
                Mode::InHead
            }
            _ => {
                self.insert_implied(Tag::Body);
                self.state.is_frameset_ok = true;
                Mode::InBody
            }
        };
    }

    fn set_quirks(&mut self, quirks: Quirks) {
        if !self.state.options.keeps_mode {
            self.sink.set_quirks(quirks);
        }
    }

    fn start_html(&mut self) {
        let document = self.sink.document();
        let node = self.create(ElementName::Known(Tag::Html), Namespace::Html, document);
        self.insert(node, at_end_of(document));
        self.state.push(
            node,
            StartTag::known(Tag::Html),
            Namespace::Html,
            Tag::Html.kind(),
        );
        self.state.mode = Mode::BeforeHead;
    }

    #[inline]
    fn before_markup(&mut self) {
        self.state.skips_newline = false;
        if !self.state.pending_table_text.is_empty() {
            let text = core::mem::take(&mut self.state.pending_table_text);
            self.table_text(text.chars());
        }
    }

    pub(super) fn doctype(
        &mut self,
        name: Chars<'_>,
        public_id: Chars<'_>,
        system_id: Chars<'_>,
        forces_quirks: bool,
    ) {
        self.before_markup();
        if self.state.mode != Mode::Initial {
            return;
        }
        self.sink.insert_doctype(name, public_id, system_id);
        self.set_quirks(if forces_quirks {
            Quirks::Full
        } else {
            quirks::of_doctype(name, public_id, system_id)
        });
        self.state.mode = Mode::BeforeHtml;
    }

    /// Or a processing instruction.
    pub(super) fn comment(&mut self, target: Option<Chars<'_>>, data: Chars<'_>) {
        self.before_markup();
        let place = match self.state.mode {
            Mode::Initial | Mode::BeforeHtml => at_end_of(self.sink.document()),
            _ if self.allows_cdata() => self.place_within_depth(),
            Mode::AfterAfterBody | Mode::AfterAfterFrameset if self.state.context.is_none() => {
                at_end_of(self.sink.document())
            }
            Mode::AfterBody => at_end_of(self.state.open[0].node),
            _ => self.place_within_depth(),
        };
        if target.is_none()
            && self.is_quiet(place)
            && self.sink.append_comment_quietly(data, place.parent)
        {
            return;
        }
        let place = self.pinned(place);
        match target {
            Some(target) => self.sink.insert_instruction(target, data, place),
            None => self.sink.insert_comment(data, place),
        }
    }

    /// It is not empty. Returns whether it was appended quietly.
    #[inline(always)]
    pub(super) fn text_between_tags(&mut self, text: Chars<'_>, is: TextIs) -> bool {
        if !(is.has_nul || self.state.skips_newline || self.state.is_frameset_ok)
            && let Some(parent) = self.quiet_parent()
            && self.state.is_formatting_open()
            && self.sink.append_text_quietly(text, parent)
        {
            return true;
        }
        self.text(text, is);
        false
    }

    pub(super) fn text(
        &mut self,
        mut text: Chars<'_>,
        TextIs {
            has_nul,
            may_continue,
        }: TextIs,
    ) {
        if core::mem::take(&mut self.state.skips_newline) && text.starts_with(b"\n") {
            text = text.skip(1);
        }
        if let Some(current) = self.state.adjusted_current()
            && current.namespace != Namespace::Html
            && !current.has(Kind::MATH_TEXT | Kind::HTML_INTEGRATION)
        {
            return self.text_in_foreign_content(text, has_nul);
        }
        match self.state.mode {
            Mode::InBody | Mode::InCell | Mode::InCaption | Mode::InTemplate => {
                self.text_in_body(text, has_nul)
            }
            Mode::Text => self.insert_text(text),
            _ => self.text_elsewhere(text, has_nul, may_continue),
        }
    }

    fn text_in_foreign_content(&mut self, text: Chars<'_>, has_nul: bool) {
        self.state.is_frameset_ok =
            self.state.is_frameset_ok && text.units().all(|it| it == 0 || is_space(it));
        if has_nul {
            self.insert_text(filtered(text, |it| Some(if it == 0 { 0xfffd } else { it })).chars());
        } else {
            self.insert_text(text);
        }
    }

    #[inline]
    fn text_in_body(&mut self, text: Chars<'_>, has_nul: bool) {
        if has_nul {
            return self.text_in_body(filtered(text, |it| (it != 0).then_some(it)).chars(), false);
        }
        if text.is_empty() {
            return;
        }
        self.reconstruct_formatting();
        self.insert_text(text);
        self.state.is_frameset_ok = self.state.is_frameset_ok && text.is_all_spaces();
    }

    fn fostering(&mut self, run: impl FnOnce(&mut Self)) {
        self.state.fosters = true;
        run(self);
        self.state.fosters = false;
    }

    fn table_text(&mut self, text: Chars<'_>) {
        if text.is_all_spaces() {
            self.insert_text(text);
        } else {
            self.fostering(|it| it.text_in_body(text, false));
        }
    }

    fn text_in_table(&mut self, text: Chars<'_>, has_nul: bool, may_continue: bool) {
        if !self.state.current_has(Kind::FOSTERS) && !self.state.current_is(Tag::Template) {
            self.fostering(|it| it.text_in_body(text, has_nul));
        } else if has_nul {
            self.state
                .pending_table_text
                .push(filtered(text, |it| (it != 0).then_some(it)).chars());
        } else if may_continue || !self.state.pending_table_text.is_empty() {
            self.state.pending_table_text.push(text);
        } else {
            self.table_text(text);
        }
    }

    fn text_elsewhere(&mut self, mut text: Chars<'_>, has_nul: bool, may_continue: bool) {
        while !text.is_empty() {
            let mode = self.state.mode;
            match mode {
                Mode::InBody => return self.text_in_body(text, has_nul),
                Mode::InTable | Mode::InTableBody | Mode::InRow => {
                    return self.text_in_table(text, has_nul, may_continue);
                }
                Mode::InFrameset | Mode::AfterFrameset => {
                    return self
                        .insert_text(filtered(text, |it| is_space(it).then_some(it)).chars());
                }
                Mode::AfterAfterFrameset => {
                    return self.text_in_body(
                        filtered(text, |it| is_space(it).then_some(it)).chars(),
                        false,
                    );
                }
                Mode::AfterBody | Mode::AfterAfterBody => {
                    if !text.is_all_spaces() {
                        self.state.mode = Mode::InBody;
                    }
                    return self.text_in_body(text, has_nul);
                }
                _ => {}
            }
            let spaces = text.leading_spaces();
            if mode >= Mode::InHead {
                self.insert_text(text.slice(0..spaces));
            }
            text = text.skip(spaces);
            if text.is_empty() {
                return;
            }
            if mode != Mode::InColumnGroup {
                self.advance();
            } else if self.state.current_is(Tag::Colgroup) {
                self.pop();
                self.state.mode = Mode::InTable;
            } else {
                text = text.skip(1);
            }
        }
    }

    pub(super) fn end_of_file(&mut self) -> Stop<NodeOf<S>> {
        if core::mem::replace(&mut self.state.has_finished, true) {
            return Stop::Finished;
        }
        self.before_markup();
        if self.state.mode == Mode::Text {
            if let Some(script) = self.state.open.last().filter(|it| it.is(Tag::Script)) {
                self.sink.mark_script_as_started(script.node);
            }
            self.pop();
            self.state.mode = self.state.original_mode;
        }
        while self.state.has_open(Tag::Template) {
            self.end_template();
        }
        while self.state.mode < Mode::InBody {
            self.advance();
        }
        self.insert_deferred();
        self.pop_to_len(0);
        Stop::Finished
    }

    // Start tags

    /// The most common ones, below an element that nothing has seen.
    #[inline(always)]
    pub(super) fn start_quietly(&mut self, tag: Tag) -> bool {
        let Some(parent) = self
            .quiet_parent()
            .filter(|_| self.state.open.len() <= MAX_DEPTH)
        else {
            return false;
        };
        let state = &*self.state;
        let start = STARTS[tag as usize];
        let is_simple = match start {
            Starts::Otherwise => false,
            Starts::Block => !state.has_open(Tag::P),
            Starts::Item => {
                !(state.is_frameset_ok || state.has_open(Tag::P))
                    && matches!(
                        state.open[state.open.len() - 1].tag,
                        Tag::Ul | Tag::Ol | Tag::Dl
                    )
            }
            Starts::Phrase => state.is_formatting_open(),
            Starts::Control => {
                !(state.is_frameset_ok
                    || state.form.is_some()
                    || state.has_open(tag)
                    || state.has_open(Tag::Select)
                    || state.context_is(Tag::Select))
                    && state.is_formatting_open()
            }
            Starts::Formatting => {
                state.is_formatting_open()
                    && state.active.len() < 3
                    && (tag != Tag::A || state.find_formatting(tag).is_none())
            }
        };
        if !is_simple {
            return false;
        }
        let attributes = if start == Starts::Formatting {
            self.state.copy_attributes()
        } else {
            Vec::new()
        };
        let state = &mut *self.state;
        let (name, stencil, position) = (
            ElementName::Known(tag),
            state.stencil.as_ref(),
            state.position,
        );
        let element = NewElement {
            name,
            namespace: Namespace::Html,
            attributes: &mut state.attributes,
            stencil,
            intended_parent: parent,
            position,
            had_duplicate_attributes: false,
        };
        let Some(node) = self.sink.append_element_quietly(element) else {
            return false;
        };
        state.skips_newline = false;
        if tag == Tag::Input {
            return true;
        }
        let serial = state.push(
            node,
            StartTag::known(tag),
            Namespace::Html,
            tag.kind() - Kind::MATH_TEXT,
        );
        if start == Starts::Formatting {
            state.active.push(Some(Formatting {
                serial,
                tag,
                attributes,
                stencil: state.stencil.take(),
            }));
        }
        true
    }

    /// The current node, if it is such an element and the rules for the body apply.
    #[inline(always)]
    fn quiet_parent(&self) -> Option<NodeOf<S>> {
        let current = self.state.open.last()?;
        (matches!(
            self.state.mode,
            Mode::InBody | Mode::InCell | Mode::InCaption
        ) && !self.sink.is_pinned(current.node)
            && current.namespace == Namespace::Html
            && self.state.deferred.is_none())
        .then_some(current.node)
    }

    #[inline]
    pub(super) fn start_tag(&mut self, tag: Start<S>) {
        self.before_markup();
        let Some(current) = self
            .state
            .adjusted_current()
            .filter(|it| it.namespace != Namespace::Html)
        else {
            return self.start(tag);
        };
        if current.has(Kind::HTML_INTEGRATION)
            || (current.has(Kind::MATH_TEXT) && !matches!(tag.tag, Tag::Mglyph | Tag::Malignmark))
            || (current.namespace == Namespace::MathMl
                && current.tag == Tag::AnnotationXml
                && tag.tag == Tag::Svg)
        {
            return self.start(tag);
        }
        let namespace = current.namespace;
        if tag.tag.is(Kind::LEAVES_FOREIGN)
            || (tag.tag == Tag::Font
                && ["color", "face", "size"]
                    .iter()
                    .any(|it| self.state.attribute(it).is_some()))
        {
            self.leave_foreign_content();
            return self.start(tag);
        }
        self.insert_foreign(tag, namespace);
    }

    fn leave_foreign_content(&mut self) {
        let stays = Kind::MATH_TEXT | Kind::HTML_INTEGRATION;
        while self
            .state
            .open
            .last()
            .is_some_and(|it| it.namespace != Namespace::Html && !it.has(stays))
        {
            self.pop();
        }
    }

    #[inline]
    fn start(&mut self, tag: Start<S>) {
        match self.state.mode {
            Mode::InBody => self.start_in_body(tag),
            Mode::InCell | Mode::InCaption if !tag.tag.is(Kind::TABLE_PART) => {
                self.start_in_body(tag)
            }
            _ => self.start_elsewhere(tag),
        }
    }

    fn start_elsewhere(&mut self, tag: Start<S>) {
        let (mode, name) = (self.state.mode, tag.tag);
        if name == Tag::Html && mode > Mode::BeforeHtml {
            return self.start_in_body(tag);
        }
        let reprocesses = match (mode, name) {
            (Mode::BeforeHtml, Tag::Html) => return self.start_html(),
            (Mode::BeforeHead, Tag::Head) => {
                self.state.head = Some(self.insert_element(tag));
                self.state.mode = Mode::InHead;
                return;
            }
            (Mode::InHead | Mode::InHeadNoscript | Mode::AfterHead, Tag::Head) => false,
            (Mode::InHead, _) if name.is(Kind::HEAD) || name == Tag::Noscript => {
                return self.start_in_head(tag);
            }
            (Mode::InHeadNoscript, Tag::Noscript) => false,
            (
                Mode::InHeadNoscript,
                Tag::Basefont | Tag::Bgsound | Tag::Link | Tag::Meta | Tag::Noframes | Tag::Style,
            ) => return self.start_in_head(tag),
            (Mode::AfterHead, Tag::Body | Tag::Frameset) => {
                self.insert_element(tag);
                self.state.is_frameset_ok = false;
                self.state.mode = if name == Tag::Body {
                    Mode::InBody
                } else {
                    Mode::InFrameset
                };
                return;
            }
            (Mode::AfterHead, _) if name.is(Kind::HEAD) => {
                let Some(head) = self.state.head else { return };
                let index = self.state.open.len();
                self.state.push(
                    head,
                    StartTag::known(Tag::Head),
                    Namespace::Html,
                    Tag::Head.kind(),
                );
                self.start_in_head(tag);
                return self.remove_open(index);
            }
            (Mode::InTable, _) => return self.start_in_table(tag),
            (Mode::InCaption, _) => self.close_caption(),
            (Mode::InColumnGroup, Tag::Col) => return self.insert_void(tag),
            (Mode::InColumnGroup, Tag::Template) => return self.start_template(tag),
            (Mode::InColumnGroup, _) => self.close_column_group(),
            (Mode::InTableBody, Tag::Tr) => {
                self.clear_back_to(|it| it.is(Kind::ROW_GROUP));
                self.insert_element(tag);
                self.state.mode = Mode::InRow;
                return;
            }
            (Mode::InTableBody, Tag::Td | Tag::Th) => {
                self.clear_back_to(|it| it.is(Kind::ROW_GROUP));
                self.insert_implied(Tag::Tr);
                self.state.mode = Mode::InRow;
                true
            }
            (Mode::InRow, Tag::Td | Tag::Th) => {
                self.clear_back_to(|it| it == Tag::Tr);
                self.insert_element(tag);
                self.state.active.push(None);
                self.state.mode = Mode::InCell;
                return;
            }
            (Mode::InTableBody | Mode::InRow, _) if !name.is(Kind::TABLE_PART) => {
                return self.start_in_table(tag);
            }
            (Mode::InTableBody, _) => self.close_row_group(),
            (Mode::InRow, _) => self.close_row(),
            (Mode::InCell, _) => self.close_cell(),
            (Mode::InTemplate, _) if name.is(Kind::HEAD) => return self.start_in_head(tag),
            (Mode::InTemplate, _) => {
                self.state.mode = match name {
                    Tag::Col => Mode::InColumnGroup,
                    Tag::Tr => Mode::InTableBody,
                    Tag::Td | Tag::Th => Mode::InRow,
                    _ if name.is(Kind::TABLE_PART) => Mode::InTable,
                    _ => Mode::InBody,
                };
                self.state.template_modes.pop();
                self.state.template_modes.push(self.state.mode);
                true
            }
            (Mode::InFrameset, Tag::Frameset) => {
                self.insert_element(tag);
                return;
            }
            (Mode::InFrameset, Tag::Frame) => return self.insert_void(tag),
            (Mode::InFrameset | Mode::AfterFrameset | Mode::AfterAfterFrameset, Tag::Noframes) => {
                return self.start_in_head(tag);
            }
            (Mode::InFrameset | Mode::AfterFrameset | Mode::AfterAfterFrameset, _) => false,
            (Mode::AfterBody | Mode::AfterAfterBody, _) => {
                self.state.mode = Mode::InBody;
                true
            }
            _ => {
                self.advance();
                true
            }
        };
        if reprocesses {
            self.start(tag);
        }
    }

    fn start_in_head(&mut self, tag: Start<S>) {
        let name = tag.tag;
        match name {
            Tag::Title => self.insert_text_only(tag, Content::Rcdata(name)),
            Tag::Noscript if !self.state.options.scripting => {
                self.insert_element(tag);
                self.state.mode = Mode::InHeadNoscript;
            }
            Tag::Noscript | Tag::Noframes | Tag::Style => {
                self.insert_text_only(tag, Content::Rawtext(name))
            }
            Tag::Script => self.insert_text_only(tag, Content::Script),
            Tag::Template => self.start_template(tag),
            _ => self.insert_void(tag),
        }
    }

    fn start_template(&mut self, tag: Start<S>) {
        self.pin_open();
        self.state.active.push(None);
        self.state.is_frameset_ok = false;
        self.state.mode = Mode::InTemplate;
        self.state.template_modes.push(Mode::InTemplate);
        if let Some(template) = self.declare_shadow_root().or_else(|| self.start_patch()) {
            self.state
                .push(template, tag, Namespace::Html, Tag::Template.kind());
        } else {
            self.insert_element(tag);
        }
    }

    fn declare_shadow_root(&mut self) -> Option<NodeOf<S>> {
        let mode = self.state.attribute("shadowrootmode")?;
        let is_valid = mode.is_ignoring_case(b"open") || mode.is_ignoring_case(b"closed");
        let host = self.state.adjusted_current()?.node;
        if !is_valid
            || !self.state.options.allows_declarative_shadow_roots
            || self.state.open.len() == 1
        {
            return None;
        }
        self.insert_deferred();
        let template = NewElement {
            name: ElementName::Known(Tag::Template),
            namespace: Namespace::Html,
            attributes: &mut self.state.attributes,
            stencil: None,
            intended_parent: host,
            position: self.state.position,
            had_duplicate_attributes: false,
        };
        self.sink.attach_shadow(host, template)
    }

    fn start_patch(&mut self) -> Option<NodeOf<S>> {
        let name = Text::from(self.state.attribute("for").filter(|it| !it.is_empty())?);
        if !self.state.options.allows_patches {
            return None;
        }
        self.insert_deferred();
        let parent = self.place().parent;
        let is_body = self.state.context.is_none() && self.state.current_is(Tag::Body);
        let scope = if is_body {
            self.sink.parent(parent).unwrap_or(parent)
        } else {
            parent
        };
        let patch = self.sink.start_patch(scope, name.chars())?;
        self.state.patches.push((self.state.next_serial, patch));
        Some(self.create(ElementName::Known(Tag::Template), Namespace::Html, parent))
    }

    fn end_template(&mut self) {
        let Some(index) = self.state.last_open(Tag::Template) else {
            return;
        };
        let serial = self.state.open[index].serial;
        self.pop_to_len(index);
        self.pin_open();
        if let Some(&(_, patch)) = self.state.patches.last().filter(|it| it.0 == serial) {
            self.sink.remove(patch.start);
            if let Some(end) = patch.end {
                self.sink.remove(end);
            }
            self.state.patches.pop();
        }
        self.state.clear_formatting();
        self.state.template_modes.pop();
        self.state.reset_mode();
    }

    fn close_list_item(&mut self, closes: impl Fn(Tag) -> bool) {
        for (index, entry) in self.state.open.iter().enumerate().rev() {
            if closes(entry.html()) {
                return self.pop_to_len(index);
            }
            if entry.has(Kind::SPECIAL) && !matches!(entry.html(), Tag::Address | Tag::Div | Tag::P)
            {
                return;
            }
        }
    }

    fn start_in_body(&mut self, mut tag: Start<S>) {
        use Tag::*;
        let name = tag.tag;
        match name {
            Address | Article | Aside | Blockquote | Center | Details | Dialog | Dir | Div | Dl
            | Fieldset | Figcaption | Figure | Footer | Header | Hgroup | Main | Menu | Nav
            | Ol | P | Search | Section | Summary | Ul => {
                self.close_p();
                self.insert_element(tag);
            }
            A => {
                if let Some((_, serial)) = self.state.find_formatting(A) {
                    self.adoption_agency(A);
                    if let Some(index) = self.state.active_index_of(serial) {
                        self.state.active.remove(index);
                    }
                    if let Some(index) = self.state.index_of(serial) {
                        self.remove_open(index);
                    }
                }
                self.reconstruct_formatting();
                self.push_formatting(tag);
            }
            B | Big | Code | Em | Font | I | S | Small | Strike | Strong | Tt | U => {
                self.reconstruct_formatting();
                self.push_formatting(tag);
            }
            Nobr => {
                self.reconstruct_formatting();
                if self.state.in_scope(Nobr, DEFAULT_SCOPE) {
                    self.adoption_agency(Nobr);
                    self.reconstruct_formatting();
                }
                self.push_formatting(tag);
            }
            Base | Basefont | Bgsound | Link | Meta | Noframes | Script | Style | Template
            | Title => {
                self.start_in_head(tag);
            }
            H1 | H2 | H3 | H4 | H5 | H6 => {
                self.close_p();
                if self.state.current_has(Kind::HEADING) {
                    self.pop();
                }
                self.insert_element(tag);
            }
            Caption | Col | Colgroup | Frame | Head | Tbody | Td | Tfoot | Th | Thead | Tr => {}
            Html => {
                if !self.state.has_open(Template) {
                    self.pin_open();
                    self.sink.add_missing_attributes(
                        self.state.open[0].node,
                        &mut self.state.attributes,
                    );
                }
            }
            Body => {
                if let Some(body) = self
                    .state
                    .open
                    .get(1)
                    .filter(|it| it.is(Body))
                    .map(|it| it.node)
                    && !self.state.has_open(Template)
                {
                    self.state.is_frameset_ok = false;
                    self.pin_open();
                    self.sink
                        .add_missing_attributes(body, &mut self.state.attributes);
                }
            }
            Frameset => {
                if let Some(body) = self
                    .state
                    .open
                    .get(1)
                    .filter(|it| it.is(Body))
                    .map(|it| it.node)
                    && self.state.is_frameset_ok
                {
                    self.pin_open();
                    self.insert_deferred();
                    self.sink.remove(body);
                    self.pop_to_len(1);
                    self.insert_element(tag);
                    self.state.mode = Mode::InFrameset;
                }
            }
            Pre | Listing => {
                self.close_p();
                self.insert_element(tag);
                self.state.skips_newline = true;
                self.state.is_frameset_ok = false;
            }
            Form => {
                let is_in_template = self.state.is_in_template();
                if self.state.form.is_none() || is_in_template {
                    self.close_p();
                    let serial = self.state.next_serial;
                    let form = self.insert_element(tag);
                    if !is_in_template {
                        self.state.form = Some((form, serial));
                    }
                }
            }
            Li | Dd | Dt => {
                self.state.is_frameset_ok = false;
                if name == Li {
                    if self.state.has_open(Li) {
                        self.close_list_item(|it| it == Li);
                    }
                } else if self.state.has_open(Dd) || self.state.has_open(Dt) {
                    self.close_list_item(|it| matches!(it, Dd | Dt));
                }
                self.close_p();
                self.insert_element(tag);
            }
            Plaintext => {
                self.close_p();
                self.insert_element(tag);
                self.state.content = Content::Plaintext;
            }
            Button => {
                if self.state.in_scope(Button, DEFAULT_SCOPE) {
                    self.pop_until(Button);
                }
                self.reconstruct_formatting();
                self.insert_element(tag);
                self.state.is_frameset_ok = false;
            }
            Applet | Marquee | Object => {
                self.reconstruct_formatting();
                self.insert_element(tag);
                self.state.active.push(None);
                self.state.is_frameset_ok = false;
            }
            Table => {
                if !self.sink.is_in_quirks_mode() {
                    self.close_p();
                }
                self.insert_element(tag);
                self.state.is_frameset_ok = false;
                self.state.mode = Mode::InTable;
            }
            Input => {
                if self.state.context_is(Select) {
                    return;
                }
                if self.state.in_scope(Select, DEFAULT_SCOPE) {
                    self.pop_until(Select);
                }
                self.state.is_frameset_ok =
                    self.state.is_frameset_ok && self.state.is_hidden_input();
                self.reconstruct_formatting();
                self.insert_void(tag);
            }
            Area | Br | Embed | Img | Image | Keygen | Wbr => {
                if name == Image {
                    tag.tag = Img;
                }
                self.reconstruct_formatting();
                self.insert_void(tag);
                self.state.is_frameset_ok = false;
            }
            Param | Source | Track => self.insert_void(tag),
            Hr => {
                self.close_p();
                if self.state.in_scope(Select, DEFAULT_SCOPE) {
                    self.generate_implied_end_tags(Other);
                }
                self.insert_void(tag);
                self.state.is_frameset_ok = false;
            }
            Textarea => {
                self.insert_text_only(tag, Content::Rcdata(name));
                self.state.skips_newline = true;
                self.state.is_frameset_ok = false;
            }
            Xmp => {
                self.close_p();
                self.reconstruct_formatting();
                self.state.is_frameset_ok = false;
                self.insert_text_only(tag, Content::Rawtext(name));
            }
            Iframe => {
                self.state.is_frameset_ok = false;
                self.insert_text_only(tag, Content::Rawtext(name));
            }
            Noembed => self.insert_text_only(tag, Content::Rawtext(name)),
            Noscript if self.state.options.scripting => {
                self.insert_text_only(tag, Content::Rawtext(name))
            }
            Select => {
                if self.state.context_is(Select) {
                    return;
                }
                if self.state.in_scope(Select, DEFAULT_SCOPE) {
                    return self.pop_until(Select);
                }
                self.reconstruct_formatting();
                self.insert_element(tag);
                self.state.is_frameset_ok = false;
            }
            Option | Optgroup => {
                if self.state.in_scope(Select, DEFAULT_SCOPE) {
                    self.generate_implied_end_tags(if name == Option { Optgroup } else { Other });
                } else if self.state.current_is(Option) {
                    self.pop();
                }
                self.reconstruct_formatting();
                self.insert_element(tag);
            }
            Rb | Rtc | Rp | Rt => {
                if self.state.in_scope(Ruby, DEFAULT_SCOPE) {
                    self.generate_implied_end_tags(if matches!(name, Rp | Rt) {
                        Rtc
                    } else {
                        Other
                    });
                }
                self.insert_element(tag);
            }
            Math | Svg => {
                self.reconstruct_formatting();
                self.insert_foreign(
                    tag,
                    if name == Svg {
                        Namespace::Svg
                    } else {
                        Namespace::MathMl
                    },
                );
            }
            _ => {
                self.reconstruct_formatting();
                self.insert_element(tag);
            }
        }
    }

    fn start_in_table(&mut self, tag: Start<S>) {
        let name = tag.tag;
        if name.is(Kind::TABLE_PART) {
            self.clear_back_to(|it| it == Tag::Table);
        }
        match name {
            Tag::Caption => {
                self.state.active.push(None);
                self.insert_element(tag);
                self.state.mode = Mode::InCaption;
            }
            Tag::Colgroup | Tag::Tbody | Tag::Tfoot | Tag::Thead => {
                self.insert_element(tag);
                self.state.mode = if name == Tag::Colgroup {
                    Mode::InColumnGroup
                } else {
                    Mode::InTableBody
                };
            }
            Tag::Col | Tag::Td | Tag::Th | Tag::Tr => {
                self.insert_implied(if name == Tag::Col {
                    Tag::Colgroup
                } else {
                    Tag::Tbody
                });
                self.state.mode = if name == Tag::Col {
                    Mode::InColumnGroup
                } else {
                    Mode::InTableBody
                };
                self.start(tag);
            }
            Tag::Table => {
                if self.close_table() {
                    self.start(tag);
                }
            }
            Tag::Style | Tag::Script | Tag::Template => self.start_in_head(tag),
            Tag::Input if self.state.is_hidden_input() => self.insert_void(tag),
            Tag::Form => {
                let is_in_template = self.state.is_in_template();
                if self.state.form.is_none() || is_in_template {
                    let serial = self.state.next_serial;
                    let form = self.insert_element(tag);
                    if !is_in_template {
                        self.state.form = Some((form, serial));
                    }
                    self.pop();
                }
            }
            _ => self.fostering(|it| it.start_in_body(tag)),
        }
    }

    // Each returns whether there was something to close.

    fn close_table(&mut self) -> bool {
        let is_open = self.state.in_scope(Tag::Table, TABLE_SCOPE);
        if is_open {
            self.pop_until(Tag::Table);
            self.state.reset_mode();
        }
        is_open
    }

    fn close_caption(&mut self) -> bool {
        let is_open = self.state.in_scope(Tag::Caption, TABLE_SCOPE);
        if is_open {
            self.pop_until(Tag::Caption);
            self.state.clear_formatting();
            self.state.mode = Mode::InTable;
        }
        is_open
    }

    fn close_column_group(&mut self) -> bool {
        let is_open = self.state.current_is(Tag::Colgroup);
        if is_open {
            self.pop();
            self.state.mode = Mode::InTable;
        }
        is_open
    }

    fn close_row_group(&mut self) -> bool {
        let is_open = self
            .state
            .has_in_scope(TABLE_SCOPE, |it| it.has(Kind::ROW_GROUP));
        if is_open {
            self.pop_until_kind(Kind::ROW_GROUP);
            self.state.mode = Mode::InTable;
        }
        is_open
    }

    fn close_row(&mut self) -> bool {
        let is_open = self.state.in_scope(Tag::Tr, TABLE_SCOPE);
        if is_open {
            self.pop_until(Tag::Tr);
            self.state.mode = Mode::InTableBody;
        }
        is_open
    }

    fn close_cell(&mut self) -> bool {
        let is_cell = |it: &Open<S::Dom>| matches!(it.html(), Tag::Td | Tag::Th);
        let is_open = self.state.has_in_scope(TABLE_SCOPE, is_cell);
        if is_open {
            while self.pop().is_some_and(|it| !is_cell(&it)) {}
            self.state.clear_formatting();
            self.state.mode = Mode::InRow;
        }
        is_open
    }

    // End tags

    /// If the eight characters after `</` start with a tag that only closes the current node. Returns how many it has.
    #[inline(always)]
    pub(super) fn end_current(&mut self, word: u64) -> Option<usize> {
        let state = &mut *self.state;
        let current = state.open.last()?;
        let end = SIMPLE_ENDS[current.tag as usize];
        let unused = end.leading_zeros() & !7;
        if (word ^ end) << (unused & 63) != 0
            || end == 0
            || current.namespace != Namespace::Html
            || !matches!(state.mode, Mode::InBody | Mode::InCell | Mode::InCaption)
        {
            return None;
        }
        if current.has(Kind::FORMATTING) {
            if !matches!(state.active.last(), Some(Some(last)) if last.serial == current.serial) {
                return None;
            }
            let entry = state.active.pop().flatten();
            state.recycle(entry);
        }
        state.skips_newline = false;
        if let Some(entry) = state.open.pop() {
            state.open_counts[entry.tag as usize] -= 1;
        }
        Some(8 - unused as usize / 8)
    }

    #[inline]
    pub(super) fn end_tag(&mut self, tag: Tag, name: Chars<'_>) {
        self.before_markup();
        if !self.allows_cdata() {
            return self.end(tag, name);
        }
        if matches!(tag, Tag::Br | Tag::P) {
            self.leave_foreign_content();
            return self.end(tag, name);
        }
        for index in (1..self.state.open.len()).rev() {
            if self.state.open[index].is_named(tag, name) {
                return self.pop_foreign(index);
            }
            if self.state.open[index - 1].namespace == Namespace::Html {
                return self.end(tag, name);
            }
        }
    }

    #[inline]
    fn end(&mut self, tag: Tag, name: Chars<'_>) {
        if self.state.mode == Mode::InBody {
            self.end_in_body(tag, name)
        } else {
            self.end_elsewhere(tag, name)
        }
    }

    fn end_elsewhere(&mut self, tag: Tag, name: Chars<'_>) {
        let mode = self.state.mode;
        let is_outer = matches!(tag, Tag::Body | Tag::Html);
        let in_table_scope = |it: &Self| it.state.in_scope(tag, TABLE_SCOPE);
        let reprocesses = match (mode, tag) {
            (Mode::Text, _) => {
                let entry = self.pop();
                self.state.script = entry.filter(|it| it.is(Tag::Script)).map(|it| it.node);
                self.state.mode = self.state.original_mode;
                false
            }
            (_, Tag::Template)
                if (Mode::InHead..=Mode::InTemplate).contains(&mode)
                    && mode != Mode::InHeadNoscript =>
            {
                return self.end_template();
            }
            (Mode::InHead, Tag::Head) | (Mode::InHeadNoscript, Tag::Noscript) => {
                return self.advance();
            }
            (Mode::Initial, _) | (Mode::BeforeHtml | Mode::BeforeHead, Tag::Head) => {
                self.advance();
                true
            }
            _ if mode < Mode::InBody => {
                let advances = tag == Tag::Br || (is_outer && mode != Mode::InHeadNoscript);
                if advances {
                    self.advance();
                }
                advances
            }
            (Mode::InCaption, Tag::Caption | Tag::Table) => {
                self.close_caption() && tag == Tag::Table
            }
            (Mode::InColumnGroup, Tag::Col) => false,
            (Mode::InColumnGroup, _) => self.close_column_group() && tag != Tag::Colgroup,
            (Mode::InTableBody, Tag::Table) => self.close_row_group(),
            (Mode::InTableBody, _) if tag.is(Kind::ROW_GROUP) => {
                in_table_scope(self) && !self.close_row_group()
            }
            (Mode::InRow, Tag::Tr | Tag::Table) => self.close_row() && tag == Tag::Table,
            (Mode::InRow, _) if tag.is(Kind::ROW_GROUP) => in_table_scope(self) && self.close_row(),
            (Mode::InCell, Tag::Td | Tag::Th) => in_table_scope(self) && !self.close_cell(),
            (Mode::InCell, _) if tag.is(Kind::FOSTERS) => in_table_scope(self) && self.close_cell(),
            (
                Mode::InTable | Mode::InTableBody | Mode::InRow | Mode::InCaption | Mode::InCell,
                _,
            ) if is_outer || tag.is(Kind::TABLE_PART) => false,
            (Mode::InCaption | Mode::InCell, _) => return self.end_in_body(tag, name),
            (Mode::InTable, Tag::Table) => {
                self.close_table();
                false
            }
            (Mode::InTable | Mode::InTableBody | Mode::InRow, _) => {
                return self.fostering(|it| it.end_in_body(tag, name));
            }
            (Mode::InFrameset, Tag::Frameset) if self.state.open.len() > 1 => {
                self.pop();
                if self.state.context.is_none() && !self.state.current_is(Tag::Frameset) {
                    self.state.mode = Mode::AfterFrameset;
                }
                false
            }
            (Mode::AfterFrameset, Tag::Html) => {
                self.state.mode = Mode::AfterAfterFrameset;
                false
            }
            (Mode::AfterBody, Tag::Html) => {
                if self.state.context.is_none() {
                    self.state.mode = Mode::AfterAfterBody;
                }
                false
            }
            (Mode::AfterBody | Mode::AfterAfterBody, _) => {
                self.state.mode = Mode::InBody;
                true
            }
            _ => false,
        };
        if reprocesses {
            self.end(tag, name);
        }
    }

    fn close_in_scope(&mut self, tag: Tag, scope: Kind) -> bool {
        let is_open = self.state.current_is(tag) || self.state.in_scope(tag, scope);
        if is_open {
            self.pop_until(tag);
        }
        is_open
    }

    fn end_in_body(&mut self, tag: Tag, name: Chars<'_>) {
        use Tag::*;
        match tag {
            Address | Article | Aside | Blockquote | Button | Center | Dd | Details | Dialog
            | Dir | Div | Dl | Dt | Fieldset | Figcaption | Figure | Footer | Header | Hgroup
            | Listing | Main | Menu | Nav | Ol | Pre | Search | Section | Select | Summary | Ul => {
                self.close_in_scope(tag, DEFAULT_SCOPE);
            }
            A | B | Big | Code | Em | Font | I | Nobr | S | Small | Strike | Strong | Tt | U => {
                self.adoption_agency(tag);
            }
            H1 | H2 | H3 | H4 | H5 | H6 => {
                if self
                    .state
                    .has_in_scope(DEFAULT_SCOPE, |it| it.has(Kind::HEADING))
                {
                    self.pop_until_kind(Kind::HEADING);
                }
            }
            Template => self.end_template(),
            Body | Html => {
                if self.state.in_scope(Body, DEFAULT_SCOPE) {
                    self.state.mode = Mode::AfterBody;
                    if tag == Html {
                        self.end(tag, name);
                    }
                }
            }
            Form if self.state.is_in_template() => {
                self.close_in_scope(tag, DEFAULT_SCOPE);
            }
            Form => {
                if let Some((_, serial)) = self.state.form.take()
                    && self
                        .state
                        .has_in_scope(DEFAULT_SCOPE, |it| it.serial == serial)
                {
                    self.generate_implied_end_tags(Other);
                    if let Some(index) = self.state.index_of(serial) {
                        self.remove_open(index);
                    }
                }
            }
            P => {
                if !self.close_in_scope(P, BUTTON_SCOPE) {
                    self.insert_implied(P);
                    self.pop();
                }
            }
            Li => {
                self.close_in_scope(tag, LIST_ITEM_SCOPE);
            }
            Applet | Marquee | Object => {
                if self.close_in_scope(tag, DEFAULT_SCOPE) {
                    self.state.clear_formatting();
                }
            }
            Br => {
                self.state.forget_attributes();
                self.start_in_body(StartTag::known(Br));
            }
            _ => self.any_other_end_tag(tag, name),
        }
    }
}

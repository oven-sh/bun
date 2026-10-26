//! A Svelte component as svelte-eslint-parser 1.9 presents it (`ast/html.d.ts`): its nodes, each with its kind, its
//! position in the component, its parent, its children in visitor-key order (`visitor-keys.js`), and the code inside
//! them. `svelte/*` rules read it ([`Rule::svelte_node`](crate::rule::Rule::svelte_node)) and report in component
//! positions ([`Domain::Original`](crate::span::Domain::Original)).
//!
//! The driver builds it from the formatter's Svelte parser tree, once per linted text: a fix produces a component with
//! a new one. Nothing in it belongs to the program the component is lowered to. Its code is linked to a program's nodes
//! through that program's file ([`File::svelte_code`]), so each program has its own links: the one rules see, and the
//! type-checked one.
//!
//! | svelte-eslint-parser | here |
//! | --- | --- |
//! | `node.type` | [`SvelteNode::tag`] |
//! | `node.kind` (`html`, `raw`, `await-then`, `Binding`, ..) | [`SvelteNode::kind`], a [`SvelteKind`] |
//! | `selfClosing`, `shorthand`, `boolean`, `elseif`, `awaitThen`, `awaitCatch`, `context="module"` |
//! [`SvelteNode::has`] |
//! | `node.parent` | [`SvelteNode::parent`]. For a node's code, [`File::svelte_owner`] |
//! | a child: `startTag`, `children`, `else`, .. | [`SvelteNode::child`], [`SvelteNode::nodes`], by [`Role`] |
//! | an expression, a pattern, a declaration | [`Code`], [`SvelteNode::code`]. In the program: [`Code::node`],
//! [`Code::roots`] |
//! | `{#if`, `{:else}`, `{/if}` and the like, which aren't nodes | [`SvelteNode::part`] |
//! | a block's `getScope(node)` | [`File::svelte_scope_owner`], [`File::svelte_binding`] |
//! | eslint-plugin-svelte's `getShared(filename)` | [`File::svelte_shared`] |
//! | eslint-plugin-svelte's `getSvelteContext(context)`, for `meta.conditions` | [`File::svelte_context`],
//! [`File::svelte_runes`] |
//! | `SvelteReactiveStatement` | a `Labeled` with [`Stmt::is_svelte_reactive`](crate::ast::Stmt::is_svelte_reactive) |
//! | svelte-eslint-parser's `scopeManager`: its variables, definitions and references | [`File::svelte_variables`],
//! [`variables`] |
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

mod html;
pub mod shared;
pub mod variables;

pub use html::decode_character_references;

use crate::ast::{File, Node, Packed, identifiers};
use crate::semantic::{Scope, Symbol};
use crate::source::Places;
use crate::span::{Domain, Span, Spanned};

/// svelte-eslint-parser's `globalsForSvelte`: what it declares in every component's global scope.
pub const SVELTE_GLOBALS: [&str; 3] = ["$$slots", "$$props", "$$restProps"];

/// svelte-eslint-parser's `globalsForRunes`, in its order: what it declares in the global scope of a component whose
/// Svelte has runes.
pub const RUNES: [&str; 7] = [
    "$state",
    "$derived",
    "$effect",
    "$props",
    "$bindable",
    "$inspect",
    "$host",
];

/// svelte-eslint-parser's node kinds that a component has outside its code: `type` without `Svelte`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum SvelteTag {
    Program,
    ScriptElement,
    StyleElement,
    Element,
    StartTag,
    EndTag,
    Name,
    MemberExpressionName,
    Literal,
    MustacheTag,
    DebugTag,
    ConstTag,
    DeclarationTag,
    RenderTag,
    IfBlock,
    ElseBlock,
    EachBlock,
    AwaitBlock,
    AwaitPendingBlock,
    AwaitThenBlock,
    AwaitCatchBlock,
    KeyBlock,
    SnippetBlock,
    Attribute,
    ShorthandAttribute,
    SpreadAttribute,
    AttachTag,
    Directive,
    StyleDirective,
    SpecialDirective,
    GenericsDirective,
    DirectiveKey,
    SpecialDirectiveKey,
    Text,
    HtmlComment,
    /// The two functions of `bind:value={get, set}`.
    FunctionBindingsExpression,
}

impl SvelteTag {
    pub const COUNT: usize = SvelteTag::FunctionBindingsExpression as usize + 1;

    /// Indexed by their numbers.
    pub const ALL: [SvelteTag; SvelteTag::COUNT] = {
        use SvelteTag::*;
        [
            Program,
            ScriptElement,
            StyleElement,
            Element,
            StartTag,
            EndTag,
            Name,
            MemberExpressionName,
            Literal,
            MustacheTag,
            DebugTag,
            ConstTag,
            DeclarationTag,
            RenderTag,
            IfBlock,
            ElseBlock,
            EachBlock,
            AwaitBlock,
            AwaitPendingBlock,
            AwaitThenBlock,
            AwaitCatchBlock,
            KeyBlock,
            SnippetBlock,
            Attribute,
            ShorthandAttribute,
            SpreadAttribute,
            AttachTag,
            Directive,
            StyleDirective,
            SpecialDirective,
            GenericsDirective,
            DirectiveKey,
            SpecialDirectiveKey,
            Text,
            HtmlComment,
            FunctionBindingsExpression,
        ]
    };

    /// svelte-eslint-parser's `node.type`.
    pub const fn type_name(self) -> &'static str {
        self.names().0
    }

    /// The key of a listener ESLint calls when leaving such a node.
    pub(crate) const fn exit_name(self) -> &'static str {
        self.names().1
    }

    const fn names(self) -> (&'static str, &'static str) {
        macro_rules! names {
            ($($tag:ident $name:literal,)*) => {
                match self {
                    $(SvelteTag::$tag => ($name, concat!($name, ":exit")),)*
                }
            };
        }
        names! {
            Program "Program",
            ScriptElement "SvelteScriptElement",
            StyleElement "SvelteStyleElement",
            Element "SvelteElement",
            StartTag "SvelteStartTag",
            EndTag "SvelteEndTag",
            Name "SvelteName",
            MemberExpressionName "SvelteMemberExpressionName",
            Literal "SvelteLiteral",
            MustacheTag "SvelteMustacheTag",
            DebugTag "SvelteDebugTag",
            ConstTag "SvelteConstTag",
            DeclarationTag "SvelteDeclarationTag",
            RenderTag "SvelteRenderTag",
            IfBlock "SvelteIfBlock",
            ElseBlock "SvelteElseBlock",
            EachBlock "SvelteEachBlock",
            AwaitBlock "SvelteAwaitBlock",
            AwaitPendingBlock "SvelteAwaitPendingBlock",
            AwaitThenBlock "SvelteAwaitThenBlock",
            AwaitCatchBlock "SvelteAwaitCatchBlock",
            KeyBlock "SvelteKeyBlock",
            SnippetBlock "SvelteSnippetBlock",
            Attribute "SvelteAttribute",
            ShorthandAttribute "SvelteShorthandAttribute",
            SpreadAttribute "SvelteSpreadAttribute",
            AttachTag "SvelteAttachTag",
            Directive "SvelteDirective",
            StyleDirective "SvelteStyleDirective",
            SpecialDirective "SvelteSpecialDirective",
            GenericsDirective "SvelteGenericsDirective",
            DirectiveKey "SvelteDirectiveKey",
            SpecialDirectiveKey "SvelteSpecialDirectiveKey",
            Text "SvelteText",
            HtmlComment "SvelteHTMLComment",
            FunctionBindingsExpression "SvelteFunctionBindingsExpression",
        }
    }
}

const _: () = assert!(SvelteTag::COUNT <= 64);

/// A child's relationship to its parent: the visitor key it's under, or for a [part](Child::Part), what it is.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Role {
    Body,
    Name,
    StartTag,
    Children,
    EndTag,
    Attributes,
    Object,
    Property,
    Key,
    Value,
    Expression,
    Identifiers,
    Declarations,
    Declaration,
    Context,
    Index,
    Else,
    Pending,
    Then,
    Catch,
    Error,
    Id,
    Params,
    Argument,
    Expressions,
    /// A part: a directive's modifier, the `once` of `on:click|once`.
    Modifier,
    /// A part: the tag that opens a block, `{#if a}`, or one of its clauses, `{:else}`, `{:then v}`.
    OpenTag,
    /// A part: the tag that closes a block, `{/if}`. An `{:else if}` has the one of its enclosing block.
    CloseTag,
}

impl Role {
    /// The visitor key, for a role that has one.
    pub const fn key(self) -> Option<&'static str> {
        Some(match self {
            Role::Body => "body",
            Role::Name => "name",
            Role::StartTag => "startTag",
            Role::Children => "children",
            Role::EndTag => "endTag",
            Role::Attributes => "attributes",
            Role::Object => "object",
            Role::Property => "property",
            Role::Key => "key",
            Role::Value => "value",
            Role::Expression => "expression",
            Role::Identifiers => "identifiers",
            Role::Declarations => "declarations",
            Role::Declaration => "declaration",
            Role::Context => "context",
            Role::Index => "index",
            Role::Else => "else",
            Role::Pending => "pending",
            Role::Then => "then",
            Role::Catch => "catch",
            Role::Error => "error",
            Role::Id => "id",
            Role::Params => "params",
            Role::Argument => "argument",
            Role::Expressions => "expressions",
            Role::Modifier | Role::OpenTag | Role::CloseTag => return None,
        })
    }
}

bitflags::bitflags! {
    /// svelte-eslint-parser's node flags, each for the kinds that have it.
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub struct SvelteFlags: u16 {
        /// A start tag's `selfClosing`: `<a />`.
        const SELF_CLOSING = 1 << 0;
        /// A directive's or style directive's `shorthand`: `class:a`, `style:color`.
        const SHORTHAND = 1 << 1;
        /// An attribute's `boolean`: `<input disabled>`.
        const BOOLEAN = 1 << 2;
        /// An if block's or else block's `elseif`.
        const ELSE_IF = 1 << 3;
        /// A then block's `awaitThen`: `{#await p then v}`.
        const AWAIT_THEN = 1 << 4;
        /// A catch block's `awaitCatch`: `{#await p catch e}`.
        const AWAIT_CATCH = 1 << 5;
        /// A script with `context="module"` or `module`.
        const MODULE = 1 << 6;
        /// A transition's `intro` and `outro`: `in:`, `out:`, `transition:`.
        const INTRO = 1 << 7;
        const OUTRO = 1 << 8;
    }
}

/// A piece of code's kind: what it's parsed as in the program.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CodeKind {
    Expression,
    /// A binding pattern, with its type annotation: an `{#each}`'s context, a `{:then}`'s value, a `let:`.
    Pattern,
    Identifier,
    /// The text between a snippet's parentheses.
    Parameters,
    /// The declarator of `{@const a = 1}`.
    Declarator,
    /// A statement: `{let a = 1}`.
    Declaration,
    /// A script's statements.
    Statements,
    /// A type parameter of `generics`, which the program has as aliases: its name, its constraint and its default.
    TypeParameters,
}

/// The index of a component node, from 0 for the `Program`, in text order. It's the same for each text.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct SvelteId(pub u32);

/// The index of a piece of a component's code, in text order.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct CodeId(pub u32);

/// A node's child.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Child {
    Node(SvelteId),
    Code(CodeId),
    /// The span of something that isn't a node: [`Role::Modifier`], [`Role::OpenTag`], [`Role::CloseTag`].
    Part(Span),
}

const NONE: u32 = u32::MAX;

/// svelte-eslint-parser's `kind` of a node: an element, a mustache tag, an await block, a directive or a special
/// directive.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum SvelteKind {
    /// A node without a `kind`.
    #[default]
    None,
    /// Elements.
    Html,
    Component,
    Special,
    /// Mustache tags: `{a}`, `{@html a}`.
    Text,
    Raw,
    /// Await blocks: `{#await}`, `{#await a then b}`, `{#await a catch b}`.
    Await,
    AwaitThen,
    AwaitCatch,
    /// Directives: `use:`, `animate:`, `bind:`, `class:`, `on:`, `let:`, and `in:`, `out:`, `transition:`.
    Action,
    Animation,
    Binding,
    Class,
    EventHandler,
    Let,
    Transition,
    /// The special directive `this`.
    This,
}

impl SvelteKind {
    /// As svelte-eslint-parser writes it. Empty for [`SvelteKind::None`].
    pub fn name(self) -> &'static str {
        match self {
            SvelteKind::None => "",
            SvelteKind::Html => "html",
            SvelteKind::Component => "component",
            SvelteKind::Special => "special",
            SvelteKind::Text => "text",
            SvelteKind::Raw => "raw",
            SvelteKind::Await => "await",
            SvelteKind::AwaitThen => "await-then",
            SvelteKind::AwaitCatch => "await-catch",
            SvelteKind::Action => "Action",
            SvelteKind::Animation => "Animation",
            SvelteKind::Binding => "Binding",
            SvelteKind::Class => "Class",
            SvelteKind::EventHandler => "EventHandler",
            SvelteKind::Let => "Let",
            SvelteKind::Transition => "Transition",
            SvelteKind::This => "this",
        }
    }
}

/// What a component is to SvelteKit if it's a route: eslint-plugin-svelte's `getSvelteKitFileTypeFromFilePath`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KitFileType {
    /// `+page.svelte`
    Page,
    /// `+layout.svelte`
    Layout,
    /// `+error.svelte`
    Error,
}

struct Data {
    tag: SvelteTag,
    kind: SvelteKind,
    flags: SvelteFlags,
    span: Span,
    parent: u32,
    /// Its children: a range of `Component::edges`.
    edges: (u32, u32),
}

#[derive(Copy, Clone)]
struct Edge {
    role: Role,
    child: Child,
}

struct CodeData {
    span: Span,
    kind: CodeKind,
    owner: SvelteId,
    role: Role,
}

/// What eslint-plugin-svelte's `getSvelteContext` says about a component's file, apart from the runes in its code
/// ([`File::svelte_runes`]). Its rules run where one of their `meta.conditions` holds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SvelteContext {
    /// The major version of the `svelte/compiler` that eslint-plugin-svelte imports: `"3/4"` for 3 and 4, otherwise
    /// `"5"` and so on.
    pub svelte_version: Option<Box<str>>,
    /// That `svelte/compiler`'s `VERSION`, its package version, like `"5.25.0"`. `None` if it has none.
    pub compiler_version: Option<Box<str>>,
    /// `runes` from `svelteFeatures`, the Svelte config or `<svelte:options>`. `None` if svelte-eslint-parser looks for
    /// runes in the code.
    pub runes: Option<bool>,
    /// SvelteKit's major version: `"2"`, or `"1.0.0-next"` for a prerelease of 1.
    pub kit_version: Option<Box<str>>,
    /// What the file is to SvelteKit, if it's a route.
    pub kit_file_type: Option<KitFileType>,
}

/// See the [module](self).
pub struct Component {
    text: Box<[u8]>,
    context: SvelteContext,
    nodes: Vec<Data>,
    edges: Vec<Edge>,
    codes: Vec<CodeData>,
    /// The nodes grouped by tag: for each tag, the start of its nodes in `by_tag`, plus one end.
    tag_starts: [u32; SvelteTag::COUNT + 1],
    by_tag: Vec<u32>,
    /// A bit for each tag that has a node.
    present: u64,
    /// The indices of `codes`, sorted by start.
    codes_by_start: Vec<u32>,
    /// [`Component::values_with`]
    values: std::sync::OnceLock<Box<[Option<Box<[u8]>>]>>,
    /// [`Component::places`]
    line_starts: std::sync::OnceLock<Box<[u32]>>,
}

impl Component {
    /// The component's text.
    pub fn text(&self) -> &[u8] {
        &self.text
    }

    /// Its lines and columns. Line starts are computed once.
    pub fn places(&self) -> Places<'_> {
        let starts = (self.line_starts).get_or_init(|| Places::starts_of(&self.text).into());
        Places::with_starts(&self.text, std::borrow::Cow::Borrowed(starts))
    }

    /// ESLint's `loc` of `offset`: the line from 1, the column in UTF-16 code units from 0.
    pub fn position(&self, offset: u32) -> crate::span::Position {
        let (line, column) = self.places().position(offset);
        crate::span::Position {
            line,
            column: column.saturating_sub(1),
        }
    }

    pub fn context(&self) -> &SvelteContext {
        &self.context
    }

    pub fn set_context(&mut self, context: SvelteContext) {
        self.context = context;
    }

    fn data(&self, id: SvelteId) -> Option<&Data> {
        self.nodes.get(id.0 as usize)
    }

    /// The nodes of `tag`, in text order.
    pub fn ids_of(&self, tag: SvelteTag) -> impl Iterator<Item = SvelteId> + '_ {
        let (start, end) = (
            self.tag_starts[tag as usize] as usize,
            self.tag_starts[tag as usize + 1] as usize,
        );
        self.by_tag
            .get(start..end)
            .unwrap_or_default()
            .iter()
            .map(|&it| SvelteId(it))
    }

    /// The piece of code that contains `span`. Pieces of code don't nest.
    pub fn code_at(&self, span: Span) -> Option<CodeId> {
        let index = self.codes_by_start.partition_point(|&it| {
            self.codes
                .get(it as usize)
                .is_some_and(|it| it.span.start <= span.start)
        });
        let id = *self.codes_by_start.get(index.checked_sub(1)?)?;
        let code = self.codes.get(id as usize)?;
        (span.end <= code.span.end).then_some(CodeId(id))
    }

    /// The pieces of code, in text order.
    pub fn codes(&self) -> impl Iterator<Item = (CodeId, Span, CodeKind)> + '_ {
        (self.codes.iter().zip(0..)).map(|(it, at)| (CodeId(at), it.span, it.kind))
    }

    /// A piece of code's span, kind, node, and role in that node.
    pub fn code(&self, id: CodeId) -> Option<(Span, CodeKind, SvelteId, Role)> {
        let it = self.codes.get(id.0 as usize)?;
        Some((it.span, it.kind, it.owner, it.role))
    }

    /// The value `make` gives each node, indexed by its number, computed on first use: a text's `value` where it
    /// differs from the source text, for the ESTree in `crate::estree`.
    pub(crate) fn values_with(
        &self,
        make: impl FnOnce(&Component) -> Box<[Option<Box<[u8]>>]>,
    ) -> &[Option<Box<[u8]>>] {
        self.values.get_or_init(|| make(self))
    }
}

/// Builds a [`Component`]: each node is opened, filled, and closed, in text order.
pub struct Builder {
    component: Component,
    /// The open nodes, each with the start of its children in `pending` and its role in its parent.
    open: Vec<(SvelteId, usize, Role)>,
    pending: Vec<Edge>,
}

impl Builder {
    /// For the component `text`. Opens the `Program`.
    pub fn new(text: &[u8]) -> Builder {
        let mut builder = Builder {
            component: Component {
                text: text.into(),
                context: SvelteContext::default(),
                nodes: Vec::new(),
                edges: Vec::new(),
                codes: Vec::new(),
                tag_starts: [0; SvelteTag::COUNT + 1],
                by_tag: Vec::new(),
                present: 0,
                codes_by_start: Vec::new(),
                values: std::sync::OnceLock::new(),
                line_starts: std::sync::OnceLock::new(),
            },
            open: Vec::new(),
            pending: Vec::new(),
        };
        builder.open(
            SvelteTag::Program,
            Role::Body,
            Span::new(0, text.len() as u32),
        );
        builder
    }

    /// Opens a node of `tag` at `span` as the open node's next child, in `role`. It stays open until
    /// [`Builder::close`].
    pub fn open(&mut self, tag: SvelteTag, role: Role, span: Span) -> SvelteId {
        let id = SvelteId(self.component.nodes.len() as u32);
        let parent = self.open.last().map_or(NONE, |it| it.0.0);
        self.component.nodes.push(Data {
            tag,
            kind: SvelteKind::None,
            flags: SvelteFlags::empty(),
            span,
            parent,
            edges: (0, 0),
        });
        self.open.push((id, self.pending.len(), role));
        id
    }

    /// Adds a node without children.
    pub fn leaf(&mut self, tag: SvelteTag, role: Role, span: Span) -> SvelteId {
        let id = self.open(tag, role, span);
        self.close();
        id
    }

    /// Sets the open node's `kind`.
    pub fn kind(&mut self, kind: SvelteKind) {
        if let Some(data) = self.open_data() {
            data.kind = kind;
        }
    }

    pub fn flag(&mut self, flags: SvelteFlags) {
        if let Some(data) = self.open_data() {
            data.flags |= flags;
        }
    }

    fn open_data(&mut self) -> Option<&mut Data> {
        let id = self.open.last()?.0;
        self.component.nodes.get_mut(id.0 as usize)
    }

    /// Adds code at `span` as the open node's next child, in `role`.
    pub fn code(&mut self, role: Role, span: Span, kind: CodeKind) {
        let Some(&(owner, ..)) = self.open.last() else {
            return;
        };
        let id = CodeId(self.component.codes.len() as u32);
        (self.component.codes).push(CodeData {
            span,
            kind,
            owner,
            role,
        });
        self.pending.push(Edge {
            role,
            child: Child::Code(id),
        });
    }

    /// Adds a part of the open node at `span`.
    pub fn part(&mut self, role: Role, span: Span) {
        self.pending.push(Edge {
            role,
            child: Child::Part(span),
        });
    }

    /// Closes the most recently opened node.
    pub fn close(&mut self) {
        let Some((id, from, role)) = self.open.pop() else {
            return;
        };
        let start = self.component.edges.len() as u32;
        self.component.edges.extend(self.pending.drain(from..));
        let end = self.component.edges.len() as u32;
        if let Some(data) = self.component.nodes.get_mut(id.0 as usize) {
            data.edges = (start, end);
        }
        if !self.open.is_empty() {
            self.pending.push(Edge {
                role,
                child: Child::Node(id),
            });
        }
    }

    pub fn finish(mut self) -> Component {
        while !self.open.is_empty() {
            self.close();
        }
        let component = &mut self.component;
        let mut counts = [0u32; SvelteTag::COUNT + 1];
        for data in &component.nodes {
            counts[data.tag as usize + 1] += 1;
            component.present |= 1 << data.tag as u32;
        }
        for at in 0..SvelteTag::COUNT {
            counts[at + 1] += counts[at];
        }
        component.tag_starts = counts;
        let mut next = counts;
        component.by_tag = vec![0; component.nodes.len()];
        for (data, id) in component.nodes.iter().zip(0..) {
            let at = &mut next[data.tag as usize];
            if let Some(slot) = component.by_tag.get_mut(*at as usize) {
                *slot = id;
            }
            *at += 1;
        }
        component.codes_by_start = (0..component.codes.len() as u32).collect();
        let codes = &component.codes;
        crate::utils::sort::sort_by_key(&mut component.codes_by_start, |&it| {
            codes.get(it as usize).map_or(0, |it| it.span.start)
        });
        self.component
    }
}

/// How a program is built from a component, beyond its code: the component node each scope opened by the lowering
/// stands for. Each program has its own. See the [module](self).
#[derive(Default)]
pub struct Lowered {
    /// The program start of each node whose scope stands for a component node, and that component node. Sorted.
    scopes: Vec<(u32, SvelteId)>,
}

impl Lowered {
    /// Records that the scope of the node starting at `at` in the program stands for `owner`: the function of an
    /// `{#each}`, a `{#snippet}`, a `{:then}` or a `let:`, or the block of an `{#if}`, an `{:else}` or an element.
    pub fn add_scope(&mut self, at: u32, owner: SvelteId) {
        let index = self.scopes.partition_point(|it| it.0 < at);
        self.scopes.insert(index, (at, owner));
    }

    fn owner_at(&self, at: u32) -> Option<SvelteId> {
        let index = self.scopes.partition_point(|it| it.0 < at);
        self.scopes
            .get(index)
            .filter(|it| it.0 == at)
            .map(|it| it.1)
    }
}

/// A node of a file's component, as a [`Node`] is a node of its program.
#[derive(Copy, Clone)]
pub struct SvelteNode<'a> {
    file: &'a File<'a>,
    component: &'a Component,
    id: SvelteId,
}

impl PartialEq for SvelteNode<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for SvelteNode<'_> {}

impl std::fmt::Debug for SvelteNode<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}#{}", self.tag().type_name(), self.id.0)
    }
}

impl<'a> SvelteNode<'a> {
    /// A node is only ever created with an id from its component.
    fn data(self) -> &'a Data {
        let nodes = &self.component.nodes;
        debug_assert!((self.id.0 as usize) < nodes.len());
        nodes.get(self.id.0 as usize).unwrap_or_else(|| &nodes[0])
    }

    fn edges(self) -> &'a [Edge] {
        let (start, end) = self.data().edges;
        (self.component.edges)
            .get(start as usize..end as usize)
            .unwrap_or_default()
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    #[inline]
    pub fn id(self) -> SvelteId {
        self.id
    }

    #[inline]
    pub fn tag(self) -> SvelteTag {
        self.data().tag
    }

    /// The `kind` of an element, a mustache tag, an await block, a directive or a special directive.
    /// [`SvelteKind::None`] for the others.
    #[inline]
    pub fn kind(self) -> SvelteKind {
        self.data().kind
    }

    #[inline]
    pub fn has(self, flags: SvelteFlags) -> bool {
        self.data().flags.contains(flags)
    }

    /// Its span in the component.
    #[inline]
    pub fn span(self) -> Span {
        self.data().span
    }

    /// The source text at its span.
    pub fn text(self) -> &'a [u8] {
        let span = self.span();
        (self.component.text)
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default()
    }

    /// `None` for the `Program`.
    pub fn parent(self) -> Option<SvelteNode<'a>> {
        let parent = self.data().parent;
        (parent != NONE).then(|| self.with(SvelteId(parent)))
    }

    /// The parent, its parent, and so on.
    pub fn ancestors(self) -> impl Iterator<Item = SvelteNode<'a>> {
        std::iter::successors(self.parent(), |it| it.parent())
    }

    fn with(self, id: SvelteId) -> SvelteNode<'a> {
        SvelteNode { id, ..self }
    }

    /// Its children (nodes, code and parts), each with its role: in visitor-key order, then the parts.
    pub fn children(self) -> impl Iterator<Item = (Role, Child)> + 'a {
        self.edges().iter().map(|it| (it.role, it.child))
    }

    /// The child at index `at` of [`SvelteNode::children`].
    pub fn child_at(self, at: usize) -> Option<(Role, Child)> {
        self.edges().get(at).map(|it| (it.role, it.child))
    }

    /// The child nodes with `role`, in order: one or a list.
    pub fn nodes(self, role: Role) -> impl Iterator<Item = SvelteNode<'a>> + 'a {
        self.edges().iter().filter_map(move |it| match it.child {
            Child::Node(id) if it.role == role => Some(self.with(id)),
            _ => None,
        })
    }

    /// The first child node with `role`.
    pub fn child(self, role: Role) -> Option<SvelteNode<'a>> {
        self.nodes(role).next()
    }

    /// Its code in `role`, for roles that hold a single piece.
    pub fn code(self, role: Role) -> Option<Code<'a>> {
        self.codes(role).next()
    }

    /// Its code in `role`, in order.
    pub fn codes(self, role: Role) -> impl Iterator<Item = Code<'a>> + 'a {
        let (file, component) = (self.file, self.component);
        self.edges().iter().filter_map(move |it| match it.child {
            Child::Code(id) if it.role == role => Some(Code {
                file,
                component,
                id,
            }),
            _ => None,
        })
    }

    /// The span of the part with `role`.
    pub fn part(self, role: Role) -> Option<InComponent> {
        self.parts(role).next()
    }

    pub fn parts(self, role: Role) -> impl Iterator<Item = InComponent> + 'a {
        self.edges().iter().filter_map(move |it| match it.child {
            Child::Part(span) if it.role == role => Some(InComponent(span)),
            _ => None,
        })
    }

    /// The name of an element, an attribute or a directive, as written: svelte-eslint-parser's `name.name`, or the code
    /// of the name of a component, of `use:`, `transition:`, `animate:` and of `style:` without a value. Empty if
    /// there's none.
    pub fn name(self) -> &'a [u8] {
        let (of, named) = match self.tag() {
            SvelteTag::Directive | SvelteTag::StyleDirective => match self.child(Role::Key) {
                Some(key) => (key, key.child(Role::Name)),
                None => return b"",
            },
            _ => (
                self,
                self.child(Role::Name).or_else(|| self.child(Role::Key)),
            ),
        };
        match named {
            Some(it) if matches!(it.tag(), SvelteTag::Name | SvelteTag::MemberExpressionName) => {
                it.text()
            }
            _ => of.code(Role::Name).map_or(b"", Code::text),
        }
    }
}

impl Spanned for SvelteNode<'_> {
    #[inline]
    fn span(&self) -> Span {
        SvelteNode::span(*self)
    }

    #[inline]
    fn domain(&self) -> Domain {
        Domain::Original
    }

    /// svelte-eslint-parser's tree is the component's, where a `Program` and its only element can share a range.
    fn nesting(&self) -> Option<u8> {
        let span = self.span();
        let same = self.ancestors().take_while(|it| it.span() == span);
        Some(u8::try_from(same.count()).unwrap_or(u8::MAX))
    }

    #[inline]
    fn svelte_id(&self) -> Option<SvelteId> {
        Some(self.id)
    }
}

/// The text between the `<!--` and `-->` of the HTML comment `comment`.
pub fn html_comment_value(comment: &[u8]) -> Option<&[u8]> {
    comment.get(b"<!--".len()..comment.len().saturating_sub(b"-->".len()))
}

/// The names of a `generics` attribute's type parameters.
pub fn generic_names<'a>(directive: SvelteNode<'a>) -> impl Iterator<Item = GenericName<'a>> + 'a {
    directive.codes(Role::Params).filter_map(|code| {
        let name = code.roots().find_map(|root| match root {
            Root::NameOf(Node::Stmt(statement)) => match statement.kind() {
                crate::ast::StmtKind::TypeAlias(alias) => Some(alias.name()),
                _ => None,
            },
            _ => None,
        })?;
        // The alias is written the same way as the parameter, so its name has the written length, escapes included.
        let parameter = code.span();
        Some(GenericName {
            span: Span::new(parameter.start, parameter.start + name.span().len()),
            name: name.name().bytes(),
            parameter,
        })
    })
}

/// The name of a type parameter in `generics`: the `Identifier` in its `TSTypeParameter` in ESLint's tree, in component
/// positions.
#[derive(Copy, Clone, Debug)]
pub struct GenericName<'a> {
    pub span: Span,
    /// The name, which the program has as an alias's name.
    pub name: &'a [u8],
    parameter: Span,
}

impl Spanned for GenericName<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.span
    }

    #[inline]
    fn domain(&self) -> Domain {
        Domain::Original
    }

    /// The `TSTypeParameter` has its name's range if it has neither a constraint nor a default.
    fn nesting(&self) -> Option<u8> {
        Some(u8::from(self.parameter == self.span))
    }
}

/// A component range that isn't a node, for a report or a fix there, in component positions.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct InComponent(pub Span);

impl Spanned for InComponent {
    #[inline]
    fn span(&self) -> Span {
        self.0
    }

    #[inline]
    fn domain(&self) -> Domain {
        Domain::Original
    }
}

/// A piece of a component's code: an expression, a pattern, a declaration, a script's statements.
#[derive(Copy, Clone)]
pub struct Code<'a> {
    file: &'a File<'a>,
    component: &'a Component,
    id: CodeId,
}

impl<'a> Code<'a> {
    #[inline]
    pub fn id(self) -> CodeId {
        self.id
    }

    /// Its span in the component.
    pub fn span(self) -> Span {
        self.component
            .code(self.id)
            .map_or_else(Span::default, |it| it.0)
    }

    pub fn kind(self) -> CodeKind {
        self.component
            .code(self.id)
            .map_or(CodeKind::Expression, |it| it.1)
    }

    pub fn text(self) -> &'a [u8] {
        let span = self.span();
        (self.component.text)
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default()
    }

    /// The node it is in the file's program: [`File::svelte_code`].
    pub fn node(self) -> Option<Node<'a>> {
        self.file.svelte_code(self.id)
    }

    /// What it is in the file's program, in order: [`File::svelte_code_roots`].
    pub fn roots(self) -> impl Iterator<Item = Root<'a>> + 'a {
        self.file.svelte_code_roots(self.id)
    }
}

/// What a piece of a component's code is in a program: one of its nodes, or the name of a node, which isn't a node
/// itself (of a function, a class, a type alias, a type parameter).
#[derive(Copy, Clone, Debug)]
pub enum Root<'a> {
    Node(Node<'a>),
    NameOf(Node<'a>),
}

impl<'a> Root<'a> {
    /// Its span in the program: the node's, or its name's.
    pub fn span(self) -> Span {
        match self {
            Root::Node(node) => node.span(),
            Root::NameOf(node) => name_span(node).unwrap_or_else(|| node.span()),
        }
    }

    pub fn node(self) -> Node<'a> {
        match self {
            Root::Node(node) | Root::NameOf(node) => node,
        }
    }
}

impl Spanned for Code<'_> {
    #[inline]
    fn span(&self) -> Span {
        Code::span(*self)
    }

    #[inline]
    fn domain(&self) -> Domain {
        Domain::Original
    }
}

/// What a variable is to the component, if a component node declares it: [`File::svelte_binding`].
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Binding<'a> {
    /// What the scope that declares it stands for: [`File::svelte_scope_owner`]. `None` for a snippet's name, which the
    /// scope around the snippet declares.
    pub scope_owner: Option<SvelteNode<'a>>,
    /// The node whose code declares it, which svelte-eslint-parser has as the definition's `node`: the `{#each}`, the
    /// snippet, the `{:then}`, the `{:catch}`, the `let:` directive.
    pub node: SvelteNode<'a>,
    /// The node's role for that code: an `{#each}`'s [`Role::Context`] and [`Role::Index`], a snippet's
    /// [`Role::Params`] and [`Role::Id`], a `{:then}`'s [`Role::Value`], a `{:catch}`'s [`Role::Error`], a `let:`'s
    /// [`Role::Expression`].
    pub role: Role,
}

impl<'a> File<'a> {
    /// The text at `span` in `domain`: [`File::slice`], or the component's.
    pub fn slice_in(&self, domain: Domain, span: Span) -> &'a [u8] {
        match (domain, self.svelte()) {
            (Domain::Original, Some(component)) => {
                component.text.get(span.range()).unwrap_or_default()
            }
            _ => self.slice(span),
        }
    }

    /// Sets the component whose program the file is, and how the program was built from it. Called before anything is
    /// queried on the file.
    pub fn set_svelte(&self, component: &'a Component, lowered: &'a Lowered) {
        self.svelte.set(Some((component, lowered)));
    }

    /// The component whose program the file is: see the [module](self).
    #[inline]
    pub fn svelte(&self) -> Option<&'a Component> {
        self.svelte.get().map(|it| it.0)
    }

    pub fn svelte_node(&'a self, id: SvelteId) -> Option<SvelteNode<'a>> {
        let component = self.svelte()?;
        component.data(id)?;
        Some(SvelteNode {
            file: self,
            component,
            id,
        })
    }

    /// See [`SvelteContext`].
    pub fn svelte_context(&self) -> Option<&'a SvelteContext> {
        self.svelte().map(Component::context)
    }

    /// `svelteParseContext.runes` from svelte-eslint-parser's services: [`SvelteContext::runes`], or else whether an
    /// `Identifier` in ESLint's tree of the component is a rune's name (`hasRunesSymbol`), including a type parameter
    /// of `generics`. `None` if Svelte has no runes, before 5.
    pub fn svelte_runes(&'a self) -> Option<bool> {
        let context = self.svelte_context()?;
        if matches!(context.svelte_version.as_deref(), None | Some("3/4")) {
            return None;
        }
        Some(
            context
                .runes
                .unwrap_or_else(|| *self.svelte_has_rune.get_or_init(|| self.has_rune())),
        )
    }

    /// svelte-eslint-parser's `hasRunesSymbol`.
    fn has_rune(&'a self) -> bool {
        if !self.mentions_any(&RUNES) {
            return false;
        }
        let is_rune = |name: &[u8]| RUNES.iter().any(|it| it.as_bytes() == name);
        let directives = self.svelte_nodes_of(SvelteTag::GenericsDirective);
        let mut has_rune = directives
            .flat_map(generic_names)
            .any(|it| is_rune(it.name));
        self.every_node_of(identifiers::owners(), &mut |node, _| {
            if !has_rune {
                identifiers::identifiers_of(node, |it| has_rune |= is_rune(it.name));
            }
        });
        has_rune
    }

    /// The component's `Program`.
    pub fn svelte_root(&'a self) -> Option<SvelteNode<'a>> {
        self.svelte_node(SvelteId(0))
    }

    /// The component's nodes of `tag`, in text order.
    pub fn svelte_nodes_of(&'a self, tag: SvelteTag) -> impl Iterator<Item = SvelteNode<'a>> + 'a {
        let component = self.svelte();
        (component.into_iter()).flat_map(move |component| {
            (component.ids_of(tag)).map(move |id| SvelteNode {
                file: self,
                component,
                id,
            })
        })
    }

    /// The bits of the tags the component has nodes of.
    #[inline]
    pub(crate) fn svelte_tags_present(&self) -> u64 {
        self.svelte().map_or(0, |it| it.present)
    }

    /// The program node that the component's code `id` is, if it's a single node: [`File::svelte_code_roots`].
    pub fn svelte_code(&'a self, id: CodeId) -> Option<Node<'a>> {
        let mut roots = self.svelte_code_roots(id);
        match (roots.next(), roots.next()) {
            (Some(Root::Node(node)), None) => Some(node),
            _ => None,
        }
    }

    /// What the component's code `id` is in the program, in program order: the outermost nodes inside the range where
    /// the program has it as written, or else where it copies it (a `let:`, the parameters of `generics`), plus the
    /// names of non-node items there. One node for an expression, one statement each for a script, one parameter each
    /// for a snippet's parameters, the function's name for a snippet's name. Hidden nodes are included where the
    /// program copies code. The links are computed on first use.
    pub fn svelte_code_roots(&'a self, id: CodeId) -> impl Iterator<Item = Root<'a>> + 'a {
        self.svelte_code_links(id)
            .iter()
            .map(move |&(packed, is_name)| match is_name {
                true => Root::NameOf(packed.unpack(self)),
                false => Root::Node(packed.unpack(self)),
            })
    }

    /// The root at index `at` of [`File::svelte_code_roots`].
    pub fn svelte_code_root(&'a self, id: CodeId, at: usize) -> Option<Root<'a>> {
        let &(packed, is_name) = self.svelte_code_links(id).get(at)?;
        Some(match is_name {
            true => Root::NameOf(packed.unpack(self)),
            false => Root::Node(packed.unpack(self)),
        })
    }

    fn svelte_code_links(&'a self, id: CodeId) -> &'a [(Packed, bool)] {
        let links = self.svelte_links.get_or_init(|| {
            let (Some(component), Some(view)) = (self.svelte(), self.view()) else {
                return Box::default();
            };
            let roots_of = |code: &CodeData| {
                let mut roots = Vec::new();
                for pieces in view.pieces_in_program(code.span) {
                    for piece in pieces {
                        roots_in(Node::File(self), piece, &mut roots);
                    }
                    if !roots.is_empty() {
                        break;
                    }
                }
                roots.into_boxed_slice()
            };
            component.codes.iter().map(roots_of).collect()
        });
        links.get(id.0 as usize).map_or(&[][..], |it| &it[..])
    }

    /// The component node whose code contains the program node `node`, and that code: the innermost one, by `node`'s
    /// position in the component. `None` for synthesized code.
    pub fn svelte_owner(&'a self, node: Node<'a>) -> Option<(SvelteNode<'a>, Code<'a>)> {
        let (component, view) = (self.svelte()?, self.view()?);
        let span = node.span();
        let start = view.in_file(span.start);
        let code = component.code_at(Span::new(start, start + span.len()))?;
        let (_, _, owner, _) = component.code(code)?;
        Some((
            self.svelte_node(owner)?,
            Code {
                file: self,
                component,
                id: code,
            },
        ))
    }

    /// The component node that `scope` stands for, if the lowering created it: the `{#each}`, `{#snippet}`, `{:then}`,
    /// `{:catch}`, `{:else}`, `{#if}`, `{#key}` or element whose code is in it, which svelte-eslint-parser has as
    /// `scope.block`.
    pub fn svelte_scope_owner(&'a self, scope: Scope<'a>) -> Option<SvelteNode<'a>> {
        let (_, lowered) = self.svelte.get()?;
        self.svelte_node(lowered.owner_at(scope.span().start)?)
    }

    /// What `symbol` is to the component node that declares it, if a scope from the lowering declares it or it's a
    /// snippet's name.
    pub fn svelte_binding(&'a self, symbol: Symbol<'a>) -> Option<Binding<'a>> {
        let component = self.svelte()?;
        let view = self.view()?;
        let name = symbol.declarations().find_map(|it| it.name_span())?;
        let start = view.in_file(name.start);
        let code = component.code_at(Span::new(start, start + name.len()))?;
        let (_, _, node, role) = component.code(code)?;
        let node = self.svelte_node(node)?;
        let scope_owner = self.svelte_scope_owner(symbol.scope());
        // A snippet's name is declared in the enclosing scope.
        (scope_owner.is_some() || role == Role::Id).then_some(Binding {
            scope_owner,
            node,
            role,
        })
    }

    /// The outermost program node at `span` that rules can see.
    pub fn node_with_span(&'a self, span: Span) -> Option<Node<'a>> {
        let mut at = Node::File(self);
        loop {
            let mut inner = None;
            at.for_each_child_near(span.start, |child| {
                let it = child.span();
                if inner.is_none() && it.start <= span.start && span.end <= it.end {
                    inner = Some(child);
                }
            });
            at = inner?;
            if at.span() == span {
                return Some(at);
            }
        }
    }
}

/// The [`Root`]s of each piece of a component's code, linked once per file: the node, and whether the root is its name.
pub(crate) type Links = Box<[Box<[(Packed, bool)]>]>;

/// Adds to `roots` the parts of `node` that are in the program at `span`: each child inside `span`, and the name of
/// each child that only overlaps it, if the name is inside. Of the children the view hides, only the ones it copies
/// from the file count.
fn roots_in<'a>(node: Node<'a>, span: Span, roots: &mut Vec<(Packed, bool)>) {
    let view = node.file().view();
    node.for_each_child_with_hidden(|child| {
        let it = child.span();
        let is_inside = span.start <= it.start && it.end <= span.end;
        let is_seen = !child.is_hidden() || view.is_some_and(|view| view.is_copy(it.start));
        if is_inside && is_seen {
            roots.push((child.packed(), false));
        } else if it.start < span.end && span.start < it.end {
            if let Some(name) = name_span(child)
                && span.start <= name.start
                && name.end <= span.end
            {
                roots.push((child.packed(), true));
            }
            roots_in(child, span, roots);
        }
    });
}

/// The span of `node`'s name, if the name isn't a node itself.
fn name_span(node: Node<'_>) -> Option<Span> {
    match node {
        Node::Func(it) => Some(it.name()?.span()),
        Node::Class(it) => Some(it.name()?.span()),
        Node::TypeParam(it) => Some(it.name().span()),
        Node::Stmt(it) => match it.kind() {
            crate::ast::StmtKind::TypeAlias(alias) => Some(alias.name().span()),
            _ => None,
        },
        _ => None,
    }
}

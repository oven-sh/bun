//! The tree that `svelte/compiler` makes of a component with `parse(text, { modern: true })`, as far as
//! `prettier-plugin-svelte` looks at it. Of JavaScript it has where it is.

use std::borrow::Cow;

pub(crate) type Id = u32;
pub(crate) type FragmentId = u32;

#[derive(Debug, Copy, Clone, Default, PartialEq, Eq)]
pub(crate) struct Span {
    pub(crate) start: u32,
    pub(crate) end: u32,
}

impl Span {
    pub(crate) fn new(start: usize, end: usize) -> Span {
        Span {
            start: start as u32,
            end: end as u32,
        }
    }

    pub(crate) fn of(self, text: &[u8]) -> &[u8] {
        text.get(self.start as usize..self.end as usize)
            .unwrap_or_default()
    }
}

/// What kind of node of ESTree an expression is, where somebody asks.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ExpressionKind {
    Identifier,
    /// A string.
    StringLiteral,
    /// `null`, a number, `true`, a regular expression ..
    OtherLiteral,
    Sequence,
    Call,
    Object,
    Other,
}

/// An expression: the node without the parentheses around it.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) struct Expression {
    pub(crate) span: Span,
    pub(crate) kind: ExpressionKind,
    /// Where the first of its `leadingComments` starts, or else the node.
    pub(crate) from: u32,
}

impl Expression {
    /// One without comments.
    pub(crate) fn new(span: Span, kind: ExpressionKind) -> Expression {
        Expression {
            span,
            kind,
            from: span.start,
        }
    }
}

/// A pattern, with its type annotation.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) struct Pattern {
    /// Up to the end of the annotation, unless it is a name.
    pub(crate) span: Span,
    /// `typeAnnotation.typeAnnotation`
    pub(crate) annotation: Option<Span>,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ElementKind {
    RegularElement,
    Component,
    TitleElement,
    SlotElement,
    SvelteHead,
    SvelteOptions,
    SvelteWindow,
    SvelteDocument,
    SvelteBody,
    SvelteElement,
    SvelteComponent,
    SvelteSelf,
    SvelteFragment,
    SvelteBoundary,
}

impl ElementKind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            ElementKind::RegularElement => "RegularElement",
            ElementKind::Component => "Component",
            ElementKind::TitleElement => "TitleElement",
            ElementKind::SlotElement => "SlotElement",
            ElementKind::SvelteHead => "SvelteHead",
            ElementKind::SvelteOptions => "SvelteOptions",
            ElementKind::SvelteWindow => "SvelteWindow",
            ElementKind::SvelteDocument => "SvelteDocument",
            ElementKind::SvelteBody => "SvelteBody",
            ElementKind::SvelteElement => "SvelteElement",
            ElementKind::SvelteComponent => "SvelteComponent",
            ElementKind::SvelteSelf => "SvelteSelf",
            ElementKind::SvelteFragment => "SvelteFragment",
            ElementKind::SvelteBoundary => "SvelteBoundary",
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum DirectiveKind {
    Use,
    Animate,
    Bind,
    Class,
    On,
    Let,
    /// `in:`, `out:`, `transition:`: `intro` and `outro`.
    Transition(bool, bool),
}

impl DirectiveKind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            DirectiveKind::Use => "UseDirective",
            DirectiveKind::Animate => "AnimateDirective",
            DirectiveKind::Bind => "BindDirective",
            DirectiveKind::Class => "ClassDirective",
            DirectiveKind::On => "OnDirective",
            DirectiveKind::Let => "LetDirective",
            DirectiveKind::Transition(..) => "TransitionDirective",
        }
    }
}

/// `attribute.value`
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Value {
    True,
    /// An `ExpressionTag`.
    Tag(Id),
    /// `Text` and `ExpressionTag`.
    Parts(Vec<Id>),
}

impl Value {
    /// The texts and tags that it is made of.
    pub(crate) fn parts(&self) -> &[Id] {
        match self {
            Value::True => &[],
            Value::Tag(tag) => std::slice::from_ref(tag),
            Value::Parts(parts) => parts,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Element<'a> {
    pub(crate) kind: ElementKind,
    pub(crate) name: &'a [u8],
    pub(crate) attributes: Vec<Id>,
    pub(crate) fragment: FragmentId,
    /// `expression` of `<svelte:component this={..}>`, `tag` of `<svelte:element this={..}>`.
    pub(crate) this: Option<Expression>,
}

#[derive(Debug, Clone)]
pub(crate) enum Kind<'a> {
    /// The printer trims it, and puts two together.
    Text {
        raw: Cow<'a, [u8]>,
    },
    Comment {
        data: &'a [u8],
    },
    Element(Box<Element<'a>>),
    Attribute {
        name: &'a [u8],
        value: Value,
    },
    SpreadAttribute(Expression),
    AttachTag(Expression),
    Directive {
        kind: DirectiveKind,
        name: &'a [u8],
        modifiers: Vec<&'a [u8]>,
        expression: Option<Expression>,
    },
    StyleDirective {
        name: &'a [u8],
        modifiers: Vec<&'a [u8]>,
        value: Value,
    },
    ExpressionTag(Expression),
    HtmlTag(Expression),
    RenderTag(Expression),
    /// The declarator.
    ConstTag(Span),
    /// The declaration.
    DeclarationTag(Span),
    DebugTag(Vec<Span>),
    IfBlock {
        is_else_if: bool,
        test: Expression,
        consequent: FragmentId,
        alternate: Option<FragmentId>,
    },
    EachBlock {
        expression: Expression,
        context: Option<Pattern>,
        index: Option<&'a [u8]>,
        key: Option<Expression>,
        body: FragmentId,
        fallback: Option<FragmentId>,
    },
    AwaitBlock {
        expression: Expression,
        value: Option<Pattern>,
        error: Option<Pattern>,
        pending: Option<FragmentId>,
        then: Option<FragmentId>,
        catch: Option<FragmentId>,
    },
    KeyBlock {
        expression: Expression,
        fragment: FragmentId,
    },
    SnippetBlock {
        /// The name.
        expression: Span,
        /// Where the last parameter ends, with its type.
        last_parameter_end: Option<u32>,
        body: FragmentId,
    },
    Script {
        is_module: bool,
        attributes: Vec<Id>,
    },
    StyleSheet {
        attributes: Vec<Id>,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct Node<'a> {
    pub(crate) kind: Kind<'a>,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

/// `//` or `/* */` between attributes, or in an expression.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Comment {
    pub(crate) span: Span,
    pub(crate) is_block: bool,
}

#[derive(Debug, Default)]
pub(crate) struct Tree<'a> {
    pub(crate) nodes: Vec<Node<'a>>,
    pub(crate) fragments: Vec<Vec<Id>>,
    /// `root.fragment`
    pub(crate) fragment: FragmentId,
    /// `<svelte:options>`, which is not in the fragment.
    pub(crate) options: Option<Id>,
    pub(crate) module: Option<Id>,
    pub(crate) instance: Option<Id>,
    pub(crate) css: Option<Id>,
    /// Those between attributes.
    pub(crate) comments: Vec<Comment>,
}

impl<'a> Tree<'a> {
    pub(crate) fn add(&mut self, kind: Kind<'a>, start: usize, end: usize) -> Id {
        self.nodes.push(Node {
            kind,
            start: start as u32,
            end: end as u32,
        });
        (self.nodes.len() - 1) as Id
    }

    pub(crate) fn add_fragment(&mut self) -> FragmentId {
        self.fragments.push(Vec::new());
        (self.fragments.len() - 1) as FragmentId
    }

    pub(crate) fn fragment(&self, id: FragmentId) -> &[Id] {
        self.fragments.get(id as usize).map_or(&[], |it| &it[..])
    }
}

impl<'a> std::ops::Index<Id> for Tree<'a> {
    type Output = Node<'a>;

    fn index(&self, id: Id) -> &Node<'a> {
        &self.nodes[id as usize]
    }
}

impl<'a> std::ops::IndexMut<Id> for Tree<'a> {
    fn index_mut(&mut self, id: Id) -> &mut Node<'a> {
        &mut self.nodes[id as usize]
    }
}

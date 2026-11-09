//! The AST that `svelte/compiler` returns from `parse(text, { modern: true })`, limited to what
//! `prettier-plugin-svelte` reads. JavaScript is stored only as spans.

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

/// An expression's ESTree node type. Only the types that some code checks get their own variant.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ExpressionKind {
    Identifier,
    StringLiteral,
    /// The text of `this="a"`, which Svelte turns into a string literal.
    Text,
    /// `null`, a number, `true`, a regular expression ..
    OtherLiteral,
    Sequence,
    Call,
    Object,
    Other,
}

/// An expression. `span` is the node without its surrounding parentheses.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) struct Expression {
    pub(crate) span: Span,
    pub(crate) kind: ExpressionKind,
    /// Start of the first of its `leadingComments`, or of the node if it has none.
    pub(crate) from: u32,
    /// The node with its surrounding parentheses, plus the comments before, between and after them.
    pub(crate) outer: Span,
}

impl Expression {
    /// An expression without parentheses or comments around it.
    pub(crate) fn new(span: Span, kind: ExpressionKind) -> Expression {
        Expression {
            span,
            kind,
            from: span.start,
            outer: span,
        }
    }
}

/// A pattern, with its type annotation.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) struct Pattern {
    /// Extends to the end of the annotation, unless the pattern is an identifier.
    pub(crate) span: Span,
    /// `typeAnnotation.typeAnnotation`, starting at the first comment after the `:`.
    pub(crate) annotation: Option<Span>,
    /// True for comments in the pattern or in the annotation.
    pub(crate) has_comments: bool,
}

impl Pattern {
    /// The span including the annotation, which an identifier's `span` excludes.
    pub(crate) fn with_annotation(self) -> Span {
        Span {
            start: self.span.start,
            end: (self.annotation).map_or(self.span.end, |it| it.end.max(self.span.end)),
        }
    }
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

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum DirectiveKind {
    Use,
    Animate,
    Bind,
    Class,
    On,
    Let,
    /// `in:`, `out:` or `transition:`. The fields are `intro` and `outro`.
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
    /// Its `Text` and `ExpressionTag` nodes.
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
    /// The span of the `this` attribute, if its value has several parts and `this` above is only the first:
    /// `this="h{level}"`.
    pub(crate) multipart_this_attribute: Option<Span>,
    /// Offset of the start tag's `>` or `/>`.
    pub(crate) start_tag_end: u32,
}

#[derive(Debug, Clone)]
pub(crate) enum Kind<'a> {
    /// The printer trims it and merges adjacent text nodes.
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
    /// The declarator, and its `init`.
    ConstTag(Span, Expression),
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
        /// Just past the parameters' `)`.
        end_of_parameters: u32,
        body: FragmentId,
    },
    Script {
        is_module: bool,
        attributes: Vec<Id>,
        /// The text between the tags.
        content: Span,
    },
    StyleSheet {
        attributes: Vec<Id>,
        content: Span,
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
    /// `<svelte:options>`, which isn't in the fragment.
    pub(crate) options: Option<Id>,
    pub(crate) module: Option<Id>,
    pub(crate) instance: Option<Id>,
    pub(crate) css: Option<Id>,
    /// Only the comments between attributes.
    pub(crate) comments: Vec<Comment>,
    /// The plugin's `_svelte_ts` (a `<script>` or `<style>` has `lang="ts"`), or Svelte's `ts`.
    pub(crate) uses_typescript: bool,
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

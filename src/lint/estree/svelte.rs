//! A Svelte component's ESTree as svelte-eslint-parser 1.9 builds it, for JavaScript plugin rules: the component's
//! nodes ([`crate::ast::svelte`]) with its program's nodes inside them wherever the component has code.
//!
//! Its root is [`VNode::svelte_program`]. A component node is `(File, Part::Svelte(id))`. Code consists of the nodes
//! the program has at the code's source position ([`File::svelte_code_roots`]), each node once, so the tree and the
//! scopes share the same objects. What the program has around code isn't a node here: the outermost code node's parent
//! is the component node that has the code ([`VNode::parent_in_component`]). The parameters of `generics` are
//! `TSTypeParameter`s built from the aliases the program declares for them (`Part::Generic`).
//!
//! Component nodes have ranges in the component ([`VNode::is_in_component`]), and program nodes in the program. The
//! serializer maps the latter through the [view](crate::ast::view::View).
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use super::vnode::{Part, VNode};
use super::{NodeType, Nodes};
use crate::ast::svelte::{
    Child, CodeId, CodeKind, Component, Role, Root, SvelteFlags, SvelteId, SvelteKind, SvelteNode,
    SvelteTag, decode_character_references, html_comment_value,
};
use crate::ast::{File, Node, StmtKind};
use crate::span::Span;
use bun_core::strings;

/// A component node's `type`.
pub(super) fn svelte_type(tag: SvelteTag) -> NodeType {
    use NodeType::*;
    match tag {
        SvelteTag::Program => Program,
        SvelteTag::ScriptElement => SvelteScriptElement,
        SvelteTag::StyleElement => SvelteStyleElement,
        SvelteTag::Element => SvelteElement,
        SvelteTag::StartTag => SvelteStartTag,
        SvelteTag::EndTag => SvelteEndTag,
        SvelteTag::Name => SvelteName,
        SvelteTag::MemberExpressionName => SvelteMemberExpressionName,
        SvelteTag::Literal => SvelteLiteral,
        SvelteTag::MustacheTag => SvelteMustacheTag,
        SvelteTag::DebugTag => SvelteDebugTag,
        SvelteTag::ConstTag => SvelteConstTag,
        SvelteTag::DeclarationTag => SvelteDeclarationTag,
        SvelteTag::RenderTag => SvelteRenderTag,
        SvelteTag::IfBlock => SvelteIfBlock,
        SvelteTag::ElseBlock => SvelteElseBlock,
        SvelteTag::EachBlock => SvelteEachBlock,
        SvelteTag::AwaitBlock => SvelteAwaitBlock,
        SvelteTag::AwaitPendingBlock => SvelteAwaitPendingBlock,
        SvelteTag::AwaitThenBlock => SvelteAwaitThenBlock,
        SvelteTag::AwaitCatchBlock => SvelteAwaitCatchBlock,
        SvelteTag::KeyBlock => SvelteKeyBlock,
        SvelteTag::SnippetBlock => SvelteSnippetBlock,
        SvelteTag::Attribute => SvelteAttribute,
        SvelteTag::ShorthandAttribute => SvelteShorthandAttribute,
        SvelteTag::SpreadAttribute => SvelteSpreadAttribute,
        SvelteTag::AttachTag => SvelteAttachTag,
        SvelteTag::Directive => SvelteDirective,
        SvelteTag::StyleDirective => SvelteStyleDirective,
        SvelteTag::SpecialDirective => SvelteSpecialDirective,
        SvelteTag::GenericsDirective => SvelteGenericsDirective,
        SvelteTag::DirectiveKey => SvelteDirectiveKey,
        SvelteTag::SpecialDirectiveKey => SvelteSpecialDirectiveKey,
        SvelteTag::Text => SvelteText,
        SvelteTag::HtmlComment => SvelteHTMLComment,
        SvelteTag::FunctionBindingsExpression => SvelteFunctionBindingsExpression,
    }
}

/// True if nodes of `node_type` only exist in a component's ESTree.
pub(crate) fn is_svelte_type(node_type: NodeType) -> bool {
    node_type.name().starts_with("Svelte")
}

impl<'a> VNode<'a> {
    /// svelte-eslint-parser's `Program` for the component whose program is `file`.
    #[inline]
    pub(crate) fn svelte_program(file: &'a File<'a>) -> VNode<'a> {
        VNode::new(file, Part::Svelte(0))
    }

    /// The node `id` of the component whose program is `file`.
    #[inline]
    pub(crate) fn from_svelte(file: &'a File<'a>, id: SvelteId) -> VNode<'a> {
        VNode::new(file, Part::Svelte(id.0))
    }

    /// The `CatchClause` of the `try` statement `statement`.
    #[inline]
    pub(crate) fn catch_clause(statement: crate::ast::Stmt<'a>) -> VNode<'a> {
        VNode::new(statement, Part::Catch)
    }

    /// The component node it is.
    pub(crate) fn svelte(self) -> Option<SvelteNode<'a>> {
        match self.part {
            Part::Svelte(id) => self.file().svelte_node(SvelteId(id)),
            _ => None,
        }
    }

    /// True if its range is in the component instead of the program: it's a component node, or a parameter of
    /// `generics`.
    #[inline]
    pub(crate) fn is_in_component(self) -> bool {
        matches!(self.part, Part::Svelte(_) | Part::Generic)
    }

    /// ESTree's `parent` in the tree of [`VNode::svelte_program`], if the file is a component's program. Otherwise
    /// [`VNode::parent`].
    pub(crate) fn parent_in_component(self) -> Option<VNode<'a>> {
        if self.file().svelte().is_none() {
            return self.parent();
        }
        if !matches!(self.part, Part::Svelte(_) | Part::SvelteKey | Part::Generic) {
            let natural = self.parent();
            let code = code_of(self);
            let is_inside = natural.is_some_and(|it| {
                !matches!(it.base, Node::File(_)) && code.is_some() && code_of(it) == code
            });
            if is_inside {
                return natural;
            }
            if let Some(code) = code {
                return owner_of_code(self.file(), code);
            }
            return natural;
        }
        parent(self)
    }
}

/// The parent of a component node, of a shorthand attribute's key, and of a parameter of `generics`.
pub(super) fn parent<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    let file = v.file();
    match v.part {
        Part::Svelte(_) => Some(VNode::new(file, Part::Svelte(v.svelte()?.parent()?.id().0))),
        Part::SvelteKey | Part::Generic => {
            owner_of_code(file, code_of(v)?).and_then(|it| match (v.part, it.part) {
                (Part::Generic, Part::Generic) => it.svelte_parent_of_generic(),
                _ => Some(it),
            })
        }
        _ => None,
    }
}

impl<'a> VNode<'a> {
    /// The `SvelteGenericsDirective` that contains `self`, a parameter of `generics`.
    fn svelte_parent_of_generic(self) -> Option<VNode<'a>> {
        let file = self.file();
        let (_, _, owner, _) = file.svelte()?.code(code_of(self)?)?;
        Some(VNode::new(file, Part::Svelte(owner.0)))
    }
}

/// The component's piece of code that contains the program node `v`.
fn code_of(v: VNode<'_>) -> Option<CodeId> {
    let file = v.file();
    let (component, view) = (file.svelte()?, file.view()?);
    let span = match v.part {
        Part::Svelte(_) => return None,
        // The alias is glue, and its name is the parameter.
        Part::Generic => VNode::new(v.base, Part::Name).span(),
        _ => v.span(),
    };
    let start = view.in_file(span.start);
    component.code_at(Span::new(start, start + span.len()))
}

/// The node that contains the outermost nodes of `code`: the component node that has the code, or for a parameter of
/// `generics`, its `TSTypeParameter`.
fn owner_of_code<'a>(file: &'a File<'a>, code: CodeId) -> Option<VNode<'a>> {
    let (_, kind, owner, _) = file.svelte()?.code(code)?;
    if kind == CodeKind::TypeParameters {
        let roots = (0..).map_while(|at| file.svelte_code_root(code, at));
        let alias = roots.into_iter().find_map(|it| match it {
            Root::NameOf(Node::Stmt(alias)) => Some(alias),
            _ => None,
        })?;
        return Some(VNode::new(alias, Part::Generic));
    }
    Some(VNode::new(file, Part::Svelte(owner.0)))
}

/// The tree node for the root `root` of code of `kind`. `None` if it's not a node of its own, like the constraint of a
/// `generics` parameter, which is in its `TSTypeParameter`.
fn from_root(root: Root<'_>, kind: CodeKind) -> Option<VNode<'_>> {
    match (root, kind) {
        (Root::NameOf(Node::Stmt(alias)), CodeKind::TypeParameters) => {
            Some(VNode::new(alias, Part::Generic))
        }
        (_, CodeKind::TypeParameters) => None,
        (Root::NameOf(node), _) => Some(VNode::new(node, Part::Name)),
        (Root::Node(node), _) => outermost(node),
    }
}

/// The outermost of the ESTree nodes built from `node`.
fn outermost(node: Node<'_>) -> Option<VNode<'_>> {
    match node {
        Node::Stmt(statement) => return Some(VNode::from_stmt(statement)),
        Node::Expr(e) => return VNode::from_expr(e),
        Node::Pat(pat) => return VNode::from_pat(pat),
        Node::Param(param) => return Some(VNode::from_param(param)),
        _ => {}
    }
    let mut found = None;
    VNode::for_each_with_type_at(node, &mut |it, _| {
        if found.is_none() {
            found = Some(it);
        }
    });
    found
}

// ───────────────────────────── fields ─────────────────────────────

/// The component node that `v` is.
#[inline]
pub(super) fn svelte_node<'a>(v: VNode<'a>) -> Option<SvelteNode<'a>> {
    v.svelte()
}

/// `v`'s `flag`, if it's one of `kinds`. Otherwise it has no such field.
pub(super) fn flag_of(v: VNode<'_>, kinds: &[SvelteKind], flag: SvelteFlags) -> Option<bool> {
    let node = v.svelte()?;
    kinds.contains(&node.kind()).then(|| node.has(flag))
}

/// The first child with `role`: a component node, or the outermost node of its code.
pub(super) fn child<'a>(v: VNode<'a>, role: Role) -> Option<VNode<'a>> {
    children(v, role).flatten().next()
}

/// The children with `role`, in order.
pub(super) fn children<'a>(v: VNode<'a>, role: Role) -> Nodes<'a> {
    match v.svelte() {
        Some(node) => Nodes::svelte(Children::new(node, role)),
        None => Nodes::EMPTY,
    }
}

/// The blocks whose children svelte-eslint-parser trims: no whitespace text at either end, and the texts at either end
/// without whitespace there (`trimChildren`).
const TRIMS: [SvelteTag; 5] = [
    SvelteTag::IfBlock,
    SvelteTag::ElseBlock,
    SvelteTag::EachBlock,
    SvelteTag::KeyBlock,
    SvelteTag::SnippetBlock,
];

/// The indices in `node`'s [`SvelteNode::children`] of its `children` that are in the tree: all of them, except in a
/// block that trims them ([`TRIMS`]), where it's from the first to the last that isn't a whitespace text.
fn kept(node: SvelteNode<'_>) -> std::ops::Range<u32> {
    let count = node.children().count() as u32;
    if !TRIMS.contains(&node.tag()) {
        return 0..count;
    }
    let is_blank = |at: u32| match node.child_at(at as usize) {
        Some((Role::Children, Child::Node(id))) => {
            node.file().svelte_node(id).is_some_and(is_blank_node)
        }
        Some((Role::Children, _)) => false,
        _ => true,
    };
    let (mut at, mut end) = (0, count);
    while at < end && is_blank(at) {
        at += 1;
    }
    while end > at && is_blank(end - 1) {
        end -= 1;
    }
    at..end
}

/// A component node's children in one role, as [`Nodes`] iterates them.
#[derive(Copy, Clone)]
pub(super) struct Children<'a> {
    node: SvelteNode<'a>,
    role: Role,
    /// The next child of `node`.
    at: u32,
    /// The next root of the code at `at - 1`, if that's code.
    root: u32,
    /// The end of the children with `role` that aren't left out.
    end: u32,
}

impl<'a> Children<'a> {
    fn new(node: SvelteNode<'a>, role: Role) -> Children<'a> {
        let kept = match role {
            Role::Children => kept(node),
            _ => 0..node.children().count() as u32,
        };
        Children {
            node,
            role,
            at: kept.start,
            root: u32::MAX,
            end: kept.end,
        }
    }

    pub(super) fn next(&mut self) -> Option<VNode<'a>> {
        let file = self.node.file();
        loop {
            if self.root != u32::MAX
                && let Some((_, Child::Code(code))) =
                    self.node.child_at(self.at.checked_sub(1)? as usize)
            {
                let kind = file.svelte().and_then(|it| it.code(code)).map(|it| it.1);
                match file.svelte_code_root(code, self.root as usize).zip(kind) {
                    Some((root, kind)) => {
                        self.root += 1;
                        if let Some(it) = from_root(root, kind) {
                            return Some(it);
                        }
                        continue;
                    }
                    None => self.root = u32::MAX,
                }
            }
            if self.at >= self.end {
                return None;
            }
            let (role, child) = self.node.child_at(self.at as usize)?;
            self.at += 1;
            if role != self.role {
                continue;
            }
            match child {
                // The value of `a=""` is empty, not an empty text.
                Child::Node(id)
                    if role == Role::Value
                        && file.svelte_node(id).is_some_and(|it| {
                            it.tag() == SvelteTag::Literal && it.span().is_empty()
                        }) => {}
                Child::Node(id) => return Some(VNode::new(file, Part::Svelte(id.0))),
                Child::Code(_) => self.root = 0,
                Child::Part(_) => {}
            }
        }
    }
}

// ───────────────────────────── text ─────────────────────────────

/// The component spans of svelte-eslint-parser's `HTMLText` tokens for markup texts and attribute values: one token per
/// whitespace run and per non-whitespace run, for each text in its tree (`extractTextTokens`). Excludes `<style>`,
/// which is one token. In component order.
pub(crate) fn svelte_text_tokens<'a>(file: &'a File<'a>) -> Vec<Span> {
    let Some(component) = file.svelte() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let left_out = left_out_texts(file, component);
    for tag in [SvelteTag::Text, SvelteTag::Literal] {
        for id in component.ids_of(tag) {
            let Some(node) = file.svelte_node(id) else {
                continue;
            };
            let parent = node.parent();
            let is_left_out = left_out.binary_search(&id.0).is_ok();
            if parent.is_some_and(|it| it.tag() == SvelteTag::StyleElement) || is_left_out {
                continue;
            }
            let (text, start) = (node.text(), node.span().start);
            let blank_at =
                |it: usize| strings::js_whitespace_len(text.get(it..).unwrap_or_default());
            let mut at = 0;
            while at < text.len() {
                let blank = blank_at(at) > 0;
                let mut end = at;
                while end < text.len() && (blank_at(end) > 0) == blank {
                    end += match blank {
                        true => blank_at(end),
                        false => bun_core::lexer::char_and_size(text, end).1.max(1),
                    };
                }
                out.push(Span::new(start + at as u32, start + end as u32));
                at = end;
            }
        }
    }
    crate::utils::sort::sort_by_key(&mut out, |it| it.start);
    out
}

/// The indices of the texts that aren't in the tree, in order: the whitespace texts at either end of a trimming block's
/// children.
fn left_out_texts<'a>(file: &'a File<'a>, component: &Component) -> Vec<u32> {
    let mut out = Vec::new();
    for id in TRIMS.into_iter().flat_map(|tag| component.ids_of(tag)) {
        let Some(block) = file.svelte_node(id) else {
            continue;
        };
        let kept = kept(block);
        for (at, (role, child)) in (0..).zip(block.children()) {
            if let (Role::Children, Child::Node(text)) = (role, child)
                && !kept.contains(&at)
            {
                out.push(text.0);
            }
        }
    }
    out.sort_unstable();
    out
}

/// The `value` of a `SvelteText`, a `SvelteLiteral` or a `SvelteHTMLComment`.
pub(super) fn text_value<'a>(v: VNode<'a>) -> Option<&'a [u8]> {
    let node = v.svelte()?;
    let component = v.file().svelte()?;
    let values = component.values_with(|component| values_of(v.file(), component));
    match values.get(node.id().0 as usize) {
        Some(Some(value)) => Some(value),
        _ => Some(match node.tag() {
            SvelteTag::HtmlComment => html_comment_value(node.text()).unwrap_or_default(),
            _ => node.text(),
        }),
    }
}

/// The values of the component's texts that differ from the source text: decoded, or trimmed.
fn values_of<'a>(file: &'a File<'a>, component: &Component) -> Box<[Option<Box<[u8]>>]> {
    let mut values: Vec<Option<Box<[u8]>>> = Vec::new();
    let set = |values: &mut Vec<Option<Box<[u8]>>>, id: SvelteId, value: Box<[u8]>| {
        let index = id.0 as usize;
        if values.len() <= index {
            values.resize(index + 1, None);
        }
        values[index] = Some(value);
    };
    for tag in [SvelteTag::Text, SvelteTag::Literal] {
        for id in component.ids_of(tag) {
            let Some(node) = file.svelte_node(id) else {
                continue;
            };
            if node
                .parent()
                .is_some_and(|it| it.tag() == SvelteTag::StyleElement)
            {
                continue;
            }
            let decoded = decode_character_references(node.text(), tag == SvelteTag::Literal);
            if let std::borrow::Cow::Owned(value) = decoded {
                set(&mut values, id, value.into_boxed_slice());
            }
        }
    }
    // A block's first and last kept child lose their whitespace at that end, if they're texts.
    for id in TRIMS.into_iter().flat_map(|tag| component.ids_of(tag)) {
        let Some(block) = file.svelte_node(id) else {
            continue;
        };
        let kept = kept(block);
        let Some(last) = kept.end.checked_sub(1).filter(|it| *it >= kept.start) else {
            continue;
        };
        for (at, at_start) in [(kept.start, true), (last, false)] {
            let Some((Role::Children, Child::Node(text))) = block.child_at(at as usize) else {
                continue;
            };
            let Some(node) = file
                .svelte_node(text)
                .filter(|it| it.tag() == SvelteTag::Text)
            else {
                continue;
            };
            let value = (values.get(text.0 as usize))
                .and_then(|it| it.as_deref())
                .unwrap_or_else(|| node.text());
            let trimmed = match at_start {
                true => strings::trim_js_whitespace_start(value),
                false => strings::trim_js_whitespace_end(value),
            };
            if trimmed.len() != value.len() {
                let trimmed: Box<[u8]> = trimmed.into();
                set(&mut values, text, trimmed);
            }
        }
    }
    values.into_boxed_slice()
}

fn is_blank_node(node: SvelteNode<'_>) -> bool {
    node.tag() == SvelteTag::Text && is_blank_text(node.text())
}

/// A text's `data.trim() === ""`, as Svelte decodes it.
fn is_blank_text(raw: &[u8]) -> bool {
    strings::trim_js_whitespace(&decode_character_references(raw, false)).is_empty()
}

// ───────────────────────────── `generics` ─────────────────────────────

/// The range of the `TSTypeParameter` `v` in the component.
pub(super) fn generic_span(v: VNode<'_>) -> Option<Span> {
    let file = v.file();
    Some(file.svelte()?.code(code_of(v)?)?.0)
}

/// The alias the program declares for the `generics` parameter `v`.
fn alias<'a>(v: VNode<'a>) -> Option<crate::ast::Alias<'a>> {
    match v.stmt()?.kind() {
        StmtKind::TypeAlias(alias) => Some(alias),
        _ => None,
    }
}

/// A `generics` parameter's `constraint`: its alias's type, unless that's synthesized.
pub(super) fn generic_constraint<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    let ty = alias(v)?.ty();
    let view = v.file().view()?;
    view.is_copy(ty.span().start).then(|| VNode::from_type(ty))
}

/// A `generics` parameter's `default`: the copy of it that the program puts in the default's alias.
pub(super) fn generic_default<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    let file = v.file();
    let code = code_of(v)?;
    let constraint = alias(v)?.ty();
    (0..)
        .map_while(|at| file.svelte_code_root(code, at))
        .find_map(|it| match it {
            Root::Node(Node::Type(ty)) if ty != constraint => Some(VNode::from_type(ty)),
            _ => None,
        })
}

/// True if the `generics` parameter `v` is written with `keyword` before its name: `const`, `in`, `out`.
pub(super) fn generic_has(v: VNode<'_>, keyword: &[u8]) -> bool {
    let (Some(span), Some(component)) = (generic_span(v), v.file().svelte()) else {
        return false;
    };
    let name = VNode::new(v.base, Part::Name).span();
    let name_start = v
        .file()
        .view()
        .map_or(name.start, |it| it.in_file(name.start));
    let before = component
        .text()
        .get(span.start as usize..name_start.max(span.start) as usize)
        .unwrap_or_default();
    strings::split(before, b" ").any(|it| it == keyword)
}

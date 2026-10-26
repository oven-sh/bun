//! The component as svelte-eslint-parser 1.9 presents it (`bun_lint::ast::svelte`), built from the formatter's Svelte
//! parser tree while that tree is alive: svelte-eslint-parser's converters (`parser/converts/*.ts`), rewritten as the
//! parts each kind of node consists of.
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use bun_core::strings;
use bun_format::svelte::ast::{
    self, DirectiveKind, ElementKind, FragmentId, Id, Kind, Tree, Value, span_in,
};
use bun_lint::ast::StmtKind;
use bun_lint::ast::svelte::{
    Builder, CodeKind, Component, Role, SvelteFlags, SvelteId, SvelteKind, SvelteTag,
};
use bun_lint::span::Span;

/// The part of a tree node that a component node stands for: the node itself, or one of a block's clauses.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Part {
    Node,
    /// The `{:else}` of an `{#if}` or an `{#each}`.
    Else,
    /// What an `{#await}` shows while it waits.
    Pending,
    Then,
    Catch,
}

/// The component, and the component node for each tree node and each clause.
pub(crate) struct Summary {
    pub(crate) component: Component,
    /// Sorted.
    ids: Vec<(Id, Part, SvelteId)>,
}

impl Summary {
    pub(crate) fn id_of(&self, id: Id, part: Part) -> Option<SvelteId> {
        let at = self
            .ids
            .partition_point(|it| (it.0, it.1 as u8) < (id, part as u8));
        self.ids
            .get(at)
            .filter(|it| it.0 == id && it.1 == part)
            .map(|it| it.2)
    }
}

/// The number of expressions in the sequence `text`: `a, b` has two.
fn sequence_length(text: &[u8]) -> usize {
    let program = [b"(", text, b");"].concat();
    let code = bun_format::options::Code {
        path: b"sequence.ts",
        text: &program,
        is_script: false,
    };
    let mut length = 0;
    crate::fmt::parse_javascript(code, &mut |file| {
        if file.has_parse_errors() {
            return;
        }
        if let Some(StmtKind::Expr(e)) = file.body().iter().next().map(|it| it.kind()) {
            length = e.sequence().len();
        }
    });
    length
}

/// True if `e`, the value of a `bind:` in `parsed`, is two functions: svelte-eslint-parser's `isFunctionBindings`, a
/// sequence of two expressions with only whitespace and comments between it and the last `{` before it.
pub(crate) fn is_function_bindings(parsed: &[u8], e: &ast::Expression) -> bool {
    let start = e.span.start as usize;
    let up_to = parsed.get(..(start + 1).min(parsed.len()));
    let open = up_to.and_then(|it| strings::last_index_of_char(it, b'{'));
    let between = open.and_then(|it| parsed.get(it + 1..start));
    e.kind == ast::ExpressionKind::Sequence
        && between.is_some_and(is_blank_without_comments)
        && (parsed.get(e.span.start as usize..e.span.end as usize))
            .is_some_and(|it| sequence_length(it) == 2)
}

/// True if `text` is whitespace once the parts svelte-eslint-parser treats as comments are removed: `//` up to and
/// including the next line break, and `/*` up to the next `*/`.
fn is_blank_without_comments(mut text: &[u8]) -> bool {
    loop {
        let (kept, rest) =
            text.split_at(strings::index_of_char_usize(text, b'/').unwrap_or(text.len()));
        if !strings::trim_js_whitespace(kept).is_empty() {
            return false;
        }
        let comment = match rest {
            [] => return true,
            [_, b'/', after @ ..] => strings::index_of_char_usize(after, b'\n').map(|it| it + 3),
            [_, b'*', after @ ..] => strings::index_of(after, b"*/").map(|it| it + 4),
            _ => None,
        };
        // A `/` that doesn't start a comment stays.
        let Some(rest) = comment.and_then(|it| rest.get(it..)) else {
            return false;
        };
        text = rest;
    }
}

/// True if the markup text `raw` is JavaScript whitespace once Svelte decodes it: `data.trim() === ""`, where `data` is
/// `decode_character_references(raw, false)`, which turns `&nbsp;` and `&#32;` into whitespace.
fn is_blank_text(mut raw: &[u8]) -> bool {
    loop {
        let (plain, rest) =
            raw.split_at(strings::index_of_char_usize(raw, b'&').unwrap_or(raw.len()));
        if !strings::trim_js_whitespace(plain).is_empty() {
            return false;
        }
        let Some(after) = rest.get(1..) else {
            return true;
        };
        let Some(length) = white_space_reference(after) else {
            return false;
        };
        raw = after.get(length..).unwrap_or_default();
    }
}

/// The names of the references that Svelte decodes to whitespace, in the order its pattern tries them. No name it tries
/// before them is a prefix of them.
const WHITE_SPACE_ENTITIES: [&[u8]; 17] = [
    b"NonBreakingSpace;",
    b"VeryThinSpace;",
    b"MediumSpace;",
    b"ThickSpace;",
    b"ThinSpace;",
    b"NewLine;",
    b"emsp13;",
    b"emsp14;",
    b"hairsp;",
    b"puncsp;",
    b"thinsp;",
    b"numsp;",
    b"emsp;",
    b"ensp;",
    b"nbsp;",
    b"Tab;",
    b"nbsp",
];

/// The length of the reference at the start of `text`, after its `&`, if Svelte decodes it to whitespace in a text: one
/// of [`WHITE_SPACE_ENTITIES`], or `#` and a number, with or without `;`, whose code point `validate_code` keeps as
/// whitespace.
fn white_space_reference(text: &[u8]) -> Option<usize> {
    let Some(number) = text.strip_prefix(b"#") else {
        let name = WHITE_SPACE_ENTITIES
            .iter()
            .find(|it| text.starts_with(it))?;
        return Some(name.len());
    };
    let (radix, digits) = match number {
        [b'x' | b'X', digits @ ..] => (16, digits),
        _ => (10, number),
    };
    let count = digits
        .iter()
        .take_while(|it| (**it as char).is_digit(radix))
        .count();
    let code = digits
        .get(..count)
        .unwrap_or_default()
        .iter()
        .fold(0u32, |code, digit| {
            let digit = (*digit as char).to_digit(radix).unwrap_or(0);
            code.saturating_mul(radix).saturating_add(digit)
        });
    let is_white_space = matches!(
        code,
        9..=13 | 32 | 160 | 5760 | 8192..=8202 | 8232 | 8233 | 8239 | 8287 | 12288 | 65279
    );
    let semicolon = usize::from(digits.get(count) == Some(&b';'));
    (count > 0 && is_white_space).then(|| text.len() - digits.len() + count + semicolon)
}

fn span(start: u32, end: u32) -> Span {
    Span::new(start, end.max(start))
}

fn of(span: ast::Span) -> Span {
    Span::new(span.start, span.end.max(span.start))
}

/// The tag of the node or fragment `id`, from the sorted `tags`.
fn find(tags: &[(u32, ast::Span)], id: u32) -> Option<Span> {
    let at = tags.partition_point(|it| it.0 < id);
    tags.get(at).filter(|it| it.0 == id).map(|it| of(it.1))
}

fn sorted(tags: &[(u32, ast::Span)]) -> Vec<(u32, ast::Span)> {
    let mut tags = tags.to_vec();
    bun_lint::utils::sort::sort_by_key(&mut tags, |it| it.0);
    tags
}

/// The instance script's `generics` attribute that svelte-eslint-parser reads as type parameters, and each one's
/// position.
pub(crate) struct Generics {
    pub(crate) attribute: Id,
    pub(crate) parameters: Vec<Span>,
}

/// Summarizes the component `text`, whose tree is `tree`. `parsed` is the text the tree's names point into, as long as
/// `text`. `None` if it's nested deeper than the stack allows.
pub(crate) fn summarize(
    text: &[u8],
    parsed: &[u8],
    tree: &Tree<'_>,
    generics: Option<Generics>,
) -> Option<Summary> {
    let mut summarizer = Summarizer {
        builder: Builder::new(text),
        tree,
        parsed,
        generics,
        ids: Vec::new(),
        open_tags: sorted(&tree.open_tags),
        end_tags: sorted(&tree.end_tags),
        clause_tags: sorted(&tree.clause_tags),
        end_of_if: None,
        stack: bun_core::StackCheck::init(),
        is_too_deep: false,
    };
    for id in tree.top_level() {
        summarizer.node(id, Role::Body);
    }
    if summarizer.is_too_deep {
        return None;
    }
    let mut ids = summarizer.ids;
    bun_lint::utils::sort::sort_by_key(&mut ids, |it| (it.0, it.1 as u8));
    Some(Summary {
        component: summarizer.builder.finish(),
        ids,
    })
}

struct Summarizer<'s, 't> {
    builder: Builder,
    tree: &'s Tree<'t>,
    parsed: &'s [u8],
    generics: Option<Generics>,
    ids: Vec<(Id, Part, SvelteId)>,
    /// Keyed by the node or fragment.
    open_tags: Vec<(u32, ast::Span)>,
    end_tags: Vec<(u32, ast::Span)>,
    clause_tags: Vec<(u32, ast::Span)>,
    /// The `{/if}` of the `{#if}` that contains the node, because an `{:else if}` has none of its own.
    end_of_if: Option<Span>,
    stack: bun_core::StackCheck,
    /// True if a node was left out because the stack wouldn't have held it.
    is_too_deep: bool,
}

impl Summarizer<'_, '_> {
    fn open(&mut self, tag: SvelteTag, role: Role, span: Span, of: (Id, Part)) -> SvelteId {
        let id = self.builder.open(tag, role, span);
        self.ids.push((of.0, of.1, id));
        id
    }

    fn name_span(&self, name: &[u8]) -> Option<Span> {
        span_in(self.parsed, name).map(of)
    }

    fn end_tag(&self, id: Id) -> Option<Span> {
        find(&self.end_tags, id)
    }

    fn clause_tag(&self, fragment: FragmentId) -> Option<Span> {
        find(&self.clause_tags, fragment)
    }

    fn fragment(&mut self, fragment: FragmentId) {
        let tree = self.tree;
        for &id in tree.fragment(fragment) {
            self.node(id, Role::Children);
        }
    }

    /// A block's children, without the whitespace texts at either end (`trimChildren`).
    fn block_fragment(&mut self, fragment: FragmentId) {
        let tree = self.tree;
        let is_blank = |id: &&Id| match &tree[**id].kind {
            Kind::Text { raw } => is_blank_text(raw),
            _ => false,
        };
        let mut children = tree.fragment(fragment);
        while let Some((first, rest)) = children.split_first()
            && is_blank(&first)
        {
            children = rest;
        }
        while let Some((last, rest)) = children.split_last()
            && is_blank(&last)
        {
            children = rest;
        }
        for &id in children {
            self.node(id, Role::Children);
        }
    }

    /// The values of an attribute or a style directive: texts and mustaches.
    fn values(&mut self, value: &Value) {
        let tree = self.tree;
        for &part in value.parts() {
            let at = span(tree[part].start, tree[part].end);
            match &tree[part].kind {
                Kind::ExpressionTag(e) => {
                    self.open(SvelteTag::MustacheTag, Role::Value, at, (part, Part::Node));
                    self.builder.kind(SvelteKind::Text);
                    self.builder
                        .code(Role::Expression, of(e.span), CodeKind::Expression);
                    self.builder.close();
                }
                _ => {
                    self.open(SvelteTag::Literal, Role::Value, at, (part, Part::Node));
                    self.builder.close();
                }
            }
        }
    }

    /// `DirectiveKey`: the name and modifiers of `kind:name|a|b`, which starts at `start`. With `code`, the name is
    /// code of that kind, as for `use:`, `transition:`, `animate:` and a `style:name` without a value. Otherwise it's a
    /// `SvelteName`.
    fn directive_key(
        &mut self,
        start: u32,
        name: &[u8],
        modifiers: &[&[u8]],
        code: Option<CodeKind>,
    ) {
        let name_span = self.name_span(name);
        let modifiers: Vec<Span> = modifiers
            .iter()
            .filter_map(|it| self.name_span(it))
            .collect();
        let end = (modifiers.last().copied().or(name_span)).map_or(start, |it| it.end);
        self.builder
            .open(SvelteTag::DirectiveKey, Role::Key, span(start, end));
        match (name_span, code) {
            (Some(name), Some(kind)) => self.builder.code(Role::Name, name, kind),
            (Some(name), None) => {
                self.builder.leaf(SvelteTag::Name, Role::Name, name);
            }
            (None, _) => {}
        }
        for modifier in modifiers {
            self.builder.part(Role::Modifier, modifier);
        }
        self.builder.close();
    }

    fn attribute(&mut self, id: Id, is_this: bool) {
        let tree = self.tree;
        let node = &tree[id];
        let at = span(node.start, node.end);
        match &node.kind {
            Kind::Attribute { name, value } if is_this => {
                self.open(
                    SvelteTag::SpecialDirective,
                    Role::Attributes,
                    at,
                    (id, Part::Node),
                );
                self.builder.kind(SvelteKind::This);
                self.builder.leaf(
                    SvelteTag::SpecialDirectiveKey,
                    Role::Key,
                    span(node.start, node.start + name.len() as u32),
                );
                if let [only] = value.parts()
                    && let Kind::ExpressionTag(e) = &tree[*only].kind
                {
                    self.builder
                        .code(Role::Expression, of(e.span), CodeKind::Expression);
                }
                self.builder.close();
            }
            Kind::Attribute { name, .. }
                if self.generics.as_ref().is_some_and(|it| it.attribute == id) =>
            {
                let parameters =
                    (self.generics.as_ref()).map_or(Vec::new(), |it| it.parameters.clone());
                self.open(
                    SvelteTag::GenericsDirective,
                    Role::Attributes,
                    at,
                    (id, Part::Node),
                );
                let key = span(node.start, node.start + name.len() as u32);
                self.builder.leaf(SvelteTag::Name, Role::Key, key);
                for parameter in parameters {
                    self.builder
                        .code(Role::Params, parameter, CodeKind::TypeParameters);
                }
                self.builder.close();
            }
            Kind::Attribute { name, value } => {
                // `{a}`
                if self.parsed.get(node.start as usize) == Some(&b'{')
                    && let Value::Tag(tag) = value
                    && let Kind::ExpressionTag(e) = &tree[*tag].kind
                {
                    self.open(
                        SvelteTag::ShorthandAttribute,
                        Role::Attributes,
                        at,
                        (id, Part::Node),
                    );
                    self.builder
                        .code(Role::Key, of(e.span), CodeKind::Identifier);
                    self.builder
                        .code(Role::Value, of(e.span), CodeKind::Expression);
                    self.builder.close();
                    return;
                }
                self.open(SvelteTag::Attribute, Role::Attributes, at, (id, Part::Node));
                if *value == Value::True {
                    self.builder.flag(SvelteFlags::BOOLEAN);
                }
                let key = span(node.start, node.start + name.len() as u32);
                self.builder.leaf(SvelteTag::Name, Role::Key, key);
                self.values(value);
                self.builder.close();
            }
            Kind::SpreadAttribute(e) => {
                self.open(
                    SvelteTag::SpreadAttribute,
                    Role::Attributes,
                    at,
                    (id, Part::Node),
                );
                self.builder
                    .code(Role::Argument, of(e.span), CodeKind::Expression);
                self.builder.close();
            }
            Kind::AttachTag(e) => {
                self.open(SvelteTag::AttachTag, Role::Attributes, at, (id, Part::Node));
                self.builder
                    .code(Role::Expression, of(e.span), CodeKind::Expression);
                self.builder.close();
            }
            Kind::Directive {
                kind,
                name,
                modifiers,
                expression,
            } => {
                self.open(SvelteTag::Directive, Role::Attributes, at, (id, Part::Node));
                self.builder.kind(match kind {
                    DirectiveKind::Use => SvelteKind::Action,
                    DirectiveKind::Animate => SvelteKind::Animation,
                    DirectiveKind::Bind => SvelteKind::Binding,
                    DirectiveKind::Class => SvelteKind::Class,
                    DirectiveKind::On => SvelteKind::EventHandler,
                    DirectiveKind::Let => SvelteKind::Let,
                    DirectiveKind::Transition(..) => SvelteKind::Transition,
                });
                if let DirectiveKind::Transition(intro, outro) = kind {
                    if *intro {
                        self.builder.flag(SvelteFlags::INTRO);
                    }
                    if *outro {
                        self.builder.flag(SvelteFlags::OUTRO);
                    }
                }
                let name_span = self.name_span(name);
                let is_shorthand = expression.is_some_and(|it| Some(of(it.span)) == name_span);
                if is_shorthand {
                    self.builder.flag(SvelteFlags::SHORTHAND);
                }
                // `processName` for these: the name is a program expression.
                let code = match kind {
                    DirectiveKind::Use | DirectiveKind::Animate | DirectiveKind::Transition(..)
                        if !is_shorthand =>
                    {
                        Some(CodeKind::Expression)
                    }
                    _ => None,
                };
                self.directive_key(node.start, name, modifiers, code);
                match (kind, expression) {
                    // What `let:` declares: its pattern, or its name.
                    (DirectiveKind::Let, _) => {
                        let declared = expression.map(|it| of(it.span)).or(name_span);
                        if let Some(declared) = declared {
                            self.builder
                                .code(Role::Expression, declared, CodeKind::Pattern);
                        }
                    }
                    // `bind:value={get, set}`: both functions, which the program has as two expressions.
                    (DirectiveKind::Bind, Some(e)) if is_function_bindings(self.parsed, e) => {
                        let at = of(e.span);
                        self.builder.open(
                            SvelteTag::FunctionBindingsExpression,
                            Role::Expression,
                            at,
                        );
                        self.builder
                            .code(Role::Expressions, at, CodeKind::Expression);
                        self.builder.close();
                    }
                    (_, Some(e)) => {
                        self.builder
                            .code(Role::Expression, of(e.span), CodeKind::Expression)
                    }
                    (_, None) => {}
                }
                self.builder.close();
            }
            Kind::StyleDirective {
                name,
                modifiers,
                value,
            } => {
                self.open(
                    SvelteTag::StyleDirective,
                    Role::Attributes,
                    at,
                    (id, Part::Node),
                );
                // `style:color` reads the variable `color`.
                let code = (*value == Value::True).then_some(CodeKind::Identifier);
                if code.is_some() {
                    self.builder.flag(SvelteFlags::SHORTHAND);
                }
                self.directive_key(node.start, name, modifiers, code);
                self.values(value);
                self.builder.close();
            }
            _ => {}
        }
    }

    /// `startTag` for the node that starts at `start` and whose `>` or `/>` is at `end`.
    fn start_tag(
        &mut self,
        start: u32,
        end: u32,
        attributes: &[Id],
        is_self_closing: bool,
        this: Option<Id>,
    ) {
        self.builder
            .open(SvelteTag::StartTag, Role::StartTag, span(start, end));
        if is_self_closing {
            self.builder.flag(SvelteFlags::SELF_CLOSING);
        }
        let mut all: Vec<Id> = attributes.to_vec();
        all.extend(this);
        let tree = self.tree;
        bun_lint::utils::sort::sort_by_key(&mut all, |&it| tree[it].start);
        for id in all {
            self.attribute(id, Some(id) == this);
        }
        self.builder.close();
    }

    fn element(&mut self, id: Id, element: &ast::Element<'_>, role: Role) {
        let node = &self.tree[id];
        let kind = match element.kind {
            ElementKind::RegularElement | ElementKind::TitleElement | ElementKind::SlotElement => {
                SvelteKind::Html
            }
            ElementKind::Component => SvelteKind::Component,
            _ => SvelteKind::Special,
        };
        self.open(
            SvelteTag::Element,
            role,
            span(node.start, node.end),
            (id, Part::Node),
        );
        self.builder.kind(kind);
        if let Some(name) = self.name_span(element.name) {
            match kind {
                SvelteKind::Component => self.component_name(element.name, name),
                _ => {
                    self.builder.leaf(SvelteTag::Name, Role::Name, name);
                }
            }
        }
        let tag_end = element.start_tag_end + if element.is_self_closing { 2 } else { 1 };
        let this = element.this_definition;
        self.start_tag(
            node.start,
            tag_end,
            &element.attributes,
            element.is_self_closing,
            this,
        );
        self.fragment(element.fragment);
        if let Some(end_tag) = self.end_tag(id) {
            self.builder.leaf(SvelteTag::EndTag, Role::EndTag, end_tag);
        }
        self.builder.close();
    }

    /// The name of a component, `text` at `at`: a variable, or for `A.B.C` a `SvelteMemberExpressionName` per dot,
    /// whose object is the one for the previous dot, and the variable `A` for the first.
    fn component_name(&mut self, text: &[u8], at: Span) {
        let mut dots: Vec<u32> = Vec::new();
        let mut from = 0;
        while let Some(dot) = text
            .get(from..)
            .and_then(|it| strings::index_of_char_usize(it, b'.'))
        {
            dots.push(at.start + (from + dot) as u32);
            from += dot + 1;
        }
        // The outermost one is opened first and ends where the name ends. Each inner one ends at the next dot.
        let ends: Vec<u32> = match dots.split_first() {
            Some((_, rest)) => rest.iter().copied().chain([at.end]).collect(),
            None => Vec::new(),
        };
        for (&end, depth) in ends.iter().rev().zip(0..) {
            let role = if depth == 0 { Role::Name } else { Role::Object };
            self.builder
                .open(SvelteTag::MemberExpressionName, role, span(at.start, end));
        }
        let first_end = dots.first().copied().unwrap_or(at.end);
        let role = if dots.is_empty() {
            Role::Name
        } else {
            Role::Object
        };
        self.builder
            .code(role, span(at.start, first_end), CodeKind::Expression);
        for (&dot, &end) in dots.iter().zip(&ends) {
            self.builder
                .leaf(SvelteTag::Name, Role::Property, span(dot + 1, end));
            self.builder.close();
        }
    }

    /// The end of the last node of `fragment`, if it has one: ESLint's `endIndexFromFragment`.
    fn end_of_fragment(&self, fragment: FragmentId) -> Option<u32> {
        let tree = self.tree;
        tree.fragment(fragment).last().map(|&it| tree[it].end)
    }

    /// The position after the first `}` from `from` on: `ctx.code.indexOf("}", from) + 1`.
    fn behind_brace(&self, from: u32) -> u32 {
        let rest = self.parsed.get(from as usize..).unwrap_or_default();
        strings::index_of_char_usize(rest, b'}').map_or(0, |it| from + it as u32 + 1)
    }

    /// The `{:else}` of `block`, for `fragment`, which is at `close_start` without its own tag. Without children an
    /// `{#each}`'s is empty, and an `{#if}`'s ends with its tag.
    fn else_block(&mut self, block: Id, fragment: FragmentId, close_start: u32, is_each: bool) {
        let clause = self.clause_tag(fragment);
        let start = clause.map_or(close_start, |it| it.start);
        let tree = self.tree;
        let children = tree.fragment(fragment);
        let else_if = children.iter().find(|&&it| {
            matches!(
                tree[it].kind,
                Kind::IfBlock {
                    is_else_if: true,
                    ..
                }
            )
        });
        // An `{:else if}` ends where its inner block ends.
        let end = match (else_if, self.end_of_fragment(fragment)) {
            (Some(&it), _) => tree[it].end,
            (None, Some(end)) => end,
            (None, None) if is_each => start,
            (None, None) => self.behind_brace(start + 5),
        };
        self.open(
            SvelteTag::ElseBlock,
            Role::Else,
            span(start, end),
            (block, Part::Else),
        );
        if else_if.is_some() {
            self.builder.flag(SvelteFlags::ELSE_IF);
        }
        self.block_fragment(fragment);
        if let Some(clause) = clause {
            self.builder.part(Role::OpenTag, clause);
        }
        self.builder.close();
    }

    fn node(&mut self, id: Id, role: Role) {
        if self.is_too_deep || !self.stack.is_safe_to_recurse() {
            self.is_too_deep = true;
            return;
        }
        let tree = self.tree;
        let node = &tree[id];
        let at = span(node.start, node.end);
        let open_tag = find(&self.open_tags, id);
        let end_tag = self.end_tag(id);
        let close_start = end_tag.map_or(node.end, |it| it.start);
        match &node.kind {
            Kind::Text { .. } => {
                self.open(SvelteTag::Text, role, at, (id, Part::Node));
                self.builder.close();
            }
            Kind::Comment { .. } => {
                self.open(SvelteTag::HtmlComment, role, at, (id, Part::Node));
                self.builder.close();
            }
            Kind::Element(element) => self.element(id, element, role),
            Kind::ExpressionTag(e) | Kind::HtmlTag(e) => {
                self.open(SvelteTag::MustacheTag, role, at, (id, Part::Node));
                self.builder.kind(match node.kind {
                    Kind::HtmlTag(_) => SvelteKind::Raw,
                    _ => SvelteKind::Text,
                });
                self.builder
                    .code(Role::Expression, of(e.span), CodeKind::Expression);
                self.builder.close();
            }
            Kind::RenderTag(e) => {
                self.open(SvelteTag::RenderTag, role, at, (id, Part::Node));
                self.builder
                    .code(Role::Expression, of(e.span), CodeKind::Expression);
                self.builder.close();
            }
            Kind::ConstTag(declarator, _) => {
                self.open(SvelteTag::ConstTag, role, at, (id, Part::Node));
                self.builder
                    .code(Role::Declarations, of(*declarator), CodeKind::Declarator);
                self.builder.close();
            }
            Kind::DeclarationTag(declaration) => {
                self.open(SvelteTag::DeclarationTag, role, at, (id, Part::Node));
                self.builder
                    .code(Role::Declaration, of(*declaration), CodeKind::Declaration);
                self.builder.close();
            }
            Kind::DebugTag(names) => {
                self.open(SvelteTag::DebugTag, role, at, (id, Part::Node));
                for name in names {
                    self.builder
                        .code(Role::Identifiers, of(*name), CodeKind::Identifier);
                }
                self.builder.close();
            }
            Kind::IfBlock {
                is_else_if,
                test,
                consequent,
                alternate,
            } => {
                let outer = self.end_of_if;
                let end_of_if = end_tag.or_else(|| outer.filter(|_| *is_else_if));
                self.open(SvelteTag::IfBlock, role, at, (id, Part::Node));
                if *is_else_if {
                    self.builder.flag(SvelteFlags::ELSE_IF);
                }
                self.builder
                    .code(Role::Expression, of(test.span), CodeKind::Expression);
                self.end_of_if = None;
                self.block_fragment(*consequent);
                if let Some(alternate) = alternate {
                    self.end_of_if = end_of_if;
                    let close_start = end_of_if.map_or(node.end, |it| it.start);
                    self.else_block(id, *alternate, close_start, false);
                }
                self.end_of_if = outer;
                self.parts(open_tag, end_tag);
                self.builder.close();
            }
            Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback,
            } => {
                self.open(SvelteTag::EachBlock, role, at, (id, Part::Node));
                self.builder
                    .code(Role::Expression, of(expression.span), CodeKind::Expression);
                if let Some(context) = context {
                    self.builder.code(
                        Role::Context,
                        of(context.with_annotation()),
                        CodeKind::Pattern,
                    );
                }
                if let Some(index) = index.and_then(|it| self.name_span(it)) {
                    self.builder.code(Role::Index, index, CodeKind::Identifier);
                }
                if let Some(key) = key {
                    self.builder
                        .code(Role::Key, of(key.span), CodeKind::Expression);
                }
                self.block_fragment(*body);
                if let Some(fallback) = fallback {
                    self.else_block(id, *fallback, close_start, true);
                }
                self.parts(open_tag, end_tag);
                self.builder.close();
            }
            Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            } => {
                // Each clause from its tag on, except the one the opening tag has, which has no tag of its own.
                let clauses = [
                    (
                        *pending,
                        SvelteTag::AwaitPendingBlock,
                        Role::Pending,
                        Part::Pending,
                        None,
                        SvelteFlags::empty(),
                    ),
                    (
                        *then,
                        SvelteTag::AwaitThenBlock,
                        Role::Then,
                        Part::Then,
                        value.map(|it| (Role::Value, it)),
                        SvelteFlags::AWAIT_THEN,
                    ),
                    (
                        *catch,
                        SvelteTag::AwaitCatchBlock,
                        Role::Catch,
                        Part::Catch,
                        error.map(|it| (Role::Error, it)),
                        SvelteFlags::AWAIT_CATCH,
                    ),
                ];
                let clauses = clauses.map(|(fragment, tag, role, part, pattern, flag)| {
                    let clause = fragment.map(|it| (it, self.clause_tag(it)));
                    (clause, tag, role, part, pattern, flag)
                });
                let kind = match clauses
                    .iter()
                    .find(|it| it.0.is_some_and(|it| it.1.is_none()))
                {
                    Some(it) if it.1 == SvelteTag::AwaitThenBlock => SvelteKind::AwaitThen,
                    Some(it) if it.1 == SvelteTag::AwaitCatchBlock => SvelteKind::AwaitCatch,
                    _ => SvelteKind::Await,
                };
                self.open(SvelteTag::AwaitBlock, role, at, (id, Part::Node));
                self.builder.kind(kind);
                self.builder
                    .code(Role::Expression, of(expression.span), CodeKind::Expression);
                for (clause, tag, role, part, pattern, flag) in clauses {
                    let Some((fragment, clause)) = clause else {
                        continue;
                    };
                    let start = clause.map_or(node.start, |it| it.start);
                    // Without children it ends with its tag: after the first `}` following the block's expression, the
                    // clause's pattern, or `{:then` and `{:catch`.
                    let end = self.end_of_fragment(fragment).unwrap_or_else(|| {
                        self.behind_brace(match (part, pattern) {
                            (Part::Pending, _) => expression.span.end,
                            (_, Some((_, pattern))) => pattern.with_annotation().end,
                            (Part::Then, None) => start + 5,
                            _ => start + 6,
                        })
                    });
                    self.open(tag, role, span(start, end), (id, part));
                    if clause.is_none() {
                        self.builder.flag(flag);
                    }
                    if let Some((role, pattern)) = pattern {
                        self.builder
                            .code(role, of(pattern.with_annotation()), CodeKind::Pattern);
                    }
                    self.fragment(fragment);
                    if let Some(clause) = clause {
                        self.builder.part(Role::OpenTag, clause);
                    }
                    self.builder.close();
                }
                self.parts(open_tag, end_tag);
                self.builder.close();
            }
            Kind::KeyBlock {
                expression,
                fragment,
            } => {
                self.open(SvelteTag::KeyBlock, role, at, (id, Part::Node));
                self.builder
                    .code(Role::Expression, of(expression.span), CodeKind::Expression);
                self.block_fragment(*fragment);
                self.parts(open_tag, end_tag);
                self.builder.close();
            }
            Kind::SnippetBlock {
                expression: name,
                end_of_parameters,
                body,
            } => {
                self.open(SvelteTag::SnippetBlock, role, at, (id, Part::Node));
                self.builder.code(Role::Id, of(*name), CodeKind::Identifier);
                let parameters = self
                    .parsed
                    .get(name.end as usize..*end_of_parameters as usize);
                let open = parameters.and_then(|it| strings::index_of_char_usize(it, b'('));
                if let Some(open) = open {
                    let start = name.end + open as u32 + 1;
                    let end = end_of_parameters.saturating_sub(1);
                    let written = self.parsed.get(start as usize..end as usize);
                    // Without parameters there's no node.
                    if written.is_some_and(|it| !strings::trim_js_whitespace(it).is_empty()) {
                        self.builder
                            .code(Role::Params, span(start, end), CodeKind::Parameters);
                    }
                }
                self.block_fragment(*body);
                self.parts(open_tag, end_tag);
                self.builder.close();
            }
            Kind::Script {
                is_module,
                attributes,
                content,
            } => {
                self.open(SvelteTag::ScriptElement, role, at, (id, Part::Node));
                if *is_module {
                    self.builder.flag(SvelteFlags::MODULE);
                }
                self.builder.leaf(
                    SvelteTag::Name,
                    Role::Name,
                    span(node.start + 1, node.start + 7),
                );
                self.start_tag(node.start, content.start, attributes, false, None);
                self.builder
                    .code(Role::Body, of(*content), CodeKind::Statements);
                self.builder
                    .leaf(SvelteTag::EndTag, Role::EndTag, span(content.end, node.end));
                self.builder.close();
            }
            Kind::StyleSheet {
                attributes,
                content,
            } => {
                self.open(SvelteTag::StyleElement, role, at, (id, Part::Node));
                self.builder.leaf(
                    SvelteTag::Name,
                    Role::Name,
                    span(node.start + 1, node.start + 6),
                );
                self.start_tag(node.start, content.start, attributes, false, None);
                if content.end > content.start {
                    self.builder
                        .leaf(SvelteTag::Text, Role::Children, of(*content));
                }
                self.builder
                    .leaf(SvelteTag::EndTag, Role::EndTag, span(content.end, node.end));
                self.builder.close();
            }
            Kind::Attribute { .. }
            | Kind::SpreadAttribute(_)
            | Kind::AttachTag(_)
            | Kind::Directive { .. }
            | Kind::StyleDirective { .. } => self.attribute(id, false),
        }
    }

    /// A block's tags, which aren't nodes.
    fn parts(&mut self, open_tag: Option<Span>, end_tag: Option<Span>) {
        if let Some(open_tag) = open_tag {
            self.builder.part(Role::OpenTag, open_tag);
        }
        if let Some(end_tag) = end_tag {
            self.builder.part(Role::CloseTag, end_tag);
        }
    }
}

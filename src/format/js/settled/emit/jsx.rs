use super::*;
use crate::js::print::jsx::child_list::{Child, ChildNode, Children, Item, Part, Separator};
use crate::js::utils::jsx::{is_jsx_whitespace, is_meaningful_jsx_text};

#[derive(Copy, Clone)]
struct JsxNode {
    id: Id,
    is_tag: bool,
    is_self_closing: bool,
}

impl ChildNode for JsxNode {
    fn is_tag(self) -> bool {
        self.is_tag
    }

    fn is_self_closing_element(self) -> bool {
        self.is_self_closing
    }

    fn is_expression_container(self) -> bool {
        !self.is_tag
    }
}

type Formatted = SmallVec<[Option<FormatElement>; 8]>;

impl<'a> Emitter<'a, '_> {
    pub(super) fn jsx_element(&mut self, id: Id) {
        if !self.stack.is_safe_to_recurse() {
            return self.give_up();
        }
        let parent = self.parent(id);
        match self.kind(parent) {
            K::Array | K::Jsx | K::JsxContainer | K::Cond | K::Call | K::New | K::ExprStmt => {
                self.jsx_tags_and_children(id);
            }
            kind => {
                let comments = match kind {
                    K::Return | K::Arrow | K::Declarator | K::Assign | K::Prop | K::Logical => {
                        self.comments_in_parentheses(parent, id)
                    }
                    _ => &[],
                };
                let needs_parentheses = self.needs_parentheses(id);
                let should_expand = kind == K::Arrow
                    && self.kind(self.node(parent).parent) == K::Args
                    && self.parent_kind(parent) == K::Call
                    && self.parent_kind(self.parent(parent)) == K::JsxContainer;
                self.group_with(should_expand, None, |e| {
                    if !needs_parentheses {
                        e.token_if_breaks("(");
                    }
                    e.soft_block_indent(|e| {
                        e.leading_comments_of(id, comments);
                        e.jsx_tags_and_children(id);
                    });
                    if !needs_parentheses {
                        e.token_if_breaks(")");
                    }
                });
            }
        }
    }

    fn jsx_closing(&mut self, node: &Node) {
        if !self.node(node.a).has(flag::SELF_CLOSING) {
            self.token("</");
            if node.b != NONE {
                self.source_of(node.b);
            }
            self.token(">");
        }
    }

    fn jsx_child(&mut self, id: Id) -> Child<'a, JsxNode> {
        let node = self.node(id);
        if node.kind == K::JsxText {
            let text = self.text_of(id);
            let first = text.iter().find(|&&b| !is_jsx_whitespace(b));
            if first.is_some_and(|&b| b < b' ' || b >= 0x80)
                && strings::trim_js_whitespace(text).is_empty()
            {
                self.give_up();
            }
            return Child::Text(text);
        }
        if node.kind == K::JsxContainer && self.kind(node.a) == K::Str {
            let text = self.text_of(node.a);
            if matches!(text, b"\" \"" | b"' '") && !node.has(flag::COMMENT) {
                return Child::Text(b" ");
            }
            let may_be_space = strings::contains(text, b"20")
                || strings::contains(text, b"40")
                || text
                    .iter()
                    .all(|b| matches!(b, b' ' | b'\\' | b'\n' | b'"' | b'\''));
            if self.node(node.a).has(flag::ESCAPE) && may_be_space {
                self.give_up();
            }
        }
        let is_tag = node.kind == K::Jsx;
        Child::Node(JsxNode {
            id,
            is_tag,
            is_self_closing: is_tag && self.node(node.a).has(flag::SELF_CLOSING),
        })
    }

    fn jsx_tags_and_children(&mut self, id: Id) {
        let node = self.node(id);
        let (opening, list) = (self.node(node.a), self.tree.list_of(node));
        let is_fragment = opening.a == NONE;
        match *list {
            [] if !is_fragment => {
                self.jsx_opening(node.a);
                return self.jsx_closing(node);
            }
            [only] if self.kind(only) == K::JsxText => {
                if !is_fragment && !is_meaningful_jsx_text(self.text_of(only)) {
                    return self.give_up();
                }
            }
            [only] if matches!(self.kind(self.node(only).a), K::Template | K::Tagged) => {
                self.jsx_opening(node.a);
                self.jsx_container(only);
                return self.jsx_closing(node);
            }
            _ => {}
        }
        let (is_fbt, flavor) = (self.text_of(opening.a) == b"fbt", self.f.options().flavor);
        let children = Children::new(
            list.iter().map(|&it| self.jsx_child(it)),
            is_fbt,
            false,
            flavor,
        );
        let forced_break = opening.len > 1
            || children.meta.contains_tag
            || children.meta.contains_multiple_expressions;
        if self.is_flat() {
            return self.group_with(forced_break, None, |e| {
                e.jsx_opening(node.a);
                e.may_break();
                e.flat_jsx_children(&children, &[]);
                e.jsx_closing(node);
            });
        }
        if self.flat.is_on {
            return self.follow_jsx(node, &children, forced_break);
        }
        let opening = self.capture(|e| e.jsx_opening(node.a));
        let mut forced_break = forced_break || self.will_break(opening);
        if let [part] = children.parts[..]
            && let [item] = *children.items_of(part)
        {
            return self.group(|e| {
                e.captured(opening);
                match forced_break {
                    true => e.block_indent(|e| e.jsx_item(item)),
                    false => e.soft_block_indent(|e| e.jsx_item(item)),
                }
                e.jsx_closing(node);
            });
        }
        forced_break |= children
            .parts
            .contains(&Part::Separator(Separator::HardLine));
        let mut formatted = Formatted::new();
        if !forced_break {
            for &part in &children.parts {
                for &item in children.items_of(part) {
                    if let Item::Node(_) = item {
                        let element = self.intern(|e| e.jsx_item(item));
                        forced_break |= element.is_some_and(|it| it.will_break(self.f));
                        formatted.push(element);
                    }
                }
            }
        }
        let multiline = |e: &mut Self| {
            e.group(|e| {
                e.captured(opening);
                e.multiline_jsx_children(&children, &formatted);
                e.jsx_closing(node);
            });
        };
        if forced_break {
            return multiline(self);
        }
        let flat = self.variant(|e| {
            e.group(|e| {
                e.captured(opening);
                e.flat_jsx_children(&children, &formatted);
                e.jsx_closing(node);
            });
        });
        let multiline = self.variant(multiline);
        self.best_fitting(&[flat, multiline], Fallback::MostExpanded);
    }

    fn follow_jsx(&mut self, node: &Node, children: &Children<'a, JsxNode>, forced_break: bool) {
        self.group(|e| {
            let before = e.follow.forced_breaks;
            e.jsx_opening(node.a);
            let forced_break = forced_break || e.follow.forced_breaks != before;
            if let [part] = children.parts[..]
                && let [item] = *children.items_of(part)
            {
                match forced_break {
                    true => e.block_indent(|e| e.jsx_item(item)),
                    false => e.soft_block_indent(|e| e.jsx_item(item)),
                }
            } else if children.meta.contains_text {
                e.may_break();
                e.make_group_flat();
                e.flat.matches &= !forced_break;
                e.flat_jsx_children(children, &[]);
            } else {
                e.flat.matches &= !children.parts.is_empty();
                e.multiline_jsx_children(children, &[]);
            }
            e.jsx_closing(node);
        });
    }

    fn jsx_item(&mut self, item: Item<'a, JsxNode>) {
        match item {
            Item::Word(word) if self.flat.is_on => self.text(word),
            Item::Word(word) => text_without_whitespace(word).fmt(self.f),
            Item::Node(node) if node.is_tag => self.expr(node.id),
            Item::Node(node) => self.jsx_container(node.id),
        }
    }

    /// `formatted` has the nodes that are left, or nothing if they haven't been formatted.
    fn jsx_content(
        &mut self,
        items: &[Item<'a, JsxNode>],
        formatted: &mut &[Option<FormatElement>],
    ) {
        for &item in items {
            match (item, *formatted) {
                (Item::Node(_), [first, rest @ ..]) => {
                    self.element(*first);
                    *formatted = rest;
                }
                _ => self.jsx_item(item),
            }
        }
    }

    fn jsx_raw_space(&mut self) {
        self.token(if self.quote == b'"' {
            r#"{" "}"#
        } else {
            "{' '}"
        });
    }

    fn jsx_separator(&mut self, separator: Separator) {
        match separator {
            Separator::JsxWhitespace => {
                self.if_breaks(None, |e| {
                    e.jsx_raw_space();
                    e.soft_line();
                });
                self.if_fits(None, Self::space);
            }
            Separator::Line => self.line(),
            Separator::SoftLine => self.soft_line(),
            Separator::HardLine => self.hard_line(),
        }
    }

    fn flat_jsx_children(
        &mut self,
        children: &Children<'a, JsxNode>,
        mut formatted: &[Option<FormatElement>],
    ) {
        for &part in &children.parts {
            match part {
                Part::Separator(separator) => self.jsx_separator(separator),
                Part::Content { .. } => self.jsx_content(children.items_of(part), &mut formatted),
            }
        }
    }

    fn multiline_jsx_children(
        &mut self,
        children: &Children<'a, JsxNode>,
        mut formatted: &[Option<FormatElement>],
    ) {
        let (parts, is_fill) = (&children.parts[..], children.meta.contains_text);
        if parts.is_empty() && !is_fill {
            self.hard_line();
            return self.line_of(LineMode::Empty);
        }
        let separated = |e: &mut Self, write: &dyn Fn(&mut Self)| {
            if !is_fill {
                return write(e);
            }
            e.tag(Tag::EndEntry);
            e.entry(write);
            e.tag(Tag::StartEntry);
        };
        self.block_indent(|e| {
            if is_fill {
                e.start_fill();
                e.tag(Tag::StartEntry);
            } else {
                e.start_group_of(GroupMode::Expand, None);
            }
            for (index, &part) in parts.iter().enumerate() {
                let Part::Separator(separator) = part else {
                    e.jsx_content(children.items_of(part), &mut formatted);
                    continue;
                };
                let previous =
                    |n: usize| index.checked_sub(n).and_then(|at| parts.get(at)).copied();
                let is_after_nothing = previous(1).is_some_and(Part::is_empty_content);
                let is_after_line_break =
                    is_after_nothing && previous(2) == Some(Part::Separator(Separator::HardLine));
                match separator {
                    Separator::JsxWhitespace
                        if index == 1 && is_after_nothing && parts.len() > 2 =>
                    {
                        separated(e, &|e| {
                            e.jsx_raw_space();
                            e.hard_line();
                        });
                    }
                    Separator::JsxWhitespace if index + 1 == parts.len() || is_after_line_break => {
                        e.jsx_raw_space();
                    }
                    Separator::HardLine if is_after_line_break => {
                        separated(e, &|e| e.line_of(LineMode::Empty));
                    }
                    _ => separated(e, &|e| e.jsx_separator(separator)),
                }
            }
            if is_fill {
                e.tag(Tag::EndEntry);
                e.end_fill();
            } else {
                e.end_group();
            }
        });
    }

    fn jsx_container(&mut self, id: Id) {
        let e = self.node(id).a;
        if e == NONE {
            return self.group(|e| {
                e.token("{");
                e.comments_in_jsx_braces(id);
                e.boundary();
                e.token("}");
            });
        }
        let comments = self.comments_leading(self.node(id), e);
        if !comments.is_empty() {
            if self.kind(e) == K::Arrow && self.kind(self.node(e).d) != K::Body {
                return self.give_up();
            }
            return self.group(|this| {
                this.token("{");
                this.soft_block_indent(|this| {
                    this.leading_comments_of(e, comments);
                    this.expr(e);
                });
                this.boundary();
                this.token("}");
            });
        }
        let is_inline = self.should_inline_jsx_expression(e, self.parent_kind(id) == K::Jsx);
        self.shortcut(id, |this| {
            this.group(|this| {
                this.token("{");
                match is_inline {
                    true => this.expr(e),
                    false => this.soft_block_indent(|this| this.expr(e)),
                }
                this.boundary();
                this.token("}");
            });
        });
    }

    fn should_inline_jsx_expression(&self, mut id: Id, mut is_child: bool) -> bool {
        loop {
            let node = self.node(id);
            match node.kind {
                K::Array | K::Object | K::Arrow | K::Fn | K::Template | K::Tagged => return true,
                K::Await => match self.node(node.a) {
                    it if it.kind == K::Jsx && self.node(it.a).a != NONE => return true,
                    _ => (id, is_child) = (node.a, false),
                },
                K::Cond | K::Logical | K::Binary => return is_child,
                _ => return self.kind(self.strip_non_null(id)) == K::Call,
            }
        }
    }

    fn jsx_attribute(&mut self, id: Id) {
        let node = self.node(id);
        if self.skip(node, node) {
            return;
        }
        if node.kind == K::JsxSpreadAttr {
            self.token("{...");
            self.expr(node.a);
            return self.token("}");
        }
        self.source_of(node.a);
        if node.b == NONE {
            return;
        }
        self.token("=");
        if self.kind(node.b) == K::JsxContainer {
            return self.jsx_container(node.b);
        }
        let text = self.text_of(node.b);
        let content = text
            .get(1..text.len().saturating_sub(1))
            .unwrap_or_default();
        let quote = self.f.options().jsx_quote_style;
        let is_settled = !strings::contains(content, b"&apos;")
            && !strings::contains(content, b"&quot;")
            && match strings::contains_char(content, quote.as_byte()) {
                true => text.first() == Some(&quote.other().as_byte()),
                false => text.first() == Some(&quote.as_byte()),
            };
        if !is_settled {
            self.give_up();
        } else {
            self.wide_source(self.node(node.b).start, self.node(node.b).end);
        }
    }

    fn jsx_opening(&mut self, id: Id) {
        let node = self.node(id);
        if self.skip(node, node) {
            return;
        }
        if node.a == NONE {
            return self.token("<>");
        }
        let (attributes, is_self_closing) = (self.tree.list_of(node), node.has(flag::SELF_CLOSING));
        let open = |e: &mut Self| {
            e.token("<");
            e.source_of(node.a);
            e.type_arguments(node.b);
        };
        if is_self_closing && attributes.is_empty() {
            open(self);
            self.space();
            return self.token("/>");
        }
        if let [only] = *attributes
            && self.kind(self.node(only).b) == K::JsxStr
            && !node.has(flag::COMMENT)
        {
            return self.group(|e| {
                open(e);
                e.space();
                e.jsx_attribute(only);
                if is_self_closing {
                    e.space();
                }
                e.token(if is_self_closing { "/>" } else { ">" });
            });
        }
        let options = self.f.options();
        let has_comment_after = |&last: &Id| {
            !self
                .comments_between(self.node(last).end, node.end)
                .is_empty()
        };
        let is_bracket_on_same_line = attributes.is_empty()
            || (options.bracket_same_line.value()
                && !(node.has(flag::COMMENT) && attributes.last().is_some_and(has_comment_after)));
        let line = match options.attribute_position {
            AttributePosition::Multiline => LineMode::Hard,
            _ => LineMode::SoftOrSpace,
        };
        self.group(|e| {
            open(e);
            if !attributes.is_empty() {
                e.soft_line_indent_or_space(|e| {
                    e.items(
                        id,
                        node.start,
                        |e, previous, _, _| match e.is_next_line_empty(e.node(previous).end) {
                            true => e.line_of(LineMode::Empty),
                            false => e.line_of(line),
                        },
                        Self::jsx_attribute,
                        |_, _, _| {},
                    );
                });
            }
            if is_self_closing {
                e.line();
                e.token("/>");
            } else {
                if !is_bracket_on_same_line {
                    e.soft_line();
                }
                e.token(">");
            }
        });
    }
}

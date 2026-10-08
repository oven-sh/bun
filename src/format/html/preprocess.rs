//! Prettier's `language-html/print-preprocess.js`.
//!
//! Prettier walks the tree ten times. Each of its steps looks at a node and its children, so here all of them are
//! done for a node, in the same order, before its children have their turn. Only the last step comes after them.

use super::ast::{Flags, Id, Kind, Node, Span, Tree};
use super::utilities::{self, has_html_whitespace, html_trim, is_pre_like, is_script_like_tag};
use super::{Options, Parser};
use bun_core::strings;
use std::borrow::Cow;

struct Preprocessor<'t, 'a, 'o> {
    tree: &'t mut Tree<'a>,
    options: &'o Options<'o>,
    stack_check: bun_core::StackCheck,
    is_nested_too_deeply: bool,
}

/// Returns whether the tree is not nested too deeply.
pub(crate) fn preprocess<'a>(tree: &mut Tree<'a>, options: &Options<'_>) -> bool {
    let root = tree.root;
    tree[root].css_display = tree.css_display(root, false, options);
    let mut preprocessor = Preprocessor {
        tree,
        options,
        stack_check: bun_core::StackCheck::init(),
        is_nested_too_deeply: false,
    };
    preprocessor.visit(root, false);
    !preprocessor.is_nested_too_deeply
}

/// The part of `value` from `start` to `end`.
fn slice<'a>(value: &Cow<'a, [u8]>, start: usize, end: usize) -> Cow<'a, [u8]> {
    match value {
        Cow::Borrowed(value) => Cow::Borrowed(&value[start..end]),
        Cow::Owned(value) => Cow::Owned(value[start..end].to_vec()),
    }
}

impl<'a> Preprocessor<'_, 'a, '_> {
    fn visit(&mut self, id: Id, is_in_svg_foreign_object: bool) {
        if !self.stack_check.is_safe_to_recurse() {
            self.is_nested_too_deeply = true;
            return;
        }
        let has_children_property = self.tree[id].has_children_property();
        if has_children_property {
            self.remove_ignorable_first_lf(id);
            self.merge_ie_conditional_start_end_comment_into_element_opening_tag(id);
            self.merge_cdata_into_text(id);
            self.extract_interpolation(id);
        }
        self.extract_whitespaces(id);
        let mut next = self.tree.first_child(id);
        while let Some(child) = next {
            next = self.tree.next(child);
            let is_in_svg_foreign_object = is_in_svg_foreign_object || self.is_svg_foreign_object(child);
            self.tree[child].css_display = self.tree.css_display(child, is_in_svg_foreign_object, self.options);
            self.add_is_self_closing(child);
            self.add_has_htm_component_closing_tag(child);
        }
        if has_children_property {
            self.add_is_space_sensitive(id);
        }
        let mut next = self.tree.first_child(id);
        while let Some(child) = next {
            next = self.tree.next(child);
            if !matches!(self.tree[child].kind, Kind::Text | Kind::Comment | Kind::DocType) {
                self.visit(child, is_in_svg_foreign_object || self.is_svg_foreign_object(child));
            }
        }
        if has_children_property {
            self.merge_simple_element_into_text(id);
        }
        // Prettier does this when it prints the block.
        if self.tree[id].kind == Kind::AngularControlFlowBlock
            && let (Some(first), Some(last)) = (self.tree.first_child(id), self.tree.last_child(id))
        {
            self.tree[first].flags.insert(Flags::HAS_LEADING_SPACES);
            self.tree[last].flags.insert(Flags::HAS_TRAILING_SPACES);
        }
    }

    fn is_svg_foreign_object(&self, id: Id) -> bool {
        let node = &self.tree[id];
        node.kind == Kind::Element && node.namespace == b"svg" && &node.name[..] == b"foreignObject"
    }

    fn remove_ignorable_first_lf(&mut self, id: Id) {
        let node = &self.tree[id];
        // The first child was a comment when Prettier asked.
        if node.kind != Kind::Element || !node.tag_definition.ignore_first_lf || node.has(Flags::HAS_CONDITION) {
            return;
        }
        let Some(first) = self.tree.first_child(id) else {
            return;
        };
        if self.tree[first].kind != Kind::Text || self.tree[first].value.first() != Some(&b'\n') {
            return;
        }
        if self.tree[first].value.len() == 1 {
            self.tree.remove(first);
        } else {
            let value = &mut self.tree[first].value;
            *value = slice(value, 1, value.len());
        }
    }

    /// `<!--[if ...]><!--><target><!--<![endif]-->`
    fn merge_ie_conditional_start_end_comment_into_element_opening_tag(&mut self, id: Id) {
        let mut next = self.tree.first_child(id);
        while let Some(child) = next {
            next = self.tree.next(child);
            if self.tree[child].kind != Kind::Element {
                continue;
            }
            let (Some(start_comment), Some(end_comment)) = (self.tree.prev(child), self.tree.first_child(child)) else {
                continue;
            };
            let start_span = self.tree[child].start_span;
            let is_target = self.tree[start_comment].kind == Kind::IeConditionalStartComment
                && self.tree[start_comment].span.end == start_span.start
                && self.tree[end_comment].kind == Kind::IeConditionalEndComment
                && self.tree[end_comment].span.start == start_span.end;
            if !is_target {
                continue;
            }
            self.tree.remove(start_comment);
            self.tree.remove(end_comment);
            let start_span = Span::new(self.tree[start_comment].span.start, self.tree[end_comment].span.end);
            let condition = std::mem::take(&mut self.tree[start_comment].value);
            let node = &mut self.tree[child];
            node.value = condition;
            node.flags.insert(Flags::HAS_CONDITION);
            node.span = Span::new(start_span.start, node.span.end);
            node.start_span = start_span;
        }
    }

    /// `mergeNodeIntoText`, for CDATA sections.
    fn merge_cdata_into_text(&mut self, id: Id) {
        let mut next = self.tree.first_child(id);
        while let Some(child) = next {
            next = self.tree.next(child);
            match self.tree[child].kind {
                Kind::Text => {}
                Kind::Cdata => {
                    let node = &mut self.tree[child];
                    node.kind = Kind::Text;
                    node.value = Cow::Owned([b"<![CDATA[", &node.value[..], b"]]>"].concat());
                }
                _ => continue,
            }
            let Some(prev) = self.tree.prev(child).filter(|&prev| self.tree[prev].kind == Kind::Text) else {
                continue;
            };
            let (value, end) = (std::mem::take(&mut self.tree[child].value), self.tree[child].span.end);
            let node = &mut self.tree[prev];
            node.value.to_mut().extend_from_slice(&value);
            node.span.end = end;
            self.tree.remove(child);
        }
    }

    fn extract_interpolation(&mut self, id: Id) {
        // `canHaveInterpolation`
        if self.options.parser == Parser::Html || is_script_like_tag(&self.tree[id], self.options) {
            return;
        }
        let mut next = self.tree.first_child(id);
        while let Some(child) = next {
            next = self.tree.next(child);
            if self.tree[child].kind != Kind::Text {
                continue;
            }
            if self.tree[child].value.is_empty() {
                self.tree.remove(child);
                continue;
            }
            if !strings::contains(&self.tree[child].value, b"{{") {
                continue;
            }
            let value = std::mem::take(&mut self.tree[child].value);
            let base = self.tree[child].span.start;
            // `value.split(/\{\{(.+?)\}\}/s)`
            let mut from = 0;
            loop {
                let found = strings::index_of(&value[from..], b"{{").map(|at| from + at).and_then(|open| {
                    let close = strings::index_of(value.get(open + 3..)?, b"}}")?;
                    Some((open, open + 3 + close))
                });
                let text_end = found.map_or(value.len(), |(open, _)| open);
                if text_end > from {
                    let span = Span::new(base + from as u32, base + text_end as u32);
                    let text = self.tree.add(Node::text(slice(&value, from, text_end), span));
                    self.tree.insert_before(child, text);
                }
                let Some((open, close)) = found else {
                    break;
                };
                let inner = Span::new(base + open as u32 + 2, base + close as u32);
                let interpolation = self.tree.add(Node::new(Kind::Interpolation, Span::new(inner.start - 2, inner.end + 2)));
                let text = self.tree.add(Node::text(slice(&value, open + 2, close), inner));
                self.tree.append_child(interpolation, text);
                self.tree.insert_before(child, interpolation);
                from = close + 2;
            }
            self.tree.remove(child);
        }
    }

    fn extract_whitespaces(&mut self, id: Id) {
        let is_blank = match self.tree.first_child(id) {
            None => true,
            Some(first) => {
                self.tree.next(first).is_none() && self.tree[first].kind == Kind::Text && html_trim(&self.tree[first].value).is_empty()
            }
        };
        if is_blank {
            let has_dangling_spaces = self.tree.has_children(id);
            self.tree[id].flags.set(Flags::HAS_DANGLING_SPACES, has_dangling_spaces);
            self.tree.clear_children(id);
            return;
        }
        let is_whitespace_sensitive = self.tree.is_whitespace_sensitive(id, self.options);
        let is_indentation_sensitive = is_pre_like(&self.tree[id]);
        if !is_whitespace_sensitive {
            let mut next_child = self.tree.first_child(id);
            while let Some(child) = next_child {
                let (prev, next) = (self.tree.prev(child), self.tree.next(child));
                next_child = next;
                if self.tree[child].kind != Kind::Text {
                    continue;
                }
                let value = &self.tree[child].value;
                let leading = utilities::leading_whitespace_count(value);
                let trailing = utilities::trailing_whitespace_count(&value[leading..]);
                let (is_all_whitespace, is_empty) = (leading + trailing == value.len(), value.is_empty());
                if is_all_whitespace {
                    self.tree.remove(child);
                } else {
                    let node = &mut self.tree[child];
                    node.value = slice(&node.value, leading, node.value.len() - trailing);
                    node.span = Span::new(node.span.start + leading as u32, node.span.end.saturating_sub(trailing as u32));
                    node.flags.set(Flags::HAS_LEADING_SPACES, leading > 0);
                    node.flags.set(Flags::HAS_TRAILING_SPACES, trailing > 0);
                }
                if (leading > 0 || (is_all_whitespace && !is_empty))
                    && let Some(prev) = prev
                {
                    self.tree[prev].flags.insert(Flags::HAS_TRAILING_SPACES);
                }
                if (trailing > 0 || (is_all_whitespace && !is_empty))
                    && let Some(next) = next
                {
                    self.tree[next].flags.insert(Flags::HAS_LEADING_SPACES);
                }
            }
        }
        let flags = &mut self.tree[id].flags;
        flags.set(Flags::IS_WHITESPACE_SENSITIVE, is_whitespace_sensitive);
        flags.set(Flags::IS_INDENTATION_SENSITIVE, is_indentation_sensitive);
    }

    fn add_is_self_closing(&mut self, id: Id) {
        let node = &mut self.tree[id];
        let is_self_closing = !node.has_children_property()
            || (node.kind == Kind::Element
                && (node.tag_definition.is_void || (node.has(Flags::HAS_END_SPAN) && node.start_span == node.end_span)));
        node.flags.set(Flags::IS_SELF_CLOSING, is_self_closing);
    }

    fn add_has_htm_component_closing_tag(&mut self, id: Id) {
        let node = &mut self.tree[id];
        if node.kind != Kind::Element {
            return;
        }
        // `/^<\s*\/\s*\/\s*>$/`
        let has_htm_component_closing_tag = node.end_span().is_some_and(|span| {
            let Some(mut rest) = span.of(self.options.original_text).strip_prefix(b"<") else {
                return false;
            };
            for expected in [b'/', b'/', b'>'] {
                match crate::css::text::trim_start(rest).split_first() {
                    Some((&first, after)) if first == expected => rest = after,
                    _ => return false,
                }
            }
            rest.is_empty()
        });
        node.flags.set(Flags::HAS_HTM_COMPONENT_CLOSING_TAG, has_htm_component_closing_tag);
    }

    fn add_is_space_sensitive(&mut self, id: Id) {
        let Some(first) = self.tree.first_child(id) else {
            let is_sensitive = self.tree.is_dangling_space_sensitive(id, self.options);
            self.tree[id].flags.set(Flags::IS_DANGLING_SPACE_SENSITIVE, is_sensitive);
            return;
        };
        let mut next = Some(first);
        while let Some(child) = next {
            next = self.tree.next(child);
            let is_leading = self.tree.is_leading_space_sensitive(child, self.options);
            let is_trailing = self.tree.is_trailing_space_sensitive(child, self.options);
            let flags = &mut self.tree[child].flags;
            flags.set(Flags::IS_LEADING_SPACE_SENSITIVE, is_leading);
            flags.set(Flags::IS_TRAILING_SPACE_SENSITIVE, is_trailing);
        }
        // From the first to the last: what is asked of the one before has been settled, of the one behind not yet.
        let mut next = Some(first);
        while let Some(child) = next {
            next = self.tree.next(child);
            if self.tree.prev_of(child).is_some_and(|prev| !prev.has(Flags::IS_TRAILING_SPACE_SENSITIVE)) {
                self.tree[child].flags.remove(Flags::IS_LEADING_SPACE_SENSITIVE);
            }
            if self.tree.next_of(child).is_some_and(|next| !next.has(Flags::IS_LEADING_SPACE_SENSITIVE)) {
                self.tree[child].flags.remove(Flags::IS_TRAILING_SPACE_SENSITIVE);
            }
        }
    }

    fn is_simple_element(&self, id: Id) -> bool {
        let node = &self.tree[id];
        node.kind == Kind::Element
            && !node.has_attrs()
            && !node.has_start_tag_comments()
            && self.tree.only_child(id).is_some_and(|only| {
                let only = &self.tree[only];
                only.kind == Kind::Text
                    && !has_html_whitespace(&only.value)
                    && !only.flags.intersects(Flags::HAS_LEADING_SPACES | Flags::HAS_TRAILING_SPACES)
            })
            && node.has(Flags::IS_LEADING_SPACE_SENSITIVE | Flags::IS_TRAILING_SPACE_SENSITIVE)
            && !node.flags.intersects(Flags::HAS_LEADING_SPACES | Flags::HAS_TRAILING_SPACES)
            && self.tree.prev_of(id).is_some_and(|prev| prev.kind == Kind::Text)
            && self.tree.next_of(id).is_some_and(|next| next.kind == Kind::Text)
    }

    fn merge_simple_element_into_text(&mut self, id: Id) {
        let mut next_child = self.tree.first_child(id);
        while let Some(child) = next_child {
            next_child = self.tree.next(child);
            if !self.is_simple_element(child) {
                continue;
            }
            let (Some(prev), Some(next), Some(only)) = (self.tree.prev(child), self.tree.next(child), self.tree.first_child(child)) else {
                continue;
            };
            next_child = self.tree.next(next);
            let mut value = std::mem::take(&mut self.tree[prev].value).into_owned();
            let (namespace, name) = self.tree[child].raw_name();
            for (open, close) in [(&b"<"[..], &self.tree[only].value[..]), (b"</", &self.tree[next].value)] {
                value.extend_from_slice(open);
                if !namespace.is_empty() {
                    value.extend_from_slice(namespace);
                    value.push(b':');
                }
                value.extend_from_slice(name);
                value.push(b'>');
                value.extend_from_slice(close);
            }
            let (end, flags) = (self.tree[next].span.end, self.tree[next].flags);
            let text = &mut self.tree[prev];
            text.value = Cow::Owned(value);
            text.span.end = end;
            text.flags.set(Flags::IS_TRAILING_SPACE_SENSITIVE, flags.contains(Flags::IS_TRAILING_SPACE_SENSITIVE));
            text.flags.set(Flags::HAS_TRAILING_SPACES, flags.contains(Flags::HAS_TRAILING_SPACES));
            self.tree.remove(child);
            self.tree.remove(next);
        }
    }
}

//! The rules of `print/`, for the tree of this module. Each function does what the function of the same name does there
//! for a node that only has comments where [`Emitter::items`] looks for them. Where the output is certain to differ
//! from the source, or the rule is rare, it [gives up](Emitter::give_up).

mod assignment;
mod binary;
mod call;
mod class;
mod comments;
mod expression;
mod follow;
mod function;
mod jsx;
mod member_chain;
mod module;
mod object;
mod parentheses;
mod sink;
mod statement;
mod types;

use super::lexer::{Comment, T};
use super::tree::{Id, K, NONE, Node, Tree, flag};
use crate::ir::element::{Align, Condition, DedentMode, Group, GroupMode, Interned};
use crate::ir::element::{LineMode, PrintMode, TextWidth};
use crate::ir::prelude::*;
use crate::js::source_text::SourceText;
use crate::options::*;
use bun_core::strings;
use bun_lint::span::Span;
pub(super) use comments::{is_comment_settled, is_inert};
pub(super) use follow::Follow;
pub(super) use parentheses::operand_needs_parentheses;
use smallvec::SmallVec;

/// The statements and comments of a block, a function body or a `case`, which are checked on their own.
#[derive(Copy, Clone)]
pub(super) struct Hole {
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) owner: Id,
}

pub(super) struct Emitter<'a, 't> {
    pub(super) f: &'t mut Formatter<'a>,
    pub(super) tree: &'t Tree,
    pub(super) src: &'a [u8],
    pub(super) comments: &'t [Comment],
    /// The lines of the current statement that may be too long.
    pub(super) long_lines: &'t [(u32, u32)],
    pub(super) holes: &'t mut Vec<Hole>,
    pub(super) has_given_up: bool,
    pub(super) has_stand_ins: bool,
    pub(super) has_group: bool,
    /// No stand-ins are written unless it's 0.
    pub(super) exact: u32,
    flat: sink::Flat,
    follow: &'t mut Follow,
    is_ascii: bool,
    is_oxfmt: bool,
    is_javascript: bool,
    quote: u8,
    has_semicolons: bool,
    /// `<T,>() => {}`
    needs_comma_after_type_parameter: bool,
    cache: &'t mut Cache,
    stack: bun_core::StackCheck,
}

/// What `JsFormatContext::cache_element` has for the parts of functions.
pub(super) type Cache = rustc_hash::FxHashMap<(Id, function::Part), FormatElement>;

impl<'a, 't> Emitter<'a, 't> {
    pub(super) fn new(
        f: &'t mut Formatter<'a>,
        tree: &'t Tree,
        comments: &'t [Comment],
        (holes, cache, follow): (&'t mut Vec<Hole>, &'t mut Cache, &'t mut Follow),
        (is_javascript, needs_comma_after_type_parameter, is_ascii): (bool, bool, bool),
    ) -> Self {
        Emitter {
            src: f.source_text().as_bytes(),
            is_oxfmt: f.options().flavor.is_oxfmt(),
            quote: f.options().quote_style.as_byte(),
            has_semicolons: f.options().semicolons.is_always(),
            f,
            tree,
            comments,
            long_lines: &[],
            holes,
            has_given_up: false,
            has_stand_ins: false,
            has_group: false,
            exact: 0,
            flat: sink::Flat::OFF,
            follow,
            is_ascii,
            is_javascript,
            needs_comma_after_type_parameter,
            cache,
            stack: bun_core::StackCheck::init(),
        }
    }

    /// For a statement that's on one line, which isn't too long. Returns whether it has a group, if it's certain to
    /// be printed as it is.
    pub(super) fn compare_statement(&mut self, id: Id) -> Option<bool> {
        let node = self.node(id);
        if !node.has(flag::ODD) {
            let has_group = self.is_known_to_have_group(node);
            debug_assert!({
                let flat = self.compare(node.start, node.end, |e| e.statement(id));
                flat.matches && (flat.has_group || !has_group)
            });
            return Some(has_group);
        }
        self.has_given_up = false;
        let flat = self.compare(node.start, node.end, |e| {
            e.flat.skips = true;
            e.flat.has_group = e.is_known_to_have_group(node);
            e.statement(id);
        });
        (flat.matches && !self.has_given_up).then_some(flat.has_group)
    }

    fn is_known_to_have_group(&self, statement: &Node) -> bool {
        let mut e = self.node(statement.a);
        match statement.kind {
            K::Var | K::If | K::TypeAlias => return true,
            K::ExprStmt | K::Return | K::Throw => {}
            _ => return false,
        }
        if e.kind == K::Await {
            e = self.node(e.a);
        }
        match e.kind {
            K::Call | K::New => match *self.list(e.c) {
                [] => e.kind == K::Call && self.kind(e.a) == K::Dot && !e.has(flag::CHAIN),
                [first, ..] => self.kind(first) != K::Str,
            },
            K::Object | K::Array => e.len > 0,
            kind => matches!(kind, K::Assign | K::Binary | K::Logical | K::Cond),
        }
    }

    /// Replaces the document with `id`, on a line that starts with `indentation`.
    pub(super) fn write_statement(&mut self, id: Id, indentation: &[u8]) {
        self.f.clear();
        if !self.cache.is_empty() {
            self.cache.clear();
        }
        (self.has_stand_ins, self.has_group, self.has_given_up) = (false, false, false);
        let (len, options) = (indentation.len() as u32, self.f.options());
        let (levels, spaces) = match options.indent_style.is_tab() {
            true => (len, 0),
            false => {
                let width = options.indent_width.value().max(1);
                (len / width, len % width)
            }
        };
        for _ in 0..levels {
            self.f.write_element(FormatElement::Tag(Tag::StartIndent));
        }
        self.align(spaces, |e| {
            e.hard_line();
            e.statement(id);
        });
    }

    #[inline]
    fn node(&self, id: Id) -> &'t Node {
        self.tree.node(id)
    }

    #[inline]
    fn kind(&self, id: Id) -> K {
        self.tree.kind(id)
    }

    #[inline]
    fn list(&self, id: Id) -> &'t [Id] {
        self.tree.list(id)
    }

    fn text_of(&self, id: Id) -> &'a [u8] {
        let node = self.node(id);
        self.slice(node.start, node.end)
    }

    #[inline]
    fn slice(&self, from: u32, to: u32) -> &'a [u8] {
        (self.src.get(from as usize..to as usize)).unwrap_or_default()
    }

    fn span(&self, id: Id) -> Span {
        Span::new(self.node(id).start, self.node(id).end)
    }

    fn source_text(&self) -> SourceText<'a> {
        SourceText::new(self.src)
    }

    fn is_name(&self, id: Id, name: &[u8]) -> bool {
        self.kind(id) == K::Ident && self.text_of(id) == name
    }

    /// `ast_parent()`
    #[inline]
    fn parent(&self, id: Id) -> Id {
        let parent = self.node(id).parent;
        let node = self.node(parent);
        match node.kind {
            K::Args | K::Extends => node.parent,
            _ => parent,
        }
    }

    #[inline]
    fn parent_kind(&self, id: Id) -> K {
        self.kind(self.parent(id))
    }

    #[inline]
    fn is_chain_root(&self, id: Id) -> bool {
        let node = self.node(id);
        (node.has(flag::CHAIN) || node.kind == K::NonNull) && self.is_chain_root_slow(id)
    }

    fn is_chain_root_slow(&self, id: Id) -> bool {
        let mut node = self.node(id);
        let is_parenthesized = node.has(flag::PARENS);
        let parent = self.node(node.parent);
        while node.kind == K::NonNull {
            node = self.node(node.a);
            if node.has(flag::PARENS) {
                return false;
            }
        }
        let continues =
            matches!(parent.kind, K::Dot | K::Index | K::Call | K::NonNull) && parent.a == id;
        node.has(flag::CHAIN) && (!continues || is_parenthesized)
    }

    fn is_callee(&self, id: Id) -> bool {
        let parent = self.node(self.node(id).parent);
        matches!(parent.kind, K::Call | K::New) && parent.a == id
    }

    /// The arguments of a call, `new` or `import()`.
    #[inline]
    fn args(&self, call: Id) -> &'t [Id] {
        self.list(self.node(call).c)
    }

    #[inline]
    fn params(&self, function: Id) -> &'t [Id] {
        self.list(self.node(function).params())
    }

    #[cold]
    fn give_up(&mut self) {
        self.has_given_up = true;
        self.not_flat();
    }

    #[inline]
    fn is_on_long_line(&self, at: u32) -> bool {
        self.long_lines.first().is_some_and(|it| it.0 <= at) && self.find_long_line(at)
    }

    fn find_long_line(&self, at: u32) -> bool {
        let after = self.long_lines.partition_point(|it| it.1 <= at);
        self.long_lines.get(after).is_some_and(|it| it.0 <= at)
    }

    /// Returns false if the nodes from `first` to `last` have to be written.
    #[inline(always)]
    fn skip(&mut self, first: &Node, last: &Node) -> bool {
        let skips = (first.flags | last.flags) & (flag::ODD | flag::MULTILINE | flag::COMMENT) == 0
            && self.flat.skips
            && !self.follow.is_waiting
            && (self.is_flat() || !self.is_on_long_line(first.start));
        if skips {
            self.source(first.start, last.end);
        }
        skips
    }

    /// Calls `write`, which writes the node `id` without parentheses. If the node is on one line, a stand-in is
    /// written instead.
    #[inline]
    fn shortcut(&mut self, id: Id, write: impl Fn(&mut Self)) {
        if !self.flat.matches {
            return;
        }
        let node = self.node(id);
        if self.skip(node, node) {
            return;
        }
        if self.is_flat() {
            return write(self);
        }
        if self.exact != 0
            || node.has(flag::MULTILINE | flag::COMMENT)
            || self.is_on_long_line(node.start)
        {
            return write(self);
        }
        if self.flat.is_on {
            let inside = self.flat.depth + 1;
            self.flat.flat_from = inside;
            write(self);
            if self.flat.flat_from == inside {
                self.flat.flat_from = u32::MAX;
            }
            return;
        }
        let flat = self.compare(node.start, node.end, &write);
        if flat.can_stand_in(node.start, self.slice(node.start, node.end)) {
            self.has_stand_ins = true;
            return self.write_stand_in(node.start, node.end, flat);
        }
        self.exactly(write);
    }

    /// Like [`Emitter::shortcut`], for the nodes from `first` to `last`, which are all that can break in the group
    /// around them.
    fn shortcut_in_group(&mut self, first: Id, last: Id, write: impl Fn(&mut Self)) {
        let (first, last) = (self.node(first), self.node(last));
        let end = last.end + u32::from(last.has(flag::PARENS));
        if self.is_flat()
            || self.exact != 0
            || (first.flags | last.flags) & (flag::MULTILINE | flag::COMMENT) != 0
            || self.is_on_long_line(first.start)
        {
            return write(self);
        }
        if self.flat.is_on {
            self.make_group_flat();
            return write(self);
        }
        let mut flat = self.compare(first.start, end, |e| e.group(&write));
        if flat.can_stand_in(first.start, self.slice(first.start, end)) {
            flat.has_group = false;
            self.has_stand_ins = true;
            return self.write_stand_in(first.start, end, flat);
        }
        write(self);
    }

    /// For what's inspected after it's written.
    #[inline]
    fn exactly<R>(&mut self, write: impl FnOnce(&mut Self) -> R) -> R {
        self.exact += 1;
        let result = write(self);
        self.exact -= 1;
        result
    }

    fn semicolon(&mut self) {
        self.token_if(self.has_semicolons, ";");
    }

    #[inline]
    fn trailing_comma(&mut self, kind: FormatTrailingCommas) {
        if kind.trailing_separator(self.f.options()) == TrailingSeparator::Allowed {
            self.token_if_breaks(",");
        }
    }

    fn has_bracket_spacing(&self) -> bool {
        self.f.options().bracket_spacing.value()
    }

    fn preserves_expanded_objects(&self) -> bool {
        self.f.options().expand == Expand::Auto
    }

    fn has_newline(&self, from: u32, to: u32) -> bool {
        strings::contains_char(self.slice(from, to), b'\n')
    }

    fn is_next_line_empty(&self, at: u32) -> bool {
        !self.is_flat() && crate::text::is_next_line_empty(self.src, at as usize)
    }
}

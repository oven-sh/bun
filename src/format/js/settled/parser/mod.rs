//! A parser for the common part of JavaScript and TypeScript. It has to accept nothing that `bun fmt` reports as a
//! syntax error, and to build the tree that the real parser builds. Whatever it isn't sure about, it gives up on:
//! `None` ends the parse, and [`Parser::unsure`] marks the current statement.

mod class;
mod expression;
mod jsx;
mod statement;
mod tailwind;
mod types;

use super::lexer::{Gap, Lexer, Position, T, trait_of};
use super::tree::{Id, K, NONE, Node, Tree, flag};
use crate::tailwind::Tailwind;
use bun_core::strings;

type P<T = Id> = Option<T>;

#[inline]
fn require(condition: bool) -> P<()> {
    condition.then_some(())
}

pub(super) fn has_preferred_quotes(text: &[u8], quote: u8) -> bool {
    let content = text
        .get(1..text.len().saturating_sub(1))
        .unwrap_or_default();
    let other = b'"' + b'\'' - quote;
    let prefers_other = strings::count_char(content, quote) > strings::count_char(content, other);
    text.first() == Some(if prefers_other { &other } else { &quote })
}

mod ctx {
    pub(super) const RETURN: u32 = 1;
    pub(super) const AWAIT: u32 = 1 << 1;
    pub(super) const YIELD: u32 = 1 << 2;
    pub(super) const BREAK: u32 = 1 << 3;
    pub(super) const CONTINUE: u32 = 1 << 4;
    pub(super) const SUPER_MEMBER: u32 = 1 << 5;
    pub(super) const SUPER_CALL: u32 = 1 << 6;
    pub(super) const NEW_TARGET: u32 = 1 << 7;
    pub(super) const NO_ARGUMENTS: u32 = 1 << 8;
    /// `in` ends the expression.
    pub(super) const NO_IN: u32 = 1 << 9;
    /// At any depth in the initializer of a `for` statement.
    pub(super) const FOR_INIT: u32 = 1 << 10;
    /// A `:` can end the expression: `a ? (b) : c => d`.
    pub(super) const BEFORE_COLON: u32 = 1 << 11;
    pub(super) const NO_CONDITIONAL_TYPE: u32 = 1 << 12;
    pub(super) const INFER: u32 = 1 << 13;
    /// After `declare`, or in a declaration file.
    pub(super) const AMBIENT: u32 = 1 << 14;
    pub(super) const MODULE_ITEM: u32 = 1 << 15;
    pub(super) const CASE_ITEM: u32 = 1 << 16;

    /// What ends at an opening bracket.
    pub(super) const UNTIL_BRACKET: u32 = NO_IN | BEFORE_COLON | NO_CONDITIONAL_TYPE;
    /// What an arrow function has in common with the code around it.
    pub(super) const LEXICAL: u32 =
        SUPER_MEMBER | SUPER_CALL | NEW_TARGET | NO_ARGUMENTS | FOR_INIT | AMBIENT;
}

const MAX_DEPTH: u32 = 160;
const USUAL_DEPTH: u32 = 40;
/// What walks a tree calls itself for each level.
const MAX_HEIGHT: u16 = 600;
/// For `a + b + ..` and `a.b.c..`, which are as deep as they're long.
const MAX_CHAIN: u32 = 250;

#[derive(Copy, Clone)]
pub(super) struct Language {
    pub(super) is_typescript: bool,
    pub(super) has_jsx: bool,
    pub(super) allows_module_syntax: bool,
    /// `<T>() => {}` needs a comma or a constraint.
    pub(super) reserves_angle_brackets: bool,
    pub(super) is_declaration_file: bool,
}

/// The options that matter for code on one line.
#[derive(Copy, Clone)]
pub(super) struct Style {
    pub(super) quote: u8,
    pub(super) jsx_quote: u8,
    pub(super) has_semicolons: bool,
    pub(super) inside_braces: Gap,
    pub(super) avoids_arrow_parentheses: bool,
    pub(super) has_one_attribute_per_line: bool,
    pub(super) has_consistent_keys: bool,
}

/// The start and end of a name.
type Name = (u32, u32);

#[derive(Default)]
pub(super) struct Buffers {
    stack: Vec<Id>,
    private_names: Vec<(Name, u8)>,
    private_uses: Vec<Name>,
    exports: Vec<Name>,
    /// With whether they label loops.
    labels: Vec<(Name, bool)>,
    depths: Vec<u16>,
}

pub(super) struct Parser<'a> {
    pub(super) lx: Lexer<'a>,
    pub(super) tree: Tree,
    pub(super) buffers: Buffers,
    language: Language,
    style: Style,
    ctx: u32,
    depth: u32,
    is_unsure: bool,
    /// Number of `{ a = 1 }` that aren't known to be patterns.
    shorthand_defaults: u32,
    /// How many more bytes may be parsed twice.
    budget: u32,
    class_depth: u32,
    /// The labels before this index are outside the current function.
    first_label: usize,
    /// The number of links in the long chains of the top-level statement
    links: u32,
    may_be_too_high: bool,
    stack: bun_core::StackCheck,
    tailwind: Option<&'a Tailwind>,
    has_default_export: bool,
    /// A statement was skipped. See [`Parser::skip_statement`].
    pub(super) has_skipped: bool,
    is_after_skipped: bool,
    has_module_syntax: bool,
    has_skipped_export: bool,
    /// An `await` or `import.meta` is the first sign that the file is a module.
    is_module_without_module_syntax: bool,
}

struct Snapshot {
    at: Position,
    markup_depth: u32,
    nodes: usize,
    lists: usize,
    stack: usize,
    private_uses: usize,
    ctx: u32,
    depth: u32,
    is_unsure: bool,
    shorthand_defaults: u32,
}

impl<'a> Parser<'a> {
    pub(super) fn new(
        mut lx: Lexer<'a>,
        tree: Tree,
        mut buffers: Buffers,
        language: Language,
        (style, tailwind): (Style, Option<&'a Tailwind>),
    ) -> Self {
        buffers.stack.clear();
        buffers.private_names.clear();
        buffers.private_uses.clear();
        buffers.exports.clear();
        buffers.labels.clear();
        lx.next(Gap::Open, Gap::Open);
        Parser {
            budget: (lx.src.len() as u32).saturating_mul(2).max(4096),
            lx,
            tree,
            buffers,
            language,
            style,
            ctx: 0,
            depth: 0,
            is_unsure: false,
            shorthand_defaults: 0,
            class_depth: 0,
            first_label: 0,
            links: 0,
            may_be_too_high: false,
            stack: bun_core::StackCheck::init(),
            tailwind,
            has_default_export: false,
            has_skipped: false,
            is_after_skipped: false,
            has_module_syntax: false,
            has_skipped_export: false,
            is_module_without_module_syntax: false,
        }
    }

    #[inline]
    pub(super) fn token(&self) -> T {
        self.lx.at.token
    }

    #[inline]
    pub(super) fn start(&self) -> u32 {
        self.lx.at.start
    }

    #[inline]
    fn newline_before(&self) -> bool {
        self.lx.at.traits & trait_of::NEWLINE_BEFORE != 0
    }

    #[inline]
    fn has_escape(&self) -> bool {
        self.lx.at.traits & trait_of::ESCAPE != 0
    }

    #[inline]
    fn next(&mut self) {
        self.lx.next(Gap::Open, Gap::Open);
    }

    /// Moves on from a token that's printed between these gaps.
    #[inline(always)]
    fn pass(&mut self, before: Gap, after: Gap) {
        self.lx.next(before, after);
    }

    /// Moves on from a word that starts something.
    #[inline]
    fn pass_keyword(&mut self) {
        self.pass(Gap::Open, Gap::Space);
    }

    #[inline]
    fn pass_prefix(&mut self) {
        self.pass(Gap::Open, Gap::None);
    }

    #[inline]
    fn pass_infix(&mut self) {
        self.pass(Gap::Space, Gap::Space);
    }

    #[inline]
    fn eat(&mut self, token: T) -> bool {
        self.eat_between(Gap::Open, token, Gap::Open)
    }

    #[inline(always)]
    fn eat_between(&mut self, before: Gap, token: T, after: Gap) -> bool {
        let is_it = self.token() == token;
        if is_it {
            self.pass(before, after);
        }
        is_it
    }

    #[inline]
    fn eat_infix(&mut self, token: T) -> bool {
        self.eat_between(Gap::Space, token, Gap::Space)
    }

    #[inline]
    fn eat_suffix(&mut self, token: T) -> bool {
        self.eat_between(Gap::None, token, Gap::Open)
    }

    /// A `,` or `:`
    #[inline]
    fn eat_separator(&mut self, token: T) -> bool {
        self.eat_between(Gap::None, token, Gap::Space)
    }

    #[inline]
    fn expect(&mut self, token: T) -> P<()> {
        self.eat(token).then_some(())
    }

    /// Whatever contains the previous token, and hasn't been added yet, may not be printed as it is.
    #[inline]
    fn odd(&mut self) {
        self.lx.at.prev_odd = self.lx.at.prev_end;
    }

    #[inline]
    fn odd_if(&mut self, condition: bool) {
        if condition {
            self.odd();
        }
    }

    #[inline]
    fn has(&self, ctx: u32) -> bool {
        self.ctx & ctx != 0
    }

    fn unsure(&mut self) {
        self.is_unsure = true;
    }

    fn unsure_if(&mut self, condition: bool) {
        self.is_unsure |= condition;
    }

    #[inline]
    fn require_typescript(&self) -> P<()> {
        require(self.language.is_typescript)
    }

    #[inline]
    fn enter(&mut self) -> P<()> {
        self.depth += 1;
        match self.depth < USUAL_DEPTH {
            true => Some(()),
            false => self.enter_deeper(),
        }
    }

    #[cold]
    fn enter_deeper(&mut self) -> P<()> {
        self.may_be_too_high = true;
        require(self.depth <= MAX_DEPTH && self.stack.is_safe_to_recurse())
    }

    /// For a loop that puts a node above the one before it. `count` is the number of times it has.
    #[inline]
    fn add_link(&mut self, count: &mut u32) -> P<()> {
        *count += 1;
        if *count > 3 {
            self.links += 1;
            self.may_be_too_high |= self.links > MAX_CHAIN;
        }
        require(*count <= MAX_CHAIN)
    }

    #[cold]
    fn is_too_high(&mut self) -> bool {
        let depths = &mut self.buffers.depths;
        depths.clear();
        depths.resize(self.tree.nodes.len(), 0);
        for (id, node) in self.tree.nodes.iter().enumerate().skip(1).rev() {
            let depth = depths.get(node.parent as usize).map_or(0, |it| it + 1);
            if depth > MAX_HEIGHT {
                return true;
            }
            depths[id] = depth;
        }
        false
    }

    #[inline]
    fn leave(&mut self) {
        self.depth -= 1;
    }

    /// Calls `parse` in the context `ctx`.
    #[inline]
    fn with<R>(&mut self, ctx: u32, parse: impl FnOnce(&mut Self) -> P<R>) -> P<R> {
        let outer = std::mem::replace(&mut self.ctx, ctx);
        let result = parse(self);
        self.ctx = outer;
        result
    }

    #[inline]
    fn in_brackets<R>(&mut self, parse: impl FnOnce(&mut Self) -> P<R>) -> P<R> {
        self.enter()?;
        let result = self.with(self.ctx & !ctx::UNTIL_BRACKET, parse)?;
        self.leave();
        Some(result)
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            at: self.lx.at,
            markup_depth: self.lx.markup_depth,
            nodes: self.tree.nodes.len(),
            lists: self.tree.lists.len(),
            stack: self.buffers.stack.len(),
            private_uses: self.buffers.private_uses.len(),
            ctx: self.ctx,
            depth: self.depth,
            is_unsure: self.is_unsure,
            shorthand_defaults: self.shorthand_defaults,
        }
    }

    fn rewind(&mut self, to: &Snapshot) {
        self.budget = (self.budget).saturating_sub(self.lx.at.end.saturating_sub(to.at.start));
        self.lx.go_back(to.at);
        self.lx.markup_depth = to.markup_depth;
        self.tree.nodes.truncate(to.nodes);
        self.tree.lists.truncate(to.lists);
        self.buffers.stack.truncate(to.stack);
        self.buffers.private_uses.truncate(to.private_uses);
        self.ctx = to.ctx;
        self.depth = to.depth;
        self.is_unsure = to.is_unsure;
        self.shorthand_defaults = to.shorthand_defaults;
    }

    /// Calls `look`, which only reads tokens, and goes back.
    fn look_ahead<R>(&mut self, look: impl FnOnce(&mut Self) -> R) -> R {
        let at = self.lx.at;
        let result = look(self);
        self.lx.at = at;
        result
    }

    #[inline]
    fn peek(&mut self) -> (T, bool) {
        self.lx.peek()
    }

    #[inline]
    fn node(&self, id: Id) -> &Node {
        self.tree.node(id)
    }

    #[inline]
    fn kind(&self, id: Id) -> K {
        self.tree.kind(id)
    }

    fn text(&self, id: Id) -> &'a [u8] {
        let node = self.node(id);
        self.slice((node.start, node.end))
    }

    fn slice(&self, (start, end): Name) -> &'a [u8] {
        (self.lx.src.get(start as usize..end as usize)).unwrap_or_default()
    }

    #[inline]
    fn flag(&mut self, id: Id, flags: u32) {
        if id != NONE
            && let Some(node) = self.tree.nodes.get_mut(id as usize)
        {
            node.flags |= flags;
        }
    }

    #[inline]
    fn adopt(&mut self, child: Id, parent: Id) {
        if child != NONE
            && let Some(node) = self.tree.nodes.get_mut(child as usize)
        {
            node.parent = parent;
        }
    }

    /// Adds the current token as a node and moves on.
    #[inline]
    fn leaf(&mut self, kind: K) -> Id {
        let id = self.leaf_without_next(kind);
        self.next();
        id
    }

    #[inline]
    fn leaf_without_next(&mut self, kind: K) -> Id {
        let id = self.tree.nodes.len() as Id;
        self.tree.nodes.push(Node {
            kind,
            op: self.token(),
            flags: if self.lx.at.traits & trait_of::UNUSUAL != 0 {
                flag::ODD
            } else {
                0
            },
            start: self.lx.at.start,
            end: self.lx.at.end,
            ..Node::NONE
        });
        id
    }

    /// Adds a node that ends with the previous token.
    #[inline]
    fn add(&mut self, kind: K, op: T, flags: u32, start: u32, [a, b, c, d]: [Id; 4]) -> Id {
        let id = self.tree.nodes.len() as Id;
        let at = &self.lx.at;
        let flags = flags
            | if at.prev_line > start {
                flag::MULTILINE
            } else {
                0
            }
            | if at.prev_comment > start {
                flag::COMMENT
            } else {
                0
            }
            | if at.prev_odd > start { flag::ODD } else { 0 };
        self.tree.nodes.push(Node {
            kind,
            op,
            len: 0,
            flags,
            start,
            end: at.prev_end,
            a,
            b,
            c,
            d,
            list: 0,
            parent: NONE,
        });
        for child in [a, b, c, d] {
            self.adopt(child, id);
        }
        id
    }

    #[inline]
    fn add1(&mut self, kind: K, start: u32, a: Id) -> Id {
        self.add(kind, T::Unknown, 0, start, [a, NONE, NONE, NONE])
    }

    #[inline]
    fn add2(&mut self, kind: K, start: u32, a: Id, b: Id) -> Id {
        self.add(kind, T::Unknown, 0, start, [a, b, NONE, NONE])
    }

    #[inline]
    fn list_base(&self) -> usize {
        self.buffers.stack.len()
    }

    #[inline]
    fn push(&mut self, id: Id) {
        self.buffers.stack.push(id);
    }

    /// Makes everything pushed since `base` the list of `owner`.
    #[inline]
    fn take_list(&mut self, owner: Id, base: usize) -> P {
        let items = self.buffers.stack.get(base..)?;
        let len = u16::try_from(items.len()).ok()?;
        let list = self.tree.lists.len() as u32;
        self.tree.lists.extend_from_slice(items);
        for &item in items {
            self.tree.nodes.get_mut(item as usize)?.parent = owner;
        }
        self.buffers.stack.truncate(base);
        let node = self.tree.nodes.get_mut(owner as usize)?;
        (node.list, node.len) = (list, len);
        Some(owner)
    }

    #[inline]
    fn add_list(&mut self, kind: K, flags: u32, start: u32, base: usize) -> P {
        let id = self.add(kind, T::Unknown, flags, start, [NONE; 4]);
        self.take_list(id, base)
    }

    /// Parses `item`s separated by commas, and the `close` after them. Returns the flags of the list.
    #[inline]
    fn comma_list(&mut self, close: T, mut item: impl FnMut(&mut Self) -> P) -> P<u32> {
        if self.eat_suffix(close) {
            return Some(0);
        }
        loop {
            let id = item(self)?;
            self.push(id);
            if !self.eat_separator(T::Comma) {
                let before = match close {
                    T::CloseBrace => self.style.inside_braces,
                    _ => Gap::None,
                };
                return self.eat_between(before, close, Gap::Open).then_some(0);
            }
            if self.eat(close) {
                self.odd();
                return Some(flag::TRAILING_COMMA);
            }
        }
    }

    #[inline]
    fn pass_open_brace(&mut self) {
        self.pass(Gap::Open, self.style.inside_braces);
    }

    fn semicolon(&mut self) -> P<()> {
        let has_semicolon = self.eat_suffix(T::Semicolon);
        self.odd_if(has_semicolon != self.style.has_semicolons);
        require(
            has_semicolon
                || matches!(self.token(), T::CloseBrace | T::Eof)
                || self.newline_before(),
        )
    }

    /// A name that's being declared.
    #[inline]
    fn binding_name(&mut self) -> P {
        let token = self.token();
        require(token.is_identifier() && token != T::Eval)?;
        Some(self.leaf(K::Ident))
    }

    #[inline]
    fn word(&mut self) -> P {
        require(self.token().is_word())?;
        Some(self.leaf(K::Ident))
    }

    #[inline]
    fn string(&mut self) -> P {
        require(self.token() == T::Str)?;
        let has_escape = self.has_escape();
        let quote = self.lx.src.get(self.start() as usize).copied();
        let id = self.leaf(K::Str);
        if has_escape || quote != Some(self.style.quote) {
            self.flag(id, if has_escape { flag::ESCAPE } else { 0 });
            self.odd_if(!has_preferred_quotes(self.text(id), self.style.quote));
        }
        Some(id)
    }

    /// True if leaving out a statement may change how another one is parsed, or hide an error.
    pub(super) fn are_statements_linked(&self) -> bool {
        self.is_module_without_module_syntax
            || (self.has_skipped_export
                && (self.has_default_export || !self.buffers.exports.is_empty()))
    }

    /// True if two exports may have the same name.
    pub(super) fn has_duplicate_exports(&mut self) -> bool {
        let mut names = std::mem::take(&mut self.buffers.exports);
        bun_collections::index_sort::sort_slice_by(&mut names, |a, b| {
            self.slice(*a).cmp(self.slice(*b))
        });
        let has_duplicates = (names.array_windows()).any(|&[a, b]| self.slice(a) == self.slice(b));
        self.buffers.exports = names;
        has_duplicates
    }
}

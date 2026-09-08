//! Tree construction on top of lol-html's tokenizer.
//!
//! lol-html (the engine behind `HTMLRewriter`) is driven here through its
//! `transform` layer: a `TransformStream` runs the tokenizer over the input
//! and reports every start tag and end tag by name to a
//! `TransformController` ([`Driver`]), which asks for the full token — with
//! attributes — only for the handful of elements whose attributes the
//! converter reads, and always for text and comments. No selector matching,
//! handler dispatch or output serialization is involved.
//!
//! lol-html tracks just enough parser state to pick text modes (`<script>`,
//! `<textarea>`, …) and namespaces; it does not build a tree or run the HTML
//! tree-construction algorithm. [`Builder`] supplies the parts of that
//! algorithm that decide document *structure* — implied end tags (`<p>a<p>b`,
//! `<li>a<li>b`, cells and rows), scope-limited end-tag matching, table
//! sections and foster parenting, void elements, foreign-content breakout,
//! and the list of active formatting elements (reopening `<b>` across a
//! paragraph break, the adoption agency for `<b><p></b></p>`) — and builds
//! the arena DOM the whitespace pass and the emitter walk.
//!
//! Left out, because none of it changes the Markdown: the `<head>` /
//! `<frameset>` / `<template>` / `<select>` insertion modes, quirks mode,
//! the form element pointer, and attribute adjustments for foreign content.
//!
//! Character references in text and attribute values arrive undecoded;
//! [`super::entities`] decodes them and the results are copied into the
//! DOM's string arena.

use lol_html::errors::RewritingError;
use lol_html::html_content::{StartTag, TextType};
use lol_html::transform::{
    DocumentEnd, LocalName, Namespace, SharedEncoding, SharedMemoryLimiter, StartTagHandlingResult,
    Token, TokenCaptureFlags, TransformController, TransformStream, TransformStreamSettings,
};

use super::dom::{Arena, Attr, Ref, Tag};
use super::entities;

/// Open elements are not stacked deeper than this; start tags past it are
/// dropped (with a space in their place if they were block-level, so the
/// words either side do not run together), and so, in turn, are their end
/// tags.
pub const MAX_TREE_DEPTH: usize = 512;

/// Cap on open elements plus active formatting entries, so that inputs
/// like `<a><a><a>…` (each one cloning its predecessors back open) cannot
/// grow the per-token work without bound. Formatting start tags past it
/// are dropped.
const MAX_HANDLES: usize = 2 * MAX_TREE_DEPTH;

/// An entry on the stack of open elements. Identity is `tag` plus, only
/// when `tag` is `Tag::Other` (custom elements, unknown or unhashable
/// foreign names), the lowercased `name`; known names never touch a string.
/// For a foreign element `tag` still carries the name's identity (an SVG
/// `<title>` is `Tag::Title` here) while its DOM node is `Tag::Other`.
#[derive(Clone, Copy)]
struct Open<'a> {
    node: Ref<'a>,
    tag: Tag,
    name: &'a str,
    html: bool,
}

impl Open<'_> {
    /// Is the HTML element `tag`.
    #[inline]
    fn is(&self, tag: Tag) -> bool {
        self.html && self.tag == tag
    }

    #[inline]
    fn same_name(&self, tag: Tag, name: &str) -> bool {
        self.tag == tag && (tag != Tag::Other || self.name == name)
    }

    /// Is the HTML element with this name.
    #[inline]
    fn named(&self, tag: Tag, name: &str) -> bool {
        self.html && self.same_name(tag, name)
    }
}

#[derive(Clone, Copy)]
enum Ns {
    Html,
    /// SVG or MathML; which one never matters here.
    Foreign,
}

/// Whether an inserted element becomes the current node.
#[derive(Clone, Copy)]
enum Then {
    Push,
    Leave,
}

/// A set of [`Tag`]s as a bitmask: membership is a shift and a mask, so the
/// stack walks below test each open element in a couple of instructions.
#[derive(Clone, Copy)]
struct TagSet([u64; Tag::COUNT.div_ceil(64)]);

impl TagSet {
    const EMPTY: TagSet = TagSet([0; Tag::COUNT.div_ceil(64)]);

    const fn of(tags: &[Tag]) -> TagSet {
        let mut bits = [0u64; Tag::COUNT.div_ceil(64)];
        let mut i = 0;
        while i < tags.len() {
            let t = tags[i] as usize;
            bits[t / 64] |= 1 << (t % 64);
            i += 1;
        }
        TagSet(bits)
    }

    #[inline]
    const fn contains(&self, tag: Tag) -> bool {
        let t = tag as usize;
        self.0[t / 64] >> (t % 64) & 1 != 0
    }
}

macro_rules! tags {
    ($($t:ident),* $(,)?) => {{
        const SET: TagSet = TagSet::of(&[$(Tag::$t),*]);
        SET
    }};
}

const SCOPE_BOUNDARY: TagSet = tags![
    Applet, Caption, Html, Table, Td, Th, Marquee, Object, Template
];

/// Entry in the list of active formatting elements.
#[derive(Clone, Copy)]
enum Afe<'a> {
    Marker,
    Element(Ref<'a>, Tag),
}

struct Builder<'a> {
    arena: Arena<'a>,
    body: Ref<'a>,
    stack: Vec<Open<'a>>,
    afe: Vec<Afe<'a>>,
    /// Text staged across lol-html chunk boundaries.
    text: String,
    text_rules: entities::TextRules,
    /// Drop one leading LF from the next text (after `<pre>`, `<textarea>`).
    skip_lf: bool,
    /// Set once body content has started; until then `<meta>`/`<link>` and
    /// friends belong to `<head>` and are not inserted.
    in_body: bool,
    attr_buf: Vec<Attr<'a>>,
    /// How many more elements reconstruction and the adoption agency may
    /// clone. Both re-create formatting elements a token did not itself
    /// carry (`<li><b>…<li>x` reopens every listed `<b>` for each item), so
    /// without a budget proportional to the input a few kilobytes of setup
    /// turn each later token into hundreds of nodes. Once spent, formatting
    /// is simply no longer reopened.
    clone_budget: usize,
    /// Start tags dropped at the depth cap whose end tags are still due,
    /// counted per [`Tag`] (all unknown names share `Tag::Other`), so those
    /// end tags are dropped too instead of closing something further out.
    dropped: [u32; Tag::COUNT],
    dropped_total: u32,
    /// Number of open `<p>` elements, so the very frequent "close a p
    /// element in button scope" step can skip its stack walk when there is
    /// none.
    open_p: u32,
}

impl<'a> Builder<'a> {
    fn new(arena: Arena<'a>, input_len: usize) -> Self {
        let document = arena.new_document();
        let html = arena.new_element(Tag::Html, true, &[]);
        document.append(html);
        let body = arena.new_element(Tag::Body, true, &[]);
        html.append(body);
        Builder {
            arena,
            body,
            stack: Vec::with_capacity(32),
            afe: Vec::new(),
            text: String::new(),
            text_rules: entities::DATA,
            skip_lf: false,
            in_body: false,
            attr_buf: Vec::new(),
            clone_budget: input_len / 8 + 1024,
            dropped: [0; Tag::COUNT],
            dropped_total: 0,
            open_p: 0,
        }
    }

    #[inline]
    fn current(&self) -> Ref<'a> {
        self.stack.last().map_or(self.body, |o| o.node)
    }

    #[inline]
    fn current_is(&self, tag: Tag) -> bool {
        self.stack.last().is_some_and(|o| o.is(tag))
    }

    // ───────────────────────── text ─────────────────────────

    /// Text arrives in chunks (lol-html splits a text node at its input
    /// buffer boundaries and closes it with an empty `last` chunk). Each chunk
    /// goes into the tree straight away — adjacent text merges there anyway —
    /// except for a trailing piece that the next chunk could change the
    /// meaning of: an unfinished character reference or a CR that may pair
    /// with a following LF. Only that piece is staged.
    fn text_chunk(&mut self, chunk: &str, rules: entities::TextRules, last: bool) {
        if self.text.is_empty() {
            self.text_rules = rules;
            let cut = if last {
                chunk.len()
            } else {
                carry_start(chunk, rules)
            };
            if cut > 0 {
                self.insert_text(&chunk[..cut]);
            }
            if cut < chunk.len() {
                self.text.push_str(&chunk[cut..]);
            }
        } else {
            self.text.push_str(chunk);
            let staged = core::mem::take(&mut self.text);
            let cut = if last {
                staged.len()
            } else {
                carry_start(&staged, self.text_rules)
            };
            if cut > 0 {
                self.insert_text(&staged[..cut]);
            }
            let mut rest = staged;
            rest.drain(..cut);
            self.text = rest;
        }
    }

    fn flush_text(&mut self) {
        if self.text.is_empty() {
            return;
        }
        let mut staged = core::mem::take(&mut self.text);
        self.insert_text(&staged);
        staged.clear();
        self.text = staged;
    }

    fn insert_text(&mut self, raw: &str) {
        if !self.in_body && self.stack.is_empty() {
            if raw.bytes().all(is_html_space) {
                return;
            }
            self.in_body = true;
        }
        let mut rules = self.text_rules;
        if self.stack.last().is_some_and(|o| !o.html) {
            rules.nul_is_fffd = true; // NUL in foreign content is U+FFFD, not dropped
        }
        let decoded = entities::decode_text(raw, rules);
        let mut text: &str = &decoded;
        if core::mem::take(&mut self.skip_lf) {
            text = text.strip_prefix('\n').unwrap_or(text);
            if text.is_empty() {
                return;
            }
        }
        if is_table_context(self.current().tag()) {
            if text.bytes().all(is_html_space) {
                self.arena.append_text(self.current(), text);
                return;
            }
            // Anything else is foster parented: processed as in body (so
            // formatting elements reopen, in front of the table too), and
            // placed before the table if the current node is still the
            // table context afterwards.
            self.reconstruct_formatting();
            if is_table_context(self.current().tag())
                && let Some(table) = self.open_table()
            {
                self.arena.insert_text_before(table, text);
                return;
            }
        } else {
            self.reconstruct_formatting();
        }
        self.arena.append_text(self.current(), text);
    }

    fn comment(&mut self) {
        self.flush_text();
        if !self.in_body {
            return;
        }
        self.current().append(self.arena.new_ignored());
    }

    // ───────────────────── insertion helpers ─────────────────────

    fn open_table(&self) -> Option<Ref<'a>> {
        self.stack
            .iter()
            .rev()
            .find(|o| o.is(Tag::Table))
            .map(|o| o.node)
    }

    /// "Insert at the appropriate place": under the current node, or in
    /// front of the table when the current node is a table context that
    /// cannot take this element (foster parenting).
    fn insert_node(&self, node: Ref<'a>) {
        let cur = self.current();
        if is_table_context(cur.tag())
            && !is_table_part(node.tag())
            && let Some(table) = self.open_table()
        {
            table.insert_before(node);
            return;
        }
        cur.append(node);
    }

    /// Inserts an HTML element and makes it the current node.
    fn open(&mut self, tag: Tag, name: &str, attrs: &[Attr<'a>]) -> Ref<'a> {
        self.insert(tag, name, Ns::Html, attrs, Then::Push)
    }

    /// Inserts an HTML element that takes no content (void, or ignored).
    fn insert_leaf(&mut self, tag: Tag, name: &str, attrs: &[Attr<'a>]) -> Ref<'a> {
        self.insert(tag, name, Ns::Html, attrs, Then::Leave)
    }

    fn insert(&mut self, tag: Tag, name: &str, ns: Ns, attrs: &[Attr<'a>], then: Then) -> Ref<'a> {
        let html = matches!(ns, Ns::Html);
        let node = self
            .arena
            .new_element(if html { tag } else { Tag::Other }, html, attrs);
        // Only `Other` is told apart by name; everything else by `tag`.
        let name = if tag == Tag::Other {
            self.arena.alloc_str(name)
        } else {
            ""
        };
        self.insert_node(node);
        if matches!(then, Then::Push) {
            if html && tag == Tag::P {
                self.open_p += 1;
            }
            self.stack.push(Open {
                node,
                tag,
                name,
                html,
            });
        }
        node
    }

    fn push_clone(&mut self, node: Ref<'a>) -> Ref<'a> {
        let clone = self.arena.clone_element(node);
        self.insert_node(clone);
        self.stack.push(Open {
            node: clone,
            tag: clone.tag(),
            name: "",
            html: true,
        });
        clone
    }

    // ───────────────────── scopes and popping ─────────────────────

    /// Index of the topmost open HTML element that is one of `tags`, giving
    /// up at a scope boundary (`extra` widens the default set).
    #[inline]
    fn find_in_scope(&self, tags: TagSet, extra: TagSet) -> Option<usize> {
        for (i, o) in self.stack.iter().enumerate().rev() {
            if !o.html {
                return None;
            }
            if tags.contains(o.tag) {
                return Some(i);
            }
            if extra.contains(o.tag) || SCOPE_BOUNDARY.contains(o.tag) {
                return None;
            }
        }
        None
    }

    fn in_table_scope(&self, tag: Tag) -> bool {
        for o in self.stack.iter().rev() {
            if o.is(tag) {
                return true;
            }
            if o.is(Tag::Table) || o.is(Tag::Template) {
                return false;
            }
        }
        false
    }

    /// Truncates the stack to `index`. Every element popped this way that
    /// put a marker on the formatting list (cells, captions, `<object>` and
    /// friends) takes its marker, and the formatting elements opened inside
    /// it, off again — however it came to be closed, so markers cannot
    /// accumulate.
    fn pop_to(&mut self, index: usize) {
        let mut markers = 0;
        for o in &self.stack[index..] {
            if o.is(Tag::P) {
                self.open_p -= 1;
            } else if o.html && has_marker(o.tag) {
                markers += 1;
            }
        }
        self.stack.truncate(index);
        for _ in 0..markers {
            self.clear_formatting_to_marker();
        }
    }

    fn close_in_scope(&mut self, tags: TagSet, extra: TagSet) -> bool {
        match self.find_in_scope(tags, extra) {
            Some(i) => {
                self.pop_to(i);
                true
            }
            None => false,
        }
    }

    fn close_p(&mut self) {
        if self.open_p > 0 {
            self.close_in_scope(tags![P], tags![Button]);
        }
    }

    /// Pops until the current node is one of `tags` (or the stack is empty).
    fn clear_to(&mut self, tags: TagSet) {
        let keep = self
            .stack
            .iter()
            .rposition(|o| o.html && tags.contains(o.tag))
            .map_or(0, |i| i + 1);
        self.pop_to(keep);
    }

    /// "Any other end tag": pop through the matching element unless a
    /// special element is in the way.
    fn any_other_end_tag(&mut self, tag: Tag, name: &str) {
        for i in (0..self.stack.len()).rev() {
            let o = self.stack[i];
            if o.named(tag, name) {
                self.pop_to(i);
                return;
            }
            if is_special(&o) {
                return;
            }
        }
    }

    /// The `<li>` / `<dd>` / `<dt>` start-tag rule: close an open one of
    /// `tags` unless a special element other than address/div/p shields it.
    fn close_list_item(&mut self, tags: TagSet) {
        for i in (0..self.stack.len()).rev() {
            let o = self.stack[i];
            if o.html && tags.contains(o.tag) {
                self.pop_to(i);
                break;
            }
            if is_special(&o) && !(o.is(Tag::Address) || o.is(Tag::Div) || o.is(Tag::P)) {
                break;
            }
        }
        self.close_p();
    }

    // ──────────────── active formatting elements ────────────────

    fn afe_position(&self, node: Ref<'a>) -> Option<usize> {
        self.afe
            .iter()
            .rposition(|e| matches!(e, Afe::Element(n, _) if core::ptr::eq(*n, node)))
    }

    fn stack_position(&self, node: Ref<'a>) -> Option<usize> {
        self.stack.iter().rposition(|o| core::ptr::eq(o.node, node))
    }

    /// With the Noah's Ark clause: at most three entries with the same name
    /// and attributes after the last marker.
    fn push_formatting(&mut self, node: Ref<'a>, tag: Tag) {
        let mut same = 0;
        let mut earliest = None;
        for (i, e) in self.afe.iter().enumerate().rev() {
            match e {
                Afe::Marker => break,
                Afe::Element(n, t) => {
                    if *t == tag && same_attrs(n.attrs(), node.attrs()) {
                        same += 1;
                        earliest = Some(i);
                    }
                }
            }
        }
        if same >= 3
            && let Some(i) = earliest
        {
            self.afe.remove(i);
        }
        self.afe.push(Afe::Element(node, tag));
    }

    fn clear_formatting_to_marker(&mut self) {
        while let Some(e) = self.afe.pop() {
            if matches!(e, Afe::Marker) {
                break;
            }
        }
    }

    /// Reopens formatting elements that an earlier block boundary closed,
    /// before more inline content goes in.
    fn reconstruct_formatting(&mut self) {
        let Some(last) = self.afe.last() else {
            return;
        };
        let is_open = |b: &Self, e: &Afe<'a>| match e {
            Afe::Marker => true,
            Afe::Element(n, _) => b.stack_position(n).is_some(),
        };
        if is_open(self, last) {
            return;
        }
        let mut i = self.afe.len() - 1;
        while i > 0 && !is_open(self, &self.afe[i - 1]) {
            i -= 1;
        }
        for j in i..self.afe.len() {
            let Afe::Element(node, tag) = self.afe[j] else {
                continue;
            };
            if self.stack.len() >= MAX_TREE_DEPTH || self.clone_budget == 0 {
                // What cannot be reopened now is forgotten rather than left
                // for the next token to walk past again (the search above is
                // O(list × stack) whenever the tail of the list is closed).
                self.afe.truncate(j);
                break;
            }
            self.clone_budget -= 1;
            let clone = self.push_clone(node);
            self.afe[j] = Afe::Element(clone, tag);
        }
    }

    /// The adoption agency algorithm. Returns `false` when the caller should
    /// fall back to "any other end tag".
    fn adoption_agency(&mut self, tag: Tag) -> bool {
        if let Some(cur) = self.stack.last()
            && cur.is(tag)
        {
            // By far the common case: `<b>…</b>` properly nested, the element
            // both current and the latest formatting entry. The general
            // algorithm below arrives at the same two pops.
            if let Some(Afe::Element(n, _)) = self.afe.last()
                && core::ptr::eq(*n, cur.node)
            {
                self.afe.pop();
                let at = self.stack.len() - 1;
                self.pop_to(at);
                return true;
            }
            if self.afe_position(cur.node).is_none() {
                let at = self.stack.len() - 1;
                self.pop_to(at);
                return true;
            }
        }
        for _ in 0..8 {
            // Formatting element: the last one with this name after the
            // last marker.
            let mut fe_afe = None;
            for (i, e) in self.afe.iter().enumerate().rev() {
                match e {
                    Afe::Marker => break,
                    Afe::Element(_, t) if *t == tag => {
                        fe_afe = Some(i);
                        break;
                    }
                    _ => {}
                }
            }
            let Some(fe_afe) = fe_afe else {
                return false;
            };
            let Afe::Element(fe, _) = self.afe[fe_afe] else {
                unreachable!()
            };
            let Some(fe_stack) = self.stack_position(fe) else {
                self.afe.remove(fe_afe);
                return true;
            };
            if self.stack[fe_stack + 1..]
                .iter()
                .any(|o| !o.html || SCOPE_BOUNDARY.contains(o.tag))
            {
                return true; // not in scope
            }
            // Furthest block: the first special element above it.
            let Some(fb_stack) =
                (fe_stack + 1..self.stack.len()).find(|&i| is_special(&self.stack[i]))
            else {
                self.stack.truncate(fe_stack);
                self.afe.remove(fe_afe);
                return true;
            };
            if self.clone_budget < 4 {
                // Out of budget for the restructuring below (up to four new
                // elements per round): take the element off both lists and
                // leave the tree as it is — what it still encloses stays
                // formatted, nothing later reopens it.
                self.stack.remove(fe_stack);
                self.afe.remove(fe_afe);
                return true;
            }
            let furthest = self.stack[fb_stack].node;
            let common_ancestor = if fe_stack == 0 {
                self.body
            } else {
                self.stack[fe_stack - 1].node
            };
            let mut bookmark = fe_afe;
            let mut node_stack = fb_stack;
            let mut last_node = furthest;
            let mut inner = 0;
            loop {
                inner += 1;
                node_stack -= 1;
                if node_stack == fe_stack {
                    break;
                }
                let node = self.stack[node_stack].node;
                let mut node_afe = self.afe_position(node);
                if inner > 3
                    && let Some(k) = node_afe
                {
                    self.afe.remove(k);
                    if k < bookmark {
                        bookmark -= 1;
                    }
                    node_afe = None;
                }
                let Some(node_afe) = node_afe else {
                    self.stack.remove(node_stack);
                    continue;
                };
                let Afe::Element(_, node_tag) = self.afe[node_afe] else {
                    unreachable!()
                };
                self.clone_budget = self.clone_budget.saturating_sub(1);
                let clone = self.arena.clone_element(node);
                self.afe[node_afe] = Afe::Element(clone, node_tag);
                self.stack[node_stack].node = clone;
                if core::ptr::eq(last_node, furthest) {
                    bookmark = node_afe + 1;
                }
                clone.append(last_node);
                last_node = clone;
            }
            // Place last_node under the common ancestor (foster parented if
            // that is a table context).
            if is_table_context(common_ancestor.tag())
                && let Some(table) = self.open_table()
            {
                table.insert_before(last_node);
            } else {
                common_ancestor.append(last_node);
            }
            // A new element for the formatting element takes over the
            // furthest block's children and goes inside it.
            self.clone_budget = self.clone_budget.saturating_sub(1);
            let clone = self.arena.clone_element(fe);
            furthest.reparent_children(clone);
            furthest.append(clone);
            let fe_afe_now = self.afe_position(fe).expect("still listed");
            if bookmark > fe_afe_now {
                bookmark -= 1;
            }
            self.afe.remove(fe_afe_now);
            self.afe
                .insert(bookmark.min(self.afe.len()), Afe::Element(clone, tag));
            let fe_stack_now = self.stack_position(fe).expect("still open");
            self.stack.remove(fe_stack_now);
            let fb_now = self.stack_position(furthest).expect("still open");
            self.stack.insert(
                fb_now + 1,
                Open {
                    node: clone,
                    tag,
                    name: "",
                    html: true,
                },
            );
        }
        true
    }

    // ───────────────────────── tags ─────────────────────────

    /// `token` is the lexed start tag when the driver asked for it (for
    /// attributes, or a foreign element's self-closing flag); `None` means
    /// an HTML element none of whose attributes are read.
    fn start_tag(&mut self, tag: Tag, name: &str, ns_html: bool, token: Option<&StartTag<'_>>) {
        self.flush_text();
        self.skip_lf = false;
        let self_closing = token.is_some_and(|t| t.self_closing());
        // lol-html reports the SVG/MathML elements whose *content* is HTML
        // (`<svg><title>`, `<math><mi>`, …) in the HTML namespace; the
        // elements themselves are foreign.
        let html = ns_html
            && !(self.stack.last().is_some_and(|o| !o.html)
                && is_html_integration_point_name(tag, name));

        if self.stack.len() >= MAX_TREE_DEPTH
            && !(html && (tag.is_void() || is_ignored_start(tag)))
            && !(self_closing && !html)
        {
            // Past the depth cap: dropped, with a space in a block's place so
            // the words either side do not run together.
            if html && tag.is_block() {
                self.arena.append_text(self.current(), " ");
            }
            let tag = if html { tag } else { Tag::Other };
            self.dropped[tag as usize] += 1;
            self.dropped_total += 1;
            return;
        }

        if !html {
            if self.stack.last().is_none_or(|o| o.html) {
                self.reconstruct_formatting();
            }
            self.in_body = true;
            let attrs = self.take_attrs(token, tag, false);
            self.insert(
                tag,
                name,
                Ns::Foreign,
                &attrs,
                if self_closing {
                    Then::Leave
                } else {
                    Then::Push
                },
            );
            self.attr_buf = attrs;
            return;
        }

        // An HTML start tag while foreign elements are open (lol-html has
        // already decided it is one that breaks out of foreign content, or
        // we are at an integration point): pop the foreign elements up to
        // the nearest HTML element or integration point.
        while let Some(top) = self.stack.last()
            && !top.html
            && !is_html_integration_point(top)
        {
            let at = self.stack.len() - 1;
            self.pop_to(at);
        }

        match tag {
            Tag::Html | Tag::Head | Tag::Body | Tag::Frameset | Tag::Frame => return,
            Tag::Base | Tag::Basefont | Tag::Bgsound | Tag::Link | Tag::Meta => {
                if self.in_body {
                    self.insert_leaf(tag, name, &[]);
                }
                return;
            }
            Tag::Title
            | Tag::Style
            | Tag::Script
            | Tag::Noscript
            | Tag::Template
            | Tag::Noframes => {
                // Contents are dropped by the converter; the element still
                // goes in so it separates the text either side.
                self.open(tag, name, &[]);
                return;
            }
            _ => {}
        }
        self.in_body = true;

        match tag {
            Tag::Address
            | Tag::Article
            | Tag::Aside
            | Tag::Blockquote
            | Tag::Center
            | Tag::Details
            | Tag::Dialog
            | Tag::Dir
            | Tag::Div
            | Tag::Dl
            | Tag::Fieldset
            | Tag::Figcaption
            | Tag::Figure
            | Tag::Footer
            | Tag::Header
            | Tag::Hgroup
            | Tag::Main
            | Tag::Menu
            | Tag::Nav
            | Tag::Ol
            | Tag::P
            | Tag::Search
            | Tag::Section
            | Tag::Summary
            | Tag::Ul
            | Tag::Form
            | Tag::Table
            | Tag::Xmp => self.close_p(),
            Tag::H1 | Tag::H2 | Tag::H3 | Tag::H4 | Tag::H5 | Tag::H6 => {
                self.close_p();
                if self
                    .stack
                    .last()
                    .is_some_and(|o| o.html && o.tag.heading_level().is_some())
                {
                    let at = self.stack.len() - 1;
                    self.pop_to(at);
                }
            }
            Tag::Pre | Tag::Listing => {
                self.close_p();
                self.skip_lf = true;
            }
            Tag::Textarea => self.skip_lf = true,
            Tag::Plaintext => self.close_p(),
            Tag::Hr => {
                self.close_p();
                self.insert_leaf(tag, name, &[]);
                return;
            }
            Tag::Li => self.close_list_item(tags![Li]),
            Tag::Dd | Tag::Dt => self.close_list_item(tags![Dd, Dt]),
            Tag::Button => {
                if let Some(i) = self.find_in_scope(tags![Button], TagSet::EMPTY) {
                    self.pop_to(i);
                }
            }
            Tag::Option => {
                if self.current_is(Tag::Option) {
                    let at = self.stack.len() - 1;
                    self.pop_to(at);
                }
            }
            Tag::Optgroup => {
                if self.current_is(Tag::Option) {
                    let at = self.stack.len() - 1;
                    self.pop_to(at);
                }
                if self.current_is(Tag::Optgroup) {
                    let at = self.stack.len() - 1;
                    self.pop_to(at);
                }
            }
            Tag::Rb | Tag::Rtc => {
                if self.find_in_scope(tags![Ruby], TagSet::EMPTY).is_some() {
                    self.clear_to(tags![Ruby]);
                }
            }
            Tag::Rp | Tag::Rt => {
                if self.find_in_scope(tags![Ruby], TagSet::EMPTY).is_some() {
                    self.clear_to(tags![Ruby, Rtc]);
                }
            }
            Tag::Caption | Tag::Colgroup | Tag::Tbody | Tag::Tfoot | Tag::Thead => {
                if !self.in_table_scope(Tag::Table) {
                    return;
                }
                self.clear_to(tags![Table]);
            }
            Tag::Col => {
                if !self.in_table_scope(Tag::Table) {
                    return;
                }
                self.clear_to(tags![Table, Colgroup]);
                self.insert_leaf(tag, name, &[]);
                return;
            }
            Tag::Tr => {
                if !self.in_table_scope(Tag::Table) {
                    return;
                }
                self.clear_to(tags![Table, Tbody, Thead, Tfoot]);
            }
            Tag::Td | Tag::Th => {
                if !self.in_table_scope(Tag::Table) {
                    return;
                }
                self.clear_to(tags![Table, Tbody, Thead, Tfoot, Tr]);
                if !self.current_is(Tag::Tr) {
                    self.open(Tag::Tr, "tr", &[]);
                }
            }
            Tag::A => {
                // An <a> still listed since the last marker: run the adoption
                // agency for it, then make sure that element is gone from
                // both lists.
                let open_a = self
                    .afe
                    .iter()
                    .rev()
                    .take_while(|e| !matches!(e, Afe::Marker))
                    .find_map(|e| match e {
                        Afe::Element(n, Tag::A) => Some(*n),
                        _ => None,
                    });
                if let Some(old) = open_a
                    && self.adoption_agency(Tag::A)
                {
                    if let Some(k) = self.stack_position(old) {
                        self.stack.remove(k);
                    }
                    if let Some(i) = self.afe_position(old) {
                        self.afe.remove(i);
                    }
                }
            }
            Tag::Nobr => {
                self.reconstruct_formatting();
                if self.find_in_scope(tags![Nobr], TagSet::EMPTY).is_some() {
                    self.adoption_agency(Tag::Nobr);
                }
            }
            _ => {}
        }

        let attrs = self.take_attrs(token, tag, true);
        if is_formatting(tag) {
            if self.stack.len() + self.afe.len() < MAX_HANDLES {
                self.reconstruct_formatting();
                let node = self.open(tag, name, &attrs);
                self.push_formatting(node, tag);
            }
        } else if matches!(tag, Tag::Applet | Tag::Marquee | Tag::Object) {
            self.reconstruct_formatting();
            self.open(tag, name, &attrs);
            self.afe.push(Afe::Marker);
        } else if matches!(tag, Tag::Td | Tag::Th | Tag::Caption) {
            self.open(tag, name, &attrs);
            self.afe.push(Afe::Marker);
        } else if tag == Tag::Image {
            self.reconstruct_formatting();
            self.insert_leaf(Tag::Img, "img", &attrs);
        } else {
            if reconstructs_formatting(tag) {
                self.reconstruct_formatting();
            }
            self.insert(
                tag,
                name,
                Ns::Html,
                &attrs,
                if tag.is_void() {
                    Then::Leave
                } else {
                    Then::Push
                },
            );
        }
        self.attr_buf = attrs;
    }

    fn end_tag(&mut self, tag: Tag, name: &str) {
        self.flush_text();
        self.skip_lf = false;
        if self.dropped_total > 0 {
            let t = if self.stack.last().is_some_and(|o| !o.html) {
                Tag::Other
            } else {
                tag
            };
            if self.dropped[t as usize] > 0 {
                // The end of an element dropped at the depth cap.
                self.dropped[t as usize] -= 1;
                self.dropped_total -= 1;
                if t.is_block() {
                    self.arena.append_text(self.current(), " ");
                }
                return;
            }
        }
        if self.stack.last().is_some_and(|o| !o.html) {
            // "In foreign content" end tag: walk down through foreign elements
            // looking for one with this name; on reaching an HTML element,
            // hand the tag to the HTML rules instead.
            for i in (0..self.stack.len()).rev() {
                let o = self.stack[i];
                if o.html {
                    break;
                }
                if o.same_name(tag, name) {
                    self.pop_to(i);
                    return;
                }
            }
        }
        match tag {
            Tag::Html | Tag::Head | Tag::Body => {}
            Tag::Br => {
                self.reconstruct_formatting();
                self.insert_leaf(Tag::Br, "br", &[]);
            }
            Tag::P => {
                if !self.close_in_scope(tags![P], tags![Button]) {
                    // `</p>` with no open <p> makes an empty paragraph.
                    self.close_p();
                    self.insert_leaf(Tag::P, "p", &[]);
                }
            }
            Tag::Li => {
                self.close_in_scope(tags![Li], tags![Ol, Ul]);
            }
            Tag::Dd | Tag::Dt => {
                self.close_in_scope(TagSet::of(&[tag]), TagSet::EMPTY);
            }
            Tag::H1 | Tag::H2 | Tag::H3 | Tag::H4 | Tag::H5 | Tag::H6 => {
                self.close_in_scope(tags![H1, H2, H3, H4, H5, H6], TagSet::EMPTY);
            }
            Tag::Table
            | Tag::Tbody
            | Tag::Thead
            | Tag::Tfoot
            | Tag::Tr
            | Tag::Td
            | Tag::Th
            | Tag::Caption
            | Tag::Colgroup => {
                if self.in_table_scope(tag) {
                    let i = self
                        .stack
                        .iter()
                        .rposition(|o| o.is(tag))
                        .expect("in scope");
                    self.pop_to(i);
                }
            }
            Tag::Address
            | Tag::Article
            | Tag::Aside
            | Tag::Blockquote
            | Tag::Button
            | Tag::Center
            | Tag::Details
            | Tag::Dialog
            | Tag::Dir
            | Tag::Div
            | Tag::Dl
            | Tag::Fieldset
            | Tag::Figcaption
            | Tag::Figure
            | Tag::Footer
            | Tag::Header
            | Tag::Hgroup
            | Tag::Listing
            | Tag::Main
            | Tag::Menu
            | Tag::Nav
            | Tag::Ol
            | Tag::Pre
            | Tag::Search
            | Tag::Section
            | Tag::Summary
            | Tag::Ul
            | Tag::Form
            | Tag::Xmp => {
                self.close_in_scope(TagSet::of(&[tag]), TagSet::EMPTY);
            }
            Tag::Applet | Tag::Marquee | Tag::Object => {
                self.close_in_scope(TagSet::of(&[tag]), TagSet::EMPTY);
            }
            _ if is_formatting(tag) => {
                if !self.adoption_agency(tag) {
                    self.any_other_end_tag(tag, name);
                }
            }
            _ => self.any_other_end_tag(tag, name),
        }
    }

    /// Materialises the attributes the converter reads for this element —
    /// each `name()` / `value()` on lol-html's side is an allocation, and
    /// `attributes()` itself is what makes it lex the attribute list, so
    /// elements whose attributes are never consulted skip all of it.
    /// Formatting elements keep everything (the Noah's Ark clause compares
    /// whole attribute lists).
    fn take_attrs(&mut self, token: Option<&StartTag<'_>>, tag: Tag, html: bool) -> Vec<Attr<'a>> {
        let mut out = core::mem::take(&mut self.attr_buf);
        out.clear();
        let wanted = if html { wanted_attrs(tag) } else { &[] };
        let Some(token) = token else { return out };
        if wanted.is_empty() {
            return out;
        }
        let all = wanted[0] == "*";
        let arena = self.arena;
        // Straight from the input bytes: nothing is allocated for attributes
        // that are not kept.
        token.for_each_raw_attribute(|raw_name, raw_value| {
            let name: &'a str = if all {
                arena.alloc_ascii_lowercase(raw_name)
            } else {
                match wanted
                    .iter()
                    .find(|w| w.as_bytes().eq_ignore_ascii_case(raw_name))
                {
                    Some(w) => w,
                    None => return true,
                }
            };
            let value = match core::str::from_utf8(raw_value) {
                Ok(v) => arena.alloc_str(&entities::decode_attribute(v)),
                // Sliced from input validated as UTF-8 up front: unreachable.
                Err(_) => "",
            };
            out.push(Attr { name, value });
            !(all && out.len() >= MAX_KEPT_ATTRS)
        });
        out
    }
}

/// The attributes the converter reads, per element; `"*"` (formatting
/// elements) keeps them all, since the Noah's Ark clause compares whole
/// attribute lists. Elements not listed have no start tag token requested
/// for them at all.
fn wanted_attrs(tag: Tag) -> &'static [&'static str] {
    match tag {
        Tag::A => &["href", "title"],
        Tag::Img | Tag::Image => &["src", "alt", "title"],
        Tag::Pre => &["class", "lang"],
        Tag::Code | Tag::Div => &["class"],
        Tag::Ol => &["start"],
        Tag::Td | Tag::Th => &["colspan", "align", "style"],
        Tag::Input => &["type", "checked"],
        _ if is_formatting(tag) => &["*"],
        _ => &[],
    }
}

/// Formatting elements keep at most this many attributes (all of them, in
/// practice); the Noah's Ark comparison below is then bounded too.
const MAX_KEPT_ATTRS: usize = 32;

/// Attribute lists written the same way (same order): what the Noah's Ark
/// clause exists to catch, at linear cost.
fn same_attrs(a: &[Attr<'_>], b: &[Attr<'_>]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(x, y)| x.name == y.name && x.value == y.value)
}

/// Where the part of a non-final text chunk that is safe to insert now ends:
/// before a trailing `&…` that could still become a character reference, or
/// a trailing CR that could still pair with a LF.
fn carry_start(chunk: &str, rules: entities::TextRules) -> usize {
    let bytes = chunk.as_bytes();
    let mut cut = bytes.len();
    match bytes.last() {
        Some(b'\r') => cut -= 1,
        // Only a name/number character (or the `&`/`#` itself) can be the
        // tail of an unfinished reference.
        Some(b) if b.is_ascii_alphanumeric() || *b == b'&' || *b == b'#' => {}
        _ => return cut,
    }
    if rules.decode_refs {
        // Longest reference is 33 bytes (`&CounterClockwiseContourIntegral;`).
        let from = bytes.len().saturating_sub(34);
        if let Some(amp) = bytes[from..cut].iter().rposition(|&b| b == b'&') {
            let amp = from + amp;
            if bytes[amp + 1..cut]
                .iter()
                .all(|&b| b.is_ascii_alphanumeric() || b == b'#')
            {
                cut = amp;
            }
        }
    }
    cut
}

#[inline]
fn is_html_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\x0C' | b'\r')
}

fn is_table_context(tag: Tag) -> bool {
    matches!(
        tag,
        Tag::Table | Tag::Tbody | Tag::Thead | Tag::Tfoot | Tag::Tr
    )
}

fn is_table_part(tag: Tag) -> bool {
    matches!(
        tag,
        Tag::Caption
            | Tag::Colgroup
            | Tag::Col
            | Tag::Tbody
            | Tag::Thead
            | Tag::Tfoot
            | Tag::Tr
            | Tag::Td
            | Tag::Th
            | Tag::Script
            | Tag::Style
            | Tag::Template
    )
}

/// Elements whose start tag pushes a marker onto the formatting list.
fn has_marker(tag: Tag) -> bool {
    matches!(
        tag,
        Tag::Td | Tag::Th | Tag::Caption | Tag::Applet | Tag::Marquee | Tag::Object
    )
}

fn is_formatting(tag: Tag) -> bool {
    matches!(
        tag,
        Tag::A
            | Tag::B
            | Tag::Big
            | Tag::Code
            | Tag::Em
            | Tag::Font
            | Tag::I
            | Tag::Nobr
            | Tag::S
            | Tag::Small
            | Tag::Strike
            | Tag::Strong
            | Tag::Tt
            | Tag::U
    )
}

/// SVG/MathML elements whose content is HTML again (lol-html reports that
/// content, and the elements themselves, in the HTML namespace).
fn is_html_integration_point_name(tag: Tag, name: &str) -> bool {
    matches!(
        tag,
        Tag::Title | Tag::Desc | Tag::Mi | Tag::Mo | Tag::Mn | Tag::Ms | Tag::Mtext
    ) || (tag == Tag::Other && matches!(name, "foreignobject" | "annotation-xml"))
}

fn is_html_integration_point(o: &Open<'_>) -> bool {
    !o.html && is_html_integration_point_name(o.tag, o.name)
}

/// Start tags that go in without consulting the open-element depth.
fn is_ignored_start(tag: Tag) -> bool {
    matches!(
        tag,
        Tag::Html | Tag::Head | Tag::Body | Tag::Frameset | Tag::Frame
    )
}

/// "Any other start tag" (phrasing content, custom elements, voids) reopens
/// formatting elements first; block-level and table/metadata starts do not.
fn reconstructs_formatting(tag: Tag) -> bool {
    !(tag.is_block()
        || matches!(
            tag,
            Tag::Listing
                | Tag::Plaintext
                | Tag::Textarea
                | Tag::Colgroup
                | Tag::Col
                | Tag::Caption
                | Tag::Iframe
                | Tag::Noembed
                | Tag::Select
                | Tag::Optgroup
                | Tag::Option
                | Tag::Xmp
                | Tag::Search
                | Tag::Form
        ))
}

fn is_special(o: &Open<'_>) -> bool {
    if !o.html {
        return is_html_integration_point_name(o.tag, o.name);
    }
    matches!(
        o.tag,
        Tag::Address
            | Tag::Applet
            | Tag::Area
            | Tag::Article
            | Tag::Aside
            | Tag::Base
            | Tag::Basefont
            | Tag::Bgsound
            | Tag::Blockquote
            | Tag::Body
            | Tag::Br
            | Tag::Button
            | Tag::Caption
            | Tag::Center
            | Tag::Col
            | Tag::Colgroup
            | Tag::Dd
            | Tag::Details
            | Tag::Dir
            | Tag::Div
            | Tag::Dl
            | Tag::Dt
            | Tag::Embed
            | Tag::Fieldset
            | Tag::Figcaption
            | Tag::Figure
            | Tag::Footer
            | Tag::Form
            | Tag::Frame
            | Tag::Frameset
            | Tag::H1
            | Tag::H2
            | Tag::H3
            | Tag::H4
            | Tag::H5
            | Tag::H6
            | Tag::Head
            | Tag::Header
            | Tag::Hgroup
            | Tag::Hr
            | Tag::Html
            | Tag::Iframe
            | Tag::Img
            | Tag::Input
            | Tag::Keygen
            | Tag::Li
            | Tag::Link
            | Tag::Listing
            | Tag::Main
            | Tag::Marquee
            | Tag::Menu
            | Tag::Meta
            | Tag::Nav
            | Tag::Noembed
            | Tag::Noframes
            | Tag::Noscript
            | Tag::Object
            | Tag::Ol
            | Tag::P
            | Tag::Param
            | Tag::Plaintext
            | Tag::Pre
            | Tag::Script
            | Tag::Search
            | Tag::Section
            | Tag::Select
            | Tag::Source
            | Tag::Style
            | Tag::Summary
            | Tag::Table
            | Tag::Tbody
            | Tag::Td
            | Tag::Template
            | Tag::Textarea
            | Tag::Tfoot
            | Tag::Th
            | Tag::Thead
            | Tag::Title
            | Tag::Tr
            | Tag::Track
            | Tag::Ul
            | Tag::Wbr
            | Tag::Xmp
    )
}

// ─────────────────────────── driver ───────────────────────────

/// Text as raw byte runs (no `TextChunk` tokens, no re-decoding — the input
/// is already known to be UTF-8), comments as tokens (only their presence
/// matters), start tags on request.
const CAPTURE: TokenCaptureFlags = TokenCaptureFlags::RAW_TEXT.union(TokenCaptureFlags::COMMENTS);

/// A tag name held between lol-html's name-only start tag callback and the
/// token that follows when one was requested. Inline for anything up to 48
/// bytes (every standard element and nearly every custom one).
struct NameBuf {
    buf: [u8; 48],
    len: usize,
    heap: String,
}

impl NameBuf {
    const fn new() -> Self {
        NameBuf {
            buf: [0; 48],
            len: 0,
            heap: String::new(),
        }
    }

    fn clear(&mut self) {
        self.heap.clear();
        self.len = 0;
    }

    /// Stores `name` ASCII-lowercased.
    fn set(&mut self, name: &LocalName<'_>) {
        self.clear();
        match name {
            LocalName::Hash(h) => {
                let mut tmp = [0u8; 12];
                let s = h.decode(&mut tmp).unwrap_or("");
                self.buf[..s.len()].copy_from_slice(s.as_bytes());
                self.len = s.len();
            }
            LocalName::Bytes(b) => {
                let bytes: &[u8] = b;
                if bytes.len() <= self.buf.len() {
                    for (d, s) in self.buf.iter_mut().zip(bytes) {
                        *d = s.to_ascii_lowercase();
                    }
                    self.len = bytes.len();
                } else {
                    #[allow(clippy::disallowed_methods)]
                    // sliced from input validated as UTF-8 up front
                    self.heap
                        .push_str(&String::from_utf8_lossy(bytes).to_ascii_lowercase());
                }
            }
        }
    }

    fn get(&self) -> &str {
        if self.heap.is_empty() {
            // ASCII-lowercasing valid UTF-8 (tag names are sliced from the
            // validated input at ASCII boundaries) keeps it valid.
            core::str::from_utf8(&self.buf[..self.len]).unwrap_or("")
        } else {
            &self.heap
        }
    }
}

struct Driver<'a> {
    builder: Builder<'a>,
    name: NameBuf,
    tag: Tag,
    /// Set while a start tag token has been requested: its namespace.
    pending_html: Option<bool>,
}

fn tag_of(name: &LocalName<'_>) -> Tag {
    match name {
        LocalName::Hash(h) => Tag::from_name_hash(h.as_u64()),
        // Every name the converter knows is representable as a hash.
        LocalName::Bytes(_) => Tag::Other,
    }
}

impl TransformController for Driver<'_> {
    fn initial_capture_flags(&self) -> TokenCaptureFlags {
        CAPTURE
    }

    fn handle_start_tag(
        &mut self,
        name: LocalName<'_>,
        ns: Namespace,
    ) -> StartTagHandlingResult<Self> {
        self.tag = tag_of(&name);
        // Known names are identified by `tag` alone; only the rest need the
        // spelled-out name.
        if self.tag == Tag::Other {
            self.name.set(&name);
        } else {
            self.name.clear();
        }
        let html = matches!(ns, Namespace::Html);
        // Only elements whose attributes are read (or foreign ones, whose
        // self-closing flag matters) need the full start tag token; for the
        // rest the name is all there is to know.
        let wants_attrs = match self.tag {
            // `<code class="language-…">` only matters directly under `<pre>`;
            // inline code spans (far more common) need no token.
            Tag::Code => self.builder.current_is(Tag::Pre),
            tag => !wanted_attrs(tag).is_empty(),
        };
        if !html || wants_attrs {
            self.pending_html = Some(html);
            return Ok(CAPTURE | TokenCaptureFlags::NEXT_START_TAG);
        }
        self.builder
            .start_tag(self.tag, self.name.get(), true, None);
        Ok(CAPTURE)
    }

    fn handle_end_tag(&mut self, name: LocalName<'_>) -> TokenCaptureFlags {
        let tag = tag_of(&name);
        if tag == Tag::Other {
            self.name.set(&name);
        } else {
            self.name.clear();
        }
        self.builder.end_tag(tag, self.name.get());
        CAPTURE
    }

    fn handle_token(&mut self, token: &mut Token<'_>) -> Result<(), RewritingError> {
        match token {
            // Text is taken raw (`handle_raw_text`); `TEXT` is never requested.
            Token::TextChunk(_) => {}
            Token::StartTag(t) => {
                if let Some(html) = self.pending_html.take() {
                    self.builder
                        .start_tag(self.tag, self.name.get(), html, Some(t));
                }
            }
            Token::Comment(_) => self.builder.comment(),
            Token::EndTag(_) | Token::Doctype(_) => {}
        }
        Ok(())
    }

    fn handle_raw_text(&mut self, text: &[u8], text_type: TextType) -> Result<(), RewritingError> {
        let rules = match text_type {
            TextType::Data => entities::DATA,
            TextType::RCData => entities::RCDATA,
            _ => entities::RAW,
        };
        // SAFETY: `text` is a sub-slice of the `&str` given to `parse` (the
        // stream is fed that one buffer), cut by the tokenizer at ASCII
        // delimiters or at the ends of the input, so it is valid UTF-8 on
        // char boundaries.
        let text = unsafe { core::str::from_utf8_unchecked(text) };
        // The end of the text node is implied by whatever comes next; every
        // other event flushes what `text_chunk` may hold back.
        self.builder.text_chunk(text, rules, false);
        Ok(())
    }

    fn handle_end(&mut self, _: &mut DocumentEnd<'_>) -> Result<(), RewritingError> {
        self.builder.flush_text();
        Ok(())
    }

    fn should_emit_content(&self) -> bool {
        // Nothing is rewritten; skipping serialization is the point.
        false
    }
}

/// Parses `html` into `arena` and returns the `<body>` element to convert.
/// `html` must not be memory another thread can write to: text reaches the
/// tree as unchecked sub-slices of it (see `handle_raw_text`).
pub(crate) fn parse<'a>(html: &str, arena: Arena<'a>) -> Ref<'a> {
    // Input-stream preprocessing: a leading BOM is not content.
    let html = html.strip_prefix('\u{FEFF}').unwrap_or(html);

    let mut stream = TransformStream::new(TransformStreamSettings {
        transform_controller: Driver {
            builder: Builder::new(arena, html.len()),
            name: NameBuf::new(),
            tag: Tag::Other,
            pending_html: None,
        },
        output_sink: |_: &[u8]| {},
        preallocated_parsing_buffer_size: 0,
        memory_limiter: SharedMemoryLimiter::new(usize::MAX),
        encoding: SharedEncoding::new(lol_html::AsciiCompatibleEncoding::utf_8()),
        strict: false,
    });
    // The input is one complete in-memory buffer and the controller never
    // fails, so neither call can error; were one to, the tree built so far
    // is used.
    if stream.write(html.as_bytes()).is_ok() {
        let _ = stream.end();
    }
    let driver = stream.controller();
    driver.builder.flush_text();
    driver.builder.body
}

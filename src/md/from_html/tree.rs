//! Tree construction on top of lol-html.
//!
//! lol-html (Bun's `HTMLRewriter`) tokenizes and tracks just enough parser
//! state to pick text modes (`<script>`, `<textarea>`, …) and namespaces,
//! and reports start tags, end tags, text and comments through its handler
//! API. It does not build a tree or run the HTML tree-construction
//! algorithm. This module supplies the parts of that algorithm that decide
//! document *structure* — implied end tags (`<p>a<p>b`, `<li>a<li>b`, cells
//! and rows), scope-limited end-tag matching, table sections and foster
//! parenting, void elements, active formatting elements (reopening `<b>`
//! across a paragraph break, the adoption agency for `<b><p></b></p>`) —
//! and builds the arena DOM the whitespace pass and the emitter walk.
//!
//! Left out, because none of it changes the Markdown: the `<head>` /
//! `<frameset>` / `<template>` / `<select>` insertion modes, quirks mode,
//! the form element pointer, and attribute adjustments for foreign content.
//!
//! lol-html hands names and attribute values over as fresh `String`s and
//! leaves character references undecoded; [`super::entities`] decodes them
//! and the results are copied into the DOM's string arena.

use core::cell::RefCell;
use std::borrow::Cow;

use lol_html::html_content::{Comment, Element, EndTag, TextChunk, TextType};
use lol_html::{
    DocumentContentHandlers, ElementContentHandlers, HtmlRewriter, LocalHandlerTypes,
    MemorySettings, Settings,
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

const NS_HTML: &str = "http://www.w3.org/1999/xhtml";

#[derive(Clone, Copy)]
struct Open<'a> {
    node: Ref<'a>,
    tag: Tag,
    /// Lowercased local name (for `Tag::Other` comparisons).
    name: &'a str,
    html: bool,
}

impl Open<'_> {
    #[inline]
    fn is(&self, tag: Tag) -> bool {
        self.html && self.tag == tag
    }

    #[inline]
    fn named(&self, tag: Tag, name: &str) -> bool {
        self.html && self.tag == tag && (tag != Tag::Other || self.name == name)
    }
}

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
    /// Formatting elements whose end tags can no longer arrive; see
    /// [`Builder::end_tag_unreachable`].
    unreachable: Vec<Ref<'a>>,
    /// How many more elements reconstruction and the adoption agency may
    /// clone. Both re-create formatting elements a token did not itself
    /// carry (`<li><b>…<li>x` reopens every listed `<b>` for each item), so
    /// without a budget proportional to the input a few kilobytes of setup
    /// turn each later token into hundreds of nodes. Once spent, formatting
    /// is simply no longer reopened.
    clone_budget: usize,
}

impl<'a> Builder<'a> {
    fn new(arena: Arena<'a>, input_len: usize) -> Self {
        let document = arena.new_document();
        let html = arena.new_element("html", true, &[]);
        document.append(html);
        let body = arena.new_element("body", true, &[]);
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
            unreachable: Vec::new(),
            clone_budget: input_len / 8 + 1024,
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

    fn text_chunk(&mut self, chunk: &str, rules: entities::TextRules, last: bool) {
        if last && self.text.is_empty() {
            // The common case: a whole text node in one chunk.
            self.text_rules = rules;
            self.insert_text(chunk);
            return;
        }
        if self.text.is_empty() {
            self.text_rules = rules;
        }
        self.text.push_str(chunk);
        if last {
            self.flush_text();
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
        self.settle_unreachable();
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

    fn insert(&mut self, name: &str, html: bool, attrs: &[Attr<'a>], push: bool) -> Ref<'a> {
        let name = self.arena.alloc_str(name);
        let node = self.arena.new_element(name, html, attrs);
        self.insert_node(node);
        if push {
            self.stack.push(Open {
                node,
                tag: node.tag(),
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
    fn find_in_scope(&self, tags: &[Tag], extra: &[Tag]) -> Option<usize> {
        for (i, o) in self.stack.iter().enumerate().rev() {
            if !o.html {
                return None;
            }
            if tags.contains(&o.tag) {
                return Some(i);
            }
            if extra.contains(&o.tag) || is_scope_boundary(o.tag) {
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
        let markers = self.stack[index..]
            .iter()
            .filter(|o| o.html && has_marker(o.tag))
            .count();
        self.stack.truncate(index);
        for _ in 0..markers {
            self.clear_formatting_to_marker();
        }
    }

    fn close_in_scope(&mut self, tags: &[Tag], extra: &[Tag]) -> bool {
        match self.find_in_scope(tags, extra) {
            Some(i) => {
                self.pop_to(i);
                true
            }
            None => false,
        }
    }

    fn close_p(&mut self) {
        self.close_in_scope(&[Tag::P], &[Tag::Button]);
    }

    /// Pops until the current node is one of `tags` (or the stack is empty).
    fn clear_to(&mut self, tags: &[Tag]) {
        let keep = self
            .stack
            .iter()
            .rposition(|o| o.html && tags.contains(&o.tag))
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
    fn close_list_item(&mut self, tags: &[Tag]) {
        for i in (0..self.stack.len()).rev() {
            let o = self.stack[i];
            if o.html && tags.contains(&o.tag) {
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
            && self.afe_position(cur.node).is_none()
        {
            let at = self.stack.len() - 1;
            self.pop_to(at);
            return true;
        }
        for _ in 0..8 {
            if self.clone_budget < 4 {
                return false;
            }
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
                .any(|o| !o.html || is_scope_boundary(o.tag))
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

    /// lol-html matched an ancestor's end tag past `node`, so `node`'s own
    /// end tag — if one ever comes — will not be reported. For a formatting
    /// element the builder pops but keeps listed for reopening
    /// (`<p><i>a</p><p>b</i>c`), that would reopen it into every block that
    /// follows with nothing left to close it; dropping it from the list
    /// instead confines the difference to the stretch a browser would still
    /// have shown formatted (`b`). lol-html reports this *before* the end
    /// tag that caused it, so the check waits until that tag has been
    /// processed.
    fn end_tag_unreachable(&mut self, node: Ref<'a>) {
        if is_formatting(node.tag()) {
            self.unreachable.push(node);
        }
    }

    fn settle_unreachable(&mut self) {
        while let Some(node) = self.unreachable.pop() {
            if let Some(i) = self.afe_position(node)
                && self.stack_position(node).is_none()
            {
                self.afe.remove(i);
            }
        }
    }

    // ───────────────────────── tags ─────────────────────────

    /// Returns the element if it went onto the open-element stack, i.e. if
    /// its end tag will mean anything to the builder.
    fn start_tag(
        &mut self,
        name: &str,
        ns_html: bool,
        self_closing: bool,
        el: &Element<'_, '_>,
    ) -> Option<Ref<'a>> {
        self.flush_text();
        self.settle_unreachable();
        self.skip_lf = false;
        let tag = Tag::from_name(name);
        // lol-html reports the SVG/MathML elements whose *content* is HTML
        // (`<svg><title>`, `<math><mi>`, …) in the HTML namespace; the
        // elements themselves are foreign.
        let html = ns_html
            && !(self.stack.last().is_some_and(|o| !o.html)
                && matches!(
                    name,
                    "title"
                        | "desc"
                        | "foreignobject"
                        | "mi"
                        | "mo"
                        | "mn"
                        | "ms"
                        | "mtext"
                        | "annotation-xml"
                ));

        if self.stack.len() >= MAX_TREE_DEPTH
            && !(html && (tag.is_void() || is_ignored_start(tag)))
            && !(self_closing && !html)
        {
            // Past the depth cap: dropped, with a space in a block's place so
            // the words either side do not run together.
            if html && tag.is_block() {
                self.arena.append_text(self.current(), " ");
            }
            return None;
        }

        if !html {
            if self.stack.last().is_none_or(|o| o.html) {
                self.reconstruct_formatting();
            }
            self.in_body = true;
            let attrs = self.take_attrs(el, tag, false);
            let node = self.insert(name, false, &attrs, !self_closing);
            self.attr_buf = attrs;
            return (!self_closing).then_some(node);
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
            Tag::Html | Tag::Head | Tag::Body | Tag::Frameset | Tag::Frame => return None,
            Tag::Base | Tag::Basefont | Tag::Bgsound | Tag::Link | Tag::Meta => {
                if self.in_body {
                    self.insert(name, true, &[], false);
                }
                return None;
            }
            Tag::Title
            | Tag::Style
            | Tag::Script
            | Tag::Noscript
            | Tag::Template
            | Tag::Noframes => {
                // Contents are dropped by the converter; the element still
                // goes in so it separates the text either side.
                return Some(self.insert(name, true, &[], true));
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
                self.insert(name, true, &[], false);
                return None;
            }
            Tag::Li => self.close_list_item(&[Tag::Li]),
            Tag::Dd | Tag::Dt => self.close_list_item(&[Tag::Dd, Tag::Dt]),
            Tag::Button => {
                if let Some(i) = self.find_in_scope(&[Tag::Button], &[]) {
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
                if self.find_in_scope(&[Tag::Ruby], &[]).is_some() {
                    self.clear_to(&[Tag::Ruby]);
                }
            }
            Tag::Rp | Tag::Rt => {
                if self.find_in_scope(&[Tag::Ruby], &[]).is_some() {
                    self.clear_to(&[Tag::Ruby, Tag::Rtc]);
                }
            }
            Tag::Caption | Tag::Colgroup | Tag::Tbody | Tag::Tfoot | Tag::Thead => {
                if !self.in_table_scope(Tag::Table) {
                    return None;
                }
                self.clear_to(&[Tag::Table]);
            }
            Tag::Col => {
                if !self.in_table_scope(Tag::Table) {
                    return None;
                }
                self.clear_to(&[Tag::Table, Tag::Colgroup]);
                self.insert(name, true, &[], false);
                return None;
            }
            Tag::Tr => {
                if !self.in_table_scope(Tag::Table) {
                    return None;
                }
                self.clear_to(&[Tag::Table, Tag::Tbody, Tag::Thead, Tag::Tfoot]);
            }
            Tag::Td | Tag::Th => {
                if !self.in_table_scope(Tag::Table) {
                    return None;
                }
                self.clear_to(&[Tag::Table, Tag::Tbody, Tag::Thead, Tag::Tfoot, Tag::Tr]);
                if !self.current_is(Tag::Tr) {
                    self.insert("tr", true, &[], true);
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
                if self.find_in_scope(&[Tag::Nobr], &[]).is_some() {
                    self.adoption_agency(Tag::Nobr);
                }
            }
            _ => {}
        }

        let attrs = self.take_attrs(el, tag, true);
        let pushed = if is_formatting(tag) {
            if self.stack.len() + self.afe.len() < MAX_HANDLES {
                self.reconstruct_formatting();
                let node = self.insert(name, true, &attrs, true);
                self.push_formatting(node, tag);
                Some(node)
            } else {
                None
            }
        } else if matches!(tag, Tag::Applet | Tag::Marquee | Tag::Object) {
            self.reconstruct_formatting();
            let node = self.insert(name, true, &attrs, true);
            self.afe.push(Afe::Marker);
            Some(node)
        } else if matches!(tag, Tag::Td | Tag::Th | Tag::Caption) {
            let node = self.insert(name, true, &attrs, true);
            self.afe.push(Afe::Marker);
            Some(node)
        } else if tag == Tag::Image {
            self.reconstruct_formatting();
            self.insert("img", true, &attrs, false);
            None
        } else {
            if reconstructs_formatting(tag) {
                self.reconstruct_formatting();
            }
            let node = self.insert(name, true, &attrs, !tag.is_void());
            (!tag.is_void()).then_some(node)
        };
        self.attr_buf = attrs;
        pushed
    }

    fn end_tag(&mut self, name: &str, html: bool) {
        self.end_tag_rules(name, html);
        self.settle_unreachable();
    }

    fn end_tag_rules(&mut self, name: &str, html: bool) {
        self.flush_text();
        self.skip_lf = false;
        if !html {
            // "In foreign content" end tag: walk down through foreign elements
            // looking for one with this name; on reaching an HTML element,
            // hand the tag to the HTML rules instead.
            for i in (0..self.stack.len()).rev() {
                let o = self.stack[i];
                if o.html {
                    break;
                }
                if o.name == name {
                    self.pop_to(i);
                    return;
                }
            }
        }
        let tag = Tag::from_name(name);
        match tag {
            Tag::Html | Tag::Head | Tag::Body => {}
            Tag::Br => {
                self.reconstruct_formatting();
                self.insert("br", true, &[], false);
            }
            Tag::P => {
                if !self.close_in_scope(&[Tag::P], &[Tag::Button]) {
                    // `</p>` with no open <p> makes an empty paragraph.
                    self.close_p();
                    self.insert("p", true, &[], false);
                }
            }
            Tag::Li => {
                self.close_in_scope(&[Tag::Li], &[Tag::Ol, Tag::Ul]);
            }
            Tag::Dd | Tag::Dt => {
                self.close_in_scope(&[tag], &[]);
            }
            Tag::H1 | Tag::H2 | Tag::H3 | Tag::H4 | Tag::H5 | Tag::H6 => {
                self.close_in_scope(&[Tag::H1, Tag::H2, Tag::H3, Tag::H4, Tag::H5, Tag::H6], &[]);
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
                self.close_in_scope(&[tag], &[]);
            }
            Tag::Applet | Tag::Marquee | Tag::Object => {
                self.close_in_scope(&[tag], &[]);
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
    fn take_attrs(&mut self, el: &Element<'_, '_>, tag: Tag, html: bool) -> Vec<Attr<'a>> {
        let mut out = core::mem::take(&mut self.attr_buf);
        out.clear();
        let wanted: &[&str] = if !html {
            &[]
        } else {
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
        };
        if wanted.is_empty() {
            return out;
        }
        let all = wanted[0] == "*";
        for a in el
            .attributes()
            .iter()
            .take(if all { MAX_KEPT_ATTRS } else { usize::MAX })
        {
            let name = a.name();
            let name: &'a str = if all {
                self.arena.alloc_str(&name)
            } else {
                match wanted.iter().find(|w| **w == name) {
                    Some(w) => w,
                    None => continue,
                }
            };
            let value = a.value();
            let value = self.arena.alloc_str(&entities::decode_attribute(&value));
            out.push(Attr { name, value });
        }
        out
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

fn is_scope_boundary(tag: Tag) -> bool {
    matches!(
        tag,
        Tag::Applet
            | Tag::Caption
            | Tag::Html
            | Tag::Table
            | Tag::Td
            | Tag::Th
            | Tag::Marquee
            | Tag::Object
            | Tag::Template
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

fn is_html_integration_point(o: &Open<'_>) -> bool {
    !o.html
        && matches!(
            o.name,
            "foreignobject"
                | "desc"
                | "title"
                | "mi"
                | "mo"
                | "mn"
                | "ms"
                | "mtext"
                | "annotation-xml"
        )
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
        return matches!(
            o.name,
            "mi" | "mo"
                | "mn"
                | "ms"
                | "mtext"
                | "annotation-xml"
                | "foreignobject"
                | "desc"
                | "title"
        );
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

/// Parses `html` into `arena` and returns the `<body>` element to convert.
pub(crate) fn parse<'a>(html: &[u8], arena: Arena<'a>) -> Ref<'a> {
    // Input-stream preprocessing: a leading BOM is not content.
    let html = html.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(html);

    let builder = RefCell::new(Builder::new(arena, html.len()));
    let b = &builder;

    let on_element = |el: &mut Element<'_, '_>| -> lol_html::HandlerResult {
        let name = el.tag_name();
        let ns_html = el.namespace_uri() == NS_HTML;
        let self_closing = el.is_self_closing();
        let pushed = b.borrow_mut().start_tag(&name, ns_html, self_closing, el);
        // Elements that did not go on the stack (voids, dropped or ignored
        // tags) have nothing to close, and each registered handler costs
        // lol-html an allocation and bookkeeping per open element.
        if let Some(node) = pushed
            && let Some(handlers) = el.end_tag_handlers()
        {
            let html = b.borrow().stack.last().is_none_or(|o| o.html);
            // lol-html wants end tag handlers `'static`; the builder and the
            // node they reach both outlive the rewriter owning them, so their
            // addresses travel as integers.
            let bp = core::ptr::from_ref(b) as usize;
            let np = core::ptr::from_ref(node) as usize;
            handlers.push(Box::new(move |end: &mut EndTag<'_>| {
                // SAFETY: see `bp`/`np` above — `builder` and the arena are
                // alive for every callback the rewriter makes, and the builder
                // is only otherwise borrowed through the same `RefCell`.
                let (b, node) = unsafe {
                    (
                        &*(bp as *const RefCell<Builder<'_>>),
                        &*(np as *const super::dom::Node<'_>),
                    )
                };
                // lol-html also runs this when an ancestor's end tag closes
                // the element in its (non-tree-building) view; that is not a
                // token for the tree builder, but it does mean the element's
                // real end tag will never be delivered.
                if end.name().eq_ignore_ascii_case(&name) {
                    b.borrow_mut().end_tag(&name, html);
                } else {
                    b.borrow_mut().end_tag_unreachable(node);
                }
                Ok(())
            }));
        }
        Ok(())
    };
    let on_comment = |_: &mut Comment<'_>| -> lol_html::HandlerResult {
        b.borrow_mut().comment();
        Ok(())
    };
    let on_text = |t: &mut TextChunk<'_>| -> lol_html::HandlerResult {
        let rules = match t.text_type() {
            TextType::Data => entities::DATA,
            TextType::RCData => entities::RCDATA,
            _ => entities::RAW,
        };
        b.borrow_mut()
            .text_chunk(t.as_str(), rules, t.last_in_text_node());
        Ok(())
    };

    let settings: Settings<'_, '_, LocalHandlerTypes> = Settings {
        element_content_handlers: vec![(
            Cow::Owned("*".parse().expect("static selector")),
            ElementContentHandlers {
                element: Some(Box::new(on_element)),
                comments: None,
                text: None,
            },
        )],
        document_content_handlers: vec![DocumentContentHandlers {
            doctype: None,
            comments: Some(Box::new(on_comment)),
            text: Some(Box::new(on_text)),
            end: None,
        }],
        encoding: lol_html::AsciiCompatibleEncoding::utf_8(),
        memory_settings: MemorySettings {
            preallocated_parsing_buffer_size: 1024,
            max_allowed_memory_usage: usize::MAX,
        },
        strict: false,
        enable_esi_tags: false,
        adjust_charset_on_meta_tag: false,
    };
    let mut rewriter = HtmlRewriter::new(settings, |_: &[u8]| {});
    // The input is one complete in-memory buffer and no handler fails, so
    // neither call can error; were one to, the tree built so far is used.
    if rewriter.write(html).is_ok() {
        let _ = rewriter.end();
    } else {
        drop(rewriter);
    }

    let mut builder = builder.into_inner();
    builder.flush_text();
    builder.body
}

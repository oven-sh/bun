//! The commands that insert.

use super::blocks::is_single_line_container;
use super::delete::Deletion;
use super::inline::{is_anchor, is_modifiable};
use super::looks::{Beside, editable, host_of, is_editable, is_plain, share_host};
use super::tags::*;
use super::*;
use crate::api::editing::clipboard::BREAK_BETWEEN_BLOCKS;

const KEEPING_WRAPPERS: Deletion = Deletion {
    merges_blocks: true,
    strips_wrappers: false,
    collapses_to_start: true,
};

fn is_script_url(value: &DomString) -> bool {
    let shown = value
        .units()
        .skip_while(|it| *it <= 32)
        .filter(|it| !matches!(it, 9 | 10 | 13));
    shown
        .take(11)
        .map(|it| u8::try_from(it).map_or(0, |it| it.to_ascii_lowercase()))
        .eq(*b"javascript:")
}

impl<'a> Editor<'_, 'a> {
    /// There is no place for the caret after a break that begins no line.
    fn can_insert(&self) -> Step<bool> {
        if let Some(it) = child_before(self.start())
            .filter(|it| self.active.collapsed() && self.is_collapsed_break(it))
        {
            let block = core::iter::successors(it.next_sibling(), |it| it.next_sibling())
                .find(|it| self.is_visible(it));
            self.put_caret(
                editable(block)
                    .filter(|it| is_line_container(*it))
                    .map_or_else(|| before(it), |it| Ok(at(it, 0)))?,
            );
        }
        Ok(host_of(self.start().node).is_some() && !self.is_hidden(self.start().node))
    }

    fn leave_text_at_its_ends(&self) -> Step {
        let caret = self.start();
        if caret.node.kind() == Kind::Comment || caret.node.is_text() && caret.offset == 0 {
            self.put_caret(before(caret.node)?);
        } else if caret.node.is_text() && is_at_end(caret) {
            self.put_caret(after(caret.node)?);
        }
        Ok(())
    }

    /// So that what is inserted does not look like what is around it.
    fn leave_formatting(&self) -> Step {
        self.leave_text_at_its_ends()?;
        if self.start().node.is_text() {
            self.put_caret(before(self.split_text(self.start())?)?);
        }
        while let Some(wrapper) = editable(Some(self.start().node))
            .filter(|it| is_modifiable(it) && !it.is_html(atom!("a")) && self.is_inline(it))
        {
            let next = child_after(self.start());
            if next == wrapper.first_child() {
                self.put_caret(before(wrapper)?);
            } else {
                if next.is_some() {
                    let copy = self.copy(wrapper)?;
                    self.insert_after(copy, wrapper)?;
                    while copy.first_child() != next {
                        self.move_to(wrapper.last_child().ok_or(Stuck)?, at(copy, 0))?;
                    }
                }
                self.put_caret(after(wrapper)?);
            }
            if wrapper.first_child().is_none() {
                self.remove(wrapper)?;
            }
        }
        Ok(())
    }

    pub(super) fn insert_rule(&self, id: &str) -> Step {
        let (mut start, mut end) = (self.start(), self.end());
        while start.offset == 0 && is_editable(start.node) {
            start = before(start.node)?;
        }
        while is_at_end(end) && is_editable(end.node) {
            end = after(end.node)?;
        }
        self.select(start, end);
        self.delete_selection(Deletion {
            merges_blocks: false,
            ..Default::default()
        })?;
        if !self.can_insert()? {
            return Ok(());
        }
        self.leave_text_at_its_ends()?;
        let rule = if id.is_empty() {
            self.create(atom!("hr"))
        } else {
            self.create_with(atom!("hr"), atom!("id"), id)?
        };
        self.insert_at_caret(rule)?;
        self.fix_disallowed_ancestors(rule)?;
        self.put_caret(after(rule)?);
        Ok(())
    }

    /// Of the nodes that are inserted, because markup can mean something else when it is parsed again.
    fn remove_scripts(&self, root: &'a Node) -> Step {
        for element in self
            .keep(root.descendants())
            .into_iter()
            .filter_map(Node::as_element)
        {
            match element.tag() {
                atom!("script")
                | atom!("iframe")
                | atom!("object")
                | atom!("embed")
                | atom!("template")
                | atom!("animate")
                | atom!("set") => self.remove(element)?,
                _ => self.change(|cx| {
                    let runs = |(name, value): &(QualName, DomString)| {
                        name.local.as_utf8().starts_with("on") || is_script_url(value)
                    };
                    element
                        .attrs()
                        .into_iter()
                        .filter(runs)
                        .for_each(|it| _ = element.remove_attr_ns(cx, it.0));
                })?,
            }
        }
        Ok(())
    }

    fn remove_breaks_beside_blocks(&self, fragment: &'a Node) -> Step {
        for it in self.keep(fragment.children()) {
            let is_marked = it
                .as_element()
                .is_some_and(|it| it.attr_is(atom!("class"), BREAK_BETWEEN_BLOCKS));
            if is_marked
                && it
                    .previous_sibling()
                    .or_else(|| it.next_sibling())
                    .is_some_and(is_not_for_paragraphs)
            {
                self.remove(it)?;
            }
        }
        Ok(())
    }

    pub(super) fn insert_html(&self, markup: &DomString, is_pasted: bool) -> Step {
        self.delete_selection(Deletion::default())?;
        if !self.can_insert()? {
            return Ok(());
        }
        self.leave_text_at_its_ends()?;
        let around = element_at(self.start().node).ok_or(Stuck)?;
        let context = if is_row_holder(around.html_tag()) {
            around
        } else {
            self.create(atom!("body")).as_element().ok_or(Stuck)?
        };
        let fragment: &Node = self
            .change(|cx| host::parse_fragment(cx, context, markup))?
            .ok_or(Stuck)?;
        if is_pasted {
            self.remove_scripts(fragment)?;
            self.remove_breaks_beside_blocks(fragment)?;
        }
        self.keep(fragment.descendants().filter(|it| is_never_inserted(*it)))
            .into_iter()
            .try_for_each(|it| self.remove(it))?;
        if is_plain(around)
            || is_pasted
                && fragment
                    .first_child()
                    .is_some_and(|it| it.is_text() && is_only_child(it))
        {
            return self.insert_text(&fragment.descendant_text_content());
        }
        if let Some(only) = fragment
            .first_child()
            .filter(|it| is_only_child(it) && is_preformatted(*it) && around.is_html(it.html_tag()))
        {
            self.unwrap(only)?;
        }
        let (Some(last), inside) = (fragment.last_child(), self.keep(fragment.descendants()))
        else {
            return Ok(());
        };
        let caret = self.start();
        if self.is_block(caret.node) {
            for it in self.keep(caret.node.children().skip(caret.offset as usize)) {
                if is_editable(it) && self.is_block_prop(it) {
                    self.remove(it)?;
                }
            }
        }
        if inside.iter().any(|it| is_modifiable(it)) {
            self.leave_formatting()?;
        }
        let item = self.start().node;
        if let Some(last_item) = last.last_child().filter(|_| {
            item.is_html(atom!("li"))
                && item.first_child().is_none()
                && is_list(last)
                && is_only_child(last)
        }) {
            while let Some(first) = last.first_child() {
                self.insert(first, parent(item)?, Some(item))?;
            }
            self.remove(item)?;
            self.put_caret(end_of(last_item));
            return Ok(());
        }
        self.insert_at_caret(fragment)?;
        if let Some(block) = self
            .block(Some(self.start().node))
            .filter(|it| !self.has_visible_child(it))
        {
            self.add_break(block, None)?;
        }
        self.put_caret(after(last)?);
        inside
            .into_iter()
            .filter(|it| !is(it.parent(), atom!("xmp")))
            .try_for_each(|it| self.fix_disallowed_ancestors(it))
    }

    pub(super) fn insert_image(&self, source: &str) -> Step {
        self.delete_selection(KEEPING_WRAPPERS)?;
        if !self.can_insert()? {
            return Ok(());
        }
        self.leave_text_at_its_ends()?;
        let Point { node, offset } = self.start();
        if let Some(only) = node
            .first_child()
            .filter(|it| offset == 0 && is_only_child(it) && is_break(*it) && self.is_block(node))
        {
            self.remove(only)?;
        }
        let image = if source.is_empty() {
            self.create(atom!("img"))
        } else {
            self.create_with(atom!("img"), atom!("src"), source)?
        };
        self.insert_at_caret(image)?;
        self.put_caret(after(image)?);
        Ok(())
    }

    fn break_line(&self) -> Step {
        let around = element_at(self.start().node).ok_or(Stuck)?;
        if (is_plain(around) || !is_preformatted(self.block_of(around)))
            && self.keeps_breaks(around)
        {
            self.leave_link(false)?;
            self.put_text(&"\n".into())?;
            self.collapse(false);
            return self.keep_last_line();
        }
        if !is_tag_allowed_in(atom!("br"), around) {
            return Ok(());
        }
        self.leave_text_at_its_ends()?;
        let made = self.create(atom!("br"));
        self.insert_at_caret(made)?;
        if self.is_collapsed_break(made) {
            self.add_break_after(made)?;
        }
        self.put_caret(after(made)?);
        self.canonicalize_whitespace(before(made)?, false)?;
        self.canonicalize_whitespace(after(made)?, false)
    }

    pub(super) fn insert_line_break(&self) -> Step {
        self.delete_to_replace()?;
        if !self
            .start()
            .node
            .inclusive_ancestors()
            .take_while(|it| self.is_inline(it))
            .any(|it| it.is_element() && it.first_child().is_none())
        {
            self.settle_caret_behind()?;
        }
        if self.can_insert()? {
            self.break_line()
        } else {
            Ok(())
        }
    }

    pub(super) fn insert_paragraph(&self) -> Step {
        self.delete_selection(Deletion::default())?;
        while self.start().offset == 0
            && is_row_holder(self.start().node)
            && is_editable(self.start().node)
        {
            self.put_caret(before(self.start().node)?);
        }
        let formats = if self
            .start()
            .node
            .inclusive_ancestors()
            .any(|it| is_heading(it.html_tag()))
        {
            Vec::new()
        } else {
            self.current_overrides()
        };
        if self.can_insert()? {
            self.split_paragraph()?;
        }
        self.restore_formats(formats)
    }

    /// For the line that has the caret. `None` if there is nothing left to do.
    fn make_paragraph(&self) -> Step<Maybe<'a>> {
        let (node, suits) = (self.start().node, |it: &'a Node| {
            is_allowed_in_tag(it, atom!("p"))
        });
        let first = self
            .contained(
                self.selected_lines(),
                &|it| is_editable(it) && suits(it),
                true,
            )
            .first()
            .copied();
        if !is_tag_allowed_in(
            self.separator(),
            first.and_then(Node::parent).unwrap_or(node),
        ) {
            return self.break_line().map(|()| None);
        }
        if first.is_some() {
            return self.wrap_in(
                &self.keep(core::iter::successors(first, |it| {
                    it.next_sibling().filter(|it| suits(it))
                })),
                &|_| false,
                self.separator(),
            );
        }
        for is_last in [false, true]
            .into_iter()
            .skip(self.has_visible_child(node).into())
        {
            let made = self.create(self.separator());
            self.insert_at_caret(made)?;
            self.add_break(made, None)?;
            self.put_caret(if is_last { at(made, 0) } else { after(made)? });
        }
        Ok(None)
    }

    /// If it shows nothing it gets a line. Answers where the caret goes.
    fn open(&self, mut block: &'a Node, wrappers: &[&'a Node]) -> Step<&'a Node> {
        if self.has_content(block) {
            return Ok(block);
        }
        for it in self.children(block) {
            if it.is_text() || self.is_block_prop(it) {
                self.remove(it)?;
            }
        }
        for wrapper in wrappers.iter().rev() {
            let copy = self.copy_without_id(wrapper)?;
            self.insert(copy, block, None)?;
            block = copy;
        }
        self.add_break(block, None)?;
        Ok(block)
    }

    fn split_container(&self, container: &'a Node, wrappers: &[&'a Node]) -> Step {
        let mut start = self.start();
        if !container.contains(start.node) {
            start = if is_before(start, at(container, 0)) {
                at(container, 0)
            } else {
                end_of(container)
            };
        }
        while start.offset == 0 && self.is_inline(start.node) {
            start = before(start.node)?;
        }
        while is_at_end(start) && self.is_inline(start.node) {
            start = after(start.node)?;
        }
        let moved = self.contained([start, end_of(container)], &|_| true, false);
        let tag = match container.html_tag() {
            tag if !matches!(moved[..], []) && !matches!(moved[..], [only] if is_break(only)) => {
                tag
            }
            tag if is_heading(tag) => self.separator(),
            atom!("dt") => atom!("dd"),
            atom!("dd") => atom!("dt"),
            tag => tag,
        };
        let made = self.create_like(container, tag)?;
        self.set_attribute(made, atom!("id"), None)?;
        self.insert_after(made, container)?;
        if start != end_of(container) {
            let fragment: &Node = self
                .change(|cx| Range::new(&cx.heap, start, end_of(container)).extract_contents(cx))?
                .map_err(|_| Stuck)?;
            let mut copies = core::iter::successors(fragment.first_child(), |it| it.first_child())
                .take_while(|it| !moved.contains(it));
            copies.try_for_each(|it| self.set_attribute(it, atom!("id"), None))?;
            self.insert(fragment, made, None)?;
        }
        let innermost = |of: &'a Node, child: fn(&'a Node) -> Maybe<'a>| {
            core::iter::successors(Some(of), |it| {
                child(*it).filter(|it| is_not_for_paragraphs(*it))
            })
            .last()
            .unwrap_or(of)
        };
        let (container, made) = (
            innermost(container, Node::last_child),
            innermost(made, Node::first_child),
        );
        self.open(container, wrappers)?;
        self.put_caret(at(self.open(made, wrappers)?, 0));
        self.canonicalize_whitespace(end_of(container), false)?;
        self.canonicalize_whitespace(at(made, 0), false)
    }

    /// What is a block by its name only cannot be told from the paragraphs otherwise. The line that has been there stays as it is.
    fn split_inline_block(&self, inline: &'a Node, wrappers: &[&'a Node]) -> Step {
        let (made, mut start) = (self.create(self.separator()), self.start());
        while start.offset == 0 && inline.contains(start.node) {
            start = before(start.node)?;
        }
        if start == before(inline)? {
            self.insert(made, parent(inline)?, Some(inline))?;
            self.open(made, wrappers)?;
            self.put_caret(before(inline)?);
            return Ok(());
        }
        while is_at_end(start) && inline.contains(start.node) {
            start = after(start.node)?;
        }
        let end = after(inline)?;
        let rest: &Node = self
            .change(|cx| Range::new(&cx.heap, start, end).extract_contents(cx))?
            .map_err(|_| Stuck)?;
        self.insert(rest, made, None)?;
        self.insert_after(made, inline)?;
        self.put_caret(at(self.open(made, wrappers)?, 0));
        Ok(())
    }

    fn split_paragraph(&self) -> Step {
        let caret = self.start();
        let block = self.block_of(caret.node);
        let is_in_inline_host = host_of(caret.node).is_some_and(|it| {
            self.is_atomic(it)
                && !caret
                    .node
                    .inclusive_ancestors()
                    .take_while(|at| *at != it)
                    .any(|it| self.is_block(it))
        });
        let is_in_button = caret
            .node
            .inclusive_ancestors()
            .any(|it| block.contains(it) && it.is_html(atom!("button")));
        if is_plain(caret.node)
            || !share_host(block, caret.node)
            || is_in_inline_host
            || is_in_button
        {
            return self.break_line();
        }
        if caret.node.is_text() && caret.offset > 0 && !is_at_end(caret) {
            self.split_text(caret)?;
        }
        let styled = self.first_equivalent(self.start()).node;
        let innermost = if styled.is_text() {
            parent(styled)?
        } else {
            self.start().node
        };
        let mut wrappers = self.keep(
            innermost
                .inclusive_ancestors()
                .take_while(|it| self.is_inline(it) && is_editable(it))
                .filter(|it| it.is_element()),
        );
        if wrappers.iter().any(|it| it.is_html(atom!("a"))) {
            wrappers.clear();
        }
        self.leave_text_at_its_ends()?;
        let node = self.start().node;
        let is_container = |it: &'a Node| {
            self.is_block(it)
                && (is_single_line_container(it) || it == block && is_inline_container(it))
        };
        let mut container = node;
        while let Some(parent) = editable(container.parent())
            .filter(|it| !is_container(container) && share_host(node, it))
        {
            container = parent;
        }
        if matches!(container.html_tag(), atom!("p") | atom!("div")) {
            container = container
                .inclusive_ancestors()
                .take_while(|it| is_editable(it))
                .find(|it| is_item(*it))
                .unwrap_or(container);
        }
        if !is_editable(container) || !share_host(container, node) || !is_container(container) {
            if let Some(&outermost) = wrappers.last().filter(|it| is_not_for_paragraphs(**it)) {
                return if is_tag_allowed_in(self.separator(), parent(outermost)?) {
                    self.split_inline_block(outermost, &wrappers)
                } else {
                    self.break_line()
                };
            }
            let Some(made) = self.make_paragraph()? else {
                return Ok(());
            };
            container = made;
        }
        if matches!(
            container.html_tag(),
            atom!("address") | atom!("listing") | atom!("pre")
        ) {
            return self.break_line();
        }
        if is_item(container)
            && (container.first_child().is_none() || self.has_only_block_prop(container))
        {
            self.split_parent(&[container])?;
            return self.leave_container(container);
        }
        self.split_container(container, &wrappers)
    }

    /// What is typed at an end of a link is not part of it.
    fn leave_link(&self, may_stay_at_start: bool) -> Step {
        let caret = self.start();
        let link = caret
            .node
            .inclusive_ancestors()
            .take_while(|it| is_editable(it) && self.is_inline(it))
            .find(|it| is_anchor(it));
        let Some(link) = link.filter(|it| it.descendants().any(|it| self.is_formattable(it)))
        else {
            return Ok(());
        };
        let is_empty = |range| {
            self.contained(
                range,
                &|it| self.is_formattable(it) && !self.is_block_prop(it),
                false,
            )
            .is_empty()
        };
        let (is_in_text, start, end) = (caret.node.is_text(), before(link)?, after(link)?);
        if (!is_in_text || is_at_end(caret)) && is_empty([caret, end]) {
            let (formats, inner) = (
                self.current_overrides(),
                self.toggles_inside(link, caret.node),
            );
            self.put_caret(end);
            self.restore_formats(inner.into_iter().chain(formats).collect())?;
        } else if !may_stay_at_start
            && (!is_in_text || caret.offset == 0)
            && is_empty([start, caret])
        {
            self.put_caret(start);
        }
        Ok(())
    }

    /// Selects what it has inserted.
    fn put_text(&self, value: &DomString) -> Step {
        let mut caret = self.start();
        while child_before(caret).is_some_and(|it| it.is_element() && self.is_removable(it))
            && !matches!(
                child_after(self.start()).html_name(),
                atom!("br") | atom!("hr") | atom!("input")
            )
        {
            caret.offset -= 1;
        }
        let (hard_space, is_newline) = (DomString::from_latin1(b"\xa0"), value.eq_str("\n"));
        let value = if value.eq_str(" ") && !self.keeps_spaces(caret.node) {
            &hard_space
        } else {
            value
        };
        let text = |it: Maybe<'a>| it.filter(|it| it.is_text());
        caret = text(child_before(caret))
            .map(end_of)
            .or_else(|| Some(at(text(child_after(caret))?, 0)))
            .unwrap_or(caret);
        self.put_caret(caret);
        self.canonicalize_whitespace(caret, true)?;
        caret = self.start();
        let Point { node, offset } = caret;
        if node.is_text() {
            let is_placeholder = offset + 1 == node.length()
                && ends_with_newline(node)
                && unit_before(node, offset).is_none_or(|it| it == NEWLINE);
            let drops = is_placeholder
                && !is_newline
                && self.keeps_breaks(node)
                && self.beside(node, true) == Beside::Edge;
            self.replace_data(node, offset, drops.into(), value)?;
        } else {
            if let Some(it) = child_after(caret)
                .filter(|it| !is_newline && is_break(*it) && self.is_block_prop(it))
            {
                self.remove(it)?;
            }
            self.leave_text_at_its_ends()?;
            caret = at(
                self.with(|cx| self.ui.doc().create_text(&cx.heap, value.clone())),
                0,
            );
            self.insert_at_caret(caret.node)?;
        }
        self.select(caret, at(caret.node, caret.offset + value.len()));
        Ok(())
    }

    /// One at a time, each space is made to show.
    fn insert_line(&self, text: &DomString, mut start: u32, end: u32, replaces: bool) -> Step {
        while start < end && self.can_insert()? {
            let length = (start..end)
                .take_while(|it| text.unit(*it) != 32)
                .count()
                .max(1) as u32;
            let formats = self.current_overrides();
            self.leave_link(replaces)?;
            let formats = Some(self.current_overrides())
                .filter(|it| !it.is_empty())
                .unwrap_or(formats);
            self.put_text(&text.substring(start, length))?;
            self.restore_formats(formats)?;
            self.canonicalize_ends(false)?;
            self.collapse(false);
            start += length;
        }
        Ok(())
    }

    /// What is inserted takes the place of the text that the selection starts with, if it does.
    fn delete_to_replace(&self) -> Step {
        let selected = self.formattable();
        if selected.first().is_some_and(|it| it.is_html(atom!("img"))) {
            self.delete_selection(Deletion::default())?;
            return self.settle_caret_behind();
        }
        let link = selected
            .first()
            .and_then(|it| it.ancestors().find(|it| is_anchor(it) && is_editable(it)));
        let link = link.filter(|link| selected.iter().any(|it| !link.contains(it)));
        self.delete_selection(KEEPING_WRAPPERS)?;
        let Some(link) = link.filter(|it| it.parent().is_some() && !self.has_visible_child(it))
        else {
            return Ok(());
        };
        let formats = self.current_overrides();
        self.put_caret(before(link)?);
        self.remove(link)?;
        self.restore_formats(formats)
    }

    pub(super) fn insert_text(&self, value: &DomString) -> Step {
        let replaces = !self.active.collapsed();
        self.delete_to_replace()?;
        let (value, mut start) = (crate::api::forms::normalize_newlines(value), 0);
        loop {
            let end = (start..value.len()).find(|it| value.unit(*it) == NEWLINE);
            self.insert_line(
                &value,
                start,
                end.unwrap_or(value.len()),
                replaces && start == 0,
            )?;
            let Some(end) = end else { return Ok(()) };
            self.keeping_overrides(|| self.insert_paragraph().map(|()| true))?;
            start = end + 1;
        }
    }
}

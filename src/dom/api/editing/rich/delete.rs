//! https://w3c.github.io/editing/docs/execCommand/#deleting-the-selection

use super::inline::is_anchor;
use super::looks::{
    Beside, editable, host_of, is_editable, is_host, is_part_of_document, is_unit, is_white,
    share_host, shares_host_with_parent, sibling,
};
use super::tags::*;
use super::*;
use crate::api::editing::characters;

#[derive(Clone, Copy)]
pub(super) struct Deletion {
    pub(super) merges_blocks: bool,
    pub(super) strips_wrappers: bool,
    pub(super) collapses_to_start: bool,
}

impl Default for Deletion {
    fn default() -> Self {
        Deletion {
            merges_blocks: true,
            strips_wrappers: true,
            collapses_to_start: true,
        }
    }
}

fn child_with<'a>(parent: &'a Node, descendant: &'a Node) -> Step<&'a Node> {
    descendant
        .inclusive_ancestors()
        .find(|it| it.parent() == Some(parent))
        .ok_or(Stuck)
}

impl<'a> Editor<'_, 'a> {
    fn mergeable_block(&self, mut node: &'a Node) -> Maybe<'a> {
        while shares_host_with_parent(node) && self.is_inline(node) {
            node = node.parent()?;
        }
        ((self.is_block(node) || is_host(node))
            && is_tag_allowed_in(atom!("span"), node)
            && !is_cell(node))
        .then_some(node)
    }

    /// Of the line that starts with `from`. A newline becomes a `<br>`.
    fn break_at_end_of_line(&self, from: &mut &'a Node) -> Step<Maybe<'a>> {
        let (within, mut next) = (from.parent(), Some(*from));
        while let Some(node) = self.inline(next) {
            if is_break(node) {
                return Ok(Some(node));
            }
            let newline = if node.is_text() && self.keeps_breaks(node) {
                node.text().units().position(|it| it == NEWLINE)
            } else {
                None
            };
            if let Some(newline) = newline.map(|it| it as u32) {
                if newline + 1 < node.length() {
                    self.split_text(at(node, newline + 1))?;
                }
                self.delete_data(node, newline, 1)?;
                let made = self.add_break_after(node)?;
                if node.length() == 0 {
                    if node == *from {
                        *from = made;
                    }
                    self.remove(node)?;
                }
                return Ok(Some(made));
            }
            next = if is_unit(node) {
                node.following_skip(within)
            } else {
                node.following(within)
            };
        }
        Ok(None)
    }

    /// The siblings from `from` to the end of the line, which is made a `<br>` among them.
    fn first_line(&self, from: Maybe<'a>) -> Step<Nodes<'a>> {
        let Some(mut from) = from else {
            return Ok(Vec::new());
        };
        let within = from.parent();
        if let Some(end) = self.break_at_end_of_line(&mut from)? {
            while end.parent() != within {
                let wrapper = parent(end)?;
                if wrapper == from && end.previous_sibling().is_none() {
                    from = end;
                }
                if end.next_sibling().is_some() && end.previous_sibling().is_some() {
                    let copy = self.copy_without_id(wrapper)?;
                    self.insert_after(copy, wrapper)?;
                    while let Some(next) = end.next_sibling() {
                        self.move_to_end(next, copy)?;
                    }
                }
                self.move_to(
                    end,
                    if end.previous_sibling().is_some() {
                        after(wrapper)?
                    } else {
                        before(wrapper)?
                    },
                )?;
                if wrapper.first_child().is_none() {
                    self.remove(wrapper)?;
                }
            }
        }
        Ok(
            self.keep(core::iter::successors(self.inline(Some(from)), |it| {
                self.inline(it.next_sibling().filter(|_| !is_break(*it)))
            })),
        )
    }

    /// What `<pre>` has by itself does not count.
    fn authored_white_space(&self, mut node: &'a Node) -> String {
        while let Some(element) = element_at(node) {
            let value = self.computed(element, "white-space");
            let above = element.ancestors().map_while(Node::as_element);
            let source = above
                .take_while(|it| self.computed(it, "white-space") == value)
                .last()
                .unwrap_or(element);
            let is_authored = || {
                self.with(|cx| {
                    layout::styled(cx, source, |engine, id| {
                        engine.is_set_by_author(id, b"white-space-collapse")
                    })
                })
            };
            let Some(parent) = source
                .parent()
                .filter(|_| is_preformatted(source.html_tag()) && !is_authored())
            else {
                return value;
            };
            node = parent;
        }
        String::new()
    }

    /// `nodes` keep the white space that they have in their block.
    fn keeping_white_space(&self, nodes: &[&'a Node], change: impl FnOnce() -> Step) -> Step {
        let values: Vec<_> = nodes
            .iter()
            .map(|it| self.authored_white_space(it))
            .collect();
        change()?;
        let mut made = None;
        for (index, (&node, value)) in nodes.iter().zip(&values).enumerate() {
            let Some(parent) = node.parent().filter(|it| {
                !is_break(node)
                    && !is_replaced(node)
                    && self.is_visible(node)
                    && self.authored_white_space(it) != *value
            }) else {
                continue;
            };
            if node.is_element() {
                if self.inline_style(node, "white-space").is_empty() {
                    self.set_style(node, "white-space", value)?;
                }
                continue;
            }
            if made.is_none()
                || made != node.previous_sibling()
                || values.get(index.wrapping_sub(1)) != Some(value)
            {
                let span = *made.insert(self.create(atom!("span")));
                self.insert(span, parent, Some(node))?;
                self.set_style(span, "white-space", value)?;
            }
            self.move_to_end(node, made.ok_or(Stuck)?)?;
        }
        Ok(())
    }

    fn prune(&self, mut node: &'a Node) -> Step {
        while let Some(parent) = editable(node.parent())
            .filter(|it| it.children().all(|it| it == node || !self.is_visible(it)))
        {
            node = parent;
        }
        self.remove(node)
    }

    fn caret_x(&self, node: &'a Node) -> Option<f32> {
        self.with(|cx| {
            layout::caret_rect(
                cx,
                layout::Caret {
                    point: at(node, 0),
                    is_upstream: false,
                },
            )
        })
        .map(|it| it.x)
    }

    fn remove_empty_block(&self, start: &'a Node, mut end: &'a Node) -> Step {
        while is_editable(end) && is_only_child(end) && end.parent() != Some(start) {
            end = parent(end)?;
        }
        if !is_editable(end) {
            return Ok(());
        }
        if self.inline(end.previous_sibling()).is_some()
            && self.inline(end.next_sibling()).is_some()
        {
            self.add_break_after(end)?;
        }
        self.remove(end)
    }

    fn remove_what_is_left_of(&self, mut end: &'a Node, start: &'a Node) -> Step {
        while let Some(first) = self
            .removable(end.first_child())
            .filter(|_| !self.has_visible_child(end))
        {
            self.remove(first)?;
        }
        while end.first_child().is_none() && is_editable(end) {
            let outer = parent(end)?;
            self.remove(end)?;
            end = outer;
            if !end.contains(start)
                && end
                    .children()
                    .all(|it| it.is_text() && !self.is_visible(it))
            {
                self.children(end)
                    .into_iter()
                    .try_for_each(|it| self.remove(it))?;
            }
        }
        Ok(())
    }

    fn remove_with_wrappers(&self, node: &'a Node) -> Step {
        self.remove(
            node.ancestors()
                .take_while(|it| is_editable(it) && self.is_inline(it) && has_at_most_one_child(it))
                .last()
                .unwrap_or(node),
        )
    }

    /// `ends_with_break`: the line to add to still has its end. `kept` ends the line before it.
    fn merge_blocks(
        &self,
        start: &'a Node,
        end: &'a Node,
        ends_with_break: bool,
        kept: Maybe<'a>,
        is_end_emptied: bool,
    ) -> Step {
        let kept_spaces = self.keeps_spaces(end);
        if !self.has_content(end) && !end.contains(start) {
            self.keep(
                end.children()
                    .filter(|it| it.is_element() && self.is_removable(it)),
            )
            .into_iter()
            .try_for_each(|it| self.remove(it))?;
        }
        if self.has_only_block_prop(start) {
            if !is_end_emptied
                && !end.contains(start)
                && is_editable(start)
                && self
                    .caret_x(end)
                    .zip(self.caret_x(start))
                    .is_some_and(|(a, b)| a > b)
            {
                self.put_caret(at(end, 0));
                return self.prune(start);
            }
            self.remove(start.first_child().ok_or(Stuck)?)?;
        }
        let (has_end, is_in_end) = (start.contains(end), end.contains(start));
        let moved = if has_end {
            let holder = child_with(start, end)?;
            self.put_caret(before(holder)?);
            if end.first_child().is_none() {
                return self.remove_empty_block(start, end);
            }
            if self.beside(holder, false) != Beside::Content && !ends_with_break {
                self.put_caret(at(end, 0));
                return Ok(());
            }
            let moved = self.first_line(end.first_child())?;
            if moved.is_empty() {
                return Ok(());
            }
            moved
        } else {
            self.put_caret(end_of(start));
            let next = if is_in_end {
                child_with(end, start)?.next_sibling()
            } else {
                end.first_child()
            };
            if let Some(last) = start
                .last_child()
                .filter(|it| is_break(*it) && kept != Some(it) && self.inline(next).is_some())
            {
                self.remove(last)?;
            }
            self.first_line(next)?
        };
        let change = || {
            if !has_end {
                moved
                    .iter()
                    .try_for_each(|it| self.move_to_end(it, start))?;
                return if is_in_end {
                    Ok(())
                } else {
                    self.remove_what_is_left_of(end, start)
                };
            }
            while moved[0].parent() != Some(start) && self.split_parent(&moved)? {}
            editable(moved[0].previous_sibling())
                .filter(|it| is_break(*it))
                .map_or(Ok(()), |it| self.remove(it))
        };
        self.keeping_own_values(&moved, false, || self.keeping_white_space(&moved, change))?;
        if kept_spaces && !self.keeps_spaces(start) {
            self.canonicalize_whitespace(self.start(), false)?;
        }
        if start.first_child().is_none() {
            self.add_break(start, None)?;
        }
        self.trim_break_at_end(start)
    }

    fn remove_selected_nodes(&self, start: &'a Node, strips_wrappers: bool) -> Step {
        let can_go = |it: &'a Node| {
            (is_editable(it) || it.parent().is_some_and(|it| is_editable(it) || is_host(it)))
                && !is_table_part(it)
                && !is_part_of_document(it)
        };
        for node in self.contained([self.start(), self.end()], &can_go, true) {
            let mut outer = parent(node)?;
            self.remove(node)?;
            let strips = strips_wrappers || !outer.contains(start);
            while strips
                && outer.first_child().is_none()
                && is_editable(outer)
                && self.is_inline(outer)
            {
                let empty = outer;
                outer = parent(empty)?;
                self.remove(empty)?;
            }
            let block = self.block_of(outer);
            if share_host(block, outer)
                && !self.has_visible_child(block)
                && is_tag_allowed_in(atom!("br"), outer)
            {
                self.add_break(outer, None)?;
            }
        }
        Ok(())
    }

    pub(super) fn delete_selection(&self, how: Deletion) -> Step {
        self.canonicalize_ends(true)?;
        let (mut start, mut end) = (
            self.last_equivalent(self.start()),
            self.first_equivalent(self.end()),
        );
        if !is_before(start, end) {
            self.collapse(how.collapses_to_start);
            return Ok(());
        }
        let leaves_text = start.node == end.node
            && start.node.is_text()
            && !is_at_end(end)
            && (start.offset > 0 || !start.node.ancestors().any(is_anchor));
        let of_list = |it: Maybe<'a>| editable(it.filter(|it| is_list(*it) || is_item(*it)));
        if of_list(child_after(start)).is_some()
            && is_at_end(end)
            && of_list(end.node.last_child()).is_some()
        {
            while let Some(first) = of_list(child_after(start)) {
                start = at(first, 0);
            }
            while let Some(last) = of_list(end.node.last_child()) {
                end = end_of(last);
            }
        }
        if start.node.is_text() && start.offset == 0 {
            start = before(start.node)?;
        }
        if end.node.is_text() && is_at_end(end) {
            end = after(end.node)?;
        }
        self.select(start, end);
        let blocks = self
            .mergeable_block(start.node)
            .zip(self.mergeable_block(end.node))
            .filter(|(a, b)| how.merges_blocks && a != b);
        let end_had_content = blocks.is_some_and(|it| self.has_content(it.1));
        let starts_before_nothing = how.strips_wrappers
            && child_after(start)
                .is_some_and(|it| it.is_element() && it.first_child().is_none() && !is_unit(it));
        let starts_at_list = child_after(start).is_some_and(is_list);
        let formats = if leaves_text || starts_before_nothing {
            Vec::new()
        } else {
            self.selected_formats()
        };
        let ends_with_break = child_before(start).is_some_and(|it| self.is_extraneous_break(it));
        let kept = child_before(start).filter(|_| {
            self.inline(child_after(start))
                .is_some_and(|it| self.is_visible(it))
        });
        let is_mutable_text = |it: &'a Node| it.is_text() && is_editable(it) && !self.is_inert(it);
        if start.node == end.node && is_mutable_text(start.node) {
            self.delete_data(start.node, start.offset, end.offset - start.offset)?;
            self.canonicalize_whitespace(start, false)?;
            self.collapse(how.collapses_to_start);
        } else {
            if is_mutable_text(start.node) {
                self.delete_data(start.node, start.offset, start.node.length() - start.offset)?;
            }
            self.remove_selected_nodes(start.node, how.strips_wrappers)?;
            if is_mutable_text(end.node) {
                self.delete_data_before(end)?;
            }
            self.canonicalize_ends(false)?;
            match blocks.filter(|(a, b)| share_host(a, b)) {
                Some((first, last)) => self.merge_blocks(
                    first,
                    last,
                    ends_with_break,
                    kept,
                    end_had_content && !self.has_content(last),
                )?,
                None => self.collapse(how.collapses_to_start),
            }
        }
        self.keep_last_line()?;
        if how.strips_wrappers && !starts_at_list {
            self.remove_redundant_blocks()?;
        }
        self.restore_formats(formats)
    }

    /// Those around a line that has been emptied.
    fn remove_redundant_blocks(&self) -> Step {
        let block = self.start().node;
        let is_redundant = |it: &&'a Node| {
            it.is_html(atom!("div")) && attribute_count(it) == 0 && is_only_child(it)
        };
        let redundant = self.keep(
            block
                .inclusive_ancestors()
                .take_while(|it| is_editable(it))
                .take_while(is_redundant),
        );
        if redundant.is_empty() || !self.has_only_block_prop(block) {
            return Ok(());
        }
        let prop = block.first_child().ok_or(Stuck)?;
        redundant.into_iter().try_for_each(|it| self.unwrap(it))?;
        self.put_caret(before(prop)?);
        Ok(())
    }

    fn is_between_uneditable_blocks(&self, point: Point<'a>) -> bool {
        let sides = [child_before(point), child_after(point)];
        self.is_block(point.node)
            && sides != [None; 2]
            && sides
                .into_iter()
                .flatten()
                .all(|it| self.is_block(it) && !is_editable(it))
    }

    /// A newline at the end of a block begins no line.
    pub(super) fn keep_last_line(&self) -> Step {
        let point = self.first_equivalent(self.start());
        let node = point.node;
        if !self.active.collapsed() || host_of(node).is_none() {
            return Ok(());
        }
        if node.is_text() {
            if !is_at_end(point)
                || !ends_with_newline(node)
                || !self.keeps_breaks(node)
                || self.beside(node, true) != Beside::Edge
            {
                return Ok(());
            }
            self.replace_data(node, point.offset, 0, &"\n".into())?;
        } else {
            let follows_collapsed_break =
                child_before(point).is_some_and(|it| self.is_collapsed_break(it));
            if !if follows_collapsed_break {
                is_tag_allowed_in(atom!("br"), node)
            } else {
                self.is_between_uneditable_blocks(point)
            } {
                return Ok(());
            }
            self.add_break(node, child_after(point))?;
        }
        self.put_caret(point);
        Ok(())
    }

    fn delete_data_before(&self, point: Point<'a>) -> Step {
        self.delete_data(point.node, 0, point.offset)
    }

    fn select_node(&self, node: &'a Node) {
        if let Some((before, after)) = Point::before(node).zip(Point::after(node)) {
            self.select(before, after);
        }
    }

    fn delete_range(&self, start: Point<'a>, end: Point<'a>) -> Step {
        self.select(start, end);
        self.delete_selection(Deletion::default())
    }

    /// The caret is in text, with nothing that shows between it and that end of `host`.
    fn is_at_edge(&self, host: &'a Node, is_end: bool) -> bool {
        let Point { node, offset } = self.start();
        let offset = offset as usize;
        let siblings = |of: &'a Node| {
            core::iter::successors(sibling(of, is_end), move |it| sibling(it, is_end))
        };
        let is_blank = match (node.is_text(), is_end) {
            (true, _) if self.keeps_breaks(node) => false,
            (true, true) => node.text().units().skip(offset).all(is_white),
            (true, false) => node.text().units().take(offset).all(is_white),
            (false, _) => {
                is_end
                    && child_before(self.start()).is_some_and(is_replaced)
                    && !node.children().skip(offset).any(|it| self.is_visible(it))
            }
        };
        is_blank
            && !node
                .inclusive_ancestors()
                .take_while(|it| *it != host)
                .flat_map(siblings)
                .any(|it| self.is_visible(it))
    }

    /// Where the caret is, with what does not show out of the way.
    fn clear_behind_caret(&self, host: &'a Node) -> Step<Point<'a>> {
        let mut point = self.start();
        loop {
            let (node, previous) = (point.node, child_before(point));
            if let Some(it) = self.removable(
                node.previous_sibling()
                    .filter(|_| point.offset == 0 && node != host),
            ) {
                self.remove(it)?;
            } else if let Some(it) = self.removable(previous) {
                self.remove(it)?;
                point.offset -= 1;
            } else if node != host
                && (point.offset == 0 && self.is_inline(node) || !self.is_visible(node))
            {
                point = before(node)?;
            } else if let Some(it) = self.inline(previous).filter(|it| !is_unit(it)) {
                point = end_of(it);
            } else {
                return Ok(point);
            }
        }
    }

    fn delete_at_start_of_host(&self, host: &'a Node, node: &'a Node, next: Maybe<'a>) -> Step {
        let shows_nothing = || {
            host.descendants()
                .all(|it| self.is_block(it) || self.is_block_prop(it))
        };
        if node != host
            && self.is_block(host)
            && is_tag_allowed_in(atom!("br"), host)
            && has_at_most_one_child(host)
            && shows_nothing()
        {
            self.remove(host.first_child().ok_or(Stuck)?)?;
            self.put_caret(before(self.add_break(host, None)?)?);
            return Ok(());
        }
        next.filter(|it| self.is_obstacle(it))
            .map_or(Ok(()), |it| self.remove(it))
    }

    /// `start` is somewhere after the line before `caret`.
    fn join_with_line_before(&self, mut start: Point<'a>, caret: Point<'a>) -> Step {
        while let Some(last) = child_before(start).filter(|_| start.node.is_element()) {
            if self.is_removable(last) {
                self.remove(last)?;
                start.offset -= 1;
            } else if self.is_obstacle(last) {
                start.offset -= 1;
            } else if is_unit(last) {
                break;
            } else {
                start = end_of(last);
            }
        }
        let is_around = self.block_of(start.node).contains(caret.node) && self.is_block(caret.node);
        if ends_with_newline(start.node) && self.keeps_breaks(start.node) {
            let has_more = start.offset > 1;
            let is_empty_line = if has_more {
                unit_at(start.node, start.offset - 2) == Some(NEWLINE)
            } else {
                self.beside(start.node, false) != Beside::Content
            };
            if is_around && is_empty_line {
                return if has_more {
                    self.delete_data(start.node, start.offset - 1, 1)
                } else {
                    self.remove_with_wrappers(start.node)
                };
            }
            start.offset = start.offset.saturating_sub(1);
        } else if let Some(it) = child_before(start)
            .filter(|it| is_around && is_break(*it) && !self.is_extraneous_break(it))
        {
            return self.remove_with_wrappers(it);
        }
        self.select(start, caret);
        self.delete_selection(Deletion {
            collapses_to_start: false,
            ..Default::default()
        })
    }

    /// Of a list that is all that is selected.
    fn selected_empty_item(&self) -> Maybe<'a> {
        let list = child_after(self.start())
            .filter(|it| is_list(*it) && child_before(self.end()) == Some(it))?;
        editable(list.first_child()).filter(|it| is_only_child(it) && self.has_only_block_prop(it))
    }

    fn break_out_of_list(&self, item: &'a Node) -> Step {
        let around = self.keep(item.ancestors().filter(|it| it.is_html(atom!("li"))));
        self.normalize_sublists_among(item.ancestors())?;
        around
            .into_iter()
            .filter(|it| it.first_child().is_none() && is_editable(it))
            .try_for_each(|it| self.remove(it))?;
        self.lift(&[item])?;
        self.leave_container(item)
    }

    /// The spaces beside a newline do not show.
    fn around_newline(&self, text: &'a Node, mut start: u32, mut end: u32) -> Step {
        if unit_at(text, start) == Some(NEWLINE)
            && self.keeps_breaks(text)
            && !self.keeps_spaces(text)
        {
            while matches!(unit_before(text, start), Some(9 | 32)) {
                start -= 1;
            }
            while matches!(unit_at(text, end), Some(9 | 32)) {
                end += 1;
            }
        }
        self.delete_range(at(text, start), at(text, end))
    }

    pub(super) fn delete(&self) -> Step {
        if let Some(item) = self.selected_empty_item() {
            self.put_caret(at(item, 0));
            return self.break_out_of_list(item);
        }
        if !self.active.collapsed() {
            return self.delete_selection(Deletion::default());
        }
        let host = host_of(self.start().node).ok_or(Stuck)?;
        if self.is_at_edge(host, false) {
            self.put_caret(at(self.start().node, 0));
        } else {
            self.canonicalize_whitespace(self.start(), true)?;
        }
        let caret = self.clear_behind_caret(host)?;
        let Point { node, offset } = caret;
        if node.is_text() {
            return self.around_newline(
                node,
                characters::before_backspace(&node.text(), offset),
                offset,
            );
        }
        if child_before(caret).is_some_and(|it| is_unit(it) && !self.is_obstacle(it)) {
            return self.delete_range(at(node, offset - 1), caret);
        }
        if self.is_inline(node) {
            return Ok(());
        }
        let mut start = caret;
        while start.offset > 0 || start.node != host {
            match child_before(start) {
                None => start = before(start.node)?,
                Some(it) if self.is_removable(it) => {
                    self.remove(it)?;
                    start.offset -= 1;
                }
                Some(it) if self.is_obstacle(it) => start.offset -= 1,
                Some(_) => break,
            }
        }
        let next = child_after(start);
        let is_first_of_sublist = node.previous_sibling().is_none()
            && node.parent().and_then(Node::parent).is_some_and(is_list);
        if (child_before(start).is_none() || is_table_part(next) || is_first_of_sublist)
            && node.is_html(atom!("li"))
            && is_editable(node)
            && !self.has_content(node)
        {
            return self.break_out_of_list(node);
        }
        let Some(previous) = child_before(start) else {
            return self.delete_at_start_of_host(host, node, next);
        };
        if is(next, atom!("table")) || is_table_part(next) {
            return Ok(());
        }
        if previous.is_html(atom!("table")) {
            self.select_node(previous);
            return Ok(());
        }
        if offset == 0
            && if is_break(previous) {
                self.beside(previous, false) != Beside::Content
            } else {
                self.is_block(previous) && is_unit(previous)
            }
        {
            self.remove(previous)?;
            self.put_caret(caret);
            return Ok(());
        }
        self.join_with_line_before(start, caret)
    }

    fn clear_ahead_of_caret(&self, host: &'a Node) -> Step<Point<'a>> {
        let mut point = self.start();
        loop {
            let (node, next) = (point.node, child_after(point));
            if let Some(it) = self
                .removable(
                    node.next_sibling()
                        .filter(|_| is_at_end(point) && node != host),
                )
                .or_else(|| self.removable(next))
            {
                self.remove(it)?;
            } else if node != host
                && (is_at_end(point) && self.is_inline(node) || !self.is_visible(node))
            {
                point = after(node)?;
            } else if let Some(it) = self
                .inline(next)
                .filter(|it| !is_unit(it) && !self.is_block_prop(it))
            {
                point = at(it, 0);
            } else {
                return Ok(point);
            }
        }
    }

    pub(super) fn forward_delete(&self) -> Step {
        if !self.active.collapsed() {
            return self.delete_selection(Deletion::default());
        }
        let host = host_of(self.start().node).ok_or(Stuck)?;
        if self.is_at_edge(host, true) {
            return Ok(());
        }
        self.canonicalize_whitespace(self.start(), true)?;
        let caret = self.clear_ahead_of_caret(host)?;
        let Point { node, mut offset } = caret;
        if node.is_text() {
            let next =
                (offset..node.length()).find(|it| !matches!(unit_at(node, *it), Some(9 | 32)));
            offset = next
                .filter(|it| {
                    unit_at(node, *it) == Some(NEWLINE)
                        && self.keeps_breaks(node)
                        && !self.keeps_spaces(node)
                })
                .unwrap_or(offset);
            let is_last_line =
                offset + 1 == node.length() && ends_with_newline(node) && self.keeps_breaks(node);
            if !is_last_line || self.beside(node, true) != Beside::Edge {
                return self.around_newline(
                    node,
                    offset,
                    characters::cluster_at(&node.text(), offset).end,
                );
            }
        } else if child_after(caret)
            .is_some_and(|it| is_unit(it) && !self.is_block_prop(it) && !self.is_obstacle(it))
        {
            return self.delete_range(caret, at(node, offset + 1));
        } else if self.is_inline(node)
            && !child_after(caret).is_some_and(|it| self.is_block_prop(it))
        {
            return Ok(());
        }
        let mut end = if node.is_text() { after(node)? } else { caret };
        end.offset += u32::from(child_after(end).is_some_and(|it| self.is_block_prop(it)));
        let next = loop {
            match child_after(end) {
                Some(it) if self.is_removable(it) => self.remove(it)?,
                Some(it) if self.is_obstacle(it) => end.offset += 1,
                Some(it) => break it,
                None if end.node == host => {
                    return child_before(end)
                        .filter(|it| self.is_obstacle(it))
                        .map_or(Ok(()), |it| self.remove(it));
                }
                None => end = after(end.node)?,
            }
        };
        if is(child_before(end), atom!("table")) || is_table_part(next) {
            return Ok(());
        }
        if next.is_html(atom!("table")) {
            self.select_node(next);
            return Ok(());
        }
        if is_at_end(caret) && (is_break(next) || self.is_block(next) && is_unit(next)) {
            self.select_node(next);
            self.delete_selection(Deletion::default())?;
            self.put_caret(at(node, offset.min(node.length())));
            return Ok(());
        }
        while let Some(first) = child_after(end) {
            if self.is_removable(first) {
                self.remove(first)?;
            } else if self.is_obstacle(first) {
                end.offset += 1;
            } else if is_unit(first) {
                break;
            } else {
                end = at(first, 0);
            }
        }
        self.delete_range(caret, end)
    }
}

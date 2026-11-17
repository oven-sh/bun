//! https://w3c.github.io/editing/docs/execCommand/#block-formatting-commands

use super::looks::{editable, host_of, is_editable, is_white, share_host, shares_host_with_parent};
use super::tags::*;
use super::*;
use crate::types::{Display, TextAlign};

pub(super) fn is_single_line_container(node: &Node) -> bool {
    is_line_container(node) || is_item(node)
}

pub(super) fn has_blocks(node: &Node) -> bool {
    node.descendants().any(is_not_for_paragraphs)
}

fn fits_nowhere(node: &Node) -> bool {
    node.ancestors()
        .all(|it| !share_host(node, it) || !is_allowed_in(node, it))
}

/// The siblings at the start of `nodes`, which is left with the rest. `goes_on` gets the next and the last.
pub(super) fn take_run<'n, 'a>(
    nodes: &mut &'n [&'a Node],
    goes_on: impl Fn(&'a Node, &'a Node) -> bool,
) -> &'n [&'a Node] {
    let more = nodes
        .array_windows()
        .take_while(|[last, next]| last.next_sibling() == Some(next) && goes_on(next, last))
        .count();
    nodes
        .split_off(..(more + 1).min(nodes.len()))
        .unwrap_or_default()
}

/// Whether the space at `index` is a non-breaking one.
fn is_hard_space(index: u32, length: u32, at_start: bool, at_end: bool) -> bool {
    if length == 1 {
        at_start || at_end
    } else {
        index.is_multiple_of(2) || at_end && index + 1 == length
    }
}

impl<'a> Editor<'_, 'a> {
    fn last_extraneous_break(&self, from: &'a Node, stop: Maybe<'a>) -> Maybe<'a> {
        let mut at = core::iter::successors(Some(from), |it| it.last_child()).last();
        while let Some(it) = self
            .invisible(at)
            .filter(|it| at != stop && !self.is_extraneous_break(it))
        {
            at = it.preceding(None);
        }
        editable(at).filter(|it| self.is_extraneous_break(it))
    }

    pub(super) fn trim_break_before(&self, node: &'a Node) -> Step {
        node.previous_sibling()
            .and_then(|it| self.last_extraneous_break(it, node.parent()))
            .map_or(Ok(()), |it| self.remove(it))
    }

    pub(super) fn trim_break_at_end(&self, node: &'a Node) -> Step {
        let Some(found) = self.last_extraneous_break(node, Some(node)) else {
            return Ok(());
        };
        self.remove(
            found
                .ancestors()
                .take_while(|it| self.is_removable(it))
                .last()
                .unwrap_or(found),
        )
    }

    pub(super) fn wrap(
        &self,
        mut nodes: Nodes<'a>,
        is_suitable: Test<'_, 'a>,
        make_parent: &dyn Fn() -> Step<Maybe<'a>>,
    ) -> Step<Maybe<'a>> {
        let (Some(&first), Some(&last)) = (nodes.first(), nodes.last()) else {
            return Ok(None);
        };
        if first.parent().is_none() || !nodes.iter().any(|it| is_break(*it) || self.is_visible(it))
        {
            return Ok(None);
        }
        let ending = last
            .next_sibling()
            .filter(|it| is_break(*it) && !is_break(last) && self.is_inline(last));
        let leading = self.keep(core::iter::successors(
            self.invisible(first.previous_sibling()),
            |it| self.invisible(it.previous_sibling()),
        ));
        let trailing = core::iter::successors(
            self.invisible(ending.unwrap_or(last).next_sibling()),
            |it| self.invisible(it.next_sibling()),
        );
        nodes.extend(self.keep(ending.into_iter().chain(trailing)));
        nodes.splice(..0, leading.into_iter().rev());
        let (first, last) = (nodes[0], nodes[nodes.len() - 1]);
        let fitting = |it: Maybe<'a>| editable(it).filter(|it| is_suitable(it));
        let Some(wrapper) = fitting(first.previous_sibling())
            .or_else(|| fitting(last.next_sibling()))
            .map_or_else(make_parent, |it| Ok(Some(it)))?
        else {
            return Ok(None);
        };
        if wrapper.parent().is_none() {
            self.insert(wrapper, parent(first)?, Some(first))?;
            let place = before(wrapper)?;
            let [start, end] = [self.start(), self.end()]
                .map(|it| at(it.node, it.offset + u32::from(it == place)));
            self.select(start, end);
        }
        let old_parent = parent(first)?;
        let (mut own, mut added) = (
            wrapper.children().filter(|it| self.is_visible(it)),
            nodes.iter().copied().filter(|it| self.is_visible(it)),
        );
        let joins_lines = |a: Maybe<'a>, b: Maybe<'a>| {
            self.is_block(wrapper) && self.inline(a).is_some() && self.inline(b).is_some()
        };
        if wrapper.compare_order(first).is_lt() {
            if joins_lines(own.last(), added.next()) && !is_break(wrapper.last_child()) {
                self.add_break(wrapper, None)?;
            }
            nodes
                .iter()
                .try_for_each(|it| self.move_to_end(it, wrapper))?;
        } else {
            if joins_lines(own.next(), added.next_back()) && !is_break(last) {
                self.add_break(wrapper, wrapper.first_child())?;
            }
            nodes
                .iter()
                .rev()
                .try_for_each(|it| self.move_to(it, at(wrapper, 0)))?;
        }
        if is_editable(old_parent) && old_parent.first_child().is_none() {
            self.remove(old_parent)?;
        }
        if let Some(next) = fitting(wrapper.next_sibling()) {
            if joins_lines(wrapper.last_child(), next.first_child())
                && !is_break(wrapper.last_child())
            {
                self.add_break(wrapper, None)?;
            }
            self.move_children(next, wrapper)?;
            self.remove(next)?;
        }
        self.trim_break_before(wrapper)?;
        self.trim_break_at_end(wrapper)?;
        Ok(Some(wrapper))
    }

    pub(super) fn wrap_in(
        &self,
        nodes: &[&'a Node],
        is_suitable: Test<'_, 'a>,
        tag: Known,
    ) -> Step<Maybe<'a>> {
        self.wrap(nodes.to_vec(), is_suitable, &|| Ok(Some(self.create(tag))))
    }

    pub(super) fn fix_disallowed_ancestors(&self, node: &'a Node) -> Step {
        let Some(host) = host_of(node).filter(|_| is_editable(node)) else {
            return Ok(());
        };
        if !fits_nowhere(node) {
            return self.keeping_values(&[node], || {
                while !is_allowed_in(node, parent(node)?) && self.split_parent(&[node])? {}
                Ok(())
            });
        }
        if is_definition(node) {
            return self
                .wrap_in(
                    &[node],
                    &|it| it.is_html(atom!("dl")) && attribute_count(it) == 0,
                    atom!("dl"),
                )
                .map(|_| ());
        }
        if !is_tag_allowed_in(atom!("p"), host)
            || !is_not_for_paragraphs(node)
            || node.is_html(self.separator())
        {
            return Ok(());
        }
        let renamed = self.rename(node, self.separator())?;
        self.fix_disallowed_ancestors(renamed)?;
        self.keep(renamed.children().filter(|it| is_not_for_paragraphs(*it)))
            .into_iter()
            .try_for_each(|it| self.lift(&[it]))
    }

    pub(super) fn fix_wrapper(&self, wrapper: Maybe<'a>) -> Step {
        wrapper.map_or(Ok(()), |it| self.fix_disallowed_ancestors(it))
    }

    /// Out of their parent.
    pub(super) fn lift(&self, nodes: &[&'a Node]) -> Step {
        self.keeping_values(nodes, || self.split_parent(nodes).map(|_| ()))
    }

    /// Whether it could.
    pub(super) fn split_parent(&self, nodes: &[&'a Node]) -> Step<bool> {
        let (Some(&first), Some(&last)) = (nodes.first(), nodes.last()) else {
            return Ok(false);
        };
        let Some((inner, outer)) = editable(first.parent()).and_then(|it| Some((it, it.parent()?)))
        else {
            return Ok(false);
        };
        let (has_first, has_last) = (
            inner.first_child() == Some(first),
            inner.last_child() == Some(last),
        );
        if has_first {
            self.trim_break_before(inner)?;
        }
        let (followed, preceded) = (
            has_first && self.follows_break(inner),
            has_last && self.precedes_break(inner),
        );
        let end_line = || {
            if preceded && !self.precedes_break(last) {
                self.add_break_after(last).map(|_| ())
            } else {
                Ok(())
            }
        };
        if !has_first && has_last {
            nodes
                .iter()
                .rev()
                .try_for_each(|it| self.move_to(it, after(inner)?))?;
            end_line()?;
            self.trim_break_at_end(inner)?;
            return Ok(true);
        }
        if !has_first {
            let copy = self.copy(inner)?;
            self.set_attribute(inner, atom!("id"), None)?;
            self.insert(copy, outer, Some(inner))?;
            while first.previous_sibling().is_some() {
                self.move_to_end(inner.first_child().ok_or(Stuck)?, copy)?;
            }
        }
        nodes
            .iter()
            .try_for_each(|it| self.move_to(it, before(inner)?))?;
        if followed && !self.follows_break(first) {
            self.add_break(parent(first)?, Some(first))?;
        }
        if let Some(it) = inner.first_child().filter(|it| {
            is_break(*it) && !is_break(last) && self.is_inline(last) && self.is_block(inner)
        }) {
            self.remove(it)?;
        }
        if inner.first_child().is_none() {
            self.remove(inner)?;
            end_line()?;
        } else {
            self.trim_break_before(inner)?;
        }
        if let Some(parent) = last.parent().filter(|_| last.next_sibling().is_none()) {
            self.trim_break_at_end(parent)?;
        }
        Ok(true)
    }

    pub(super) fn remove_keeping_children(&self, node: &'a Node) -> Step {
        if node.first_child().is_some() {
            self.split_parent(&self.children(node)).map(|_| ())
        } else {
            self.remove(node)
        }
    }

    /// Of an item that is no longer in its list.
    pub(super) fn leave_container(&self, item: &'a Node) -> Step {
        if item.first_child().is_none() {
            self.add_break(item, None)?;
        }
        self.fix_disallowed_ancestors(if is_definition(item) && fits_nowhere(item) {
            self.rename(item, self.separator())?
        } else {
            item
        })
    }

    fn fluid_space(&self, text: &'a Node, unit: Option<u16>) -> Option<u16> {
        unit.filter(|it| {
            (is_white(*it) || *it == NBSP)
                && !self.keeps_spaces(text)
                && !(*it == NEWLINE && self.keeps_breaks(text))
        })
    }

    /// The spaces around a point become ones that all show.
    pub(super) fn canonicalize_whitespace(
        &self,
        mut start: Point<'a>,
        removes_collapsed: bool,
    ) -> Step {
        if host_of(start.node).is_none() {
            return Ok(());
        }
        let entered = |from: &'a Node, it: Maybe<'a>| {
            it.filter(|it| share_host(from, it) && !is_break(*it) && !self.is_atomic(it))
        };
        let space_before =
            |it: Point<'a>| self.fluid_space(it.node, unit_before(it.node, it.offset));
        let starts_line = |it: Point<'a>| match it.offset {
            0 => self.follows_break(it.node),
            offset => unit_before(it.node, offset) == Some(NEWLINE) || is_break(child_before(it)),
        };
        let ends_line = |it: Point<'a>| match is_at_end(it) {
            true => self.precedes_break(it.node),
            false => unit_at(it.node, it.offset) == Some(NEWLINE) || is_break(child_after(it)),
        };
        loop {
            if let Some(it) = entered(start.node, child_before(start)) {
                start = end_of(it);
            } else if start.offset == 0
                && !self.follows_break(start.node)
                && shares_host_with_parent(start.node)
            {
                start = before(start.node)?;
            } else if space_before(start).is_some() {
                start.offset -= 1;
            } else {
                break;
            }
        }
        let (mut end, mut length, mut collapses) = (start, 0u32, starts_line(start));
        loop {
            if let Some(it) = entered(end.node, child_after(end)) {
                end = at(it, 0);
            } else if is_at_end(end)
                && !self.precedes_break(end.node)
                && shares_host_with_parent(end.node)
            {
                end = after(end.node)?;
            } else if let Some(space) = self.fluid_space(end.node, unit_at(end.node, end.offset)) {
                if removes_collapsed && collapses && space != NBSP {
                    self.delete_data(end.node, end.offset, 1)?;
                } else {
                    collapses = space != NBSP;
                    end.offset += 1;
                    length += 1;
                }
            } else {
                break;
            }
        }
        while removes_collapsed && is_before(start, end) {
            if let Some(it) = entered(end.node, child_before(end)) {
                end = end_of(it);
            } else if end.offset == 0 && shares_host_with_parent(end.node) {
                end = before(end.node)?;
            } else if is_at_end(end)
                && space_before(end).is_some_and(|it| it != NBSP)
                && self.precedes_break(end.node)
            {
                end.offset -= 1;
                length = length.saturating_sub(1);
                self.delete_data(end.node, end.offset, 1)?;
            } else {
                break;
            }
        }
        let (at_start, at_end, mut index) = (starts_line(start), ends_line(end), 0);
        while is_before(start, end) {
            if let Some(it) = child_after(start) {
                start = at(it, 0);
            } else if let Some(unit) = unit_at(start.node, start.offset) {
                let is_hard = index < length && is_hard_space(index, length, at_start, at_end);
                if is_hard != (unit == NBSP) {
                    self.replace_data(
                        start.node,
                        start.offset,
                        0,
                        &DomString::from_latin1(if is_hard { b"\xa0" } else { b" " }),
                    )?;
                    self.delete_data(start.node, start.offset + 1, 1)?;
                }
                index += 1;
                start.offset += 1;
            } else {
                start = after(start.node)?;
            }
        }
        Ok(())
    }

    pub(super) fn canonicalize_ends(&self, removes_collapsed: bool) -> Step {
        self.canonicalize_whitespace(self.start(), removes_collapsed)?;
        self.canonicalize_whitespace(self.end(), removes_collapsed)
    }

    pub(super) fn alignment_of(&self, node: &'a Node) -> Known {
        let aligned = node.inclusive_ancestors().find(|it| {
            it.is_element() && !matches!(self.display(it), Some(Display::Inline | Display::None))
        });
        match aligned.and_then(|it| self.style(it, |it| (it.text.align, it.is_rtl()))) {
            Some((TextAlign::Center | TextAlign::WebkitCenter | TextAlign::InternalCenter, _)) => {
                atom!("center")
            }
            Some((TextAlign::Justify, _)) => atom!("justify"),
            Some(
                (TextAlign::Right | TextAlign::WebkitRight, _)
                | (TextAlign::Start, true)
                | (TextAlign::End, false),
            ) => atom!("right"),
            _ => atom!("left"),
        }
    }

    pub(super) fn justify(&self, alignment: Known) -> Step {
        let is_aligned = |it: &'a Node| {
            has_attr(it, atom!("align"))
                || !self.inline_style(it, "text-align").is_empty()
                || it.is_html(atom!("center"))
        };
        for element in self.contained(
            self.selected_lines(),
            &|it| is_editable(it) && is_aligned(it),
            false,
        ) {
            if element.is_html(atom!("div"))
                && !has_blocks(element)
                && self.alignment_of(element) != alignment
                && !has_attr(element, atom!("align"))
            {
                self.set_style(element, "text-align", alignment.as_str())?;
                continue;
            }
            self.set_attribute(element, atom!("align"), None)?;
            self.set_style(element, "text-align", "")?;
            match (attribute_count(element), element.html_tag()) {
                (0, atom!("div") | atom!("span") | atom!("center")) => {
                    self.remove_keeping_children(element)?
                }
                (_, atom!("center")) => _ = self.rename(element, atom!("div"))?,
                _ => {}
            }
        }
        let only_aligns = |it: &'a Node| {
            it.is_html(atom!("div"))
                && has_only_attributes(it, |name| match name {
                    atom!("align") => it.keyword(name) == Some(alignment),
                    atom!("style") => {
                        self.styled_properties(it).len() == 1
                            && self.inline_style(it, "text-align") == alignment.as_str()
                    }
                    _ => false,
                })
        };
        let make = || {
            self.create_with(
                atom!("div"),
                atom!("style"),
                &format!("text-align: {};", alignment.as_str()),
            )
            .map(Some)
        };
        let is_off = |it: &'a Node| {
            is_editable(it)
                && is_allowed_in_tag(it, atom!("div"))
                && self.alignment_of(it) != alignment
        };
        let mut nodes = &self.contained(self.selected_lines(), &is_off, true)[..];
        while !nodes.is_empty() {
            self.wrap(
                take_run(&mut nodes, |_, _| true).to_vec(),
                &only_aligns,
                &make,
            )?;
        }
        Ok(())
    }

    pub(super) fn format_of(&self, mut node: &'a Node) -> Option<Known> {
        while let Some(parent) =
            editable(node.parent()).filter(|it| share_host(node, it) && !is_formattable_block(node))
        {
            node = parent;
        }
        (is_editable(node) && is_formattable_block(node) && !has_blocks(node))
            .then(|| node.html_tag())
    }

    pub(super) fn format_block(&self, value: &str) -> Step<bool> {
        let tag = Known::from_latin1_lowercased(
            value
                .strip_prefix('<')
                .and_then(|it| it.strip_suffix('>'))
                .unwrap_or(value)
                .as_bytes(),
        );
        if !is_formattable_block(tag) {
            return Ok(false);
        }
        let is_line = |it: &'a Node| {
            is_line_container(it) || is_allowed_in_tag(it, atom!("p")) || is_definition(it)
        };
        let mut nodes = &self.contained(
            self.selected_lines(),
            &|it| is_editable(it) && is_line(it) && !has_blocks(it),
            true,
        )[..];
        self.keeping_values(nodes, || {
            for node in nodes {
                let is_format = |it: &'a Node| {
                    is_formattable_block(it)
                        && is_editable(it)
                        && share_host(it, node)
                        && !has_blocks(it)
                };
                while node.ancestors().any(is_format) && self.split_parent(&[node])? {}
            }
            Ok(())
        })?;
        let is_same = |it: &'a Node| {
            !matches!(tag, atom!("div") | atom!("p")) && it.is_html(tag) && attribute_count(it) == 0
        };
        while let Some(&first) = nodes.first() {
            let run = if is_single_line_container(first) {
                nodes = &nodes[1..];
                let inside = self.children(first);
                self.keeping_values(&inside, || self.remove_keeping_children(first))?;
                inside
            } else {
                take_run(&mut nodes, |next, last| {
                    !is_single_line_container(next) && !is_break(last)
                })
                .to_vec()
            };
            self.fix_wrapper(self.wrap_in(&run, &is_same, tag)?)?;
        }
        Ok(true)
    }
}

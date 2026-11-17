//! Lists and indentation.

use super::blocks::take_run;
use super::looks::{editable, is_editable, is_host};
use super::tags::*;
use super::*;

/// About the selected lines, for `ol` and for `ul`.
#[derive(Default)]
pub(super) struct ListState {
    all: [bool; 2],
    some: [bool; 2],
}

impl ListState {
    pub(super) fn is_all(&self, tag: Known) -> bool {
        match tag {
            atom!("ol") => self.all[0],
            _ => self.all[1] && !self.all[0],
        }
    }

    pub(super) fn is_mixed(&self, tag: Known) -> bool {
        self.all == [false; 2] && self.some[usize::from(tag != atom!("ol"))]
    }
}

impl<'a> Editor<'_, 'a> {
    pub(super) fn is_indentation(&self, node: &'a Node) -> bool {
        node.is_html(atom!("blockquote"))
            || node.is_html(atom!("div"))
                && self
                    .styled_properties(node)
                    .iter()
                    .any(|it| it.starts_with("margin"))
    }

    fn is_simple_indentation(&self, node: &'a Node) -> bool {
        self.is_indentation(node)
            && has_only_attributes(node, |it| matches!(it, atom!("style") | atom!("dir")))
            && self.styled_properties(node).iter().all(|it| {
                ["margin", "border", "padding"]
                    .iter()
                    .any(|prefix| it.starts_with(prefix))
            })
    }

    pub(super) fn normalize_sublists(&self, item: &'a Node) -> Step {
        if !item.is_html(atom!("li")) || !is_editable(item) || editable(item.parent()).is_none() {
            return Ok(());
        }
        let mut made = None;
        while let Some(last) = item.last_child().filter(|_| item.children().any(is_list)) {
            if is_list(last)
                || made.is_none() && last.is_text() && last.text().units().all(is_ascii_whitespace)
            {
                made = None;
                self.move_to(last, after(item)?)?;
                continue;
            }
            if made.is_none() {
                self.insert_after(*made.insert(self.create(atom!("li"))), item)?;
            }
            self.move_to(last, at(made.ok_or(Stuck)?, 0))?;
        }
        Ok(())
    }

    pub(super) fn normalize_sublists_among(
        &self,
        from_the_inside: impl Iterator<Item = &'a Node>,
    ) -> Step {
        self.keep(from_the_inside)
            .into_iter()
            .rev()
            .try_for_each(|it| self.normalize_sublists(it))
    }

    fn normalize_selected_sublists(&self) -> Step {
        let start = self.start().node;
        self.normalize_sublists_among(
            self.end()
                .node
                .inclusive_ancestors()
                .take_while(|it| !it.contains(start))
                .chain(start.inclusive_ancestors()),
        )
    }

    fn can_be_listed(&self, node: &'a Node) -> bool {
        is_editable(node)
            && !self.is_indentation(node)
            && (is_list(node) || is_list(node.parent()) || is_allowed_in_tag(node, atom!("li")))
    }

    pub(super) fn list_state(&self) -> ListState {
        let nodes = self.contained(self.selected_lines(), &|it| self.can_be_listed(it), true);
        let is_of = |node: &'a Node, tag| {
            is(node, tag)
                || has_at_most_one_child(node) && is(node.first_child(), tag)
                || is(node.parent(), tag)
                || node
                    .parent()
                    .is_some_and(|it| is(it, atom!("li")) && is(it.parent(), tag))
        };
        let holds = |node: &'a Node, tag| node.inclusive_descendants().any(|it| is(it, tag));
        let (ol, ul) = (atom!("ol"), atom!("ul"));
        ListState {
            all: [(ol, ul), (ul, ol)].map(|(tag, other)| {
                !nodes.is_empty() && nodes.iter().all(|it| is_of(it, tag) && !holds(it, other))
            }),
            some: [ol, ul].map(|tag| nodes.iter().any(|it| is_of(it, tag) || holds(it, tag))),
        }
    }

    /// `is_new`: it is not what is left of an indentation.
    fn indent_nodes(&self, nodes: &[&'a Node], is_new: bool) -> Step {
        match nodes.first().map(|it| it.parent().html_name()) {
            None => Ok(()),
            Some(tag) if is_list(tag) => {
                self.wrap_in(nodes, &|it| it.is_html(tag), tag).map(|_| ())
            }
            Some(_) if !is_new => self.fix_wrapper(self.wrap_in(
                nodes,
                &|it| self.is_simple_indentation(it),
                atom!("blockquote"),
            )?),
            Some(_) => {
                let make = || {
                    self.create_with(
                        atom!("blockquote"),
                        atom!("style"),
                        "margin: 0 0 0 40px; border: none; padding: 0px;",
                    )
                    .map(Some)
                };
                self.fix_wrapper(self.wrap(
                    nodes.to_vec(),
                    &|it| self.is_simple_indentation(it),
                    &make,
                )?)
            }
        }
    }

    fn unlist(&self, list: &'a Node) -> Step {
        [atom!("reversed"), atom!("start"), atom!("type")]
            .into_iter()
            .try_for_each(|it| self.set_attribute(list, it, None))?;
        let inside = self.children(list);
        if attribute_count(list) > 0 && !is_list(list.parent()) {
            self.rename(list, atom!("div"))?;
        } else {
            self.keeping_values(&inside, || self.remove_keeping_children(list))?;
        }
        inside
            .into_iter()
            .try_for_each(|it| self.fix_disallowed_ancestors(it))
    }

    pub(super) fn outdent_node(&self, node: &'a Node) -> Step {
        if !is_editable(node) {
            return Ok(());
        }
        if self.is_simple_indentation(node) {
            return self.remove_keeping_children(node);
        }
        if self.is_indentation(node) {
            self.set_attribute(node, atom!("dir"), None)?;
            ["margin", "padding", "border"]
                .into_iter()
                .try_for_each(|it| self.set_style(node, it, ""))?;
            return self.rename(node, atom!("div")).map(|_| ());
        }
        let nearest = |test: Test<'_, 'a>| {
            editable(
                node.ancestors()
                    .find(|it| !is_editable(it) || test(it) || is_list(*it)),
            )
            .filter(|it| test(it))
        };
        let Some(indentation) = nearest(&|it| self.is_simple_indentation(it))
            .or_else(|| nearest(&|it| self.is_indentation(it)))
        else {
            return if is_list(node) {
                self.unlist(node)
            } else {
                Ok(())
            };
        };
        let mut path = self.keep(node.ancestors().take_while(|it| indentation.contains(it)));
        while let Some(ancestor) = path.pop() {
            let target = path
                .last()
                .copied()
                .filter(|_| node.parent() != Some(ancestor))
                .unwrap_or(node);
            if let Some(next) = target
                .next_sibling()
                .filter(|it| is_break(*it) && !is_break(target) && self.is_inline(target))
            {
                self.remove(next)?;
            }
            let siblings = self.children(ancestor);
            let (earlier, later) = siblings
                .split_at_checked(target.index() as usize)
                .ok_or(Stuck)?;
            self.indent_nodes(earlier, false)?;
            self.indent_nodes(later.get(1..).unwrap_or_default(), false)?;
        }
        self.outdent_node(indentation)
    }

    /// Those for which `stands_alone` is true are outdented, and the others leave their lists.
    fn outdent_all(
        &self,
        mut nodes: &[&'a Node],
        stands_alone: Test<'_, 'a>,
        ends_run: Test<'_, 'a>,
    ) -> Step {
        while let Some(&first) = nodes.first() {
            if stands_alone(first) {
                nodes = &nodes[1..];
                self.outdent_node(first)?;
                continue;
            }
            let run = take_run(&mut nodes, |next, _| !ends_run(next));
            self.keeping_values(run, || {
                self.split_parent(run)?;
                run.iter()
                    .try_for_each(|it| self.fix_disallowed_ancestors(it))
            })?;
        }
        Ok(())
    }

    /// Makes items of the siblings at the start of `nodes`.
    fn take_items(&self, nodes: &mut &[&'a Node]) -> Step<Nodes<'a>> {
        let mut run = Nodes::new();
        while let Some(&first) = nodes.first().filter(|it| {
            run.last()
                .is_none_or(|last| last.next_sibling() == Some(it))
        }) {
            if matches!(
                first.html_tag(),
                atom!("p") | atom!("div") | atom!("li") | atom!("ol") | atom!("ul")
            ) {
                *nodes = &nodes[1..];
                run.push(if is_list(first) {
                    first
                } else {
                    self.rename(first, atom!("li"))?
                });
                continue;
            }
            let line = take_run(nodes, |next, last| {
                self.is_inline(next) && self.is_inline(last) && !is_break(last)
            });
            if let Some(item) = self.wrap_in(line, &|_| false, atom!("li"))? {
                run.push(item);
                *nodes = &nodes[nodes.iter().take_while(|it| item.contains(it)).count()..];
            }
        }
        Ok(run)
    }

    pub(super) fn toggle_list(&self, tag: Known) -> Step {
        let turns_off = self.list_state().is_all(tag);
        let other = if tag == atom!("ol") {
            atom!("ul")
        } else {
            atom!("ol")
        };
        let is_wanted = |it: &'a Node| it.is_html(tag);
        let editable_list = |it: Maybe<'a>| editable(it).filter(|it| is_wanted(it));
        self.normalize_selected_sublists()?;
        if let Some(host) =
            Some(self.start().node).filter(|it| is_host(it) && it.first_child().is_none())
        {
            self.put_caret(before(self.add_break(host, None)?)?);
        }
        if let Some(block) = editable(Some(self.start().node))
            .filter(|it| it.is_html(atom!("div")) && !turns_off && self.has_only_block_prop(it))
        {
            let (list, item) = (self.create(tag), self.create(atom!("li")));
            self.insert(item, list, None)?;
            self.move_children(block, item)?;
            self.insert(list, block, None)?;
            self.put_caret(at(item, 0));
            return Ok(());
        }
        let [start, end] = self.selected_lines();
        if turns_off {
            return self.outdent_all(
                &self.contained([start, end], &|it| self.can_be_listed(it), true),
                &is_wanted,
                &is_wanted,
            );
        }
        let change_list = |run: &[&'a Node], makes_one: bool| {
            self.keeping_values(run, || {
                self.split_parent(run)?;
                self.wrap(run.to_vec(), &is_wanted, &|| {
                    Ok(makes_one.then(|| self.create(tag)))
                })
                .map(|_| ())
            })
        };
        let lines = self.with(|cx| Range::new(&cx.heap, start, end));
        for list in self.contained(
            [start, end],
            &|it| it.is_html(other) && is_editable(it),
            false,
        ) {
            if editable_list(list.previous_sibling())
                .or_else(|| editable_list(list.next_sibling()))
                .is_none()
            {
                self.rename(list, tag)?;
            } else if list.first_child().is_some() {
                change_list(&self.children(list), false)?;
            }
        }
        let mut nodes = self.contained(
            [lines.start(), lines.end()],
            &|it| self.can_be_listed(it),
            true,
        );
        lines.stop_following();
        nodes.retain(|it| !is_list(*it) || is_list(it.parent()));
        let mut nodes = &nodes[..];
        while !nodes.is_empty() {
            let run = self.take_items(&mut nodes)?;
            let Some(&first) = run
                .first()
                .filter(|it| !is(it.parent(), tag) && !run.iter().copied().all(is_list))
            else {
                continue;
            };
            if is(first.parent(), other) {
                change_list(&run, true)?;
                continue;
            }
            let make = || {
                let indented = editable(first.parent()).filter(|it| self.is_simple_indentation(it));
                let Some(list) = indented.and_then(|it| editable_list(it.previous_sibling()))
                else {
                    return Ok(Some(self.create(tag)));
                };
                list.last_child()
                    .map_or(Ok(()), |it| self.normalize_sublists(it))?;
                if editable_list(list.last_child()).is_none() {
                    self.insert(self.create(tag), list, None)?;
                }
                Ok(list.last_child())
            };
            self.fix_wrapper(self.wrap(run, &is_wanted, &make)?)?;
        }
        Ok(())
    }

    pub(super) fn indent(&self) -> Step {
        self.normalize_selected_sublists()?;
        let can_be_indented = |it: &'a Node| {
            is_editable(it)
                && (is_allowed_in_tag(it, atom!("div")) || is_allowed_in_tag(it, atom!("ol")))
        };
        let mut nodes = &self.contained(self.selected_lines(), &can_be_indented, true)[..];
        if let Some(item) = nodes
            .iter()
            .find(|it| self.is_visible(it))
            .filter(|it| it.is_html(atom!("li")) && is_list(it.parent()))
            && let Some(previous) =
                core::iter::successors(item.previous_sibling(), |it| it.previous_sibling())
                    .find(|it| self.is_visible(it))
        {
            self.normalize_sublists(previous)?;
        }
        while !nodes.is_empty() {
            self.indent_nodes(take_run(&mut nodes, |_, _| true), true)?;
        }
        Ok(())
    }

    pub(super) fn outdent(&self) -> Step {
        self.normalize_selected_sublists()?;
        let is_whole = |it: &'a Node| {
            !it.descendants().any(is_editable)
                || is_list(it)
                || it.is_html(atom!("li")) && is_list(it.parent())
        };
        let nodes = self.contained(
            self.selected_lines(),
            &|it| is_editable(it) && is_whole(it),
            true,
        );
        self.outdent_all(&nodes, &|it| is_list(it) || !is_list(it.parent()), &is_list)
    }
}

//! What ranges do to what they contain.

use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Take {
    Delete,
    Extract,
    Clone,
}

/// The nodes that contain an end of the range, below the common ancestor, from the top.
fn partially_contained<'a>(heap: &JsHeap<'a>, end: &'a Node, common: &Node) -> Rooted<'a> {
    let mut nodes: Vec<_> = end
        .inclusive_ancestors()
        .take_while(|it| *it != common)
        .map(Node::to_js)
        .collect();
    nodes.reverse();
    // SAFETY: the tree of `end` holds them.
    Rooted::from_nodes(
        heap,
        nodes.into_iter().map(|it| unsafe { Node::from_cell(it) }),
    )
}

/// Runs of siblings, found before anything is changed.
#[derive(Default)]
struct Contained<'a> {
    nodes: Rooted<'a>,
    ends: Vec<u32>,
    next_run: usize,
}

impl<'a> Contained<'a> {
    fn add_run(&mut self, heap: &JsHeap<'a>, first: Option<&'a Node>, stop: Option<&'a Node>) {
        let run = core::iter::successors(first, |it| it.next_sibling())
            .take_while(|it| Some(*it) != stop);
        run.for_each(|it| self.nodes.push(heap, it));
        self.ends.push(self.nodes.len());
    }

    fn take_run(&mut self, cx: Cx<'_, 'a>, how: Take, into: Option<&'a Node>) -> Result<'a> {
        let start = self.next_run.checked_sub(1).map_or(0, |it| self.ends[it]);
        for node in (start..self.ends[self.next_run]).filter_map(|it| self.nodes.get(it)) {
            match (how, into) {
                (Take::Clone, _) => {
                    _ = clone_node(cx, node, node.doc(), true, into, JSValue::UNDEFINED)?
                }
                (Take::Extract, Some(into)) => insert(cx, node, into, None, Observers::Notify),
                _ => remove(cx, node, Observers::Notify),
            }
        }
        self.next_run += 1;
        Ok(())
    }
}

fn take_data<'a>(
    cx: Cx<'_, 'a>,
    node: &'a CharacterData,
    from: u32,
    to: u32,
    how: Take,
    into: Option<&'a Node>,
) -> Result<'a> {
    let count = to.saturating_sub(from);
    if let Some(into) = into {
        let copy = clone_node(cx, node, node.doc(), false, None, JSValue::UNDEFINED)?;
        copy.as_character_data()
            .into_iter()
            .for_each(|it| it.set_data_quietly(node.data().substring(from, count)));
        insert(cx, copy, into, None, Observers::Notify);
    }
    if how == Take::Clone {
        Ok(())
    } else {
        node.replace_data(cx, from, count, &DomString::default())
    }
}

fn copy_into<'a>(
    cx: Cx<'_, 'a>,
    node: &'a Node,
    into: Option<&'a Node>,
) -> Result<'a, Option<&'a Node>> {
    into.map(|into| clone_node(cx, node, node.doc(), false, Some(into), JSValue::UNDEFINED))
        .transpose()
}

fn take<'a>(
    cx: Cx<'_, 'a>,
    start: Point<'a>,
    end: Point<'a>,
    how: Take,
    into: Option<&'a Node>,
) -> Result<'a> {
    if start == end {
        return Ok(());
    }
    if let Some(data) = start
        .node
        .as_character_data()
        .filter(|_| start.node == end.node)
    {
        return take_data(cx, data, start.offset, end.offset, how, into);
    }
    let (heap, common) = (&cx.heap, common_ancestor(start.node, end.node));
    let (left, right) = (
        partially_contained(heap, start.node, common),
        partially_contained(heap, end.node, common),
    );
    let first_below = |index: u32| {
        left.get(index)
            .map_or_else(|| start.node.child_at(start.offset), Node::next_sibling)
    };
    let stop_below = |index: u32| right.get(index).or_else(|| end.node.child_at(end.offset));
    let mut contained = Contained::default();
    (0..left.len())
        .rev()
        .for_each(|it| contained.add_run(heap, first_below(it + 1), None));
    contained.add_run(heap, first_below(0), stop_below(0));
    if into.is_some() && contained.nodes.iter().any(|it| it.kind() == Kind::Doctype) {
        return Err(dom_error(
            heap,
            DomError::HierarchyRequestError,
            "The Range contains a doctype node.",
        ));
    }
    for (index, node) in (1..).zip(right.iter()) {
        contained.add_run(heap, node.first_child(), stop_below(index));
    }

    let (mut copies, mut parent) = (Rooted::default(), into);
    for node in left.iter() {
        match node.as_character_data() {
            Some(data) => take_data(cx, data, start.offset, data.data_length(), how, parent)?,
            None => parent = copy_into(cx, node, parent)?,
        }
        parent.into_iter().for_each(|it| copies.push(&cx.heap, it));
    }
    for index in (0..left.len()).rev() {
        contained.take_run(cx, how, copies.get(index))?;
    }
    contained.take_run(cx, how, into)?;
    parent = into;
    for node in right.iter() {
        match node.as_character_data() {
            Some(data) => take_data(cx, data, 0, end.offset, how, parent)?,
            None => parent = copy_into(cx, node, parent)?,
        }
        contained.take_run(cx, how, parent)?;
    }
    Ok(())
}

impl Range {
    fn remove_contents<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        how: Take,
        into: Option<&'a Node>,
    ) -> Result<'a> {
        let (start, end) = (self.start(), self.end());
        let common = self.common_ancestor();
        let collapsed_at = start
            .node
            .inclusive_ancestors()
            .find(|it| it.parent() == Some(common))
            .and_then(Point::after)
            .unwrap_or(start);
        take(cx, start, end, how, into)?;
        let at = Point::new(
            collapsed_at.node,
            collapsed_at.offset.min(collapsed_at.node.length()),
        );
        self.set(cx, at, at);
        Ok(())
    }

    pub(crate) fn delete_contents<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        self.remove_contents(cx, Take::Delete, None)
    }

    pub(crate) fn extract_contents<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> Result<'a, &'a DocumentFragment> {
        let fragment = self.start().node.doc().create_fragment(&cx.heap);
        self.remove_contents(cx, Take::Extract, Some(fragment))?;
        Ok(fragment)
    }

    pub(crate) fn clone_contents<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, &'a DocumentFragment> {
        let fragment = self.start().node.doc().create_fragment(&cx.heap);
        take(cx, self.start(), self.end(), Take::Clone, Some(fragment))?;
        Ok(fragment)
    }

    pub(crate) fn insert_node<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        let start = self.start();
        let text = start.node.as_text();
        let parent = if text.is_some() {
            start.node.parent()
        } else {
            Some(start.node)
        };
        let Some(parent) = parent.filter(|_| {
            !matches!(start.node.kind(), Kind::Comment | Kind::Instruction) && start.node != node
        }) else {
            return Err(dom_error(
                &cx.heap,
                DomError::HierarchyRequestError,
                "Nodes may not be inserted there.",
            ));
        };
        let mut reference = if text.is_some() {
            Some(start.node)
        } else {
            start.node.child_at(start.offset)
        };
        ensure_pre_insert_validity(&cx.heap, node, parent, reference, Validity::Inserting)?;
        if let Some(text) = text {
            reference = Some(text.split(cx, start.offset)?);
        }
        if reference == Some(node) {
            reference = node.next_sibling();
        }
        remove(cx, node, Observers::Notify);
        let count = if node.as_fragment().is_some() {
            node.length()
        } else {
            1
        };
        let offset = reference.map_or_else(|| parent.length(), Node::index) + count;
        pre_insert(cx, node, parent, reference)?;
        if self.collapsed() {
            self.set(
                cx,
                self.start(),
                Point::new(parent, offset.min(parent.length())),
            );
        }
        Ok(())
    }

    pub(crate) fn surround_contents<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        new_parent: &'a Node,
    ) -> Result<'a> {
        let container = |node: &'a Node| {
            node.parent()
                .filter(|_| node.kind().is_text())
                .unwrap_or(node)
        };
        if container(self.start().node) != container(self.end().node) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The Range has partially selected a non-Text node.",
            ));
        }
        if new_parent.kind().is_document()
            || new_parent.kind() == Kind::Doctype
            || new_parent.as_fragment().is_some()
        {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidNodeTypeError,
                "The node provided cannot surround the contents.",
            ));
        }
        let fragment = self.extract_contents(cx)?;
        replace_all(cx, None, new_parent);
        self.insert_node(cx, new_parent)?;
        append(cx, fragment, new_parent)?;
        self.select_node(cx, new_parent)
    }

    pub(crate) fn text(&self) -> DomString {
        let (start, end) = (self.start(), self.end());
        let (first, last) = (start.node.as_text(), end.node.as_text());
        if let Some(text) = first.filter(|_| start.node == end.node) {
            return text
                .data()
                .substring(start.offset, end.offset.saturating_sub(start.offset));
        }
        let mut all = StringBuilder::default();
        first
            .into_iter()
            .for_each(|it| all.push(&it.data().substring(start.offset, u32::MAX)));
        let stop = if end.node.kind().is_character_data() {
            Some(end.node)
        } else {
            end.node_after()
        };
        let between = core::iter::successors(start.node_after(), |it| it.following(None))
            .take_while(|it| Some(*it) != stop);
        if start.node != end.node || !start.node.kind().is_character_data() {
            between
                .filter_map(Node::as_text)
                .for_each(|it| it.with_data(|it| all.push(it)));
        }
        last.into_iter()
            .for_each(|it| all.push(&it.data().substring(0, end.offset)));
        all.finish()
    }
}

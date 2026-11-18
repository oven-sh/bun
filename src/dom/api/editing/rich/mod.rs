//! https://w3c.github.io/editing/docs/execCommand/

mod blocks;
mod delete;
mod inline;
mod insert;
mod lists;
mod looks;
mod tags;

use core::cell::{Cell, RefCell};

use super::command::{Command, Format};
use super::history;
use crate::api::ui::prelude::*;
use crate::order::Order as _;

/// The tree is not as the command needs it, or the command takes too long.
struct Stuck;
type Step<T = ()> = Result<T, Stuck>;
type Maybe<'a> = Option<&'a Node>;
type Nodes<'a> = Vec<&'a Node>;
type Test<'t, 'a> = &'t dyn Fn(&'a Node) -> bool;

const MAX_STEPS: u32 = 3_000_000;

#[derive(Clone, PartialEq)]
enum Override {
    State(bool),
    Value(String),
}

/// What outlasts a command.
pub(crate) struct Settings {
    uses_css: Cell<bool>,
    separator: Cell<Known>,
    /// For what is typed next, for as long as the selection is at these offsets of `Ui::overrides_start` and `overrides_end`.
    overrides: RefCell<Vec<(Format, Override)>>,
    offsets: Cell<[u32; 2]>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            uses_css: false.into(),
            separator: atom!("div").into(),
            overrides: Default::default(),
            offsets: Default::default(),
        }
    }
}

struct Editor<'c, 'a> {
    cx: RefCell<&'c mut Cx<'a>>,
    ui: &'a Ui,
    active: &'a Range,
    /// All that is in a `Nodes`.
    kept: List<'a>,
    steps: Cell<u32>,
    /// Neither it nor an ancestor is hidden, until the next change.
    shown: Cell<Maybe<'a>>,
}

fn at(node: &Node, offset: u32) -> Point<'_> {
    Point { node, offset }
}

fn end_of(node: &Node) -> Point<'_> {
    at(node, node.length())
}

fn parent(node: &Node) -> Step<&Node> {
    node.parent().ok_or(Stuck)
}

fn before(node: &Node) -> Step<Point<'_>> {
    Ok(at(parent(node)?, node.index()))
}

fn after(node: &Node) -> Step<Point<'_>> {
    Ok(at(parent(node)?, node.index() + 1))
}

fn child_after(point: Point<'_>) -> Maybe<'_> {
    point.node.child_at(point.offset)
}

fn child_before(point: Point<'_>) -> Maybe<'_> {
    point.node.child_at(point.offset.checked_sub(1)?)
}

fn is_at_end(point: Point<'_>) -> bool {
    point.offset == point.node.length()
}

fn is_before(a: Point<'_>, b: Point<'_>) -> bool {
    range::compare_points(a, b).is_lt()
}

fn unit_at(text: &Node, offset: u32) -> Option<u16> {
    text.as_text()?
        .with_data(|it| (offset < it.len()).then(|| it.unit(offset)))
}

fn unit_before(text: &Node, offset: u32) -> Option<u16> {
    unit_at(text, offset.checked_sub(1)?)
}

const NEWLINE: u16 = b'\n' as u16;
const NBSP: u16 = 0xa0;

fn ends_with_newline(text: &Node) -> bool {
    unit_before(text, text.length()) == Some(NEWLINE)
}

fn element_at(node: &Node) -> Option<&Element> {
    node.as_element().or_else(|| node.parent_element())
}

fn attribute_count(node: &Node) -> u32 {
    node.as_element().map_or(0, Element::attr_count)
}

fn has_attr(node: &Node, name: Known) -> bool {
    node.as_element().is_some_and(|it| it.has_attr(name))
}

fn has_only_attributes(node: &Node, allowed: impl Fn(Known) -> bool) -> bool {
    node.as_element().is_none_or(|it| {
        it.attrs()
            .iter()
            .all(|it| allowed(it.0.qualified().known()))
    })
}

fn is_only_child(node: &Node) -> bool {
    node.previous_sibling().is_none() && node.next_sibling().is_none()
}

fn has_at_most_one_child(node: &Node) -> bool {
    node.first_child() == node.last_child()
}

fn is_contained(node: &Node, start: Point<'_>, end: Point<'_>) -> bool {
    is_before(start, at(node, 0)) && is_before(end_of(node), end)
}

fn node_after(point: Point<'_>) -> Maybe<'_> {
    child_after(point).or_else(|| point.node.following_skip(None))
}

impl<'a> Editor<'_, 'a> {
    fn with<R>(&self, run: impl FnOnce(&mut Cx<'a>) -> R) -> R {
        self.steps.update(|it| it + 1);
        run(&mut self.cx.borrow_mut())
    }

    fn go_on(&self) -> Step {
        if self.steps.get() > MAX_STEPS {
            Err(Stuck)
        } else {
            Ok(())
        }
    }

    fn change<R>(&self, run: impl FnOnce(&mut Cx<'a>) -> R) -> Step<R> {
        self.shown.take();
        self.go_on().map(|()| self.with(run))
    }

    /// For a walk that calls itself. Nothing is changed after one that had to stop.
    fn inside(&self, node: &'a Node) -> impl Iterator<Item = &'a Node> {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            self.steps.set(MAX_STEPS + 1);
        }
        node.children()
            .take_while(|_| self.steps.get() <= MAX_STEPS)
    }

    fn settings(&self) -> &'a Settings {
        &self.ui.editing.settings
    }

    fn separator(&self) -> Known {
        self.settings().separator.get()
    }

    fn keep(&self, nodes: impl IntoIterator<Item = &'a Node>) -> Nodes<'a> {
        nodes
            .into_iter()
            .inspect(|it| self.with(|cx| self.kept.push(&cx.heap, it.to_js())))
            .collect()
    }

    fn children(&self, node: &'a Node) -> Nodes<'a> {
        self.keep(node.children())
    }

    fn create(&self, tag: Known) -> &'a Node {
        let made = self.with(|cx| self.ui.doc().create_html(&cx.heap, tag));
        self.keep([&**made])[0]
    }

    fn create_with(&self, tag: Known, name: Known, value: &str) -> Step<&'a Node> {
        let made = self.create(tag);
        self.set_attribute(made, name, Some(value))?;
        Ok(made)
    }

    fn copy(&self, node: &'a Node) -> Step<&'a Node> {
        self.change(|cx| clone_node(cx, node, self.ui.doc(), false, None, JSValue::UNDEFINED))?
            .map_err(|_| Stuck)
    }

    fn copy_without_id(&self, node: &'a Node) -> Step<&'a Node> {
        let copy = self.copy(node)?;
        self.set_attribute(copy, atom!("id"), None)?;
        Ok(copy)
    }

    fn insert(&self, node: &'a Node, parent: &'a Node, before: Maybe<'a>) -> Step {
        if node.contains(parent) {
            return Err(Stuck);
        }
        self.remove(node)?;
        if before.is_some_and(|it| it.parent() != Some(parent)) || node.parent().is_some() {
            return Err(Stuck);
        }
        self.change(|cx| insert(cx, node, parent, before, Observers::Notify))
    }

    fn insert_after(&self, node: &'a Node, previous: &'a Node) -> Step {
        self.insert(node, parent(previous)?, previous.next_sibling())
    }

    fn remove(&self, node: &'a Node) -> Step {
        self.change(|cx| remove(cx, node, Observers::Notify))
    }

    fn set_attribute(&self, node: &'a Node, name: Known, value: Option<&str>) -> Step {
        let Some(element) = node.as_element() else {
            return Ok(());
        };
        self.change(|cx| match value {
            Some(value) => element.set_attr(cx, name, DomString::from(value)),
            None => _ = element.remove_attr(cx, name),
        })
    }

    fn inline_style(&self, node: &'a Node, property: &str) -> String {
        node.as_element()
            .filter(|it| it.has_attr(atom!("style")))
            .map_or_else(String::new, |it| {
                self.with(|cx| host::inline_style(cx, it, property))
            })
    }

    fn set_style(&self, node: &'a Node, property: &str, value: &str) -> Step {
        let Some(element) = node
            .as_element()
            .filter(|it| !value.is_empty() || it.has_attr(atom!("style")))
        else {
            return Ok(());
        };
        self.change(|cx| {
            history::before_style_changes(cx, element);
            host::set_style(cx, element, property, value);
            element.flush_style(cx);
            if element.attr_is(atom!("style"), "") {
                element.remove_attr(cx, atom!("style"));
            }
        })
    }

    /// With the longhands of `text-decoration` as one.
    fn styled_properties(&self, node: &'a Node) -> Vec<String> {
        let Some(element) = node.as_element().filter(|it| it.has_attr(atom!("style"))) else {
            return Vec::new();
        };
        let mut names = self.with(|cx| host::styled_properties(cx, element));
        names
            .iter_mut()
            .filter(|it| it.starts_with("text-decoration-"))
            .for_each(|it| it.truncate("text-decoration".len()));
        names.order_by(Ord::cmp);
        names.dedup();
        names
    }

    fn replace_data(&self, text: &'a Node, offset: u32, count: u32, data: &DomString) -> Step {
        let text = text.as_character_data().ok_or(Stuck)?;
        self.change(|cx| text.replace_data(cx, offset, count, data))?
            .map_err(|_| Stuck)
    }

    fn delete_data(&self, text: &'a Node, start: u32, count: u32) -> Step {
        self.replace_data(text, start, count, &DomString::default())
    }

    fn split_text(&self, point: Point<'a>) -> Step<&'a Node> {
        let text = point.node.as_text().ok_or(Stuck)?;
        self.change(|cx| text.split(cx, point.offset))?
            .map(|it| -> &Node { it })
            .map_err(|_| Stuck)
    }

    fn add_break(&self, parent: &'a Node, before: Maybe<'a>) -> Step<&'a Node> {
        let made = self.create(atom!("br"));
        self.insert(made, parent, before)?;
        Ok(made)
    }

    fn add_break_after(&self, node: &'a Node) -> Step<&'a Node> {
        self.add_break(parent(node)?, node.next_sibling())
    }

    fn insert_at_caret(&self, node: &'a Node) -> Step {
        self.change(|cx| self.active.insert_node(cx, node))?
            .map_err(|_| Stuck)
    }

    fn start(&self) -> Point<'a> {
        self.active.start()
    }

    fn end(&self) -> Point<'a> {
        self.active.end()
    }

    fn select(&self, start: Point<'a>, end: Point<'a>) {
        self.with(|cx| self.active.set(cx, start, end));
    }

    fn put_caret(&self, point: Point<'a>) {
        self.select(point, point);
    }

    fn collapse(&self, to_start: bool) {
        self.put_caret(if to_start { self.start() } else { self.end() });
    }

    fn collect(
        &self,
        mut from: Maybe<'a>,
        stop: Maybe<'a>,
        test: Test<'_, 'a>,
        outermost: bool,
    ) -> Nodes<'a> {
        if from
            .zip(stop)
            .is_some_and(|(from, stop)| from.compare_order(stop).is_gt())
        {
            return Vec::new();
        }
        self.keep(core::iter::from_fn(|| {
            loop {
                let node = from.filter(|_| from != stop)?;
                let passes = test(node);
                let skips = passes && outermost && !stop.is_some_and(|it| node.contains(it));
                from = if skips {
                    node.following_skip(None)
                } else {
                    node.following(None)
                };
                if passes {
                    return Some(node);
                }
            }
        }))
    }

    fn contained(
        &self,
        [start, end]: [Point<'a>; 2],
        test: Test<'_, 'a>,
        outermost: bool,
    ) -> Nodes<'a> {
        let first = node_after(start).filter(|_| start.node.root() == end.node.root());
        self.collect(
            first,
            node_after(end),
            &|it| !it.contains(end.node) && test(it),
            outermost,
        )
    }

    fn is_effectively_contained(&self, node: &'a Node) -> bool {
        let (start, end) = (self.start(), self.end());
        let (has_start, has_end) = (node.contains(start.node), node.contains(end.node));
        let reaches = |inner: &'a Node, beyond: fn(&'a Node) -> Maybe<'a>| {
            (inner.first_child().is_some() || inner.is_text() && inner.length() > 0)
                && inner
                    .inclusive_ancestors()
                    .take_while(|it| *it != node)
                    .all(|it| beyond(it).is_none())
        };
        match () {
            () if start == end => false,
            () if !has_start && !has_end => is_contained(node, start, end),
            () if node.is_text() => has_start && !is_at_end(start) || has_end && end.offset != 0,
            () => {
                (!has_start || start.offset == 0 && reaches(start.node, Node::previous_sibling))
                    && (!has_end || is_at_end(end) && reaches(end.node, Node::next_sibling))
            }
        }
    }

    fn selected(&self, test: Test<'_, 'a>) -> Nodes<'a> {
        let (start, end) = (self.start(), self.end());
        let mut nodes = self.keep(
            start
                .node
                .inclusive_ancestors()
                .take_while(|it| self.is_effectively_contained(it))
                .filter(|it| test(it)),
        );
        nodes.reverse();
        nodes.extend(self.collect(
            node_after(start),
            node_after(end),
            &|it| (!it.contains(end.node) || self.is_effectively_contained(it)) && test(it),
            false,
        ));
        nodes
    }

    /// The selection stays with what it is at.
    fn move_to(
        &self,
        node: &'a Node,
        Point {
            node: parent,
            offset: index,
        }: Point<'a>,
    ) -> Step {
        let (old_parent, old_index) = (node.parent(), node.index());
        let [start, end] = [self.start(), self.end()].map(|mut it| {
            it.offset += u32::from(it.node == parent && it.offset > index);
            if Some(it.node) == old_parent && (old_index..=old_index + 1).contains(&it.offset) {
                it = at(parent, it.offset + index - old_index);
            }
            it.offset -= u32::from(Some(it.node) == old_parent && it.offset > old_index + 1);
            it
        });
        let before = parent.child_at(index);
        self.insert(
            node,
            parent,
            if before == Some(node) {
                node.next_sibling()
            } else {
                before
            },
        )?;
        let [start, end] = [start, end].map(|it| at(it.node, it.offset.min(it.node.length())));
        self.select(if is_before(end, start) { end } else { start }, end);
        Ok(())
    }

    fn move_to_end(&self, node: &'a Node, parent: &'a Node) -> Step {
        self.move_to(node, end_of(parent))
    }

    fn move_children(&self, from: &'a Node, to: &'a Node) -> Step {
        while let Some(first) = from.first_child() {
            self.move_to_end(first, to)?;
        }
        Ok(())
    }

    fn move_children_out(&self, element: &'a Node) -> Step {
        while let Some(first) = element.first_child() {
            self.move_to(first, before(element)?)?;
        }
        Ok(())
    }

    fn unwrap(&self, element: &'a Node) -> Step {
        self.move_children_out(element)?;
        self.remove(element)
    }

    fn create_like(&self, model: &'a Node, tag: Known) -> Step<&'a Node> {
        let made = self.create(tag);
        if let (Some(from), Some(to)) = (model.as_element(), made.as_element()) {
            self.change(|cx| {
                from.flush_style(cx);
                from.attrs()
                    .into_iter()
                    .for_each(|(name, value)| to.set_attr_ns(cx, name, value));
            })?;
        }
        Ok(made)
    }

    fn rename(&self, element: &'a Node, tag: Known) -> Step<&'a Node> {
        let Some(parent) = element.parent().filter(|_| !element.is_html(tag)) else {
            return Ok(element);
        };
        let made = self.create_like(element, tag)?;
        self.insert(made, parent, Some(element))?;
        self.move_children(element, made)?;
        self.remove(element)?;
        Ok(made)
    }

    fn is_enabled(&self, command: Command) -> bool {
        let (start, end) = (self.start().node, self.end().node);
        looks::host_of(start).is_some()
            && looks::host_of(end).is_some()
            && (command.suits_plain_text() || !looks::is_plain(start))
            && self
                .active
                .common_ancestor()
                .inclusive_ancestors()
                .any(looks::is_host)
    }

    /// Into the text before it, or else after it.
    fn settle_caret(&self) -> Step {
        let caret = self.start();
        if !self.active.collapsed() || caret.node.is_text() && caret.offset > 0 {
            return Ok(());
        }
        let formats = self.current_overrides();
        if let Some(found) = [self.first_equivalent(caret), self.last_equivalent(caret)]
            .into_iter()
            .find(|it| it.node.is_text())
        {
            self.put_caret(found);
        }
        self.restore_formats(formats)
    }

    /// To the end of the text before it on its line, unless a block follows.
    fn settle_caret_behind(&self) -> Step {
        let mut point = self.start();
        if point.node.is_text() && point.offset > 0 || self.block(child_after(point)).is_some() {
            return Ok(());
        }
        loop {
            point = self.first_equivalent(point);
            match self
                .removable(child_before(point))
                .filter(|it| !tags::is_break(*it) && self.is_inline(it))
            {
                Some(_) => point.offset -= 1,
                None if point.node.is_text()
                    && point.offset > 0
                    && !self.is_visible(point.node) =>
                {
                    point = before(point.node)?
                }
                None => break,
            }
        }
        if point.node.is_text()
            && point.offset > 0
            && !(ends_with_newline(point.node) && self.keeps_breaks(point.node))
        {
            let formats = self.current_overrides();
            self.put_caret(point);
            self.restore_formats(formats)?;
        }
        Ok(())
    }

    /// What is typed after it gets the formats that were meant for what is typed before it.
    fn keeping_overrides(&self, run: impl FnOnce() -> Step<bool>) -> Step<bool> {
        let formats = self.current_overrides();
        let result = run()?;
        if self.active.collapsed() {
            self.restore_formats(formats)?;
        }
        Ok(result)
    }

    fn perform(&self, command: Command, value: &DomString) -> Step<bool> {
        let done = |step: Step| step.map(|()| true);
        match command {
            Command::Format(format) => self.apply(format, &value.to_utf8()),
            Command::Unlink => done(self.unlink()),
            Command::RemoveFormat => done(self.remove_format()),
            Command::InsertText => done(self.insert_text(value)),
            Command::DeleteSelection => done(self.delete_selection(Default::default())),
            _ => self.keeping_overrides(|| match command {
                Command::FormatBlock => self.format_block(&value.to_utf8()),
                Command::Justify(alignment) => done(self.justify(alignment)),
                Command::InsertList(tag) => done(self.toggle_list(tag)),
                Command::Indent => done(self.indent()),
                Command::Outdent => done(self.outdent()),
                Command::Delete => done(self.delete()),
                Command::ForwardDelete => done(self.forward_delete()),
                Command::InsertHorizontalRule => done(self.insert_rule(&value.to_utf8())),
                Command::InsertHtml | Command::InsertPasted => {
                    done(self.insert_html(value, command == Command::InsertPasted))
                }
                Command::InsertImage => done(self.insert_image(&value.to_utf8())),
                Command::InsertLineBreak => done(self.insert_line_break()),
                Command::InsertParagraph => done(self.insert_paragraph()),
                _ => Ok(false),
            }),
        }
    }

    fn run(&self, command: Command, value: &DomString) -> Step<bool> {
        let (start, was_collapsed) = (self.start(), self.active.collapsed());
        if looks::host_of(start.node).is_some_and(|it| {
            matches!(it.html_tag(), atom!("optgroup") | atom!("option"))
                || it.inclusive_ancestors().any(tags::is_replaced)
        }) {
            return Ok(true);
        }
        let end = out_of_units(self.end(), before)?;
        let after_unit = Some(out_of_units(start, after)?).filter(|it| {
            !was_collapsed && !matches!(command, Command::Format(_)) && !is_before(end, *it)
        });
        self.select(
            after_unit.map_or_else(|| out_of_units(start, before), Ok)?,
            end,
        );
        let was_inside = !was_collapsed
            || start.node != self.start().node
                && !tags::is_void(start.node)
                && !start.node.is_html(atom!("img"));
        if self.active.collapsed() && was_inside && command.deletes() {
            return Ok(true);
        }
        if was_collapsed && matches!(command, Command::InsertText | Command::InsertLineBreak) {
            self.settle_caret_behind()?;
        }
        let result = self.perform(command, value)?;
        if command.suits_plain_text() {
            self.settle_caret()?;
        }
        Ok(result)
    }
}

/// Out of what has no place for a caret.
fn out_of_units<'a>(point: Point<'a>, side: fn(&'a Node) -> Step<Point<'a>>) -> Step<Point<'a>> {
    let editable = point
        .node
        .inclusive_ancestors()
        .take_while(|it| looks::is_editable(it));
    editable
        .filter(|it| tags::is_replaced(*it) || tags::is_void(*it) || it.is_html(atom!("colgroup")))
        .last()
        .map_or(Ok(point), side)
}

/// With the selection as the active range.
fn enter<'a, R: Default>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    body: impl FnOnce(&Editor<'_, 'a>) -> R,
) -> R {
    let selected = range::try_selection(ui.doc()).and_then(Selection::range);
    let Some(selected) = selected.filter(|it| it.start().node.out_of_control() == it.start().node)
    else {
        return R::default();
    };
    let (active, kept) = (
        Range::new(&cx.heap, selected.start(), selected.end()),
        List::new(&cx.heap),
    );
    let result = body(&Editor {
        cx: cx.into(),
        ui,
        active,
        kept,
        steps: 0.into(),
        shown: None.into(),
    });
    kept.to_js().ensure_still_alive();
    active.stop_following();
    result
}

pub(super) fn run<'a>(cx: &mut Cx<'a>, ui: &'a Ui, command: Command, value: &DomString) -> bool {
    enter(cx, ui, |editor| {
        if !editor.is_enabled(command) {
            return false;
        }
        let result = editor.run(command, value);
        editor.with(|cx| {
            let (selection, start, end) = (
                range::selection_of(&cx.heap, ui.doc()),
                editor.start(),
                editor.end(),
            );
            if selection.is_backward() {
                selection.select(cx, end, start)
            } else {
                selection.select(cx, start, end)
            }
        });
        result.unwrap_or(false)
    })
}

pub(super) fn configure(ui: &Ui, command: Command, value: &DomString) -> bool {
    let settings = &ui.editing.settings;
    match (
        command,
        Known::from_latin1_lowercased(value.latin1().unwrap_or_default()),
    ) {
        (Command::DefaultParagraphSeparator, tag @ (atom!("p") | atom!("div"))) => {
            settings.separator.set(tag)
        }
        (Command::DefaultParagraphSeparator, _) => return false,
        (_, value) => settings
            .uses_css
            .set((value == atom!("false")) == (command == Command::UseCss)),
    }
    true
}

pub(super) fn host_of_selection(ui: &Ui) -> Option<&Element> {
    let start = range::try_selection(ui.doc())?.range()?.start().node;
    looks::host_of(start)
        .filter(|_| start.out_of_control() == start)?
        .as_element()
}

pub(super) fn is_enabled<'a>(cx: &mut Cx<'a>, ui: &'a Ui, command: Command) -> bool {
    enter(cx, ui, |it| it.is_enabled(command))
}

pub(super) fn is_indeterminate<'a>(cx: &mut Cx<'a>, ui: &'a Ui, command: Command) -> bool {
    enter(cx, ui, |it| match command {
        Command::Format(format) => it.is_indeterminate(format),
        Command::Justify(alignment) => differ(
            it.selected_leaves()
                .iter()
                .map(|node| it.alignment_of(node) == alignment),
        ),
        Command::InsertList(tag) => it.list_state().is_mixed(tag),
        Command::FormatBlock => differ(it.selected_leaves().iter().map(|node| it.format_of(node))),
        _ => false,
    })
}

pub(super) fn state<'a>(cx: &mut Cx<'a>, ui: &'a Ui, command: Command) -> bool {
    match command {
        Command::StyleWithCss => ui.editing.settings.uses_css.get(),
        Command::Format(format) if format.is_toggle() => enter(cx, ui, |it| it.state_of(format)),
        Command::InsertList(tag) => enter(cx, ui, |it| it.list_state().is_all(tag)),
        Command::Justify(alignment) => enter(cx, ui, |it| {
            let leaves = it.selected_leaves();
            !leaves.is_empty() && leaves.iter().all(|node| it.alignment_of(node) == alignment)
        }),
        _ => false,
    }
}

pub(super) fn value<'a>(cx: &mut Cx<'a>, ui: &'a Ui, command: Command) -> String {
    match command {
        Command::DefaultParagraphSeparator => ui.editing.settings.separator.get().as_str().into(),
        Command::Format(format) if format.is_toggle() => state(cx, ui, command).to_string(),
        Command::InsertList(_) => state(cx, ui, command).to_string(),
        Command::Format(format) if format != Format::Link => {
            enter(cx, ui, |it| it.value_of(format))
        }
        Command::Justify(_) => enter(cx, ui, |it| {
            it.selected_leaves()
                .first()
                .map_or(atom!("left"), |node| it.alignment_of(node))
                .as_str()
                .into()
        }),
        Command::FormatBlock => enter(cx, ui, |it| {
            it.selected_leaves()
                .first()
                .and_then(|node| it.format_of(node))
                .map_or("", Known::as_str)
                .into()
        }),
        _ => String::new(),
    }
}

/// Whether what is typed next gets a format.
pub(super) fn has_overrides<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    !ui.editing.settings.overrides.borrow().is_empty()
        && enter(cx, ui, |it| !it.current_overrides().is_empty())
}

fn differ<T: PartialEq>(mut values: impl Iterator<Item = T>) -> bool {
    values
        .next()
        .is_some_and(|first| values.any(|it| it != first))
}

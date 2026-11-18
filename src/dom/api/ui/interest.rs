//! `interestfor`: https://open-ui.org/components/interest-invokers.explainer/

use core::cell::Cell;

use super::popover::{self, Hiding};
use super::prelude::*;
use crate::api::forms;
use crate::api::uievents::InterestEvent;
use crate::properties::Id;

/// The number of the task that is still wanted, if that is odd.
#[derive(Default)]
struct Tasks([Cell<i32>; 2]);

#[derive(Clone, Copy)]
enum Task {
    Gain,
    Lose,
}

pub(crate) fn target_of(source: &Element) -> Option<&Element> {
    let may_have = match source.kind() {
        Kind::Button => !forms::is_disabled(source),
        _ => source.has_state(State::LINK),
    };
    may_have
        .then(|| reflect::element(source, atom!("interestfor"))?.reference_target())
        .flatten()
}

fn active_target(source: &Element) -> Option<&Element> {
    source.edge_node(Edge::InterestTarget)?.as_element()
}

fn source_of(target: &Element) -> Option<&Element> {
    target.edge_node(Edge::InterestSource)?.as_element()
}

fn cancel(source: &Element, task: Task) {
    source
        .try_extra::<Tasks>()
        .inspect(|it| it.0[task as usize].update(|it| (it + 1) & !1));
}

fn schedule<'a>(cx: &mut Cx<'a>, ui: &'a Ui, source: &'a Element, task: Task) {
    let number = &source.extra::<Tasks>().0[task as usize];
    if number.get() & 1 == 1 {
        return;
    }
    number.update(|it| it + 1);
    let (property, normal) = match task {
        Task::Gain => (Id::InterestDelayStart, 0.5),
        Task::Lose => (Id::InterestDelayEnd, 0.25),
    };
    let seconds = layout::style(cx, source, |it| {
        it.other(property).strip_suffix('s')?.parse().ok()
    })
    .flatten()
    .unwrap_or(normal);
    host::set_timeout(
        cx,
        ui,
        seconds * 1000.0,
        [source.value(), (task as i32).into(), number.get().into()],
        |cx, [source, task, number]| {
            let task = if task.as_int32() == 0 {
                Task::Gain
            } else {
                Task::Lose
            };
            let Some(source) = Element::from_value(source)
                .filter(|it| it.extra::<Tasks>().0[task as usize].get() == number.as_int32())
            else {
                return;
            };
            cancel(source, task);
            match task {
                Task::Gain if source.has_state(State::HOVER | State::FOCUS) => gain(cx, source),
                Task::Gain => {}
                Task::Lose => _ = lose(cx, source, true),
            }
        },
    );
}

fn set<'a>(cx: &mut Cx<'a>, source: &'a Element, target: &'a Element, on: bool) {
    source.set_edge_node(&cx.heap, Edge::InterestTarget, on.then_some(target));
    target.set_edge_node(&cx.heap, Edge::InterestSource, on.then_some(source));
    source.set_custom_state(cx, ":interest-source", on);
    target.set_custom_state(cx, ":interest-target", on);
    if let Some(ui) = Ui::left_in(source.doc()) {
        ui.set_interested(if on {
            ui.interested().with(&cx.heap, source)
        } else {
            ui.interested().without(&cx.heap, source)
        });
    }
}

fn fire_at<'a>(
    cx: &mut Cx<'a>,
    target: &'a Element,
    name: Known,
    source: &'a Element,
    cancelable: bool,
) -> bool {
    let event = InterestEvent::new(
        &cx.heap,
        target.doc(),
        name,
        EventInit {
            cancelable,
            composed: true,
            ..PLAIN
        },
        Some(source),
    );
    dispatch(cx, target, event)
}

fn gain<'a>(cx: &mut Cx<'a>, source: &'a Element) {
    let Some(target) = target_of(source) else {
        return;
    };
    let is_still_wanted = || {
        source.is_connected()
            && target_of(source) == Some(target)
            && active_target(source).is_none()
            && source_of(target).is_none()
    };
    if source_of(target).is_none_or(|it| lose(cx, it, true))
        && is_still_wanted()
        && fire_at(cx, target, atom!("interest"), source, true)
        && is_still_wanted()
    {
        set(cx, source, target, true);
        _ = popover::show(cx, target, Some(source));
    }
}

/// False if that was prevented.
fn lose<'a>(cx: &mut Cx<'a>, source: &'a Element, cancelable: bool) -> bool {
    let Some(target) = active_target(source) else {
        return true;
    };
    if !fire_at(cx, target, atom!("loseinterest"), source, cancelable) {
        return false;
    }
    if active_target(source) == Some(target) {
        forget(cx, source);
        if popover::invoker_of(target) == Some(source) && !popover::is_hiding(target) {
            _ = popover::hide(
                cx,
                target,
                Hiding {
                    source: Some(source),
                    ..Default::default()
                },
            );
        }
    }
    true
}

/// Without events.
pub(crate) fn forget<'a>(cx: &mut Cx<'a>, source: &'a Element) {
    cancel(source, Task::Gain);
    cancel(source, Task::Lose);
    if let Some(target) = active_target(source) {
        set(cx, source, target, false);
    }
}

pub(crate) fn id_changed<'a>(cx: &mut Cx<'a>, target: &'a Element) {
    source_of(target)
        .filter(|it| target_of(it) != Some(target))
        .inspect(|it| forget(cx, it));
}

/// Those whose interest has led to `element`, the nearest first.
fn upstream<'a>(ui: &'a Ui, element: &'a Element) -> impl Iterator<Item = &'a Element> {
    let next = |source: &&'a Element| {
        source
            .flat_ancestors()
            .filter_map(Node::as_element)
            .find_map(source_of)
    };
    core::iter::successors(source_of(element), next).take(ui.interested().len())
}

/// The mouse or the focus has come or gone. It counts for the element as a source only if it `is_on_it`.
fn attention_changed<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    element: &'a Element,
    has_come: bool,
    is_on_it: bool,
) {
    let is_source = is_on_it && element.has_attr(atom!("interestfor"));
    if !is_source && ui.interested().is_empty() {
        return;
    }
    let (own, upstream) = (
        is_source.then_some(element),
        Refs::collect(&cx.heap, upstream(ui, element)),
    );
    if has_come {
        own.into_iter()
            .chain(upstream.iter())
            .for_each(|it| cancel(it, Task::Lose));
        own.filter(|it| active_target(it).is_none() && target_of(it).is_some())
            .inspect(|it| schedule(cx, ui, it, Task::Gain));
    } else {
        own.inspect(|it| cancel(it, Task::Gain));
        let left = own
            .filter(|it| active_target(it).is_some())
            .into_iter()
            .chain(upstream.iter().filter(|it| !it.has_state(State::HOVER)));
        left.for_each(|it| schedule(cx, ui, it, Task::Lose));
    }
}

pub(super) fn hover_changed<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    element: &'a Element,
    is_hovered: bool,
) {
    attention_changed(cx, ui, element, is_hovered, true);
}

pub(super) fn focus_changed<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    element: &'a Element,
    is_focused: bool,
) {
    let reach = if ui.interested().is_empty() {
        1
    } else {
        usize::MAX
    };
    for it in element
        .flat_ancestors()
        .map_while(Node::as_element)
        .take(reach)
    {
        attention_changed(cx, ui, it, is_focused, it == element);
    }
}

pub(super) fn popover_hides<'a>(cx: &mut Cx<'a>, popover: &'a Element) {
    source_of(popover).inspect(|it| _ = lose(cx, it, true));
}

/// Whether there was any.
pub(super) fn lose_all<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    let all = ui.interested();
    all.iter().rev().for_each(|it| _ = lose(cx, it, false));
    !all.is_empty()
}

pub(super) fn before_remove<'a>(cx: &mut Cx<'a>, ui: &'a Ui, removed: &'a Element) {
    let leaves = |source: &&Element| {
        removed.contains_composed(source)
            || active_target(source).is_some_and(|it| removed.contains_composed(it))
    };
    ui.interested()
        .iter()
        .filter(leaves)
        .for_each(|it| forget(cx, it));
}

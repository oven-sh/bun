//! https://html.spec.whatwg.org/#dnd

use super::pointer::{self, Place};
use super::prelude::*;
use super::{focus, selecting};
use crate::abi::Rect;
use crate::api::core::url::Url;
use crate::api::editing::{self, clipboard};
use crate::api::forms::{text::Direction, text_control};
use crate::api::transfer::{DataTransfer, DropEffect, EffectAllowed, Mode};
use crate::api::uievents::{DragEvent, Modifiers};
use crate::drag_image::DragImage;
use crate::generated_bindgen::images::HTMLImageElement;

#[derive(Clone, Copy)]
pub(crate) struct Drag {
    /// https://html.spec.whatwg.org/#current-drag-operation
    effect: DropEffect,
    moves_selection: bool,
    is_editable: bool,
}

pub(super) fn is_draggable(element: &Element) -> bool {
    match element.keyword(atom!("draggable")) {
        Some(atom!("true")) => true,
        Some(atom!("false")) => false,
        _ => {
            element.is_html(atom!("img"))
                || element.is_html(atom!("a")) && element.has_attr(atom!("href"))
        }
    }
}

fn fire_drag<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    data: &'a DataTransfer,
    target: &'a Node,
    name: Known,
    related: Option<&'a Element>,
) -> bool {
    let init = EventInit {
        cancelable: !matches!(name, atom!("dragleave") | atom!("dragend")),
        ..COMPOSED
    };
    let event = DragEvent::new(&cx.heap, ui.doc(), name, init, ui.pointer().state(0), data);
    event.set_related_node(related.map(|it| it.out_of_control()));
    data.set_mode(match name {
        atom!("dragstart") => Mode::ReadWrite,
        atom!("drop") => Mode::ReadOnly,
        _ => Mode::Protected,
    });
    let proceeds = dispatch(cx, target, event);
    data.set_mode(Mode::Protected);
    proceeds
}

fn begin(ui: &Ui, data: &DataTransfer, source: Option<&Node>, drag: Drag) {
    let pointer = ui.pointer();
    pointer.drag.set(Some(drag));
    pointer.set_drag_data(Some(data));
    pointer.set_dragged(source);
}

fn forget(ui: &Ui) {
    let pointer = ui.pointer();
    pointer.drag.set(None);
    pointer.set_drag_data(None);
    pointer.set_dragged(None);
    pointer.set_drag_over(None);
}

/// Relative to the pointer.
fn image_of<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    data: &'a DataTransfer,
    source: &'a Node,
    moves_selection: bool,
) -> Option<DragImage> {
    const OPACITY: f32 = 0.75;
    const MAX_SIZE_OF_IMAGES: f32 = 400.0;
    if let Some(chosen) = data.drag_image() {
        let [x, y] = data.hot_spot().map(|it| it as f32);
        if let Some(image) = chosen
            .downcast::<HTMLImageElement>()
            .filter(|it| !it.is_connected())
        {
            let (id, size) = (
                image.source(cx).ok()??.id,
                [image.get_natural_width(), image.get_natural_height()],
            );
            let (id, area) = ui
                .doc()
                .engine(|engine, _| engine.record_loose_image(id, size.map(|it| it as f32)))?;
            return Some((id, area.moved([-x, -y])));
        }
        return layout::laid_out(cx, chosen, |engine, id| {
            let ((image, area), corner) =
                (engine.record_element(id, 1.0)?, engine.bounding_rect(id));
            Some((image, area.moved([-corner.x - x, -corner.y - y])))
        });
    }
    let (is_image, [x, y]) = (
        source.is_html(atom!("img")),
        layout::narrow(ui.pointer().pressed_at.get()),
    );
    let (image, area) = layout::laid_out(cx, source, |engine, id| match moves_selection {
        true => engine.record_selection(OPACITY),
        false => engine.record_element(id, if is_image { OPACITY } else { 1.0 }),
    })?;
    let scale = if is_image && !moves_selection {
        (MAX_SIZE_OF_IMAGES / area.width.max(area.height)).min(1.0)
    } else {
        1.0
    };
    Some((
        image,
        Rect::new(area.moved([-x, -y]).to_array().map(|it| it * scale)),
    ))
}

pub(super) fn start<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let (pointer, doc) = (ui.pointer(), ui.doc());
    let (draggable, moves_selection) = (pointer.draggable(), pointer.may_drag_selection.take());
    pointer.set_draggable(None);
    let data = DataTransfer::new(doc.heap(&cx.heap), Mode::ReadWrite);
    data.set_effect_allowed(EffectAllowed::Uninitialized);
    let selected = || {
        Some(
            range::try_selection(doc)?
                .range()?
                .start()
                .node
                .out_of_control(),
        )
    };
    let Some(source) = (if moves_selection {
        selected()
    } else {
        draggable.map(|it| &**it)
    }) else {
        return;
    };
    if moves_selection {
        clipboard::put_selection(cx, ui, data);
    } else if let Some(element) =
        draggable.filter(|it| matches!(it.html_tag(), atom!("img") | atom!("a")))
        && let Some(url) = element.attr(if element.is_html(atom!("img")) {
            atom!("src")
        } else {
            atom!("href")
        })
    {
        let url = doc.parse_url(cx, &url).map_or(url, Url::into_href);
        data.put(&cx.heap, "text/plain", url.clone());
        data.put(&cx.heap, "text/uri-list", url);
        let markup = host::serialize(cx, element);
        data.put(&cx.heap, "text/html", markup);
    }
    let is_editable = moves_selection && editing::edit_target(cx, ui).is_some();
    begin(
        ui,
        data,
        Some(source),
        Drag {
            effect: DropEffect::None,
            moves_selection,
            is_editable,
        },
    );
    let at = pointer.at.replace(pointer.pressed_at.get());
    let starts = fire_drag(cx, ui, data, source, atom!("dragstart"), None);
    pointer.at.set(at);
    if !starts {
        return forget(ui);
    }
    let image = image_of(cx, ui, data, source, moves_selection);
    host::begin_drag(ui, data, image.unwrap_or_default());
    if let Some(under) = pointer.capture().or_else(|| pointer.hovered().first()) {
        pointer::fire_pointer(cx, ui, under, atom!("pointercancel"), None);
    }
    pointer.set_pending_capture(None);
    pointer.stop_tracking();
    pointer::settle_capture(cx, ui);
    pointer.release(cx);
    pointer::hover(cx, ui, None);
}

/// https://html.spec.whatwg.org/#dropEffect-initialisation
fn default_effect(ui: &Ui, drag: Drag, data: &DataTransfer) -> DropEffect {
    let copies = ui.pointer().modifiers.get().contains(if IS_MAC {
        Modifiers::ALT
    } else {
        Modifiers::CONTROL
    });
    match data.effect_allowed() {
        EffectAllowed::None => DropEffect::None,
        EffectAllowed::Link | EffectAllowed::LinkMove => DropEffect::Link,
        EffectAllowed::Move => DropEffect::Move,
        EffectAllowed::Uninitialized if drag.is_editable && !copies => DropEffect::Move,
        _ => DropEffect::Copy,
    }
}

fn accepts_text<'a>(cx: &mut Cx<'a>, target: &'a Element, data: &'a DataTransfer) -> bool {
    !data.stored("text/plain").is_empty()
        && text_control(target.out_of_control()).map_or_else(
            || looks_like(cx, target, Looks::EDITABLE),
            |it| it.is_mutable(),
        )
}

pub(super) fn over<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let pointer = ui.pointer();
    let (Some(mut drag), Some(data)) = (pointer.drag.get(), pointer.drag_data()) else {
        return;
    };
    data.set_drop_effect(DropEffect::None);
    if pointer
        .dragged()
        .is_some_and(|it| !fire_drag(cx, ui, data, it, atom!("drag"), None))
    {
        return end(cx, ui, false);
    }
    let [width, height] = layout::viewport_size(ui.doc());
    let is_inside = Rect::new([0.0, 0.0, width, height]).contains(layout::narrow(pointer.at.get()));
    let (target, previous) = (
        is_inside.then(|| pointer::element_under(cx, ui)).flatten(),
        pointer.drag_over(),
    );
    if target != previous {
        pointer.set_drag_over(target);
        data.set_drop_effect(default_effect(ui, drag, data));
        target.map(|it| fire_drag(cx, ui, data, it, atom!("dragenter"), previous));
        previous
            .filter(|it| it.is_connected())
            .map(|it| fire_drag(cx, ui, data, it, atom!("dragleave"), target));
    }
    drag.effect = DropEffect::None;
    if let Some(target) = target {
        data.set_drop_effect(default_effect(ui, drag, data));
        if !fire_drag(cx, ui, data, target, atom!("dragover"), None) {
            if data.effect_allowed().allows(data.drop_effect()) {
                drag.effect = data.drop_effect();
            }
        } else if accepts_text(cx, target, data) {
            drag.effect = default_effect(ui, drag, data);
        }
    }
    pointer.drag.set(Some(drag));
    pointer::set_cursor(
        ui,
        match drag.effect {
            DropEffect::None => "no-drop",
            DropEffect::Copy => "copy",
            DropEffect::Link => "alias",
            DropEffect::Move => "grabbing",
        },
    );
    ui.doc().invalidate(cx);
}

fn drop_text<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    target: &'a Element,
    drag: Drag,
    data: &'a DataTransfer,
) {
    let root = editing::selection_root(cx, target);
    let Some(hit) = layout::caret_at(cx, root, ui.pointer().at.get())
        .filter(|_| !(drag.moves_selection && selecting::is_over_selection(cx, ui)))
    else {
        return;
    };
    let (mark, control, mut offset) = (
        Range::new(&cx.heap, hit.point, hit.point),
        text_control(target.out_of_control()),
        hit.point.offset,
    );
    if drag.moves_selection && drag.effect == DropEffect::Move {
        if let Some([start, end]) = control
            .filter(|it| Some(&**it.element) == ui.pointer().dragged())
            .map(|it| it.selection())
            .filter(|it| offset > it[1])
        {
            offset -= end - start;
        }
        editing::delete_dragged(cx, ui);
    }
    focus::focus_on_mouse_down(cx, ui, target);
    match control {
        Some(control) => control.select(cx, offset, offset, Direction::default()),
        None => range::selection_of(&cx.heap, ui.doc()).collapse(cx, mark.start()),
    }
    data.set_mode(Mode::ReadOnly);
    clipboard::insert_transfer(cx, ui, data, atom!("insertFromDrop"));
}

pub(super) fn end<'a>(cx: &mut Cx<'a>, ui: &'a Ui, drops: bool) {
    let pointer = ui.pointer();
    let (Some(mut drag), Some(data)) = (pointer.drag.get(), pointer.drag_data()) else {
        return;
    };
    if let Some(over) = pointer.drag_over().filter(|it| it.is_connected()) {
        data.set_drop_effect(drag.effect);
        if !drops || drag.effect == DropEffect::None {
            fire_drag(cx, ui, data, over, atom!("dragleave"), None);
        } else if !fire_drag(cx, ui, data, over, atom!("drop"), None) {
            drag.effect = data.drop_effect();
        } else if accepts_text(cx, over, data) {
            drop_text(cx, ui, over, drag, data);
        } else {
            drag.effect = DropEffect::None;
        }
    }
    data.set_drop_effect(if drops { drag.effect } else { DropEffect::None });
    pointer
        .dragged()
        .map(|it| fire_drag(cx, ui, data, it, atom!("dragend"), None));
    data.set_mode(Mode::Disabled);
    forget(ui);
    pointer::refresh_hover(cx, ui);
}

/// From another application. `files` is only called when they enter.
pub(crate) fn files_over<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    place: Place,
    drops: bool,
    files: impl FnOnce(&mut Cx<'a>) -> Option<&'a DataTransfer>,
) {
    ui.pointer().place(ui, place);
    if ui.pointer().drag.get().is_none() {
        let Some(data) = files(cx) else { return };
        data.set_effect_allowed(EffectAllowed::All);
        begin(
            ui,
            data,
            None,
            Drag {
                effect: DropEffect::None,
                moves_selection: false,
                is_editable: false,
            },
        );
    }
    over(cx, ui);
    if drops {
        end(cx, ui, true);
    }
}

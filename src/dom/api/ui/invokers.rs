//! `popovertarget` and `commandfor`

use super::dialog;
use super::popover::{self, Hiding};
use super::prelude::*;
use crate::api::forms;
use crate::api::uievents::CommandEvent;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Command {
    Unknown,
    Custom,
    TogglePopover,
    ShowPopover,
    HidePopover,
    Close,
    RequestClose,
    ShowModal,
}

impl Command {
    fn of(button: &Element) -> Command {
        match button.keyword(atom!("command")) {
            Some(atom!("toggle-popover")) => Command::TogglePopover,
            Some(atom!("show-popover")) => Command::ShowPopover,
            Some(atom!("hide-popover")) => Command::HidePopover,
            Some(atom!("close")) => Command::Close,
            Some(atom!("request-close")) => Command::RequestClose,
            Some(atom!("show-modal")) => Command::ShowModal,
            _ if button.with_attr(atom!("command"), |it| it.starts_with("--")) == Some(true) => {
                Command::Custom
            }
            _ => Command::Unknown,
        }
    }

    fn is_for_popovers(self) -> bool {
        matches!(
            self,
            Command::TogglePopover | Command::ShowPopover | Command::HidePopover
        )
    }
}

/// https://html.spec.whatwg.org/#dom-button-command
pub(crate) fn command_name(button: &Element) -> DomString {
    let value = button.attr(atom!("command")).unwrap_or_default();
    match Command::of(button) {
        Command::Unknown => DomString::default(),
        Command::Custom => value,
        _ => value.to_ascii_lowercase(),
    }
}

fn commanded(button: &Element) -> Option<&Element> {
    button
        .is_html(atom!("button"))
        .then(|| reflect::element(button, atom!("commandfor"))?.reference_target())?
}

pub(crate) fn popover_target(button: &Element) -> Option<&Element> {
    if !forms::invokes_popovers(button) {
        return None;
    }
    let target = match commanded(button) {
        Some(target) => Command::of(button).is_for_popovers().then_some(target),
        None => reflect::element(button, atom!("popovertarget"))?.reference_target(),
    };
    target.filter(|it| popover::state(it).is_some())
}

/// https://html.spec.whatwg.org/#popover-target-attribute-activation-behavior
fn activate_popover_target<'a>(cx: &mut Cx<'a>, button: &'a Element, origin: &'a Node) {
    let Some(target) = popover_target(button) else {
        return;
    };
    if target != button && target.contains_composed(origin) && button.contains_composed(target) {
        return;
    }
    _ = match (
        popover::is_showing(target),
        button.keyword(atom!("popovertargetaction")),
    ) {
        (true, Some(atom!("show"))) | (false, Some(atom!("hide"))) => Ok(()),
        (true, _) => popover::hide(
            cx,
            target,
            Hiding {
                source: Some(button),
                ..Default::default()
            },
        ),
        (false, _) => popover::show(cx, target, Some(button)),
    };
}

pub(crate) fn invoke<'a>(cx: &mut Cx<'a>, button: &'a Element, origin: &'a Node) {
    let Some(target) = commanded(button) else {
        return activate_popover_target(cx, button, origin);
    };
    let command = Command::of(button);
    let applies = match command {
        Command::Unknown => false,
        Command::Custom => true,
        _ if command.is_for_popovers() => target.ns() == Ns::Html,
        _ => target.is_html(atom!("dialog")),
    };
    if !applies {
        return;
    }
    let event = CommandEvent::new(&cx.heap, target.doc(), command_name(button), button);
    if !dispatch(cx, target, event) || !target.is_connected() {
        return;
    }
    let (is_showing, source) = (popover::is_showing(target), Some(button));
    match command {
        Command::TogglePopover if !is_showing => _ = popover::show(cx, target, source),
        Command::ShowPopover => _ = popover::show(cx, target, source),
        Command::HidePopover | Command::TogglePopover => {
            _ = popover::hide(
                cx,
                target,
                Hiding {
                    source,
                    ..Default::default()
                },
            )
        }
        _ if is_showing => {}
        Command::Close => dialog::close(cx, target, button.attr(atom!("value")), source),
        Command::RequestClose => {
            dialog::request_close(cx, target, button.attr(atom!("value")), source)
        }
        Command::ShowModal => _ = dialog::show(cx, target, true, source),
        Command::Custom | Command::Unknown => {}
    }
}

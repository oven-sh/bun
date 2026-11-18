//! The keys that edit, and those that move the caret.

use super::command::Format;
use super::{By, Command, delete_by, execute, selected, selection, typing_target};
use crate::api::forms::text_control;
use crate::api::ui::layout::{By as Reach, Direction};
use crate::api::ui::prelude::*;
use crate::api::uievents::KeyboardEvent;

/// In lowercase.
fn letter(name: &str) -> Option<u8> {
    match name.as_bytes() {
        [letter] if letter.is_ascii_alphabetic() => Some(letter.to_ascii_lowercase()),
        _ => None,
    }
}

fn movement(event: &KeyboardEvent) -> Option<(Direction, Reach)> {
    use Direction::{Backward, Forward, Left, Right};
    let (key, alt, control, meta) = (
        event.key(),
        event.get_alt_key(),
        event.get_ctrl_key(),
        event.get_meta_key(),
    );
    let by_word = if IS_MAC { alt } else { control };
    if !IS_MAC && (alt || meta) {
        return None;
    }
    let along = if by_word {
        Reach::Word
    } else if meta {
        Reach::LineBoundary
    } else {
        Reach::Character
    };
    let across = match () {
        () if meta => Reach::DocumentBoundary,
        () if !by_word => Reach::Line,
        () if IS_MAC => Reach::ParagraphBoundary,
        () => Reach::Paragraph,
    };
    let to_end = if control {
        Reach::DocumentBoundary
    } else {
        Reach::LineBoundary
    };
    Some(match key {
        atom!("ArrowLeft") => (Left, along),
        atom!("ArrowRight") => (Right, along),
        atom!("ArrowUp") => (Backward, across),
        atom!("ArrowDown") => (Forward, across),
        atom!("Home") if !IS_MAC => (Backward, to_end),
        atom!("End") if !IS_MAC => (Forward, to_end),
        atom!("PageUp") if !IS_MAC => (Backward, Reach::Page),
        atom!("PageDown") if !IS_MAC => (Forward, Reach::Page),
        _ if !IS_MAC || !control || meta => return None,
        _ => match letter(&event.get_key().as_utf8())? {
            b'a' => (Backward, Reach::ParagraphBoundary),
            b'e' => (Forward, Reach::ParagraphBoundary),
            b'b' => (Backward, Reach::Character),
            b'f' => (Forward, Reach::Character),
            b'p' => (Backward, Reach::Line),
            b'n' => (Forward, Reach::Line),
            _ => return None,
        },
    })
}

fn shortcut(event: &KeyboardEvent) -> Option<Command> {
    let (shift, alt, control, meta) = (
        event.get_shift_key(),
        event.get_alt_key(),
        event.get_ctrl_key(),
        event.get_meta_key(),
    );
    match event.key() {
        atom!("Insert") if !IS_MAC => {
            return shift
                .then_some(Command::Paste)
                .or_else(|| control.then_some(Command::Copy));
        }
        atom!("Delete") if !IS_MAC && shift => return Some(Command::Cut),
        _ if if IS_MAC {
            !meta || control
        } else {
            !control || alt || meta
        } =>
        {
            return None;
        }
        _ => {}
    }
    Some(
        match (
            letter(&event.get_key().as_utf8())
                .or_else(|| letter(event.get_code().as_utf8().strip_prefix("Key")?))?,
            shift,
        ) {
            (b'z', true) => Command::Redo,
            (b'v', true) => Command::PasteAndMatchStyle,
            (_, true) => return None,
            (b'y', _) if !IS_MAC => Command::Redo,
            (b'a', _) => Command::SelectAll,
            (b'c', _) => Command::Copy,
            (b'x', _) => Command::Cut,
            (b'v', _) => Command::Paste,
            (b'z', _) => Command::Undo,
            (b'b', _) => Command::Format(Format::Bold),
            (b'i', _) => Command::Format(Format::Italic),
            (b'u', _) => Command::Format(Format::Underline),
            _ => return None,
        },
    )
}

fn deletion(event: &KeyboardEvent) -> Option<(bool, Reach)> {
    let (alt, control, meta) = (
        event.get_alt_key(),
        event.get_ctrl_key(),
        event.get_meta_key(),
    );
    let reach = if if IS_MAC { alt } else { control } {
        Reach::Word
    } else if meta {
        Reach::LineBoundary
    } else {
        Reach::Character
    };
    Some(match event.key() {
        atom!("Backspace") => (false, reach),
        atom!("Delete") => (true, reach),
        _ if !IS_MAC || !control || meta => return None,
        atom!("d") => (true, Reach::Character),
        atom!("h") => (false, Reach::Character),
        atom!("k") => (true, Reach::ParagraphBoundary),
        _ => return None,
    })
}

/// The default action of `keydown`.
pub(crate) fn handle_key<'a>(cx: &mut Cx<'a>, ui: &'a Ui, event: &'a KeyboardEvent) -> bool {
    if let Some(command) = shortcut(event) {
        // A menu item with the same shortcut would fire the clipboard event again.
        let is_for_clipboard = matches!(
            command,
            Command::Copy | Command::Cut | Command::Paste | Command::PasteAndMatchStyle
        );
        return execute(cx, ui, command, &DomString::default(), By::User) || is_for_clipboard;
    }
    let (deletion, movement) = (deletion(event), movement(event));
    if deletion.is_none() && movement.is_none()
        || selected(ui).is_none_or(|it| selection::is_in_idle_control(ui, it.start().node))
    {
        return false;
    }
    let has_caret =
        ui.focused().and_then(|it| text_control(it)).is_some() || typing_target(cx, ui).is_some();
    if let Some((is_forward, reach)) = deletion {
        return has_caret && delete_by(cx, ui, is_forward, reach, By::User);
    }
    let (extends, span) = (
        event.get_shift_key(),
        range::try_selection(ui.doc()).and_then(Selection::span),
    );
    let Some((direction, reach)) =
        movement.filter(|_| has_caret || extends && span.is_some_and(|it| !it.collapsed()))
    else {
        return false;
    };
    selection::modify(cx, ui, extends, direction, reach, By::User);
    selection::reveal(cx, ui);
    true
}

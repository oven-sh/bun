//! Keys as the DevTools protocol names them.

use bun_ui::protocol::Key;

use crate::IS_MAC;
use crate::value::Value;
use bun_ui::protocol::{ALT, CONTROL, META, SHIFT};

pub(super) fn modifiers(it: u8) -> u8 {
    (it & SHIFT) << 3 | it & CONTROL | (it & ALT) >> 2 | (it & META) >> 1
}

fn named(name: &str) -> Option<u8> {
    Some(match name {
        "Backspace" => 8,
        "Tab" => 9,
        "Enter" | "NumpadEnter" => 13,
        "ShiftLeft" | "ShiftRight" => 16,
        "ControlLeft" | "ControlRight" => 17,
        "AltLeft" | "AltRight" => 18,
        "Pause" => 19,
        "CapsLock" => 20,
        "Escape" => 27,
        "Space" => 32,
        "PageUp" => 33,
        "PageDown" => 34,
        "End" => 35,
        "Home" => 36,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        "PrintScreen" => 44,
        "Insert" => 45,
        "Delete" => 46,
        "MetaLeft" => 91,
        "MetaRight" if !IS_MAC => 92,
        "MetaRight" | "ContextMenu" => 93,
        "NumpadMultiply" => 106,
        "NumpadAdd" => 107,
        "NumpadSubtract" => 109,
        "NumpadDecimal" => 110,
        "NumpadDivide" => 111,
        "NumLock" => 144,
        "ScrollLock" => 145,
        "Semicolon" => 186,
        "Equal" => 187,
        "Comma" => 188,
        "Minus" => 189,
        "Period" => 190,
        "Slash" => 191,
        "Backquote" => 192,
        "BracketLeft" => 219,
        "Backslash" => 220,
        "BracketRight" => 221,
        "Quote" => 222,
        "IntlBackslash" => 226,
        _ => return None,
    })
}

pub(super) fn function_key(name: &str) -> Option<u8> {
    name.strip_prefix('F')?.parse().ok()
}

fn virtual_key_code(key: &str, code: &str) -> u8 {
    match (key.as_bytes(), code.as_bytes()) {
        (b"Process" | b"Dead", _) => 229,
        ([letter], _) if letter.is_ascii_alphabetic() => letter.to_ascii_uppercase(),
        (_, [b'K', b'e', b'y', last] | [b'D', b'i', b'g', b'i', b't', last]) => *last,
        ([digit @ b'0'..=b'9'], [b'N', b'u', b'm', b'p', b'a', b'd', b'0'..=b'9']) => {
            96 + digit - b'0'
        }
        _ => (function_key(code).map(|it| it.saturating_add(111)))
            .or_else(|| named(key))
            .or_else(|| named(code))
            .unwrap_or(0),
    }
}

pub(super) fn describe(kind: &str, it: &Key) -> Value {
    record! {
        "type": kind,
        "key": &*it.key,
        "code": &*it.code,
        "windowsVirtualKeyCode": virtual_key_code(&it.key, &it.code),
        "location": if it.location == 3 { 0 } else { it.location },
        "isKeypad": it.location == 3,
        "autoRepeat": it.is_repeat,
        "modifiers": modifiers(it.modifiers),
    }
}

/// On macOS the system has the key bindings of text fields.
pub(super) fn editing_command(it: &Key) -> Option<String> {
    let (option, command) = (it.modifiers & ALT != 0, it.modifiers & META != 0);
    let word = if option { "Word" } else { "" };
    let deletion = |direction, end| match command {
        true => format!("deleteTo{end}OfLine"),
        false => format!("delete{word}{direction}"),
    };
    let movement = match (&*it.key, it.key.strip_prefix("Arrow")) {
        ("Backspace", _) => return Some(deletion("Backward", "Beginning")),
        ("Delete", _) => return Some(deletion("Forward", "End")),
        (_, Some(side @ ("Left" | "Right"))) if command => format!("moveTo{side}EndOfLine"),
        (_, Some(side @ ("Left" | "Right"))) => format!("move{word}{side}"),
        (_, Some(direction)) => match (
            if direction == "Up" {
                "Beginning"
            } else {
                "End"
            },
            command,
            option,
        ) {
            (end, true, _) => format!("moveTo{end}OfDocument"),
            (end, _, true) => format!("moveTo{end}OfParagraph"),
            _ => format!("move{direction}"),
        },
        (key, None) => {
            let command = match key {
                "a" => "moveToBeginningOfParagraph",
                "e" => "moveToEndOfParagraph",
                "k" => "deleteToEndOfParagraph",
                "d" => "deleteForward",
                _ => return None,
            };
            return (it.modifiers == CONTROL).then(|| command.to_owned());
        }
    };
    Some(if it.modifiers & SHIFT != 0 {
        movement + "AndModifySelection"
    } else {
        movement
    })
}

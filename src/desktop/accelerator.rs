//! Electron's accelerators: "CmdOrCtrl+Shift+P".

use bun_ui::protocol::{ALT, CONTROL, Chord, META, SHIFT};

use crate::prelude::*;
use crate::text;

pub(crate) fn modifier(name: &str) -> Option<u8> {
    Some(match &*name.trim().to_ascii_lowercase() {
        "shift" => SHIFT,
        "control" | "ctrl" => CONTROL,
        "alt" | "option" => ALT,
        "command" | "cmd" | "super" | "meta" => META,
        "commandorcontrol" | "cmdorctrl" | "mod" if IS_MAC => META,
        "commandorcontrol" | "cmdorctrl" | "mod" => CONTROL,
        _ => return None,
    })
}

const NAMED: [&str; 17] = [
    "space",
    "tab",
    "enter",
    "escape",
    "backspace",
    "delete",
    "insert",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
    "menu",
    "capslock",
];

/// The `key` of a [`Chord`].
pub(crate) fn key_name(key: &str) -> Option<String> {
    let lower = key.to_lowercase();
    let name = match &*lower {
        "plus" | "numadd" => "+",
        " " => "space",
        "return" => "enter",
        "esc" => "escape",
        "arrowup" => "up",
        "arrowdown" => "down",
        "arrowleft" => "left",
        "arrowright" => "right",
        "contextmenu" => "menu",
        "numsub" => "-",
        "nummult" => "*",
        "numdiv" => "/",
        "numdec" => ".",
        other => match other.as_bytes() {
            [b'n', b'u', b'm', b'0'..=b'9'] => &other[3..],
            _ => other,
        },
    };
    let is_function = matches!(
        name.as_bytes(),
        [b'f', b'1'..=b'9'] | [b'f', b'1', b'0'..=b'9'] | [b'f', b'2', b'0'..=b'4']
    );
    (is_function || NAMED.contains(&name) || name.chars().count() == 1).then(|| name.into())
}

pub(crate) fn parse(accelerator: &str) -> JsResult<Chord> {
    let mut parts: Vec<&str> = text::split(accelerator, "+").collect();
    let mut last = parts.pop().unwrap_or_default();
    if last.is_empty() && parts.pop().is_some() {
        last = "+";
    }
    let missing = |what, name| {
        invalid_value(
            "accelerator",
            accelerator,
            &format!("has no {what} \"{name}\""),
        )
    };
    let mut modifiers = 0;
    for part in parts {
        modifiers |= modifier(part).ok_or_else(|| missing("modifier", part))?;
    }
    let key = key_name(if last == " " { last } else { last.trim() })
        .ok_or_else(|| missing("key", last))?;
    Ok(Chord {
        key: key.into(),
        modifiers,
    })
}

pub(crate) fn format(chord: &Chord) -> String {
    let names = match IS_MAC {
        true => [(CONTROL, "⌃"), (ALT, "⌥"), (SHIFT, "⇧"), (META, "⌘")],
        false => [
            (CONTROL, "Ctrl+"),
            (ALT, "Alt+"),
            (SHIFT, "Shift+"),
            (META, "Super+"),
        ],
    };
    let mut label: String = (names
        .iter()
        .filter(|it| chord.modifiers & it.0 != 0)
        .map(|it| it.1))
    .collect();
    match &*chord.key {
        "escape" => label.push_str("Esc"),
        "pageup" => label.push_str("PgUp"),
        "pagedown" => label.push_str("PgDn"),
        "delete" => label.push_str("Del"),
        "insert" => label.push_str("Ins"),
        key => {
            let mut characters = key.chars();
            label.extend(characters.next().into_iter().flat_map(char::to_uppercase));
            label.extend(characters);
        }
    }
    label
}

/// A key that went down: the `key` and `code` of a `KeyboardEvent`.
pub(crate) struct Stroke {
    key: String,
    names: [Option<String>; 2],
    pub(crate) modifiers: u8,
}

impl Stroke {
    pub(crate) fn new(key: &str, code: &str, modifiers: u8) -> Stroke {
        let label = code
            .strip_prefix("Key")
            .or_else(|| code.strip_prefix("Digit"));
        Stroke {
            key: key.into(),
            names: [key_name(key), key_name(label.unwrap_or(code))],
            modifiers: modifiers & (SHIFT | CONTROL | ALT | META),
        }
    }

    pub(crate) fn is(&self, chord: &Chord) -> bool {
        let is_shifted = *chord.key == self.key
            && !self.key.bytes().any(|it| it.is_ascii_alphabetic())
            && chord.modifiers == self.modifiers & !SHIFT;
        is_shifted
            || (chord.modifiers == self.modifiers
                && self.names.iter().flatten().any(|it| **it == *chord.key))
    }
}

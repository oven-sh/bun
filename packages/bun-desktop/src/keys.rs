use gpui::{Keystroke, Modifiers, MouseButton};
use serde_json::Value;

/// By evdev code.
const CODES: [&str; 128] = [
    "",
    "Escape",
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "Digit0",
    "Minus",
    "Equal",
    "Backspace",
    "Tab",
    "KeyQ",
    "KeyW",
    "KeyE",
    "KeyR",
    "KeyT",
    "KeyY",
    "KeyU",
    "KeyI",
    "KeyO",
    "KeyP",
    "BracketLeft",
    "BracketRight",
    "Enter",
    "ControlLeft",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyF",
    "KeyG",
    "KeyH",
    "KeyJ",
    "KeyK",
    "KeyL",
    "Semicolon",
    "Quote",
    "Backquote",
    "ShiftLeft",
    "Backslash",
    "KeyZ",
    "KeyX",
    "KeyC",
    "KeyV",
    "KeyB",
    "KeyN",
    "KeyM",
    "Comma",
    "Period",
    "Slash",
    "ShiftRight",
    "NumpadMultiply",
    "AltLeft",
    "Space",
    "CapsLock",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "NumLock",
    "ScrollLock",
    "Numpad7",
    "Numpad8",
    "Numpad9",
    "NumpadSubtract",
    "Numpad4",
    "Numpad5",
    "Numpad6",
    "NumpadAdd",
    "Numpad1",
    "Numpad2",
    "Numpad3",
    "Numpad0",
    "NumpadDecimal",
    "",
    "Lang5",
    "IntlBackslash",
    "F11",
    "F12",
    "IntlRo",
    "Lang3",
    "Lang4",
    "Convert",
    "KanaMode",
    "NonConvert",
    "",
    "NumpadEnter",
    "ControlRight",
    "NumpadDivide",
    "PrintScreen",
    "AltRight",
    "",
    "Home",
    "ArrowUp",
    "PageUp",
    "ArrowLeft",
    "ArrowRight",
    "End",
    "ArrowDown",
    "PageDown",
    "Insert",
    "Delete",
    "",
    "AudioVolumeMute",
    "AudioVolumeDown",
    "AudioVolumeUp",
    "Power",
    "NumpadEqual",
    "",
    "Pause",
    "",
    "NumpadComma",
    "Lang1",
    "Lang2",
    "IntlYen",
    "MetaLeft",
    "MetaRight",
    "ContextMenu",
];

const FN: u32 = 464;

#[cfg(target_os = "macos")]
fn evdev_code(virtual_key: u32) -> u32 {
    const CODES: [u16; 127] = [
        30, 31, 32, 33, 35, 34, 44, 45, 46, 47, 86, 48, 16, 17, 18, 19, 21, 20, 2, 3, 4, 5, 7, 6,
        13, 10, 8, 12, 9, 11, 27, 24, 22, 26, 23, 25, 28, 38, 36, 40, 37, 39, 43, 51, 53, 49, 50,
        52, 15, 57, 41, 14, 0, 1, 126, 125, 42, 58, 56, 29, 54, 100, 97, 464, 187, 83, 0, 55, 0,
        78, 0, 69, 115, 114, 113, 98, 96, 0, 74, 188, 189, 117, 82, 79, 80, 81, 75, 76, 77, 71,
        190, 72, 73, 124, 89, 121, 63, 64, 65, 61, 66, 67, 123, 87, 122, 183, 186, 184, 0, 68, 127,
        88, 0, 185, 110, 102, 104, 111, 62, 107, 60, 109, 59, 105, 106, 108, 103,
    ];
    CODES
        .get(virtual_key as usize)
        .map_or(0, |code| (*code).into())
}

#[cfg(target_os = "windows")]
fn evdev_code(scan_code: u32) -> u32 {
    match scan_code {
        0x45 => 119,
        0x01..=0x58 => scan_code,
        0x59 => 117,
        0x64..=0x6E => scan_code - 0x64 + 183,
        0x70 => 93,
        0x71 => 123,
        0x72 => 122,
        0x73 => 89,
        0x76 => 194,
        0x79 => 92,
        0x7B => 94,
        0x7D => 124,
        0x7E => 121,
        0xE010 => 165,
        0xE019 => 163,
        0xE01C => 96,
        0xE01D => 97,
        0xE020 => 113,
        0xE022 => 164,
        0xE024 => 166,
        0xE02E => 114,
        0xE030 => 115,
        0xE035 => 98,
        0xE036 => 54,
        0xE037 => 99,
        0xE038 => 100,
        0xE045 => 69,
        0xE047..=0xE049 => scan_code - 0xE047 + 102,
        0xE04B => 105,
        0xE04D => 106,
        0xE04F..=0xE053 => scan_code - 0xE04F + 107,
        0xE05B..=0xE05D => scan_code - 0xE05B + 125,
        0xE069 => 159,
        0xE06A => 158,
        _ => 0,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn evdev_code(code: u32) -> u32 {
    code
}

/// The `code` of a DOM `KeyboardEvent`.
pub fn dom_code(scan_code: u32) -> &'static str {
    const F13_TO_F24: [&str; 12] = [
        "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24",
    ];
    match evdev_code(scan_code) {
        158 => "BrowserBack",
        159 => "BrowserForward",
        163 => "MediaTrackNext",
        164 => "MediaPlayPause",
        165 => "MediaTrackPrevious",
        166 => "MediaStop",
        code @ 183..=194 => F13_TO_F24[code as usize - 183],
        FN => "Fn",
        code => CODES.get(code as usize).copied().unwrap_or_default(),
    }
}

/// For a key that no keyboard sent, on a US layout.
pub fn code_for_key(key: &str) -> String {
    const PUNCTUATION: [(&str, &str); 12] = [
        ("-_", "Minus"),
        ("=+", "Equal"),
        ("[{", "BracketLeft"),
        ("]}", "BracketRight"),
        (";:", "Semicolon"),
        ("'\"", "Quote"),
        ("`~", "Backquote"),
        ("\\|", "Backslash"),
        (",<", "Comma"),
        (".>", "Period"),
        ("/?", "Slash"),
        (" ", "Space"),
    ];
    match key.as_bytes() {
        [letter] if letter.is_ascii_alphabetic() => format!("Key{}", key.to_ascii_uppercase()),
        [digit] if digit.is_ascii_digit() => format!("Digit{key}"),
        [_] => match ")!@#$%^&*(".find(key) {
            Some(digit) => format!("Digit{digit}"),
            None => PUNCTUATION
                .iter()
                .find(|(keys, _)| keys.contains(key))
                .map_or("", |it| it.1)
                .to_owned(),
        },
        b"Shift" | b"Control" | b"Alt" | b"Meta" => format!("{key}Left"),
        _ if CODES.contains(&key) => key.to_owned(),
        _ => String::new(),
    }
}

pub fn location(code: &str) -> u8 {
    match code {
        "ShiftLeft" | "ControlLeft" | "AltLeft" | "MetaLeft" => 1,
        "ShiftRight" | "ControlRight" | "AltRight" | "MetaRight" => 2,
        _ if code.starts_with("Numpad") => 3,
        _ => 0,
    }
}

pub const ALT_GRAPH: u8 = 16;
pub const CAPS_LOCK: u8 = 32;

/// The bit that is set while the key is down. `None` for a key that is no modifier.
pub fn modifier_bit(key: &str) -> Option<u8> {
    Some(match key {
        "Shift" => 1,
        "Control" => 2,
        "Alt" => 4,
        "Meta" => 8,
        "AltGraph" => ALT_GRAPH,
        "CapsLock" | "NumLock" | "Fn" | "ModeChange" => 0,
        _ => return None,
    })
}

/// The `key` of a DOM `KeyboardEvent`, if it is known without the text that the key types.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn key_for_symbol(symbol: u32, code: &'static str) -> Option<String> {
    const VK_PROCESSKEY: u32 = 0xE5;
    let key = code.trim_end_matches("Left").trim_end_matches("Right");
    let is_printable = |it: &char| !it.is_control() && !('\u{F700}'..='\u{F8FE}').contains(it);
    let typed = char::from_u32(symbol).filter(|it| cfg!(target_os = "macos") && is_printable(it));
    match symbol {
        _ if typed.is_some() => typed.map(String::from),
        u32::MAX => Some("Dead".to_owned()),
        VK_PROCESSKEY => Some("Process".to_owned()),
        _ if code.starts_with("Audio")
            || code.starts_with("Media")
            || code.starts_with("Browser") =>
        {
            Some(code.to_owned())
        }
        _ => modifier_bit(key).map(|_| key.to_owned()),
    }
}

/// The `key` of a DOM `KeyboardEvent`, from a keysym.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn key_for_symbol(symbol: u32, code: &'static str) -> Option<String> {
    let named = match symbol {
        0xFF08 => "Backspace",
        0xFF09 | 0xFE20 | 0xFF89 => "Tab",
        0xFF0B | 0xFF58 | 0xFF9D => "Clear",
        0xFF0D | 0xFF8D => "Enter",
        0xFF13 | 0xFF6B => "Pause",
        0xFF14 => "ScrollLock",
        0xFF1B => "Escape",
        0xFF20 => "Compose",
        0xFF21 => "KanjiMode",
        0xFF22 => "NonConvert",
        0xFF23 => "Convert",
        0xFF27 => "HiraganaKatakana",
        0xFF2A => "ZenkakuHankaku",
        0xFF31 => "HangulMode",
        0xFF34 => "HanjaMode",
        0xFF50 | 0xFF95 => "Home",
        0xFF51 | 0xFF96 => "ArrowLeft",
        0xFF52 | 0xFF97 => "ArrowUp",
        0xFF53 | 0xFF98 => "ArrowRight",
        0xFF54 | 0xFF99 => "ArrowDown",
        0xFF55 | 0xFF9A => "PageUp",
        0xFF56 | 0xFF9B => "PageDown",
        0xFF57 | 0xFF9C => "End",
        0xFF61 | 0xFF15 => "PrintScreen",
        0xFF63 | 0xFF9E => "Insert",
        0xFF65 => "Undo",
        0xFF66 => "Redo",
        0xFF67 => "ContextMenu",
        0xFF68 => "Find",
        0xFF69 => "Cancel",
        0xFF6A => "Help",
        0xFF7E => "ModeChange",
        0xFF7F => "NumLock",
        0xFFBE..=0xFFD5 => return Some(format!("F{}", symbol - 0xFFBD)),
        0xFFE1 | 0xFFE2 => "Shift",
        0xFFE3 | 0xFFE4 => "Control",
        0xFFE5 | 0xFFE6 => "CapsLock",
        0xFFE7..=0xFFEA => "Alt",
        0xFFEB..=0xFFEE => "Meta",
        0xFFFF | 0xFF9F => "Delete",
        0xFE03 | 0xFE11 => "AltGraph",
        0xFE50..=0xFE93 => "Dead",
        0x1008_FF00..=0x1008_FFFF if !code.is_empty() => code,
        _ => return xkeysym::Keysym::new(symbol).key_char().map(String::from),
    };
    Some(named.to_owned())
}

/// The `key` of a DOM `KeyboardEvent`.
pub fn dom_key(keystroke: &Keystroke) -> String {
    let named = match keystroke.key.as_str() {
        "enter" => "Enter",
        "escape" => "Escape",
        "tab" => "Tab",
        "backspace" => "Backspace",
        "delete" => "Delete",
        "insert" => "Insert",
        "left" => "ArrowLeft",
        "right" => "ArrowRight",
        "up" => "ArrowUp",
        "down" => "ArrowDown",
        "home" => "Home",
        "end" => "End",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "space" => " ",
        "shift" => "Shift",
        "control" => "Control",
        "alt" => "Alt",
        "platform" => "Meta",
        "function" => "Fn",
        "capslock" => "CapsLock",
        "menu" => "ContextMenu",
        key if key.len() > 1 && key.starts_with('f') && key[1..].parse::<u8>().is_ok() => {
            return key.to_uppercase();
        }
        key => {
            return match &keystroke.key_char {
                Some(typed) if !typed.is_empty() && !typed.contains(char::is_control) => {
                    typed.clone()
                }
                _ if key.is_ascii() && key.len() != 1 => "Unidentified".to_owned(),
                _ if keystroke.modifiers.shift => key.to_uppercase(),
                _ => key.to_owned(),
            };
        }
    };
    named.to_owned()
}

/// Shift 1, control 2, alt 4, meta 8.
pub fn modifier_bits(modifiers: &Modifiers) -> u8 {
    u8::from(modifiers.shift)
        | u8::from(modifiers.control) << 1
        | u8::from(modifiers.alt) << 2
        | u8::from(modifiers.platform) << 3
}

pub fn modifiers_from_bits(bits: u64) -> Modifiers {
    Modifiers {
        shift: bits & 1 != 0,
        control: bits & 2 != 0,
        alt: bits & 4 != 0,
        platform: bits & 8 != 0,
        function: false,
    }
}

pub fn button_number(button: MouseButton) -> u8 {
    match button {
        MouseButton::Left => 0,
        MouseButton::Middle => 1,
        MouseButton::Right => 2,
        MouseButton::Navigate(gpui::NavigationDirection::Back) => 3,
        MouseButton::Navigate(gpui::NavigationDirection::Forward) => 4,
    }
}

pub fn button_from_number(number: u64) -> MouseButton {
    match number {
        1 => MouseButton::Middle,
        2 => MouseButton::Right,
        3 => MouseButton::Navigate(gpui::NavigationDirection::Back),
        4 => MouseButton::Navigate(gpui::NavigationDirection::Forward),
        _ => MouseButton::Left,
    }
}

/// `[key, modifierBits]` with GPUI's key names, as `internal/desktop/accelerator.ts` writes them.
#[derive(Clone, PartialEq)]
pub struct Chord {
    key: String,
    modifiers: u8,
}

impl Chord {
    pub fn parse(value: &Value) -> Option<Chord> {
        Some(Chord {
            key: value.get(0)?.as_str()?.to_owned(),
            modifiers: value.get(1)?.as_u64()? as u8,
        })
    }

    pub fn keystroke(&self) -> Keystroke {
        Keystroke {
            modifiers: modifiers_from_bits(self.modifiers.into()),
            key: self.key.clone(),
            key_char: None,
        }
    }
}

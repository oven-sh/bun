//! https://w3c.github.io/uievents/#legacy-key-attributes

use super::IS_MAC;

fn of_name(name: &[u8]) -> Option<u32> {
    Some(match name {
        b"Backspace" => 8,
        b"Tab" => 9,
        b"Enter" | b"NumpadEnter" => 13,
        b"ShiftLeft" | b"ShiftRight" => 16,
        b"ControlLeft" | b"ControlRight" => 17,
        b"AltLeft" | b"AltRight" => 18,
        b"Pause" => 19,
        b"CapsLock" => 20,
        b"Escape" => 27,
        b"Space" => 32,
        b"PageUp" => 33,
        b"PageDown" => 34,
        b"End" => 35,
        b"Home" => 36,
        b"ArrowLeft" => 37,
        b"ArrowUp" => 38,
        b"ArrowRight" => 39,
        b"ArrowDown" => 40,
        b"PrintScreen" => 44,
        b"Insert" => 45,
        b"Delete" => 46,
        b"MetaLeft" => 91,
        b"MetaRight" if !IS_MAC => 92,
        b"MetaRight" | b"ContextMenu" => 93,
        b"NumpadMultiply" => 106,
        b"NumpadAdd" => 107,
        b"NumpadSubtract" => 109,
        b"NumpadDecimal" => 110,
        b"NumpadDivide" => 111,
        b"NumLock" => 144,
        b"ScrollLock" => 145,
        b"Semicolon" => 186,
        b"Equal" => 187,
        b"Comma" => 188,
        b"Minus" => 189,
        b"Period" => 190,
        b"Slash" => 191,
        b"Backquote" => 192,
        b"BracketLeft" => 219,
        b"Backslash" => 220,
        b"BracketRight" => 221,
        b"Quote" => 222,
        b"IntlBackslash" => 226,
        _ => return None,
    })
}

pub(super) fn key_code(key: &[u8], code: &[u8]) -> u32 {
    match (key, code) {
        ([letter], _) if letter.is_ascii_alphabetic() => letter.to_ascii_uppercase().into(),
        (_, [b'K', b'e', b'y', last] | [b'D', b'i', b'g', b'i', b't', last]) => (*last).into(),
        (_, [b'F', number @ ..]) if let Some(number) = bun_core::fmt::parse_ascii::<u8>(number) => {
            111 + u32::from(number)
        }
        ([digit @ b'0'..=b'9'], [b'N', b'u', b'm', b'p', b'a', b'd', b'0'..=b'9']) => {
            96 + u32::from(digit - b'0')
        }
        _ => of_name(key).or_else(|| of_name(code)).unwrap_or(0),
    }
}

//! Translates console input records into the bytes a terminal would send.

/// `INPUT_RECORD` with its union read as `KEY_EVENT_RECORD`.
#[repr(C)]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub struct InputRecord {
    pub event_type: u16,
    pub padding: u16,
    pub is_key_down: i32,
    pub repeat_count: u16,
    pub virtual_key: u16,
    pub scan_code: u16,
    pub character: u16,
    pub control_key_state: u32,
}

const _: () = assert!(size_of::<InputRecord>() == 20);
bun_core::impl_pod!(InputRecord);

pub const KEY_EVENT: u16 = 1;
pub const WINDOW_BUFFER_SIZE_EVENT: u16 = 4;
pub const MENU_EVENT: u16 = 8;

const RIGHT_ALT_PRESSED: u32 = 0x1;
const LEFT_ALT_PRESSED: u32 = 0x2;
const RIGHT_CTRL_PRESSED: u32 = 0x4;
const LEFT_CTRL_PRESSED: u32 = 0x8;
const SHIFT_PRESSED: u32 = 0x10;
const ENHANCED_KEY: u32 = 0x100;

const VK_CLEAR: u16 = 0x0C;
const VK_MENU: u16 = 0x12;
const VK_PRIOR: u16 = 0x21;
const VK_DOWN: u16 = 0x28;
const VK_INSERT: u16 = 0x2D;
const VK_DELETE: u16 = 0x2E;
const VK_NUMPAD0: u16 = 0x60;
const VK_NUMPAD9: u16 = 0x69;
const VK_DECIMAL: u16 = 0x6E;
const VK_F1: u16 = 0x70;
const VK_F12: u16 = 0x7B;

impl InputRecord {
    /// A key press, or an Alt release that carries a character from an Alt code or a paste.
    pub fn is_key_input(&self) -> bool {
        self.event_type == KEY_EVENT
            && (self.is_key_down != 0 || (self.virtual_key == VK_MENU && self.character != 0))
    }

    fn is_alt_code_digit(&self) -> bool {
        self.control_key_state & (LEFT_ALT_PRESSED | ENHANCED_KEY) == LEFT_ALT_PRESSED
            && matches!(
                self.virtual_key,
                VK_CLEAR | VK_PRIOR..=VK_DOWN | VK_INSERT | VK_NUMPAD0..=VK_NUMPAD9
            )
    }
}

// Escape sequences without the leading ESC: unmodified, Shift, Ctrl, Shift+Ctrl.
const INSERT: [&str; 4] = ["[2~", "[2;2~", "[2;5~", "[2;6~"];
const DELETE: [&str; 4] = ["[3~", "[3;2~", "[3;5~", "[3;6~"];
const CLEAR: [&str; 4] = ["[G", "[1;2G", "[1;5G", "[1;6G"];
const PRIOR: [&str; 4] = ["[5~", "[5;2~", "[5;5~", "[5;6~"];
const NEXT: [&str; 4] = ["[6~", "[6;2~", "[6;5~", "[6;6~"];
const END: [&str; 4] = ["[4~", "[4;2~", "[4;5~", "[4;6~"];
const HOME: [&str; 4] = ["[1~", "[1;2~", "[1;5~", "[1;6~"];
const LEFT: [&str; 4] = ["[D", "[1;2D", "[1;5D", "[1;6D"];
const UP: [&str; 4] = ["[A", "[1;2A", "[1;5A", "[1;6A"];
const RIGHT: [&str; 4] = ["[C", "[1;2C", "[1;5C", "[1;6C"];
const DOWN: [&str; 4] = ["[B", "[1;2B", "[1;5B", "[1;6B"];
const NAVIGATION_KEYS: [[&str; 4]; 8] = [PRIOR, NEXT, END, HOME, LEFT, UP, RIGHT, DOWN];
const NUMPAD_KEYS: [[&str; 4]; 10] = [INSERT, END, DOWN, NEXT, LEFT, CLEAR, RIGHT, HOME, UP, PRIOR];
const FUNCTION_KEYS: [[&str; 4]; 12] = [
    ["[[A", "[23~", "[11^", "[23^"],
    ["[[B", "[24~", "[12^", "[24^"],
    ["[[C", "[25~", "[13^", "[25^"],
    ["[[D", "[26~", "[14^", "[26^"],
    ["[[E", "[28~", "[15^", "[28^"],
    ["[17~", "[29~", "[17^", "[29^"],
    ["[18~", "[31~", "[18^", "[31^"],
    ["[19~", "[32~", "[19^", "[32^"],
    ["[20~", "[33~", "[20^", "[33^"],
    ["[21~", "[34~", "[21^", "[34^"],
    ["[23~", "[23$", "[23^", "[23@"],
    ["[24~", "[24$", "[24^", "[24@"],
];

fn find_escape_sequences(virtual_key: u16) -> Option<[&'static str; 4]> {
    Some(match virtual_key {
        VK_CLEAR => CLEAR,
        VK_INSERT => INSERT,
        VK_DELETE | VK_DECIMAL => DELETE,
        VK_PRIOR..=VK_DOWN => NAVIGATION_KEYS[usize::from(virtual_key - VK_PRIOR)],
        VK_NUMPAD0..=VK_NUMPAD9 => NUMPAD_KEYS[usize::from(virtual_key - VK_NUMPAD0)],
        VK_F1..=VK_F12 => FUNCTION_KEYS[usize::from(virtual_key - VK_F1)],
        _ => return None,
    })
}

/// Incremental UTF-16 to UTF-8 decoder.
#[derive(Default)]
pub struct Utf16Decoder {
    high_surrogate: Option<u16>,
}

impl Utf16Decoder {
    pub const fn new() -> Self {
        Self {
            high_surrogate: None,
        }
    }

    pub fn push(&mut self, unit: u16, out: &mut Vec<u8>) {
        let pending_surrogate = self.high_surrogate.take();
        let is_high_surrogate = bun_core::strings::u16_is_lead(unit);
        self.high_surrogate = is_high_surrogate.then_some(unit);
        let units = pending_surrogate
            .into_iter()
            .chain((!is_high_surrogate).then_some(unit));
        for character in char::decode_utf16(units) {
            let character = character.unwrap_or(char::REPLACEMENT_CHARACTER);
            out.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
        }
    }
}

pub fn translate(record: &InputRecord, decoder: &mut Utf16Decoder, out: &mut Vec<u8>) {
    const ESCAPE: u8 = 0x1B;

    if !record.is_key_input() || record.is_alt_code_digit() {
        return;
    }
    let has_alt = record.control_key_state & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED) != 0;
    let has_ctrl = record.control_key_state & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED) != 0;
    let has_shift = record.control_key_state & SHIFT_PRESSED != 0;
    let start = out.len();
    if record.character != 0 {
        decoder.push(record.character, out);
        // Ctrl+Alt is AltGr, which gets no ESC prefix.
        if has_alt && !has_ctrl && record.is_key_down != 0 && out.len() > start {
            out.insert(start, ESCAPE);
        }
    } else if let Some(sequences) = find_escape_sequences(record.virtual_key) {
        if has_alt {
            out.push(ESCAPE);
        }
        out.push(ESCAPE);
        let sequence = sequences[usize::from(has_shift) + 2 * usize::from(has_ctrl)];
        out.extend_from_slice(sequence.as_bytes());
    }
    let end = out.len();
    for _ in 1..record.repeat_count {
        out.extend_from_within(start..end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_down(virtual_key: u16, character: u16, control_key_state: u32) -> InputRecord {
        InputRecord {
            event_type: KEY_EVENT,
            padding: 0,
            is_key_down: 1,
            repeat_count: 1,
            virtual_key,
            scan_code: 1,
            character,
            control_key_state,
        }
    }

    fn translate_all(records: &[InputRecord]) -> Vec<u8> {
        let mut decoder = Utf16Decoder::new();
        let mut out = Vec::new();
        for record in records {
            translate(record, &mut decoder, &mut out);
        }
        out
    }

    fn translate_key(virtual_key: u16, character: u16, control_key_state: u32) -> Vec<u8> {
        translate_all(&[key_down(virtual_key, character, control_key_state)])
    }

    #[test]
    fn translates_character_keys() {
        assert_eq!(translate_key(0x41, 0x61, 0), b"a");
        assert_eq!(translate_key(0, 0x4E2D, 0), "中".as_bytes());
        assert_eq!(translate_key(0x41, 0x61, LEFT_ALT_PRESSED), b"\x1ba");
        assert_eq!(
            translate_key(0x51, 0x40, RIGHT_ALT_PRESSED | LEFT_CTRL_PRESSED),
            b"@"
        );
    }

    #[test]
    fn decodes_surrogates_across_records() {
        let high = key_down(0, 0xD83D, 0);
        let low = key_down(0, 0xDE00, 0);
        assert_eq!(translate_all(&[high, low]), "😀".as_bytes());
        assert_eq!(translate_all(&[high]), b"");
        assert_eq!(translate_all(&[low]), "\u{FFFD}".as_bytes());
        assert_eq!(
            translate_all(&[high, key_down(0, 0x61, 0)]),
            "\u{FFFD}a".as_bytes()
        );
        assert_eq!(translate_all(&[high, high, low]), "\u{FFFD}😀".as_bytes());
    }

    #[test]
    fn ignores_key_up_except_alt_with_character() {
        let to_key_up = |record| InputRecord {
            is_key_down: 0,
            ..record
        };
        assert_eq!(translate_all(&[to_key_up(key_down(0x41, 0x61, 0))]), b"");
        assert_eq!(translate_all(&[to_key_up(key_down(VK_MENU, 0, 0))]), b"");
        assert_eq!(
            translate_all(&[to_key_up(key_down(VK_MENU, 0xE9, LEFT_ALT_PRESSED))]),
            "é".as_bytes()
        );
    }

    #[test]
    fn special_keys_produce_escape_sequences() {
        assert_eq!(translate_key(0x26, 0, ENHANCED_KEY), b"\x1b[A");
        assert_eq!(translate_key(0x24, 0, SHIFT_PRESSED), b"\x1b[1;2~");
        assert_eq!(translate_key(0x27, 0, LEFT_CTRL_PRESSED), b"\x1b[1;5C");
        assert_eq!(
            translate_key(VK_F12, 0, SHIFT_PRESSED | RIGHT_CTRL_PRESSED),
            b"\x1b[24@"
        );
        assert_eq!(translate_key(VK_F1, 0, RIGHT_ALT_PRESSED), b"\x1b\x1b[[A");
        assert_eq!(translate_key(VK_NUMPAD0 + 7, 0, 0), b"\x1b[1~");
        assert_eq!(translate_key(VK_NUMPAD0 + 8, 0, 0), b"\x1b[A");
        assert_eq!(translate_key(0x10, 0, SHIFT_PRESSED), b"");
        assert_eq!(translate_key(0x11, 0, LEFT_CTRL_PRESSED), b"");
    }

    #[test]
    fn ignores_alt_code_digits() {
        assert_eq!(translate_key(VK_NUMPAD0 + 1, 0, LEFT_ALT_PRESSED), b"");
        assert_eq!(translate_key(0x23, 0, LEFT_ALT_PRESSED), b"");
        let end = key_down(0x23, 0, LEFT_ALT_PRESSED | ENHANCED_KEY);
        assert_eq!(translate_all(&[end]), b"\x1b\x1b[4~");
    }

    #[test]
    fn repeat_count_repeats_output() {
        let with_repeat_count = |repeat_count| InputRecord {
            repeat_count,
            ..key_down(0x26, 0, 0)
        };
        assert_eq!(translate_all(&[with_repeat_count(1)]), b"\x1b[A");
        assert_eq!(translate_all(&[with_repeat_count(1000)]).len(), 3000);
        assert_eq!(
            translate_all(&[with_repeat_count(3)]),
            b"\x1b[A\x1b[A\x1b[A"
        );
    }

    #[test]
    fn ignores_non_key_events() {
        let resize = InputRecord {
            event_type: WINDOW_BUFFER_SIZE_EVENT,
            ..key_down(0x41, 0x61, 0)
        };
        assert_eq!(translate_all(&[resize]), b"");
    }
}

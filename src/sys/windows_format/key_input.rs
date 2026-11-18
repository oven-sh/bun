//! The bytes that a terminal would send for the input records of a console.

/// `INPUT_RECORD`, as a `KEY_EVENT_RECORD`.
#[repr(C)]
#[derive(Copy, Clone, Default)]
pub struct InputRecord {
    pub event_type: u16,
    pub is_key_down: i32,
    pub repeat_count: u16,
    pub virtual_key: u16,
    pub scan_code: u16,
    pub character: u16,
    pub control_keys: u32,
}

const _: () = assert!(size_of::<InputRecord>() == 20);

pub const KEY_EVENT: u16 = 1;
pub const WINDOW_BUFFER_SIZE_EVENT: u16 = 4;

const RIGHT_ALT: u32 = 0x1;
const LEFT_ALT: u32 = 0x2;
const RIGHT_CTRL: u32 = 0x4;
const LEFT_CTRL: u32 = 0x8;
const SHIFT: u32 = 0x10;
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
    /// A key that went down, or Alt that went up after a character was typed on the keypad or pasted.
    pub fn is_input(&self) -> bool {
        self.event_type == KEY_EVENT
            && (self.is_key_down != 0 || (self.virtual_key == VK_MENU && self.character != 0))
    }

    fn is_part_of_keypad_character(&self) -> bool {
        self.control_keys & (LEFT_ALT | ENHANCED_KEY) == LEFT_ALT
            && matches!(
                self.virtual_key,
                VK_CLEAR | VK_PRIOR..=VK_DOWN | VK_INSERT | VK_NUMPAD0..=VK_NUMPAD9
            )
    }
}

/// Without a modifier, with Shift, with Ctrl and with both.
type Sequences = [&'static str; 4];

const INSERT: Sequences = ["[2~", "[2;2~", "[2;5~", "[2;6~"];
const DELETE: Sequences = ["[3~", "[3;2~", "[3;5~", "[3;6~"];
const CLEAR: Sequences = ["[G", "[1;2G", "[1;5G", "[1;6G"];
const PRIOR: Sequences = ["[5~", "[5;2~", "[5;5~", "[5;6~"];
const NEXT: Sequences = ["[6~", "[6;2~", "[6;5~", "[6;6~"];
const END: Sequences = ["[4~", "[4;2~", "[4;5~", "[4;6~"];
const HOME: Sequences = ["[1~", "[1;2~", "[1;5~", "[1;6~"];
const LEFT: Sequences = ["[D", "[1;2D", "[1;5D", "[1;6D"];
const UP: Sequences = ["[A", "[1;2A", "[1;5A", "[1;6A"];
const RIGHT: Sequences = ["[C", "[1;2C", "[1;5C", "[1;6C"];
const DOWN: Sequences = ["[B", "[1;2B", "[1;5B", "[1;6B"];
const NAVIGATION: [Sequences; 8] = [PRIOR, NEXT, END, HOME, LEFT, UP, RIGHT, DOWN];
const KEYPAD: [Sequences; 10] = [INSERT, END, DOWN, NEXT, LEFT, CLEAR, RIGHT, HOME, UP, PRIOR];
const FUNCTION: [Sequences; 12] = [
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

fn sequences(virtual_key: u16) -> Option<Sequences> {
    Some(match virtual_key {
        VK_CLEAR => CLEAR,
        VK_INSERT => INSERT,
        VK_DELETE | VK_DECIMAL => DELETE,
        VK_PRIOR..=VK_DOWN => NAVIGATION[usize::from(virtual_key - VK_PRIOR)],
        VK_NUMPAD0..=VK_NUMPAD9 => KEYPAD[usize::from(virtual_key - VK_NUMPAD0)],
        VK_F1..=VK_F12 => FUNCTION[usize::from(virtual_key - VK_F1)],
        _ => return None,
    })
}

/// Space, digits, letters and punctuation, or 0xFF, which stands for no key of the layout.
fn can_type(virtual_key: u16) -> bool {
    matches!(
        virtual_key,
        0x20 | 0x30..=0x39 | 0x41..=0x5A | 0xBA..=0xC2 | 0xDB..=0xDF | 0xE2 | 0xFF
    )
}

/// UTF-16 that comes in pieces, as UTF-8.
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
        let held = self.high_surrogate.take();
        let is_high_surrogate = (0xD800..0xDC00).contains(&unit);
        self.high_surrogate = is_high_surrogate.then_some(unit);
        let units = held.into_iter().chain((!is_high_surrogate).then_some(unit));
        for character in char::decode_utf16(units) {
            let character = character.unwrap_or(char::REPLACEMENT_CHARACTER);
            out.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
        }
    }
}

pub fn translate(record: &InputRecord, decoder: &mut Utf16Decoder, out: &mut Vec<u8>) {
    const ESCAPE: u8 = 0x1B;

    if !record.is_input() || record.is_part_of_keypad_character() {
        return;
    }
    let has_alt = record.control_keys & (LEFT_ALT | RIGHT_ALT) != 0;
    let has_ctrl = record.control_keys & (LEFT_CTRL | RIGHT_CTRL) != 0;
    let has_shift = record.control_keys & SHIFT != 0;
    let start = out.len();
    if record.character != 0 {
        decoder.push(record.character, out);
        // With Ctrl it is AltGr.
        if has_alt && !has_ctrl && record.is_key_down != 0 && out.len() > start {
            out.insert(start, ESCAPE);
        }
    } else if let Some(sequences) = sequences(record.virtual_key) {
        if has_alt {
            out.push(ESCAPE);
        }
        out.push(ESCAPE);
        let sequence = sequences[usize::from(has_shift) + 2 * usize::from(has_ctrl)];
        out.extend_from_slice(sequence.as_bytes());
    } else if has_ctrl && record.scan_code == 0 && can_type(record.virtual_key) {
        // What the console makes of Ctrl+Space.
        out.push(0);
    }
    let end = out.len();
    for _ in 1..record.repeat_count.min(256) {
        out.extend_from_within(start..end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(virtual_key: u16, character: u16, control_keys: u32) -> InputRecord {
        InputRecord {
            event_type: KEY_EVENT,
            is_key_down: 1,
            repeat_count: 1,
            virtual_key,
            scan_code: 1,
            character,
            control_keys,
        }
    }

    fn bytes(records: &[InputRecord]) -> Vec<u8> {
        let (mut decoder, mut out) = (Utf16Decoder::new(), Vec::new());
        for record in records {
            translate(record, &mut decoder, &mut out);
        }
        out
    }

    #[test]
    fn characters() {
        assert_eq!(bytes(&[key(0x41, 0x61, 0)]), b"a");
        assert_eq!(bytes(&[key(0, 0x4E2D, 0)]), "中".as_bytes());
        assert_eq!(bytes(&[key(0x41, 0x61, LEFT_ALT)]), b"\x1ba");
        assert_eq!(bytes(&[key(0x51, 0x40, RIGHT_ALT | LEFT_CTRL)]), b"@");
    }

    #[test]
    fn surrogates() {
        let (high, low) = (key(0, 0xD83D, 0), key(0, 0xDE00, 0));
        assert_eq!(bytes(&[high, low]), "😀".as_bytes());
        assert_eq!(bytes(&[high]), b"");
        assert_eq!(bytes(&[low]), "\u{FFFD}".as_bytes());
        assert_eq!(bytes(&[high, key(0, 0x61, 0)]), "\u{FFFD}a".as_bytes());
        assert_eq!(bytes(&[high, high, low]), "\u{FFFD}😀".as_bytes());
    }

    #[test]
    fn keys_that_go_up() {
        let up = |record| InputRecord {
            is_key_down: 0,
            ..record
        };
        assert_eq!(bytes(&[up(key(0x41, 0x61, 0))]), b"");
        assert_eq!(bytes(&[up(key(VK_MENU, 0, 0))]), b"");
        assert_eq!(bytes(&[up(key(VK_MENU, 0xE9, LEFT_ALT))]), "é".as_bytes());
    }

    #[test]
    fn keys_without_a_character() {
        assert_eq!(bytes(&[key(0x26, 0, ENHANCED_KEY)]), b"\x1b[A");
        assert_eq!(bytes(&[key(0x24, 0, SHIFT)]), b"\x1b[1;2~");
        assert_eq!(bytes(&[key(0x27, 0, LEFT_CTRL)]), b"\x1b[1;5C");
        assert_eq!(bytes(&[key(VK_F12, 0, SHIFT | RIGHT_CTRL)]), b"\x1b[24@");
        assert_eq!(bytes(&[key(VK_F1, 0, RIGHT_ALT)]), b"\x1b\x1b[[A");
        assert_eq!(bytes(&[key(VK_NUMPAD0 + 7, 0, 0)]), b"\x1b[1~");
        assert_eq!(bytes(&[key(VK_NUMPAD0 + 8, 0, 0)]), b"\x1b[A");
        assert_eq!(bytes(&[key(0x10, 0, SHIFT)]), b"");
        assert_eq!(bytes(&[key(0x11, 0, LEFT_CTRL)]), b"");
    }

    #[test]
    fn digits_typed_while_alt_is_held() {
        assert_eq!(bytes(&[key(VK_NUMPAD0 + 1, 0, LEFT_ALT)]), b"");
        assert_eq!(bytes(&[key(0x23, 0, LEFT_ALT)]), b"");
        let end = key(0x23, 0, LEFT_ALT | ENHANCED_KEY);
        assert_eq!(bytes(&[end]), b"\x1b\x1b[4~");
    }

    #[test]
    fn ctrl_space() {
        let record = InputRecord {
            scan_code: 0,
            ..key(0x32, 0, LEFT_CTRL | SHIFT)
        };
        assert_eq!(bytes(&[record]), b"\0");
        for virtual_key in [0x11, 0x14, 0x5B, 0x7C, 0xA2, 0xAF, 0xE5] {
            let other = InputRecord {
                virtual_key,
                ..record
            };
            assert_eq!(bytes(&[other]), b"");
        }
    }

    #[test]
    fn repeats() {
        let times = |repeat_count| InputRecord {
            repeat_count,
            ..key(0x26, 0, 0)
        };
        assert_eq!(bytes(&[times(1)]), b"\x1b[A");
        assert_eq!(bytes(&[times(3)]), b"\x1b[A\x1b[A\x1b[A");
    }

    #[test]
    fn other_records() {
        let size = InputRecord {
            event_type: WINDOW_BUFFER_SIZE_EVENT,
            ..key(0x41, 0x61, 0)
        };
        assert_eq!(bytes(&[size]), b"");
    }
}

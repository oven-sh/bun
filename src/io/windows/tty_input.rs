//! Raw-mode console input: `INPUT_RECORD`s from `ReadConsoleInputW` translated to the byte
//! stream a VT terminal would send. The key mappings and modifier rules are libuv's
//! (`uv_process_tty_read_raw_req` / `get_vt100_fn_key` in `src/win/tty.c`).

use core::mem::MaybeUninit;

use bun_windows_sys::{DWORD, GetLastError, HANDLE, INPUT_RECORD, KEY_EVENT_RECORD, WORD};

use super::sys::GetNumberOfConsoleInputEvents;
use super::tty::is_wake_key;

/// Translation state that must survive between calls: a pending UTF-16 high surrogate.
pub(crate) struct RawInputState {
    /// 0 when none is pending.
    high_surrogate: u16,
}

impl RawInputState {
    pub(crate) const fn new() -> Self {
        Self { high_surrogate: 0 }
    }
}

#[derive(Default, Debug, PartialEq, Eq)]
pub(crate) struct RawInputResult {
    /// A `WINDOW_BUFFER_SIZE_EVENT` record was seen. Its `dwSize` is the screen buffer, not
    /// the window, in a classic console, so the caller re-reads the real size.
    pub resized: bool,
    /// The key that ends a line read was in the queue. It is not input.
    pub wake_key: bool,
}

const BATCH_RECORDS: usize = 128;

/// Drains the console input queue without blocking and appends the translated bytes to `out`.
/// Must be called on the thread that owns `state`. On `Err(GetLastError())`, `out` keeps the
/// bytes translated before the failure.
pub(crate) fn read_raw(
    handle: HANDLE,
    state: &mut RawInputState,
    out: &mut Vec<u8>,
) -> Result<RawInputResult, u32> {
    let mut available: DWORD = 0;
    // SAFETY: `available` is a valid out-pointer; a bad `handle` makes the call fail.
    if unsafe { GetNumberOfConsoleInputEvents(handle, &raw mut available) } == 0 {
        return Err(GetLastError());
    }

    let mut result = RawInputResult::default();
    let mut records = [const { MaybeUninit::<INPUT_RECORD>::uninit() }; BATCH_RECORDS];
    while available > 0 {
        // `ReadConsoleInputW` waits for the first record only, so asking for no more than
        // what is queued returns immediately.
        let want = available.min(BATCH_RECORDS as DWORD);
        let mut read: DWORD = 0;
        // SAFETY: `records` has room for `want` records and `read` is a valid out-pointer.
        let ok = unsafe {
            ffi::ReadConsoleInputW(handle, records.as_mut_ptr().cast(), want, &raw mut read)
        };
        if ok == 0 {
            return Err(GetLastError());
        }
        if read == 0 {
            break;
        }
        // SAFETY: the call initialized the first `read` (<= `want`) records.
        let batch = unsafe { core::slice::from_raw_parts(records.as_ptr().cast(), read as usize) };
        translate_all(state, batch, out, &mut result);
        available = available.saturating_sub(read);
    }
    Ok(result)
}

fn translate_all(
    state: &mut RawInputState,
    records: &[INPUT_RECORD],
    out: &mut Vec<u8>,
    result: &mut RawInputResult,
) {
    for record in records {
        match record.EventType {
            ffi::WINDOW_BUFFER_SIZE_EVENT => result.resized = true,
            ffi::KEY_EVENT => {
                // SAFETY: `EventType == KEY_EVENT` selects the `KeyEvent` member.
                let key = unsafe { &record.Event.KeyEvent };
                if is_wake_key(key) {
                    result.wake_key = true;
                } else {
                    translate_key(state, key, out);
                }
            }
            _ => {}
        }
    }
}

fn translate_key(state: &mut RawInputState, key: &KEY_EVENT_RECORD, out: &mut Vec<u8>) {
    // SAFETY: both members of the union are plain integers; `ReadConsoleInputW` fills the
    // UTF-16 one.
    let unit = unsafe { key.uChar.UnicodeChar };
    let key_down = key.bKeyDown != 0;
    let vk = key.wVirtualKeyCode;
    let modifiers = key.dwControlKeyState;
    let alt = modifiers & (ffi::LEFT_ALT_PRESSED | ffi::RIGHT_ALT_PRESSED) != 0;
    let ctrl = modifiers & (ffi::LEFT_CTRL_PRESSED | ffi::RIGHT_CTRL_PRESSED) != 0;

    // A character composed with Alt+numpad is delivered on the key-up of Alt, and so is a
    // non-BMP character that arrives through a pseudoconsole. Every other key-up is dropped.
    if !key_down && (vk != ffi::VK_MENU || unit == 0) {
        return;
    }

    // Numpad keys pressed while left Alt is held are the digits of an Alt+numpad composition
    // (the navigation cluster sets ENHANCED_KEY; the numpad with NumLock off does not).
    if modifiers & ffi::LEFT_ALT_PRESSED != 0
        && modifiers & ffi::ENHANCED_KEY == 0
        && matches!(
            vk,
            ffi::VK_INSERT
                | ffi::VK_END
                | ffi::VK_DOWN
                | ffi::VK_NEXT
                | ffi::VK_LEFT
                | ffi::VK_CLEAR
                | ffi::VK_RIGHT
                | ffi::VK_HOME
                | ffi::VK_UP
                | ffi::VK_PRIOR
                | ffi::VK_NUMPAD0..=ffi::VK_NUMPAD9
        )
    {
        return;
    }

    let start = out.len();
    if unit != 0 {
        if (0xD800..0xDC00).contains(&unit) {
            state.high_surrogate = unit;
            return;
        }
        // AltGr reports as Ctrl+Alt and must not get the prefix; neither must the key-up of
        // Alt that ends a composition.
        if alt && !ctrl && key_down {
            out.push(ESC);
        }
        let high = core::mem::take(&mut state.high_surrogate);
        if high == 0 {
            push_wtf8(out, u32::from(unit));
        } else if (0xDC00..0xE000).contains(&unit) {
            push_wtf8(
                out,
                0x10000 + ((u32::from(high) - 0xD800) << 10) + (u32::from(unit) - 0xDC00),
            );
        } else {
            push_wtf8(out, u32::from(high));
            push_wtf8(out, u32::from(unit));
        }
    } else {
        let Some(sequence) = vt100_fn_key(vk, modifiers & ffi::SHIFT_PRESSED != 0, ctrl) else {
            return;
        };
        if alt {
            out.push(ESC);
        }
        out.extend_from_slice(sequence);
    }

    let end = out.len();
    for _ in 1..key.wRepeatCount {
        out.extend_from_within(start..end);
    }
}

const ESC: u8 = 0x1B;

/// Generalized UTF-8: a surrogate code point is encoded as its own three-byte sequence.
fn push_wtf8(out: &mut Vec<u8>, code_point: u32) {
    let mut bytes = [0u8; 4];
    let len = bun_core::strings::encode_wtf8_rune(&mut bytes, code_point);
    out.extend_from_slice(&bytes[..len]);
}

/// The same mappings as Cygwin: unmodified keypad keys follow the Linux console, modifiers
/// follow xterm, F1-F12 and Shift+F1-F10 follow the Linux console, F6-F12 with and without
/// modifiers follow rxvt.
fn vt100_fn_key(vk: WORD, shift: bool, ctrl: bool) -> Option<&'static [u8]> {
    let column = usize::from(shift) | usize::from(ctrl) << 1;
    macro_rules! row {
        ($normal:literal, $shift:literal, $ctrl:literal, $shift_ctrl:literal) => {
            [
                concat!("\x1b", $normal),
                concat!("\x1b", $shift),
                concat!("\x1b", $ctrl),
                concat!("\x1b", $shift_ctrl),
            ][column]
        };
    }
    let sequence: &'static str = match vk {
        ffi::VK_INSERT | ffi::VK_NUMPAD0 => row!("[2~", "[2;2~", "[2;5~", "[2;6~"),
        ffi::VK_END | ffi::VK_NUMPAD1 => row!("[4~", "[4;2~", "[4;5~", "[4;6~"),
        ffi::VK_DOWN | ffi::VK_NUMPAD2 => row!("[B", "[1;2B", "[1;5B", "[1;6B"),
        ffi::VK_NEXT | ffi::VK_NUMPAD3 => row!("[6~", "[6;2~", "[6;5~", "[6;6~"),
        ffi::VK_LEFT | ffi::VK_NUMPAD4 => row!("[D", "[1;2D", "[1;5D", "[1;6D"),
        ffi::VK_CLEAR | ffi::VK_NUMPAD5 => row!("[G", "[1;2G", "[1;5G", "[1;6G"),
        ffi::VK_RIGHT | ffi::VK_NUMPAD6 => row!("[C", "[1;2C", "[1;5C", "[1;6C"),
        ffi::VK_UP | ffi::VK_NUMPAD7 => row!("[A", "[1;2A", "[1;5A", "[1;6A"),
        ffi::VK_HOME | ffi::VK_NUMPAD8 => row!("[1~", "[1;2~", "[1;5~", "[1;6~"),
        ffi::VK_PRIOR | ffi::VK_NUMPAD9 => row!("[5~", "[5;2~", "[5;5~", "[5;6~"),
        ffi::VK_DELETE | ffi::VK_DECIMAL => row!("[3~", "[3;2~", "[3;5~", "[3;6~"),
        ffi::VK_F1 => row!("[[A", "[23~", "[11^", "[23^"),
        ffi::VK_F2 => row!("[[B", "[24~", "[12^", "[24^"),
        ffi::VK_F3 => row!("[[C", "[25~", "[13^", "[25^"),
        ffi::VK_F4 => row!("[[D", "[26~", "[14^", "[26^"),
        ffi::VK_F5 => row!("[[E", "[28~", "[15^", "[28^"),
        ffi::VK_F6 => row!("[17~", "[29~", "[17^", "[29^"),
        ffi::VK_F7 => row!("[18~", "[31~", "[18^", "[31^"),
        ffi::VK_F8 => row!("[19~", "[32~", "[19^", "[32^"),
        ffi::VK_F9 => row!("[20~", "[33~", "[20^", "[33^"),
        ffi::VK_F10 => row!("[21~", "[34~", "[21^", "[34^"),
        ffi::VK_F11 => row!("[23~", "[23$", "[23^", "[23@"),
        ffi::VK_F12 => row!("[24~", "[24$", "[24^", "[24@"),
        _ => return None,
    };
    Some(sequence.as_bytes())
}

mod ffi {
    use bun_windows_sys::{BOOL, DWORD, HANDLE, INPUT_RECORD, WORD};

    // `INPUT_RECORD::EventType`
    pub(super) const KEY_EVENT: WORD = 0x0001;
    pub(super) const WINDOW_BUFFER_SIZE_EVENT: WORD = 0x0004;

    // `KEY_EVENT_RECORD::dwControlKeyState`
    pub(super) const RIGHT_ALT_PRESSED: DWORD = 0x0001;
    pub(super) const LEFT_ALT_PRESSED: DWORD = 0x0002;
    pub(super) const RIGHT_CTRL_PRESSED: DWORD = 0x0004;
    pub(super) const LEFT_CTRL_PRESSED: DWORD = 0x0008;
    pub(super) const SHIFT_PRESSED: DWORD = 0x0010;
    pub(super) const ENHANCED_KEY: DWORD = 0x0100;

    pub(super) const VK_CLEAR: WORD = 0x0C;
    pub(super) const VK_MENU: WORD = 0x12;
    pub(super) const VK_PRIOR: WORD = 0x21;
    pub(super) const VK_NEXT: WORD = 0x22;
    pub(super) const VK_END: WORD = 0x23;
    pub(super) const VK_HOME: WORD = 0x24;
    pub(super) const VK_LEFT: WORD = 0x25;
    pub(super) const VK_UP: WORD = 0x26;
    pub(super) const VK_RIGHT: WORD = 0x27;
    pub(super) const VK_DOWN: WORD = 0x28;
    pub(super) const VK_INSERT: WORD = 0x2D;
    pub(super) const VK_DELETE: WORD = 0x2E;
    pub(super) const VK_NUMPAD0: WORD = 0x60;
    pub(super) const VK_NUMPAD1: WORD = 0x61;
    pub(super) const VK_NUMPAD2: WORD = 0x62;
    pub(super) const VK_NUMPAD3: WORD = 0x63;
    pub(super) const VK_NUMPAD4: WORD = 0x64;
    pub(super) const VK_NUMPAD5: WORD = 0x65;
    pub(super) const VK_NUMPAD6: WORD = 0x66;
    pub(super) const VK_NUMPAD7: WORD = 0x67;
    pub(super) const VK_NUMPAD8: WORD = 0x68;
    pub(super) const VK_NUMPAD9: WORD = 0x69;
    pub(super) const VK_DECIMAL: WORD = 0x6E;
    pub(super) const VK_F1: WORD = 0x70;
    pub(super) const VK_F2: WORD = 0x71;
    pub(super) const VK_F3: WORD = 0x72;
    pub(super) const VK_F4: WORD = 0x73;
    pub(super) const VK_F5: WORD = 0x74;
    pub(super) const VK_F6: WORD = 0x75;
    pub(super) const VK_F7: WORD = 0x76;
    pub(super) const VK_F8: WORD = 0x77;
    pub(super) const VK_F9: WORD = 0x78;
    pub(super) const VK_F10: WORD = 0x79;
    pub(super) const VK_F11: WORD = 0x7A;
    pub(super) const VK_F12: WORD = 0x7B;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub(super) fn ReadConsoleInputW(
            hConsoleInput: HANDLE,
            lpBuffer: *mut INPUT_RECORD,
            nLength: DWORD,
            lpNumberOfEventsRead: *mut DWORD,
        ) -> BOOL;
    }
}

#[cfg(test)]
mod tests {
    use bun_windows_sys::{
        COORD, INPUT_RECORD_Event, KEY_EVENT_RECORD_uChar, WINDOW_BUFFER_SIZE_EVENT,
    };

    use super::*;

    const ALT_L: DWORD = ffi::LEFT_ALT_PRESSED;
    const ALT_R: DWORD = ffi::RIGHT_ALT_PRESSED;
    const CTRL_L: DWORD = ffi::LEFT_CTRL_PRESSED;
    const CTRL_R: DWORD = ffi::RIGHT_CTRL_PRESSED;
    const SHIFT: DWORD = ffi::SHIFT_PRESSED;

    fn key_record(down: bool, repeat: WORD, vk: WORD, unit: u16, modifiers: DWORD) -> INPUT_RECORD {
        INPUT_RECORD {
            EventType: ffi::KEY_EVENT,
            Event: INPUT_RECORD_Event {
                KeyEvent: KEY_EVENT_RECORD {
                    bKeyDown: down.into(),
                    wRepeatCount: repeat,
                    wVirtualKeyCode: vk,
                    wVirtualScanCode: 0,
                    uChar: KEY_EVENT_RECORD_uChar { UnicodeChar: unit },
                    dwControlKeyState: modifiers,
                },
            },
        }
    }

    fn char_down(unit: u16, modifiers: DWORD) -> INPUT_RECORD {
        key_record(true, 1, 0, unit, modifiers)
    }

    fn fn_down(vk: WORD, modifiers: DWORD) -> INPUT_RECORD {
        key_record(true, 1, vk, 0, modifiers)
    }

    fn resize_record() -> INPUT_RECORD {
        INPUT_RECORD {
            EventType: ffi::WINDOW_BUFFER_SIZE_EVENT,
            Event: INPUT_RECORD_Event {
                WindowBufferSizeEvent: WINDOW_BUFFER_SIZE_EVENT {
                    dwSize: COORD { X: 120, Y: 30 },
                },
            },
        }
    }

    fn other_record(event_type: WORD) -> INPUT_RECORD {
        INPUT_RECORD {
            EventType: event_type,
            ..key_record(true, 1, ffi::VK_UP, u16::from(b'x'), 0)
        }
    }

    fn run(records: &[INPUT_RECORD]) -> (Vec<u8>, bool) {
        let mut state = RawInputState::new();
        let mut out = Vec::new();
        let mut result = RawInputResult::default();
        translate_all(&mut state, records, &mut out, &mut result);
        (out, result.resized)
    }

    fn bytes(records: &[INPUT_RECORD]) -> Vec<u8> {
        run(records).0
    }

    #[test]
    fn plain_characters() {
        assert_eq!(bytes(&[char_down(u16::from(b'a'), 0)]), b"a");
        assert_eq!(bytes(&[char_down(0x0D, 0)]), b"\r");
        // Ctrl+C
        assert_eq!(bytes(&[char_down(0x03, CTRL_L)]), b"\x03");
        assert_eq!(bytes(&[char_down(0xE9, 0)]), "é".as_bytes());
        assert_eq!(bytes(&[char_down(0x20AC, 0)]), "€".as_bytes());
        assert_eq!(
            bytes(&[
                char_down(u16::from(b'h'), SHIFT),
                char_down(u16::from(b'i'), 0)
            ]),
            b"hi"
        );
    }

    #[test]
    fn alt_prefixes_escape() {
        assert_eq!(bytes(&[char_down(u16::from(b'x'), ALT_L)]), b"\x1bx");
        assert_eq!(bytes(&[char_down(u16::from(b'x'), ALT_R)]), b"\x1bx");
        assert_eq!(bytes(&[char_down(0xE9, ALT_L | SHIFT)]), "\x1bé".as_bytes());
    }

    #[test]
    fn altgr_is_not_prefixed() {
        assert_eq!(bytes(&[char_down(0x20AC, ALT_R | CTRL_L)]), "€".as_bytes());
        assert_eq!(bytes(&[char_down(u16::from(b'@'), ALT_L | CTRL_R)]), b"@");
    }

    #[test]
    fn surrogate_pair_across_records() {
        // U+1F600
        assert_eq!(
            bytes(&[char_down(0xD83D, 0), char_down(0xDE00, 0)]),
            "😀".as_bytes()
        );
        assert_eq!(
            bytes(&[char_down(0xD83D, ALT_L), char_down(0xDE00, ALT_L)]),
            "\x1b😀".as_bytes()
        );
        // Unrelated records between the halves do not disturb the pending unit.
        assert_eq!(
            bytes(&[
                char_down(0xD83D, 0),
                key_record(false, 1, 0, 0xD83D, 0),
                resize_record(),
                char_down(0xDE00, 0),
            ]),
            "😀".as_bytes()
        );
    }

    #[test]
    fn surrogate_pair_across_calls() {
        let mut state = RawInputState::new();
        let mut result = RawInputResult::default();
        let mut first = Vec::new();
        translate_all(&mut state, &[char_down(0xD83D, 0)], &mut first, &mut result);
        assert!(first.is_empty());

        let mut second = Vec::new();
        translate_all(
            &mut state,
            &[char_down(0xDE00, 0)],
            &mut second,
            &mut result,
        );
        assert_eq!(second, "😀".as_bytes());

        // The pending unit was consumed.
        let mut third = Vec::new();
        translate_all(
            &mut state,
            &[char_down(u16::from(b'a'), 0)],
            &mut third,
            &mut result,
        );
        assert_eq!(third, b"a");
        assert_eq!(result, RawInputResult::default());
    }

    #[test]
    fn lone_surrogates_are_wtf8() {
        assert_eq!(bytes(&[char_down(0xDE00, 0)]), [0xED, 0xB8, 0x80]);
        assert_eq!(
            bytes(&[char_down(0xD83D, 0), char_down(u16::from(b'a'), 0)]),
            [0xED, 0xA0, 0xBD, b'a']
        );
        // A second high surrogate replaces the pending one.
        assert_eq!(
            bytes(&[
                char_down(0xD83C, 0),
                char_down(0xD83D, 0),
                char_down(0xDE00, 0)
            ]),
            "😀".as_bytes()
        );
    }

    #[test]
    fn alt_key_up_with_character() {
        assert_eq!(
            bytes(&[key_record(false, 1, ffi::VK_MENU, 0xE9, 0)]),
            "é".as_bytes()
        );
        // The key-up carries no prefix even though Alt is still reported.
        assert_eq!(
            bytes(&[key_record(false, 1, ffi::VK_MENU, 0xE9, ALT_L)]),
            "é".as_bytes()
        );
        assert_eq!(
            bytes(&[
                key_record(false, 1, ffi::VK_MENU, 0xD83D, 0),
                key_record(false, 1, ffi::VK_MENU, 0xDE00, 0),
            ]),
            "😀".as_bytes()
        );
        assert_eq!(bytes(&[key_record(false, 1, ffi::VK_MENU, 0, 0)]), b"");
    }

    #[test]
    fn key_up_is_ignored() {
        assert_eq!(
            bytes(&[key_record(false, 1, 0x41, u16::from(b'a'), 0)]),
            b""
        );
        assert_eq!(bytes(&[key_record(false, 1, ffi::VK_UP, 0, 0)]), b"");
        assert_eq!(bytes(&[key_record(false, 1, ffi::VK_F1, 0, SHIFT)]), b"");
    }

    #[test]
    fn arrow_keys() {
        for (vk, letter) in [
            (ffi::VK_UP, 'A'),
            (ffi::VK_DOWN, 'B'),
            (ffi::VK_RIGHT, 'C'),
            (ffi::VK_LEFT, 'D'),
        ] {
            let enhanced = ffi::ENHANCED_KEY;
            assert_eq!(
                bytes(&[fn_down(vk, enhanced)]),
                format!("\x1b[{letter}").into_bytes()
            );
            assert_eq!(
                bytes(&[fn_down(vk, enhanced | SHIFT)]),
                format!("\x1b[1;2{letter}").into_bytes()
            );
            assert_eq!(
                bytes(&[fn_down(vk, enhanced | CTRL_L)]),
                format!("\x1b[1;5{letter}").into_bytes()
            );
            assert_eq!(
                bytes(&[fn_down(vk, enhanced | CTRL_R)]),
                format!("\x1b[1;5{letter}").into_bytes()
            );
            assert_eq!(
                bytes(&[fn_down(vk, enhanced | SHIFT | CTRL_L)]),
                format!("\x1b[1;6{letter}").into_bytes()
            );
        }
    }

    #[test]
    fn alt_prefixes_function_keys() {
        assert_eq!(
            bytes(&[fn_down(ffi::VK_UP, ffi::ENHANCED_KEY | ALT_L)]),
            b"\x1b\x1b[A"
        );
        assert_eq!(bytes(&[fn_down(ffi::VK_F1, ALT_R)]), b"\x1b\x1b[[A");
        // Unlike a character key, Ctrl does not suppress the prefix.
        assert_eq!(
            bytes(&[fn_down(ffi::VK_DELETE, ffi::ENHANCED_KEY | ALT_L | CTRL_L)]),
            b"\x1b\x1b[3;5~"
        );
    }

    #[test]
    fn navigation_and_numpad_keys() {
        let rows: [(WORD, WORD, &str); 11] = [
            (ffi::VK_INSERT, ffi::VK_NUMPAD0, "[2~"),
            (ffi::VK_END, ffi::VK_NUMPAD1, "[4~"),
            (ffi::VK_DOWN, ffi::VK_NUMPAD2, "[B"),
            (ffi::VK_NEXT, ffi::VK_NUMPAD3, "[6~"),
            (ffi::VK_LEFT, ffi::VK_NUMPAD4, "[D"),
            (ffi::VK_CLEAR, ffi::VK_NUMPAD5, "[G"),
            (ffi::VK_RIGHT, ffi::VK_NUMPAD6, "[C"),
            (ffi::VK_UP, ffi::VK_NUMPAD7, "[A"),
            (ffi::VK_HOME, ffi::VK_NUMPAD8, "[1~"),
            (ffi::VK_PRIOR, ffi::VK_NUMPAD9, "[5~"),
            (ffi::VK_DELETE, ffi::VK_DECIMAL, "[3~"),
        ];
        for (navigation, numpad, sequence) in rows {
            let expected = format!("\x1b{sequence}").into_bytes();
            assert_eq!(bytes(&[fn_down(navigation, 0)]), expected);
            assert_eq!(bytes(&[fn_down(numpad, 0)]), expected);
        }
        assert_eq!(bytes(&[fn_down(ffi::VK_HOME, SHIFT)]), b"\x1b[1;2~");
        assert_eq!(bytes(&[fn_down(ffi::VK_END, CTRL_L)]), b"\x1b[4;5~");
        assert_eq!(
            bytes(&[fn_down(ffi::VK_PRIOR, SHIFT | CTRL_R)]),
            b"\x1b[5;6~"
        );
        assert_eq!(
            bytes(&[fn_down(ffi::VK_CLEAR, SHIFT | CTRL_L)]),
            b"\x1b[1;6G"
        );
    }

    #[test]
    fn function_keys() {
        let rows: [(WORD, [&str; 4]); 12] = [
            (ffi::VK_F1, ["[[A", "[23~", "[11^", "[23^"]),
            (ffi::VK_F2, ["[[B", "[24~", "[12^", "[24^"]),
            (ffi::VK_F3, ["[[C", "[25~", "[13^", "[25^"]),
            (ffi::VK_F4, ["[[D", "[26~", "[14^", "[26^"]),
            (ffi::VK_F5, ["[[E", "[28~", "[15^", "[28^"]),
            (ffi::VK_F6, ["[17~", "[29~", "[17^", "[29^"]),
            (ffi::VK_F7, ["[18~", "[31~", "[18^", "[31^"]),
            (ffi::VK_F8, ["[19~", "[32~", "[19^", "[32^"]),
            (ffi::VK_F9, ["[20~", "[33~", "[20^", "[33^"]),
            (ffi::VK_F10, ["[21~", "[34~", "[21^", "[34^"]),
            (ffi::VK_F11, ["[23~", "[23$", "[23^", "[23@"]),
            (ffi::VK_F12, ["[24~", "[24$", "[24^", "[24@"]),
        ];
        for (vk, [normal, shift, ctrl, shift_ctrl]) in rows {
            for (modifiers, sequence) in [
                (0, normal),
                (SHIFT, shift),
                (CTRL_L, ctrl),
                (CTRL_R, ctrl),
                (SHIFT | CTRL_L, shift_ctrl),
            ] {
                assert_eq!(
                    bytes(&[fn_down(vk, modifiers)]),
                    format!("\x1b{sequence}").into_bytes()
                );
            }
        }
    }

    #[test]
    fn unmapped_keys_are_dropped() {
        // VK_SHIFT, VK_CONTROL, VK_MENU, VK_CAPITAL, VK_F13
        for vk in [0x10, 0x11, ffi::VK_MENU, 0x14, 0x7C] {
            assert_eq!(bytes(&[fn_down(vk, 0)]), b"");
            assert_eq!(bytes(&[fn_down(vk, ALT_L)]), b"");
        }
    }

    #[test]
    fn repeat_count() {
        assert_eq!(
            bytes(&[key_record(true, 3, 0x41, u16::from(b'a'), 0)]),
            b"aaa"
        );
        assert_eq!(
            bytes(&[key_record(true, 0, 0x41, u16::from(b'a'), 0)]),
            b"a"
        );
        assert_eq!(
            bytes(&[key_record(true, 2, 0x41, u16::from(b'a'), ALT_L)]),
            b"\x1ba\x1ba"
        );
        assert_eq!(
            bytes(&[key_record(true, 2, ffi::VK_LEFT, 0, ffi::ENHANCED_KEY)]),
            b"\x1b[D\x1b[D"
        );
        assert_eq!(
            bytes(&[char_down(0xD83D, 0), key_record(true, 2, 0, 0xDE00, 0)]),
            "😀😀".as_bytes()
        );
        // Earlier output is not replayed.
        assert_eq!(
            bytes(&[
                char_down(u16::from(b'x'), 0),
                key_record(true, 2, 0x41, u16::from(b'a'), 0)
            ]),
            b"xaa"
        );
    }

    #[test]
    fn numpad_composition_with_left_alt_is_ignored() {
        let composing = [
            ffi::VK_INSERT,
            ffi::VK_END,
            ffi::VK_DOWN,
            ffi::VK_NEXT,
            ffi::VK_LEFT,
            ffi::VK_CLEAR,
            ffi::VK_RIGHT,
            ffi::VK_HOME,
            ffi::VK_UP,
            ffi::VK_PRIOR,
            ffi::VK_NUMPAD0,
            ffi::VK_NUMPAD1,
            ffi::VK_NUMPAD2,
            ffi::VK_NUMPAD3,
            ffi::VK_NUMPAD4,
            ffi::VK_NUMPAD5,
            ffi::VK_NUMPAD6,
            ffi::VK_NUMPAD7,
            ffi::VK_NUMPAD8,
            ffi::VK_NUMPAD9,
        ];
        for vk in composing {
            assert_eq!(bytes(&[fn_down(vk, ALT_L)]), b"");
            // With NumLock on the digit itself is reported; it is part of the composition too.
            assert_eq!(
                bytes(&[key_record(true, 1, vk, u16::from(b'1'), ALT_L)]),
                b""
            );
            assert_ne!(bytes(&[fn_down(vk, ALT_R)]), b"");
            assert_ne!(bytes(&[fn_down(vk, ALT_L | ffi::ENHANCED_KEY)]), b"");
        }
        assert_eq!(bytes(&[fn_down(ffi::VK_DELETE, ALT_L)]), b"\x1b\x1b[3~");
        assert_eq!(bytes(&[fn_down(ffi::VK_DECIMAL, ALT_L)]), b"\x1b\x1b[3~");
    }

    #[test]
    fn non_key_records() {
        assert_eq!(run(&[resize_record()]), (Vec::new(), true));
        // MOUSE_EVENT, MENU_EVENT, FOCUS_EVENT
        for event_type in [0x0002, 0x0008, 0x0010] {
            assert_eq!(run(&[other_record(event_type)]), (Vec::new(), false));
        }
        assert_eq!(
            run(&[
                char_down(u16::from(b'a'), 0),
                resize_record(),
                other_record(0x0010),
                char_down(u16::from(b'b'), 0),
            ]),
            (b"ab".to_vec(), true)
        );
    }

    #[test]
    fn the_wake_key_is_not_input() {
        let mut state = RawInputState::new();
        let mut out = Vec::new();
        let mut result = RawInputResult::default();
        translate_all(
            &mut state,
            &[
                char_down(u16::from(b'a'), 0),
                super::super::tty::wake_record(),
                // Ctrl+] as a keyboard sends it.
                key_record(true, 1, 0xDD, 0x1D, CTRL_L),
                char_down(u16::from(b'b'), 0),
            ],
            &mut out,
            &mut result,
        );
        assert_eq!(out, b"a\x1db");
        assert_eq!(
            result,
            RawInputResult {
                resized: false,
                wake_key: true
            }
        );
    }

    #[test]
    fn read_raw_reports_the_os_error() {
        let mut state = RawInputState::new();
        let mut out = Vec::new();
        const ERROR_INVALID_HANDLE: u32 = 6;
        assert_eq!(
            read_raw(core::ptr::null_mut(), &mut state, &mut out).map(|result| result.resized),
            Err(ERROR_INVALID_HANDLE)
        );
        assert!(out.is_empty());
    }
}

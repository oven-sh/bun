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

#[derive(Default)]
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

    pub(super) use bun_windows_sys::{KEY_EVENT, LEFT_CTRL_PRESSED};

    // `INPUT_RECORD::EventType`
    pub(super) const WINDOW_BUFFER_SIZE_EVENT: WORD = 0x0004;

    // `KEY_EVENT_RECORD::dwControlKeyState`
    pub(super) const RIGHT_ALT_PRESSED: DWORD = 0x0001;
    pub(super) const LEFT_ALT_PRESSED: DWORD = 0x0002;
    pub(super) const RIGHT_CTRL_PRESSED: DWORD = 0x0004;
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

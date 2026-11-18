use std::cell::{Cell, RefCell};

use super::window::Window;
use crate::input::{self, TextInput};
use crate::keys::{DEAD, JAPANESE, NAMED, name_of_virtual_key};
use crate::platform::{Modifiers, RawKey};
use crate::protocol::{self, Chord};
use crate::win32::*;

thread_local! {
    static IS_ALT_GRAPH_DOWN: Cell<bool> = const { Cell::new(false) };
    static DEAD_KEY: Cell<u32> = const { Cell::new(0) };
    /// The scan codes of the keys that the input method took, and whether it gave them back.
    static TAKEN: RefCell<Vec<(u32, bool)>> = const { RefCell::new(Vec::new()) };
    static FIRST_HALF: Cell<Option<u16>> = const { Cell::new(None) };
}

fn is_down(key: u32) -> bool {
    GetKeyState(key) < 0
}

pub fn modifiers() -> Modifiers {
    let is_alt_graph = IS_ALT_GRAPH_DOWN.get() && is_down(VK_RMENU);
    let bits = [
        is_down(VK_SHIFT),
        is_down(if is_alt_graph {
            VK_RCONTROL
        } else {
            VK_CONTROL
        }),
        is_down(if is_alt_graph { VK_LMENU } else { VK_MENU }),
        is_down(VK_LWIN) || is_down(VK_RWIN),
        is_alt_graph,
        GetKeyState(VK_CAPITAL) & 1 != 0,
    ];
    (0..)
        .zip(bits)
        .fold(0, |all, (bit, is_set)| all | u8::from(is_set) << bit)
}

/// Unless a modifier makes a shortcut of it. And whether Control and Alt stand in for AltGr.
fn character(key: u32, scan_code: u32) -> (Option<u32>, bool) {
    const KEEPS_STATE: u32 = 4;
    let (mut state, mut units) = ([0; 256], [0; 8]);
    GetKeyboardState(&mut state);
    let mut translate = |state: &[u8; 256]| {
        // SAFETY: the buffer with its length.
        let count = unsafe {
            ToUnicodeEx(
                key,
                scan_code,
                state,
                units.as_mut_ptr(),
                units.len() as i32,
                KEEPS_STATE,
                GetKeyboardLayout(0),
            )
        };
        let first = char::decode_utf16(units[..count.max(0) as usize].iter().copied())
            .next()
            .and_then(Result::ok);
        if count < 0 {
            Some(DEAD)
        } else {
            first.filter(|it| !it.is_control()).map(u32::from)
        }
    };
    let with_both = (is_down(VK_CONTROL) && is_down(VK_MENU))
        .then(|| translate(&state))
        .flatten();
    if with_both.is_some() {
        return (with_both, true);
    }
    [
        VK_CONTROL,
        VK_LCONTROL,
        VK_RCONTROL,
        VK_MENU,
        VK_LMENU,
        VK_RMENU,
    ]
    .into_iter()
    .for_each(|it| state[it as usize] = 0);
    (translate(&state), false)
}

pub fn peek(window: Handle, first: u32, last: u32, how: u32) -> Option<Msg> {
    let mut message = Msg::default();
    (PeekMessageW(&mut message, window, first, last, how) != 0).then_some(message)
}

const IS_EXTENDED: isize = 1 << 24;
const WAS_DOWN: isize = 1 << 30;

/// The system sends it along with AltGr.
fn is_made_up(window: Handle, key: u32, l: isize) -> bool {
    let is_right_alt = |it: Msg| {
        (it.w_param, it.time) == (VK_MENU as usize, GetMessageTime() as u32)
            && it.l_param & IS_EXTENDED != 0
    };
    key == VK_CONTROL
        && l & IS_EXTENDED == 0
        && peek(window, WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE).is_some_and(is_right_alt)
}

pub fn forget_keys() {
    TAKEN.take();
}

impl Window {
    /// Returns whether the system has a use for it.
    pub fn key(&self, down: bool, key: u32, l: isize) -> bool {
        if is_made_up(self.handle, key, l) {
            IS_ALT_GRAPH_DOWN.set(true);
            return false;
        }
        let scan_code = match (l >> 16 & 0xFF) as u32 {
            _ if key == VK_PACKET => 0,
            0 => MapVirtualKeyExW(key, MAPVK_VK_TO_VSC_EX, GetKeyboardLayout(0)),
            code => code | if l & IS_EXTENDED != 0 { 0xE000 } else { 0 },
        };
        let known = TAKEN.with_borrow(|it| it.iter().position(|it| it.0 == scan_code));
        let mut is_repeat = down && l & WAS_DOWN != 0;
        match known {
            None if down && key == VK_PROCESSKEY => match ImmGetVirtualKey(self.handle) {
                VK_HANGUL | VK_HANJA => return false,
                _ => TAKEN.with_borrow_mut(|it| it.push((scan_code, false))),
            },
            Some(at) if down && key != VK_PROCESSKEY => {
                is_repeat &= TAKEN.with_borrow_mut(|it| std::mem::replace(&mut it[at].1, true))
            }
            Some(at) if !down => {
                input::raw_key(RawKey {
                    down,
                    is_repeat,
                    scan_code,
                    symbol: NAMED | VK_PROCESSKEY,
                    key_code: VK_PROCESSKEY as u8,
                    modifiers: modifiers(),
                });
                input::report_key_taken_by_ime();
                if !TAKEN.with_borrow_mut(|it| it.swap_remove(at).1) {
                    return false;
                }
            }
            _ => {}
        }
        let (mut typed, mut is_dead, mut opens_menu) =
            (Vec::new(), !down && DEAD_KEY.get() == key, false);
        let next = || {
            peek(self.handle, WM_CHAR, WM_DEADCHAR, PM_REMOVE)
                .or_else(|| peek(self.handle, WM_SYSCHAR, WM_SYSDEADCHAR, PM_REMOVE))
        };
        for message in std::iter::from_fn(next).take(if down { 16 } else { 0 }) {
            match message.message {
                WM_CHAR => typed.push(message.w_param as u16),
                WM_SYSCHAR => opens_menu = message.w_param == usize::from(b' '),
                _ => is_dead = true,
            }
        }
        if key == VK_PACKET && down {
            // The halves of a character come as two keys.
            typed.splice(..0, FIRST_HALF.take());
            if let [first @ 0xD800..0xDC00] = typed[..] {
                FIRST_HALF.set(Some(first));
            }
        }
        if key == VK_PACKET && FIRST_HALF.get().is_some() {
            return false;
        }
        if down {
            DEAD_KEY.set(if is_dead { key } else { 0 });
        }
        let is_alt_graph = key == VK_MENU && l & IS_EXTENDED != 0 && IS_ALT_GRAPH_DOWN.get();
        let typed = String::from_utf16_lossy(&typed);
        let is_japanese = GetKeyboardLayout(0) as u32 & 0x3FF == LANG_JAPANESE;
        let named = [key | JAPANESE, key]
            .into_iter()
            .skip((!is_japanese).into())
            .find(|it| name_of_virtual_key(*it).is_some());
        let mut modifiers = modifiers();
        let symbol = match named {
            _ if is_alt_graph => NAMED,
            _ if is_dead => DEAD,
            Some(key) => NAMED | key,
            None => {
                let (alone, is_with_both) = character(key, scan_code & 0xFF);
                if is_with_both {
                    modifiers =
                        modifiers & !(protocol::CONTROL | protocol::ALT) | protocol::ALT_GRAPH;
                }
                typed
                    .chars()
                    .next_back()
                    .filter(|it| !it.is_control())
                    .map(u32::from)
                    .or(alone)
                    .unwrap_or(0)
            }
        };
        input::raw_key(RawKey {
            down,
            is_repeat,
            scan_code,
            symbol,
            key_code: key as u8,
            modifiers,
        });
        if is_alt_graph && !down {
            IS_ALT_GRAPH_DOWN.set(false);
        }
        if key == VK_PROCESSKEY {
            input::report_key_taken_by_ime();
            return false;
        }
        if !input::key(down) && !typed.is_empty() && !typed.contains(char::is_control) {
            TextInput(self.id).insert(None, &typed);
        }
        if opens_menu {
            self.open_system_menu(None);
        }
        key == VK_F4
    }

    /// What no key has typed: from Alt and digits, the panel of emoji, or another program.
    pub fn character(&self, unit: u16) {
        if (0xD800..0xDC00).contains(&unit) {
            return FIRST_HALF.set(Some(unit));
        }
        let text =
            String::from_utf16_lossy(&Vec::from_iter(FIRST_HALF.take().into_iter().chain([unit])));
        if !text.contains(char::is_control) {
            input::flush_raw_key();
            TextInput(self.id).insert(None, &text);
        }
    }
}

/// The modifiers and the key, for `RegisterHotKey`.
pub fn hot_key(chord: &Chord) -> Option<(u32, u32)> {
    let name = crate::keys::dom_key(&chord.key, 0, None);
    let mut units = name.encode_utf16();
    let key = match (units.next()?, units.next()) {
        (only, None) => {
            Some(VkKeyScanExW(only, GetKeyboardLayout(0))).filter(|it| *it != -1)? as u32 & 0xFF
        }
        _ => (1..256)
            .find(|it| name_of_virtual_key(*it).is_some_and(|it| it.eq_ignore_ascii_case(&name)))?,
    };
    let bits = [
        (protocol::SHIFT, MOD_SHIFT),
        (protocol::CONTROL, MOD_CONTROL),
        (protocol::ALT, MOD_ALT),
        (protocol::META, MOD_WIN),
    ];
    Some((
        bits.iter()
            .filter(|it| chord.modifiers & it.0 != 0)
            .fold(MOD_NOREPEAT, |all, it| all | it.1),
        key,
    ))
}

/// The panel of emoji and symbols.
pub fn open_character_palette() {
    let input = |key: u32, flags| SentInput {
        r#type: INPUT_KEYBOARD,
        ki: KeybdInput {
            w_vk: key as u16,
            dw_flags: flags,
            ..Default::default()
        },
        ..Default::default()
    };
    let inputs = [
        input(VK_LWIN, 0),
        input(VK_OEM_PERIOD, 0),
        input(VK_OEM_PERIOD, KEYEVENTF_KEYUP),
        input(VK_LWIN, KEYEVENTF_KEYUP),
    ];
    // SAFETY: the array with its length.
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<SentInput>() as i32,
        )
    };
}

//! https://www.x.org/releases/current/doc/kbproto/xkbproto.html

use super::super::keysym_to_char;
use super::super::typing::{ALT, CONTROL, LOCK, NUM_LOCK, SHIFT, SUPER};
use super::wire::{Bytes as _, Connection, Cookie, Extension, Request};
use crate::error::{Context as _, Result};
use crate::keys;

const CORE_KEYBOARD: u16 = 0x100;
/// Afterwards, the state in events has the group, and a key that repeats is not released in between.
pub fn start(x: &Connection, xkb: Extension) {
    const NEW_KEYBOARD_AND_MAP: u16 = 3;
    x.forget(x.ask(Request::new(xkb.opcode, 0).u16(1).u16(0)));
    let select = Request::new(xkb.opcode, 1)
        .u16(CORE_KEYBOARD)
        .u16(NEW_KEYBOARD_AND_MAP)
        .u16(0);
    x.send(select.u16(NEW_KEYBOARD_AND_MAP).u16(3).u16(3));
    x.forget(
        x.ask(
            Request::new(xkb.opcode, 21)
                .u16(CORE_KEYBOARD)
                .u16(0)
                .words(&[1, 1, 0, 0, 0]),
        ),
    );
}

struct KeyType {
    mask: u8,
    /// The modifiers, the level, and which of them still apply.
    levels: Vec<(u8, u8, u8)>,
}

#[derive(Default)]
struct Key {
    types: [u8; 4],
    groups: u8,
    width: u8,
    symbols: Vec<u32>,
}

pub struct Keymap {
    types: Vec<KeyType>,
    first_code: u8,
    keys: Vec<Key>,
}

impl Keymap {
    pub fn ask(x: &Connection, xkb: Extension) -> Cookie {
        const TYPES_AND_SYMBOLS: u16 = 3;
        x.ask(
            Request::new(xkb.opcode, 8)
                .u16(CORE_KEYBOARD)
                .u16(TYPES_AND_SYMBOLS)
                .bytes(&[0; 20]),
        )
    }

    pub fn read(reply: &[u8]) -> Keymap {
        let mut at = 40;
        let types = (0..reply.u8(15)).map(|_| {
            let (mask, count, preserves) = (
                reply.u8(at),
                usize::from(reply.u8(at + 5)),
                reply.u8(at + 6) != 0,
            );
            let (entries, preserved) = (at + 8, at + 8 + count * 8);
            at = preserved + if preserves { count * 4 } else { 0 };
            let active = (0..count).filter(|index| reply.u8(entries + index * 8) != 0);
            let levels = active.map(|index| {
                let kept = if preserves {
                    reply.u8(preserved + index * 4)
                } else {
                    0
                };
                (
                    reply.u8(entries + index * 8 + 1),
                    reply.u8(entries + index * 8 + 2),
                    kept,
                )
            });
            KeyType {
                mask,
                levels: levels.collect(),
            }
        });
        let types = types.collect();
        let keys = (0..reply.u8(20)).map(|_| {
            let (start, count) = (at, usize::from(reply.u16(at + 6)));
            at += 8 + count * 4;
            Key {
                types: reply.u32(start).to_le_bytes(),
                groups: reply.u8(start + 4),
                width: reply.u8(start + 5),
                symbols: reply.part(start + 8, count * 4).words(),
            }
        });
        Keymap {
            types,
            first_code: reply.u8(17),
            keys: keys.collect(),
        }
    }

    pub fn symbol(&self, code: u8, state: u16) -> u32 {
        let lookup = || {
            let key = self
                .keys
                .get(usize::from(code.checked_sub(self.first_code)?))?;
            let (count, wanted) = (key.groups & 15, (state >> 13) as u8 & 3);
            let group = match key.groups & 0xc0 {
                _ if wanted < count => wanted,
                0x40 => count.checked_sub(1)?,
                0x80 => Some(key.groups >> 4 & 3)
                    .filter(|it| *it < count)
                    .unwrap_or(0),
                _ => wanted.checked_rem(count)?,
            };
            let kind = self.types.get(usize::from(key.types[usize::from(group)]))?;
            let found = kind
                .levels
                .iter()
                .find(|it| it.0 == state as u8 & kind.mask);
            let (_, level, kept) = found.copied().unwrap_or_default();
            let symbol = *key
                .symbols
                .get(usize::from(group) * usize::from(key.width) + usize::from(level))?;
            let capitalizes = state & LOCK & !u16::from(kind.mask & !kept) != 0;
            Some(if capitalizes {
                in_upper_case(symbol)
            } else {
                symbol
            })
        };
        lookup().unwrap_or(0)
    }

    fn code_for(&self, symbol: u32) -> Option<u8> {
        let at = self
            .keys
            .iter()
            .position(|key| key.symbols.first() == Some(&symbol))?;
        Some(self.first_code + at as u8)
    }
}

fn in_upper_case(symbol: u32) -> u32 {
    let mut upper = keysym_to_char(symbol)
        .filter(|it| it.is_lowercase())
        .into_iter()
        .flat_map(char::to_uppercase);
    match (upper.next(), upper.next()) {
        (Some(upper @ ..='\u{ff}'), None) => upper.into(),
        (Some(upper), None) => 0x0100_0000 + u32::from(upper),
        _ => symbol,
    }
}

// ───────────────────────────── global shortcuts ─────────────────────────────

use crate::protocol::{self, Chord};

#[derive(Clone, Copy, PartialEq)]
pub struct HotKey {
    code: u8,
    modifiers: u16,
}

impl HotKey {
    pub fn new(chord: &Chord, keymap: &Keymap) -> Result<HotKey> {
        let name = &*chord.key;
        let mut characters = name.chars();
        let labelled = characters
            .next()
            .filter(|_| characters.next().is_none())
            .and_then(|it| keymap.code_for(it.into()));
        let code = match name {
            "up" | "down" | "left" | "right" => format!("arrow{name}"),
            "menu" => "contextmenu".into(),
            _ if name.len() == 1 => keys::code_for_key(name),
            _ => name.into(),
        };
        let at_position =
            || (8..=255).find(|it| keys::dom_code(u32::from(it - 8)).eq_ignore_ascii_case(&code));
        let masks = [
            (protocol::SHIFT, SHIFT),
            (protocol::CONTROL, CONTROL),
            (protocol::ALT, ALT),
            (protocol::META, SUPER),
        ];
        Ok(HotKey {
            code: labelled
                .or_else(at_position)
                .filter(|_| !code.is_empty())
                .context("there is no such key")?,
            modifiers: masks
                .iter()
                .filter(|it| chord.modifiers & it.0 != 0)
                .map(|it| it.1)
                .sum(),
        })
    }

    pub fn pressed(code: u8, state: u16) -> HotKey {
        HotKey {
            code,
            modifiers: state & (SHIFT | CONTROL | ALT | SUPER),
        }
    }

    fn with_locks(self) -> [u16; 4] {
        [0, NUM_LOCK, LOCK, NUM_LOCK | LOCK].map(|locks| locks | self.modifiers)
    }

    pub fn grab(self, x: &Connection) -> Result<()> {
        let grab = |modifiers| {
            x.check(
                Request::new(33, 0)
                    .u32(x.screen.root)
                    .u16(modifiers)
                    .bytes(&[self.code, 1, 1]),
            )
        };
        self.with_locks()
            .into_iter()
            .try_for_each(grab)
            .inspect_err(|_| self.release(x))
    }

    pub fn release(self, x: &Connection) {
        for modifiers in self.with_locks() {
            x.send(
                Request::new(34, self.code)
                    .u32(x.screen.root)
                    .u16(modifiers),
            );
        }
    }
}

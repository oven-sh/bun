//! Keysyms and the bits of modifiers are X11's, also on Wayland.

use std::cell::{OnceCell, RefCell};
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::rc::Rc;

use super::ibus::{self, InputMethod};
use super::{atspi, keysym_to_char};
use crate::input::{self, TextInput};
use crate::platform::{Modifiers, Point, RawKey};

pub const SHIFT: u16 = 1;
pub const LOCK: u16 = 2;
pub const CONTROL: u16 = 4;
pub const ALT: u16 = 8;
pub const NUM_LOCK: u16 = 16;
pub const SUPER: u16 = 64;
const LEVEL_3: u16 = 128;

pub fn modifiers(state: u16) -> Modifiers {
    let bits = [
        (SHIFT, 1),
        (CONTROL, 2),
        (ALT, 4),
        (SUPER, 8),
        (LEVEL_3, 16),
        (LOCK, 32),
    ];
    bits.into_iter()
        .filter(|(mask, _)| state & mask != 0)
        .fold(0, |all, (_, bit)| all | bit)
}

// ───────────────────────────── dead keys and the Compose key ─────────────────────────────

fn starts_sequence(symbol: u32) -> bool {
    matches!(symbol, 0xfe50..=0xfe93 | 0xff20)
}

/// What is shown for it until the sequence is complete.
fn placeholder(symbol: u32) -> Option<char> {
    const DEAD: &str = "`´^~¯˘˙¨˚˝ˇ¸˛ͺ゛゜.";
    match symbol {
        0xff20 => Some('·'),
        0xfe50..=0xfe93 => DEAD.chars().nth((symbol - 0xfe50) as usize).or(Some('·')),
        _ => keysym_to_char(symbol),
    }
}

enum Sequence {
    Nothing,
    Continues,
    Typed(String),
    Cancelled,
}

pub fn in_xkbcommon(name: &CStr) -> Option<*mut c_void> {
    // SAFETY: strings.
    unsafe {
        let library = Some(libc::dlopen(c"libxkbcommon.so.0".as_ptr(), libc::RTLD_NOW))
            .filter(|it| !it.is_null())?;
        Some(libc::dlsym(library, name.as_ptr())).filter(|it| !it.is_null())
    }
}

/// The tables are libX11's, which libxkbcommon reads.
struct Composer {
    state: *mut c_void,
    feed: unsafe extern "C" fn(*mut c_void, u32) -> c_int,
    status: unsafe extern "C" fn(*mut c_void) -> c_int,
    text: unsafe extern "C" fn(*mut c_void, *mut c_char, usize) -> c_int,
    reset: unsafe extern "C" fn(*mut c_void),
}

impl Composer {
    fn load() -> Option<Composer> {
        let mut locale = ["LC_ALL", "LC_CTYPE", "LANG"]
            .into_iter()
            .filter_map(|name| std::env::var(name).ok());
        let locale = CString::new(locale.find(|it| !it.is_empty()).unwrap_or_default()).ok()?;
        // SAFETY: the signatures are those in xkbcommon.h and xkbcommon-compose.h. Nothing is freed.
        unsafe {
            let find = in_xkbcommon;
            let context: unsafe extern "C" fn(c_int) -> *mut c_void =
                std::mem::transmute(find(c"xkb_context_new")?);
            let table: unsafe extern "C" fn(*mut c_void, *const c_char, c_int) -> *mut c_void =
                std::mem::transmute(find(c"xkb_compose_table_new_from_locale")?);
            let state: unsafe extern "C" fn(*mut c_void, c_int) -> *mut c_void =
                std::mem::transmute(find(c"xkb_compose_state_new")?);
            let context = Some(context(1)).filter(|it| !it.is_null())?;
            let mut tables = [&*locale, c"en_US.UTF-8"]
                .into_iter()
                .map(|it| table(context, it.as_ptr(), 0));
            Some(Composer {
                state: Some(state(tables.find(|it| !it.is_null())?, 0))
                    .filter(|it| !it.is_null())?,
                feed: std::mem::transmute::<
                    *mut c_void,
                    unsafe extern "C" fn(*mut c_void, u32) -> c_int,
                >(find(c"xkb_compose_state_feed")?),
                status: std::mem::transmute::<
                    *mut c_void,
                    unsafe extern "C" fn(*mut c_void) -> c_int,
                >(find(c"xkb_compose_state_get_status")?),
                text: std::mem::transmute::<
                    *mut c_void,
                    unsafe extern "C" fn(*mut c_void, *mut c_char, usize) -> c_int,
                >(find(c"xkb_compose_state_get_utf8")?),
                reset: std::mem::transmute::<*mut c_void, unsafe extern "C" fn(*mut c_void)>(find(
                    c"xkb_compose_state_reset",
                )?),
            })
        }
    }

    fn feed(&self, symbol: u32) -> Sequence {
        let mut text = [0u8; 256];
        // SAFETY: the state is alive, and the buffer has that length.
        unsafe {
            if (self.feed)(self.state, symbol) == 0 {
                return Sequence::Nothing;
            }
            match (self.status)(self.state) {
                1 => Sequence::Continues,
                2 => {
                    let length =
                        (self.text)(self.state, text.as_mut_ptr().cast(), text.len()).clamp(0, 255);
                    Sequence::Typed(String::from_utf8_lossy(&text[..length as usize]).into_owned())
                }
                3 => Sequence::Cancelled,
                _ => Sequence::Nothing,
            }
        }
    }

    fn reset(&self) {
        // SAFETY: the state is alive.
        unsafe { (self.reset)(self.state) }
    }
}

// ───────────────────────────── from keys to text ─────────────────────────────

#[derive(Default)]
pub struct Typing {
    composer: OnceCell<Option<Composer>>,
    /// What is shown for the sequence so far.
    sequence: RefCell<String>,
    input_method: OnceCell<Option<Rc<InputMethod>>>,
}

pub struct Key {
    pub down: bool,
    pub is_repeat: bool,
    /// X11's, which is 8 more than evdev's.
    pub code: u32,
    pub symbol: u32,
    pub state: u16,
    pub time: u32,
}

impl Typing {
    pub fn input_method(&self) -> Option<&InputMethod> {
        self.input_method.get()?.as_deref()
    }

    /// The window that has a field with the focus, and the caret on the screen.
    pub fn tell_input_method(&'static self, focus: Option<(u32, [i32; 4])>) {
        if focus.is_some() {
            self.input_method.get_or_init(|| {
                InputMethod::connect(|window, symbol, scan_code, state| {
                    let down = state & ibus::RELEASED == 0;
                    input::report_key_taken_by_ime();
                    input::raw_key(RawKey {
                        down,
                        is_repeat: false,
                        scan_code,
                        symbol,
                        key_code: 0,
                        modifiers: modifiers(state as u16),
                    });
                    self.type_key(window, down, symbol, state as u16);
                })
            });
        }
        self.input_method()
            .iter()
            .for_each(|it| it.set_focus(focus));
    }

    pub fn focus_changed(&self, window: u32) {
        if !self.sequence.borrow().is_empty() {
            self.end_sequence();
            TextInput(window).insert(None, "");
        }
    }

    fn end_sequence(&self) {
        self.sequence.take();
        self.composer
            .get()
            .into_iter()
            .flatten()
            .for_each(Composer::reset);
    }

    /// Returns whether the key is a part of one.
    fn continue_sequence(&self, input: TextInput, symbol: u32) -> bool {
        if self.sequence.borrow().is_empty() && !(starts_sequence(symbol) && input.is_enabled()) {
            return false;
        }
        let Some(composer) = self.composer.get_or_init(Composer::load) else {
            return false;
        };
        let sequence = composer.feed(symbol);
        input::flush_raw_key();
        match sequence {
            Sequence::Nothing => return false,
            Sequence::Continues => {
                self.sequence.borrow_mut().extend(placeholder(symbol));
                let shown = self.sequence.borrow().clone();
                input.compose(None, &shown, None);
            }
            Sequence::Typed(text) => {
                self.end_sequence();
                input.insert(None, &text);
            }
            Sequence::Cancelled => {
                self.end_sequence();
                input.insert(None, "");
            }
        }
        true
    }

    fn type_key(&self, window: u32, down: bool, symbol: u32, state: u16) {
        if down && self.continue_sequence(TextInput(window), symbol) {
            return;
        }
        let is_shortcut = state & (CONTROL | ALT | SUPER) != 0;
        if !input::key(down) && down && !is_shortcut {
            let typed = keysym_to_char(symbol).filter(|it| !it.is_control());
            typed
                .into_iter()
                .for_each(|it| TextInput(window).insert(None, it.encode_utf8(&mut [0; 4])));
        }
    }

    pub fn key(
        &self,
        window: u32,
        Key {
            down,
            is_repeat,
            code,
            symbol,
            state,
            time,
        }: Key,
    ) {
        if atspi::takes_key(
            down,
            symbol,
            code as u8,
            state,
            time,
            keysym_to_char(symbol).filter(|it| !it.is_control()),
        ) {
            return;
        }
        let scan_code = code.saturating_sub(8);
        let raw = RawKey {
            down,
            is_repeat,
            scan_code,
            symbol,
            key_code: 0,
            modifiers: modifiers(state),
        };
        let state_and_direction = u32::from(state) | if down { 0 } else { ibus::RELEASED };
        let method = self.input_method();
        if let Some(method) = method.filter(|it| it.takes(symbol, scan_code, state_and_direction)) {
            input::raw_key(raw);
            method.deliver();
            return input::report_key_taken_by_ime();
        }
        // The key has ended a composition, and is still to be typed.
        method.into_iter().for_each(InputMethod::deliver);
        input::raw_key(raw);
        self.type_key(window, down, symbol, state);
    }
}

// ───────────────────────────── clicks ─────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Click {
    time: u32,
    button: u8,
    at: Point,
    pub count: u32,
}

impl Click {
    pub fn next(self, time: u32, button: u8, at: Point, interval: u32) -> Click {
        let is_near = (at.x - self.at.x).abs() <= 5. && (at.y - self.at.y).abs() <= 5.;
        let continues = time.wrapping_sub(self.time) < interval && is_near && button == self.button;
        Click {
            time,
            button,
            at,
            count: if continues { self.count + 1 } else { 1 },
        }
    }
}

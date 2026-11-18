//! The compositor sends the layout as text that is made for libxkbcommon.

use std::cell::Cell;
use std::ffi::{c_char, c_int, c_void};
use std::os::fd::OwnedFd;
use std::os::unix::fs::FileExt as _;
use std::time::{Duration, Instant};

use super::super::typing::{self, Key, in_xkbcommon};
use super::wire::{Event, Kind};
use super::{Global, Wayland};
use crate::platform::Modifiers;

type Handle = *mut c_void;

macro_rules! library {
    ($($name:ident = $symbol:literal ($($argument:ty),*) $(-> $result:ty)?;)*) => {
        struct Library {
            $($name: unsafe extern "C" fn($($argument),*) $(-> $result)?,)*
        }

        impl Library {
            fn load() -> Option<Library> {
                // SAFETY: the signatures are those in xkbcommon.h.
                Some(Library { $($name: unsafe { std::mem::transmute::<Handle, unsafe extern "C" fn($($argument),*) $(-> $result)?>(in_xkbcommon($symbol)?) },)* })
            }
        }
    };
}

library! {
    new_context = c"xkb_context_new"(c_int) -> Handle;
    release_context = c"xkb_context_unref"(Handle);
    new_keymap = c"xkb_keymap_new_from_string"(Handle, *const c_char, c_int, c_int) -> Handle;
    release_keymap = c"xkb_keymap_unref"(Handle);
    repeats = c"xkb_keymap_key_repeats"(Handle, u32) -> c_int;
    new_state = c"xkb_state_new"(Handle) -> Handle;
    release_state = c"xkb_state_unref"(Handle);
    keymap_of = c"xkb_state_get_keymap"(Handle) -> Handle;
    update = c"xkb_state_update_mask"(Handle, u32, u32, u32, u32, u32, u32) -> c_int;
    symbol = c"xkb_state_key_get_one_sym"(Handle, u32) -> u32;
}

#[derive(Clone, Copy)]
struct Held {
    code: u32,
    time: u32,
    repeats_at: Instant,
}

pub struct Keyboard {
    library: Library,
    object: Cell<u32>,
    /// It is read when the first window gets the keys, which is after it has appeared.
    layout: Cell<Option<(OwnedFd, u32)>>,
    state: Cell<Handle>,
    /// Depressed, latched and locked, and the group.
    masks: Cell<[u32; 4]>,
    pub focus: Cell<Option<u32>>,
    held: Cell<Option<Held>>,
    delay: Cell<Duration>,
    interval: Cell<Option<Duration>>,
}

impl Keyboard {
    pub fn new() -> Option<Keyboard> {
        Some(Keyboard {
            library: Library::load()?,
            object: Cell::default(),
            layout: Cell::default(),
            state: Cell::new(std::ptr::null_mut()),
            masks: Cell::default(),
            focus: Cell::default(),
            held: Cell::default(),
            delay: Cell::new(Duration::from_millis(600)),
            interval: Cell::new(Some(Duration::from_millis(40))),
        })
    }

    fn read_layout(&self) {
        const NO_INCLUDES_NO_ENVIRONMENT: c_int = 3;
        let Some((file, length)) = self.layout.take() else {
            return;
        };
        let mut text = vec![0; length.min(1 << 24) as usize];
        if std::fs::File::from(file)
            .read_exact_at(&mut text, 0)
            .is_err()
        {
            return;
        }
        text.push(0);
        let it = &self.library;
        // SAFETY: the text ends with a zero, a state keeps its keymap and that its context, and null is not released.
        unsafe {
            let context = (it.new_context)(NO_INCLUDES_NO_ENVIRONMENT);
            let keymap = if context.is_null() {
                context
            } else {
                (it.new_keymap)(context, text.as_ptr().cast(), 1, 0)
            };
            if !keymap.is_null() {
                (it.release_state)(self.state.replace((it.new_state)(keymap)));
            }
            (it.release_keymap)(keymap);
            (it.release_context)(context);
        }
        self.set_masks(self.masks.get());
    }

    fn set_masks(&self, masks: [u32; 4]) {
        self.masks.set(masks);
        if !self.state.get().is_null() {
            // SAFETY: a state.
            unsafe {
                (self.library.update)(
                    self.state.get(),
                    masks[0],
                    masks[1],
                    masks[2],
                    0,
                    0,
                    masks[3],
                )
            };
        }
    }

    /// With whether it repeats.
    fn symbol(&self, code: u32) -> (u32, bool) {
        let (it, state) = (&self.library, self.state.get());
        // SAFETY: a state.
        if state.is_null() {
            (0, false)
        } else {
            unsafe {
                (
                    (it.symbol)(state, code),
                    (it.repeats)((it.keymap_of)(state), code) != 0,
                )
            }
        }
    }

    /// As in the events of X11.
    fn core_state(&self) -> u16 {
        let [depressed, latched, locked, group] = self.masks.get();
        ((depressed | latched | locked) & 0xff | (group & 3) << 13) as u16
    }

    pub fn modifiers(&self) -> Modifiers {
        typing::modifiers(self.core_state())
    }

    pub fn next_repeat(&self) -> Option<Instant> {
        self.held.get().map(|it| it.repeats_at)
    }
}

impl Wayland {
    pub fn use_keyboard(&self, exists: bool) {
        let object = &self.keyboard.object;
        if !exists {
            self.keyboard.held.set(None);
            self.wire.destroy(object.take(), 0);
        } else if object.get() == 0 {
            object.set(
                self.wire
                    .create(Kind::Keyboard, 0, self.global(Global::Seat), 1, &[]),
            );
        }
    }

    fn move_focus(&self, to: Option<u32>) {
        let from = self.keyboard.focus.replace(to);
        self.keyboard.held.set(None);
        self.text_input.has_changed.set(true);
        for window in from.into_iter().chain(to).filter_map(|id| self.window(id)) {
            self.typing.focus_changed(window.id);
            window.activation_may_have_changed();
        }
    }

    pub fn keyboard_event(&self, mut event: Event) {
        let keyboard = &self.keyboard;
        match event.opcode {
            0 => {
                keyboard
                    .layout
                    .set(event.file.take().map(|file| (file, event.u32(1))));
                keyboard.focus.get().inspect(|_| keyboard.read_layout());
            }
            1 => {
                self.serial.set(event.u32(0));
                keyboard.read_layout();
                self.move_focus(self.window_of(event.u32(1)).map(|it| it.id));
            }
            2 => self.move_focus(None),
            3 => {
                let (time, code, down) = (event.u32(1), event.u32(2) + 8, event.u32(3) != 0);
                let (symbol, repeats) = keyboard.symbol(code);
                if down {
                    self.serial.set(event.u32(0));
                }
                if down && repeats && keyboard.interval.get().is_some() {
                    keyboard.held.set(Some(Held {
                        code,
                        time,
                        repeats_at: Instant::now() + keyboard.delay.get(),
                    }));
                } else if !down && keyboard.held.get().is_some_and(|it| it.code == code) {
                    keyboard.held.set(None);
                }
                if let Some(window) = keyboard.focus.get() {
                    self.typing.key(
                        window,
                        Key {
                            down,
                            is_repeat: false,
                            code,
                            symbol,
                            state: keyboard.core_state(),
                            time,
                        },
                    );
                }
            }
            4 => keyboard.set_masks([1, 2, 3, 4].map(|it| event.u32(it))),
            _ => {
                keyboard
                    .interval
                    .set((event.i32(0) > 0).then(|| Duration::from_secs(1) / event.u32(0)));
                keyboard
                    .delay
                    .set(Duration::from_millis(event.i32(1).max(0) as u64));
            }
        }
    }

    pub fn repeat_key(&self, now: Instant) {
        let keyboard = &self.keyboard;
        let Some(held @ Held { code, time, .. }) =
            keyboard.held.get().filter(|it| it.repeats_at <= now)
        else {
            return;
        };
        keyboard.held.set(keyboard.interval.get().map(|it| Held {
            repeats_at: (held.repeats_at + it).max(now + it / 2),
            ..held
        }));
        if let Some(window) = keyboard.focus.get() {
            self.typing.key(
                window,
                Key {
                    down: true,
                    is_repeat: true,
                    code,
                    symbol: keyboard.symbol(code).0,
                    state: keyboard.core_state(),
                    time,
                },
            );
        }
    }
}

//! `GlobalHotKeyManager` for X11, which unlike the crate's does not poll.

use std::sync::{Arc, OnceLock};

use anyhow::{Context as _, Result};
use global_hotkey::hotkey::{HotKey, Modifiers};
use parking_lot::Mutex;
use serde_json::json;
use x11rb::connection::Connection as _;
use x11rb::protocol::Event;
use x11rb::protocol::xproto::{ConnectionExt as _, GrabMode, ModMask};
use x11rb::rust_connection::RustConnection;

use crate::{bridge, keys};

struct Grabs {
    connection: RustConnection,
    root: u32,
    /// The key code, the modifiers and the id.
    active: Mutex<Vec<(u8, u16, u32)>>,
}

pub struct GlobalHotKeyManager(Arc<Grabs>);

fn with_locks(modifiers: u16) -> [ModMask; 4] {
    [
        ModMask::default(),
        ModMask::M2,
        ModMask::LOCK,
        ModMask::M2 | ModMask::LOCK,
    ]
    .map(|locks| locks | modifiers)
}

impl Grabs {
    fn connect() -> Option<Arc<Grabs>> {
        let (connection, screen) = x11rb::connect(None).ok()?;
        let root = connection.setup().roots.get(screen)?.root;
        let grabs = Arc::new(Grabs {
            connection,
            root,
            active: Mutex::default(),
        });
        let listener = grabs.clone();
        std::thread::Builder::new()
            .name("hotkeys".into())
            .spawn(move || listener.listen())
            .ok()?;
        Some(grabs)
    }

    fn listen(&self) {
        let relevant = u16::from(ModMask::SHIFT | ModMask::CONTROL | ModMask::M1 | ModMask::M4);
        while let Ok(event) = self.connection.wait_for_event() {
            let Event::KeyPress(event) = event else {
                continue;
            };
            let pressed = (event.detail, u16::from(event.state) & relevant);
            for (.., id) in self
                .active
                .lock()
                .iter()
                .filter(|(code, modifiers, _)| (*code, *modifiers) == pressed)
            {
                bridge::emit(json!({ "t": "hotkey", "id": id }));
            }
        }
    }

    fn resolve(&self, hotkey: HotKey) -> Result<(u8, u16, u32)> {
        let (name, setup) = (hotkey.key.to_string(), self.connection.setup());
        let codes = setup.min_keycode..=setup.max_keycode;
        let mapping = self
            .connection
            .get_keyboard_mapping(*codes.start(), codes.len() as u8)?
            .reply()?;
        let letter = name
            .strip_prefix("Key")
            .map(|letter| u32::from(letter.as_bytes()[0].to_ascii_lowercase()));
        let labels = mapping
            .keysyms
            .chunks(mapping.keysyms_per_keycode.into())
            .map(|symbols| symbols[0]);
        let labelled = codes
            .clone()
            .zip(labels)
            .find(|(_, label)| Some(*label) == letter)
            .map(|(code, _)| code);
        let code = labelled.or_else(|| {
            codes
                .clone()
                .find(|code| keys::dom_code(u32::from(code - 8)) == name)
        });
        let modifiers = [
            (Modifiers::SHIFT, ModMask::SHIFT),
            (Modifiers::CONTROL, ModMask::CONTROL),
            (Modifiers::ALT, ModMask::M1),
            (Modifiers::META, ModMask::M4),
        ];
        let held = modifiers
            .into_iter()
            .filter(|(modifier, _)| hotkey.mods.intersects(*modifier));
        Ok((
            code.context("there is no such key")?,
            held.map(|(_, mask)| u16::from(mask)).sum(),
            hotkey.id(),
        ))
    }

    fn release(&self, (code, modifiers, _): (u8, u16, u32)) -> Result<()> {
        for modifiers in with_locks(modifiers) {
            self.connection
                .ungrab_key(code, self.root, modifiers)?
                .check()?;
        }
        Ok(())
    }
}

impl GlobalHotKeyManager {
    pub fn new() -> Result<GlobalHotKeyManager> {
        static GRABS: OnceLock<Option<Arc<Grabs>>> = OnceLock::new();
        GRABS
            .get_or_init(Grabs::connect)
            .clone()
            .map(GlobalHotKeyManager)
            .context("there is no X server to ask")
    }

    pub fn register(&self, hotkey: HotKey) -> Result<()> {
        let (grabs, grab) = (&self.0, self.0.resolve(hotkey)?);
        let result = with_locks(grab.1).into_iter().try_for_each(|modifiers| {
            let cookie = grabs.connection.grab_key(
                false,
                grabs.root,
                modifiers,
                grab.0,
                GrabMode::ASYNC,
                GrabMode::ASYNC,
            );
            Ok(cookie?.check()?)
        });
        match result {
            Ok(()) => grabs.active.lock().push(grab),
            Err(_) => grabs.release(grab)?,
        }
        result
    }

    pub fn unregister(&self, hotkey: HotKey) -> Result<()> {
        let released: Vec<_> = self
            .0
            .active
            .lock()
            .extract_if(.., |(.., id)| *id == hotkey.id())
            .collect();
        released
            .into_iter()
            .try_for_each(|grab| self.0.release(grab))
    }
}

impl Drop for GlobalHotKeyManager {
    fn drop(&mut self) {
        for grab in std::mem::take(&mut *self.0.active.lock()) {
            self.0.release(grab).ok();
        }
    }
}

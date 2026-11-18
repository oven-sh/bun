//! `globalShortcut`

use bun_jsc::Strong;
use bun_ui::protocol::{Chord, SHIFT};

use crate::accelerator;
use crate::generated_bindgen::system::DesktopGlobalShortcut;
use crate::prelude::*;

struct Shortcut {
    id: u32,
    chord: Chord,
    callback: Strong,
}

#[derive(Default)]
struct State {
    all: RefCell<Vec<Shortcut>>,
    last_id: Cell<u32>,
    is_suspended: Cell<bool>,
}

state!(fn state() -> State);

fn chord_of(text: &[u8]) -> JsResult<Chord> {
    let chord = accelerator::parse(&string(text))?;
    Ok(if &*chord.key == "+" {
        Chord {
            key: "=".into(),
            modifiers: chord.modifiers | SHIFT,
        }
    } else {
        chord
    })
}

fn unregister(is_wanted: impl Fn(&Shortcut) -> bool) -> JsResult<()> {
    let removed: Vec<Shortcut> = state()
        .all
        .borrow_mut()
        .extract_if(.., |it| is_wanted(it))
        .collect();
    removed.into_iter().try_for_each(|it| {
        bun_ui::release();
        if state().is_suspended.get() {
            Ok(())
        } else {
            perform(SystemCommand::UnregisterHotKey(it.id))
        }
    })
}

pub(crate) fn pressed(id: u32) -> JsResult<()> {
    let callback = state()
        .all
        .borrow()
        .iter()
        .find(|it| it.id == id)
        .map(|it| it.callback.get());
    callback.map_or(Ok(()), |it| call(it, &[]).map(drop))
}

impl DesktopGlobalShortcut {
    pub(crate) fn register<'a>(
        cx: Cx<'a, '_>,
        text: &[u8],
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<bool> {
        if Self::is_registered(cx, text)? || state().is_suspended.get() {
            return Ok(false);
        }
        ui()?;
        state().last_id.update(|it| it + 1);
        let (id, chord) = (state().last_id.get(), chord_of(text)?);
        if catch(perform(SystemCommand::RegisterHotKey {
            id,
            chord: chord.clone(),
        }))?
        .is_err()
        {
            return Ok(false);
        }
        state().all.borrow_mut().push(Shortcut {
            id,
            chord,
            callback: keep(callback.to_js()),
        });
        bun_ui::hold();
        Ok(true)
    }

    pub(crate) fn register_all<'a>(
        cx: Cx<'a, '_>,
        texts: Vec<bun_core::Utf8Bytes<'static>>,
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<()> {
        texts
            .into_iter()
            .try_for_each(|it| Self::register(cx, &it, callback).map(drop))
    }

    pub(crate) fn is_registered(_: Cx<'_, '_>, text: &[u8]) -> JsResult<bool> {
        let chord = chord_of(text)?;
        Ok(state().all.borrow().iter().any(|it| it.chord == chord))
    }

    pub(crate) fn unregister(_: Cx<'_, '_>, text: &[u8]) -> JsResult<()> {
        let chord = chord_of(text)?;
        unregister(|it| it.chord == chord)
    }

    pub(crate) fn unregister_all(_: Cx<'_, '_>) -> JsResult<()> {
        unregister(|_| true)
    }

    pub(crate) fn is_suspended() -> bool {
        state().is_suspended.get()
    }

    pub(crate) fn set_suspended(_: Cx<'_, '_>, is_suspended: bool) -> JsResult<()> {
        if state().is_suspended.replace(is_suspended) == is_suspended {
            return Ok(());
        }
        state()
            .all
            .borrow()
            .iter()
            .try_for_each(|it| match is_suspended {
                true => tell_system(SystemCommand::UnregisterHotKey(it.id)),
                false => tell_system(SystemCommand::RegisterHotKey {
                    id: it.id,
                    chord: it.chord.clone(),
                }),
            })
    }
}

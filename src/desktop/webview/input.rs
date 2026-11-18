//! The input that is passed on to the web engine.

use bun_ui::protocol::{DragPhase, Input, Key, Located, Mouse, MouseAction, TouchPhase, Wheel};
use bun_web::input::{self, Action, Drag, Phase};

use crate::prelude::*;

/// With the lengths divided by `zoom`.
pub(super) fn for_engine(it: input::Input, zoom: f64) -> Option<Input> {
    let place = it.place().unwrap_or_default();
    let at = Located {
        x: finite(place.window[0] / zoom),
        y: finite(place.window[1] / zoom),
        modifiers: place.modifiers as u8,
        ..Default::default()
    };
    Some(match it {
        input::Input::Mouse(it) | input::Input::Pen { mouse: it, .. } => Input::Mouse(Mouse {
            at,
            action: match it.action {
                Action::Down => MouseAction::Down,
                Action::Up => MouseAction::Up,
                Action::Leave => MouseAction::Leave,
                Action::Move => MouseAction::Move,
            },
            button: it.button as u8,
            buttons: it.buttons as u8,
            clicks: it.clicks as u32,
        }),
        input::Input::Wheel { delta, .. } => Input::Wheel(Wheel {
            at,
            delta,
            is_precise: false,
        }),
        input::Input::Pinch { delta, .. } => Input::Pinch {
            at,
            delta: finite(delta),
        },
        input::Input::Touch {
            phase,
            fingers,
            modifiers,
        } => Input::Touch {
            phase: match phase {
                Phase::Start => TouchPhase::Start,
                Phase::Move => TouchPhase::Move,
                Phase::End => TouchPhase::End,
                Phase::Cancel => TouchPhase::Cancel,
            },
            finger: fingers.first()?.id,
            at: Located {
                x: finite(fingers[0].place.window[0] / zoom),
                y: finite(fingers[0].place.window[1] / zoom),
                modifiers: modifiers as u8,
                ..at
            },
            contact: Default::default(),
        },
        input::Input::Drag { phase, files, .. } => Input::Drag {
            phase: match phase {
                Drag::Enter => DragPhase::Enter,
                Drag::Leave => DragPhase::Leave,
                Drag::Drop => DragPhase::Drop,
                Drag::Over => DragPhase::Over,
            },
            at,
            paths: files.into_iter().map(|it| it.0.into()).collect(),
        },
        input::Input::Key(it) => Input::Key(Key {
            key: it.key.into(),
            code: it.code.into(),
            key_code: it.key_code as u8,
            location: it.location as u8,
            modifiers: it.modifiers as u8,
            is_down: it.is_down,
            is_repeat: it.repeats,
            is_composing: it.is_composing,
        }),
        input::Input::Text {
            text,
            is_typed,
            range,
        } => Input::Text {
            text: text.into(),
            is_typed,
            range: range.into(),
        },
        input::Input::Compose {
            text,
            selection,
            range,
        } => Input::Compose {
            text: text.into(),
            selection: selection.unwrap_or_default(),
            range: range.into(),
        },
        input::Input::EndComposition => Input::EndComposition,
        input::Input::Focus { .. } => Input::Focus,
        input::Input::Blur { .. } => Input::Blur,
        _ => return None,
    })
}

//! The input that scripts pass on.

use bun_ui::protocol::{DragPhase, Input, Key, Located, Mouse, MouseAction, Wheel};

use crate::generated_bindgen::webview::SurfaceEvent;
use crate::prelude::*;

fn text(it: Option<&[u8]>) -> Text {
    Text::lossy(it.unwrap_or_default())
}

fn range(it: Option<&[f64]>) -> Option<[u32; 2]> {
    it?.first_chunk::<2>().map(|it| it.map(|it| it as u32))
}

/// With the lengths divided by `zoom`.
pub(super) fn from_script(it: &SurfaceEvent<'_>, zoom: f64) -> JsResult<Option<Input>> {
    let at = Located {
        x: finite(it.x / zoom),
        y: finite(it.y / zoom),
        modifiers: it.m as u8,
        ..Default::default()
    };
    Ok(Some(match (&*it.t, it.e.as_deref()) {
        (b"mouse", action) => Input::Mouse(Mouse {
            at,
            action: match action {
                Some(b"down") => MouseAction::Down,
                Some(b"up") => MouseAction::Up,
                Some(b"leave") => MouseAction::Leave,
                _ => MouseAction::Move,
            },
            button: it.b as u8,
            buttons: it.buttons as u8,
            clicks: it.n,
        }),
        (b"wheel", _) => Input::Wheel(Wheel {
            at,
            delta: [it.dx, it.dy],
            is_precise: false,
        }),
        (b"pinch", _) => Input::Pinch {
            at,
            delta: finite(it.delta),
        },
        (b"drag", phase) => Input::Drag {
            phase: match phase {
                Some(b"enter") => DragPhase::Enter,
                Some(b"leave") => DragPhase::Leave,
                Some(b"drop") => DragPhase::Drop,
                _ => DragPhase::Over,
            },
            at,
            paths: it
                .paths
                .iter()
                .flatten()
                .map(|it| Text::lossy(it))
                .collect(),
        },
        (b"key", phase) => Input::Key(Key {
            key: text_of(it.key.to_js())?.into(),
            code: text(it.code.as_deref()),
            location: it.location as u8,
            modifiers: at.modifiers,
            is_down: phase == Some(b"down"),
            is_repeat: it.repeat,
            is_composing: it.composing,
        }),
        (b"text", _) => Input::Text {
            text: text(it.text.as_deref()),
            is_typed: it.key.to_js().to_boolean(),
            range: range(it.range.as_deref()).into(),
        },
        (b"compose", _) => Input::Compose {
            text: text(it.text.as_deref()),
            selection: range(it.selection.as_deref()).unwrap_or_default(),
            range: range(it.range.as_deref()).into(),
        },
        (b"composeEnd", _) => Input::EndComposition,
        (b"focus", _) => Input::Focus,
        (b"blur", _) => Input::Blur,
        _ => return Ok(None),
    }))
}

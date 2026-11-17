//! Input for what listens with a function.

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::protocol::*;

/// What `handleEvent` of a page takes.
pub fn event_of(global: &JSGlobalObject, s: u32, input: Input) -> JsResult<JSValue> {
    let plain = |kind: &str| Ok(object!(global, { "t": kind, "s": s }));
    Ok(match input {
        Input::Frame { time, .. } => object!(global, { "t": "frame", "s": s, "time": time }),
        Input::Resize { size, scale } => object!(global, {
            "t": "resize", "s": s, "width": size.width, "height": size.height, "scale": scale,
        }),
        Input::Mouse(Mouse {
            at,
            action,
            button,
            buttons,
            clicks,
        }) => object!(global, {
            "t": "mouse", "s": s, "e": ["move", "down", "up", "leave"][action as usize],
            "x": at.x, "y": at.y, "sx": at.screen_x, "sy": at.screen_y,
            "m": u32::from(at.modifiers) | u32::from(at.is_handled) << 8,
            "b": button, "buttons": buttons, "n": clicks,
        }),
        Input::Wheel(Wheel {
            at,
            delta,
            is_precise,
        }) => object!(global, {
            "t": "wheel", "s": s, "x": at.x, "y": at.y, "sx": at.screen_x, "sy": at.screen_y, "m": at.modifiers,
            "dx": delta[0], "dy": delta[1], "precise": is_precise, "isHandled": at.is_handled,
        }),
        Input::Pinch { at, delta } => object!(global, {
            "t": "pinch", "s": s, "x": at.x, "y": at.y, "m": at.modifiers, "delta": delta,
        }),
        Input::Scroll {
            node,
            generation,
            total,
            has_ended,
        } => object!(global, {
            "t": "scroll", "s": s, "id": node, "x": total[0], "y": total[1],
            "hasEnded": has_ended, "generation": generation,
        }),
        Input::Key(key) => object!(global, {
            "t": "key", "s": s, "e": if key.is_down { "down" } else { "up" }, "key": key.key, "code": key.code,
            "location": key.location, "repeat": key.is_repeat, "m": key.modifiers, "composing": key.is_composing,
        }),
        Input::Text {
            text,
            is_typed,
            range,
        } => object!(global, {
            "t": "text", "s": s, "text": text, "key": is_typed, "range": range,
        }),
        Input::Compose {
            text,
            selection,
            range,
        } => object!(global, {
            "t": "compose", "s": s, "text": text, "selection": selection, "range": range,
        }),
        Input::EndComposition => return plain("composeEnd"),
        Input::Focus => return plain("focus"),
        Input::Blur => return plain("blur"),
        Input::Outside => return plain("outside"),
        Input::Drag { phase, at, paths } => object!(global, {
            "t": "drag", "s": s, "e": ["enter", "over", "leave", "drop"][phase as usize],
            "x": at.x, "y": at.y, "sx": at.screen_x, "sy": at.screen_y, "paths": paths,
        }),
        Input::Perform {
            node,
            action,
            numbers,
            text,
            takes_focus,
        } => object!(global, {
            "t": "a11yAction", "s": s, "node": node, "action": action as u8,
            "numbers": numbers, "text": text, "takesFocus": takes_focus,
        }),
    })
}

impl Cursor {
    /// By a value of the CSS property.
    pub fn named(name: &[u8]) -> Cursor {
        match name {
            b"pointer" => Cursor::PointingHand,
            b"text" => Cursor::IBeam,
            b"vertical-text" => Cursor::VerticalIBeam,
            b"crosshair" | b"cell" => Cursor::Crosshair,
            b"grab" => Cursor::OpenHand,
            b"grabbing" | b"move" | b"all-scroll" => Cursor::ClosedHand,
            b"not-allowed" | b"no-drop" => Cursor::NotAllowed,
            b"alias" => Cursor::DragLink,
            b"copy" => Cursor::DragCopy,
            b"context-menu" => Cursor::ContextMenu,
            b"col-resize" => Cursor::ResizeColumn,
            b"row-resize" => Cursor::ResizeRow,
            b"w-resize" => Cursor::ResizeLeft,
            b"e-resize" => Cursor::ResizeRight,
            b"n-resize" => Cursor::ResizeUp,
            b"s-resize" => Cursor::ResizeDown,
            b"ew-resize" => Cursor::ResizeLeftRight,
            b"ns-resize" => Cursor::ResizeUpDown,
            b"nwse-resize" | b"nw-resize" | b"se-resize" => Cursor::ResizeUpLeftDownRight,
            b"nesw-resize" | b"ne-resize" | b"sw-resize" => Cursor::ResizeUpRightDownLeft,
            b"none" => Cursor::Hidden,
            _ => Cursor::Arrow,
        }
    }
}

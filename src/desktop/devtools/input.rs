//! The domain `Input`.

use bun_ui::protocol::{ALT, CONTROL, META, SHIFT};

use super::contents::Contents;
use crate::prelude::*;
use crate::value::Value;

/// The `key` and the `code` for a name in an accelerator.
pub(crate) fn describe_key(name: &str, is_shifted: bool) -> [String; 2] {
    let upper = name.to_uppercase();
    let key = match name.as_bytes() {
        b"space" => return [" ".into(), "Space".into()],
        [b'a'..=b'z'] => {
            let code = format!("Key{upper}");
            return [if is_shifted { upper } else { name.into() }, code];
        }
        [b'0'..=b'9'] => return [name.into(), format!("Digit{name}")],
        b"backspace" => "Backspace",
        b"delete" => "Delete",
        b"down" => "ArrowDown",
        b"end" => "End",
        b"enter" => "Enter",
        b"escape" => "Escape",
        b"home" => "Home",
        b"insert" => "Insert",
        b"left" => "ArrowLeft",
        b"pagedown" => "PageDown",
        b"pageup" => "PageUp",
        b"right" => "ArrowRight",
        b"tab" => "Tab",
        b"up" => "ArrowUp",
        _ => &upper,
    };
    let code = if key.chars().count() > 1 { key } else { "" };
    [key.into(), code.into()]
}

fn modifiers(params: &Value) -> u8 {
    let bits = params["modifiers"].int();
    let held = [(1, ALT), (2, CONTROL), (4, META), (8, SHIFT)].into_iter();
    held.filter(|it| bits & it.0 != 0)
        .fold(0, |all, it| all | it.1)
}

struct Touch {
    id: i32,
    point: Value,
}

#[derive(Default)]
pub(super) struct Input {
    touches: RefCell<Vec<Touch>>,
}

fn locate(contents: &Contents, point: &Value) -> JsResult<Value> {
    let zoom = contents.zoom();
    let origin = answer((ui()?.surface_metrics)(contents.surface()))?.bounds;
    let [x, y] = [point["x"].number() * zoom, point["y"].number() * zoom];
    Ok(record! { "x": x, "y": y, "sx": f64::from(origin.x) + x, "sy": f64::from(origin.y) + y })
}

fn key(contents: &Contents, params: &Value) -> JsResult<()> {
    let (kind, text, held) = (
        params["type"].text(),
        params["text"].text(),
        modifiers(params),
    );
    if kind != "char" {
        contents.simulate(&record! {
            "t": "key",
            "e": if kind == "keyUp" { "up" } else { "down" },
            "key": params["key"].text(),
            "code": params["code"].text(),
            "location": params["location"].int(),
            "repeat": params["autoRepeat"].is_truthy(),
            "m": held,
            "composing": false,
        })?;
    }
    if kind != "keyUp" && text >= " " && held & (CONTROL | ALT | META) == 0 {
        contents.simulate(&record! { "t": "text", "text": text, "key": kind != "char" })?;
    }
    Ok(())
}

fn mouse(contents: &Contents, params: &Value) -> JsResult<()> {
    let at = locate(contents, params)?.with("m", modifiers(params));
    let phase = match params["type"].text() {
        "mouseWheel" => {
            return contents.simulate(&at.and(&record! {
                "t": "wheel",
                "dx": &params["deltaX"],
                "dy": &params["deltaY"],
                "precise": true,
                "phase": "move",
            }));
        }
        "mousePressed" => "down",
        "mouseReleased" => "up",
        _ => "move",
    };
    if phase == "down" {
        contents.take_focus()?;
    }
    let button = (["left", "middle", "right", "back", "forward"].iter())
        .position(|it| params["button"].is(it));
    let is_pen = params["pointerType"].is("pen");
    let details = || {
        (params.pick(&["tangentialPressure", "tiltX", "tiltY", "twist"]))
            .with("pressure", &params["force"])
    };
    contents.simulate(&at.and(&record! {
        "t": if is_pen { "pen" } else { "mouse" },
        "e": phase,
        "b": button.unwrap_or(0),
        "buttons": params["buttons"].int(),
        "n": params["clickCount"].int(),
        "details": is_pen.then(details),
    }))
}

fn compose(contents: &Contents, params: &Value) -> JsResult<()> {
    contents.simulate(&match params["text"].text() {
        "" => record! { "t": "composeEnd" },
        text => record! {
            "t": "compose",
            "text": text,
            "selection": list![&params["selectionStart"], &params["selectionEnd"]],
        },
    })
}

impl Input {
    fn touch(&self, contents: &Contents, params: &Value) -> JsResult<()> {
        let mut now = Vec::new();
        for it in params["touchPoints"].items() {
            let or_one = |name: &str| it[name].as_number().unwrap_or(1.);
            let details = (it.clone().with("width", or_one("radiusX") * 2.))
                .with("height", or_one("radiusY") * 2.)
                .with("pressure", or_one("force"));
            let id = it["id"].int();
            let point = (locate(contents, it)?.with("id", id)).with("details", details);
            now.retain(|it: &Touch| it.id != id);
            now.push(Touch { id, point });
        }
        let (kind, mut before) = (params["type"].text(), self.touches.take());
        let has = |all: &[Touch], id| all.iter().any(|it| it.id == id);
        let ended = if kind == "touchEnd" && !now.is_empty() {
            let (ended, left) = before.into_iter().partition(|it| has(&now, it.id));
            *self.touches.borrow_mut() = left;
            (now, before) = (Vec::new(), Vec::new());
            ended
        } else {
            (before.extract_if(.., |it| !has(&now, it.id))).collect::<Vec<_>>()
        };
        let has_moved = |it: &&Touch| {
            (before.iter()).any(|was| was.id == it.id && was.point.to_json() != it.point.to_json())
        };
        let points = |all: &mut dyn Iterator<Item = &Touch>| all.map(|it| &it.point).collect();
        let events: [(_, Value); 3] = [
            (
                if kind == "touchCancel" {
                    "cancel"
                } else {
                    "end"
                },
                points(&mut ended.iter()),
            ),
            ("move", points(&mut now.iter().filter(has_moved))),
            (
                "start",
                points(&mut now.iter().filter(|it| !has(&before, it.id))),
            ),
        ];
        self.touches.borrow_mut().append(&mut now);
        for (phase, points) in events.into_iter().filter(|it| !it.1.items().is_empty()) {
            contents.simulate(&record! {
                "t": "touch",
                "e": phase,
                "points": points,
                "m": modifiers(params),
            })?;
        }
        Ok(())
    }

    /// `None` if there is no such command.
    pub(super) fn run(
        &self,
        contents: &Contents,
        method: &str,
        params: &Value,
    ) -> Option<JsResult<()>> {
        Some(match method {
            "Input.dispatchKeyEvent" => key(contents, params),
            "Input.dispatchMouseEvent" => mouse(contents, params),
            "Input.dispatchTouchEvent" => self.touch(contents, params),
            "Input.imeSetComposition" => compose(contents, params),
            "Input.insertText" => {
                contents.simulate(&record! { "t": "text", "text": &params["text"], "key": false })
            }
            _ => return None,
        })
    }
}

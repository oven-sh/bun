//! The domain `Input`.

use bun_ui::protocol::{ALT, CONTROL, META, SHIFT};

use bun_web::host::Keystroke;
use bun_web::input::{self, Action, Details, Finger, Mouse, Phase, Place};

use super::contents::Contents;
use crate::prelude::*;
use crate::value::Value;

fn modifiers(params: &Value) -> u8 {
    let bits = params["modifiers"].int();
    let held = [(1, ALT), (2, CONTROL), (4, META), (8, SHIFT)].into_iter();
    held.filter(|it| bits & it.0 != 0)
        .fold(0, |all, it| all | it.1)
}

#[derive(Default)]
pub(super) struct Input {
    fingers: RefCell<Vec<Finger>>,
}

fn locate(contents: &Contents, point: &Value) -> JsResult<Place> {
    let zoom = contents.zoom();
    let origin = answer((ui()?.surface_metrics)(contents.surface()))?.bounds;
    let [x, y] = [point["x"].number() * zoom, point["y"].number() * zoom];
    Ok(Place {
        window: [x, y],
        screen: [f64::from(origin.x) + x, f64::from(origin.y) + y],
        modifiers: modifiers(point).into(),
    })
}

fn details(it: &Value, size: [f64; 2], pressure: Option<f64>) -> Details {
    Details {
        size,
        pressure,
        tangential_pressure: it["tangentialPressure"].as_number().unwrap_or_default(),
        tilt: [it["tiltX"].int(), it["tiltY"].int()],
        twist: it["twist"].int(),
    }
}

fn insert(contents: &Contents, text: &str, is_typed: bool) -> JsResult<()> {
    contents.simulate(input::Input::Text {
        text: text.to_owned(),
        is_typed,
        range: None,
    })
}

fn key(contents: &Contents, params: &Value) -> JsResult<()> {
    let (kind, text, held) = (
        params["type"].text(),
        params["text"].text(),
        modifiers(params),
    );
    if kind != "char" {
        contents.simulate(input::Input::Key(Keystroke {
            is_down: kind != "keyUp",
            key: params["key"].text().to_owned(),
            code: params["code"].text().to_owned(),
            location: params["location"].int() as u32,
            modifiers: held.into(),
            repeats: params["autoRepeat"].is_truthy(),
            is_composing: false,
        }))?;
    }
    if kind != "keyUp" && text >= " " && held & (CONTROL | ALT | META) == 0 {
        insert(contents, text, kind != "char")?;
    }
    Ok(())
}

fn mouse(contents: &Contents, params: &Value) -> JsResult<()> {
    let place = locate(contents, params)?;
    let action = match params["type"].text() {
        "mouseWheel" => {
            return contents.simulate(input::Input::Wheel {
                place,
                delta: ["deltaX", "deltaY"].map(|it| params[it].as_number().unwrap_or_default()),
                is_precise: true,
                is_handled: false,
            });
        }
        "mousePressed" => Action::Down,
        "mouseReleased" => Action::Up,
        _ => Action::Move,
    };
    if action == Action::Down {
        contents.take_focus()?;
    }
    let button = (["left", "middle", "right", "back", "forward"].iter())
        .position(|it| params["button"].is(it));
    let mouse = Mouse {
        action,
        place,
        button: button.unwrap_or(0) as i16,
        buttons: params["buttons"].int() as u16,
        clicks: params["clickCount"].int(),
    };
    contents.simulate(match params["pointerType"].is("pen") {
        true => input::Input::Pen {
            mouse,
            details: details(params, [1.; 2], params["force"].as_number()),
        },
        false => input::Input::Mouse(mouse),
    })
}

fn compose(contents: &Contents, params: &Value) -> JsResult<()> {
    contents.simulate(match params["text"].text() {
        "" => input::Input::EndComposition,
        text => input::Input::Compose {
            text: text.to_owned(),
            selection: Some(["selectionStart", "selectionEnd"].map(|it| params[it].int() as u32)),
            range: None,
        },
    })
}

impl Input {
    fn touch(&self, contents: &Contents, params: &Value) -> JsResult<()> {
        let mut now = Vec::new();
        for it in params["touchPoints"].items() {
            let or_one = |name: &str| it[name].as_number().unwrap_or(1.);
            let size = [or_one("radiusX") * 2., or_one("radiusY") * 2.];
            let id = it["id"].int();
            now.retain(|it: &Finger| it.id != id);
            now.push(Finger {
                id,
                place: locate(contents, it)?,
                details: details(it, size, Some(or_one("force"))),
            });
        }
        let (kind, mut before) = (params["type"].text(), self.fingers.take());
        let has = |all: &[Finger], id| all.iter().any(|it| it.id == id);
        let ended = if kind == "touchEnd" && !now.is_empty() {
            let (ended, left) = before.into_iter().partition(|it| has(&now, it.id));
            *self.fingers.borrow_mut() = left;
            (now, before) = (Vec::new(), Vec::new());
            ended
        } else {
            (before.extract_if(.., |it| !has(&now, it.id))).collect::<Vec<_>>()
        };
        let has_moved = |it: &&Finger| (before.iter()).any(|was| was.id == it.id && was != *it);
        let is_new = |it: &&Finger| !has(&before, it.id);
        let events: [(_, Vec<_>); 3] = [
            (
                if kind == "touchCancel" {
                    Phase::Cancel
                } else {
                    Phase::End
                },
                ended,
            ),
            (Phase::Move, now.iter().filter(has_moved).copied().collect()),
            (Phase::Start, now.iter().filter(is_new).copied().collect()),
        ];
        self.fingers.borrow_mut().append(&mut now);
        for (phase, fingers) in events.into_iter().filter(|it| !it.1.is_empty()) {
            contents.simulate(input::Input::Touch {
                phase,
                fingers,
                modifiers: modifiers(params).into(),
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
            "Input.insertText" => insert(contents, params["text"].text(), false),
            _ => return None,
        })
    }
}

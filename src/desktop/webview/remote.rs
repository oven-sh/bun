//! What a `WebContents` and an `<iframe>` in the web engine have in common.

use std::rc::Rc;

use bun_ui::protocol::Key;

use super::embedded::Embedded;
use super::embedder::{self, Holder};
use super::engine::{self, Engine, Kind, Target};
use super::frame::{self, FIRST_PROCESS_ID, RemoteFrame};
use super::guest::Guest;
use super::view::{Painted, View, WISH_TO_PRINT};
use super::{print, wire};
use crate::accelerator::Stroke;
use crate::generated_bindgen::webview::js_WebEngineRemote as fields;
use crate::menu::MenuItem;
use crate::prelude::*;
use crate::realm;
use crate::task;
use crate::value::Value;
use crate::window::Window;
use crate::{app, dialog};

pub(super) enum Role {
    Guest(Box<Guest>),
    Frame(Embedded),
}

pub(crate) struct Remote {
    pub(super) view: Rc<View>,
    pub(super) session: i32,
    pub(super) mirrored: RefCell<Value>,
    pub(super) role: Role,
}

pub(crate) fn field(value: Option<JSValue>) -> JSValue {
    value.unwrap_or(JSValue::UNDEFINED)
}

/// An event that the engine has emitted.
pub(super) struct Emitted {
    pub(super) name: String,
    /// The properties of the event object, or `false` if there is none.
    pub(super) details: Value,
    pub(super) arguments: Vec<Value>,
}

impl Emitted {
    pub(super) fn argument(&self, index: usize) -> &Value {
        self.arguments.get(index).unwrap_or(&Value::Undefined)
    }

    /// `then` gets the event object and an array of the arguments.
    pub(super) fn with<T>(
        self,
        then: impl FnOnce(&str, Option<&Event>, JSValue) -> JsResult<T>,
    ) -> JsResult<T> {
        let has_event = self.details.is_truthy();
        let both = engine::to_js(&list![self.details, Value::List(self.arguments)])?;
        let (details, event) = (both.get_index(global(), 0)?, has_event.then(Event::create));
        if let Some(event) = event.filter(|_| details.is_object()) {
            for name in elements(details.keys(global())?)? {
                JSValue::put_to_property_key(
                    event.to_js(),
                    global(),
                    name,
                    get_by_value(global(), details, name)?,
                )?;
            }
        }
        then(&self.name, event, both.get_index(global(), 1)?)
    }

    /// As [`Emitted::with`], after the listeners of the `webContents` have been called.
    pub(super) fn on<T>(
        mut self,
        contents: JSValue,
        then: impl FnOnce(Option<&Event>) -> JsResult<T>,
    ) -> JsResult<T> {
        let ends_with_ids = ["did-frame-", "did-fail-"]
            .iter()
            .any(|it| self.name.starts_with(it))
            || matches!(
                &*self.name,
                "did-navigate-in-page"
                    | "did-start-navigation"
                    | "did-redirect-navigation"
                    | "will-navigate"
                    | "will-redirect"
                    | "will-frame-navigate"
            );
        if let (true, [.., Value::Number(process @ 1.0..), _]) =
            (ends_with_ids, &mut *self.arguments)
        {
            *process += f64::from(FIRST_PROCESS_ID);
        }
        self.with(|name, event, arguments| {
            emit_all(
                contents,
                name,
                event.map(JsInterface::to_js).as_slice(),
                arguments,
            )?;
            let is_for_app = matches!(
                name,
                "certificate-error" | "login" | "select-client-certificate" | "render-process-gone"
            );
            if let Some(event) = event.filter(|it| is_for_app && !it.get_default_prevented()) {
                emit_all(app::object(), name, &[event.to_js(), contents], arguments)?;
            }
            then(event)
        })
    }
}

pub(super) fn emit_all(
    emitter: JSValue,
    name: &str,
    first: &[JSValue],
    rest: JSValue,
) -> JsResult<()> {
    with_elements_after(&[&[js(name)?], first].concat(), rest, |all| {
        invoke(emitter, "emit", all)
    })
    .map(drop)
}

pub(super) fn is_about_main_frame(emitted: &Emitted) -> bool {
    match (&emitted.details["isMainFrame"], &*emitted.arguments) {
        (Value::Bool(it), _) | (_, [.., Value::Bool(it), _, _]) => *it,
        _ => false,
    }
}

pub(super) fn is_prevented(event: Option<&Event>) -> JsResult<bool> {
    Ok(event.is_some_and(Event::get_default_prevented))
}

impl Remote {
    pub(super) fn create(
        contents: JSValue,
        state: JSValue,
        view: Rc<View>,
        session: i32,
        role: Role,
    ) -> JsResult<&'static Remote> {
        let remote = fields::create(
            heap(),
            Remote {
                view,
                session,
                mirrored: Value::empty().into(),
                role,
            },
        );
        fields::set_contents(remote, contents);
        fields::set_state(remote, state);
        fields::set_frames(remote, array(&[])?);
        fields::set_cleanups(remote, wire::create_set()?);
        remote.engine().add_view(remote.view.id, remote);
        Ok(remote)
    }

    pub(crate) fn engine(&self) -> &Rc<Engine> {
        &self.view.engine
    }

    pub(super) fn contents(&self) -> JSValue {
        field(fields::contents(self))
    }

    pub(super) fn holder(&self) -> &'static dyn Holder {
        embedder::holder(field(fields::state(self)))
    }

    pub(crate) fn cleanups(&self) -> JSValue {
        field(fields::cleanups(self))
    }

    pub(crate) fn all_frames(&self) -> JSValue {
        field(fields::frames(self))
    }

    pub(super) fn embedder(&self) -> Option<JSValue> {
        fields::embedder(self)
    }

    pub(super) fn frames(&self) -> impl Iterator<Item = JsResult<&'static RemoteFrame>> {
        instances(field(fields::frames(self)))
    }

    pub(crate) fn main_frame(&self) -> JsResult<JSValue> {
        field(fields::frames(self)).get_index(global(), 0)
    }

    pub(super) fn window(&self) -> Option<&'static Window> {
        self.holder().window()
    }

    pub(super) fn is_visible(&self) -> JsResult<bool> {
        self.holder().is_visible()
    }

    pub(super) fn shortcut(&self, key: &Key) -> JsResult<Option<&'static MenuItem>> {
        match self.window() {
            Some(window) if !self.holder().ignores_menu_shortcuts() => {
                window.shortcut(&Stroke::new(&key.key, &key.code, key.modifiers))
            }
            _ => Ok(None),
        }
    }

    /// From CSS pixels of the page to pixels of the surface.
    pub(super) fn to_surface(&self, [x, y]: [f64; 2]) -> JsResult<[f64; 2]> {
        let [left, top] = self.origin_of_element();
        Ok([x + left, y + top].map(|it| it * self.view.zoom.get()))
    }

    pub(super) fn painted(&self, painted: &Painted) -> JsResult<()> {
        match &self.role {
            Role::Guest(guest) => guest.painted(self),
            Role::Frame(frame) => frame.painted(self, painted),
        }
    }

    pub(super) fn may_drag_window(&self) -> JsResult<bool> {
        let main = self
            .frames()
            .next()
            .transpose()?
            .filter(|_| self.embedder().is_none());
        Ok(main.is_some_and(|it| bun_web::trust::is_trusted_origin(it.origin().as_bytes())))
    }

    pub(super) fn show_tooltip(&self, text: &str) -> JsResult<()> {
        self.tell_element(bun_web::page::News::Tooltip(text.to_owned()))
    }

    pub(super) fn take_focus(&self) -> JsResult<()> {
        self.tell_element(bun_web::page::News::Focus)
    }

    pub(super) fn apply_settings(&self, apply: &dyn Fn(&str, Value)) -> JsResult<()> {
        let Some(settings) = self.holder().settings()? else {
            return Ok(());
        };
        with_elements(wire::items_of(settings)?, |all| {
            (all.as_chunks().0.iter()).try_for_each(|[name, values]| {
                apply(&text_of(*name)?, engine::from_js(*values)?);
                Ok(())
            })
        })
    }

    pub(super) fn ask(&self, method: &str, arguments: Value) -> engine::Awaited {
        self.view.wake();
        self.engine()
            .perform(Target::View(self.view.id), method, arguments)
    }

    pub(super) fn update(&self, mut mirrored: Value) -> JsResult<()> {
        if let Role::Guest(guest) = &self.role {
            let Some(disclosed) = guest.disclose(mirrored) else {
                return Ok(());
            };
            mirrored = disclosed;
        }
        if mirrored["pid"].as_number() != self.mirrored.borrow()["pid"].as_number() {
            self.engine().measure();
        }
        let (before, now) = (field(fields::frames(self)), array(&[])?);
        for frame in mirrored.take("frames").items() {
            let frame = frame::update(self.engine(), frame);
            if RemoteFrame::is(frame) {
                now.push(global(), frame)?;
            }
        }
        fields::set_frames(self, now);
        let kept = elements(now)?;
        for frame in instances::<RemoteFrame>(before) {
            frame.map(|it| {
                if !kept.contains(&it.to_js()) {
                    it.detach()
                }
            })?;
        }
        before.ensure_still_alive();
        self.mirrored.replace(mirrored);
        match &self.role {
            Role::Guest(guest) => guest.update(self),
            Role::Frame(_) => Ok(()),
        }
    }

    /// Returns whether the default was prevented.
    pub(super) fn emit(&self, emitted: Emitted) -> JsResult<bool> {
        match &self.role {
            Role::Guest(guest) => guest.emit(self, emitted),
            Role::Frame(frame) => frame.emit(self, emitted),
        }
    }

    pub(super) fn show_dialog(&self, about: &Value, close: Value) -> JsResult<()> {
        let kind = about["dialogType"].text();
        if about["messageText"].is(WISH_TO_PRINT) {
            close.call(list![true, ""]);
            let frame = cast::<RemoteFrame>(engine::to_js(&about["frame"])?)
                .filter(|_| self.engine().kind == Kind::Electron);
            let (frame, nothing) = (frame.map(|it| it.id), JSValue::UNDEFINED);
            return print::print_remote(self, frame, Value::Undefined, nothing);
        }
        if kind == "prompt" || get(self.holder().preferences(), "disableDialogs")?.to_boolean() {
            close.call(list![false, ""]);
            return Ok(());
        }
        let controller = realm::construct("AbortController", &[])?;
        fields::set_dialog(self, controller);
        let origin = cast::<RemoteFrame>(engine::to_js(&about["frame"])?).map(RemoteFrame::origin);
        let buttons = if kind == "confirm" {
            list!["OK", "Cancel"]
        } else {
            list!["OK"]
        };
        let signal = get(controller, "signal")?;
        let options = object!({
            // It must not pass for a dialog of the app.
            "message": format!("{} says", origin.as_deref().unwrap_or("A frame")),
            "detail": &about["messageText"],
            "cancelId": buttons.items().len() as u32 - 1,
            "buttons": &buttons,
            "signal": signal,
        });
        let (shown, signal) = (
            invoke(
                dialog::object(),
                "showMessageBox",
                &[field(self.window().map(Window::to_js)), options],
            )?,
            keep(signal),
        );
        then(shown, move |result| match result {
            Ok(_) if get(signal.get(), "aborted")?.to_boolean() => Ok(()),
            Ok(result) => {
                close.call(list![get(result, "response")? == 0.into(), ""]);
                Ok(())
            }
            Err(_) => {
                close.call(list![false, ""]);
                Ok(())
            }
        })
    }

    pub(super) fn cancel_dialogs(&self) -> JsResult<()> {
        fields::dialog(self).map_or(Ok(()), |it| invoke(it, "abort", &[]).map(drop))
    }

    /// Returns the description of the view for the window that the page opens, if it may.
    pub(super) fn open(&self, details: &Value) -> JsResult<Value> {
        let opened = match fields::popup(self) {
            Some(popup) => {
                fields::set_popup(self, None);
                Some(popup)
            }
            None => self.holder().open(self, engine::to_js(details)?)?,
        };
        opened.map_or(Ok(Value::Undefined), Remote::describe_guest)
    }

    pub(super) fn destroyed(&self) -> JsResult<()> {
        if self.is_committed()? {
            invoke(self.contents(), "close", &[]).map(drop)
        } else {
            Ok(())
        }
    }

    pub(super) fn engine_closed(&self) -> JsResult<()> {
        match &self.role {
            Role::Guest(guest) => guest.engine_closed(self),
            Role::Frame(frame) => frame.crashed(self),
        }
    }

    pub(crate) fn end(&self) -> JsResult<()> {
        match &self.role {
            Role::Guest(guest) if guest.is_destroyed.replace(true) => return Ok(()),
            Role::Guest(guest) => {
                guest.end_relay();
                if self.is_committed()? {
                    self.host().set_guest(None);
                }
                fields::inspector(self).map(|it| it.end()).transpose()?;
            }
            Role::Frame(_) => drop(fields::carrier(self).map(|it| it.close()).transpose()?),
        }
        self.cancel_dialogs()?;
        with_elements(wire::items_of(field(fields::cleanups(self)))?, |all| {
            all.iter().try_for_each(|it| call(*it, &[]).map(drop))
        })?;
        self.view.destroy()?;
        self.frames()
            .try_for_each(|it| it.map(RemoteFrame::detach))?;
        fields::set_frames(self, array(&[])?);
        Ok(())
    }

    pub(crate) fn focused_frame(&self) -> JsResult<JSValue> {
        let focused = self
            .engine()
            .object(self.mirrored.borrow()["focusedFrame"].int());
        match (focused, &self.role) {
            (Some(it), _) => Ok(it),
            (None, Role::Frame(_)) => self.main_frame(),
            (None, Role::Guest(_)) => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn mirrored(&self, name: &str) -> Value {
        self.mirrored.borrow()[name].clone()
    }

    pub(crate) fn tell_page(&self, method: &str, values: &[JSValue]) -> JsResult<()> {
        self.view.tell_page(method, engine::list_from_js(values)?);
        Ok(())
    }

    pub(crate) fn perform(&self, method: &str, values: &[JSValue]) -> JsResult<JSValue> {
        Ok(engine::promise(
            self.ask(method, engine::list_from_js(values)?),
        ))
    }

    pub(crate) fn edit(&self, command: &str) {
        self.view.edit(command.to_owned());
    }

    /// The id of the session, and that of the target.
    pub(crate) fn start_session(&self) -> impl Future<Output = Option<[Rc<str>; 2]>> + use<> {
        let view = Rc::clone(&self.view);
        async move { Some([view.attach().await?, view.target_id.clone().await?]) }
    }

    pub(crate) fn wake(&self) {
        self.view.wake();
    }

    pub(crate) fn idle(&self) -> task::Later<()> {
        self.view.when_idle()
    }
}

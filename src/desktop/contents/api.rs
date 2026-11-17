//! The methods that apps call. While the page is in the web engine, most of them go there.

use std::rc::Rc;

use bun_jsc::JSMap;
use bun_ui::protocol::{SurfaceCommand, WindowCommand};
use bun_web::headers::HeaderList;
use bun_web::url::{Url, percent_decode};

use bun_web::request::Destination;

use super::load::{How, Navigation, Request};
use super::page::Page;
use super::{
    Contents, Kind, Numbers as _, Values, all, field, fields, lazily, nothing, object_in, of_app,
    parts, spread, text_at, text_if_any, without_hash,
};
use crate::devtools::{self, debugger::Debugger};
use crate::generated_bindgen::contents::{
    CloseOptions, ContentsInput, LoadFileOptions, LoadUrlOptions,
};
use crate::ipc::IpcMain;
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::session::Session;
use crate::text::{split, split_once};
use crate::webview::remote::Remote;
use crate::webview::{print, wire};
use crate::{accelerator, app, files, process, task};

fn raw<'b>(values: Values<'_, 'b>) -> &'b [JSValue] {
    JsLocal::to_js_slice(values)
}

fn level_of(factor: f64) -> f64 {
    factor.ln() / 1.2f64.ln()
}

/// `None` unless it says all of what it is.
pub(super) fn rectangle(value: JSValue) -> JsResult<Option<Rect>> {
    if !value.is_object() {
        return Ok(None);
    }
    let member = |name| JsResult::Ok(get(value, name)?.get_number().map(finite));
    Ok(
        match [
            member("x")?,
            member("y")?,
            member("width")?,
            member("height")?,
        ] {
            [Some(x), Some(y), Some(width), Some(height)] => Some(Rect {
                x,
                y,
                width,
                height,
            }),
            _ => None,
        },
    )
}

fn bytes_to_post(parts: JSValue) -> JsResult<Vec<u8>> {
    with_elements(parts, |parts| {
        let mut all = Vec::new();
        for &part in parts {
            match get(part, "bytes")?.as_array_buffer(global()) {
                Some(bytes) => all.extend_from_slice(bytes.byte_slice()),
                None => all.append(&mut files::read_with_node(&text_of(get(
                    part, "filePath",
                )?)?)?),
            }
        }
        Ok(all)
    })
}

/// They have nothing to act on in this process.
macro_rules! only_for_guest {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
            self.told_guest($name, raw(values)).map(drop)
        }
    )*};
}

macro_rules! settings_of_guest {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
            self.remember($name, raw(values))
        }
    )*};
}

macro_rules! edits {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method(&self, _: Cx<'_, '_>) -> JsResult<()> {
            self.edit($name)
        }
    )*};
}

macro_rules! mirrored {
    ($($method:ident: $name:literal, |$it:pat_param| $here:expr;)*) => {$(
        pub(crate) fn $method(&self, _: Cx<'_, '_>) -> JsResult<bool> {
            let $it = self;
            self.guest().map_or_else(|| $here, |it| Ok(it.mirrored($name).is_truthy()))
        }
    )*};
}

macro_rules! promises {
    ($($method:ident: $name:literal, |$it:pat_param, $given:pat_param| $here:expr;)*) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<JSValue> {
            if let Some(guest) = self.started_guest()? {
                return guest.perform($name, raw(values));
            }
            let ($it, $given) = (self, raw(values));
            $here
        }
    )*};
}

impl Contents {
    fn check(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            Err(type_error(format_args!("Object has been destroyed")))
        } else {
            Ok(())
        }
    }

    /// False if there is none.
    fn told_guest(&self, method: &str, arguments: &[JSValue]) -> JsResult<bool> {
        self.guest()
            .map(|it| it.tell_page(method, arguments))
            .transpose()
            .map(|it| it.is_some())
    }

    pub(super) fn settings(&self) -> JsResult<JSValue> {
        lazily(
            fields::settings(self),
            || Ok(JSMap::create(global())),
            |it| fields::set_settings(self, it),
        )
    }

    /// The arguments of a setter, for a guest to come.
    fn remember(&self, setter: &str, arguments: &[JSValue]) -> JsResult<()> {
        let (settings, name, values) = (map_in(self.settings()?), js(setter)?, array(arguments)?);
        settings.remove(global(), name)?;
        settings.set(global(), name, values)?;
        self.guest().map_or(Ok(()), |it| it.set(setter, values))
    }

    fn edit(&self, command: &str) -> JsResult<()> {
        match self.guest() {
            Some(guest) => guest.edit(command),
            None if self.is_destroyed.get() => {}
            None => self.started_page()?.tell("edit", &[js(command)?])?,
        }
        Ok(())
    }

    pub(super) fn main_frame(&self) -> JsResult<JSValue> {
        self.guest()
            .map_or(Ok(None), |it| it.main_frame().map(Some))
            .map(|it| object_in(it).unwrap_or_else(|| self.page().handle()))
    }

    pub(super) fn user_agent(&self) -> JsResult<String> {
        self.user_agent
            .borrow()
            .clone()
            .map_or_else(|| self.session.user_agent(), Ok)
    }

    pub(super) fn title(&self) -> String {
        let page = self.page();
        let title = self
            .item()
            .map_or_else(|| page.title(), |it| it.borrow().title.clone());
        if !title.is_empty() || page.is_initial() {
            return title;
        }
        let url = page.url_in_history();
        if let Some(file) = Url::parse(url.as_bytes()).filter(|it| it.scheme() == b"file") {
            return string(&percent_decode(bun_paths::basename_posix(file.path())));
        }
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .unwrap_or(&url);
        rest.strip_suffix('/').unwrap_or(rest).to_owned()
    }

    pub(crate) fn take_focus(&self) -> JsResult<()> {
        self.check()?;
        self.tell_surface(SurfaceCommand::Focus)
    }

    fn zoom_key(&self) -> String {
        let url = self.page().client.url();
        if url.host().is_empty() {
            without_hash(&self.page().url()).to_owned()
        } else {
            string(url.host())
        }
    }

    fn zoom_level(&self) -> f64 {
        if let Some(guest) = self.guest() {
            return guest.mirrored("zoomLevel").number();
        }
        let shared = || self.session.zoom_level(&self.zoom_key());
        self.own_zoom
            .get()
            .or_else(shared)
            .unwrap_or_else(|| level_of(self.preferences.zoom_factor))
    }

    pub(super) fn zoom_factor(&self) -> f64 {
        let factor = 1.2f64.powf(self.zoom_level());
        format!("{factor:.11e}").parse().unwrap_or(factor)
    }

    fn change_zoom_level(&self, level: f64) -> JsResult<()> {
        self.check()?;
        let mode = self.zoom_mode.borrow().clone();
        if mode != "disabled" {
            match &*mode {
                "default" => self.session.set_zoom_level(&self.zoom_key(), level),
                _ => self.own_zoom.set(Some(level)),
            }
            of_app()
                .filter(|it| same(it.session, self.session))
                .try_for_each(Contents::environment_changed)?;
        }
        self.remember("setZoomLevel", &[js(level)?])
    }

    fn load_for_app(&self, url: &str, navigation: Navigation) -> JsResult<JSValue> {
        let result = Deferred::new();
        let promise = result.promise();
        JsLocal::new(heap(), promise)
            .as_promise()
            .into_iter()
            .for_each(|it| it.mark_as_handled());
        self.load(url, navigation, Some(result)).map(|()| promise)
    }

    pub(super) fn restore(&self, index: usize, url: &str) -> JsResult<JSValue> {
        self.load_for_app(url, Navigation::new(How::Traverse(index)))
    }

    fn execute_when_loaded(
        &self,
        world: u32,
        code: JSValue,
        gesture: JSValue,
    ) -> JsResult<JSValue> {
        let is_by_user = gesture.to_boolean();
        self.check()?;
        let stopped = match self.is_busy() || self.page().is_initial() {
            true => invoke(
                realm::require(global(), Module::Events)?,
                "once",
                &[self.to_js(), js("did-stop-loading")?],
            )?,
            false => JSValue::UNDEFINED,
        };
        let (this, code, result) = (Root::new(self), keep(code), Deferred::new());
        let promise = result.promise();
        then(stopped, move |stopped| {
            let page = stopped
                .map_err(|it| global().throw_value(it))
                .and_then(|_| this.get().started_page());
            result.settle(page.map(|it| it.execute(world, code.get(), is_by_user)))
        })?;
        Ok(promise)
    }

    fn insert(&self, given: &[JSValue]) -> JsResult<()> {
        self.page().tell("insertText", &[js(text_at(given, 0)?)?])
    }

    pub(crate) fn nothing(&self) {}

    pub(crate) fn no(&self) -> bool {
        false
    }

    pub(crate) fn get_nobody(&self) -> JSValue {
        JSValue::NULL
    }

    pub(crate) fn get_id(&self) -> u32 {
        self.id
    }

    pub(crate) fn get_ipc(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        IpcMain::create()
    }

    pub(crate) fn get_session(&self) -> &Session {
        self.session
    }

    pub(crate) fn get_navigation_history(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        parts::navigation_history(self)
    }

    pub(crate) fn get_main_frame(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.main_frame()
    }

    pub(crate) fn get_focused_frame(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let found = self.guest().map_or_else(
            || self.page().ask("focusedFrame", &[]),
            Remote::focused_frame,
        )?;
        match found.is_object() {
            true => Ok(found),
            false if self.is_focused() => self.main_frame(),
            false => Ok(JSValue::NULL),
        }
    }

    pub(crate) fn get_opener(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.opener_for_app()
    }

    pub(super) fn opener_for_app(&self) -> JsResult<JSValue> {
        let opener = object_in(fields::opener(self)).unwrap_or(JSValue::NULL);
        Ok(match cast::<Page>(opener) {
            Some(page) if page.is_disposed() => JSValue::NULL,
            Some(page) => page.handle(),
            None => opener,
        })
    }

    pub(crate) fn get_debugger(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        if let Some(guest) = self.started_guest()? {
            return Ok(guest.debugger().to_js());
        }
        if fields::inspector(self).is_none() {
            fields::set_inspector(self, Some(Debugger::create(self)));
        }
        Ok(field(fields::inspector(self).map(JsInterface::to_js)))
    }

    pub(crate) fn get_audio_muted(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        Ok(self.is_muted.get())
    }

    pub(crate) fn set_audio_muted<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        self.is_muted.set(value.to_js().to_boolean());
        self.remember("setAudioMuted", &[value.to_js()])
    }

    pub(crate) fn get_background_throttling(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        Ok(false)
    }

    pub(crate) fn set_background_throttling<'a>(
        &self,
        _: Cx<'a, '_>,
        value: JsLocal<'a>,
    ) -> JsResult<()> {
        self.remember("setBackgroundThrottling", &[value.to_js()])
    }

    pub(crate) fn get_frame_rate(&self, _: Cx<'_, '_>) -> JsResult<f64> {
        Ok(60.)
    }

    pub(crate) fn set_frame_rate<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        self.remember("setFrameRate", &[value.to_js()])
    }

    pub(crate) fn get_user_agent(&self, _: Cx<'_, '_>) -> JsResult<String> {
        self.owner().user_agent()
    }

    pub(crate) fn set_user_agent<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        self.user_agent.replace(text_if_any(value.to_js())?);
        super::alive()
            .filter(|it| same(it.owner(), self))
            .try_for_each(|it| it.page().update_agent())?;
        self.remember("setUserAgent", &[value.to_js()])
    }

    pub(crate) fn get_zoom_factor(&self, _: Cx<'_, '_>) -> JsResult<f64> {
        Ok(self.zoom())
    }

    pub(crate) fn zoom(&self) -> f64 {
        self.owner().zoom_factor()
    }

    pub(crate) fn set_zoom_factor<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        let factor = Some(value.to_js().to_number(global())?).filter(|it| *it > 0.);
        let factor = factor.ok_or_else(|| {
            error(format_args!(
                "'zoomFactor' must be a double greater than 0.0"
            ))
        })?;
        self.change_zoom_level(level_of(factor))
    }

    pub(crate) fn get_zoom_level(&self, _: Cx<'_, '_>) -> JsResult<f64> {
        Ok(self.zoom_level())
    }

    pub(crate) fn set_zoom_level<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        self.change_zoom_level(value.to_js().to_number(global())?)
    }

    pub(crate) fn get_zoom_mode(&self, _: Cx<'_, '_>) -> JsResult<String> {
        Ok(self.zoom_mode.borrow().clone())
    }

    pub(crate) fn set_zoom_mode<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        let mode = text_of(value.to_js())?;
        self.own_zoom.set(match &*mode {
            "default" => None,
            "disabled" => Some(0.),
            _ => Some(self.zoom_level()),
        });
        self.zoom_mode.replace(mode);
        self.environment_changed()?;
        self.remember("setZoomMode", &[value.to_js()])
    }

    pub(crate) fn can_go_back(&self) -> bool {
        self.can_go_to_offset(-1)
    }

    pub(crate) fn can_go_forward(&self) -> bool {
        self.can_go_to_offset(1)
    }

    pub(crate) fn can_go_to_offset(&self, offset: i32) -> bool {
        self.history.borrow().at_offset(offset).is_some()
    }

    pub(super) fn go_by(&self, offset: i32) -> JsResult<()> {
        let index = self.history.borrow().at_offset(offset);
        index.map_or(Ok(()), |it| self.traverse(it, true))
    }

    pub(crate) fn go_back(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.go_by(-1)
    }

    pub(crate) fn go_forward(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.go_by(1)
    }

    pub(crate) fn go_to_offset(&self, _: Cx<'_, '_>, offset: i32) -> JsResult<()> {
        self.go_by(offset)
    }

    pub(crate) fn go_to_index(&self, _: Cx<'_, '_>, index: i32) -> JsResult<()> {
        self.traverse(index as usize, true)
    }

    pub(super) fn forget_history(&self) {
        self.guest().into_iter().for_each(Remote::clear_history);
        let mut history = self.history.borrow_mut();
        let current = history.entries.get(history.index).cloned();
        (history.entries, history.index) = (current.into_iter().collect(), 0);
    }

    pub(crate) fn clear_history(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.forget_history();
        Ok(())
    }

    pub(crate) fn load_url<'a>(
        &self,
        _: Cx<'a, '_>,
        url: &[u8],
        options: &LoadUrlOptions<'a>,
    ) -> JsResult<JSValue> {
        self.check()?;
        let (url, lines, mut request) = (
            string(url),
            string(options.extra_headers.unwrap_or_default()),
            Request::default(),
        );
        for (name, value) in split(&lines, "\n")
            .filter_map(|it| split_once(it, ":"))
            .filter(|it| !it.0.is_empty())
        {
            request
                .headers
                .append(name.as_bytes(), value.trim().as_bytes());
        }
        let (parts, referrer) = (options.post_data.to_js(), options.http_referrer.to_js());
        request.body = parts
            .is_array()
            .then(|| bytes_to_post(parts))
            .transpose()?
            .map(Into::into);
        request.referrer = text_if_any(if referrer.is_object() {
            get(referrer, "url")?
        } else {
            referrer
        })?;
        let navigation = Navigation {
            request: Rc::new(request),
            user_agent: options.user_agent.map(string),
            wants_web_engine: options.web_engine,
            base_of_data: options.base_url_for_data_url.map(string),
            starts_over: url == self.page().url_in_history(),
            ..Navigation::new(if url == self.page().url_in_history() {
                How::Reload
            } else {
                How::Push
            })
        };
        self.load_for_app(&url, navigation)
    }

    pub(crate) fn load_file<'a>(
        &self,
        _: Cx<'a, '_>,
        file: JsLocal<'a>,
        options: &LoadFileOptions<'a>,
    ) -> JsResult<JSValue> {
        let file = text_if_any(file.to_js())?
            .ok_or_else(|| type_error(format_args!("Must pass filePath as a string")))?;
        let path = if files::is_absolute(&file) {
            file
        } else {
            files::join(&[app::path()?, &file])
        };
        let url = realm::construct("URL", &[js(files::to_url(&path))?])?;
        let search = match options.search {
            Some(search) => js(search)?,
            None => invoke(
                realm::construct("URLSearchParams", &[options.query.to_js()])?,
                "toString",
                &[],
            )?,
        };
        assign(url, "search", search)?;
        assign(url, "hash", js(options.hash.unwrap_or_default())?)?;
        invoke(self.to_js(), "loadURL", &[get(url, "href")?])
    }

    pub(crate) fn reload_for_app(&self, method: &str) -> JsResult<()> {
        if self.told_guest(method, &[])? {
            return Ok(());
        }
        self.check()?;
        self.reload_page(false)
    }

    pub(crate) fn reload(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.reload_for_app("reload")
    }

    pub(crate) fn reload_ignoring_cache(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.reload_for_app("reloadIgnoringCache")
    }

    pub(crate) fn stop(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.stop_for_app()
    }

    pub(crate) fn stop_for_app(&self) -> JsResult<()> {
        if self.told_guest("stop", &[])? {
            Ok(())
        } else {
            self.stop_everything()
        }
    }

    pub(crate) fn destroy(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.destroy_now()
    }

    pub(crate) fn focus(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.take_focus()
    }

    pub(crate) fn forcefully_crash_renderer(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if self.told_guest("forcefullyCrashRenderer", &[])? {
            Ok(())
        } else {
            self.crash("killed")
        }
    }

    pub(crate) fn invalidate(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if !self.told_guest("invalidate", &[])? {
            bun_ui::queue::request_frame(self.surface);
        }
        Ok(())
    }

    pub(crate) fn close(&self, _: Cx<'_, '_>, options: &CloseOptions) -> JsResult<()> {
        if options.wait_for_before_unload {
            if self.told_guest("close", &[object!({ "waitForBeforeUnload": true })])? {
                return Ok(());
            }
            if !self.is_destroyed.get() && !self.may_unload(true)? {
                app::close_cancelled();
                return Ok(());
            }
        }
        self.close_now()
    }

    pub(crate) fn get_url(&self, _: Cx<'_, '_>) -> JsResult<String> {
        self.url_for_app()
    }

    pub(crate) fn url_for_app(&self) -> JsResult<String> {
        self.check()?;
        Ok(self.guest().map_or_else(
            || {
                (self.crashed_at.borrow().clone())
                    .unwrap_or_else(|| parts::visible_url(self.page()))
            },
            |it| it.mirrored("url").text().to_owned(),
        ))
    }

    pub(crate) fn get_title(&self, _: Cx<'_, '_>) -> JsResult<String> {
        self.title_for_app()
    }

    pub(crate) fn title_for_app(&self) -> JsResult<String> {
        self.check()?;
        Ok(self
            .guest()
            .map_or_else(|| self.title(), |it| it.mirrored("title").text().to_owned()))
    }

    pub(crate) fn get_type(&self, _: Cx<'_, '_>) -> JsResult<&'static str> {
        Ok(match self.kind.get() {
            Kind::Window => "window",
            Kind::BrowserView => "browserView",
            Kind::Remote => "remote",
            Kind::Frame => "frame",
            Kind::Print => "print",
        })
    }

    pub(crate) fn get_media_source_id(&self, _: Cx<'_, '_>) -> JsResult<String> {
        Ok(format!("web-contents-media-stream://{}:1", self.id))
    }

    pub(crate) fn get_web_rtciphandling_policy(&self, _: Cx<'_, '_>) -> JsResult<String> {
        let values = map_in(self.settings()?).get(global(), js("setWebRTCIPHandlingPolicy")?)?;
        let policy = if values.is_array() {
            text_if_any(values.get_index(global(), 0)?)?
        } else {
            None
        };
        Ok(policy.unwrap_or_else(|| "default".to_owned()))
    }

    pub(crate) fn is_loading(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        self.check().map(|()| self.loading.is_reported())
    }

    mirrored! {
        is_loading_main_frame: "isLoadingMainFrame", |it| it.check().map(|()| it.is_busy());
        is_waiting_for_response: "isWaitingForResponse", |it| Ok(it.loading.is_pending());
        is_crashed: "isCrashed", |it| Ok(it.crashed_at.borrow().is_some());
        is_currently_audible: "isCurrentlyAudible", |_| Ok(false);
        is_dev_tools_opened: "isDevToolsOpened", |_| Ok(false);
    }

    pub(crate) fn is_destroyed(&self) -> bool {
        self.is_destroyed.get()
    }

    pub(crate) fn is_focused(&self) -> bool {
        all().focused.get() == self.id && !self.is_destroyed.get()
    }

    pub(crate) fn get_osprocess_id(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(self
            .guest()
            .map_or_else(|| process::id().into(), |it| it.mirrored("pid").number()))
    }

    pub(crate) fn get_process_id(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        match self.guest().map(Remote::main_frame).transpose()? {
            Some(frame) => {
                if frame.is_object() {
                    get(frame, "processId")
                } else {
                    Ok(0.into())
                }
            }
            None => js(self.id),
        }
    }

    pub(crate) fn get_owner_browser_window(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(self.window().map(JsInterface::to_js))
    }

    pub(crate) fn get_last_web_preferences(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let defaults =
            object!({ "contextIsolation": true, "nodeIntegration": false, "sandbox": true });
        let all = spread(defaults, self.preferences())?;
        all.delete_property(global(), b"session").map(|_| all)
    }

    pub(crate) fn get_or_create_dev_tools_target_id(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&*devtools::target_id_of(self.to_js()))
    }

    pub(crate) fn get_all_shared_workers(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        array(&[])
    }

    edits! {
        undo: "undo",
        redo: "redo",
        cut: "cut",
        copy: "copy",
        paste: "paste",
        paste_and_match_style: "pasteAndMatchStyle",
        delete: "delete",
        select_all: "selectAll",
        unselect: "unselect",
    }

    pub(crate) fn begin_frame_subscription<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        let guest = self
            .started_guest()?
            .ok_or_else(|| unsupported("beginFrameSubscription"))?;
        guest.subscribe(field(raw(values).last().copied()));
        Ok(())
    }

    pub(crate) fn end_frame_subscription(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if let Some(guest) = self.guest() {
            guest.subscribe(JSValue::UNDEFINED);
        }
        Ok(())
    }

    pub(crate) fn show_definition_for_selection(&self, _: Cx<'_, '_>) -> JsResult<()> {
        let (Some(window), true) = (self.window(), IS_MAC) else {
            return Ok(());
        };
        let selected =
            text_if_any(self.page().ask("selectionText", &[])?)?.filter(|it| !it.is_empty());
        selected.map_or(Ok(()), |it| window.tell(WindowCommand::LookUp(it.into())))
    }

    pub(crate) fn start_drag(&self, _: Cx<'_, '_>) -> JsResult<()> {
        Err(unsupported("startDrag"))
    }

    pub(crate) fn send<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        self.check()?;
        invoke(self.main_frame()?, "send", raw(values)).map(drop)
    }

    pub(crate) fn post_message<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        self.check()?;
        invoke(self.main_frame()?, "postMessage", raw(values)).map(drop)
    }

    /// `frame` is a routing id, or a process id and a routing id.
    pub(crate) fn send_to_frame<'a>(
        &self,
        _: Cx<'a, '_>,
        frame: JsLocal<'a>,
        values: Values<'a, '_>,
    ) -> JsResult<bool> {
        self.check()?;
        let (main, frame) = (self.main_frame()?, frame.to_js());
        let ids = match frame.is_array() {
            true => [frame.get_index(global(), 0)?, frame.get_index(global(), 1)?],
            false => [get(main, "processId")?, frame],
        };
        let found = parts::find_frame(main, ids[0], "routingId", ids[1])?;
        found
            .map(|it| invoke(it, "send", raw(values)))
            .transpose()
            .map(|it| it.is_some())
    }

    pub(crate) fn download_url<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        if !self.told_guest("downloadURL", raw(values))? {
            let options = wire::data_from_js(argument(raw(values), 1))?;
            let headers: HeaderList = crate::session::load::from_record(&options["headers"]);
            self.session
                .download(&text_at(raw(values), 0)?, headers, self.to_js(), None);
        }
        Ok(())
    }

    pub(crate) fn copy_image_at<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        if self.told_guest("copyImageAt", raw(values))? || !self.page().is_started() {
            return Ok(());
        }
        let url = get(self.page().ask("hitInfo", raw(values))?, "srcURL")?;
        if !url.to_boolean() {
            return Ok(());
        }
        let fetched = self.page().fetch(&text_of(url)?, Destination::Image)?;
        task::spawn(async {
            if let Some(it) = fetched.await {
                let clipboard = bun_ui::clipboard::module(heap());
                let bytes = buffer(&it.bytes);
                task::report(bytes.and_then(|it| invoke(clipboard, "writeImage", &[it]).map(drop)));
            }
        });
        Ok(())
    }

    pub(crate) fn replace<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        if self.told_guest("replace", raw(values))? {
            Ok(())
        } else {
            self.insert(raw(values))
        }
    }

    pub(crate) fn replace_misspelling<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        if self.told_guest("replaceMisspelling", raw(values))? {
            Ok(())
        } else {
            self.insert(raw(values))
        }
    }

    pub(crate) fn find_in_page<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<u32> {
        if let Some(guest) = self.guest() {
            return guest.find_in_page(raw(values));
        }
        if !argument(raw(values), 0).to_boolean() {
            return Err(error(format_args!("Must provide non-empty search content")));
        }
        self.last_search.update(|it| it + 1);
        let (id, values) = (self.last_search.get(), keep(array(raw(values))?));
        self.later(move |it| {
            if it.is_destroyed.get() {
                return Ok(());
            }
            let found = with_elements(values.get(), |all| it.started_page()?.ask("find", all))?;
            let result = object!({
                "requestId": id,
                "activeMatchOrdinal": get(found, "active")?,
                "matches": get(found, "matches")?,
                "selectionArea": spread(js(Rect::default())?, get(found, "rect")?)?,
                "finalUpdate": true,
            });
            it.announce("found-in-page", &[result])
        });
        Ok(id)
    }

    pub(crate) fn stop_find_in_page<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        if self.told_guest("stopFindInPage", raw(values))? {
            Ok(())
        } else {
            self.page().tell("stopFind", raw(values))
        }
    }

    pub(crate) fn print<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        let (options, callback) = (argument(raw(values), 0), argument(raw(values), 1));
        if let Some(guest) = self.guest() {
            return print::print_remote(guest, None, wire::data_from_js(options)?, callback);
        }
        if callback.is_callable() {
            let reason = js("print is not supported by bun:desktop/electron")?;
            call(callback, &[false.into(), reason])?;
        }
        Ok(())
    }

    fn told_dev_tools(&self, method: &str, given: &[JSValue]) -> JsResult<bool> {
        let options = spread(object!({}), argument(given, 0))?;
        options.put(global(), b"mode", js("detach")?);
        self.told_guest(method, &[options])
    }

    pub(crate) fn open_dev_tools<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        match self.told_dev_tools("openDevTools", raw(values))? {
            true => Ok(()),
            false => warn("openDevTools is not supported by bun:desktop/electron"),
        }
    }

    pub(crate) fn toggle_dev_tools<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        self.told_dev_tools("toggleDevTools", raw(values)).map(drop)
    }

    only_for_guest! {
        adjust_selection: "adjustSelection",
        center_selection: "centerSelection",
        close_dev_tools: "closeDevTools",
        inspect_element: "inspectElement",
        scroll_to_bottom: "scrollToBottom",
        scroll_to_top: "scrollToTop",
    }

    settings_of_guest! {
        disable_device_emulation: "disableDeviceEmulation",
        enable_device_emulation: "enableDeviceEmulation",
        set_caret_browsing_enabled: "setCaretBrowsingEnabled",
        set_image_animation_policy: "setImageAnimationPolicy",
        set_web_rtciphandling_policy: "setWebRTCIPHandlingPolicy",
        set_web_rtcudpport_range: "setWebRTCUDPPortRange",
    }

    promises! {
        execute_java_script: "executeJavaScript", |it, given| {
            it.execute_when_loaded(0, argument(given, 0).to_js_string(global())?.to_js(), argument(given, 1))
        };
        execute_java_script_in_isolated_world: "executeJavaScriptInIsolatedWorld", |it, given| {
            let code = |all: &[JSValue]| all.iter().map(|it| get(*it, "code")).collect::<JsResult<Vec<_>>>().and_then(js);
            let code = invoke(with_elements(argument(given, 1), code)?, "join", &[js(";\n")?])?;
            it.execute_when_loaded(argument(given, 0).as_u32(), code, argument(given, 2))
        };
        insert_css: "insertCSS", |it, given| {
            it.check()?;
            resolved(it.started_page()?.ask("insertCSS", &[js(text_at(given, 0)?)?])?)
        };
        remove_inserted_css: "removeInsertedCSS", |it, given| resolved(nothing(it.page().tell("removeInsertedCSS", given))?);
        insert_text: "insertText", |it, given| resolved(nothing(it.insert(given))?);
        get_printers_async: "getPrintersAsync", |_, _| resolved(array(&[])?);
        print_to_pdf: "printToPDF", |_, _| Err(unsupported("printToPDF"));
        save_page: "savePage", |_, _| Err(unsupported("savePage"));
        set_visual_zoom_level_limits: "setVisualZoomLevelLimits", |_, _| resolved(JSValue::UNDEFINED);
        take_heap_snapshot: "takeHeapSnapshot", |_, given| {
            match crate::process::write_heap_snapshot(&text_at(given, 0)?) {
                true => resolved(JSValue::UNDEFINED),
                false => Err(error(format_args!("Failed to take heap snapshot"))),
            }
        };
    }

    pub(crate) fn capture_page<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<JSValue> {
        if let Some(guest) = self.started_guest()? {
            return guest.capture(raw(values));
        }
        self.check()?;
        let (this, area, result) = (
            Root::new(self),
            rectangle(argument(raw(values), 0))?,
            Deferred::new(),
        );
        let promise = result.promise();
        let capture = move || {
            let (it, time) = (
                this.get(),
                invoke(realm::native(global(), "performance")?, "now", &[])?,
            );
            it.check()?;
            let frame = object!({ "t": "frame", "s": it.surface, "time": time, "isUrgent": true });
            it.started_page()?.tell("handleEvent", &[frame])?;
            let bitmap = answer((bun_ui::renderer(global())?.capture)(
                it.surface,
                area.into(),
            ))?;
            Ok(NativeImage::from_pixels(bitmap).to_js(global()))
        };
        // The caller may be inside a frame that has yet to be painted.
        later::soon(move |_| result.settle(capture()));
        Ok(promise)
    }

    pub(crate) fn send_input_event(&self, _: Cx<'_, '_>, it: &ContentsInput<'_>) -> JsResult<()> {
        self.check()?;
        let has = |names: &[&str]| {
            let is_named = |it: &[u8]| {
                names
                    .iter()
                    .any(|name| it.eq_ignore_ascii_case(name.as_bytes()))
            };
            u32::from(it.modifiers.iter().flatten().any(|it| is_named(it)))
        };
        let m = has(&["shift"])
            | has(&["control", "ctrl"]) << 1
            | has(&["alt"]) << 2
            | has(&["meta", "command", "cmd"]) << 3;
        let (x, y) = (it.x, it.y);
        let (sx, sy) = (it.global_x.unwrap_or(x), it.global_y.unwrap_or(y));
        if self.guest().is_none() {
            self.started_page()?;
        }
        self.input(match it.r#type {
            b"char" => object!({ "t": "text", "text": it.key_code, "key": false }),
            b"mouseWheel" => object!({
                "t": "wheel", "x": x, "y": y, "sx": sx, "sy": sy, "dx": -it.delta_x, "dy": -it.delta_y,
                "precise": true, "phase": "move", "m": m,
            }),
            kind if kind.starts_with(b"mouse") => {
                let (b, bit) = match it.button {
                    Some(b"middle") => (1, 4),
                    Some(b"right") => (2, 2),
                    _ => (0, 1),
                };
                let held = has(&["leftbuttondown"]) | has(&["rightbuttondown"]) << 1 | has(&["middlebuttondown"]) << 2;
                let e = match kind {
                    b"mouseDown" => "down",
                    b"mouseUp" => "up",
                    b"mouseLeave" => "leave",
                    _ => "move",
                };
                object!({
                    "t": "mouse", "e": e, "x": x, "y": y, "sx": sx, "sy": sy, "b": b,
                    "buttons": if e == "down" { held | bit } else { held }, "n": it.click_count, "m": m,
                })
            }
            kind => {
                let name = accelerator::parse(&string(it.key_code))?.key;
                let [key, code] = devtools::input::describe_key(&name, m & 1 != 0);
                object!({
                    "t": "key", "e": if kind == b"keyUp" { "up" } else { "down" }, "key": key,
                    "code": code, "location": 0, "repeat": has(&["isautorepeat"]) != 0, "m": m, "composing": false,
                })
            }
        })
    }

    pub(crate) fn set_ignore_menu_shortcuts(&self, ignores: bool) {
        self.ignores_menu_shortcuts.set(ignores);
    }

    pub(crate) fn set_window_open_handler(&self, handler: Option<JsLocal<'_, Callable>>) {
        fields::set_open_handler(self, field(handler.map(JsLocal::to_js)));
    }
}

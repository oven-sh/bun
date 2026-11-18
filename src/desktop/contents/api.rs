//! The methods that apps call. While the page is in the web engine, most of them go there.

use std::rc::Rc;

use bun_jsc::JSMap;
use bun_ui::protocol::{SurfaceCommand, WindowCommand};
use bun_web::channel::LooseBitmap;
use bun_web::headers::HeaderList;
use bun_web::host::Keystroke;
use bun_web::input::{Action, Input, Mouse, Place};
use bun_web::page::{Controls, Focused, Search};
use bun_web::url::{Url, percent_decode};

use bun_web::request::Destination;

use super::load::{How, Navigation, Request};
use super::page::Page;
use super::{
    Contents, Device, Kind, Numbers as _, Values, all, field, fields, lazily, nothing, object_in,
    of_app, parts, save, spread, text_at, text_if_any, without_hash,
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
use crate::webview::embedded;
use crate::webview::remote::Remote;
use crate::webview::{print, wire};
use crate::{accelerator, app, files, task};

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

    /// The first argument.
    fn remembered(&self, setter: &str) -> JsResult<JSValue> {
        let values = map_in(self.settings()?).get(global(), js(setter)?)?;
        match values.is_array() {
            true => values.get_index(global(), 0),
            false => Ok(JSValue::UNDEFINED),
        }
    }

    fn edit(&self, command: &str) -> JsResult<()> {
        match self.guest() {
            Some(guest) => guest.edit(command),
            None if self.is_destroyed.get() || self.has_crashed() => {}
            None => {
                self.started_page()?;
                (self.page_with_keys()).tell(|it| it.edit(command.to_owned()))?;
            }
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
        if mode != "disabled" && !self.has_crashed() {
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
                .and_then(|_| this.get().live_page());
            result.settle(page.map(|it| it.execute(world, code.get(), is_by_user)))
        })?;
        Ok(promise)
    }

    fn insert(&self, given: &[JSValue]) -> JsResult<()> {
        let text = text_at(given, 0)?;
        self.page_with_keys().tell(|it| it.insert_text(text))
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
        let found = (self.guest()).map_or_else(|| self.focused_below(), Remote::focused_frame)?;
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
        Ok(self.throttles_background.get())
    }

    pub(crate) fn set_background_throttling<'a>(
        &self,
        _: Cx<'a, '_>,
        value: JsLocal<'a>,
    ) -> JsResult<()> {
        self.throttles_background.set(value.to_js().to_boolean());
        self.was_shown.set(true);
        self.environment_changed()?;
        self.remember("setBackgroundThrottling", &[value.to_js()])
    }

    pub(crate) fn get_caret_browsing_enabled(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        Ok(self.remembered("setCaretBrowsingEnabled")?.to_boolean())
    }

    pub(crate) fn set_caret_browsing_enabled<'a>(
        &self,
        _: Cx<'a, '_>,
        value: JsLocal<'a>,
    ) -> JsResult<()> {
        self.remember("setCaretBrowsingEnabled", &[value.to_js()])
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
        let is_shown = match self.guest() {
            Some(guest) => url == guest.mirrored("url").text(),
            None => url == self.page().url_in_history(),
        };
        let navigation = Navigation {
            request: Rc::new(request),
            user_agent: options.user_agent.map(string),
            wants_web_engine: options.web_engine,
            base_of_data: options.base_url_for_data_url.map(string),
            starts_over: is_shown,
            ..Navigation::new(if is_shown { How::Reload } else { How::Push })
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
            return Ok(());
        }
        if let Some(process) = self.page().process() {
            self.cancel_pending()?;
            return process.end();
        }
        self.crash("killed", 2)
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
        let policy = text_if_any(self.remembered("setWebRTCIPHandlingPolicy")?)?;
        Ok(policy.unwrap_or_else(|| "default".to_owned()))
    }

    pub(crate) fn get_udp_ports(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let given = self.remembered("setWebRTCUDPPortRange")?;
        spread(object!({ "min": 0, "max": 0 }), given)
    }

    pub(crate) fn get_dev_tools_title(&self, _: Cx<'_, '_>) -> JsResult<String> {
        let title = text_if_any(self.remembered("setDevToolsTitle")?)?;
        Ok(title.unwrap_or_else(|| "Developer Tools".to_owned()))
    }

    pub(crate) fn duplicate(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.check()?;
        let preferences = spread(object!({}), self.preferences())?;
        preferences.put(global(), b"session", self.session.to_js());
        let copy = Contents::create(preferences, Kind::Remote)?;
        let history = parts::navigation_history(self)?;
        let state = object!({
            "entries": invoke(history, "getAllEntries", &[])?,
            "index": invoke(history, "getActiveIndex", &[])?,
        });
        if !self.history.borrow().entries.is_empty() {
            invoke(parts::navigation_history(copy)?, "restore", &[state])?;
        }
        Ok(copy.to_js())
    }

    pub(crate) fn is_loading(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        self.check().map(|()| self.loading.is_reported())
    }

    mirrored! {
        is_loading_main_frame: "isLoadingMainFrame", |it| it.check().map(|()| it.is_busy());
        is_waiting_for_response: "isWaitingForResponse", |it| Ok(it.loading.is_pending());
        is_crashed: "isCrashed", |it| Ok(it.has_crashed());
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
        js(match self.guest() {
            Some(guest) => guest.mirrored("pid").number(),
            None if self.has_crashed() => 0.,
            None => self.page().process_id().into(),
        })
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
        let (it, given) = (&self.preferences, self.preferences());
        let all = object!({
            "contextIsolation": it.isolates_context,
            "javascript": it.runs_scripts,
            "sandbox": it.is_sandboxed,
            "webSecurity": it.has_web_security,
            "allowRunningInsecureContent": match get(given, "allowRunningInsecureContent")? {
                given if given.is_undefined() => !it.has_web_security,
                given => given.to_boolean(),
            },
        });
        for name in [
            "disableDialogs",
            "disablePopups",
            "disableWakeLocks",
            "experimentalFeatures",
            "nodeIntegration",
            "nodeIntegrationInSubFrames",
            "nodeIntegrationInWorker",
            "safeDialogs",
            "webviewTag",
        ] {
            let is_set = get(given, name)?.to_boolean();
            all.put(global(), name.as_bytes(), is_set.into());
        }
        for name in ["enableBlinkFeatures", "safeDialogsMessage"] {
            let text = text_if_any(get(given, name)?)?.unwrap_or_default();
            all.put(global(), name.as_bytes(), js(text)?);
        }
        Ok(all)
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
        let subscriber = field(raw(values).last().copied());
        if let Some(guest) = self.started_guest()? {
            guest.subscribe(subscriber);
            return Ok(());
        }
        fields::set_subscriber(self, subscriber);
        self.environment_changed()
    }

    pub(super) fn deliver_frame(&self) -> JsResult<()> {
        let Some(subscriber) = fields::subscriber(self).filter(|it| it.is_callable()) else {
            return Ok(());
        };
        let bitmap = answer((bun_ui::renderer(global())?.capture)(
            self.surface,
            None.into(),
        ))?;
        let image = NativeImage::from_pixels(bitmap).to_js(global());
        let dirty = spread(object!({ "x": 0, "y": 0 }), invoke(image, "getSize", &[])?)?;
        call(subscriber, &[image, dirty]).map(drop)
    }

    pub(crate) fn end_frame_subscription(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if let Some(guest) = self.guest() {
            guest.subscribe(JSValue::UNDEFINED);
        }
        fields::set_subscriber(self, JSValue::UNDEFINED);
        self.page().tell(Controls::environment_changed)
    }

    pub(crate) fn show_definition_for_selection(&self, _: Cx<'_, '_>) -> JsResult<()> {
        let (Some(window), true) = (self.window(), IS_MAC) else {
            return Ok(());
        };
        let (page, window) = (Root::new(self.page_with_keys()), Root::new(window));
        task::spawn(async move {
            let selected = page.get().ask_later(Controls::selection_text).await;
            task::report(selected.and_then(|it| match it.is_empty() {
                true => Ok(()),
                false => window.get().tell(WindowCommand::LookUp(it.into())),
            }));
        });
        Ok(())
    }

    pub(crate) fn start_drag<'a>(&self, _: Cx<'a, '_>, item: JsLocal<'a>) -> JsResult<()> {
        let [file, files, icon] = ["file", "files", "icon"].map(|it| get(item.to_js(), it));
        let paths = match files? {
            files if files.is_array() => texts_of(files)?,
            _ => text_if_any(file?)?.into_iter().collect(),
        };
        let icon = icon?;
        if icon.is_undefined_or_null() {
            return Err(error(format_args!("'icon' parameter is required")));
        }
        let icon = NativeImage::with(global(), icon, |it| it.icon(global()))?;
        if icon.bytes.is_empty() {
            return Ok(());
        }
        if paths.is_empty() {
            return Err(error(format_args!(
                "Must specify either 'file' or 'files' option"
            )));
        }
        if !IS_MAC {
            return Err(unsupported("startDrag"));
        }
        let paths = paths.into_iter().map(Text::from).collect();
        (self.window()).map_or(Ok(()), |it| {
            it.tell(WindowCommand::DragFiles { paths, icon })
        })
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
                .download(&text_at(raw(values), 0)?, headers, self.to_js(), None)?;
        }
        Ok(())
    }

    pub(crate) fn copy_image_at<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        if self.told_guest("copyImageAt", raw(values))? || !self.page().is_started() {
            return Ok(());
        }
        let at = |index| argument(raw(values), index).to_number(global());
        let (x, y) = (at(0)?, at(1)?);
        let page = Root::new(self.page());
        let copy = |pixels| {
            let image = NativeImage::from_pixels(pixels).to_js(global());
            invoke(bun_ui::clipboard::module(heap()), "writeImage", &[image]).map(drop)
        };
        let steps = async move {
            let found = (page.get()).ask_later(|it, reply| it.hit_info(x, y, reply));
            let Some(url) = (found.await?.map(|it| it.src_url)).filter(|it| !it.is_empty()) else {
                return Ok(());
            };
            let Some(fetched) = page.get().fetch(&url, Destination::Image)?.await else {
                return Ok(());
            };
            let image = page.get().decode_image(fetched.bytes.to_vec())?.await;
            image.and_then(LooseBitmap::checked).map_or(Ok(()), copy)
        };
        task::spawn(async { task::report(steps.await) });
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
        let (id, text) = (self.last_search.get(), text_at(raw(values), 0)?);
        let options = object_in(raw(values).get(1).copied());
        let flag = |name, otherwise| {
            let given = options.map(|it| get(it, name)).transpose()?;
            JsResult::Ok(
                (given.filter(|it| !it.is_undefined())).map_or(otherwise, JSValue::to_boolean),
            )
        };
        let search = Search {
            is_forward: flag("forward", true)?,
            goes_on: flag("findNext", true)?,
            matches_case: flag("matchCase", false)?,
        };
        self.later(move |it| {
            if it.is_destroyed.get() || it.has_crashed() {
                return Ok(());
            }
            let (this, page) = (Root::new(it), Root::new(it.started_page()?));
            let steps = async move {
                let found = (page.get()).ask_later(|it, reply| it.find(text, search, reply));
                let found = found.await?;
                if this.get().is_destroyed.get() {
                    return Ok(());
                }
                let result = object!({
                    "requestId": id,
                    "activeMatchOrdinal": found.active,
                    "matches": found.matches,
                    "selectionArea": found.area,
                    "finalUpdate": true,
                });
                this.get().announce("found-in-page", &[result])
            };
            task::spawn(async { task::report(steps.await) });
            Ok(())
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
            let action = text_if_any(argument(raw(values), 0))?;
            let keeps_selection = action.is_some_and(|it| it != "clearSelection");
            self.page().tell(|it| it.stop_finding(keeps_selection))
        }
    }

    pub(crate) fn print<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
        let (options, callback) = (argument(raw(values), 0), argument(raw(values), 1));
        let options = wire::data_from_js(options)?;
        match self.guest() {
            Some(guest) => print::print_remote(guest, None, options, callback),
            None => print::print_page(self.live_page()?, options, callback),
        }
    }

    pub(crate) fn adjust_selection<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        if self.told_guest("adjustSelection", raw(values))? {
            return Ok(());
        }
        let by = argument(raw(values), 0);
        let (start, end) = (get(by, "start")?.as_i32(), get(by, "end")?.as_i32());
        (self.focused_page()?).tell(|it| it.adjust_selection(start, end))
    }

    /// `undefined` if no frame has the focus.
    fn focused_below(&self) -> JsResult<JSValue> {
        let below = |id| {
            self.related_page(id)
                .filter(|it| same(it.owner(), self.owner()))
        };
        let page = self.page_with_keys();
        match page.ask(Controls::focused_frame)? {
            Focused::Itself if same(page, self.page()) => Ok(JSValue::UNDEFINED),
            Focused::Itself => Ok(page.handle()),
            Focused::Page(id) => Ok(field(below(id).map(Page::handle))),
            Focused::Guest { page, frame } => {
                let guest = below(page).map(|it| it.with_number(frame)).transpose()?;
                (guest.flatten()).map_or(Ok(JSValue::UNDEFINED), embedded::Controls::focused_frame)
            }
        }
    }

    pub(super) fn focused_page(&self) -> JsResult<&'static Page> {
        let frame = cast::<parts::WebFrameMain>(self.focused_below()?);
        Ok(frame.map_or_else(|| self.page(), parts::WebFrameMain::page))
    }

    fn scroll_vertically(&self, method: &str, top: f64) -> JsResult<()> {
        match self.told_guest(method, &[])? {
            true => Ok(()),
            false => self.page().tell(|it| it.scroll_vertically(top)),
        }
    }

    pub(crate) fn scroll_to_top<'a>(&self, _: Cx<'a, '_>, _: Values<'a, '_>) -> JsResult<()> {
        self.scroll_vertically("scrollToTop", 0.)
    }

    pub(crate) fn scroll_to_bottom<'a>(&self, _: Cx<'a, '_>, _: Values<'a, '_>) -> JsResult<()> {
        self.scroll_vertically("scrollToBottom", 1e9)
    }

    fn emulate_device(&self, device: Option<Device>) -> JsResult<()> {
        self.device.set(device);
        match self.size().filter(|_| self.guest().is_none()) {
            Some(size) => self.page().tell(|it| it.input(self.on_device(size))),
            None => Ok(()),
        }
    }

    pub(crate) fn enable_device_emulation<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        let given = wire::data_from_js(argument(raw(values), 0))?;
        let size = |name: &str| ["width", "height"].map(|it| given[name][it].number());
        self.emulate_device(Some(Device {
            screen: size("screenSize"),
            view: size("viewSize"),
            scale: given["deviceScaleFactor"].number(),
        }))?;
        self.remember("enableDeviceEmulation", raw(values))
    }

    pub(crate) fn disable_device_emulation<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<()> {
        self.emulate_device(None)?;
        self.remember("disableDeviceEmulation", raw(values))
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
        center_selection: "centerSelection",
        close_dev_tools: "closeDevTools",
        copy_video_frame_at: "copyVideoFrameAt",
        inspect_element: "inspectElement",
        inspect_service_worker: "inspectServiceWorker",
        inspect_shared_worker: "inspectSharedWorker",
        inspect_shared_worker_by_id: "inspectSharedWorkerById",
        save_video_frame_as: "saveVideoFrameAs",
    }

    settings_of_guest! {
        set_dev_tools_title: "setDevToolsTitle",
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
            let origin = object_in(given.get(1).copied()).map(|it| get(it, "cssOrigin")).transpose()?;
            let is_of_user = text_if_any(field(origin))?.is_some_and(|it| it == "user");
            it.live_page()?.insert_css(text_at(given, 0)?, is_of_user)
        };
        remove_inserted_css: "removeInsertedCSS", |it, given| resolved(nothing(it.page().remove_inserted_css(argument(given, 0)))?);
        insert_text: "insertText", |it, given| resolved(nothing(it.live_page().and_then(|_| it.insert(given)))?);
        get_printers_async: "getPrintersAsync", |_, _| resolved(array(&[])?);
        print_to_pdf: "printToPDF", |it, given| print::print_to_pdf(it.live_page()?, wire::data_from_js(argument(given, 0))?);
        save_page: "savePage", |it, given| save::save(it.live_page()?, text_at(given, 0)?, text_at(given, 1)?);
        set_visual_zoom_level_limits: "setVisualZoomLevelLimits", |_, _| resolved(JSValue::UNDEFINED);
        take_heap_snapshot: "takeHeapSnapshot", |it, given| {
            if it.live_page()?.is_far() {
                return it.page().write_heap_snapshot(text_at(given, 0)?);
            }
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
        let capture = async move {
            let it = this.get();
            it.check()?;
            if it.has_crashed() {
                return Ok(NativeImage::from_bytes(Vec::new()).to_js(global()));
            }
            let page = Root::new(it.started_page()?);
            page.get().ask_later(Controls::render).await?;
            it.check()?;
            let bitmap = answer((bun_ui::renderer(global())?.capture)(
                it.surface,
                area.into(),
            ))?;
            Ok(NativeImage::from_pixels(bitmap).to_js(global()))
        };
        // The caller may be inside a frame that has yet to be painted.
        later::soon(move |_| {
            task::spawn(async move { task::report(result.settle(capture.await)) });
            Ok(())
        });
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
            | has(&["meta", "command", "cmd"]) << 3
            | has(&["capslock"]) << 5
            | has(&["numlock"]) << 9;
        let (x, y) = (it.x, it.y);
        let place = Place {
            window: [x, y],
            screen: [it.global_x.unwrap_or(x), it.global_y.unwrap_or(y)],
            modifiers: m,
        };
        if self.guest().is_none() {
            self.started_page()?;
        }
        self.input(match it.r#type {
            b"char" => Input::Text {
                text: string(it.key_code),
                is_typed: false,
                range: None,
            },
            b"mouseWheel" => Input::Wheel {
                place,
                delta: [-it.delta_x, -it.delta_y],
                is_precise: true,
                is_handled: false,
            },
            kind if kind.starts_with(b"mouse") => {
                let (button, bit) = match it.button {
                    Some(b"middle") => (1, 4),
                    Some(b"right") => (2, 2),
                    _ => (0, 1),
                };
                let held = has(&["leftbuttondown"])
                    | has(&["rightbuttondown"]) << 1
                    | has(&["middlebuttondown"]) << 2;
                let action = match kind {
                    b"mouseDown" => Action::Down,
                    b"mouseUp" => Action::Up,
                    b"mouseLeave" => Action::Leave,
                    _ => Action::Move,
                };
                Input::Mouse(Mouse {
                    action,
                    place,
                    button,
                    buttons: (held | if action == Action::Down { bit } else { 0 }) as u16,
                    clicks: it.click_count as i32,
                })
            }
            kind => {
                let mut modifiers = m;
                let [key, code] = accelerator::describe_key(&string(it.key_code), &mut modifiers);
                Input::Key(Keystroke {
                    is_down: kind != b"keyUp",
                    key,
                    code,
                    location: has(&["left"]) | (has(&["right"]) * 2) | (has(&["iskeypad"]) * 3),
                    modifiers,
                    repeats: has(&["isautorepeat"]) != 0,
                    is_composing: false,
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

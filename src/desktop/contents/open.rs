//! Windows that pages open.

use bun_ui::Rect;
use bun_web::trust;
use bun_web::window_features::WindowFeatures;

use super::load::Initiator;
use super::page::Page;
use super::{Contents, Kind, Markup, Start, features, fields, object_in, or_undefined, spread};
use crate::generated_bindgen::window::js_DesktopBrowserWindow;
use crate::prelude::*;
use crate::text::before;
use crate::webview::remote::Remote;
use crate::{realm, screen};

type Create<'a> = &'a dyn Fn(JSValue) -> JsResult<&'static Contents>;
type Begin<'a> = &'a dyn Fn(&'static Contents) -> JsResult<()>;

impl Contents {
    /// For a page in the web engine.
    pub(super) fn open_guest(
        &self,
        opener: &Remote,
        details: JSValue,
    ) -> JsResult<Option<&'static Remote>> {
        let create = |preferences| {
            let opened = Contents::start(
                preferences,
                Kind::Window,
                &Start::OpenedByGuest(opener.main_frame()?, self.session),
            )?;
            opened.show_guest(true).map(|_| opened)
        };
        let opened = self
            .owner()
            .open_window(opener.cleanups(), details, &create, &|_| Ok(()))?;
        Ok(opened.and_then(Contents::guest))
    }

    pub(super) fn open(
        &self,
        opener: &Page,
        url: &str,
        name: &str,
        features: &str,
        [create_page, options]: [JSValue; 2],
    ) -> JsResult<Option<&'static Contents>> {
        if opener.forbids("allow-popups")
            || (url.starts_with("javascript:") && opener.forbids("allow-scripts"))
        {
            return Ok(None);
        }
        if url.starts_with("file:") && opener.origin() != "file://" {
            return opener
                .log_error("Not allowed to load local resource")
                .map(|()| None);
        }
        let WindowFeatures {
            is_popup,
            noopener,
            noreferrer,
            ..
        } = WindowFeatures::parse(features.as_bytes());
        let url = if url.is_empty() { "about:blank" } else { url };
        let is_script = url.starts_with("javascript:");
        let (is_blank, is_shared) = (
            is_script || before(before(url, "#"), "?") == "about:blank",
            trust::trusts_all_frames(),
        );
        let details = object!({
            "url": url,
            "frameName": name,
            "features": features,
            "disposition": if is_popup { "new-window" } else { "foreground-tab" },
            "referrer": object!({ "url": opener.url(), "policy": "strict-origin-when-cross-origin" }),
        });
        let create = |preferences| {
            let create_page =
                Some(create_page).filter(|it| is_blank && !is_shared && it.is_callable());
            let start = Start::Opened {
                opener,
                create_page,
                is_related: is_shared && !noopener,
            };
            let opened = Contents::start(preferences, Kind::Window, &start)?;
            opened.page().rename(name.to_owned());
            opened.context.is_popup.set(is_popup && !noopener);
            if !noopener {
                bun_web::storage::copy_session_storage(
                    self.owner().id,
                    opened.id,
                    &opener.client.bucket(),
                );
            }
            Ok(opened)
        };
        let begin = |opened: &'static Contents| {
            if is_blank {
                opened.show(opened.page(), "", Markup::Html)?;
                opened.page().set_initial_url(url)?;
                return if is_script && is_shared {
                    opened.page().navigate_for(opener, url, object!({}))
                } else {
                    Ok(())
                };
            }
            if !noopener && same(opened.session, self.session) && opened.is_for_guest(url)? {
                return opened.show_guest(true).map(drop);
            }
            let options = spread(object!({}), options)?;
            options.put(global(), b"replace", JSValue::TRUE);
            options.put(
                global(),
                b"referrer",
                js(if noreferrer {
                    String::new()
                } else {
                    opener.url()
                })?,
            );
            match is_shared {
                true => opened.navigate(opener, url, options).map(drop),
                false => opened.wish(opened.page(), url, options, Initiator::of(opener)),
            }
        };
        let opened = self
            .owner()
            .open_window(opener.cleanups()?, details, &create, &begin)?;
        Ok(opened.filter(|_| !noopener))
    }

    fn open_window(
        &self,
        cleanups: JSValue,
        details: JSValue,
        create: Create<'_>,
        begin: Begin<'_>,
    ) -> JsResult<Option<&'static Contents>> {
        let [url, name, features, disposition, referrer] =
            ["url", "frameName", "features", "disposition", "referrer"].map(|it| get(details, it));
        let features = text_of(features?)?;
        let answer = match object_in(fields::open_handler(self)) {
            Some(handler) => call(handler, &[details])?,
            None => object!({ "action": "allow" }),
        };
        if !answer.is_object()
            || text_of(get(answer, "action")?)? != "allow"
            || self.is_destroyed.get()
        {
            return Ok(None);
        }
        let (overrides, preferences) = (get(answer, "overrideBrowserWindowOptions")?, object!({}));
        for name in [
            "sandbox",
            "contextIsolation",
            "javascript",
            "nodeIntegration",
        ] {
            preferences.put(global(), name.as_bytes(), get(self.preferences(), name)?);
        }
        if overrides.is_object() {
            spread(preferences, get(overrides, "webPreferences")?)?;
        }
        let opened = create(preferences)?;
        let WindowFeatures {
            left,
            top,
            width,
            height,
            ..
        } = WindowFeatures::parse(features.as_bytes());
        let [width, height] =
            [width.unwrap_or(800), height.unwrap_or(600)].map(|it| it.clamp(100, 16384));
        let area = screen::display_matching(Rect {
            x: left.unwrap_or(0) as f32,
            y: top.unwrap_or(0) as f32,
            width: width as f32,
            height: height as f32,
        })?
        .work_area;
        let options = object!({
            "show": true,
            "width": width,
            "height": height,
            "x": or_undefined(left.map(|it| it.max(area.x as i32)))?,
            "y": or_undefined(top.map(|it| it.max(area.y as i32)))?,
        });
        features::add_options(options, &features)?;
        spread(options, overrides)?;
        options.put(global(), b"webPreferences", preferences);
        options.put(global(), b"webContents", opened.to_js());
        let create_window = get(answer, "createWindow")?;
        let window = match create_window.is_callable() {
            true => create_window
                .call(global(), answer, &[options])
                .map(|_| None)?,
            false => Some(realm::instantiate(
                js_DesktopBrowserWindow::CLASS.constructor(heap()),
                &[options],
            )?),
        };
        if !get(answer, "outlivesOpener")?.to_boolean() {
            let close = listener(opened, |it, _| it.close_now())?;
            invoke(cleanups, "add", &[close])?;
            let forget = function(array(&[cleanups, close])?, |both, _| {
                invoke(
                    both.get_index(global(), 0)?,
                    "delete",
                    &[both.get_index(global(), 1)?],
                )
            })?;
            invoke(opened.to_js(), "once", &[js("destroyed")?, forget])?;
        }
        begin(opened)?;
        if let Some(window) = window {
            let about = object!({
                "url": url?, "frameName": name?, "options": options, "referrer": referrer?, "disposition": disposition?,
            });
            self.emit("did-create-window", &[window, about])?;
        }
        Ok(Some(opened))
    }
}

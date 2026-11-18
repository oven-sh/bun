//! What is around a page of the web engine: a `WebContents`, or a window of the program.

use bun_ui::protocol::Point;
use bun_web::page::News;

use super::remote::Remote;
use crate::contents::{Contents, page::Page};
use crate::page_host::PageHost;
use crate::prelude::*;
use crate::window::Window;

/// What shows it.
pub(crate) trait Holder {
    fn window(&self) -> Option<&'static Window>;
    fn is_visible(&self) -> JsResult<bool>;
    fn surface_of_window(&self) -> u32;
    fn preferences(&self) -> JSValue;
    /// Returns what has the page that is opened, if that is in the web engine.
    fn open(&self, opener: &Remote, details: JSValue) -> JsResult<Option<&'static Remote>>;
    fn navigate_from(&self, url: &str, frame: JSValue) -> JsResult<()>;

    /// Of that surface, below the menu bar.
    fn origin_in_window(&self) -> Point {
        Point { x: 0., y: 0. }
    }

    fn ignores_menu_shortcuts(&self) -> bool {
        false
    }

    /// A `Map` of the arguments of the setters that were called before.
    fn settings(&self) -> JsResult<Option<JSValue>> {
        Ok(None)
    }

    /// Whether what it shows is an image in another document.
    fn is_mirrored(&self) -> bool {
        false
    }

    fn mirror(&self, _scale: f64, _area: JSValue) -> JsResult<()> {
        Ok(())
    }

    fn frames_changed(&self) -> JsResult<()> {
        Ok(())
    }

    fn allow_fullscreen(&self) {}
}

/// The document that has the `<iframe>`.
pub(crate) trait Embedder {
    /// A [`Holder`].
    fn holder(&self) -> JSValue;
    /// What emits the events.
    fn web_contents(&self) -> JsResult<JSValue>;
    /// What `parent` of the frame is.
    fn frame(&self) -> JsResult<JSValue>;
    fn url(&self) -> JsResult<String>;
    fn origin(&self) -> JsResult<String>;
    fn log_error(&self, message: &str) -> JsResult<()>;
    fn id(&self) -> u32;
    fn tell_element(&self, number: u32, news: News) -> JsResult<()>;

    fn is_disposed(&self) -> bool {
        false
    }

    fn permissions_policy(&self) -> String {
        String::new()
    }

    fn has_feature(&self, _name: &str) -> bool {
        true
    }

    fn sandbox_flags(&self) -> Option<Vec<String>> {
        None
    }

    fn security_policies(&self) -> Vec<String> {
        Vec::new()
    }

    fn may_frame(&self, _url: &str) -> bool {
        true
    }

    fn referrer_policy(&self) -> &'static [u8] {
        b""
    }

    /// A `Set`, if it keeps track of them.
    fn frames(&self) -> JsResult<Option<JSValue>> {
        Ok(None)
    }

    /// A `Set` of what it calls when it goes away.
    fn cleanups(&self) -> JsResult<Option<JSValue>> {
        Ok(None)
    }
}

fn host(object: JSValue) -> &'static PageHost {
    cast(object).expect("there are two kinds")
}

pub(super) fn holder(object: JSValue) -> &'static dyn Holder {
    match cast::<Contents>(object) {
        Some(contents) => contents,
        None => host(object),
    }
}

pub(super) fn embedder(object: JSValue) -> &'static dyn Embedder {
    match cast::<Page>(object) {
        Some(page) => page,
        None => host(object),
    }
}

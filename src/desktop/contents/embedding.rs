//! What the pages in the web engine see of it.

use bun_ui::protocol::Point;
use bun_web::csp::Metadata;
use bun_web::host::Wish;
use bun_web::page::News as ForElement;
use bun_web::request::Destination;
use bun_web::url::Url;

use super::Contents;
use super::inspection::News;
use super::load::Initiator;
use super::page::Page;
use crate::generated_bindgen::contents::js_ElectronWebContents as fields;
use crate::prelude::*;
use crate::view::View;
use crate::webview::embedder::{Embedder, Holder};
use crate::webview::remote::Remote;
use crate::window::Window;

impl Holder for Contents {
    fn allow_fullscreen(&self) {
        self.owner().context.may_fill_screen.set(true);
    }

    fn window(&self) -> Option<&'static Window> {
        Contents::window(self)
    }

    fn is_visible(&self) -> JsResult<bool> {
        Contents::is_visible(self)
    }

    fn surface_of_window(&self) -> u32 {
        self.owner().surface
    }

    fn origin_in_window(&self) -> Point {
        fields::view(self.owner()).map_or(Point { x: 0., y: 0. }, View::origin_of_contents)
    }

    fn preferences(&self) -> JSValue {
        Contents::preferences(self)
    }

    fn open(&self, opener: &Remote, details: JSValue) -> JsResult<Option<&'static Remote>> {
        self.open_guest(opener, details)
    }

    fn navigate_from(&self, url: &str, frame: JSValue) -> JsResult<()> {
        let top = self.owner();
        let wish = Wish {
            url: url.to_owned(),
            ..Default::default()
        };
        top.wish(top.page(), wish, Initiator::of_guest(frame)?, None)
    }

    fn ignores_menu_shortcuts(&self) -> bool {
        self.ignores_menu_shortcuts.get()
    }

    fn settings(&self) -> JsResult<Option<JSValue>> {
        Contents::settings(self).map(Some)
    }

    fn is_mirrored(&self) -> bool {
        self.is_frame()
    }

    fn mirror(&self, scale: f64, area: JSValue) -> JsResult<()> {
        self.painted(scale, area)
    }

    fn frames_changed(&self) -> JsResult<()> {
        self.notify(News::FramesChanged)
    }
}

impl Embedder for Page {
    fn holder(&self) -> JSValue {
        self.contents().to_js()
    }

    fn web_contents(&self) -> JsResult<JSValue> {
        Ok(self.owner().to_js())
    }

    fn frame(&self) -> JsResult<JSValue> {
        Ok(self.handle())
    }

    fn url(&self) -> JsResult<String> {
        Ok(Page::url(self))
    }

    fn origin(&self) -> JsResult<String> {
        Ok(Page::origin(self))
    }

    fn log_error(&self, message: &str) -> JsResult<()> {
        Page::log_error(self, message)
    }

    fn id(&self) -> u32 {
        self.id
    }

    fn tell_element(&self, number: u32, news: ForElement) -> JsResult<()> {
        self.tell(|it| it.tell_frame(number, news))
    }

    fn is_disposed(&self) -> bool {
        Page::is_disposed(self)
    }

    fn permissions_policy(&self) -> String {
        self.loaded()
            .and_then(|it| it.header("permissions-policy"))
            .unwrap_or_default()
    }

    fn has_feature(&self, name: &str) -> bool {
        Page::has_feature(self, name.as_bytes())
    }

    fn sandbox_flags(&self) -> Option<Vec<String>> {
        (self.sandbox().flags()).map(|all| all.iter().map(|it| string(it)).collect())
    }

    fn security_policies(&self) -> Vec<String> {
        let policies = self.client.policies();
        policies.csp.serialize().map(|it| string(&it)).collect()
    }

    fn may_frame(&self, url: &str) -> bool {
        self.client.policies().csp.is_empty()
            || Url::parse(url.as_bytes()).is_some_and(|url| {
                let metadata = Metadata::default();
                (self.client).csp_allows_request(&url, Destination::Iframe, &metadata, None)
            })
    }

    fn referrer_policy(&self) -> &'static [u8] {
        self.client.policies().referrer_policy.as_bytes()
    }

    fn frames(&self) -> JsResult<Option<JSValue>> {
        Page::frames(self).map(Some)
    }

    fn cleanups(&self) -> JsResult<Option<JSValue>> {
        Page::cleanups(self).map(Some)
    }
}

//! What a session needs from a `WebContents`.

use bun_ui::dom;

use super::target_id_of;
use crate::contents::worlds::World;
use crate::contents::{self, inspection};
use crate::prelude::*;
use crate::realm;
use crate::value::Value;
use crate::webview::wire;

pub(super) struct Contents(Root<contents::Contents>);

impl core::ops::Deref for Contents {
    type Target = contents::Contents;

    fn deref(&self) -> &contents::Contents {
        self.0.get()
    }
}

impl Clone for Contents {
    fn clone(&self) -> Contents {
        Contents::new(self)
    }
}

pub(super) fn all() -> Vec<Contents> {
    inspection::inspectable().map(Contents::new).collect()
}

pub(super) fn with_target_id(id: &str) -> Option<Contents> {
    (all().into_iter()).find(|it| *target_id_of(it.object()) == *id)
}

impl Contents {
    pub(super) fn new(contents: &contents::Contents) -> Contents {
        Contents(Root::new(contents))
    }

    pub(super) fn object(&self) -> JSValue {
        self.0.get().to_js()
    }

    pub(super) fn invoke(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        invoke(self.object(), method, arguments)
    }

    pub(super) fn close_later(&self) {
        let contents = self.clone();
        later::soon(move |_| contents.close_now());
    }

    pub(super) fn load_url(&self, params: &Value) -> JsResult<JSValue> {
        let options = record! { "httpReferrer": &params["referrer"] };
        self.invoke("loadURL", &[js(&params["url"])?, js(&options)?])
    }

    pub(super) fn info(&self) -> JsResult<Value> {
        let url = self.url_for_app()?;
        let opener = Some(self.contents_of_opener()?).filter(|it| it.is_object());
        Ok(record! {
            "targetId": &*target_id_of(self.object()),
            "type": "page",
            "title": self.title_for_app()?,
            "url": if url.is_empty() { "about:blank" } else { &url },
            "attached": true,
            "openerId": opener.map(target_id_of).as_deref(),
            "canAccessOpener": false,
            "browserContextId": &*target_id_of(self.get_session().to_js()),
        })
    }

    pub(super) fn token(&self) -> String {
        string(self.page().token())
    }

    pub(super) fn control(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        self.started_page()?.ask(method, arguments)
    }

    pub(super) fn document(&self) -> JsResult<dom::Document> {
        let document = self.control("currentDocument", &[])?;
        Ok(dom::Document(realm::peek(document)))
    }

    pub(super) fn world(&self, id: u32) -> JsResult<World> {
        self.started_page()?.world_with_id(id)
    }

    pub(super) fn simulate(&self, event: &Value) -> JsResult<()> {
        if self.guest().is_none() {
            self.started_page()?;
        }
        self.input(js(event)?)
    }

    /// The last `resize` event.
    pub(super) fn last_size(&self) -> JsResult<Value> {
        self.size().map_or(Ok(Value::Undefined), wire::data_from_js)
    }

    pub(super) fn bring_to_front(&self) -> JsResult<()> {
        self.focus_window()?;
        self.take_focus()
    }

    pub(super) fn describe_history(&self) -> Value {
        let history = self.history().borrow();
        let entries = history.entries.iter().enumerate().map(|(id, it)| {
            record! {
                "id": id,
                "url": it.url(),
                "userTypedURL": it.url(),
                "title": it.title(),
                "transitionType": "link",
            }
        });
        record! { "currentIndex": history.index, "entries": entries.collect::<Value>() }
    }
}

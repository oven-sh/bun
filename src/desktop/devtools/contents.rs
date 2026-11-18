//! What a session needs from a `WebContents`.

use bun_web::headers::HeaderList;
use bun_web::net::NetError;
use bun_web::net::response::Response;
use bun_web::trust::is_trusted_origin;
use bun_web::url::Url;

use super::target_id_of;
use crate::contents::{self, inspection};
use crate::prelude::*;
use crate::value::Value;

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

    /// The page may have chosen the URL.
    pub(super) async fn load_for_page(
        &self,
        url: &str,
        includes_credentials: bool,
    ) -> Result<Response, NetError> {
        let url = Url::parse(url.as_bytes()).ok_or(NetError::InvalidUrl)?;
        let origin = self.page().exact_origin();
        let is_in_reach = url.is_http()
            || url.scheme() == b"data"
            || origin.is_origin_of(&url)
            || is_trusted_origin(origin.as_bytes());
        let is_on_other_machine =
            url.scheme() == b"file" && (!url.host().is_empty() || url.path().starts_with(b"//"));
        if !is_in_reach || is_on_other_machine {
            return Err(NetError::AccessDenied);
        }
        let trusted = includes_credentials.then_some(origin);
        (self.get_session())
            .load_for_tools(&string(url.href()), trusted)
            .await
    }

    pub(super) async fn load_whole(&self, url: &str) -> Option<(u16, HeaderList, Vec<u8>)> {
        const LONGEST: usize = 128 << 20;
        let Response { head, body } = self.load_for_page(url, true).await.ok()?;
        let (mut body, mut all) = (body.unwrap_or_default(), Vec::new());
        while let Some(more) = body.read().await.ok()? {
            all.extend_from_slice(&more);
            (all.len() <= LONGEST).then_some(())?;
        }
        Some((head.status, head.headers, all))
    }

    pub(super) fn simulate(&self, input: bun_web::input::Input) -> JsResult<()> {
        if self.guest().is_none() {
            self.live_page()?;
        }
        self.input(input)
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

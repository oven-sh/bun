//! The smaller objects that a session has.

use std::collections::BTreeMap;

use bun_web::net::embedder::{RequestEvent, ResourceType};
use bun_web::net::session::Listener;
use bun_web::pattern::{MatchPattern, UrlFilter};

use super::mirror::Setting;
use super::{Session, Values, from_js};
use crate::prelude::*;
use crate::value::Value;
use crate::webview::worker::ServiceWorker;
use crate::webview::{engine, wire};
use crate::{files, task};

pub(crate) struct WebRequest(pub(super) &'static Session);

macro_rules! events {
    ($($method:ident: $event:ident $name:literal),* $(,)?) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, values: Values<'a, '_>) -> JsResult<()> {
            self.listen(RequestEvent::$event, $name, JsLocal::to_js_slice(values))
        }
    )*};
}

impl WebRequest {
    fn listen(&self, event: RequestEvent, name: &'static str, given: &[JSValue]) -> JsResult<()> {
        let (filter, listener) = match *given {
            [filter, listener, ..] => (wire::data_from_js(filter)?, listener),
            [listener] => (Value::Undefined, listener),
            [] => (Value::Undefined, JSValue::UNDEFINED),
        };
        if !listener.is_callable() && !listener.is_null() {
            return Err(type_error(format_args!("Must pass null or a Function")));
        }
        if matches!(filter, Value::Record(_)) && !filter["urls"].is_list() {
            return Err(type_error(format_args!(
                "Parameter 'filter' must have property 'urls'."
            )));
        }
        let invalid =
            |what: &str, it: &Value| type_error(format_args!("Invalid {what} {}", it.display()));
        let pattern = |it: &Value| {
            MatchPattern::parse(it.text().as_bytes()).ok_or_else(|| invalid("url pattern", it))
        };
        let kind = |it: &Value| {
            ResourceType::parse(it.text().as_bytes()).ok_or_else(|| invalid("type", it))
        };
        let patterns = |name: &str| {
            filter[name]
                .items()
                .iter()
                .map(pattern)
                .collect::<JsResult<_>>()
        };
        let urls = UrlFilter {
            included: patterns("urls")?,
            excluded: patterns("excludeUrls")?,
        };
        let types = filter["types"]
            .items()
            .iter()
            .map(kind)
            .collect::<JsResult<_>>()?;
        let listener = Some(listener).filter(|it| it.is_callable());
        self.0.network.settings.write().listeners[event as usize] =
            listener.map(|_| Listener { urls, types });
        self.0.set_handler(name, listener)?;
        let given = ["urls", "excludeUrls", "types"]
            .into_iter()
            .filter(|it| !filter[*it].items().is_empty());
        let filter = listener.map_or(Value::Null, |_| filter.pick(&given.collect::<Vec<_>>()));
        drop(self.0.remember(
            name,
            Setting::WebRequest {
                event: name,
                filter,
            },
        ));
        Ok(())
    }

    events!(
        on_before_request: BeforeRequest "onBeforeRequest",
        on_before_send_headers: BeforeSendHeaders "onBeforeSendHeaders",
        on_send_headers: SendHeaders "onSendHeaders",
        on_headers_received: HeadersReceived "onHeadersReceived",
        on_response_started: ResponseStarted "onResponseStarted",
        on_before_redirect: BeforeRedirect "onBeforeRedirect",
        on_completed: Completed "onCompleted",
        on_error_occurred: ErrorOccurred "onErrorOccurred",
    );
}

pub(crate) struct ServiceWorkers(pub(super) &'static Session);

impl ServiceWorkers {
    pub(crate) fn get_all_running(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&Value::empty().and(&self.0.mirror.running_workers.borrow()))
    }

    pub(crate) fn get_worker(&self, _: Cx<'_, '_>, version: f64) -> JsResult<JSValue> {
        let Some((engine, _)) = self.0.mirror.linked() else {
            return Ok(JSValue::UNDEFINED);
        };
        let has_version = |it: &JSValue| {
            cast::<ServiceWorker>(*it).is_some_and(|it| it.get_version_id() == version)
        };
        let found = self
            .0
            .mirror
            .workers
            .borrow()
            .iter()
            .filter_map(|it| engine.object(*it))
            .find(has_version);
        Ok(found.unwrap_or(JSValue::UNDEFINED))
    }

    pub(crate) fn get_info(&self, _: Cx<'_, '_>, version: f64) -> JsResult<JSValue> {
        match &self.0.mirror.running_workers.borrow()[&*version.to_string()] {
            Value::Undefined => Err(error(format_args!(
                "Could not find service worker with that version_id"
            ))),
            info => js(info),
        }
    }

    pub(crate) fn start_worker_for_scope(&self, _: Cx<'_, '_>, scope: &[u8]) -> JsResult<JSValue> {
        let started = self
            .0
            .perform("serviceWorkers.startWorkerForScope", list![string(scope)]);
        Ok(task::promise(async { engine::to_js(&started.await?) }))
    }
}

pub(crate) struct Extensions(pub(super) &'static Session);

impl Extensions {
    pub(crate) fn get_all_extensions(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        self.0.get_all_extensions(cx)
    }

    pub(crate) fn get_extension(&self, cx: Cx<'_, '_>, id: &[u8]) -> JsResult<JSValue> {
        self.0.get_extension(cx, id)
    }

    pub(crate) fn load_extension<'a>(
        &self,
        cx: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<JSValue> {
        self.0.load_extension(cx, values)
    }

    pub(crate) fn remove_extension(&self, id: &[u8]) {
        self.0.remove_extension(id);
    }
}

impl Session {
    pub(crate) fn get_all_extensions(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&self
            .mirror
            .extensions
            .borrow()
            .iter()
            .map(|it| it.0.clone())
            .collect::<Value>())
    }

    pub(crate) fn get_extension(&self, _: Cx<'_, '_>, id: &[u8]) -> JsResult<JSValue> {
        let extensions = self.mirror.extensions.borrow();
        extensions
            .iter()
            .find(|it| it.0["id"].text().as_bytes() == id)
            .map_or(Ok(JSValue::NULL), |it| js(&it.0))
    }

    pub(crate) fn load_extension<'a>(
        &self,
        _: Cx<'a, '_>,
        values: Values<'a, '_>,
    ) -> JsResult<JSValue> {
        let (session, arguments) = (self.itself(), from_js(values)?);
        Ok(task::promise(async move {
            let extension = session
                .perform("extensions.loadExtension", arguments)
                .await?;
            let hold = session.link()?.0.hold();
            let mut extensions = session.mirror.extensions.borrow_mut();
            extensions.retain(|it| !it.0["id"].is(extension["id"].text()));
            extensions.push((extension.clone(), hold));
            js(&extension)
        }))
    }

    pub(crate) fn remove_extension(&self, id: &[u8]) {
        self.tell_engine("extensions.removeExtension", list![string(id)]);
        self.mirror
            .extensions
            .borrow_mut()
            .retain(|it| it.0["id"].text().as_bytes() != id);
    }
}

/// By host. They are read when they are first needed.
#[derive(Default)]
pub(super) struct ZoomLevels(RefCell<Option<BTreeMap<String, f64>>>);

impl Session {
    pub(crate) fn zoom_level(&self, host: &str) -> Option<f64> {
        self.with_zoom_levels(|levels, _| levels.get(host).copied())
    }

    pub(crate) fn set_zoom_level(&self, host: &str, level: f64) {
        self.with_zoom_levels(|levels, file| {
            if levels.insert(host.to_owned(), level) != Some(level)
                && let Some(file) = file
            {
                let pairs = levels.iter().map(|it| ((**it.0).into(), (*it.1).into()));
                let all = Value::Record(pairs.collect()).to_json();
                in_background(
                    move || drop(files::write(&file, all.as_bytes(), 0o644)),
                    |()| Ok(()),
                );
            }
        });
    }

    fn with_zoom_levels<T>(
        &self,
        then: impl FnOnce(&mut BTreeMap<String, f64>, Option<String>) -> T,
    ) -> T {
        let file = self
            .storage_path
            .as_ref()
            .map(|it| files::join(&[it, "Zoom Levels"]));
        let read = || {
            let stored = file
                .as_deref()
                .and_then(files::read)
                .and_then(|it| Value::parse(&it))
                .unwrap_or_default();
            stored
                .members()
                .iter()
                .filter_map(|it| Some((it.0.display(), it.1.as_number()?)))
                .collect()
        };
        let mut levels = self.zoom_levels.0.borrow_mut();
        let levels = levels.get_or_insert_with(read);
        then(levels, file)
    }
}

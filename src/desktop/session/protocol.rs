//! `protocol`: the URLs that the app answers for.

use std::collections::BTreeMap;

use bun_jsc::{AbortSignal, Strong};
use bun_web::exec::with_js;
use bun_web::js_embedder::{AbortOnDrop, request_to_js};
use bun_web::net::body::Body;
use bun_web::net::embedder::Outgoing;
use bun_web::net::response::Answer;
use bun_web::net::{NetError, Result};
use bun_web::origin::Origin;
use bun_web::scheme::{self, Privileges};
use bun_web::url::{Url, percent_decode};

use super::Session;
use super::embedder::{called_back, fulfilled};
use super::load::{answer_of, body_of, bytes_of, from_record, latin1, or_failure, request_for};
use super::mirror::Setting;
use crate::generated_bindgen::session::js_ElectronProtocol;
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::task::LocalFuture;
use crate::value::Value;
use crate::webview::wire;
use crate::{app, files};

#[derive(Clone, Copy)]
enum Legacy {
    String,
    Buffer,
    Stream,
    File,
    Http,
}

#[derive(Clone)]
enum Handling {
    ByHandler,
    ByCallback(Legacy),
    FromFiles(Value),
}

#[derive(Default)]
pub(super) struct Schemes(RefCell<BTreeMap<String, Handling>>);

fn set_membership<T: PartialEq>(list: &mut Vec<T>, item: T, is_member: bool) {
    list.retain(|it| *it != item);
    list.extend(is_member.then_some(item));
}

/// `value[name] ?? value`
fn member_or_itself(value: JSValue, name: &str) -> JsResult<JSValue> {
    let member = if value.is_object() {
        get(value, name)?
    } else {
        JSValue::UNDEFINED
    };
    Ok(if member.is_undefined_or_null() {
        value
    } else {
        member
    })
}

/// The file, and the headers that it is served with.
fn find_file<'a>(source: &'a Value, url: &Url) -> Option<(String, &'a Value)> {
    let (host, path) = (string(url.host()), string(url.path_or_root()));
    let prefix = |route: &'a Value| route["match"]["path"].as_text().unwrap_or("/");
    let matches = |route: &&'a Value| {
        route["match"]["host"]
            .as_text()
            .is_none_or(|it| it.eq_ignore_ascii_case(&host))
            && (path.strip_prefix(prefix(route))).is_some_and(|rest| {
                prefix(route).ends_with('/') || rest.is_empty() || rest.starts_with('/')
            })
    };
    let routes = source["routes"].items().iter().filter(matches);
    let route = routes.max_by_key(|it| (it["match"]["host"].is_truthy(), prefix(it).len()))?;
    let (rest, source) = (
        string(&percent_decode(&path.as_bytes()[prefix(route).len()..])),
        &route["source"],
    );
    let index = if path.ends_with('/') {
        source["index"].as_text().unwrap_or("index.html")
    } else {
        ""
    };
    let root = files::real_path(source["root"].text())?;
    let file = files::real_path(&files::join(&[&root, &rest, index]))?;
    files::is_inside(&file, &root).then_some((file, &source["headers"]))
}

impl Session {
    fn set_handling(
        &self,
        scheme: &str,
        handling: Option<Handling>,
        handler: Option<JSValue>,
    ) -> JsResult<()> {
        let is_handled = handling.is_some();
        match handling {
            Some(handling) => self
                .schemes
                .0
                .borrow_mut()
                .insert(scheme.to_owned(), handling),
            None => self.schemes.0.borrow_mut().remove(scheme),
        };
        self.set_handler(&format!("{scheme}:"), handler)?;
        set_membership(
            &mut self.network.settings.write().handled_schemes,
            scheme.as_bytes().into(),
            is_handled,
        );
        let setting = Setting::Protocol {
            scheme: scheme.to_owned(),
            is_handled,
        };
        drop(self.remember(&format!("protocol {scheme}"), setting));
        Ok(())
    }

    pub(crate) fn handle_scheme(&self, scheme: &str, handler: Option<JSValue>) -> JsResult<()> {
        self.set_handling(scheme, handler.map(|_| Handling::ByHandler), handler)
    }

    async fn answer_from_files(&self, source: Value, given: Outgoing) -> Result<Answer> {
        let found =
            find_file(&source, &given.url).filter(|_| matches!(&*given.method, b"GET" | b"HEAD"));
        let (file, headers) = found.ok_or(NetError::FileNotFound)?;
        let mut request = request_for(&files::to_url(&file))?;
        request.headers = given.headers;
        let mut answer = self.load_directly(request).await?;
        from_record(headers)
            .iter()
            .for_each(|it| answer.headers.set_if_absent(it.0, it.1));
        Ok(answer)
    }

    async fn answer_by_callback(
        &'static self,
        kind: Legacy,
        handler: Strong,
        given: Outgoing,
        referrer: Option<String>,
    ) -> Result<Answer> {
        let upload = match given.body {
            Some(body) => list![
                record! { "type": "rawData", "bytes": Value::buffer(&body.open().read_to_end().await?) }
            ],
            None => Value::Undefined,
        };
        let headers = given
            .headers
            .sorted_and_combined()
            .into_iter()
            .map(|it| (latin1(&it.0).into(), latin1(&it.1).into()));
        let request = record! {
            "url": string(given.url.href()),
            "method": string(&given.method),
            "referrer": referrer.unwrap_or_default(),
            "headers": Value::Record(headers.collect()),
            "uploadData": upload,
        };
        let ask = |callback| call(handler.get(), &[js(&request)?, callback]).map(drop);
        let value = called_back(ask, |it| Ok(keep(argument(it, 0)))).await?;
        let value = value.get();
        let member = |name| {
            or_failure(if value.is_object() {
                get(value, name)
            } else {
                Ok(JSValue::UNDEFINED)
            })
        };
        let data = |name| or_failure(wire::data_from_js(member(name)?));
        if let Some(code) = member("error")?.get_number() {
            return Err(NetError::from_number(code as i32));
        }
        if value.is_undefined() || value.is_number() {
            return Err(NetError::Failed);
        }
        let (body, mime): (Body, _) = match kind {
            Legacy::File => {
                let path = or_failure(member_or_itself(value, "path").and_then(text_of))?;
                let request = request_for(&files::to_url(&files::absolute(&path)))?;
                let mut answer = self.load_directly(request).await?;
                from_record(&data("headers")?)
                    .iter()
                    .for_each(|it| answer.headers.set(it.0, it.1));
                return Ok(answer);
            }
            Legacy::Http => {
                let mut request = request_for(data("url")?.text())?;
                request.method = data("method")?
                    .as_text()
                    .unwrap_or("GET")
                    .to_ascii_uppercase()
                    .as_bytes()
                    .into();
                let session = cast::<Session>(member("session")?)
                    .map_or_else(|| or_failure(super::default()), Ok)?;
                return session.load_directly(request).await;
            }
            Legacy::Stream => {
                let convert = || {
                    let readable = get(realm::require(global(), Module::Stream)?, "Readable")?;
                    body_of(invoke(
                        readable,
                        "toWeb",
                        &[member_or_itself(value, "data")?],
                    )?)
                };
                (or_failure(convert())?, None)
            }
            Legacy::String | Legacy::Buffer => {
                let given = or_failure(member_or_itself(value, "data"))?;
                let bytes = match kind {
                    Legacy::Buffer => bytes_of(given).ok_or(NetError::NotImplemented)?,
                    _ => or_failure(text_of(given))?.into_bytes(),
                };
                (
                    bytes.into(),
                    Some(if matches!(kind, Legacy::String) {
                        "text/plain"
                    } else {
                        "text/html"
                    }),
                )
            }
        };
        let status = data("statusCode")?.as_number().map_or(200, |it| it as u16);
        let mut answer = Answer::new(status, b"", from_record(&data("headers")?), body);
        if let Some(mime) = data("mimeType")?.as_text().or(mime) {
            answer.headers.set(b"content-type", mime.as_bytes());
        }
        Ok(answer)
    }

    pub(super) fn answer(
        &'static self,
        request: Outgoing,
        initiator_origin: Option<String>,
        referrer: Option<String>,
    ) -> LocalFuture<'static, Result<Answer>> {
        let handling = self
            .schemes
            .0
            .borrow()
            .get(&string(request.url.scheme()))
            .cloned();
        let handler = or_failure(self.handler(&string(request.url.protocol())))
            .ok()
            .flatten();
        let handler = match (handling, handler) {
            (Some(Handling::FromFiles(source)), _) => {
                return Box::pin(self.answer_from_files(source, request));
            }
            (Some(Handling::ByCallback(kind)), Some(handler)) => {
                return Box::pin(self.answer_by_callback(kind, keep(handler), request, referrer));
            }
            (_, Some(handler)) => handler,
            _ => return Box::pin(async { Err(NetError::Failed) }),
        };
        let mut signal = AbortOnDrop::default();
        let response = fulfilled(|| {
            let given = signal.0.insert(AbortSignal::new(global())).clone();
            let request = with_js(|cx| {
                request_to_js(cx, request, given)
                    .map(|it| it.to_js())
                    .map_err(|it| it.into_js_error(cx.global()))
            })?;
            if let Some(origin) = initiator_origin {
                request.put(global(), b"initiatorOrigin", js(origin)?);
            }
            if let Some(referrer) = referrer {
                request.put_non_enumerable(global(), b"referrer", js(referrer)?);
            }
            call(handler, &[request])
        });
        Box::pin(async {
            let response = response.await;
            signal.disarm();
            let response = response.map_err(|_| NetError::Unexpected)?.get();
            match response.is_object() {
                true => or_failure(answer_of(response, false)),
                false => Err(NetError::Unexpected),
            }
        })
    }
}

fn register_schemes(schemes: JSValue) -> JsResult<()> {
    const PRIVILEGES: [(&str, Privileges); 8] = [
        ("standard", Privileges::STANDARD),
        ("secure", Privileges::SECURE),
        ("bypassCSP", Privileges::BYPASS_CSP),
        ("allowServiceWorkers", Privileges::ALLOW_SERVICE_WORKERS),
        ("supportFetchAPI", Privileges::SUPPORT_FETCH_API),
        ("corsEnabled", Privileges::CORS_ENABLED),
        ("stream", Privileges::STREAM),
        ("codeCache", Privileges::CODE_CACHE),
    ];
    if app::is_ready() {
        return Err(error(format_args!(
            "protocol.registerSchemesAsPrivileged should be called before app is ready"
        )));
    }
    for it in wire::data_from_js(schemes)?.items() {
        let given = PRIVILEGES
            .iter()
            .filter(|(name, _)| it["privileges"][*name].is_truthy());
        scheme::register(
            it["scheme"].text().as_bytes(),
            given.map(|it| it.1).collect(),
        );
    }
    Ok(())
}

/// That of the default session.
pub(crate) fn module() -> JsResult<JSValue> {
    let module = object!({});
    for name in texts_of(
        js_ElectronProtocol::CLASS
            .prototype(heap())
            .keys(global())?,
    )? {
        let method = name.clone();
        let forward = function(JSValue::UNDEFINED, move |_, given| match &*method {
            "registerSchemesAsPrivileged" => {
                register_schemes(argument(given, 0)).map(|()| JSValue::UNDEFINED)
            }
            method => invoke(get(super::default()?.to_js(), "protocol")?, method, given),
        })?;
        module.put(global(), name.as_bytes(), forward);
    }
    Ok(module)
}

impl Session {
    pub(crate) fn handles(&self, scheme: &str) -> bool {
        self.schemes.0.borrow().contains_key(scheme)
    }
}

pub(crate) struct Protocol(pub(super) &'static Session);

macro_rules! legacy {
    ($($method:ident: $kind:ident),* $(,)?) => {$(
        pub(crate) fn $method<'a>(&self, _: Cx<'a, '_>, scheme: &[u8], handler: JsLocal<'a, Callable>) -> JsResult<bool> {
            self.register(scheme, Handling::ByCallback(Legacy::$kind), Some(handler.to_js()))
        }
    )*};
}

impl Protocol {
    /// False if the scheme is taken.
    fn register(
        &self,
        scheme: &[u8],
        handling: Handling,
        handler: Option<JSValue>,
    ) -> JsResult<bool> {
        let is_free = !self.is_protocol_handled(scheme);
        if is_free {
            self.0
                .set_handling(&string(scheme), Some(handling), handler)?;
        }
        Ok(is_free)
    }

    legacy!(register_string: String, register_buffer: Buffer, register_stream: Stream, register_file: File, register_http: Http);

    pub(crate) fn register_schemes_as_privileged<'a>(
        &self,
        _: Cx<'a, '_>,
        schemes: JsLocal<'a, JSObject>,
    ) -> JsResult<()> {
        register_schemes(schemes.to_js())
    }

    pub(crate) fn handle<'a>(
        &self,
        _: Cx<'a, '_>,
        scheme: &[u8],
        handler: JsLocal<'a, Callable>,
    ) -> JsResult<()> {
        match self.register(scheme, Handling::ByHandler, Some(handler.to_js()))? {
            true => Ok(()),
            false => Err(error(format_args!(
                "Failed to register protocol: {}",
                string(scheme)
            ))),
        }
    }

    pub(crate) fn register_source<'a>(
        &self,
        _: Cx<'a, '_>,
        scheme: &[u8],
        source: JsLocal<'a, JSObject>,
    ) -> JsResult<()> {
        let source = wire::data_from_js(source.to_js())?;
        let problem = |it: &Value| {
            Some(if !matches!(it["source"], Value::Record(_)) {
                "Each route needs a 'source'"
            } else if !it["source"]["type"].is("directory") {
                "'source.type' must be 'directory'"
            } else if !files::is_absolute(it["source"]["root"].text()) {
                "'source.root' must be an absolute path"
            } else if (it["match"]["path"].as_text()).is_some_and(|it| !it.starts_with('/')) {
                "'match.path' must be a URL path starting with '/'"
            } else {
                return None;
            })
        };
        let problem = match source["routes"].items() {
            [] => Some("'routes' must be a non-empty array"),
            routes => routes.iter().find_map(problem),
        };
        if let Some(problem) = problem {
            return Err(type_error(format_args!("{problem}")));
        }
        match self.register(scheme, Handling::FromFiles(source), None)? {
            true => Ok(()),
            false => Err(error(format_args!(
                "Scheme {} is already handled",
                string(scheme)
            ))),
        }
    }

    pub(crate) fn get_source(&self, _: Cx<'_, '_>, scheme: &[u8]) -> JsResult<JSValue> {
        match self.0.schemes.0.borrow().get(&string(scheme)) {
            Some(Handling::FromFiles(source)) => js(source),
            _ => Ok(JSValue::NULL),
        }
    }

    pub(crate) fn unhandle(&self, cx: Cx<'_, '_>, scheme: &[u8]) -> JsResult<()> {
        match self.unregister_protocol(cx, scheme)? {
            true => Ok(()),
            false => Err(error(format_args!(
                "Failed to unhandle protocol: {}",
                string(scheme)
            ))),
        }
    }

    pub(crate) fn unregister_protocol(&self, _: Cx<'_, '_>, scheme: &[u8]) -> JsResult<bool> {
        let was_handled = self.is_protocol_handled(scheme);
        if was_handled {
            self.0.set_handling(&string(scheme), None, None)?;
        }
        Ok(was_handled)
    }

    pub(crate) fn is_protocol_handled(&self, scheme: &[u8]) -> bool {
        self.0.handles(&string(scheme))
    }

    /// The app has the files of a web origin, and its own pages get them from `server`. What that returns nothing for
    /// goes to the network, but scripts and style sheets are refused, and documents are for the web engine.
    pub(crate) fn serve<'a>(
        &self,
        _: Cx<'a, '_>,
        origin: &[u8],
        server: Option<JsLocal<'a, Callable>>,
    ) -> JsResult<()> {
        let origin =
            Origin::of(&Url::parse(origin).ok_or_else(|| type_error(format_args!("Invalid URL")))?);
        self.0
            .set_handler(&string(origin.as_bytes()), server.map(|it| it.to_js()))?;
        set_membership(
            &mut self.0.network.settings.write().served_origins,
            origin,
            server.is_some(),
        );
        Ok(())
    }
}

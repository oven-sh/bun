//! What the network stack asks of the app.

use std::rc::Rc;
use std::sync::Arc;

use bun_http::CertificateInfo;
use bun_jsc::Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_web::headers::HeaderList;
use bun_web::hosts::host_of;
use bun_web::net::auth::Login;
use bun_web::net::body::SharedBytes;
use bun_web::net::cookies::Change;
use bun_web::net::embedder::{
    About, Answered, Decision, Details, Embedder, Network, Outgoing, Paused, Prompt, RequestEvent,
    ResourceType, Verdict,
};
use bun_web::net::response::{Answer, Cached};
use bun_web::net::tls::ClientIdentity;
use bun_web::net::{NetError, Result};
use bun_web::origin::Origin;
use bun_web::request::Destination;
use bun_web::runtime::{create_certificate_chain, create_headers};
use bun_web::time::wall_now;
use bun_web::url::Url;

use super::load::{
    answer_of, error_from_js, from_record, grouped, latin1, or_failure, rejection, response_of,
};
use super::net::ClientRequest;
use super::{Session, certificate, online};
use crate::contents::page::Page;
use crate::devtools::network;
use crate::prelude::*;
use crate::task::{self, LocalFuture};
use crate::value::Value;
use crate::webview::embedder::Embedder as _;
use crate::webview::wire;
use crate::{app, os_crypt};

type Pending<T> = LocalFuture<'static, Result<T>>;

/// With the id of the session.
pub(super) struct ForNetwork(pub(super) u32);

fn title_cased(name: &[u8]) -> String {
    let after_dash = b"-".iter().chain(name).map(|it| *it == b'-');
    let case = |(it, starts): (&u8, bool)| {
        if starts {
            it.to_ascii_uppercase()
        } else {
            it.to_ascii_lowercase()
        }
    };
    name.iter()
        .zip(after_dash)
        .map(case)
        .map(char::from)
        .collect()
}

fn member(object: JSValue, name: &str) -> JsResult<JSValue> {
    if object.is_object() {
        get(object, name)
    } else {
        Ok(JSValue::UNDEFINED)
    }
}

fn host(about: &About) -> JSValue {
    about.client.and_then(host_of).unwrap_or(JSValue::UNDEFINED)
}

fn page_of(about: &About) -> Option<&'static Page> {
    cast(host(about))
}

fn contents_of(about: &About) -> JsResult<JSValue> {
    page_of(about).map_or(Ok(JSValue::UNDEFINED), Page::web_contents)
}

fn name_of(event: RequestEvent) -> &'static str {
    core::str::from_utf8(event.as_bytes()).unwrap_or_default()
}

fn put_all(object: JSValue, members: &Value) -> JsResult<()> {
    for (name, value) in members
        .members()
        .iter()
        .filter(|it| !matches!(it.1, Value::Undefined))
    {
        object.put(global(), name.text().as_bytes(), js(value)?);
    }
    Ok(())
}

fn details_to_js(about: &About, details: Details) -> JsResult<JSValue> {
    let contents = contents_of(about)?;
    let object = object!({
        "id": about.id,
        "url": string(about.url.href()),
        "method": string(&about.method),
        "webContentsId": member(contents, "id")?,
        "webContents": contents,
        "frame": page_of(about).map_or(Ok(JSValue::UNDEFINED), Page::frame)?,
    });
    let received = details.received.as_ref();
    let titled = |it: HeaderList| {
        Value::Record(
            it.combined()
                .map(|it| (title_cased(it.0).into(), latin1(&it.1).into()))
                .collect(),
        )
    };
    let more = record! {
        "initiatorOrigin": about.origin.as_ref().map(|it| string(it.as_bytes())),
        "resourceType": string(about.resource_type.as_bytes()),
        "referrer": string(about.referrer.as_ref().map_or(b"", Url::href)),
        "timestamp": wall_now() * 1e3,
        "uploadData": details.upload.map(|it| list![record! { "type": "rawData", "bytes": Value::buffer(&it) }]),
        "requestHeaders": details.request_headers.map(titled),
        "statusCode": received.map(|it| i32::from(it.status)),
        "statusLine": received.map(|it| format!("HTTP/1.1 {} {}", it.status, latin1(&it.status_text)).trim_end().to_owned()),
        "responseHeaders": received.map(|it| grouped(&it.headers)),
        "fromCache": (received.is_some() || details.outcome.is_some()).then(|| received.is_some_and(|it| it.cached != Cached::No)),
        "redirectURL": details.redirect_url.map(|it| string(it.href())),
        "error": details.outcome.map(|it| it.map_or_else(NetError::message, |()| "net::OK")),
    };
    put_all(object, &more).map(|()| object)
}

fn notify(steps: impl FnOnce() -> JsResult<()>) {
    if VirtualMachine::get().script_allowed() {
        task::report(steps());
    }
}

pub(super) fn query<T>(steps: impl FnOnce() -> JsResult<T>) -> Result<T> {
    if VirtualMachine::get().script_allowed() {
        or_failure(steps())
    } else {
        Err(NetError::Aborted)
    }
}

/// What the result of `steps` is fulfilled with.
pub(super) fn fulfilled(steps: impl FnOnce() -> JsResult<JSValue>) -> Pending<Strong> {
    let outcome = query(steps).map(task::settled);
    Box::pin(async { outcome?.await.map_err(|it| error_from_js(it.get())) })
}

/// What `convert` makes of the arguments of the callback that `ask` gets.
pub(super) fn called_back<T: 'static>(
    ask: impl FnOnce(JSValue) -> JsResult<()>,
    convert: impl Fn(&[JSValue]) -> JsResult<T> + 'static,
) -> Pending<T> {
    let (sender, answer) = task::oneshot();
    let sender = Cell::new(Some(sender));
    let asked = query(|| {
        ask(procedure(move |it| {
            if let Some(to) = sender.take() {
                to.send(or_failure(convert(it)));
            }
            Ok(())
        })?)
    });
    Box::pin(async move {
        asked?;
        match answer.await {
            Some(answer) => answer,
            None => core::future::pending().await,
        }
    })
}

/// Whether a listener has taken over.
fn emit_for(contents: JSValue, name: &str, arguments: &[JSValue]) -> JsResult<bool> {
    let event = Event::create();
    if contents.is_object() {
        emit(contents, name, &[&[event.to_js()], arguments].concat())?;
    }
    let contents = if contents.is_object() {
        contents
    } else {
        JSValue::NULL
    };
    emit(
        app::object(),
        name,
        &[&[event.to_js(), contents], arguments].concat(),
    )?;
    Ok(event.get_default_prevented())
}

fn chain_of(certificate: &CertificateInfo) -> JsResult<JSValue> {
    create_certificate_chain(global(), &certificate.cert, &certificate.issuers)
}

impl ForNetwork {
    fn session(&self) -> &'static Session {
        Session::with_id(self.0)
    }
}

impl Embedder for ForNetwork {
    fn tell(&self, event: RequestEvent, about: &About, details: Details) {
        let listens = self.session().network.listens(event, about);
        notify(|| {
            if about.is_inspected {
                network::request_changed(host(about), event, about, &details)?;
            }
            let listener = self.session().handler(name_of(event))?.filter(|_| listens);
            listener.map_or(Ok(()), |it| {
                call(it, &[details_to_js(about, details)?]).map(drop)
            })
        });
    }

    fn ask(&self, event: RequestEvent, about: &About, details: Details) -> Pending<Decision> {
        let ask = |callback| match self.session().handler(name_of(event))? {
            Some(listener) => call(listener, &[details_to_js(about, details)?, callback]).map(drop),
            None => call(callback, &[]).map(drop),
        };
        called_back(ask, |given| {
            let answer = wire::data_from_js(argument(given, 0))?;
            let bytes = |name: &str| {
                answer[name]
                    .is_truthy()
                    .then(|| answer[name].text().as_bytes().into())
            };
            let headers = [&answer["requestHeaders"], &answer["responseHeaders"]]
                .into_iter()
                .find(|it| it.is_truthy());
            Ok(Decision {
                cancels: answer["cancel"].is_truthy(),
                redirect_url: bytes("redirectURL"),
                headers: headers.map(from_record),
                status_line: bytes("statusLine"),
            })
        })
    }

    fn handle_protocol(&self, about: &About, request: Outgoing) -> Pending<Answer> {
        let origin = about.origin.as_ref().map(|it| string(it.as_bytes()));
        self.session().answer(
            request,
            origin,
            about.referrer.as_ref().map(|it| string(it.href())),
        )
    }

    fn serve(
        &self,
        about: &About,
        headers: &HeaderList,
        network: Network,
    ) -> Pending<Option<Answer>> {
        let destination = about.destination.unwrap_or(Destination::Empty);
        let answer = fulfilled(|| {
            let Some(server) = self
                .session()
                .handler(&string(Origin::of(&about.url).as_bytes()))?
            else {
                return Ok(JSValue::UNDEFINED);
            };
            let details = object!({
                "url": string(about.url.href()),
                "method": string(&about.method),
                "headers": create_headers(global(), headers),
                "destination": string(destination.as_bytes()),
                "webContents": contents_of(about)?,
            });
            let pass_on = function(JSValue::UNDEFINED, move |_, given| {
                let path = Some(argument(given, 0))
                    .filter(|it| !it.is_undefined())
                    .map(text_of)
                    .transpose()?;
                let answer = network(path.as_ref().map(String::as_bytes));
                Ok(task::busy_promise(async {
                    response_of(answer.await.map_err(rejection)?)
                }))
            })?;
            call(server, &[details, pass_on])
        });
        Box::pin(async move {
            let answer = answer.await?.get();
            or_failure(
                answer
                    .to_boolean()
                    .then(|| answer_of(answer, destination == Destination::Style))
                    .transpose(),
            )
        })
    }

    fn send_by_web_engine(&self, request: Outgoing) -> Pending<Answer> {
        Box::pin(self.session().send_by_engine(request))
    }

    fn network_is_used(&self) {
        notify(|| online::is_online().map(drop));
    }

    fn verify_certificate(
        &self,
        certificate: &CertificateInfo,
        error: Option<NetError>,
    ) -> Pending<Verdict> {
        let ask = |callback| {
            self.session().ask_to_verify(
                js(string(&certificate.hostname))?,
                chain_of(certificate)?,
                error,
                callback,
            )
        };
        called_back(ask, |given| {
            Ok(match argument(given, 0).get_number() {
                Some(0.) => Verdict::Accept,
                Some(-3.) => Verdict::AsVerified,
                _ => Verdict::Refuse,
            })
        })
    }

    fn excuses_certificate(
        &self,
        about: &About,
        certificate: &CertificateInfo,
        error: NetError,
    ) -> Pending<bool> {
        let ask = |callback| {
            let described = js(&certificate::describe(chain_of(certificate)?)?)?;
            let is_main_frame = about.resource_type == ResourceType::MainFrame;
            let arguments = [
                js(string(about.url.href()))?,
                js(error.message())?,
                described,
                callback,
                is_main_frame.into(),
            ];
            match emit_for(contents_of(about)?, "certificate-error", &arguments)? {
                true => Ok(()),
                false => call(callback, &[]).map(drop),
            }
        };
        called_back(ask, |given| Ok(argument(given, 0) == JSValue::TRUE))
    }

    fn select_client_certificate(
        &self,
        about: &About,
        candidates: &[Arc<ClientIdentity>],
    ) -> Pending<Option<usize>> {
        let describe = |it: &Arc<ClientIdentity>| {
            certificate::describe(create_certificate_chain(
                global(),
                &it.chain[0],
                &it.chain[1..],
            )?)
        };
        let list = match query(|| candidates.iter().map(describe).collect::<JsResult<Value>>()) {
            Ok(list) => Rc::new(list),
            Err(error) => return Box::pin(async move { Err(error) }),
        };
        let offered = Rc::clone(&list);
        let ask = |callback| {
            let server = format!(
                "{}:{}",
                string(about.url.hostname()),
                about.url.port_or_default().unwrap_or(443)
            );
            let list = js(&*list)?;
            match emit_for(
                contents_of(about)?,
                "select-client-certificate",
                &[js(server)?, list, callback],
            )? {
                true => Ok(()),
                false => call(callback, &[list.get_index(global(), 0)?]).map(drop),
            }
        };
        called_back(ask, move |given| {
            let chosen = wire::data_from_js(member(argument(given, 0), "data")?)?;
            Ok(offered
                .items()
                .iter()
                .position(|it| it["data"].is(chosen.text())))
        })
    }

    fn log_in(&self, about: &About, prompt: Prompt) -> Pending<Option<Login>> {
        let ask = |callback| {
            let info = object!({
                "isProxy": prompt.is_proxy,
                "scheme": string(prompt.scheme.as_bytes()),
                "host": string(prompt.peer.hostname()),
                "port": u32::from(prompt.peer.port_or_default().unwrap_or(0)),
                "realm": string(&prompt.realm),
            });
            let (contents, kind) = (contents_of(about)?, about.resource_type);
            let is_taken = match about.client.and_then(ClientRequest::with_id) {
                Some(request) => {
                    invoke(request.to_js(), "emit", &[js("login")?, info, callback])?.to_boolean()
                }
                None if contents.is_object() => {
                    let details = object!({
                        "url": string(about.url.href()),
                        "pid": crate::process::id(),
                        "isMainFrame": kind == ResourceType::MainFrame,
                        "isRequestForNavigation": matches!(kind, ResourceType::MainFrame | ResourceType::SubFrame),
                        "firstAuthAttempt": prompt.is_first_attempt,
                        "responseHeaders": &grouped(&prompt.headers),
                    });
                    emit_for(contents, "login", &[details, info, callback])?
                }
                None => false,
            };
            if is_taken {
                Ok(())
            } else {
                call(callback, &[]).map(drop)
            }
        };
        called_back(ask, |given| {
            let [name, password] = [0, 1].map(|it| wire::data_from_js(argument(given, it)));
            let password = password?.text().as_bytes().into();
            Ok(name?.as_text().map(|it| Login {
                name: it.as_bytes().into(),
                password,
            }))
        })
    }

    fn system_authorities(&self) -> Vec<Box<[u8]>> {
        query(certificate::authorities)
            .unwrap_or_default()
            .into_iter()
            .map(|it| it.into_bytes().into())
            .collect()
    }

    fn answered(&self, about: &About, report: Answered) {
        notify(|| {
            let (details, outcome) = (object!({}), report.outcome.as_ref());
            let members = record! {
                "url": string(about.url.href()),
                "method": string(&about.method),
                "destination": about.destination.map(|it| string(it.as_bytes())),
                "source": string(report.by.as_bytes()),
                "duration": report.duration,
                "status": outcome.ok().map(|it| i32::from(it.0)),
                "error": outcome.err().map(|it| it.code()),
            };
            put_all(details, &members)?;
            if let Ok((_, headers)) = outcome {
                details.put(global(), b"headers", create_headers(global(), headers));
            }
            emit(app::object(), "request-answered", &[details])
        });
    }

    fn pause(&self, about: &About, request: Outgoing) -> Pending<Paused> {
        network::pause(host(about), about, request)
    }

    fn keep_body(&self, about: &About, body: SharedBytes) {
        network::keep_body(host(about), about, &body);
    }

    fn source_of(&self, url: &Url) -> Pending<Option<Vec<u8>>> {
        let source = fulfilled(|| app::source_of(js(string(url.href()))?));
        Box::pin(async {
            let source = Some(source.await?.get()).filter(|it| !it.is_undefined());
            or_failure(
                source
                    .map(|it| text_of(it).map(String::into_bytes))
                    .transpose(),
            )
        })
    }

    fn cookie_changed(&self, change: &Change) {
        notify(|| self.session().cookie_changed(change));
    }

    fn encrypt(&self, bytes: &[u8]) -> Option<Vec<u8>> {
        os_crypt::can_encrypt().then(|| os_crypt::encrypt(bytes))
    }

    fn decrypt(&self, bytes: &[u8]) -> Option<Vec<u8>> {
        os_crypt::can_encrypt().then(|| os_crypt::decrypt(bytes))?
    }
}

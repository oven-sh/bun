use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::Strong;
use bun_sys::{Fd, File, O};
use bun_web::exec::{blocking, never_at_once};
use bun_web::headers::HeaderList;
use bun_web::net::body::Body;
use bun_web::net::fetch::{Controller, Observer};
use bun_web::time::wall_now;
use bun_web::url::{Url, percent_decode};

use super::Session;
use super::load::{from_record, latin1, request_for};
use crate::generated_bindgen::session::js_ElectronDownloadItem as fields;
use crate::prelude::*;
use crate::task::{self, Later, LocalFuture};
use crate::text::{before, origin_of, random_bytes, split_once};
use crate::value::Value;
use crate::webview::engine::{Engine, Hold, Target};
use crate::webview::wire;
use crate::{dialog, files};

struct InEngine {
    engine: Rc<Engine>,
    id: i32,
    hold: Cell<Option<Hold>>,
    /// Where the engine writes while the user chooses.
    temporary: RefCell<Option<(String, Later<()>)>>,
}

enum Source {
    Engine(InEngine),
    Network {
        session: &'static Session,
        controller: Controller,
        resumed: RefCell<Option<Later<()>>>,
    },
}

pub(crate) struct DownloadItem {
    source: Source,
    /// By the names of the methods that return them.
    facts: RefCell<Value>,
    save_path: RefCell<String>,
}

pub(crate) fn is_reserved(it: char) -> bool {
    it < ' ' || matches!(it, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
}

fn file_name(url: &str, disposition: &str, suggested: Option<&str>) -> String {
    let lower = disposition.to_ascii_lowercase();
    let after =
        |start| split_once(&lower, start).map(|it| &disposition[disposition.len() - it.1.len()..]);
    let decoded = |it: &[u8]| {
        core::str::from_utf8(&percent_decode(it))
            .ok()
            .map(str::to_owned)
    };
    let encoded = after("filename*=utf-8''").and_then(|it| decoded(before(it, ";").as_bytes()));
    let plain =
        || after("filename=").map(|it| before(before(it.trim_start_matches('"'), "\""), ";"));
    let of_url = || {
        let url = Url::parse(url.as_bytes()).filter(|it| it.is_http() || it.scheme() == b"file")?;
        decoded(bun_paths::basename_posix(url.path()))
    };
    let name = (encoded
        .or_else(|| suggested.or_else(plain).map(str::to_owned))
        .filter(|it| !it.is_empty()))
    .or_else(of_url)
    .filter(|it| !it.is_empty())
    .unwrap_or_else(|| "download".to_owned());
    let disguises = |it| matches!(it, '\u{7f}'..='\u{9f}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}');
    let name: String = name
        .trim_end_matches(['.', ' '])
        .chars()
        .map(|it| {
            if is_reserved(it) || disguises(it) {
                '_'
            } else {
                it
            }
        })
        .collect();
    if name.starts_with('.') || name.is_empty() {
        format!("_{}", name.trim_start_matches('.'))
    } else {
        name
    }
}

pub(crate) fn facts_of(urls: Vec<String>, headers: &HeaderList, suggested: Option<&str>) -> Value {
    let header = |name: &[u8]| latin1(&headers.get_or_empty(name));
    let (url, disposition) = (
        urls.last().cloned().unwrap_or_default(),
        header(b"content-disposition"),
    );
    record! {
        "getFilename": file_name(&url, &disposition, suggested),
        "getURL": url,
        "getURLChain": urls.into_iter().map(Value::from).collect::<Value>(),
        "getMimeType": before(&header(b"content-type"), ";"),
        "getTotalBytes": header(b"content-length").parse().unwrap_or(0.),
        "getReceivedBytes": 0,
        "getContentDisposition": disposition,
        "getLastModifiedTime": header(b"last-modified"),
        "getETag": header(b"etag"),
        "getStartTime": wall_now(),
        "getState": "progressing",
        "hasUserGesture": false,
    }
}

fn temporary_name() -> String {
    format!("{:08x}.download", u32::from_ne_bytes(random_bytes()))
}

pub(crate) struct Redirects {
    pub(crate) urls: RefCell<Vec<String>>,
    origin: Option<String>,
}

impl Redirects {
    pub(crate) fn within_origin(url: &str) -> Redirects {
        Redirects {
            urls: vec![url.to_owned()].into(),
            origin: Some(origin_of(url)),
        }
    }
}

impl Observer for Redirects {
    fn follows<'a>(
        &'a self,
        _: u16,
        _: &'a [u8],
        target: &'a Url,
        _: &'a HeaderList,
    ) -> LocalFuture<'a, bool> {
        let target = string(target.href());
        let follows = (self.origin.as_ref()).is_none_or(|it| *it == origin_of(&target));
        self.urls.borrow_mut().push(target);
        Box::pin(async move { follows })
    }
}

impl Session {
    pub(crate) fn download_url<'a>(
        &self,
        _: Cx<'a, '_>,
        url: &[u8],
        options: JsLocal<'a>,
        contents: JsLocal<'a>,
        name: Option<&[u8]>,
    ) -> JsResult<()> {
        let headers = from_record(&wire::data_from_js(options.to_js())?["headers"]);
        self.download(&string(url), headers, contents.to_js(), name.map(string));
        Ok(())
    }

    pub(crate) fn download(
        &self,
        url: &str,
        headers: HeaderList,
        contents: JSValue,
        name: Option<String>,
    ) {
        let Ok(mut request) = request_for(url) else {
            return;
        };
        request.headers = headers;
        let (session, contents) = (self.itself(), keep(contents));
        let redirects = Redirects {
            urls: vec![string(request.url.href())].into(),
            origin: None,
        };
        let controller = Controller::default();
        task::spawn(async move {
            let loaded = session.load(request, Default::default(), &redirects, &controller);
            if let Ok(loaded) = loaded.await {
                let facts = facts_of(redirects.urls.take(), &loaded.head.headers, name.as_deref());
                let item = DownloadItem::create(session, facts, controller);
                let body = loaded.body.unwrap_or_default();
                task::report(item.start(session, body, contents.get()).map(drop));
            }
        });
    }

    pub(crate) fn create_interrupted_download<'a>(
        &self,
        _: Cx<'a, '_>,
        options: JsLocal<'a, JSObject>,
    ) -> JsResult<()> {
        let options = wire::data_from_js(options.to_js())?;
        let (path, urls) = (options["path"].text(), options["urlChain"].items());
        if path.is_empty() || urls.is_empty() || options["length"].number() == 0. {
            return Err(error(format_args!(
                "Must pass non-empty path, urlChain and length."
            )));
        }
        if options["offset"].number() >= options["length"].number() {
            return Err(error(format_args!(
                "Must pass an offset value less than length."
            )));
        }
        let facts = facts_of(
            urls.iter().map(Value::display).collect(),
            &Default::default(),
            Some(files::name(path)),
        )
        .with("getMimeType", options["mimeType"].text())
        .with("getTotalBytes", &options["length"])
        .with("getReceivedBytes", options["offset"].number())
        .with("getLastModifiedTime", options["lastModified"].text())
        .with("getETag", options["eTag"].text())
        .with(
            "getStartTime",
            options["startTime"].as_number().unwrap_or_else(wall_now),
        )
        .with("getState", "interrupted")
        .with("canResume", true);
        let (session, item) = (
            self.itself(),
            Root::new(DownloadItem::create(
                self.itself(),
                facts,
                Controller::default(),
            )),
        );
        item.get().save_path.replace(path.to_owned());
        later::soon(move |_| {
            announce(
                session.to_js(),
                "will-download",
                &[item.get().to_js(), JSValue::NULL],
            )
        });
        Ok(())
    }
}

macro_rules! facts {
    ($($method:ident: $name:literal),* $(,)?) => {$(
        pub(crate) fn $method(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
            js(&self.fact($name))
        }
    )*};
}

impl DownloadItem {
    fn create(
        session: &'static Session,
        facts: Value,
        controller: Controller,
    ) -> &'static DownloadItem {
        let source = Source::Network {
            session,
            controller,
            resumed: Default::default(),
        };
        fields::create(
            heap(),
            DownloadItem {
                source,
                facts: facts.into(),
                save_path: Default::default(),
            },
        )
    }

    /// What a navigation has got.
    pub(crate) fn save_loaded(
        session: &'static Session,
        facts: Value,
        body: Body,
        contents: JSValue,
        controller: Controller,
    ) -> JsResult<()> {
        DownloadItem::create(session, facts, controller)
            .start(session, body, contents)
            .map(drop)
    }

    pub(crate) fn save_pdf(
        session: &'static Session,
        url: String,
        bytes: Vec<u8>,
        contents: JSValue,
        name: &str,
    ) -> JsResult<Later<()>> {
        let facts = (facts_of(vec![url], &Default::default(), Some(name)))
            .with("getMimeType", "application/pdf")
            .with("getTotalBytes", bytes.len() as f64);
        DownloadItem::create(session, facts, Controller::default()).start(
            session,
            bytes.into(),
            contents,
        )
    }

    pub(crate) fn find(engine: &Rc<Engine>, id: i32, facts: &Value) -> JSValue {
        if let Some(known) = engine.object(id).and_then(cast::<DownloadItem>) {
            known.facts.replace(facts.clone());
            return known.to_js();
        }
        let (hold, temporary) = (Some(engine.hold()).into(), Default::default());
        let source = Source::Engine(InEngine {
            engine: Rc::clone(engine),
            id,
            hold,
            temporary,
        });
        let item = fields::create(
            heap(),
            DownloadItem {
                source,
                facts: facts.clone().into(),
                save_path: Default::default(),
            },
        );
        engine.add_object(id, item.to_js());
        item.to_js()
    }

    fn fact(&self, name: &str) -> Value {
        let facts = self.facts.borrow();
        let Source::Network { resumed, .. } = &self.source else {
            return facts[name].clone();
        };
        let [received, total] = ["getReceivedBytes", "getTotalBytes"].map(|it| facts[it].number());
        match name {
            "isPaused" => resumed.borrow().is_some().into(),
            "canResume" => (resumed.borrow().is_some() || facts[name].is_truthy()).into(),
            "getInitiatorOrigin" => facts[name].text().into(),
            "getEndTime" => facts[name].number().into(),
            "getPercentComplete" => if total > 0. {
                (received / total * 100.).floor()
            } else {
                -1.
            }
            .into(),
            "getCurrentBytesPerSecond" => {
                (received / (wall_now() - facts["getStartTime"].number()).max(0.001)).into()
            }
            _ => facts[name].clone(),
        }
    }

    fn set(&self, name: &str, value: impl Into<Value>) {
        self.facts.borrow_mut().set(name, value.into());
    }

    fn is_progressing(&self) -> bool {
        self.facts.borrow()["getState"].is("progressing")
    }

    fn choose_path(&self, session: &Session, contents: JSValue) -> JsResult<Later<()>> {
        let path = files::join(&[&session.download_path()?, self.fact("getFilename").text()]);
        let options = record! { "defaultPath": path }.and(&wire::data_from_js(
            fields::dialog_options(self).unwrap_or(JSValue::UNDEFINED),
        )?);
        let window = if contents.is_object() {
            invoke(contents, "getOwnerBrowserWindow", &[])?
        } else {
            JSValue::NULL
        };
        let arguments = [window, js(&options)?];
        let chosen = task::outcome(invoke(
            dialog::object(),
            "showSaveDialog",
            &arguments[usize::from(!window.is_object())..],
        ));
        let item = Root::new(self);
        Ok(Later::of(async move {
            let chosen = never_at_once(chosen).await.ok().and_then(|it| {
                wire::data_from_js(it.get())
                    .map_err(|it| task::report(Err(it)))
                    .ok()
            });
            match chosen.unwrap_or_default()["filePath"].text() {
                "" => item.get().cancel(),
                path => drop(item.get().save_path.replace(path.to_owned())),
            }
        }))
    }

    fn start(&self, session: &Session, body: Body, contents: JSValue) -> JsResult<Later<()>> {
        let frame = if contents.is_object() {
            get(contents, "mainFrame")?
        } else {
            JSValue::UNDEFINED
        };
        if frame.is_object() {
            self.set("getInitiatorOrigin", text_of(get(frame, "origin")?)?);
        }
        if !dispatch(
            session.to_js(),
            "will-download",
            &[self.to_js(), contents, frame],
        )? {
            return Ok(Later::of(async {}));
        }
        let must_ask = self.save_path.borrow().is_empty() && self.is_progressing();
        let (chosen, item) = (
            must_ask
                .then(|| self.choose_path(session, contents))
                .transpose()?,
            Root::new(self),
        );
        Ok(Later::of(async move {
            never_at_once(async {}).await;
            if let Some(chosen) = chosen {
                chosen.await;
            }
            let partial = format!("{}.{}", item.get().save_path.borrow(), temporary_name());
            let is_written = item.get().write(&partial, O::TRUNC, body).await.is_some();
            let is_complete =
                is_written && files::rename(&partial, &item.get().save_path.borrow()).is_ok();
            if !is_complete {
                files::remove(&partial);
            }
            item.get().finish(is_complete);
        }))
    }

    async fn write(&self, path: &str, how: i32, mut body: Body) -> Option<()> {
        let Source::Network {
            controller,
            resumed,
            ..
        } = &self.source
        else {
            return None;
        };
        let controller = Some(controller).filter(|it| !it.is_aborted())?;
        let file = Arc::new(
            File::openat(
                Fd::cwd(),
                path.as_bytes(),
                O::WRONLY | O::CREAT | O::CLOEXEC | how,
                0o644,
            )
            .ok()?,
        );
        while let Some(chunk) = controller.race(body.read()).await.ok()? {
            let paused = resumed.borrow().clone();
            if let Some(resumed) = paused {
                resumed.await;
            }
            let (file, length) = (
                (!controller.is_aborted()).then(|| Arc::clone(&file))?,
                chunk.len(),
            );
            blocking(move || file.write_all(&chunk)).await?.ok()?;
            self.set(
                "getReceivedBytes",
                self.fact("getReceivedBytes").number() + length as f64,
            );
            task::report(announce(
                self.to_js(),
                "updated",
                &[js("progressing").ok()?],
            ));
        }
        Some(())
    }

    fn finish(&self, is_complete: bool) {
        if is_complete || self.is_progressing() {
            self.set(
                "getState",
                if is_complete {
                    "completed"
                } else {
                    "interrupted"
                },
            );
        }
        self.set("getEndTime", wall_now());
        task::report(
            js(&self.fact("getState")).and_then(|it| announce(self.to_js(), "done", &[it])),
        );
    }

    /// From where another run of the app has got to.
    async fn go_on(&self, session: &Session, controller: &Controller) -> Option<()> {
        let mut request = request_for(self.fact("getURL").text()).ok()?;
        request.headers.set(
            b"range",
            format!("bytes={}-", self.fact("getReceivedBytes").number()).as_bytes(),
        );
        let validator = ["getETag", "getLastModifiedTime"]
            .map(|it| self.fact(it))
            .into_iter()
            .find(Value::is_truthy);
        if let Some(it) = validator {
            request.headers.set(b"if-range", it.text().as_bytes());
        }
        let loaded = session
            .load(request, Default::default(), &(), controller)
            .await
            .ok()?;
        let how = match loaded.head.status {
            206 => O::APPEND,
            200 => (self.set("getReceivedBytes", 0), O::TRUNC).1,
            _ => return None,
        };
        let path = self.save_path.borrow().clone();
        self.write(&path, how, loaded.body.unwrap_or_default())
            .await
    }

    /// The dialog of the engine would belong to no window.
    pub(crate) fn ask_where_to_save(&self, session: &Session, contents: JSValue) -> JsResult<()> {
        let (Source::Engine(it), true) = (&self.source, self.save_path.borrow().is_empty()) else {
            return Ok(());
        };
        let temporary = files::join(&[&it.engine.directory, "..", &temporary_name()]);
        it.engine
            .tell(Target::Object(it.id), "setSavePath", list![&*temporary]);
        it.temporary
            .replace(Some((temporary, self.choose_path(session, contents)?)));
        Ok(())
    }

    pub(crate) fn changed(&self, name: &str, state: &str) -> JsResult<()> {
        let Source::Engine(it) = &self.source else {
            return Ok(());
        };
        if name != "done" {
            return announce(self.to_js(), name, &[js(state)?]);
        }
        let (item, temporary, mut state) = (Root::new(self), it.temporary.take(), state.to_owned());
        let held: (Option<Strong>, _) = (it.engine.remove_object(it.id).map(keep), it.hold.take());
        task::spawn(async move {
            if let Some((temporary, chosen)) = temporary {
                chosen.await;
                let (from, to) = (temporary.clone(), item.get().save_path.borrow().clone());
                if state == "completed" && to.is_empty() {
                    "cancelled".clone_into(&mut state);
                } else if state == "completed"
                    && blocking(move || files::move_to(&from, &to)).await != Some(true)
                {
                    "interrupted".clone_into(&mut state);
                }
                files::remove(&temporary);
            }
            drop(held);
            item.get().set("getState", &*state);
            task::report(js(state).and_then(|it| announce(item.get().to_js(), "done", &[it])));
        });
        Ok(())
    }

    pub(crate) fn engine_closed(&self) -> JsResult<()> {
        self.changed("done", "interrupted")
    }

    facts!(
        is_paused: "isPaused",
        can_resume: "canResume",
        get_url: "getURL",
        get_urlchain: "getURLChain",
        get_initiator_origin: "getInitiatorOrigin",
        get_mime_type: "getMimeType",
        has_user_gesture: "hasUserGesture",
        get_filename: "getFilename",
        get_total_bytes: "getTotalBytes",
        get_received_bytes: "getReceivedBytes",
        get_percent_complete: "getPercentComplete",
        get_current_bytes_per_second: "getCurrentBytesPerSecond",
        get_content_disposition: "getContentDisposition",
        get_state: "getState",
        get_last_modified_time: "getLastModifiedTime",
        get_etag: "getETag",
        get_start_time: "getStartTime",
        get_end_time: "getEndTime",
    );

    pub(crate) fn get_save_path(&self) -> String {
        self.save_path.borrow().clone()
    }

    pub(crate) fn set_save_path(&self, path: &[u8]) {
        self.save_path.replace(string(path));
        if let Source::Engine(it) = &self.source {
            it.engine
                .tell(Target::Object(it.id), "setSavePath", list![string(path)]);
        }
    }

    pub(crate) fn get_save_dialog_options(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        fields::dialog_options(self).map_or_else(|| Ok(object!({})), Ok)
    }

    pub(crate) fn set_save_dialog_options(&self, options: JsLocal<'_, JSObject>) {
        fields::set_dialog_options(self, options.to_js());
    }

    pub(crate) fn pause(&self) {
        match &self.source {
            Source::Engine(it) => it.engine.tell(Target::Object(it.id), "pause", list![]),
            Source::Network { resumed, .. } => drop(resumed.borrow_mut().get_or_insert_default()),
        }
    }

    pub(crate) fn resume(&self) {
        match &self.source {
            Source::Engine(it) => it.engine.tell(Target::Object(it.id), "resume", list![]),
            Source::Network {
                session,
                controller,
                resumed,
            } => {
                if let Some(it) = resumed.take() {
                    it.set(());
                }
                if self.facts.borrow_mut().take("canResume").is_truthy() {
                    self.set("getState", "progressing");
                    let (item, session, controller) =
                        (Root::new(self), *session, controller.clone());
                    task::spawn(async move {
                        item.get()
                            .finish(item.get().go_on(session, &controller).await.is_some())
                    });
                }
            }
        }
    }

    pub(crate) fn cancel(&self) {
        match &self.source {
            Source::Engine(it) => it.engine.tell(Target::Object(it.id), "cancel", list![]),
            Source::Network {
                controller,
                resumed,
                ..
            } => {
                let was_interrupted = self.facts.borrow_mut().take("canResume").is_truthy();
                if was_interrupted || self.is_progressing() {
                    self.set("getState", "cancelled");
                    controller.abort();
                    if let Some(it) = resumed.take() {
                        it.set(());
                    }
                }
                if was_interrupted {
                    self.finish(false);
                }
            }
        }
    }
}

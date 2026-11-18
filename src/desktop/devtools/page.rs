//! A page of the engine of the app.

use core::cell::OnceCell;
use std::rc::{Rc, Weak};

use bun_web::host::ChosenFile;
use bun_web::input::Extent;
use bun_web::net::body::Body;
use bun_web::net::response::Response;
use bun_web::url::Url;

use super::agent::{Agent, KNOW_FRAMES, REVEAL};
use super::connection::{Client, cookies, set_cookie};
use super::contents::Contents;
use super::frames::Frames;
use super::input::Input;
use super::network::Watcher;
use super::runtime::{REQUESTED, REQUESTS, Whose};
use super::scripts;
use super::{
    Emit, Failure, Outcome, Reply, Session, after_events, done, seconds, target_id_of, unknown,
};
use crate::contents::inspection::{EmulatedMedia, News, Observer, Stage};
use crate::prelude::*;
use crate::value::Value;
use crate::{task, text};

const CONTEXTS_OF_DOCUMENT: u32 = 64;

state!(fn last_document() -> Cell<u32>);
state!(fn last_session() -> Cell<u32>);

/// How many `REQUESTS` each expression from the console can still make. A page can get hold of the helpers.
#[derive(Default)]
struct Permits(RefCell<Vec<Weak<Cell<usize>>>>);

impl Permits {
    /// As many as it names, for as long as the result lives.
    fn issue(&self, params: &Value) -> Option<Rc<Cell<usize>>> {
        if !params["includeCommandLineAPI"].is_truthy() || params["throwOnSideEffect"].is_truthy() {
            return None;
        }
        let named = |name| text::split(params["expression"].text(), name).count() - 1;
        let permit = Rc::new(Cell::new(REQUESTS.map(named).iter().sum()));
        let mut all = self.0.borrow_mut();
        all.retain(|it| it.strong_count() > 0);
        all.push(Rc::downgrade(&permit));
        Some(permit)
    }

    fn take(&self) -> bool {
        let all = self.0.borrow();
        let found = all.iter().filter_map(Weak::upgrade).find(|it| it.get() > 0);
        found.inspect(|it| it.update(|it| it - 1)).is_some()
    }
}

pub(super) struct PageSession {
    contents: Contents,
    id: Rc<str>,
    emit: Emit,
    observer: OnceCell<Rc<Observer>>,
    number: u32,
    /// Unless it is in another process.
    agent: RefCell<Option<Rc<Agent>>>,
    /// What each document is told again: a name, the method and the parameters.
    lasting: RefCell<Vec<(String, String, Value)>>,
    logs: Cell<bool>,
    network: Rc<Watcher>,
    input: Input,
    last_script: Cell<u32>,
    streams: RefCell<Vec<(String, Body)>>,
    last_stream: Cell<u32>,
    permits: Rc<Permits>,
    real_size: Cell<Option<Extent>>,
    /// They are targets of their own.
    frames: Option<Rc<Frames>>,
}

impl PageSession {
    pub(super) fn new(
        contents: Contents,
        emit: Emit,
        client: Client,
        frames: Option<Rc<Frames>>,
    ) -> JsResult<Rc<PageSession>> {
        contents.live_page()?;
        last_session().update(|it| it + 1);
        let session = Rc::new(PageSession {
            id: target_id_of(contents.object()),
            observer: OnceCell::new(),
            number: last_session().get(),
            agent: RefCell::default(),
            lasting: RefCell::default(),
            logs: Cell::default(),
            network: Watcher::new(contents.clone(), Rc::clone(&emit)),
            input: Input::default(),
            last_script: Cell::default(),
            streams: RefCell::default(),
            last_stream: Cell::default(),
            permits: Rc::default(),
            real_size: Cell::default(),
            frames,
            contents,
            emit,
        });
        session.enter_document()?;
        let weak = Rc::downgrade(&session);
        let observer = Observer::new(client == Client::Program, move |news| {
            weak.upgrade().map_or(Ok(()), |it| it.hear(news))
        });
        (session.contents).observe(session.observer.get_or_init(|| observer));
        Ok(session)
    }

    fn end(&self) -> JsResult<()> {
        if let Some(observer) = self.observer.get() {
            self.contents.unobserve(observer);
        }
        self.network.close()?;
        if let Some(frames) = &self.frames {
            frames.close();
        }
        match self.agent.take() {
            Some(agent) => agent.leave(),
            None => self.contents.page().stop_inspecting(self.number)?,
        }
        self.contents.emulate_focus(false)?;
        self.contents.emulate_media(None)
    }

    fn frame(&self) -> JsResult<Value> {
        let url = self.contents.page().url();
        let (base, fragment) = url.split_at(text::before(&url, "#").len());
        Ok(record! {
            "id": &*self.id,
            "parentId": (self.contents.parent().map(|it| target_id_of(it.to_js()))).as_deref(),
            "name": self.contents.name(),
            "loaderId": self.network.loader(),
            "url": base,
            "urlFragment": Some(fragment).filter(|it| !it.is_empty()),
            "securityOrigin": self.contents.page().origin(),
            "mimeType": "text/html",
            "domainAndRegistry": "",
            "secureContextType": match self.contents.page().is_secure() {
                true => "Secure",
                false => "InsecureScheme",
            },
            "crossOriginIsolatedContextType": "NotIsolated",
            "gatedAPIFeatures": list![],
        })
    }

    fn navigated(&self) -> JsResult<()> {
        let params = record! { "frame": self.frame()?, "type": "Navigation" };
        (self.emit)("Page.frameNavigated", params);
        Ok(())
    }

    fn lifecycle(&self, stage: Option<Stage>) -> JsResult<()> {
        let params = record! {
            "frameId": &*self.id,
            "loaderId": self.network.loader(),
            "name": match stage {
                None => "init",
                Some(Stage::Interactive) => "DOMContentLoaded",
                Some(Stage::Complete) => "load",
            },
            "timestamp": seconds(),
        };
        (self.emit)("Page.lifecycleEvent", params);
        Ok(())
    }

    fn update_frames(&self) -> JsResult<()> {
        let Some(frames) = &self.frames else {
            return Ok(());
        };
        frames.update()?;
        self.tell_agent(KNOW_FRAMES, &record! { "frames": frames.places() });
        Ok(())
    }

    pub(super) fn document_created(&self) -> JsResult<()> {
        self.agent.borrow().iter().for_each(|it| it.leave());
        (self.emit)("Runtime.executionContextsCleared", Value::empty());
        self.navigated()?;
        self.lifecycle(None)?;
        self.frames.as_ref().map_or(Ok(()), Frames::update)?;
        if self.is_enabled("DOM") {
            (self.emit)("DOM.documentUpdated", Value::empty());
        }
        self.enter_document()
    }

    fn settings(&self) -> Value {
        last_document().update(|it| (it + 1) % (1 << 24));
        record! {
            "frame": &*self.id,
            "firstContext": last_document().get() * CONTEXTS_OF_DOCUMENT + 1,
            "frames": self.frames.as_ref().map(|it| it.places()),
            "commands": self.lasting.borrow().iter().map(|it| list![&*it.1, &it.2]).collect::<Value>(),
        }
    }

    fn is_enabled(&self, domain: &str) -> bool {
        (self.lasting.borrow().iter()).any(|it| it.1.strip_prefix(domain) == Some(".enable"))
    }

    fn remember(&self, name: &str, method: &str, params: Value) {
        let mut lasting = self.lasting.borrow_mut();
        match lasting.iter_mut().find(|it| it.0 == name && it.1 == method) {
            Some(known) => known.2 = params,
            None => lasting.push((name.into(), method.into(), params)),
        }
    }

    fn forget(&self, name: &Value, method: &str) {
        (self.lasting.borrow_mut()).retain(|it| !(name.is(&it.0) && it.1 == method));
    }

    async fn ask_agent_and_remember(&self, method: &str, params: Value) -> Outcome {
        let (domain, name) = text::split_once(method, ".").unwrap_or_default();
        match method {
            "DOM.getDocument" => self.remember("", "DOM.enable", Value::empty()),
            "Debugger.removeBreakpoint" => {
                self.forget(&params["breakpointId"], "Debugger.setBreakpointByUrl")
            }
            "Debugger.setBreakpointByUrl" => {
                let result = self.ask_agent(method, params.clone()).await?;
                self.remember(result["breakpointId"].text(), method, params);
                return Ok(result);
            }
            "Runtime.evaluate" | "Runtime.callFunctionOn" if params["userGesture"].is_truthy() => {
                (self.contents.live_page()?).tell(bun_web::page::Controls::activate)?
            }
            "Runtime.addBinding" => self.remember(params["name"].text(), method, params.clone()),
            "Runtime.removeBinding" => self.forget(&params["name"], "Runtime.addBinding"),
            "CSS.trackComputedStyleUpdates"
            | "Debugger.setBlackboxPatterns"
            | "Debugger.setBreakpointsActive"
            | "Debugger.setPauseOnExceptions"
            | "Debugger.setSkipAllPauses"
            | "Overlay.setInspectMode" => self.remember("", method, params.clone()),
            _ if name == "enable" => self.remember("", method, params.clone()),
            _ if name == "disable" => (self.lasting.borrow_mut())
                .retain(|it| text::before(&it.1, ".") != domain || it.1 == "Runtime.addBinding"),
            _ => {}
        }
        self.ask_agent(method, params).await
    }

    fn tell_agent(&self, method: &str, params: &Value) {
        let agent = self.agent.borrow().clone();
        match agent {
            Some(agent) => drop(agent.obey(method, params)),
            None => task::report(
                (self.contents.page())
                    .ask_inspector(self.number, method, params.to_json(), Vec::new())
                    .map(drop),
            ),
        }
    }

    fn enter_document(&self) -> JsResult<()> {
        let (page, how) = (self.contents.page(), self.settings());
        if page.is_in_other_process() {
            self.agent.take();
            return page.inspect(self.number, how.to_json());
        }
        let whose = Whose::Contents(self.contents.clone());
        let (emit, permits) = (Rc::clone(&self.emit), Rc::clone(&self.permits));
        let emit = move |method: &str, params| {
            if method != REQUESTED || permits.take() {
                emit(method, params);
            }
        };
        let agent = Agent::new(whose, Rc::new(emit), &how);
        self.agent.replace(Some(Rc::clone(&agent)));
        agent.enter(&how)
    }

    async fn ask_agent(&self, method: &str, params: Value) -> Outcome {
        let (agent, _permit) = (self.agent.borrow().clone(), self.permits.issue(&params));
        if let Some(agent) = agent {
            return agent.run(method, params).await;
        }
        let files = (params["files"].items().iter())
            .filter(|_| method == "DOM.setFileInputFiles")
            .map(|it| ChosenFile(it.text().into()));
        let (page, json) = (self.contents.live_page()?, params.to_json());
        let result = page.ask_inspector(self.number, method, json, files.collect())?;
        let result = result.await;
        after_events().await;
        let json = result.ok_or("Target closed")?.map_err(Failure)?;
        Ok((Value::parse(json.as_bytes()).filter(Value::is_object)).unwrap_or_else(Value::empty))
    }

    /// Once the page has seen what it was told.
    async fn done_in_page(&self, result: JsResult<()>) -> Outcome {
        result?;
        if self.agent.borrow().is_none() {
            drop(
                self.ask_agent("Runtime.runIfWaitingForDebugger", Value::empty())
                    .await,
            );
        }
        Ok(Value::empty())
    }

    fn hear(&self, news: News<'_>) -> JsResult<()> {
        match news {
            News::DocumentCreated => return self.document_created(),
            News::NavigatedWithinDocument(url) => (self.emit)(
                "Page.navigatedWithinDocument",
                record! { "frameId": &*self.id, "url": url, "navigationType": "historyApi" },
            ),
            News::Reached(stage) => {
                self.lifecycle(Some(stage))?;
                let event = match stage {
                    Stage::Interactive => "Page.domContentEventFired",
                    Stage::Complete => "Page.loadEventFired",
                };
                (self.emit)(event, record! { "timestamp": seconds() });
            }
            News::Logged(logged) => {
                let agent = self.agent.borrow().clone();
                return agent.map_or(Ok(()), |it| it.hear(logged));
            }
            News::Complaint(text) if self.logs.get() => {
                let entry = record! {
                    "source": "other",
                    "level": "error",
                    "text": text,
                    "timestamp": bun_web::time::wall_now() * 1e3,
                    "url": self.contents.page().url(),
                };
                (self.emit)("Log.entryAdded", record! { "entry": entry });
            }
            News::Leaving if self.is_enabled("Debugger") => {
                self.tell_agent("Debugger.resume", &Value::empty())
            }
            News::Inspected {
                session,
                method,
                params,
            } => {
                if session == self.number
                    && (EVENTS_OF_AGENT.contains(&method)
                        || method == REQUESTED && self.permits.take())
                    && let Some(params) = Value::parse(params.as_bytes()).filter(Value::is_object)
                {
                    (self.emit)(method, params);
                }
            }
            News::FramesChanged => return self.update_frames(),
            News::Complaint(_) | News::Leaving | News::GuestCommitted | News::Destroyed => {}
        }
        Ok(())
    }

    fn override_size(&self, params: &Value) -> JsResult<()> {
        let real = self.real_size.take().or_else(|| self.contents.size());
        let or = |name: &str, real: Option<f64>| match &params[name] {
            given if given.is_truthy() => given.number(),
            _ => real.unwrap_or_default(),
        };
        self.real_size.set(real);
        self.contents.simulate(resize(Extent {
            size: [
                or("width", real.map(|it| it.size[0])),
                or("height", real.map(|it| it.size[1])),
            ],
            scale: or("deviceScaleFactor", real.map(|it| it.scale)),
        }))
    }

    fn emulate_media(&self, params: &Value) -> JsResult<()> {
        let is = |name: &str, value: &str| {
            let found = (params["features"].items().iter()).find(|it| it["name"].is(name));
            let given = found.map(|it| it["value"].text());
            given.filter(|it| !it.is_empty()).map(|it| it == value)
        };
        self.contents.emulate_media(Some(EmulatedMedia {
            is_dark: is("prefers-color-scheme", "dark"),
            reduces_motion: is("prefers-reduced-motion", "reduce"),
            increases_contrast: is("prefers-contrast", "more"),
            forces_colors: is("forced-colors", "active"),
            reduces_transparency: is("prefers-reduced-transparency", "reduce"),
        }))
    }

    fn emulate_focus(&self, is_enabled: bool) -> JsResult<()> {
        self.contents.emulate_focus(is_enabled)?;
        if is_enabled {
            let focus = bun_web::input::Input::Focus { direction: 0 };
            self.contents.live_page()?.tell(|it| it.input(focus))?;
        }
        Ok(())
    }

    async fn add_script(&self, method: &str, params: Value) -> Outcome {
        self.last_script.update(|it| it + 1);
        let id = self.last_script.get().to_string();
        self.remember(&id, method, params.clone());
        if params["runImmediately"].is_truthy() {
            self.ask_agent(method, params).await?;
        }
        Ok(record! { "identifier": id })
    }

    async fn repeat_lifecycle(&self, method: &str) -> Outcome {
        let stages: &[_] = match self.ask_agent(method, Value::empty()).await?["readyState"].text()
        {
            "loading" => &[],
            "interactive" => &[Stage::Interactive],
            _ => &[Stage::Interactive, Stage::Complete],
        };
        done((stages.iter()).try_for_each(|it| self.lifecycle(Some(*it))))
    }

    async fn screenshot(&self, params: &Value) -> Outcome {
        let metrics = (self.ask_agent("Page.getLayoutMetrics", Value::empty())).await?;
        let [left, top] = ["pageX", "pageY"].map(|it| metrics["layoutViewport"][it].number());
        let (zoom, clip) = (self.contents.zoom(), &params["clip"]);
        let part = clip.is_truthy().then(|| {
            record! {
                "x": (clip["x"].number() - left) * zoom,
                "y": (clip["y"].number() - top) * zoom,
                "width": clip["width"].number() * zoom,
                "height": clip["height"].number() * zoom,
            }
        });
        let image = (self.contents).invoke("capturePage", &[js(&Value::from(part))?]);
        let image = (task::outcome(image).await).map_err(|it| Failure::thrown(it.get()))?;
        let bytes = NativeImage::with(global(), image.get(), |it| {
            match params["format"].is("jpeg") {
                true => it.jpeg(global(), params["quality"].as_number().unwrap_or(80.) as u8),
                false => it.png(global()),
            }
        })?;
        Ok(record! { "data": text::base64(&bytes) })
    }

    async fn load_resource(&self, params: &Value) -> Outcome {
        let includes_credentials = params["options"]["includeCredentials"].is_truthy();
        let loaded = (self.contents).load_for_page(params["url"].text(), includes_credentials);
        Ok(record! { "resource": match loaded.await {
            Ok(Response { head, body }) => {
                let success = bun_web::net::response::is_ok_status(head.status);
                let stream = success.then(|| {
                    self.last_stream.update(|it| it + 1);
                    let handle = self.last_stream.get().to_string();
                    (self.streams.borrow_mut()).push((handle.clone(), body.unwrap_or_default()));
                    handle
                });
                record! {
                    "success": success,
                    "httpStatusCode": i32::from(head.status),
                    "headers": super::network::record_of(&head.headers, ", "),
                    "stream": stream,
                }
            }
            Err(error) => record! { "success": false, "netErrorName": error.message() },
        } })
    }

    fn take_stream(&self, params: &Value) -> Result<(String, Body), Failure> {
        let mut all = self.streams.borrow_mut();
        let at = all.iter().position(|it| params["handle"].is(&it.0));
        Ok(all.swap_remove(at.ok_or("Invalid stream handle")?))
    }

    async fn read_stream(&self, params: &Value) -> Outcome {
        let (handle, mut body) = self.take_stream(params)?;
        let chunk = body.read().await.map_err(|it| it.message())?;
        let data = text::base64(chunk.as_deref().unwrap_or_default());
        let rest = if chunk.is_some() {
            body
        } else {
            Body::default()
        };
        self.streams.borrow_mut().push((handle, rest));
        Ok(record! { "data": data, "base64Encoded": true, "eof": chunk.is_none() })
    }

    async fn content_of(&self, url: &str) -> Option<Vec<u8>> {
        match self.network.body_from(url) {
            Some(kept) => Some(kept.to_vec()),
            None => Some(self.contents.load_whole(url).await?.2),
        }
    }

    async fn resource(&self, url: &str) -> Outcome {
        let content = self.content_of(url).await;
        let content = content.ok_or("No resource with given URL found")?;
        Ok(match bun_core::strings::str_utf8(&content) {
            Some(text) => record! { "content": text, "base64Encoded": false },
            None => record! { "content": text::base64(&content), "base64Encoded": true },
        })
    }

    async fn navigate(&self, params: &Value) -> Outcome {
        const EVENTS: [&str; 2] = ["did-navigate", "did-navigate-in-page"];
        let (before, ended) = (self.network.loader(), task::Later::default());
        let [committed, failed] = [ended.clone(), ended.clone()];
        let listener = keep(procedure(move |_| {
            committed.set(None);
            Ok(())
        })?);
        for event in EVENTS {
            self.contents.invoke("on", &[js(event)?, listener.get()])?;
        }
        then(self.contents.load_url(params)?, move |result| {
            if let Err(error) = result {
                failed.set(Some(format!("net::{}", text_of(get(error, "code")?)?)));
            }
            Ok(())
        })?;
        let error = ended.await;
        for event in EVENTS {
            self.contents.invoke("off", &[js(event)?, listener.get()])?;
        }
        let now = self.network.loader();
        Ok(record! {
            "frameId": &*self.id,
            "loaderId": (error.is_none() && now != before).then_some(now),
            "errorText": error,
        })
    }

    async fn run(&self, method: &str, params: Value) -> Outcome {
        let contents = &self.contents;
        match method {
            _ if is_for_agent(method) => self.ask_agent_and_remember(method, params).await,
            "Page.createIsolatedWorld" | "Page.getLayoutMetrics" => {
                self.ask_agent(method, params).await
            }
            "Emulation.clearDeviceMetricsOverride" => {
                let real = self.real_size.take();
                (self.done_in_page(real.map_or(Ok(()), |it| contents.simulate(resize(it))))).await
            }
            "Emulation.setDeviceMetricsOverride" => {
                self.done_in_page(self.override_size(&params)).await
            }
            "Emulation.setEmulatedMedia" => self.done_in_page(self.emulate_media(&params)).await,
            "Emulation.setFocusEmulationEnabled" => {
                (self.done_in_page(self.emulate_focus(params["enabled"].is_truthy()))).await
            }
            "Emulation.setUserAgentOverride" => {
                done((contents.invoke("setUserAgent", &[js(&params["userAgent"])?])).map(drop))
            }
            "Fetch.continueRequest" | "Fetch.failRequest" | "Fetch.fulfillRequest" => {
                self.network.resume(params)
            }
            "Fetch.disable" => done(self.network.intercept(Vec::new())),
            "Fetch.enable" => {
                let pattern = |it: &Value| it["urlPattern"].as_text().unwrap_or("*").to_owned();
                done(self.network.intercept(match &params["patterns"] {
                    Value::List(patterns) => patterns.iter().map(pattern).collect(),
                    _ => vec!["*".into()],
                }))
            }
            "Log.enable" | "Log.disable" => {
                self.logs.set(method == "Log.enable");
                Ok(Value::empty())
            }
            "Network.disable" => done(self.network.report(false)),
            "Network.enable" => done(self.network.report(true)),
            "Network.clearBrowserCache" => {
                let cleared = invoke(contents.get_session().to_js(), "clearCache", &[]);
                (task::outcome(cleared).await).map_err(|it| Failure::thrown(it.get()))?;
                Ok(Value::empty())
            }
            "Network.clearBrowserCookies" => {
                contents.get_session().remove_all_cookies();
                Ok(Value::empty())
            }
            "Network.deleteCookies" => {
                contents.get_session().remove_cookies_like(&params);
                Ok(Value::empty())
            }
            "Network.emulateNetworkConditions"
            | "Network.overrideNetworkState"
            | "Network.setBlockedURLs"
            | "Network.setCacheDisabled"
            | "Network.setExtraHTTPHeaders" => {
                self.network.change_conditions(&params);
                Ok(Value::empty())
            }
            "Network.emulateNetworkConditionsByRule" => Ok(record! { "ruleIds": list![] }),
            "Network.getCookies" => {
                let own = list![contents.page().url()];
                let urls = Some(&params["urls"])
                    .filter(|it| it.is_list())
                    .unwrap_or(&own);
                let urls = urls
                    .items()
                    .iter()
                    .filter_map(|it| Url::parse(it.text().as_bytes()));
                cookies(
                    contents
                        .get_session()
                        .cookies_for(&urls.collect::<Vec<_>>()),
                )
            }
            "Network.getResponseBody" => self.network.body(&params),
            "Network.searchInResponseBody" => self.network.search(&params),
            "Network.setCookie" => {
                set_cookie(contents.get_session(), &params)?;
                Ok(record! { "success": true })
            }
            "Storage.getStorageKey" | "Storage.getStorageKeyForFrame" => {
                Ok(record! { "storageKey": format!("{}/", contents.page().origin()) })
            }
            "IO.close" => self.take_stream(&params).map(|_| Value::empty()),
            "IO.read" => self.read_stream(&params).await,
            "Network.loadNetworkResource" => self.load_resource(&params).await,
            "Page.addScriptToEvaluateOnNewDocument" => self.add_script(method, params).await,
            "Page.bringToFront" => done(contents.bring_to_front()),
            "Page.captureScreenshot" => self.screenshot(&params).await,
            "Page.close" => {
                contents.close_later();
                Ok(Value::empty())
            }
            "Page.getAppManifest" => Ok(record! { "url": "", "errors": list![] }),
            "Page.getInstallabilityErrors" => Ok(record! { "installabilityErrors": list![] }),
            "Page.getResourceContent" => self.resource(params["url"].text()).await,
            "Page.getResourceTree" => {
                let resources = self.ask_agent(method, params).await?.take("resources");
                let tree = record! { "frame": self.frame()?, "resources": resources };
                Ok(record! { "frameTree": tree })
            }
            "Page.searchInResource" => {
                let content = self.content_of(params["url"].text()).await;
                let content = string(&content.unwrap_or_default());
                Ok(record! { "result": scripts::search(&content, &params) })
            }
            "Page.getFrameTree" => Ok(record! { "frameTree": record! { "frame": self.frame()? } }),
            "Page.getNavigationHistory" => Ok(contents.describe_history()),
            "Page.navigate" => self.navigate(&params).await,
            "Page.navigateToHistoryEntry" => {
                done(contents.traverse(params["entryId"].number() as usize, true))
            }
            "Page.reload" => done(contents.reload_for_app("reload")),
            "Page.removeScriptToEvaluateOnNewDocument" => {
                self.forget(
                    &params["identifier"],
                    "Page.addScriptToEvaluateOnNewDocument",
                );
                Ok(Value::empty())
            }
            "Page.setLifecycleEventsEnabled" if params["enabled"].is_truthy() => {
                self.repeat_lifecycle(method).await
            }
            "Page.setLifecycleEventsEnabled" => Ok(Value::empty()),
            "Page.stopLoading" => done(contents.stop_for_app()),
            "Target.getTargetInfo" => Ok(record! { "targetInfo": contents.info()? }),
            "Target.setAutoAttach" if params["autoAttach"].is_truthy() => {
                done(self.frames.as_ref().map_or(Ok(()), Frames::start))
            }
            _ => match self.input.run(contents, method, &params) {
                Some(result) => self.done_in_page(result).await,
                None => unknown(method),
            },
        }
    }
}

impl Session for PageSession {
    fn handle(self: Rc<Self>, method: &str, params: Value, reply: Reply) {
        if method == "Page.getFrameTree" && self.contents.parent().is_some() {
            task::report(self.navigated());
        }
        let (method, may_pause) = (method.to_owned(), self.is_enabled("Debugger"));
        let work = async move { reply(self.run(&method, params).await) };
        if !may_pause {
            return task::spawn(work);
        }
        // Who has sent this has to be able to send more.
        later::soon(move |_| {
            task::spawn(work);
            Ok(())
        });
    }

    fn close(&self) {
        task::report(self.end());
    }

    fn reveal(self: Rc<Self>, point: [f64; 2]) {
        let [x, y] = point.map(|it| it / self.contents.zoom());
        self.tell_agent(REVEAL, &record! { "x": x, "y": y });
    }
}

const EVENTS_OF_AGENT: &[&str] = &[
    "CSS.computedStyleUpdated",
    "CSS.styleSheetAdded",
    "CSS.styleSheetChanged",
    "CSS.styleSheetRemoved",
    "DOM.attributeModified",
    "DOM.attributeRemoved",
    "DOM.characterDataModified",
    "DOM.childNodeCountUpdated",
    "DOM.childNodeInserted",
    "DOM.childNodeRemoved",
    "DOM.documentUpdated",
    "DOM.pseudoElementAdded",
    "DOM.pseudoElementRemoved",
    "DOM.setChildNodes",
    "DOM.shadowRootPushed",
    "DOM.topLayerElementsUpdated",
    "DOMStorage.domStorageItemAdded",
    "DOMStorage.domStorageItemRemoved",
    "DOMStorage.domStorageItemUpdated",
    "Debugger.breakpointResolved",
    "Debugger.paused",
    "Debugger.resumed",
    "Debugger.scriptFailedToParse",
    "Debugger.scriptParsed",
    "HeapProfiler.addHeapSnapshotChunk",
    "Overlay.inspectModeCanceled",
    "Overlay.inspectNodeRequested",
    "Overlay.nodeHighlightRequested",
    "Runtime.bindingCalled",
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "Runtime.executionContextCreated",
];

fn is_for_agent(method: &str) -> bool {
    matches!(
        text::before(method, "."),
        "Accessibility"
            | "CSS"
            | "DOM"
            | "DOMDebugger"
            | "DOMStorage"
            | "Debugger"
            | "HeapProfiler"
            | "Overlay"
            | "Runtime"
    )
}

fn resize(extent: Extent) -> bun_web::input::Input {
    let is_quiet = false;
    bun_web::input::Input::Resize { extent, is_quiet }
}

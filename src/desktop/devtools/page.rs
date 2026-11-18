//! A page of the engine of the app.

use core::cell::OnceCell;
use std::rc::Rc;

use bun_web::host::ChosenFile;
use bun_web::input::Extent;

use super::agent::Agent;
use super::contents::Contents;
use super::frames::Frames;
use super::input::Input;
use super::network::Watcher;
use super::runtime::Whose;
use super::{Emit, Failure, Outcome, Reply, Session, done, seconds, target_id_of, unknown};
use crate::contents::inspection::{EmulatedMedia, News, Observer, Stage};
use crate::prelude::*;
use crate::value::Value;
use crate::{task, text};

const CONTEXTS_OF_DOCUMENT: u32 = 64;

state!(fn last_document() -> Cell<u32>);
state!(fn last_session() -> Cell<u32>);

pub(super) struct PageSession {
    contents: Contents,
    id: Rc<str>,
    emit: Emit,
    observer: OnceCell<Rc<Observer>>,
    number: u32,
    /// Unless it is in another process.
    agent: RefCell<Option<Rc<Agent>>>,
    is_enabled: Cell<bool>,
    bindings: RefCell<Vec<String>>,
    network: Rc<Watcher>,
    input: Input,
    scripts: RefCell<Vec<(String, Value)>>,
    last_script: Cell<u32>,
    real_size: Cell<Option<Extent>>,
    /// They are targets of their own.
    frames: Option<Rc<Frames>>,
}

impl PageSession {
    /// With `frames` it is for a client that the page cannot wait for.
    pub(super) fn new(
        contents: Contents,
        emit: Emit,
        frames: Option<Rc<Frames>>,
    ) -> JsResult<Rc<PageSession>> {
        contents.live_page()?;
        last_session().update(|it| it + 1);
        let session = Rc::new(PageSession {
            id: target_id_of(contents.object()),
            observer: OnceCell::new(),
            number: last_session().get(),
            agent: RefCell::default(),
            is_enabled: Cell::default(),
            bindings: RefCell::default(),
            network: Watcher::new(contents.clone(), Rc::clone(&emit)),
            input: Input::default(),
            scripts: RefCell::default(),
            last_script: Cell::default(),
            real_size: Cell::default(),
            frames,
            contents,
            emit,
        });
        session.enter_document()?;
        let weak = Rc::downgrade(&session);
        let observer = Observer::new(session.frames.is_some(), move |news| {
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
            "loaderId": self.contents.token(),
            "url": base,
            "urlFragment": Some(fragment).filter(|it| !it.is_empty()),
            "securityOrigin": self.contents.page().origin(),
            "mimeType": "text/html",
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
            "loaderId": self.contents.token(),
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
        self.frames.as_ref().map_or(Ok(()), Frames::update)
    }

    pub(super) fn document_created(&self) -> JsResult<()> {
        self.agent.borrow().iter().for_each(|it| it.leave());
        (self.emit)("Runtime.executionContextsCleared", Value::empty());
        self.navigated()?;
        self.lifecycle(None)?;
        self.update_frames()?;
        self.enter_document()
    }

    fn settings(&self) -> Value {
        last_document().update(|it| (it + 1) % (1 << 24));
        record! {
            "frame": &*self.id,
            "firstContext": last_document().get() * CONTEXTS_OF_DOCUMENT + 1,
            "isEnabled": self.is_enabled.get(),
            "bindings": self.bindings.borrow().iter().map(|it| Value::from(&**it)).collect::<Value>(),
            "scripts": self.scripts.borrow().iter().map(|it| it.1.clone()).collect::<Value>(),
        }
    }

    fn enter_document(&self) -> JsResult<()> {
        let (page, how) = (self.contents.page(), self.settings());
        if page.is_in_other_process() {
            self.agent.take();
            return page.inspect(self.number, how.to_json());
        }
        let whose = Whose::Contents(self.contents.clone());
        let agent = Agent::new(whose, Rc::clone(&self.emit), &how);
        self.agent.replace(Some(Rc::clone(&agent)));
        agent.enter(&how)
    }

    async fn ask_agent(&self, method: &str, params: Value) -> Outcome {
        let agent = self.agent.borrow().clone();
        if let Some(agent) = agent {
            return agent.run(method, params).await;
        }
        let files = (params["files"].items().iter())
            .filter(|_| method == "DOM.setFileInputFiles")
            .map(|it| ChosenFile(it.text().into()));
        let (page, json) = (self.contents.live_page()?, params.to_json());
        let result = page.ask_inspector(self.number, method, json, files.collect())?;
        let json = result.await.ok_or("Target closed")?.map_err(Failure)?;
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
            News::Console(..) | News::Exception { .. } => {
                let agent = self.agent.borrow().clone();
                return agent.map_or(Ok(()), |it| it.hear(news));
            }
            News::Inspected {
                session,
                method,
                params,
            } => {
                let is_expected = matches!(
                    method,
                    "HeapProfiler.addHeapSnapshotChunk"
                        | "Runtime.bindingCalled"
                        | "Runtime.consoleAPICalled"
                        | "Runtime.exceptionThrown"
                        | "Runtime.executionContextCreated"
                );
                if is_expected
                    && session == self.number
                    && let Some(params) = Value::parse(params.as_bytes()).filter(Value::is_object)
                {
                    (self.emit)(method, params);
                }
            }
            News::FramesChanged => return self.update_frames(),
            News::GuestCommitted | News::Destroyed => {}
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
        (self.scripts.borrow_mut()).push((id.clone(), params.clone()));
        if params["runImmediately"].is_truthy() {
            self.ask_agent(method, params).await?;
        }
        Ok(record! { "identifier": id })
    }

    async fn add_binding(&self, method: &str, params: Value) -> Outcome {
        let name = params["name"].text();
        if !self.bindings.borrow().iter().any(|it| it == name) {
            self.bindings.borrow_mut().push(name.into());
        }
        self.ask_agent(method, params).await
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
        let session = self.contents.get_session();
        let head = session.load_head(params["url"].text(), includes_credentials);
        Ok(record! { "resource": match head.await {
            Ok((status, headers)) => record! {
                "success": bun_web::net::response::is_ok_status(status),
                "httpStatusCode": i32::from(status),
                "headers": super::network::record_of(&headers, ", "),
            },
            Err(error) => record! { "success": false, "netErrorName": error.message() },
        } })
    }

    async fn navigate(&self, params: &Value) -> Outcome {
        const EVENTS: [&str; 2] = ["did-navigate", "did-navigate-in-page"];
        let (before, ended) = (self.contents.token(), task::Later::default());
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
        let now = self.contents.token();
        Ok(record! {
            "frameId": &*self.id,
            "loaderId": (error.is_none() && now != before).then_some(now),
            "errorText": error,
        })
    }

    pub(super) async fn run(&self, method: &str, params: Value) -> Outcome {
        let contents = &self.contents;
        match method {
            "Accessibility.getFullAXTree"
            | "Accessibility.getPartialAXTree"
            | "DOM.focus"
            | "DOM.getBoxModel"
            | "DOM.getContentQuads"
            | "DOM.resolveNode"
            | "DOM.scrollIntoViewIfNeeded"
            | "DOM.setFileInputFiles"
            | "HeapProfiler.collectGarbage"
            | "HeapProfiler.takeHeapSnapshot"
            | "Page.createIsolatedWorld"
            | "Page.getLayoutMetrics"
            | "Runtime.callFunctionOn"
            | "Runtime.evaluate"
            | "Runtime.getProperties"
            | "Runtime.releaseObject" => self.ask_agent(method, params).await,
            "DOM.describeNode" | "DOM.getFrameOwner" => {
                let places = self.frames.as_ref().map(|it| it.places());
                self.ask_agent(method, params.with("frames", places)).await
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
            "Network.disable" => done(self.network.report(false)),
            "Network.enable" => done(self.network.report(true)),
            "Network.getResponseBody" => self.network.body(&params),
            "Network.loadNetworkResource" => self.load_resource(&params).await,
            "Page.addScriptToEvaluateOnNewDocument" => self.add_script(method, params).await,
            "Page.bringToFront" => done(contents.bring_to_front()),
            "Page.captureScreenshot" => self.screenshot(&params).await,
            "Page.close" => {
                contents.close_later();
                Ok(Value::empty())
            }
            "Page.getFrameTree" => Ok(record! { "frameTree": record! { "frame": self.frame()? } }),
            "Page.getNavigationHistory" => Ok(contents.describe_history()),
            "Page.navigate" => self.navigate(&params).await,
            "Page.navigateToHistoryEntry" => {
                done(contents.traverse(params["entryId"].number() as usize, true))
            }
            "Page.reload" => done(contents.reload_for_app("reload")),
            "Page.removeScriptToEvaluateOnNewDocument" => {
                (self.scripts.borrow_mut()).retain(|it| !params["identifier"].is(&it.0));
                Ok(Value::empty())
            }
            "Page.setLifecycleEventsEnabled" if params["enabled"].is_truthy() => {
                self.repeat_lifecycle(method).await
            }
            "Page.setLifecycleEventsEnabled" => Ok(Value::empty()),
            "Page.stopLoading" => done(contents.stop_for_app()),
            "Runtime.addBinding" => self.add_binding(method, params).await,
            "Runtime.enable" => {
                self.is_enabled.set(true);
                self.ask_agent(method, params).await
            }
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
        let method = method.to_owned();
        task::spawn(async move { reply(self.run(&method, params).await) });
    }

    fn close(&self) {
        task::report(self.end());
    }
}

fn resize(extent: Extent) -> bun_web::input::Input {
    let is_quiet = false;
    bun_web::input::Input::Resize { extent, is_quiet }
}

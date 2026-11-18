//! A page in the process of the app.

use core::cell::OnceCell;
use std::rc::Rc;

use bun_jsc::{JSGlobalObject, Weak};
use bun_ui::dom::{self, Hidden};

use super::contents::Contents;
use super::frames::Frames;
use super::input::Input;
use super::network::Watcher;
use super::runtime::Runtime;
use super::{Emit, Failure, Outcome, Reply, Session, done, seconds, target_id_of, unknown};
use bun_web::input::Extent;

use crate::contents::all_chosen;
use crate::contents::inspection::{EmulatedMedia, News, Observer, Stage};
use crate::prelude::*;
use crate::value::Value;
use crate::webview::wire;
use crate::{realm, task, text};

state!(fn nodes() -> RefCell<Vec<Weak<()>>>);
state!(fn node_ids() -> StrongCell);

unsafe extern "C" {
    safe fn Bun__Desktop__createWeakMap(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__Desktop__getWeakly(map: JSValue, key: JSValue) -> JSValue;
    safe fn Bun__Desktop__setWeakly(
        global: &JSGlobalObject,
        map: JSValue,
        key: JSValue,
        value: JSValue,
    );
}

fn node_id_of(node: JSValue) -> u32 {
    let ids = node_ids().get().unwrap_or_else(|| {
        let ids = Bun__Desktop__createWeakMap(global());
        node_ids().set(keep(ids));
        ids
    });
    if let Some(known) = Bun__Desktop__getWeakly(ids, node).get_number() {
        return known as u32;
    }
    let mut nodes = nodes().borrow_mut();
    nodes.push(Weak::create_passive(node, global()));
    let id = JSValue::js_number(nodes.len() as f64);
    Bun__Desktop__setWeakly(global(), ids, node, id);
    nodes.len() as u32
}

fn quad([left, top, width, height]: [f64; 4]) -> Value {
    let [right, bottom] = [left + width, top + height];
    list![left, top, right, top, right, bottom, left, bottom]
}

pub(super) struct PageSession {
    contents: Contents,
    id: Rc<str>,
    emit: Emit,
    observer: OnceCell<Rc<Observer>>,
    runtime: Runtime,
    network: Rc<Watcher>,
    input: Input,
    scripts: RefCell<Vec<(String, Value)>>,
    last_script: Cell<u32>,
    stages: RefCell<Vec<Stage>>,
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
        let stages = match &*text_of(contents.control("readyState", &[])?)? {
            "loading" => vec![],
            "interactive" => vec![Stage::Interactive],
            _ => vec![Stage::Interactive, Stage::Complete],
        };
        let session = Rc::new(PageSession {
            id: target_id_of(contents.object()),
            observer: OnceCell::new(),
            runtime: Runtime::new(contents.clone(), Rc::clone(&emit)),
            network: Watcher::new(contents.clone(), Rc::clone(&emit)),
            input: Input::default(),
            scripts: RefCell::default(),
            last_script: Cell::default(),
            stages: stages.into(),
            real_size: Cell::default(),
            frames,
            contents,
            emit,
        });
        session.runtime.context_named("")?;
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
        self.runtime.release_all();
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
        self.stages.take();
        self.runtime.forget_document();
        self.navigated()?;
        self.lifecycle(None)?;
        self.update_frames()?;
        self.runtime.enter_document()?;
        let scripts = self.scripts.borrow().clone();
        (scripts.iter()).try_for_each(|it| self.runtime.run_script(&it.1))
    }

    fn hear(&self, news: News<'_>) -> JsResult<()> {
        match news {
            News::DocumentCreated => return self.document_created(),
            News::NavigatedWithinDocument(url) => (self.emit)(
                "Page.navigatedWithinDocument",
                record! { "frameId": &*self.id, "url": url, "navigationType": "historyApi" },
            ),
            News::Reached(stage) => {
                self.stages.borrow_mut().push(stage);
                self.lifecycle(Some(stage))?;
                let event = match stage {
                    Stage::Interactive => "Page.domContentEventFired",
                    Stage::Complete => "Page.loadEventFired",
                };
                (self.emit)(event, record! { "timestamp": seconds() });
            }
            News::Console(kind, values) => return self.runtime.logged(kind, values),
            News::Exception {
                text,
                url,
                line,
                column,
                error,
            } => {
                let details = record! {
                    "exceptionId": 1,
                    "text": text,
                    "url": url,
                    "lineNumber": line,
                    "columnNumber": column,
                };
                return self.runtime.thrown(details, error);
            }
            News::FramesChanged => return self.update_frames(),
            News::GuestCommitted | News::Destroyed => {}
        }
        Ok(())
    }

    fn node(&self, params: &Value) -> Result<dom::Node, Failure> {
        let node = match (&params["objectId"], &params["backendNodeId"]) {
            (id @ Value::Text(_), _) => Some(self.runtime.object_in_page(id)?),
            (_, id) => {
                let id = id.as_number().unwrap_or_else(|| params["nodeId"].number());
                let nodes = nodes().borrow();
                (nodes.get((id as usize).wrapping_sub(1))).and_then(Weak::get)
            }
        };
        let node = node.map(dom::Node).filter(|it| it.is_one());
        Ok(node.ok_or("No node with given id found")?)
    }

    fn describe_node(&self, params: &Value) -> Outcome {
        let node = self.node(params)?;
        let it = node.describe();
        let frame = match (it.is_root, &self.frames) {
            (true, _) => Some(Rc::clone(&self.id)),
            (false, Some(frames)) => frames.id_of(node.0)?,
            (false, None) => None,
        };
        Ok(record! { "node": record! {
            "nodeId": 0,
            "backendNodeId": node_id_of(node.0),
            "nodeType": it.kind,
            "nodeName": it.name,
            "localName": it.local_name,
            "nodeValue": it.value,
            "frameId": frame.as_deref(),
        } })
    }

    fn frame_owner(&self, params: &Value) -> Outcome {
        let owner = (self.frames.as_ref()).map(|it| it.owner_of(params["frameId"].text()));
        let owner =
            (owner.transpose()?.flatten()).ok_or("Frame with the given id was not found.")?;
        Ok(record! { "backendNodeId": node_id_of(owner) })
    }

    fn box_model(&self, params: &Value) -> Outcome {
        let bounds = (self.node(params)?.bounds()).ok_or("Could not compute box model.")?;
        let quad = quad(bounds);
        Ok(record! { "model": record! {
            "content": &quad,
            "padding": &quad,
            "border": &quad,
            "margin": &quad,
            "width": bounds[2],
            "height": bounds[3],
        } })
    }

    fn accessible_node(&self, params: &Value) -> Outcome {
        let node = realm::cross(global(), self.node(params)?.0)?;
        let it = wire::data_from_js(self.contents.control("describeForAccessibility", &[node])?)?;
        Ok(record! { "nodes": list![record! {
            "nodeId": "1",
            "ignored": it["role"].is("none"),
            "role": record! { "type": "role", "value": &it["role"] },
            "name": record! { "type": "computedString", "value": &it["name"] },
        }] })
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

    fn take_heap_snapshot(&self) -> JsResult<()> {
        let bun = realm::native(global(), "Bun")?;
        let snapshot = text_of(invoke(bun, "generateHeapSnapshot", &[js("v8")?])?)?;
        let mut rest = &*snapshot;
        while !rest.is_empty() {
            let (chunk, after) = rest.split_at(rest.floor_char_boundary(1 << 20));
            (self.emit)(
                "HeapProfiler.addHeapSnapshotChunk",
                record! { "chunk": chunk },
            );
            rest = after;
        }
        Ok(())
    }

    fn add_script(&self, params: Value) -> Outcome {
        self.last_script.update(|it| it + 1);
        let id = self.last_script.get().to_string();
        if params["runImmediately"].is_truthy() {
            self.runtime.run_script(&params)?;
        }
        self.scripts.borrow_mut().push((id.clone(), params));
        Ok(record! { "identifier": id })
    }

    fn layout_metrics(&self) -> Outcome {
        let it = self.contents.document()?.metrics();
        let layout = record! {
            "pageX": it.scroll[0],
            "pageY": it.scroll[1],
            "clientWidth": it.viewport[0],
            "clientHeight": it.viewport[1],
        };
        let visual =
            (layout.clone()).and(&record! { "offsetX": 0, "offsetY": 0, "scale": 1, "zoom": 1 });
        let content = record! { "x": 0, "y": 0, "width": it.content[0], "height": it.content[1] };
        Ok(record! {
            "layoutViewport": &layout,
            "visualViewport": &visual,
            "contentSize": &content,
            "cssLayoutViewport": layout,
            "cssVisualViewport": visual,
            "cssContentSize": content,
        })
    }

    async fn screenshot(&self, params: &Value) -> Outcome {
        let ([left, top], zoom, clip) = (
            self.contents.document()?.metrics().scroll,
            self.contents.zoom(),
            &params["clip"],
        );
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
        let (contents, runtime) = (&self.contents, &self.runtime);
        match method {
            "Accessibility.getFullAXTree" => {
                let nodes = contents.control("accessibilityTree", &[])?;
                Ok(record! { "nodes": Value::parse(text_of(nodes)?.as_bytes()) })
            }
            "Accessibility.getPartialAXTree" => self.accessible_node(&params),
            "DOM.describeNode" => self.describe_node(&params),
            "DOM.focus" => {
                self.node(&params)?.focus();
                Ok(Value::empty())
            }
            "DOM.getBoxModel" => self.box_model(&params),
            "DOM.getContentQuads" => {
                let quads = self.node(&params)?.client_rects().into_iter().map(quad);
                Ok(record! { "quads": quads.collect::<Value>() })
            }
            "DOM.getFrameOwner" => self.frame_owner(&params),
            "DOM.resolveNode" => {
                let context = runtime.context(&params["executionContextId"])?;
                Ok(record! { "object": runtime.resolve(self.node(&params)?.0, &context)? })
            }
            "DOM.scrollIntoViewIfNeeded" => match self.node(&params)?.reveal() {
                Ok(()) => Ok(Value::empty()),
                Err(Hidden::Detached) => Err("Node is detached from document".into()),
                Err(Hidden::NotRendered) => Err("Node does not have a layout object".into()),
            },
            "DOM.setFileInputFiles" => {
                let input = realm::cross(global(), self.node(&params)?.0)?;
                let files = all_chosen(js(&params["files"])?)?;
                done(contents.control("chooseFiles", &[input, files]).map(drop))
            }
            "Emulation.clearDeviceMetricsOverride" => {
                done((self.real_size.take()).map_or(Ok(()), |it| contents.simulate(resize(it))))
            }
            "Emulation.setDeviceMetricsOverride" => done(self.override_size(&params)),
            "Emulation.setEmulatedMedia" => done(self.emulate_media(&params)),
            "Emulation.setFocusEmulationEnabled" => {
                done(self.emulate_focus(params["enabled"].is_truthy()))
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
            "HeapProfiler.collectGarbage" => {
                global().vm().run_gc(true);
                Ok(Value::empty())
            }
            "HeapProfiler.takeHeapSnapshot" => done(self.take_heap_snapshot()),
            "Network.disable" => done(self.network.report(false)),
            "Network.enable" => done(self.network.report(true)),
            "Network.getResponseBody" => self.network.body(&params),
            "Network.loadNetworkResource" => self.load_resource(&params).await,
            "Page.addScriptToEvaluateOnNewDocument" => self.add_script(params),
            "Page.bringToFront" => done(contents.bring_to_front()),
            "Page.captureScreenshot" => self.screenshot(&params).await,
            "Page.close" => {
                contents.close_later();
                Ok(Value::empty())
            }
            "Page.createIsolatedWorld" => {
                let name = Some(params["worldName"].text()).filter(|it| !it.is_empty());
                let context = runtime.context_named(name.unwrap_or("isolated"))?;
                Ok(record! { "executionContextId": context.id })
            }
            "Page.getFrameTree" => Ok(record! { "frameTree": record! { "frame": self.frame()? } }),
            "Page.getLayoutMetrics" => self.layout_metrics(),
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
                let stages = self.stages.borrow().clone();
                done((stages.into_iter()).try_for_each(|it| self.lifecycle(Some(it))))
            }
            "Page.setLifecycleEventsEnabled" => Ok(Value::empty()),
            "Page.stopLoading" => done(contents.stop_for_app()),
            "Runtime.addBinding" => done(runtime.add_binding(params["name"].text())),
            "Runtime.callFunctionOn" => {
                (runtime.result(runtime.call_function(&params)?, &params)).await
            }
            "Runtime.enable" => done(runtime.enable()),
            "Runtime.evaluate" => (runtime.result(runtime.evaluate(&params)?, &params)).await,
            "Runtime.getProperties" => runtime.properties(&params),
            "Runtime.releaseObject" => {
                runtime.release(&params);
                Ok(Value::empty())
            }
            "Target.getTargetInfo" => Ok(record! { "targetInfo": contents.info()? }),
            "Target.setAutoAttach" if params["autoAttach"].is_truthy() => {
                done(self.frames.as_ref().map_or(Ok(()), Frames::start))
            }
            _ => (self.input.run(contents, method, &params)).map_or_else(|| unknown(method), done),
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

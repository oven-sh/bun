//! The part of a session that is where the document is.

use std::rc::{Rc, Weak};

use bun_ui::dom::{self, Hidden};
use bun_web::dom::element_of_frame;
use bun_web::host::Logged;

use super::runtime::{Runtime, Whose, require_interpreter};
use super::scripts::Debugger;
use super::{Emit, Failure, Outcome, done, seconds, unknown};
use crate::contents::all_chosen;
use crate::prelude::*;
use crate::value::Value;
use crate::webview::wire;
use crate::{realm, task, text};

unsafe extern "C" {
    safe fn JSC__VM__heapSize(vm: &bun_jsc::VM) -> usize;
}

/// With the `frames` that `Frames::places` returns.
pub(super) const KNOW_FRAMES: &str = "DOM.knowFrames";
pub(super) const REVEAL: &str = "Overlay.reveal";

fn element_at(place: &Value) -> JSValue {
    let [page, frame] = ["page", "frame"].map(|it| place[it].number() as u32);
    element_of_frame(page, frame)
}

struct ForInspector(Weak<Agent>);

impl dom::Session for ForInspector {
    fn emit(&self, method: &str, params: Value) {
        if let Some(agent) = self.0.upgrade() {
            (agent.emit)(method, params);
        }
    }

    fn frame(&self) -> String {
        (self.0.upgrade()).map_or_else(String::new, |it| it.runtime.frame().into())
    }

    fn frame_in(&self, element: JSValue) -> Option<String> {
        let agent = self.0.upgrade()?;
        let frames = agent.frames.borrow();
        let found = frames.items().iter().find(|it| element_at(it) == element);
        Some(found?["target"].text().into())
    }

    fn object(&self, id: &Value) -> Option<JSValue> {
        self.0.upgrade()?.runtime.object_in_page(id).ok()
    }
}

pub(super) struct Agent {
    this: Weak<Agent>,
    runtime: Rc<Runtime>,
    emit: Emit,
    inspector: Rc<dyn dom::Inspector>,
    debugger: RefCell<Option<Rc<Debugger>>>,
    frames: RefCell<Value>,
    is_looking: Cell<bool>,
    has_left: Cell<bool>,
}

impl Agent {
    /// `how` is from `PageSession::settings`.
    pub(super) fn new(whose: Whose, emit: Emit, how: &Value) -> Rc<Agent> {
        Rc::new_cyclic(|this| Agent {
            this: Weak::clone(this),
            runtime: Runtime::new(whose, Rc::clone(&emit), how),
            emit,
            inspector: dom::create_inspector(Box::new(ForInspector(Weak::clone(this)))),
            debugger: RefCell::default(),
            frames: how["frames"].clone().into(),
            is_looking: Cell::default(),
            has_left: Cell::default(),
        })
    }

    pub(super) fn enter(&self, how: &Value) -> JsResult<()> {
        self.runtime.context_named("")?;
        for command in how["commands"].items() {
            drop(self.obey(command[0].text(), &command[1]));
        }
        Ok(())
    }

    pub(super) fn leave(&self) {
        self.has_left.set(true);
        self.stop_debugging();
        if let Ok(Ok(document)) = catch(self.document()) {
            self.inspector.close(document);
        }
        self.runtime.forget();
    }

    pub(super) fn hear(&self, it: Logged<'_>) -> JsResult<()> {
        self.runtime.logged(it)
    }

    fn document(&self) -> JsResult<dom::Document> {
        let document = self.control("currentDocument", &[])?;
        Ok(dom::Document(realm::peek(document)))
    }

    /// `None` for what the inspector does not know.
    fn ask_inspector(&self, method: &str, params: &Value) -> JsResult<Option<Outcome>> {
        let outcome = self.inspector.run(self.document()?, method, params);
        if outcome.is_some() && !self.is_looking.replace(true) {
            task::spawn(Agent::keep_looking(Weak::clone(&self.this)));
        }
        Ok(outcome.map(|it| it.map_err(Failure)))
    }

    /// It takes at most a tenth of the time.
    async fn keep_looking(agent: Weak<Agent>) {
        let mut pause = 100;
        loop {
            task::sleep(pause).await;
            let Some(it) = agent.upgrade().filter(|it| !it.has_left.get()) else {
                return;
            };
            let (start, document) = (seconds(), catch(it.document()));
            if let Ok(Ok(document)) = document
                && !it.inspector.look(document)
            {
                return it.is_looking.set(false);
            }
            pause = 100.max(((seconds() - start) * 1e4) as u64);
        }
    }

    fn debugger(&self) -> Option<Rc<Debugger>> {
        self.debugger.borrow().clone()
    }

    fn start_debugging(&self) -> Outcome {
        require_interpreter()?;
        if self.debugger().is_none() {
            let debugger = Debugger::new(Rc::clone(&self.runtime), Rc::clone(&self.emit))?;
            debugger.enter_document()?;
            self.debugger.replace(Some(debugger));
        }
        Ok(record! { "debuggerId": self.runtime.frame() })
    }

    fn stop_debugging(&self) {
        self.debugger.take().inspect(|it| it.close());
    }

    fn control(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        self.runtime.document()?.inspect(method, arguments)
    }

    fn node(&self, params: &Value) -> Result<dom::Node, Failure> {
        let node = match (&params["objectId"], &params["backendNodeId"]) {
            (id @ Value::Text(_), _) => Some(dom::Node(self.runtime.object_in_page(id)?)),
            (_, id) => {
                let id = id.as_number().unwrap_or_else(|| params["nodeId"].number());
                dom::Node::with_id(id as u32)
            }
        };
        Ok((node.filter(|it| it.is_one())).ok_or("No node with given id found")?)
    }

    fn frame_owner(&self, params: &Value) -> Outcome {
        let is_it = |it: &&Value| it["target"].is(params["frameId"].text());
        let owner = self
            .frames
            .borrow()
            .items()
            .iter()
            .find(is_it)
            .map(element_at);
        let owner = owner.filter(|it| it.is_object());
        let id = dom::Node(owner.ok_or("Frame with the given id was not found.")?).id();
        let pushed = self.ask_inspector("DOM.requestNode", &record! { "backendNodeId": id })?;
        let pushed = pushed.transpose()?.unwrap_or_default();
        let known = Some(&pushed["nodeId"]).filter(|it| it.is_truthy());
        Ok(record! { "backendNodeId": id, "nodeId": known })
    }

    fn accessible_node(&self, params: &Value) -> Outcome {
        let node = realm::cross(global(), self.node(params)?.0)?;
        let it = wire::data_from_js(self.control("describeForAccessibility", &[node])?)?;
        Ok(record! { "nodes": list![record! {
            "nodeId": "1",
            "ignored": it["role"].is("none"),
            "role": record! { "type": "role", "value": &it["role"] },
            "name": record! { "type": "computedString", "value": &it["name"] },
        }] })
    }

    fn take_heap_snapshot(&self) -> Outcome {
        if self.runtime.is_in_app() && global().bun_vm().standalone_module_graph.is_some() {
            return Err("The page shares its heap with the app".into());
        }
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
        Ok(Value::empty())
    }

    fn layout_metrics(&self) -> Outcome {
        let it = self.document()?.metrics();
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

    pub(super) async fn run(&self, method: &str, params: Value) -> Outcome {
        let runtime = &self.runtime;
        let evaluated = match method {
            "Debugger.evaluateOnCallFrame" => {
                (self.debugger().ok_or("Debugger agent is not enabled")?).evaluate(&params)?
            }
            "Runtime.awaitPromise" => {
                let params = params.with("awaitPromise", true);
                return (runtime.result(runtime.promise(&params)?, &params)).await;
            }
            "Runtime.callFunctionOn" => runtime.call_function(&params)?,
            "Runtime.evaluate" => runtime.evaluate(&params)?,
            _ => return self.obey(method, &params),
        };
        runtime.result(evaluated, &params).await
    }

    pub(super) fn obey(&self, method: &str, params: &Value) -> Outcome {
        let runtime = &self.runtime;
        let known = match text::before(method, ".") {
            "DOM" | "CSS" | "Overlay" | "DOMStorage" => self.ask_inspector(method, params)?,
            "Debugger" => self.debugger().and_then(|it| it.run(method, params)),
            _ => None,
        };
        if let Some(outcome) = known {
            return outcome;
        }
        match method {
            "Accessibility.getFullAXTree" => {
                let nodes = self.control("accessibilityTree", &[])?;
                return Ok(record! { "nodes": Value::parse(text_of(nodes)?.as_bytes()) });
            }
            "Accessibility.getPartialAXTree" => return self.accessible_node(params),
            "DOM.focus" => self.node(params)?.focus(),
            "DOM.getFrameOwner" => return self.frame_owner(params),
            "DOM.resolveNode" => {
                return Ok(record! { "object": runtime.resolve(self.node(params)?.0, params)? });
            }
            "DOM.scrollIntoViewIfNeeded" => self.node(params)?.reveal().map_err(|it| match it {
                Hidden::Detached => "Node is detached from document",
                Hidden::NotRendered => "Node does not have a layout object",
            })?,
            "DOM.setFileInputFiles" => {
                let input = realm::cross(global(), self.node(params)?.0)?;
                let files = all_chosen(js(&params["files"])?)?;
                self.control("chooseFiles", &[input, files])?;
            }
            "DOM.setInspectedNode" => runtime.select(self.node(params)?.0),
            "DOMDebugger.getEventListeners" => return runtime.listeners(params),
            "Debugger.disable" => self.stop_debugging(),
            "Debugger.enable" => return self.start_debugging(),
            "HeapProfiler.collectGarbage" => drop(global().vm().run_gc(true)),
            "HeapProfiler.takeHeapSnapshot" => return self.take_heap_snapshot(),
            KNOW_FRAMES => drop(self.frames.replace(params["frames"].clone())),
            "Page.addScriptToEvaluateOnNewDocument" => return done(runtime.run_script(params)),
            "Page.createIsolatedWorld" => {
                let name = Some(params["worldName"].text()).filter(|it| !it.is_empty());
                let context = runtime.context_named(name.unwrap_or("isolated"))?;
                return Ok(record! { "executionContextId": context.id });
            }
            "Page.getLayoutMetrics" => return self.layout_metrics(),
            "Page.getResourceTree" => {
                return (self.ask_inspector(method, params)?).unwrap_or_else(|| Ok(Value::empty()));
            }
            "Page.setLifecycleEventsEnabled" => {
                return Ok(record! { "readyState": text_of(self.control("readyState", &[])?)? });
            }
            REVEAL => {
                let point = ["x", "y"].map(|it| params[it].number());
                self.inspector.reveal(self.document()?, point);
            }
            "Runtime.addBinding" => runtime.bind(params)?,
            "Runtime.removeBinding" => runtime.unbind(params["name"].text()),
            "Runtime.compileScript" => return runtime.check_syntax(params),
            "Runtime.disable" => runtime.disable(),
            "Runtime.discardConsoleEntries" => runtime.discard_log()?,
            "Runtime.enable" => runtime.enable()?,
            "Runtime.getHeapUsage" => {
                let size = JSC__VM__heapSize(global().vm()) as f64;
                return Ok(record! { "usedSize": size, "totalSize": size });
            }
            "Runtime.getIsolateId" => {
                return Ok(record! { "id": crate::process::id().to_string() });
            }
            "Runtime.getProperties" => return runtime.properties(params),
            "Runtime.globalLexicalScopeNames" => return Ok(record! { "names": list![] }),
            "Runtime.releaseObject" => runtime.objects.release(&params["objectId"]),
            "Runtime.releaseObjectGroup" => {
                runtime.objects.release_group(params["objectGroup"].text())
            }
            _ => return unknown(method),
        }
        Ok(Value::empty())
    }
}

/// In a process for pages.
pub(crate) mod far {
    use bun_ui::protocol::Lane;
    use bun_web::host::Notice;
    use bun_web::remote::{self, HOST, Head, Kind};

    use super::*;

    struct Known {
        session: u32,
        page: u32,
        agent: Rc<Agent>,
    }

    state!(fn all() -> RefCell<Vec<Known>>);

    fn end_where(mut is_over: impl FnMut(&Known) -> bool) {
        let over = (all().borrow_mut().extract_if(.., |it| is_over(it))).collect::<Vec<_>>();
        over.iter().for_each(|it| it.agent.leave());
    }

    pub(crate) fn end(session: u32) {
        end_where(|it| it.session == session);
    }

    pub(crate) fn forget(page: u32) {
        end_where(|it| it.page == page);
    }

    pub(crate) fn begin(page: u32, session: u32, how: &str) -> JsResult<()> {
        end(session);
        let emit = move |method: &str, params: Value| {
            let notice = Notice::Inspected {
                session,
                method: method.into(),
                params: params.to_json(),
            };
            remote::send(
                HOST,
                Lane::Elsewhere,
                Head::new(Kind::Notice, page, 0),
                notice,
            );
        };
        let how = Value::parse(how.as_bytes()).unwrap_or_default();
        let agent = Agent::new(Whose::Page(page), Rc::new(emit), &how);
        all().borrow_mut().push(Known {
            session,
            page,
            agent: Rc::clone(&agent),
        });
        agent.enter(&how)
    }

    pub(crate) fn tell(page: u32, logged: Logged<'_>) -> JsResult<()> {
        let agents = (all().borrow().iter().filter(|it| it.page == page))
            .map(|it| Rc::clone(&it.agent))
            .collect::<Vec<_>>();
        agents.iter().try_for_each(|it| it.hear(logged))
    }

    pub(crate) async fn run(session: u32, method: &str, params: &str) -> Result<String, String> {
        let agent =
            (all().borrow().iter().find(|it| it.session == session)).map(|it| Rc::clone(&it.agent));
        let params = Value::parse(params.as_bytes()).unwrap_or_default();
        let outcome = agent.ok_or("Target closed")?.run(method, params).await;
        outcome.map(|it| it.to_json()).map_err(|it| it.0)
    }
}

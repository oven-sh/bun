//! The part of a session that is where the document is.

use std::rc::Rc;

use bun_jsc::{JSGlobalObject, Weak};
use bun_ui::dom::{self, Hidden};
use bun_web::dom::element_of_frame;

use super::runtime::{Runtime, Whose};
use super::{Emit, Failure, Outcome, done, unknown};
use crate::contents::all_chosen;
use crate::contents::inspection::News;
use crate::prelude::*;
use crate::realm;
use crate::value::Value;
use crate::webview::wire;

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

fn element_at(place: &Value) -> JSValue {
    let [page, frame] = ["page", "frame"].map(|it| place[it].number() as u32);
    element_of_frame(page, frame)
}

pub(super) struct Agent {
    runtime: Runtime,
    emit: Emit,
}

impl Agent {
    /// `how` is from `PageSession::settings`.
    pub(super) fn new(whose: Whose, emit: Emit, how: &Value) -> Rc<Agent> {
        let runtime = Runtime::new(whose, Rc::clone(&emit), how);
        Rc::new(Agent { runtime, emit })
    }

    pub(super) fn enter(&self, how: &Value) -> JsResult<()> {
        self.runtime.context_named("")?;
        (how["bindings"].items().iter()).try_for_each(|it| self.runtime.bind(it.text()))?;
        (how["scripts"].items().iter()).try_for_each(|it| self.runtime.run_script(it))
    }

    pub(super) fn leave(&self) {
        self.runtime.forget();
    }

    pub(super) fn hear(&self, news: News<'_>) -> JsResult<()> {
        match news {
            News::Console(kind, values) => self.runtime.logged(kind, values),
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
                self.runtime.thrown(details, error)
            }
            _ => Ok(()),
        }
    }

    fn control(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        self.runtime.document()?.inspect(method, arguments)
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
        let frame = match it.is_root {
            true => Some(self.runtime.frame()),
            false => (params["frames"].items().iter())
                .find(|it| element_at(it) == node.0)
                .map(|it| it["target"].text()),
        };
        Ok(record! { "node": record! {
            "nodeId": 0,
            "backendNodeId": node_id_of(node.0),
            "nodeType": it.kind,
            "nodeName": it.name,
            "localName": it.local_name,
            "nodeValue": it.value,
            "frameId": frame,
        } })
    }

    fn frame_owner(params: &Value) -> Outcome {
        let place =
            (params["frames"].items().iter()).find(|it| it["target"].is(params["frameId"].text()));
        let owner = place.map(element_at).filter(|it| it.is_object());
        let owner = owner.ok_or("Frame with the given id was not found.")?;
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
        let it = wire::data_from_js(self.control("describeForAccessibility", &[node])?)?;
        Ok(record! { "nodes": list![record! {
            "nodeId": "1",
            "ignored": it["role"].is("none"),
            "role": record! { "type": "role", "value": &it["role"] },
            "name": record! { "type": "computedString", "value": &it["name"] },
        }] })
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

    fn layout_metrics(&self) -> Outcome {
        let it = dom::Document(realm::peek(self.control("currentDocument", &[])?)).metrics();
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
        match method {
            "Accessibility.getFullAXTree" => {
                let nodes = self.control("accessibilityTree", &[])?;
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
            "DOM.getFrameOwner" => Agent::frame_owner(&params),
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
                done(self.control("chooseFiles", &[input, files]).map(drop))
            }
            "HeapProfiler.collectGarbage" => {
                global().vm().run_gc(true);
                Ok(Value::empty())
            }
            "HeapProfiler.takeHeapSnapshot" => done(self.take_heap_snapshot()),
            "Page.addScriptToEvaluateOnNewDocument" => done(runtime.run_script(&params)),
            "Page.createIsolatedWorld" => {
                let name = Some(params["worldName"].text()).filter(|it| !it.is_empty());
                let context = runtime.context_named(name.unwrap_or("isolated"))?;
                Ok(record! { "executionContextId": context.id })
            }
            "Page.getLayoutMetrics" => self.layout_metrics(),
            "Page.setLifecycleEventsEnabled" => {
                Ok(record! { "readyState": text_of(self.control("readyState", &[])?)? })
            }
            "Runtime.addBinding" => done(runtime.bind(params["name"].text())),
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
            _ => unknown(method),
        }
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

    pub(crate) fn tell(page: u32, news: News<'_>) -> JsResult<()> {
        let agents = (all().borrow().iter().filter(|it| it.page == page))
            .map(|it| Rc::clone(&it.agent))
            .collect::<Vec<_>>();
        agents.iter().try_for_each(|it| it.hear(news))
    }

    pub(crate) async fn run(session: u32, method: &str, params: &str) -> Result<String, String> {
        let agent =
            (all().borrow().iter().find(|it| it.session == session)).map(|it| Rc::clone(&it.agent));
        let params = Value::parse(params.as_bytes()).unwrap_or_default();
        let outcome = agent.ok_or("Target closed")?.run(method, params).await;
        outcome.map(|it| it.to_json()).map_err(|it| it.0)
    }
}

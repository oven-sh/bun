//! The domains DOM, CSS, Overlay and DOMStorage of the DevTools protocol. Nothing tells it about changes: it compares what it has reported with what is there.

mod nodes;
mod outline;
mod overlay;
mod site;
mod styles;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{self, JsHeap, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, Weak};
use bun_ui::data::Value;
use bun_ui::{dom, list, main_global, record, state};

use crate::api::core::*;
use crate::api::embedder::with_node;
use crate::api::events::describe;
use crate::api::window::Window;
use crate::name::Map;
use crate::tree::{AFTER, BACKDROP, BEFORE, MARKER, NodeId};

pub(crate) use overlay::pick;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Outcome = Result<Value, String>;

const GENERATED: [(usize, &str); 4] = [
    (MARKER, "marker"),
    (BEFORE, "before"),
    (AFTER, "after"),
    (BACKDROP, "backdrop"),
];
/// The lowest bits of an id say which of `GENERATED` it is, from 1.
const SLOT_BITS: u32 = 3;

#[derive(Default)]
struct Numbered {
    nodes: RefCell<Map<u32, Weak<()>>>,
    last: Cell<u32>,
    sweeps_at: Cell<usize>,
}

state!(fn numbered() -> Numbered);

#[derive(Default)]
struct Number(Cell<u32>);

fn id_of(node: &Node) -> u32 {
    let number = &node.extra::<Number>().0;
    if number.get() == 0 {
        let (all, mut nodes) = (numbered(), numbered().nodes.borrow_mut());
        if nodes.len() >= all.sweeps_at.get() {
            nodes.retain(|_, it| it.get().is_some());
            all.sweeps_at.set(nodes.len() * 2 + 1024);
        }
        all.last.update(|it| it + 1);
        number.set(all.last.get());
        nodes.insert(
            number.get(),
            Weak::create_passive(node.to_js(), main_global()),
        );
    }
    number.get() << SLOT_BITS
}

fn object_with_id(id: u32) -> Option<JSValue> {
    numbered().nodes.borrow().get(&(id >> SLOT_BITS))?.get()
}

/// A node, or something that is generated for it.
#[derive(Clone, Copy)]
struct Target<'a> {
    node: &'a Node,
    slot: Option<usize>,
}

impl<'a> Target<'a> {
    fn with_id(heap: &JsHeap<'a>, id: u32) -> Option<Target<'a>> {
        let slot = (id as usize % (1 << SLOT_BITS))
            .checked_sub(1)
            .filter(|it| *it < GENERATED.len());
        Some(Target {
            node: Node::from_js(heap, object_with_id(id)?)?,
            slot,
        })
    }

    fn id(self) -> u32 {
        id_of(self.node) + self.slot.map_or(0, |it| it as u32 + 1)
    }

    /// 0 if it is no longer generated.
    fn in_engine(self, tree: &crate::tree::Tree, node: NodeId) -> NodeId {
        self.slot.map_or(node, |slot| {
            tree.element(node).map_or(0, |it| it.generated[slot])
        })
    }

    fn pseudo(self) -> Option<String> {
        self.slot.map(|it| format!("::{}", GENERATED[it].1))
    }

    fn element(self) -> Result<&'a Element, String> {
        self.node
            .as_element()
            .ok_or_else(|| "Node is not an Element".into())
    }
}

impl<'a> From<&'a Node> for Target<'a> {
    fn from(node: &'a Node) -> Target<'a> {
        Target { node, slot: None }
    }
}

fn utf8(text: &DomString) -> Value {
    (&*text.to_utf8()).into()
}

fn lossy(bytes: &[u8]) -> Value {
    (&*bstr::ByteSlice::to_str_lossy(bytes)).into()
}

fn or_message<'a, T>(cx: Cx<'_, 'a>, result: bindgen::Result<'a, T>) -> Result<T, String> {
    result.map_err(|it| {
        let global = global_of(&cx.heap);
        describe(global, global.take_error(it.into_js_error(global)))
    })
}

fn empty() -> Outcome {
    Ok(Value::empty())
}

pub(crate) struct Inspector {
    this: std::rc::Weak<Inspector>,
    session: Box<dyn dom::Session>,
    nodes: nodes::Reported,
    styles: styles::Reported,
    overlay: overlay::Overlay,
    site: site::Reported,
}

impl Inspector {
    fn emit(&self, method: &str, params: Value) {
        self.session.emit(method, params);
    }

    fn target<'a>(&self, heap: &JsHeap<'a>, params: &Value) -> Result<Target<'a>, String> {
        let found = match params["backendNodeId"]
            .as_number()
            .or_else(|| params["nodeId"].as_number())
        {
            Some(id) => Target::with_id(heap, id as u32),
            None => Node::from_js(
                heap,
                self.session
                    .object(&params["objectId"])
                    .ok_or("Could not find object with given id")?,
            )
            .map(Target::from),
        };
        found.ok_or_else(|| "No node with given id found".into())
    }

    fn compare<'a>(&self, cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
        self.compare_nodes(cx, doc)
            | self.compare_styles(cx, doc)
            | self.update_overlay(cx, doc)
            | self.compare_storage(cx, doc)
    }
}

fn with_doc<R>(it: dom::Document, run: impl for<'a> FnOnce(Cx<'_, 'a>, &'a Doc) -> R) -> Option<R> {
    with_node(it.0, |cx, it| Some(run(cx, it.as_doc()?)))
}

impl dom::Inspector for Inspector {
    fn run(&self, it: dom::Document, method: &str, params: &Value) -> Option<Outcome> {
        with_doc(it, |cx, doc| {
            self.compare_nodes(cx, doc);
            let dot = bun_core::strings::index_of_char_usize(method.as_bytes(), b'.')?;
            let (domain, name) = (&method[..dot], &method[dot + 1..]);
            let mark = custom::enter(cx);
            let outcome = match domain {
                "DOM" => self.about_nodes(cx, doc, name, params),
                "CSS" => self.about_styles(cx, doc, name, params),
                "Overlay" => self.about_overlay(cx, doc, name, params),
                "DOMStorage" => self.about_storage(cx, doc, name, params),
                "Page" if name == "getResourceTree" => Some(site::resources(cx, doc)),
                _ => None,
            };
            _ = custom::leave(cx, mark);
            self.compare_nodes(cx, doc);
            outcome
        })?
    }

    fn look(&self, it: dom::Document) -> bool {
        let look = with_doc(it, |cx, doc| {
            let is_wanted = self.compare(cx, doc);
            Window::of(doc).inspect(|it| it.paint_while_paused(cx));
            is_wanted
        });
        look.unwrap_or(false)
    }

    fn reveal(&self, it: dom::Document, point: [f64; 2]) {
        with_doc(it, |cx, doc| self.pick_at(cx, doc, Some(point), true));
    }

    fn close(&self, it: dom::Document) {
        with_doc(it, |cx, doc| {
            self.overlay.hide(cx, doc);
            self.styles.stop_forcing(cx);
        });
        for id in self.styles.forget() {
            self.emit("CSS.styleSheetRemoved", record! { "styleSheetId": id });
        }
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_create_inspector(session: Box<dyn dom::Session>) -> Rc<dyn dom::Inspector> {
    Rc::new_cyclic(|this| Inspector {
        this: std::rc::Weak::clone(this),
        session,
        nodes: Default::default(),
        styles: Default::default(),
        overlay: Default::default(),
        site: Default::default(),
    })
}

#[unsafe(no_mangle)]
fn __bun_dom_node_with_id(id: u32) -> Option<JSValue> {
    object_with_id(id)
}

#[unsafe(no_mangle)]
fn __bun_dom_id_of(it: dom::Node) -> u32 {
    with_node(it.0, |_, it| Some(id_of(it))).unwrap_or(0)
}

fn label_of<'a>(heap: &JsHeap<'a>, node: &'a Node) -> String {
    let Some(element) = node.as_element() else {
        let name = nodes::name_of(heap, node);
        return if node.node_type() == NodeType::Doctype {
            format!("<!DOCTYPE {name}>")
        } else {
            name
        };
    };
    let mut label = element.qualified_name().as_utf8().into_owned();
    element.with_attr(atom!("id"), |it| {
        label.extend(["#", it].into_iter().filter(|_| !it.is_empty()))
    });
    element.with_attr(atom!("class"), |it| {
        it.split_ascii_whitespace()
            .for_each(|it| label.extend([".", it]))
    });
    label
}

#[unsafe(no_mangle)]
fn __bun_dom_label(it: dom::Node) -> Option<String> {
    with_node(it.0, |cx, it| Some(label_of(&cx.heap, it)))
}

#[unsafe(no_mangle)]
fn __bun_dom_listeners_of(realm: &JSGlobalObject, target: JSValue) -> JSValue {
    let collect = |cx: Cx<'_, '_>| {
        let all = List::new(&cx.heap);
        if let Some(target) = EventTarget::resolve(&cx.heap, target) {
            target.for_each_listener(cx, |cx, name, callback, flags| {
                let global = global_of(&cx.heap);
                let it = JSValue::create_empty_object(global, 5);
                it.put(global, b"listener", callback);
                it.put(global, b"type", name.to_js(&cx.heap).to_js());
                [&b"useCapture"[..], b"passive", b"once"]
                    .into_iter()
                    .zip(flags)
                    .for_each(|(name, is_set)| it.put(global, name, is_set.into()));
                all.push(&cx.heap, it);
            });
        }
        all.to_js()
    };
    // SAFETY: this is the thread of the VM, and the caller holds the target.
    unsafe { JsScope::with(realm.as_mut_ptr(), collect) }
}

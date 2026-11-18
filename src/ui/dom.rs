//! Documents, for what is outside of them and is no script.

use std::rc::Rc;

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use crate::abi::Rect;
use crate::data::Value;
use crate::protocol::Size;

/// The indices among the element children that lead from the body to an element.
pub type Place<'a> = &'a [usize];

#[derive(Clone, Copy)]
pub enum Change<'a> {
    AppendMarkup(&'a str),
    ReplaceMarkup(&'a str),
    Attribute(&'a str, &'a str),
    Remove,
    Reveal,
    Focus,
}

#[derive(Clone, Copy)]
pub struct Document(pub JSValue);

#[derive(Clone, Copy)]
pub struct Event(pub JSValue);

#[derive(Clone, Copy)]
pub struct Node(pub JSValue);

#[derive(Default)]
pub struct Metrics {
    pub viewport: [i32; 2],
    pub scroll: [f64; 2],
    pub content: [f64; 2],
}

pub enum Hidden {
    Detached,
    NotRendered,
}

/// What an [`Inspector`] needs from its session.
pub trait Session {
    fn emit(&self, method: &str, params: Value);
    /// That of the document.
    fn frame(&self) -> String;
    fn frame_in(&self, element: JSValue) -> Option<String>;
    fn object(&self, id: &Value) -> Option<JSValue>;
}

/// The domains of the DevTools protocol that are about documents.
pub trait Inspector {
    /// `None` if it is none of them.
    fn run(&self, it: Document, method: &str, params: &Value) -> Option<Result<Value, String>>;
    /// Reports what has changed. False if nobody wants to know.
    fn look(&self, it: Document) -> bool;
    /// Has the client show the element that is there.
    fn reveal(&self, it: Document, point: [f64; 2]);
    fn close(&self, it: Document);
}

pub fn create_inspector(session: Box<dyn Session>) -> Rc<dyn Inspector> {
    __bun_dom_create_inspector(session)
}

/// An array of what `getEventListeners()` has in its arrays.
pub fn listeners_of(realm: &JSGlobalObject, target: JSValue) -> JSValue {
    __bun_dom_listeners_of(realm, target)
}

unsafe extern "Rust" {
    safe fn __bun_dom_create_inspector(session: Box<dyn Session>) -> Rc<dyn Inspector>;
    safe fn __bun_dom_listeners_of(realm: &JSGlobalObject, target: JSValue) -> JSValue;
    safe fn __bun_dom_node_with_id(id: u32) -> Option<JSValue>;
    safe fn __bun_dom_id_of(it: Node) -> u32;
    safe fn __bun_dom_label(it: Node) -> Option<String>;
    safe fn __bun_dom_metrics(it: Document) -> Metrics;
    safe fn __bun_dom_is_node(it: Node) -> bool;
    safe fn __bun_dom_reveal(it: Node) -> Result<(), Hidden>;
    safe fn __bun_dom_focus(it: Node);
    safe fn __bun_dom_change(it: Document, place: Place<'_>, change: Change<'_>) -> JsResult<()>;
    safe fn __bun_dom_bounds(it: Document, place: Place<'_>) -> Rect;
    safe fn __bun_dom_viewport(it: Document) -> Size;
    safe fn __bun_dom_listen(it: Document, event: &str, listener: JSValue) -> JsResult<()>;
    safe fn __bun_dom_render(
        it: Document,
        root: Option<JSValue>,
        content: JSValue,
        window: JSValue,
    ) -> JsResult<JSValue>;
    safe fn __bun_dom_use_store(subscribe: JSValue, read: JSValue) -> JsResult<JSValue>;
    safe fn __bun_dom_target(it: Event) -> Vec<usize>;
    safe fn __bun_dom_is_target_checked(it: Event) -> bool;
    safe fn __bun_dom_key(it: Event) -> String;
}

impl Document {
    pub fn change(self, place: Place<'_>, change: Change<'_>) -> JsResult<()> {
        __bun_dom_change(self, place, change)
    }

    pub fn bounds(self, place: Place<'_>) -> Rect {
        __bun_dom_bounds(self, place)
    }

    pub fn viewport(self) -> Size {
        __bun_dom_viewport(self)
    }

    /// Into the body. Returns the root.
    pub fn render(
        self,
        root: Option<JSValue>,
        content: JSValue,
        window: JSValue,
    ) -> JsResult<JSValue> {
        __bun_dom_render(self, root, content, window)
    }

    pub fn metrics(self) -> Metrics {
        __bun_dom_metrics(self)
    }

    pub fn listen(self, event: &str, listener: JSValue) -> JsResult<()> {
        __bun_dom_listen(self, event, listener)
    }
}

/// `useSyncExternalStore()`
pub fn use_store(subscribe: JSValue, read: JSValue) -> JsResult<JSValue> {
    __bun_dom_use_store(subscribe, read)
}

impl Node {
    pub fn is_one(self) -> bool {
        __bun_dom_is_node(self)
    }

    pub fn with_id(id: u32) -> Option<Node> {
        __bun_dom_node_with_id(id).map(Node)
    }

    pub fn id(self) -> u32 {
        __bun_dom_id_of(self)
    }

    /// As `div#id.class`
    pub fn label(self) -> Option<String> {
        __bun_dom_label(self)
    }

    pub fn reveal(self) -> Result<(), Hidden> {
        __bun_dom_reveal(self)
    }

    pub fn focus(self) {
        __bun_dom_focus(self);
    }
}

impl Event {
    pub fn target(self) -> Vec<usize> {
        __bun_dom_target(self)
    }

    pub fn is_target_checked(self) -> bool {
        __bun_dom_is_target_checked(self)
    }

    pub fn key(self) -> String {
        __bun_dom_key(self)
    }
}

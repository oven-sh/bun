//! The bodies of `bindgen_interface_test.bind.ts`.

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use crate::bindgen::{
    self, ClassStructure, JsAtom, JsHeap, JsInterface, JsList, JsLocal, JsRecord, JsScope,
    JsStringImpl, ObservableArray, ObservableArrayOwner, PropertyNames, TypedArray,
};
use crate::generated_bindgen::bindgen_interface_test::{
    WebAll, WebByName, WebElement, WebElementMore, WebEmitter, WebError, WebFragment, WebGlobal,
    WebGlobalBase, WebInit, WebIterator, WebLeafInit, WebMixed, WebMode, WebNamedList,
    WebNamedSlot, WebNodeOrString, WebPairs, WebParent, WebPinned, WebPlain, WebPoint3,
    WebRegistry, WebSet, WebSides, WebSlot, WebSpace, WebSquare, js_WebElement, js_WebError,
    js_WebFragment, js_WebIterator, js_WebLeaf, js_WebNode, js_WebPoint3, js_WebSet, js_WebStyle,
    js_WebTarget,
};
use crate::{DOMExceptionCode, JSObject, JSPromise, JSString, JSValue, Strong};
use bun_core::{WTFStringImplExt as _, WTFStringImplStruct};

static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static DROPPED: AtomicUsize = AtomicUsize::new(0);

#[repr(C)]
pub(crate) struct WebTarget {
    id: u64,
    _interior: bindgen::Interior,
}

impl WebTarget {
    pub(crate) fn constructor() -> Self {
        Self {
            id: u64::from(NEXT_ID.fetch_add(1, Ordering::Relaxed)),
            _interior: Default::default(),
        }
    }

    pub(crate) fn get_id(&self) -> u32 {
        self.id as u32
    }
}

#[derive(Default)]
struct NodeData {
    label: RefCell<Vec<u8>>,
    slots: [Cell<i32>; 2],
    depth: Cell<u32>,
    is_closed: Cell<bool>,
}

#[repr(C)]
pub(crate) struct WebNode {
    pub(crate) base: WebTarget,
    pub(crate) fields: js_WebNode::Fields,
    data: Box<NodeData>,
    padding: [u64; 2],
    is_marked: Cell<bool>,
}

impl Drop for WebNode {
    fn drop(&mut self) {
        debug_assert_eq!(self.padding, [1, 2]);
        DROPPED.fetch_add(1, Ordering::Relaxed);
    }
}

impl WebNode {
    fn new(label: &[u8]) -> Self {
        let data = Box::<NodeData>::default();
        data.label.replace(label.to_vec());
        Self {
            base: WebTarget::constructor(),
            fields: Default::default(),
            data,
            padding: [1, 2],
            is_marked: Cell::new(false),
        }
    }

    pub(crate) fn adopt<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        child: &'a WebNode,
    ) -> bindgen::Result<'a, &'a WebNode> {
        if core::ptr::eq(self, child) {
            return Err(heap.dom_exception(
                DOMExceptionCode::HierarchyRequestError,
                format_args!("A node cannot adopt itself."),
            ));
        }
        js_WebNode::set_parent(child, Some(self));
        js_WebNode::set_first(self, Some(child));
        Ok(child)
    }

    pub(crate) fn is_same(&self, other: Option<&WebNode>) -> bool {
        other.is_some_and(|other| core::ptr::eq(self, other))
    }

    pub(crate) fn get_label(&self) -> Vec<u8> {
        self.data.label.borrow().clone()
    }

    pub(crate) fn set_label(&self, value: &[u8]) {
        self.data.label.replace(value.to_vec());
    }

    pub(crate) fn describe<'a>(
        &self,
        heap: &JsHeap<'a>,
        values: JsList<'a, WebNodeOrString<'a>>,
    ) -> bindgen::Result<'a, Vec<u8>> {
        let mut text = Vec::new();
        for value in values {
            match value {
                WebNodeOrString::Node(node) => {
                    text.extend([b"<", &node.get_label()[..], b">"].concat());
                }
                WebNodeOrString::String(string) => {
                    text.extend_from_slice(&string.view(heap)?.to_utf8());
                }
            }
        }
        Ok(text)
    }

    pub(crate) fn fail<'a>(&self, heap: &JsHeap<'a>, code: u8) -> bindgen::Result<'a, ()> {
        Err(heap.dom_exception(DOMExceptionCode::SyntaxError, format_args!("code {code}")))
    }

    pub(crate) fn later(&self, cx: &mut JsScope<'_>, value: f64) -> JSValue {
        JSPromise::resolved_promise_value(cx.global(), JSValue::js_number(value))
    }
}

impl WebParent {
    pub(crate) fn get_child_label(&self) -> Option<Vec<u8>> {
        js_WebNode::first(self).map(WebNode::get_label)
    }

    pub(crate) fn get_depth(&self) -> u32 {
        self.data.depth.get()
    }

    pub(crate) fn set_depth(&self, value: u32) {
        self.data.depth.set(value);
    }

    pub(crate) fn repeat(&self, times: u8) -> Vec<u8> {
        self.get_label().repeat(usize::from(times))
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Slot(usize);

impl Slot {
    pub(crate) const X: Slot = Slot(0);
    pub(crate) const Y: Slot = Slot(1);
}

impl WebNamedSlot {
    fn slot(&self, name: &WTFStringImplStruct) -> &Cell<i32> {
        &self.data.slots[usize::from(name.latin1_slice() != b"left")]
    }

    pub(crate) fn get(&self, name: &WTFStringImplStruct) -> i32 {
        self.slot(name).get()
    }

    pub(crate) fn set(&self, name: &WTFStringImplStruct, value: i32) {
        self.slot(name).set(value);
    }
}

#[repr(C)]
pub(crate) struct WebException(pub(crate) bindgen::DomException);

impl WebError {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        message: JsStringImpl<'a>,
        extra: JsLocal<'a>,
    ) -> &'a Self {
        let exception = bindgen::DomException::new(message.get(), "QuotaExceededError");
        let made = structure.create(heap, WebException(exception));
        js_WebError::set_extra(made, extra.to_js());
        made
    }
}

impl WebTarget {
    #[inline(never)]
    pub(crate) fn remember(&self, value: JsLocal<'_>) -> bool {
        if js_WebTarget::listeners(self).is_none() {
            js_WebTarget::set_listeners(self, value.to_js());
        }
        js_WebTarget::listeners(self).is_some()
    }

    #[inline(never)]
    pub(crate) fn mark(&self) -> bool {
        self.downcast::<WebNode>()
            .is_some_and(|node| node.is_marked.replace(true))
    }
}

impl WebSlot {
    pub(crate) fn get(&self, key: Slot) -> i32 {
        self.data.slots[key.0].get()
    }

    pub(crate) fn set(&self, key: Slot, value: i32) {
        self.data.slots[key.0].set(value);
    }
}

impl WebElement {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        init: &WebInit<'a>,
    ) -> &'a Self {
        let element = structure.create(heap, WebNode::new(init.label));
        js_WebNode::set_parent(element, init.owner);
        element
    }

    pub(crate) fn get_style<'a>(&self, heap: &JsHeap<'a>) -> &'a WebStyle {
        js_WebStyle::create(heap, WebStyle(Cell::new(0.0)))
    }

    pub(crate) fn get_adopted<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, ObservableArray> {
        let Some(array) = js_WebElement::adopted(self) else {
            let array = heap.create_observable_array(self);
            js_WebElement::set_adopted(self, array.to_js());
            return array;
        };
        // SAFETY: what is stored above.
        unsafe { JsLocal::<ObservableArray>::from_js_unchecked(heap, array) }
    }

    pub(crate) fn set_adopted<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value: JsList<'a, &'a WebNode>,
    ) -> bindgen::Result<'a, ()> {
        self.get_adopted(&cx.heap).replace(cx, value)
    }

    pub(crate) fn adopted_labels<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, Vec<Vec<u8>>> {
        let values = self.get_adopted(heap).values(heap)?.iter();
        let nodes = values.filter_map(|value| WebNode::from_js(heap, value.to_js()));
        Ok(nodes.map(WebNode::get_label).collect())
    }

    pub(crate) fn floats<'a>(
        &self,
        heap: &JsHeap<'a>,
        first: WebNodeOrString<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a, TypedArray<f32>>> {
        heap.create_typed_array(&[1.5, f32::from(matches!(first, WebNodeOrString::String(_)))])
    }

    pub(crate) fn get_mode(&self) -> WebMode {
        if self.data.is_closed.get() {
            WebMode::Closed
        } else {
            WebMode::Open
        }
    }

    pub(crate) fn set_mode(&self, value: WebMode) {
        self.data.is_closed.set(value == WebMode::Closed);
    }

    pub(crate) fn get_shadowed(&self) -> u32 {
        7
    }

    pub(crate) fn get_lenient(&self) -> u32 {
        8
    }

    pub(crate) fn atom(&self, name: JsAtom<'_>) -> bool {
        name.get().is_atom()
    }

    pub(crate) fn strings<'a>(
        &self,
        usv: JsLocal<'a, JSString>,
        bytes: Option<JsLocal<'a, JSString>>,
        r#impl: JsStringImpl<'a>,
    ) -> JsLocal<'a, JSString> {
        match r#impl.get().length() {
            1 => bytes.unwrap_or(usv),
            _ => r#impl.string(),
        }
    }

    pub(crate) fn choose_name(&self, _: JsLocal<'_, JSString>) -> &'static [u8] {
        b"name"
    }

    pub(crate) fn choose_init(&self, _: &WebInit<'_>) -> &'static [u8] {
        b"init"
    }

    pub(crate) fn choose_list<'a>(&self, _: JsList<'a, JsLocal<'a>>) -> &'static [u8] {
        b"list"
    }

    pub(crate) fn pick_none(&self) -> &'static [u8] {
        b"none"
    }

    pub(crate) fn pick_numbers(&self, _: f64, _: f64) -> &'static [u8] {
        b"numbers"
    }

    pub(crate) fn pick_node(&self, _: &WebNode, _: &[u8]) -> &'static [u8] {
        b"node"
    }
}

impl ObservableArrayOwner for WebElement {
    fn will_set<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value: JsLocal<'a>,
        _: u32,
    ) -> bindgen::Result<'a, ()> {
        if !WebNode::is(value.to_js()) {
            return Err(cx.heap.type_error(format_args!("not a node")));
        }
        self.data.depth.update(|depth| depth + 1);
        Ok(())
    }

    fn will_delete<'a>(
        &self,
        _: &mut JsScope<'a>,
        _: JsLocal<'a>,
        _: u32,
    ) -> bindgen::Result<'a, ()> {
        self.data.depth.update(|depth| depth + 100);
        Ok(())
    }
}

impl WebElementMore {
    pub(crate) fn more(&self) -> u32 {
        self.get_lenient() + 1
    }
}

impl WebPlain {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
    ) -> &'a Self {
        structure.create(heap, WebNode::new(b"plain"))
    }
}

impl WebFragment {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        new_target: JsLocal<'a, JSObject>,
    ) -> bindgen::Result<'a, &'a Self> {
        let structure = js_WebFragment::CLASS.structure_for_new_target(cx, new_target)?;
        Ok(structure.create(&cx.heap, WebNode::new(b"fragment")))
    }
}

#[repr(C)]
pub(crate) struct WebLeaf {
    pub(crate) base: WebElement,
    pub(crate) fields: js_WebLeaf::Fields,
    count: u32,
}

impl WebLeaf {
    pub(crate) fn constructor(init: &WebLeafInit<'_>) -> Self {
        Self::from_count(init.count, init.label)
    }

    pub(crate) fn from_count(count: u32, label: &[u8]) -> Self {
        Self {
            base: WebNode::new(label).into(),
            fields: Default::default(),
            count,
        }
    }

    pub(crate) fn get_count(&self) -> u32 {
        self.count
    }

    pub(crate) fn get_trusted(&self) -> bool {
        true
    }
}

pub(crate) struct WebStyle(Cell<f64>);

impl WebStyle {
    pub(crate) fn get_text(&self) -> f64 {
        self.0.get()
    }

    pub(crate) fn set_text(&self, value: f64) {
        self.0.set(value);
    }
}

pub(crate) struct WebShape {
    sides: u32,
    _interior: bindgen::Interior,
}

impl WebSides {
    pub(crate) fn get_sides(&self) -> u32 {
        self.sides
    }
}

impl WebSquare {
    pub(crate) fn constructor() -> WebShape {
        WebShape {
            sides: 4,
            _interior: Default::default(),
        }
    }
}

impl WebEmitter {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }
}

pub(crate) struct WebList(RefCell<Vec<i32>>);

impl WebList {
    pub(crate) fn constructor(items: Vec<i32>) -> Self {
        Self(RefCell::new(items))
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.0.borrow().len() as u32
    }

    pub(crate) fn push(&self, item: i32) {
        self.0.borrow_mut().push(item);
    }

    pub(crate) fn append(&self, items: &[i32], more: Option<&Vec<i32>>) {
        let more = more.into_iter().flatten();
        self.0.borrow_mut().extend(items.iter().chain(more));
    }

    pub(crate) fn indexed_get(&self, index: u32) -> Option<i32> {
        self.0.borrow().get(index as usize).copied()
    }
}

/// An item is named `n` and its digit, and the first is `length` too.
impl WebNamedList {
    pub(crate) fn constructor() -> WebList {
        WebList::constructor(Vec::new())
    }

    pub(crate) fn indexed_set(&self, index: u32, value: i32) {
        let mut items = (**self).0.borrow_mut();
        match items.get_mut(index as usize) {
            Some(item) => *item = value,
            None => items.push(value),
        }
    }

    pub(crate) fn named_get(&self, name: &WTFStringImplStruct) -> Option<i32> {
        match *name.to_utf8() {
            [b'n', digit] => {
                let item = i32::from(digit) - i32::from(b'0');
                (**self).0.borrow().contains(&item).then_some(item)
            }
            ref name if name == b"length" => self.indexed_get(0),
            _ => None,
        }
    }

    pub(crate) fn named_keys(&self, names: &mut PropertyNames) {
        names.add_utf8(b"length");
        for item in (**self).0.borrow().iter() {
            names.add_utf8(format!("n{item}").as_bytes());
        }
    }
}

pub(crate) struct WebMap(RefCell<Vec<(Vec<u8>, i32)>>);

impl WebMap {
    pub(crate) fn constructor<'a>(init: JsRecord<'a, JsAtom<'a>, i32>) -> Self {
        let entry = |(key, value): (JsAtom<'a>, i32)| (key.get().to_utf8().to_vec(), value);
        Self(RefCell::new(init.iter().map(entry).collect()))
    }

    pub(crate) fn named_get(&self, name: &WTFStringImplStruct) -> Option<i32> {
        let name = name.to_utf8();
        let entries = self.0.borrow();
        entries.iter().find(|it| it.0 == *name).map(|it| it.1)
    }

    pub(crate) fn named_set(&self, name: &WTFStringImplStruct, value: i32) {
        self.named_delete(name);
        self.0.borrow_mut().push((name.to_utf8().to_vec(), value));
    }

    pub(crate) fn named_delete(&self, name: &WTFStringImplStruct) {
        let name = name.to_utf8();
        self.0.borrow_mut().retain(|it| it.0 != *name);
    }

    pub(crate) fn named_keys(&self, names: &mut PropertyNames) {
        for (name, _) in self.0.borrow().iter() {
            names.add_utf8(name);
        }
    }
}

impl WebRegistry {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }
}

impl WebSet {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn prepare_entries(&self, heap: &JsHeap<'_>) {
        drop(js_WebSet::backing(heap, self).add(heap, JSValue::js_number(1.0)));
    }

    pub(crate) fn sum<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, f64> {
        let values = js_WebSet::backing(heap, self).values(heap)?;
        Ok(values.iter().map(|value| value.to_js().as_number()).sum())
    }
}

pub(crate) struct WebPoint(Cell<f64>);

impl WebPoint {
    pub(crate) fn constructor(x: f64) -> Self {
        Self(Cell::new(x))
    }

    pub(crate) fn get_x(&self) -> f64 {
        self.0.get()
    }
}

pub(crate) struct WebOtherPoint(f64);

impl WebOtherPoint {
    pub(crate) fn constructor(x: f64) -> Self {
        Self(x)
    }

    pub(crate) fn new_point(x: f64) -> Self {
        Self(-x)
    }

    pub(crate) fn get_x(&self) -> f64 {
        self.0
    }

    pub(crate) fn get_anything(&self) -> JSValue {
        JSValue::TRUE
    }
}

impl WebPoint3 {
    pub(crate) fn constructor() -> WebPoint {
        WebPoint::constructor(1.0)
    }

    pub(crate) fn get_z(&self) -> f64 {
        3.0
    }

    pub(crate) fn get_hidden(&self) -> f64 {
        4.0
    }

    pub(crate) fn serialize<'a>(
        &self,
        _: &mut JsScope<'a>,
        _: bool,
    ) -> bindgen::Result<'a, JSValue> {
        Ok(JSValue::js_number(self.get_x()))
    }

    pub(crate) fn deserialize<'a>(
        cx: &mut JsScope<'a>,
        clone: JsLocal<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let point = WebPoint::constructor(clone.to_js().as_number());
        Ok(js_WebPoint3::create(&cx.heap, point))
    }
}

impl WebByName {
    pub(crate) fn constructor() -> WebPoint {
        WebPoint::constructor(0.0)
    }

    pub(crate) fn attribute_names(names: &mut PropertyNames) {
        names.add_utf8(b"fontSize");
        names.add_utf8(b"font-size");
    }

    pub(crate) fn attribute_get(&self, name: &WTFStringImplStruct) -> f64 {
        self.get_x() + f64::from(name.length())
    }

    pub(crate) fn attribute_set(&self, _: &WTFStringImplStruct, value: f64) {
        (**self).0.set(value);
    }
}

impl WebSpace {
    pub(crate) fn get_is_window(heap: &JsHeap<'_>) -> bool {
        heap.is_window()
    }

    pub(crate) fn twice(value: f64) -> f64 {
        value * 2.0
    }
}

impl WebPairs {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn entries<'a>(&self, heap: &JsHeap<'a>) -> &'a WebIterator {
        js_WebIterator::create(heap, WebPoint::constructor(0.0))
    }
}

impl WebIterator {
    pub(crate) fn next<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, JSObject> {
        let index = (**self).0.replace(self.get_x() + 1.0);
        heap.create_iterator_result((index < 2.0).then(|| JSValue::js_number(index)))
    }
}

impl WebPinned {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn get_pinned(&self) -> u32 {
        1
    }

    pub(crate) fn pin(&self) -> u32 {
        2
    }
}

impl WebAll {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn call_instance(&self) -> u32 {
        9
    }
}

pub(crate) fn crop_nothing(_: &WebTarget) -> i32 {
    -1
}

pub(crate) fn crop(_: &WebTarget, x: i32, y: i32) -> i32 {
    x + y
}

pub(crate) fn point_of_realm<'a>(
    heap: &JsHeap<'a>,
    to: Option<&'a WebOtherPoint>,
) -> Option<&'a WebOtherPoint> {
    if let Some(to) = to {
        to.set_of_realm(heap);
    }
    WebOtherPoint::of_realm(heap)
}

pub(crate) fn describe_mixed<'a>(heap: &JsHeap<'a>, value: WebMixed<'a>) -> String {
    match value {
        WebMixed::Text(_) => "text".into(),
        WebMixed::Number(number) => format!("number {number}"),
        WebMixed::Init(init) => format!("init {}", init.label.len()),
        WebMixed::List(list) => format!("list {}/{}", list.iter().flatten().count(), list.len()),
        WebMixed::Floats(floats) => floats.with_elements(heap, |floats| {
            format!("floats {}", floats.iter().map(|it| it.get()).sum::<f32>())
        }),
        WebMixed::Node(_) => "node".into(),
        WebMixed::Callback(_) => "callback".into(),
    }
}

pub(crate) fn reversed<'a>(
    _: &JsHeap<'a>,
    values: JsList<'a, JsList<'a, WebNodeOrString<'a>>>,
    modes: JsList<'a, WebMode>,
) -> impl Iterator<Item = JSValue> + use<'a> {
    let values = values.iter().rev().flatten().map(|value| match value {
        WebNodeOrString::Node(node) => node.to_js(),
        WebNodeOrString::String(string) => string.to_js(),
    });
    values.chain(
        modes
            .iter()
            .map(|mode| JSValue::from(mode == WebMode::Open)),
    )
}

impl WebGlobalBase {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn who(&self) -> u32 {
        1 + u32::from(self.is_a::<WebGlobal>())
    }
}

impl WebGlobal {
    pub(crate) fn constructor() -> WebGlobalBase {
        WebGlobalBase::default()
    }
}

pub(crate) fn set_global_receiver(heap: &JsHeap<'_>, receiver: &WebGlobal) {
    bindgen::set_global_receiver(heap, receiver);
}

thread_local! {
    static REACTION: RefCell<Option<Strong>> = const { RefCell::new(None) };
}

/// The next member with `ceReactions` calls `target.listeners`.
pub(crate) fn on_reaction(cx: &mut JsScope<'_>, target: &WebTarget) {
    REACTION.set(Some(Strong::create(target.to_js(), cx.global())));
}

pub(crate) mod reactions {
    use super::*;

    pub(crate) fn enter(_: &mut JsScope<'_>) -> Option<Strong> {
        REACTION.take()
    }

    pub(crate) fn leave(cx: &mut JsScope<'_>, mark: Option<Strong>) -> crate::JsResult<()> {
        let target = mark.map_or(JSValue::ZERO, |target| target.get());
        match WebTarget::from_js(&cx.heap, target).and_then(js_WebTarget::listeners) {
            Some(callback) => callback.call(cx.global(), target, &[]).map(|_| ()),
            None => Ok(()),
        }
    }
}

pub(crate) fn dropped_nodes() -> usize {
    DROPPED.load(Ordering::Relaxed)
}

pub(crate) fn kind_of(target: &WebTarget) -> &'static [u8] {
    if target.is_a::<WebLeaf>() {
        b"leaf"
    } else if target.is_a::<WebElement>() {
        b"element"
    } else if target.downcast::<WebNode>().is_some() {
        b"node"
    } else {
        b"target"
    }
}

pub(crate) fn interface_object<'a>(heap: &JsHeap<'a>, name: JsStringImpl<'a>) -> JsLocal<'a> {
    heap.interface_object(name.get())
}

pub(crate) fn call_filter<'a>(
    cx: &mut JsScope<'a>,
    filter: JsLocal<'a, JSObject>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    filter.call_operation(cx, "accept", &[filter.as_value()])
}

pub(crate) fn with_prototype<'a>(
    heap: &JsHeap<'a>,
    prototype: JsLocal<'a, JSObject>,
) -> &'a WebElement {
    js_WebElement::CLASS
        .structure_with_prototype(heap, prototype)
        .create(heap, WebNode::new(b"made"))
}

//! <https://html.spec.whatwg.org/#custom-elements>

use core::cell::{Cell, RefCell, UnsafeCell};
use core::mem::ManuallyDrop;

use bun_jsc::bindgen::{
    self, Callable, ClassStructure, JsAtom, JsHeap, JsInterface, JsLocal, JsScope,
};
use bun_jsc::{JSGlobalObject, JSObject, JSPromise, JSString, JSValue, JsResult};
use smallvec::SmallVec;

use super::gc::global_of;
use super::steps::AttrChange;
use super::{NodeFlags as F, *};
use crate::generated_bindgen::custom::{
    CustomStateSet, ElementDefinitionOptions, js_CustomElementDefinition as js_Definition,
    js_CustomElementRegistry as js_Registry, js_CustomStateSet,
};
use crate::name::{Map, Set};
use crate::tree::State;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Str<'a> = JsLocal<'a, JSString>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

unsafe extern "C" {
    safe fn Bun__DOM__construct(global: &JSGlobalObject, class: JSValue) -> JSValue;
    safe fn Bun__DOM__changePrototype(
        global: &JSGlobalObject,
        object: JSValue,
        prototype: JSValue,
    ) -> JSValue;
    /// Null if it throws.
    safe fn Bun__DOM__functionRealm(
        global: &JSGlobalObject,
        function: JSValue,
    ) -> *const JSGlobalObject;
    /// `sequence<DOMString>`
    safe fn Bun__DOM__toStrings(global: &JSGlobalObject, value: JSValue) -> JSValue;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Callback {
    Connected,
    Disconnected,
    ConnectedMove,
    Adopted,
    AttributeChanged,
    FormAssociated,
    FormReset,
    FormDisabled,
}

const CALLBACKS: [&str; 9] = [
    "connectedCallback",
    "disconnectedCallback",
    "connectedMoveCallback",
    "adoptedCallback",
    "attributeChangedCallback",
    "formAssociatedCallback",
    "formResetCallback",
    "formDisabledCallback",
    "formStateRestoreCallback",
];

pub(crate) struct Definition {
    name: Atom,
    local_name: Atom,
    observed: Set<Atom>,
    is_form_associated: bool,
    disables_internals: bool,
    disables_shadow: bool,
    _interior: bun_jsc::bindgen::Interior,
}

#[derive(Default)]
pub(crate) struct Registry {
    /// Indices in `definitions`, and in `promises`.
    by_name: RefCell<Map<Atom, u32>>,
    waiting: RefCell<Map<Atom, u32>>,
    is_defining: Cell<bool>,
}

// ───────────────────────────── reactions ─────────────────────────────

/// The element queues, one after the other. The elements are protected.
#[thread_local]
static QUEUE: UnsafeCell<ManuallyDrop<Vec<JSValue>>> =
    UnsafeCell::new(ManuallyDrop::new(Vec::new()));

#[inline(always)]
fn with_queue<R>(run: impl FnOnce(&mut Vec<JSValue>) -> R) -> R {
    // SAFETY: nothing that is passed comes back here.
    run(unsafe { &mut *QUEUE.get() })
}

pub(super) fn forget_queue() {
    drop(with_queue(core::mem::take));
}

#[inline(always)]
pub(crate) fn enter(_: &mut JsScope<'_>) -> usize {
    with_queue(|it| it.len())
}

#[inline(always)]
pub(crate) fn leave(cx: &mut JsScope<'_>, mark: usize) -> JsResult<()> {
    if with_queue(|it| it.len()) > mark {
        react(cx, mark);
    }
    Ok(())
}

#[cold]
fn react(cx: &mut JsScope<'_>, mark: usize) {
    for element in with_queue(|it| it.drain(mark..).collect::<SmallVec<[_; 8]>>()) {
        // SAFETY: a protected element.
        run_reactions(cx, unsafe { Node::from_cell(element).cast() });
        element.unprotect();
    }
}

/// At the end of what has not called `enter`.
pub(crate) fn react_now(cx: &mut JsScope<'_>) {
    _ = leave(cx, 0);
}

/// <https://html.spec.whatwg.org/#backup-element-queue>
pub(crate) fn react_later<'a>(cx: Cx<'_, 'a>, agent: &'a Agent) {
    agent.is_backup_queued.set(false);
    react_now(cx);
}

fn run_reactions<'a>(cx: Cx<'_, 'a>, element: &'a Element) {
    let Some(reactions) = element
        .try_edge_list(Edge::Reactions)
        .filter(|it| !it.is_empty())
    else {
        return;
    };
    while !reactions.is_empty() && !cx.global().has_exception() {
        let (callback, argument) = (reactions.get(0), reactions.get(1));
        reactions.remove_range(&cx.heap, 0, 2);
        let Some(definition) = Definition::from_js(&cx.heap, argument) else {
            let arguments: SmallVec<[_; 4]> = List::from_value(argument).values().collect();
            element
                .agent()
                .call_back(cx, callback, element.to_js(), &arguments);
            argument.ensure_still_alive();
            continue;
        };
        if let Err(error) = upgrade(cx, element, definition) {
            definition.report(cx, error);
        }
    }
}

fn add_reaction(heap: &JsHeap<'_>, element: &Element, callback: JSValue, argument: JSValue) {
    let reactions = element.edge_list(heap, Edge::Reactions);
    [callback, argument]
        .into_iter()
        .for_each(|it| reactions.push(heap, it));
}

fn enqueue_element(element: &Element) {
    element.to_js().protect();
    with_queue(|it| it.push(element.to_js()));
    element.agent().queue_backup();
}

/// Whether there is such a callback.
fn add_callback(
    heap: &JsHeap<'_>,
    element: &Element,
    callback: Callback,
    arguments: &[JSValue],
) -> bool {
    let callback = definition_of(element).and_then(|it| it.callback(callback));
    callback
        .map(|it| {
            add_reaction(
                heap,
                element,
                it,
                List::from_fn(heap, arguments.len() as u32, |it| arguments[it as usize]).to_js(),
            )
        })
        .is_some()
}

pub(crate) fn enqueue_callback<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    callback: Callback,
    arguments: &[JSValue],
) {
    if add_callback(&cx.heap, element, callback, arguments) {
        enqueue_element(element);
    }
}

fn enqueue_upgrade(heap: &JsHeap<'_>, element: &Element, definition: &Definition) {
    add_reaction(heap, element, JSValue::NULL, definition.to_js());
    enqueue_element(element);
}

fn attribute_arguments(heap: &JsHeap<'_>, change: &AttrChange<'_>) -> [JSValue; 4] {
    let text = |it: Option<&DomString>| it.map_or(JSValue::NULL, |it| it.to_js(heap).to_js());
    [
        change.name.local.to_js(heap).to_js(),
        text(change.old),
        text(change.new),
        change
            .name
            .ns
            .uri()
            .map_or(JSValue::NULL, |it| it.to_js(heap).to_js()),
    ]
}

pub(crate) fn observes(element: &Element, name: &Atom) -> bool {
    element.has(F::CUSTOM) && definition_of(element).is_some_and(|it| it.observed.contains(name))
}

pub(crate) fn attribute_changed<'a>(cx: Cx<'_, 'a>, element: &'a Element, change: &AttrChange<'_>) {
    if observes(element, &change.name.local) {
        let arguments = attribute_arguments(&cx.heap, change);
        enqueue_callback(cx, element, Callback::AttributeChanged, &arguments);
    }
}

fn hears_of_moves(element: &Element) -> bool {
    definition_of(element).is_some_and(|it| it.callback(Callback::ConnectedMove).is_some())
}

pub(super) fn connected<'a>(cx: Cx<'_, 'a>, element: &'a Element, is_move: bool) {
    if element.has(F::CUSTOM) {
        return enqueue_callback(
            cx,
            element,
            if is_move && hears_of_moves(element) {
                Callback::ConnectedMove
            } else {
                Callback::Connected
            },
            &[],
        );
    }
    if let Some(registry) = element
        .edge(Edge::Registry)
        .and_then(|it| Registry::from_js(&cx.heap, it))
    {
        registry.note_doc(&cx.heap, element.doc());
    }
    try_upgrade(&cx.heap, element);
}

pub(super) fn disconnected<'a>(cx: Cx<'_, 'a>, element: &'a Element, is_move: bool) {
    if !(is_move && hears_of_moves(element)) {
        enqueue_callback(cx, element, Callback::Disconnected, &[]);
    }
}

pub(super) fn adopted<'a>(cx: Cx<'_, 'a>, node: &'a Node, old: &'a Doc) {
    if has_scoped_registries() && (node.is_element() || node.has(F::SHADOW_ROOT)) {
        let own = node.edge(Edge::Registry);
        if own.map_or_else(|| old.registry().is_none(), JSValue::is_null) {
            let stays_null = match node.as_shadow_root() {
                Some(root) => root.is(ShadowFlags::KEEPS_REGISTRY_NULL),
                None => node
                    .parent()
                    .is_some_and(|it| it.edge(Edge::Registry).is_some()),
            };
            set_own_registry(
                &cx.heap,
                node,
                if stays_null {
                    JSValue::NULL
                } else {
                    JSValue::UNDEFINED
                },
            );
        }
    }
    if let Some(element) = node.as_element().filter(|it| it.has(F::CUSTOM)) {
        enqueue_callback(
            cx,
            element,
            Callback::Adopted,
            &[old.to_js(), node.doc().to_js()],
        );
    }
}

// ───────────────────────────── elements ─────────────────────────────

/// Of one that is custom, or precustomized.
pub(crate) fn definition_of(element: &Element) -> Option<&Definition> {
    // SAFETY: what the edge is set to.
    element
        .edge(Edge::Definition)
        .map(|it| unsafe { Definition::from_js_unchecked(it) })
}

pub(crate) fn disables_shadow(element: &Element) -> bool {
    definition_of(element).is_some_and(|it| it.disables_shadow)
}

/// If it has none yet. `Some` says whether it is associated with forms.
pub(crate) fn may_attach_internals(element: &Element) -> Option<bool> {
    let definition =
        definition_of(element).filter(|it| element.is_value().is_none() && !it.disables_internals);
    definition.map(|it| it.is_form_associated)
}

#[derive(Default)]
struct Is(RefCell<Option<Atom>>);

impl Element {
    /// <https://dom.spec.whatwg.org/#concept-element-is-value>
    pub(crate) fn is_value(&self) -> Option<Atom> {
        self.try_extra::<Is>()?.0.borrow().clone()
    }

    pub(crate) fn set_is_value(&self, is: Option<&Atom>) {
        if is.is_some() || self.try_extra::<Is>().is_some() {
            self.extra::<Is>().0.replace(is.cloned());
        }
    }
}

impl Doc {
    /// The global one.
    pub(crate) fn registry(&self) -> Option<&Registry> {
        // SAFETY: what the edge is set to.
        self.edge(Edge::GlobalRegistry)
            .map(|it| unsafe { Registry::from_js_unchecked(it) })
    }

    pub(crate) fn set_registry<'a>(&'a self, heap: &JsHeap<'a>, registry: Option<&'a Registry>) {
        let Some(registry) = registry else {
            return self.clear_edge(heap, Edge::GlobalRegistry);
        };
        js_Registry::set_doc(registry, Some(self));
        self.set_edge(heap, Edge::GlobalRegistry, registry.to_js());
    }

    pub(crate) fn create_registry<'a>(&'a self, heap: &JsHeap<'a>) {
        self.set_registry(
            heap,
            Some(js_Registry::create(self.realm(heap), Registry::default())),
        );
    }
}

pub(crate) fn registry_of(node: &Node) -> Option<&Registry> {
    match node.edge(Edge::Registry) {
        None => node.doc().registry(),
        // SAFETY: it says so.
        Some(own) => Registry::is(own).then(|| unsafe { Registry::from_js_unchecked(own) }),
    }
}

macro_rules! has_registry {
    ($($name:ty)*) => {
        $(impl $name {
            pub(crate) fn get_custom_element_registry(&self) -> Option<&Registry> {
                registry_of(self)
            }
        })*
    };
}
has_registry!(Element ShadowRoot Doc);

impl Node {
    /// A new `body` with the registry of this node.
    pub(crate) fn body_as_context<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Element {
        let body = self.doc().create_html(heap, atom!("body"));
        set_own_registry(heap, body, own_registry(self));
        body
    }
}

pub(crate) fn registry_value(registry: Option<&Registry>) -> JSValue {
    registry.map_or(JSValue::NULL, JsInterface::to_js)
}

/// Undefined if it is that of the document.
pub(crate) fn own_registry(node: &Node) -> JSValue {
    node.edge(Edge::Registry).unwrap_or(JSValue::UNDEFINED)
}

pub(crate) fn set_own_registry(heap: &JsHeap<'_>, node: &Node, registry: JSValue) {
    if registry.is_undefined() {
        node.clear_edge(heap, Edge::Registry)
    } else {
        node.set_edge(heap, Edge::Registry, registry)
    }
}

/// Whether markup has to say that the shadow root does not get that of the document.
pub(crate) fn has_own_registry(root: &ShadowRoot) -> bool {
    let global = root.doc().registry();
    registry_value(registry_of(root)) != registry_value(global)
        || global.is_none() && registry_of(root.doc()).is_some()
}

/// What `own_registry` is for a node of `doc` that has `registry`.
pub(crate) fn as_own_registry(heap: &JsHeap<'_>, registry: JSValue, doc: &Doc) -> JSValue {
    let is_global = registry == registry_value(doc.registry())
        || Registry::from_js(heap, registry).is_some_and(Registry::is_global);
    if is_global {
        JSValue::UNDEFINED
    } else {
        registry
    }
}

/// For the member of a dictionary.
pub(crate) fn registry_option<'a>(
    heap: &JsHeap<'a>,
    value: JSValue,
    doc: &'a Doc,
) -> Result<'a, JSValue> {
    if value.is_undefined() {
        return Ok(registry_value(registry_of(doc)));
    }
    if value.is_null() {
        note_scoped_registry();
        return Ok(value);
    }
    let registry = Registry::from_js(heap, value).ok_or_else(|| {
        heap.type_error(format_args!(
            "The value is not of type 'CustomElementRegistry'."
        ))
    })?;
    if registry.is_global() && value != registry_value(registry_of(doc)) {
        return Err(dom_error(
            heap,
            DomError::NotSupportedError,
            "The registry is that of another document.",
        ));
    }
    Ok(value)
}

pub(crate) fn look_up<'a>(
    registry: Option<&'a Registry>,
    local_name: &Atom,
    is: Option<&Atom>,
) -> Option<&'a Definition> {
    let registry = registry?;
    registry
        .named(local_name)
        .or_else(|| registry.named(is?))
        .filter(|it| it.local_name == *local_name)
}

pub(crate) fn try_upgrade(heap: &JsHeap<'_>, element: &Element) {
    if let Some(definition) = look_up(
        registry_of(element),
        &element.local(),
        element.is_value().as_ref(),
    ) {
        enqueue_upgrade(heap, element, definition);
    }
}

fn become_custom<'a>(cx: Cx<'_, 'a>, element: &'a Element, definition: &'a Definition) {
    element.set_edge(&cx.heap, Edge::Definition, definition.to_js());
    element.unset(F::UNDEFINED);
    element.set(F::CUSTOM);
    element.set_state(cx, State::UNDEFINED, false);
    if definition.is_form_associated {
        seams::make_form_associated(cx, element);
    }
}

/// <https://html.spec.whatwg.org/#upgrades>
fn upgrade<'a>(cx: Cx<'_, 'a>, element: &'a Element, definition: &'a Definition) -> Result<'a> {
    if !element.has(F::UNDEFINED) || element.has(F::FAILED_CUSTOM) {
        return Ok(());
    }
    element.set_edge(&cx.heap, Edge::Definition, definition.to_js());
    element.set(F::FAILED_CUSTOM);
    element.flush_style(cx);
    for (name, value) in element
        .attrs()
        .iter()
        .filter(|it| definition.observed.contains(&it.0.local))
    {
        add_callback(
            &cx.heap,
            element,
            Callback::AttributeChanged,
            &attribute_arguments(
                &cx.heap,
                &AttrChange {
                    name,
                    old: None,
                    new: Some(value),
                },
            ),
        );
    }
    if element.is_connected() {
        add_callback(&cx.heap, element, Callback::Connected, &[]);
    }
    let stack = definition.stack();
    stack.push(&cx.heap, element.to_js());
    let result = match definition.disables_shadow && element.has(F::HOST) {
        true => Err(dom_error(
            &cx.heap,
            DomError::NotSupportedError,
            "The element already has a shadow root.",
        )),
        false => definition.construct(cx, element.agent()),
    };
    stack.remove_range(&cx.heap, stack.len() - 1, 1);
    let result = result.and_then(|it| {
        if it == element.to_js() {
            Ok(())
        } else {
            Err(cx.heap.type_error(format_args!(
                "Custom element constructors have to return this"
            )))
        }
    });
    if result.is_err() {
        element.clear_edge(&cx.heap, Edge::Definition);
        element
            .try_edge_list(Edge::Reactions)
            .into_iter()
            .for_each(|it| it.clear(&cx.heap));
        return result;
    }
    element.unset(F::FAILED_CUSTOM);
    become_custom(cx, element, definition);
    if definition.is_form_associated {
        seams::parent_changed(cx, element, None);
    }
    Ok(())
}

/// Without attributes.
pub(super) fn create_copy<'a>(
    cx: Cx<'_, 'a>,
    of: &'a Element,
    doc: &'a Doc,
    fallback_registry: JSValue,
) -> &'a Element {
    let registry = as_own_registry(
        &cx.heap,
        registry_of(of).map_or(fallback_registry, JsInterface::to_js),
        doc,
    );
    doc.create_element(
        cx,
        of.qual_name(),
        of.is_value().as_ref(),
        Synchronous::No,
        registry,
    )
}

/// The part of <https://dom.spec.whatwg.org/#concept-create-element> for what may be a custom element. `own`: as `own_registry`.
pub(super) fn create<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    name: QualName,
    is: Option<&Atom>,
    synchronous: Synchronous,
    own: JSValue,
) -> &'a Element {
    let registry = if own.is_undefined() {
        doc.registry()
    } else {
        Registry::from_js(&cx.heap, own)
    };
    let definition = look_up(registry, &name.local, is);
    let make_undefined = |cx: Cx<'_, 'a>, element: &'a Element| {
        element.set(F::UNDEFINED);
        element.set_state(cx, State::UNDEFINED, true);
        if !own.is_undefined() {
            set_own_registry(&cx.heap, element, own);
        }
    };
    let Some(definition) =
        definition.filter(|it| synchronous == Synchronous::Yes && it.name == name.local)
    else {
        let element = doc.create_plain(&cx.heap, name);
        make_undefined(cx, element);
        element.set_is_value(is);
        match (definition, synchronous) {
            (None, _) => {}
            (Some(definition), Synchronous::No) => enqueue_upgrade(&cx.heap, element, definition),
            (Some(definition), Synchronous::Yes) => match upgrade(cx, element, definition) {
                Ok(()) => run_reactions(cx, element),
                Err(error) => definition.report(cx, error),
            },
        }
        return element;
    };
    let made = definition.construct(cx, doc.agent()).and_then(|made| {
        let kept = JsLocal::new(&cx.heap, made);
        crate::api::events::microtask_checkpoint(cx);
        let made = kept.to_js();
        let made = Node::from_js(&cx.heap, made)
            .filter(|it| it.kind().is_html())
            .and_then(Node::as_element);
        let made = made.ok_or_else(|| {
            cx.heap.type_error(format_args!(
                "The result must implement HTMLElement interface"
            ))
        })?;
        if made.has_attributes()
            || made.first_child().is_some()
            || made.parent().is_some()
            || made.doc() != doc
            || made.local() != name.local
        {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "The result must be a new element of this document with that name",
            ));
        }
        made.set_is_value(None);
        Ok(made)
    });
    let element = made.unwrap_or_else(|error| {
        definition.report(cx, error);
        let element = doc.create_unknown(&cx.heap, name.local);
        make_undefined(cx, element);
        element.set(F::FAILED_CUSTOM);
        element
    });
    if name.prefix.is_some() {
        element.set_prefix(name.prefix);
    }
    element
}

/// <https://html.spec.whatwg.org/#html-element-constructors>
pub(super) fn construct_html<'a>(
    cx: Cx<'_, 'a>,
    current: &'a Doc,
    new_target: JSValue,
    is_called: impl FnOnce(Cx<'_, 'a>, Kind) -> bool,
) -> Result<'a, &'a Element> {
    let active = current.agent().constructing();
    let definition = (0..active.len())
        .rev()
        .filter_map(|it| Definition::from_js(&cx.heap, active.get(it)))
        .find(|it| it.class() == new_target);
    // Windows that share their interfaces cannot be told from the class that is extended.
    let doc = definition
        .and_then(|it| js_Registry::doc(it.registry()))
        .filter(|it| core::ptr::eq(it.global(), current.global()))
        .unwrap_or(current);
    let definition = definition.or_else(|| doc.registry()?.of_class(new_target));
    let kind_of = |it: &Definition| {
        Some(Kind::of_html(it.local_name.known()))
            .filter(|it| *it != Kind::Unknown)
            .unwrap_or(Kind::HtmlElement)
    };
    let Some(definition) = definition.filter(|it| is_called(cx, kind_of(it))) else {
        return Err(cx.heap.type_error(format_args!("Illegal constructor")));
    };
    let global = cx.global();
    let prototype = match new_target
        .get(global, "prototype")?
        .filter(|it| it.is_object())
    {
        Some(prototype) => prototype,
        None => {
            let realm = bun_jsc::from_js_host_call_generic(global, || {
                Bun__DOM__functionRealm(global, new_target)
            })?;
            // SAFETY: the function holds it.
            let (realm, kind) = (unsafe { &*realm }, kind_of(definition));
            kind.interface().class.prototype(JsHeap::from_global(realm))
        }
    };
    let stack = definition.stack();
    let element = match stack.len().checked_sub(1) {
        None => {
            let element = doc.create_plain(&cx.heap, QualName::html(definition.local_name.clone()));
            element.set_is_value(Some(&definition.name).filter(|it| **it != definition.local_name));
            if !definition.registry().is_global() {
                set_own_registry(&cx.heap, element, definition.registry().to_js());
            }
            become_custom(cx, element, definition);
            element
        }
        Some(last) => {
            let element = Node::from_js(&cx.heap, stack.get(last)).and_then(Node::as_element);
            let element = element.ok_or_else(|| {
                cx.heap
                    .type_error(format_args!("This instance is already constructed"))
            })?;
            stack.set(&cx.heap, last, JSValue::NULL);
            element
        }
    };
    let global = cx.global();
    bun_jsc::call_zero_is_throw(global, || {
        Bun__DOM__changePrototype(global, element.to_js(), prototype)
    })?;
    Ok(element)
}

impl Definition {
    fn class(&self) -> JSValue {
        js_Definition::constructor(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn registry(&self) -> &Registry {
        js_Definition::registry(self).expect("set when it is made")
    }

    fn stack(&self) -> List<'_> {
        List::from_value(js_Definition::stack(self).expect("set when it is made"))
    }

    fn callback(&self, callback: Callback) -> Option<JSValue> {
        Some(List::from_value(js_Definition::callbacks(self)?).get(callback as u32))
            .filter(|it| !it.is_empty() && it.is_cell())
    }

    fn construct<'a>(&'a self, cx: Cx<'_, 'a>, agent: &'a Agent) -> Result<'a, JSValue> {
        let active = agent.constructing();
        active.push(&cx.heap, self.to_js());
        let global = cx.global();
        let made =
            bun_jsc::call_zero_is_throw(global, || Bun__DOM__construct(global, self.class()))
                .map_err(|it| global.take_error(it));
        active.remove_range(&cx.heap, active.len() - 1, 1);
        Ok(made.map_err(|it| cx.global().throw_value(it))?)
    }

    fn report<'a>(&'a self, cx: Cx<'_, 'a>, error: bindgen::Error<'a>) {
        let error = error.into_js_error(cx.global());
        crate::api::events::report_for(cx, self.class(), error);
    }
}

// ───────────────────────────── the registry ─────────────────────────────

fn validate_name<'a>(heap: &JsHeap<'a>, name: &Atom) -> Result<'a> {
    match is_valid_custom_element_name(name) {
        true => Ok(()),
        false => Err(dom_error(
            heap,
            DomError::SyntaxError,
            &format!("\"{}\" is not a valid custom element name", name.as_utf8()),
        )),
    }
}

fn strings_of<'a>(cx: Cx<'_, 'a>, class: JSValue, property: &str) -> Result<'a, Set<Atom>> {
    let global = cx.global();
    let Some(value) = class.get(global, property)? else {
        return Ok(Set::default());
    };
    let strings = List::from_value(bun_jsc::call_zero_is_throw(global, || {
        Bun__DOM__toStrings(global, value)
    })?);
    strings
        .values()
        .filter_map(|it| JsLocal::new(&cx.heap, it).as_string())
        .map(|it| Atom::from_js_string(&cx.heap, it))
        .collect()
}

impl Registry {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
    ) -> &'a Self {
        note_scoped_registry();
        structure.create(heap, Registry::default())
    }

    pub(crate) fn is_global(&self) -> bool {
        js_Registry::doc(self).is_some()
    }

    fn list<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        get: fn(&Self) -> Option<JSValue>,
        set: fn(&Self, JSValue),
    ) -> List<'a> {
        List::from_value(get(self).unwrap_or_else(|| {
            let made = List::new(heap).to_js();
            set(self, made);
            made
        }))
    }

    fn definition(&self, index: u32) -> Option<&Definition> {
        // SAFETY: it has nothing else, and holds them.
        Some(unsafe {
            Definition::from_js_unchecked(
                List::from_value(js_Registry::definitions(self)?).get(index),
            )
        })
    }

    fn named(&self, name: &Atom) -> Option<&Definition> {
        self.definition(*self.by_name.borrow().get(name)?)
    }

    fn of_class(&self, class: JSValue) -> Option<&Definition> {
        self.definition(List::from_value(js_Registry::classes(self)?).position(class)?)
    }

    fn note_doc<'a>(&'a self, heap: &JsHeap<'a>, doc: &'a Doc) {
        let docs = self.list(heap, js_Registry::scoped_docs, js_Registry::set_scoped_docs);
        if !docs.contains(doc.to_js()) {
            docs.push(heap, doc.to_js());
        }
    }

    fn has(&self, node: &Node) -> bool {
        registry_of(node).is_some_and(|it| core::ptr::eq(it, self))
    }

    fn read_definition<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Atom,
        local_name: Atom,
        class: JSValue,
    ) -> Result<'a, &'a Definition> {
        let prototype = class
            .get(cx.global(), "prototype")?
            .filter(|it| it.is_object());
        let prototype = prototype.ok_or_else(|| {
            cx.heap
                .type_error(format_args!("The prototype is not an object"))
        })?;
        let callbacks = List::new(&cx.heap);
        let read = |cx: Cx<'_, 'a>, names: &[&str]| -> Result<'a> {
            for name in names {
                let callback = prototype
                    .get(cx.global(), name)?
                    .unwrap_or(JSValue::UNDEFINED);
                if !callback.is_undefined() && !callback.is_callable() {
                    return Err(cx
                        .heap
                        .type_error(format_args!("\"{name}\" is not a function")));
                }
                callbacks.push(&cx.heap, callback);
            }
            Ok(())
        };
        let (lifecycle, of_forms) = CALLBACKS.split_at(Callback::FormAssociated as usize);
        read(cx, lifecycle)?;
        let observed = if callbacks.get(Callback::AttributeChanged as u32).is_cell() {
            strings_of(cx, class, "observedAttributes")?
        } else {
            Set::default()
        };
        let disabled = strings_of(cx, class, "disabledFeatures")?;
        let is_form_associated = class
            .get(cx.global(), "formAssociated")?
            .is_some_and(JSValue::to_boolean);
        if is_form_associated {
            read(cx, of_forms)?;
        }
        let (disables_internals, disables_shadow) = (
            disabled.contains(&Atom::new("internals")),
            disabled.contains(&Atom::new("shadow")),
        );
        let made = js_Definition::create(
            &cx.heap,
            Definition {
                name,
                local_name,
                observed,
                is_form_associated,
                disables_internals,
                disables_shadow,
                _interior: Default::default(),
            },
        );
        js_Definition::set_registry(made, Some(self));
        js_Definition::set_constructor(made, class);
        js_Definition::set_callbacks(made, callbacks.to_js());
        js_Definition::set_stack(made, List::new(&cx.heap).to_js());
        Ok(made)
    }

    pub(crate) fn define<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: JsAtom<'a>,
        class: JsLocal<'a, Callable>,
        options: &ElementDefinitionOptions<'a>,
    ) -> Result<'a> {
        let (name, class, extends) = (
            Atom::from_impl(name.get()),
            class.to_js(),
            options.extends.map(|it| Atom::from_impl(it.get())),
        );
        let not_supported = |heap: &JsHeap<'a>, message: &str| {
            Err(dom_error(heap, DomError::NotSupportedError, message))
        };
        if !class.is_constructor() {
            return Err(cx
                .heap
                .type_error(format_args!("Argument 2 must be a constructor")));
        }
        validate_name(&cx.heap, &name)?;
        if self.named(&name).is_some() {
            return not_supported(
                &cx.heap,
                &format!(
                    "the name \"{}\" has already been used with this registry",
                    name.as_utf8()
                ),
            );
        }
        if self.of_class(class).is_some() {
            return not_supported(
                &cx.heap,
                "this constructor has already been used with this registry",
            );
        }
        if let Some(extends) = extends
            .as_ref()
            .filter(|it| !self.is_global() || Kind::of_html(it.known()) == Kind::Unknown)
        {
            return not_supported(
                &cx.heap,
                &format!(
                    "\"{}\" is not an element that can be extended",
                    extends.as_utf8()
                ),
            );
        }
        if self.is_defining.replace(true) {
            return not_supported(&cx.heap, "An element is being defined");
        }
        let definition = self.read_definition(
            cx,
            name.clone(),
            extends.unwrap_or_else(|| name.clone()),
            class,
        );
        self.is_defining.set(false);
        let (definition, heap) = (definition?, &cx.heap);
        let definitions = self.list(heap, js_Registry::definitions, js_Registry::set_definitions);
        self.by_name
            .borrow_mut()
            .insert(name.clone(), definitions.len());
        definitions.push(heap, definition.to_js());
        self.list(heap, js_Registry::classes, js_Registry::set_classes)
            .push(heap, class);
        let scoped = js_Registry::scoped_docs(self)
            .filter(|_| !self.is_global())
            .map(List::from_value);
        for doc in js_Registry::doc(self)
            .map(|it| &**it)
            .into_iter()
            .chain(scoped.into_iter().flat_map(List::nodes))
        {
            let candidates = doc
                .shadow_including_objects()
                .filter(|it| it.has(F::UNDEFINED) && self.has(it))
                .filter_map(Node::as_element);
            let is_it = |it: &&Element| {
                it.local() == definition.local_name
                    && (definition.local_name == name || it.is_value().as_ref() == Some(&name))
            };
            candidates
                .filter(is_it)
                .for_each(|it| enqueue_upgrade(heap, it, definition));
        }
        let waiting = self.waiting.borrow_mut().remove(&name);
        if let (Some(index), Some(promises)) =
            (waiting, js_Registry::promises(self).map(List::from_value))
        {
            let promise = promises.get(index);
            promises.set(heap, index, JSValue::UNDEFINED);
            promise.as_promise().map_or(Ok(()), |it| {
                JSPromise::opaque_mut(it).resolve(cx.global(), class)
            })?;
        }
        Ok(())
    }

    pub(crate) fn get<'a>(&'a self, _: &JsHeap<'a>, name: JsAtom<'a>) -> JSValue {
        self.named(&Atom::from_impl(name.get()))
            .map_or(JSValue::UNDEFINED, Definition::class)
    }

    pub(crate) fn get_name<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        class: JsLocal<'a, Callable>,
    ) -> Option<Str<'a>> {
        self.of_class(class.to_js()).map(|it| it.name.to_js(heap))
    }

    pub(crate) fn when_defined<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: JsAtom<'a>,
    ) -> Result<'a, JSValue> {
        let name = Atom::from_impl(name.get());
        validate_name(&cx.heap, &name)?;
        if let Some(definition) = self.named(&name) {
            return Ok(JSPromise::resolved_promise_value(
                cx.global(),
                definition.class(),
            ));
        }
        let promises = self.list(&cx.heap, js_Registry::promises, js_Registry::set_promises);
        let index = *self
            .waiting
            .borrow_mut()
            .entry(name)
            .or_insert_with(|| promises.len());
        if index == promises.len() {
            promises.push(&cx.heap, JSPromise::create(global_of(&cx.heap)).to_js());
        }
        Ok(promises.get(index))
    }

    pub(crate) fn js_upgrade<'a>(&'a self, heap: &JsHeap<'a>, root: &'a Node) {
        root.shadow_including_objects()
            .filter(|it| it.has(F::UNDEFINED) && self.has(it))
            .filter_map(Node::as_element)
            .for_each(|it| try_upgrade(heap, it));
    }

    pub(crate) fn initialize<'a>(&'a self, heap: &JsHeap<'a>, root: &'a Node) -> Result<'a> {
        if self.is_global() && (root.kind().is_document() || !self.has(root.doc())) {
            return Err(dom_error(
                heap,
                DomError::NotSupportedError,
                "A global registry is only for the nodes of its document.",
            ));
        }
        for at in root
            .inclusive_descendants()
            .filter(|it| it.is_element() || it.kind().is_document() || it.has(F::SHADOW_ROOT))
        {
            if registry_of(at).is_none() {
                set_own_registry(
                    heap,
                    at,
                    if self.is_global() {
                        JSValue::UNDEFINED
                    } else {
                        self.to_js()
                    },
                );
                self.note_doc(heap, at.doc());
            }
            if let Some(element) = at
                .as_element()
                .filter(|it| it.has(F::UNDEFINED) && self.has(it))
            {
                try_upgrade(heap, element);
            }
        }
        Ok(())
    }
}

// ───────────────────────────── states ─────────────────────────────

pub(crate) fn state_set<'a>(heap: &JsHeap<'a>, element: &'a Element) -> JSValue {
    element.same_object(heap, Edge::CustomStates, || {
        let made = js_CustomStateSet::create(element.doc().realm(heap), Default::default());
        js_CustomStateSet::set_element(made, Some(element));
        made.to_js()
    })
}

impl CustomStateSet {
    fn show<'a>(&'a self, cx: Cx<'_, 'a>, name: Str<'a>, on: bool) -> Result<'a> {
        let name = DomString::from_js_string(&cx.heap, name)?;
        js_CustomStateSet::element(self)
            .into_iter()
            .for_each(|it| it.set_custom_state(cx, &name.to_utf8(), on));
        Ok(())
    }

    pub(crate) fn add<'a>(&'a self, cx: Cx<'_, 'a>, value: Str<'a>) -> Result<'a, &'a Self> {
        js_CustomStateSet::backing(&cx.heap, self).add(&cx.heap, value.to_js())?;
        self.show(cx, value, true).map(|()| self)
    }

    pub(crate) fn delete<'a>(&'a self, cx: Cx<'_, 'a>, value: Str<'a>) -> Result<'a, bool> {
        self.show(cx, value, false)?;
        js_CustomStateSet::backing(&cx.heap, self).remove(&cx.heap, value.to_js())
    }

    pub(crate) fn clear<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        let all = js_CustomStateSet::backing(&cx.heap, self).values(&cx.heap)?;
        all.iter()
            .filter_map(JsLocal::as_string)
            .try_for_each(|it| self.delete(cx, it).map(|_| ()))
    }
}

pub(crate) trait HtmlConstructor: JsInterface {
    fn construct_html<'a>(
        cx: Cx<'_, 'a>,
        new_target: JsLocal<'a, JSObject>,
    ) -> Result<'a, JSValue> {
        if Self::interface_object(&cx.heap) == new_target.to_js() {
            return Err(cx.heap.type_error(format_args!("Illegal constructor")));
        }
        construct_interface(cx, new_target.to_js(), Self::NUMBER)
    }
}

impl<T: JsInterface<Struct = Node>> HtmlConstructor for T {}

fn construct_interface<'a>(
    cx: Cx<'_, 'a>,
    new_target: JSValue,
    interface: u32,
) -> Result<'a, JSValue> {
    let current = seams::current_document(cx)?;
    let is_called = |_: Cx<'_, 'a>, kind: Kind| kind.interface().number == interface;
    construct_html(cx, current, new_target, is_called).map(|it| it.to_js())
}

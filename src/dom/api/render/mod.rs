//! Components and hooks. Elements have the shape that React's have, so what `Bun.markdown.react()` makes renders too.

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{
    CallbackBody, ClassStructure, CommonProperty, JsHeap, JsInterface, JsLocal, JsScope, Result,
};
use bun_jsc::{JSGlobalObject, JSObject, JSValue};

use crate::api::core::{
    Atom, DomString, Edge, Element, List, Node, Observers, atom, custom, global_of, remove,
};
use crate::generated_bindgen::render::*;
use crate::name::Map;

/// The list in a field, which is made if there is none.
macro_rules! list {
    ($heap:expr, $class:ident::{$get:ident, $set:ident}($object:expr)) => {
        $class::$get($object).map_or_else(
            || {
                let made = List::new($heap);
                $class::$set($object, made.to_js());
                made
            },
            List::from_value,
        )
    };
}

mod classes;
mod elements;
mod fiber;
mod hooks;
mod objects;
mod props;

pub(crate) use classes::Component;
pub(crate) use elements::*;
pub(crate) use fiber::Fiber;
use fiber::Kind;
pub(crate) use hooks::use_layout_effect as use_insertion_effect;
pub(crate) use hooks::*;
use objects::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

#[derive(Clone, Copy)]
enum Symbol {
    Element,
    LegacyElement,
    Fragment,
    StrictMode,
    Suspense,
    Memo,
    ForwardRef,
    Context,
    Portal,
}

const SYMBOLS: [&[u8]; 9] = [
    b"react.transitional.element",
    b"react.element",
    b"react.fragment",
    b"react.strict_mode",
    b"react.suspense",
    b"react.memo",
    b"react.forward_ref",
    b"react.context",
    b"react.portal",
];

pub(crate) struct Renderer {
    /// The field of that name keeps them alive.
    symbols: [JSValue; SYMBOLS.len()],
    hook_index: Cell<u32>,
    next_id: Cell<u32>,
    is_flush_queued: Cell<bool>,
    is_flushing: Cell<bool>,
    /// By whether the element is HTML.
    props: [RefCell<Map<Atom, props::Prop>>; 2],
}

fn fibers<'a>(list: Option<JSValue>) -> impl Iterator<Item = &'a Fiber> {
    // SAFETY: the fields that this is for have lists of nothing else.
    list.into_iter()
        .flat_map(|it| List::from_value(it).values())
        .map(|it| unsafe { Fiber::from_js_unchecked(it) })
}

macro_rules! queues {
    ($($get:ident $set:ident $take:ident;)*) => {
        impl Renderer {
            $(fn $get<'a>(&'a self, heap: &JsHeap<'a>) -> List<'a> {
                list!(heap, js_Renderer::{$get, $set}(self))
            }

            fn $take(&self) -> Option<JSValue> {
                js_Renderer::$get(self).inspect(|_| js_Renderer::$set(self, JSValue::ZERO))
            })*
        }
    };
}

queues! {
    queue set_queue take_queue;
    misplaced set_misplaced take_misplaced;
    doomed set_doomed take_doomed;
    committed set_committed take_committed;
    passive set_passive take_passive;
}

impl Renderer {
    #[inline]
    fn get<'a>(heap: &JsHeap<'a>) -> &'a Renderer {
        Renderer::of_realm(heap).unwrap_or_else(|| Renderer::create(heap))
    }

    #[cold]
    #[optimize(size)]
    fn create<'a>(heap: &JsHeap<'a>) -> &'a Renderer {
        let kept = List::new(heap);
        SYMBOLS
            .into_iter()
            .for_each(|it| kept.push(heap, JSValue::symbol_for(global_of(heap), it)));
        let (hook_index, next_id, is_flush_queued, is_flushing, props) = Default::default();
        let symbols = core::array::from_fn(|it| kept.get(it as u32));
        let renderer = js_Renderer::create(
            heap,
            Renderer {
                symbols,
                hook_index,
                next_id,
                is_flush_queued,
                is_flushing,
                props,
            },
        );
        js_Renderer::set_symbols(renderer, kept.to_js());
        js_Renderer::set_element_structure(renderer, element_structure(heap));
        let callback = |body| {
            heap.create_callback(body, [JSValue::UNDEFINED; 2], 0)
                .to_js()
        };
        js_Renderer::set_flush(
            renderer,
            callback(|cx, _, _, _| {
                Renderer::get(&cx.heap)
                    .flush(cx)
                    .map(|()| JSValue::UNDEFINED)
            }),
        );
        js_Renderer::set_run_passive_effects(
            renderer,
            callback(|cx, _, _, _| {
                Renderer::get(&cx.heap)
                    .run_passive_effects(cx)
                    .map(|()| JSValue::UNDEFINED)
            }),
        );
        js_Renderer::set_restore_controlled(renderer, callback(restore_controlled));
        renderer.set_of_realm(heap);
        renderer
    }

    #[inline]
    fn symbol(&self, symbol: Symbol) -> JSValue {
        self.symbols[symbol as usize]
    }

    fn schedule<'a>(&'a self, heap: &JsHeap<'a>, fiber: &'a Fiber) {
        if fiber.is_unmounted.get() || fiber.is_dirty.replace(true) {
            return;
        }
        self.queue(heap).push(heap, fiber.to_js());
        if !self.is_flush_queued.replace(true) {
            let flush =
                js_Renderer::flush(self).and_then(|it| JsLocal::new(heap, it).as_callable());
            flush
                .into_iter()
                .for_each(|it| heap.queue_microtask(it, JSValue::UNDEFINED));
        }
    }

    fn flush<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        self.is_flush_queued.set(false);
        if js_Renderer::queue(self).is_none() || self.is_flushing.replace(true) {
            return Ok(());
        }
        let outcome = self.render_queue(cx);
        self.is_flushing.set(false);
        outcome
    }

    fn render_queue<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        const MAX_PASSES: u32 = 100;
        for _ in 0..MAX_PASSES {
            if js_Renderer::queue(self).is_none() {
                return Ok(());
            }
            self.run_passive_effects(cx)?;
            let batch = self.take_queue();
            let all: Vec<_> = fibers(batch).collect();
            let mut order: Vec<u64> = all
                .iter()
                .zip(0..)
                .map(|(it, at)| u64::from(it.depth) << 32 | at)
                .collect();
            order.sort_unstable();
            for fiber in order
                .into_iter()
                .map(|it| all[it as u32 as usize])
                .filter(|it| it.is_dirty.get() && !it.is_unmounted.get())
            {
                if let Err(error) = self.update(cx, fiber, fiber.props()) {
                    self.recover(cx, fiber, error)?;
                }
            }
            batch.into_iter().for_each(JSValue::ensure_still_alive);
            // Context consumers below a memoized component. They belong to the same commit.
            if !fibers(js_Renderer::queue(self)).any(|it| it.is_dirty.get()) {
                self.commit(cx)?;
            }
        }
        match self.take_queue() {
            None => Ok(()),
            left => {
                fibers(left).for_each(|it| it.is_dirty.set(false));
                Err(cx.heap.error(format_args!("Too many re-renders. A component sets its state in each render or layout effect.")))
            }
        }
    }

    fn remove_doomed<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(doomed) = self.take_doomed().map(List::from_value) else {
            return;
        };
        for at in (0..doomed.len()).step_by(2) {
            doomed
                .node(at)
                .filter(|it| it.parent() == doomed.node(at + 1))
                .into_iter()
                .for_each(|it| remove(cx, it, Observers::Notify));
        }
        custom::react_now(cx);
    }

    fn commit<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        self.remove_doomed(cx);
        if let Some(misplaced) = self.take_misplaced().map(List::from_value) {
            fibers(Some(misplaced.to_js())).for_each(|it| it.is_misplaced.set(false));
            for parent in (0..misplaced.len())
                .rev()
                .filter_map(|it| Fiber::from_js(&cx.heap, misplaced.get(it)))
                .collect::<Vec<_>>()
            {
                if let Some(node) = parent.node().filter(|_| !parent.is_unmounted.get()) {
                    let nodes = List::new(&cx.heap);
                    parent.visit_nodes(&mut |it| nodes.push(&cx.heap, it.to_js()));
                    props::arrange(cx, node, nodes)?;
                }
            }
            misplaced.to_js().ensure_still_alive();
        }
        let committed = self.take_committed();
        for fiber in fibers(committed).filter(|it| !it.is_unmounted.get()) {
            let Some(element) = fiber.node().and_then(Node::as_element) else {
                continue;
            };
            let is_new = fiber.is_new.take();
            props::set_value(cx, element, fiber.props(), is_new)?;
            if is_new && get(cx, fiber.props(), Key::AutoFocus)?.to_boolean() {
                crate::api::ui::focus::focus(
                    cx,
                    element,
                    crate::api::ui::focus::Cause::Script,
                    Default::default(),
                );
            }
            fiber.attach_ref(cx, element.to_js())?;
        }
        let had_passive = js_Renderer::passive(self).is_some();
        for fiber in fibers(committed).filter(|it| !it.is_unmounted.get() && it.has_effects()) {
            if let Some(waiting) = fiber.waiting_suspense() {
                list!(&cx.heap, js_Fiber::{postponed, set_postponed}(waiting))
                    .push(&cx.heap, fiber.to_js());
                continue;
            }
            self.run_effects(cx, fiber, Timing::Layout)?;
            if js_Fiber::effects(fiber).is_some() {
                self.passive(&cx.heap).push(&cx.heap, fiber.to_js());
            }
        }
        self.remove_doomed(cx);
        match js_Renderer::run_passive_effects(self)
            .filter(|_| !had_passive && js_Renderer::passive(self).is_some())
        {
            Some(run) => call_global(cx, Key::SetImmediate, run),
            None => Ok(()),
        }
    }

    fn run_passive_effects<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        fibers(self.take_passive()).try_for_each(|it| self.run_effects(cx, it, Timing::Passive))?;
        self.remove_doomed(cx);
        Ok(())
    }

    fn run_effects<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        timing: Timing,
    ) -> Result<'a, ()> {
        if let Some(Err(error)) = js_Fiber::instance(fiber).map(|it| it.committed(cx, fiber)) {
            self.recover(cx, fiber, error)?;
        }
        for effect in fiber
            .effects()
            .filter(|it| it.timing == timing && !fiber.is_unmounted.get() && it.is_due.take())
        {
            if let Err(error) = effect.run(cx) {
                self.recover(cx, fiber, error)?;
            }
        }
        Ok(())
    }

    fn settle<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        unsafe extern "C" {
            safe fn Bun__UI__settleIfStarted(global: &JSGlobalObject) -> bool;
        }
        loop {
            self.flush(cx)?;
            self.run_passive_effects(cx)?;
            let global = cx.global();
            bun_jsc::call_false_is_throw(global, || Bun__UI__settleIfStarted(global))?;
            if js_Renderer::queue(self).is_none() && js_Renderer::passive(self).is_none()
                || self.is_flushing.get()
            {
                return Ok(JSValue::UNDEFINED);
            }
        }
    }
}

/// False if it has thrown.
#[unsafe(no_mangle)]
extern "C" fn Bun__Render__flush(global: &JSGlobalObject) -> bool {
    // SAFETY: the event loop is the caller.
    unsafe {
        JsScope::with(global.as_mut_ptr(), |cx| {
            Renderer::of_realm(&cx.heap).is_none_or(|it| {
                it.flush(cx)
                    .map_err(|it| it.into_js_error(cx.global()))
                    .is_ok()
            })
        })
    }
}

#[optimize(size)]
fn restore_controlled<'a>(
    cx: Cx<'_, 'a>,
    _: [JsLocal<'a>; 2],
    _: u64,
    event: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    Renderer::get(&cx.heap).flush(cx)?;
    let event = crate::api::events::Event::from_js(&cx.heap, argument(event, 0));
    let Some(target) = event.and_then(|it| it.target_node()?.as_element()) else {
        return Ok(JSValue::UNDEFINED);
    };
    let group = target.attr(atom!("name")).filter(|it| {
        !it.is_empty()
            && target.with_attr(atom!("type"), |it| it.eq_ignore_ascii_case("radio")) == Some(true)
    });
    let is_in_group = |it: &&Node| {
        it.as_element()
            .is_some_and(|it| it.attr(atom!("name")) == group)
    };
    let controls = match group {
        Some(_) => List::from_nodes(&cx.heap, target.doc().descendants().filter(is_in_group)),
        None => List::from_nodes(&cx.heap, [&**target]),
    };
    for control in controls.nodes().filter_map(Node::as_element) {
        if let Some(fiber) = control
            .edge(Edge::Fiber)
            .and_then(|it| Fiber::from_js(&cx.heap, it))
        {
            props::set_value(cx, control, fiber.props(), false)?;
        }
    }
    Ok(JSValue::UNDEFINED)
}

#[derive(Default)]
pub(crate) struct RenderRoot(bun_jsc::bindgen::Interior);

impl RenderRoot {
    #[optimize(size)]
    pub(crate) fn render<'a>(&'a self, cx: Cx<'_, 'a>, children: JsLocal<'a>) -> Result<'a, ()> {
        self.render_in(cx, children.to_js(), JSValue::NULL)
    }

    pub(crate) fn render_in<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        children: JSValue,
        window: JSValue,
    ) -> Result<'a, ()> {
        let Some((root, container)) =
            js_RenderRoot::fiber(self).and_then(|it| Some((it, it.node()?)))
        else {
            return Ok(());
        };
        js_Fiber::set_props(
            root,
            object(
                cx,
                &[
                    (Key::Container, container.to_js()),
                    (Key::Children, children),
                    (Key::Value, window),
                ],
            )?,
        );
        Renderer::get(&cx.heap).schedule(&cx.heap, root);
        Ok(())
    }

    pub(crate) fn unmount<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let Some(root) = js_RenderRoot::fiber(self).filter(|it| !it.is_unmounted.get()) else {
            return Ok(());
        };
        let renderer = Renderer::get(&cx.heap);
        renderer.unmount(cx, root)?;
        renderer.remove_doomed(cx);
        Ok(())
    }
}

pub(crate) fn create_root<'a>(cx: Cx<'_, 'a>, container: &'a Node) -> Result<'a, &'a RenderRoot> {
    let renderer = Renderer::get(&cx.heap);
    let fiber = Fiber::new(
        &cx.heap,
        Kind::Portal,
        renderer.symbol(Symbol::Portal),
        JSValue::NULL,
        None,
    );
    js_Fiber::set_node(fiber, Some(container));
    if let Some(window) = container.doc().window() {
        let listener = js_Renderer::restore_controlled(renderer)
            .and_then(|it| JsLocal::new(&cx.heap, it).as_any_object());
        window.add_event_listener(&cx.heap, &atom!("input").into(), listener, None)?;
    }
    let root = js_RenderRoot::create(&cx.heap, RenderRoot::default());
    js_RenderRoot::set_fiber(root, Some(fiber));
    Ok(root)
}

pub(crate) fn flush_sync<'a>(cx: Cx<'_, 'a>, callback: JsLocal<'a>) -> Result<'a, JSValue> {
    let outcome = call_if_any(cx, callback.to_js(), JSValue::UNDEFINED, &[]);
    let thrown = match outcome {
        Ok(value) => return Renderer::get(&cx.heap).flush(cx).map(|()| value),
        Err(error) => cx.catch(error)?,
    };
    Renderer::get(&cx.heap).flush(cx)?;
    Err(throw(cx, thrown))
}

/// Runs `callback`, then everything that follows from it: events, renders and effects.
pub(crate) fn act<'a>(cx: Cx<'_, 'a>, callback: JsLocal<'a>) -> Result<'a, JSValue> {
    let result = call_if_any(cx, callback.to_js(), JSValue::UNDEFINED, &[])?;
    if !is_thenable(cx, result)? {
        return Renderer::get(&cx.heap).settle(cx);
    }
    let finish = function(
        &cx.heap,
        |cx, _, _, _| Renderer::get(&cx.heap).settle(cx),
        [JSValue::UNDEFINED; 2],
    );
    invoke(cx, result, Key::Then, &[finish])
}

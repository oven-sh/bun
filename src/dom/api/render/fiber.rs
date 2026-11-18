//! The tree of what is rendered.

use super::*;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Kind {
    /// The props are the text.
    Text,
    Host,
    /// The props may be the array of the children.
    Fragment,
    Portal,
    Suspense,
    Provider,
    Class,
    Memo,
    ForwardRef,
    Function,
}

pub(crate) struct Fiber {
    pub(super) kind: Kind,
    pub(super) depth: u32,
    pub(super) is_new: Cell<bool>,
    pub(super) is_dirty: Cell<bool>,
    /// False from the start of a render to its end, and after one that threw.
    pub(super) is_complete: Cell<bool>,
    pub(super) is_misplaced: Cell<bool>,
    pub(super) is_unmounted: Cell<bool>,
    is_kept: Cell<bool>,
    unmounted_consumers: Cell<u32>,
}

#[derive(PartialEq, Eq, Hash)]
enum Identity {
    Index(i32),
    Key(DomString),
}

impl Identity {
    fn of<'a>(cx: Cx<'_, 'a>, key: JSValue) -> Result<'a, Identity> {
        if key.is_int32() {
            Ok(Identity::Index(key.as_int32()))
        } else {
            string(cx, key).map(Identity::Key)
        }
    }
}

fn set_ref<'a>(cx: Cx<'_, 'a>, reference: JSValue, value: JSValue) -> Result<'a, JSValue> {
    if reference.is_callable() {
        call(cx, reference, JSValue::UNDEFINED, &[value])
    } else {
        set(cx, reference, Key::Current, value).map(|()| JSValue::UNDEFINED)
    }
}

/// What takes it back.
pub(super) fn hand_over<'a>(
    cx: Cx<'_, 'a>,
    reference: JSValue,
    value: JSValue,
) -> Result<'a, JSValue> {
    let cleanup = set_ref(cx, reference, value)?;
    let release: CallbackBody =
        |cx, [reference, _], _, _| set_ref(cx, reference.to_js(), JSValue::NULL);
    Ok(if cleanup.is_callable() {
        cleanup
    } else {
        cx.heap
            .create_callback(release, [reference, JSValue::UNDEFINED], 0)
            .to_js()
    })
}

impl Fiber {
    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        kind: Kind,
        of_type: JSValue,
        key: JSValue,
        parent: Option<&'a Fiber>,
    ) -> &'a Fiber {
        let (is_dirty, is_complete, is_misplaced, is_unmounted, is_kept, unmounted_consumers) =
            Default::default();
        let depth = parent.map_or(0, |it| it.depth + 1);
        let fiber = js_Fiber::create(
            heap,
            Fiber {
                kind,
                depth,
                is_new: Cell::new(true),
                is_dirty,
                is_complete,
                is_misplaced,
                is_unmounted,
                is_kept,
                unmounted_consumers,
            },
        );
        js_Fiber::set_type(fiber, of_type);
        js_Fiber::set_key(fiber, key);
        js_Fiber::set_parent(fiber, parent);
        fiber
    }

    pub(super) fn of_type(&self) -> JSValue {
        js_Fiber::r#type(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn key(&self) -> JSValue {
        js_Fiber::key(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(super) fn props(&self) -> JSValue {
        js_Fiber::props(self).unwrap_or(JSValue::UNDEFINED)
    }

    /// Of a host element or a text. For a portal or a root, the container, which it does not own.
    pub(super) fn node(&self) -> Option<&Node> {
        js_Fiber::node(self)
    }

    pub(super) fn children(&self) -> impl Iterator<Item = &Fiber> {
        fibers(js_Fiber::children(self))
    }

    pub(super) fn ancestors(&self) -> impl Iterator<Item = &Fiber> {
        core::iter::successors(js_Fiber::parent(self), |it| js_Fiber::parent(it))
    }

    pub(super) fn effects(&self) -> impl Iterator<Item = &EffectHook> {
        // SAFETY: nothing else is put in the list.
        js_Fiber::effects(self)
            .into_iter()
            .flat_map(|it| List::from_value(it).values())
            .map(|it| unsafe { EffectHook::from_js_unchecked(it) })
    }

    pub(super) fn has_effects(&self) -> bool {
        js_Fiber::effects(self).is_some() || self.kind == Kind::Class
    }

    fn host(&self) -> Option<&Fiber> {
        core::iter::once(self)
            .chain(self.ancestors())
            .find(|it| it.node().is_some())
    }

    pub(super) fn waiting_suspense(&self) -> Option<&Fiber> {
        let children = core::iter::once(self).chain(self.ancestors());
        self.ancestors()
            .zip(children)
            .find(|(parent, child)| {
                js_Fiber::fallback(parent).is_some_and(|it| !core::ptr::eq(it, *child))
            })
            .map(|it| it.0)
    }

    /// Those that go into the node of the host.
    pub(super) fn visit_nodes<'a>(&'a self, visit: &mut dyn FnMut(&'a Node)) {
        let shown = js_Fiber::fallback(self).into_iter().chain(
            self.children()
                .take_while(|_| js_Fiber::fallback(self).is_none()),
        );
        for child in shown.filter(|it| it.kind != Kind::Portal) {
            match child.node() {
                Some(node) => visit(node),
                None => child.visit_nodes(visit),
            }
        }
    }

    fn wanted_ref<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Option<JSValue>> {
        Ok(Some(get(cx, self.props(), Key::Ref)?).filter(|it| !it.is_undefined_or_null()))
    }

    pub(super) fn attach_ref<'a>(&'a self, cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, ()> {
        let wanted = self.wanted_ref(cx)?;
        if wanted != js_Fiber::r#ref(self) {
            self.release_ref(cx)?;
            js_Fiber::set_ref(self, wanted.unwrap_or_default());
            js_Fiber::set_release_ref(
                self,
                wanted.map_or(Ok(JSValue::ZERO), |it| hand_over(cx, it, value))?,
            );
        }
        Ok(())
    }

    fn release_ref<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let Some(release) = js_Fiber::release_ref(self) else {
            return Ok(());
        };
        js_Fiber::set_release_ref(self, JSValue::ZERO);
        call(cx, release, JSValue::UNDEFINED, &[]).map(drop)
    }

    fn consumer_unmounted<'a>(&'a self, heap: &JsHeap<'a>) {
        let Some(consumers) = js_Fiber::consumers(self).map(List::from_value) else {
            return;
        };
        self.unmounted_consumers.update(|it| it + 1);
        if self.unmounted_consumers.get() * 2 > consumers.len() && !self.is_unmounted.get() {
            let left = List::new(heap);
            fibers(Some(consumers.to_js()))
                .filter(|it| !it.is_unmounted.get())
                .for_each(|it| left.push(heap, it.to_js()));
            js_Fiber::set_consumers(self, left.to_js());
            self.unmounted_consumers.set(0);
        }
    }

    pub(super) fn read_context<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        context: JSValue,
    ) -> Result<'a, JSValue> {
        let Some(provider) = self.ancestors().find(|it| it.of_type() == context) else {
            return get(cx, context, Key::DefaultValue);
        };
        let providers = list!(&cx.heap, js_Fiber::{providers, set_providers}(self));
        if !providers.contains(provider.to_js()) {
            providers.push(&cx.heap, provider.to_js());
            list!(&cx.heap, js_Fiber::{consumers, set_consumers}(provider))
                .push(&cx.heap, self.to_js());
        }
        get(cx, provider.props(), Key::Value)
    }
}

pub(super) fn is_class<'a>(cx: Cx<'_, 'a>, of_type: JSValue) -> Result<'a, bool> {
    let (component, mut at) = (js_RenderComponent::CLASS.constructor(&cx.heap), of_type);
    while at.is_callable() && at != component {
        at = at.get_prototype(cx.global())?;
    }
    Ok(at == component)
}

fn report<'a>(cx: Cx<'_, 'a>, outcome: Result<'a, ()>) -> Result<'a, ()> {
    outcome.or_else(|error| {
        cx.catch(error)
            .and_then(|it| call_global(cx, Key::ReportError, it))
    })
}

impl Renderer {
    fn place<'a>(&'a self, heap: &JsHeap<'a>, fiber: &'a Fiber) {
        if let Some(host) = fiber.host().filter(|it| !it.is_misplaced.replace(true)) {
            self.misplaced(heap).push(heap, host.to_js());
        }
    }

    /// Takes what `fiber` shows out of the node of its host, in the next commit.
    fn hide_contents<'a>(&'a self, heap: &JsHeap<'a>, fiber: &'a Fiber) {
        fiber.visit_nodes(&mut |it| self.doom(heap, it));
    }

    fn doom<'a>(&'a self, heap: &JsHeap<'a>, node: &'a Node) {
        if let Some(parent) = node.parent() {
            [node, parent]
                .into_iter()
                .for_each(|it| self.doomed(heap).push(heap, it.to_js()));
        }
    }

    fn discard<'a>(&'a self, cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, ()> {
        match fiber.node() {
            _ if fiber.kind == Kind::Portal => {}
            Some(node) => self.doom(&cx.heap, node),
            None => self.hide_contents(&cx.heap, fiber),
        }
        self.unmount(cx, fiber)
    }

    pub(super) fn unmount<'a>(&'a self, cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, ()> {
        fiber.is_unmounted.set(true);
        if let Some(instance) = js_Fiber::instance(fiber) {
            let outcome = instance.will_unmount(cx);
            report(cx, outcome)?;
        }
        for effect in fiber.effects() {
            let outcome = effect.clean_up(cx);
            report(cx, outcome)?;
        }
        let outcome = fiber.release_ref(cx);
        report(cx, outcome)?;
        fibers(js_Fiber::providers(fiber)).for_each(|it| it.consumer_unmounted(&cx.heap));
        if fiber.kind == Kind::Portal {
            self.hide_contents(&cx.heap, fiber);
        }
        fiber
            .children()
            .chain(js_Fiber::fallback(fiber))
            .try_for_each(|it| self.unmount(cx, it))
    }

    pub(super) fn unmount_children<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
    ) -> Result<'a, ()> {
        let children = js_Fiber::children(fiber);
        js_Fiber::set_children(fiber, JSValue::ZERO);
        fibers(children).try_for_each(|it| self.discard(cx, it))
    }

    fn kind_of<'a>(&'a self, cx: Cx<'_, 'a>, of_type: JSValue) -> Result<'a, Kind> {
        if of_type.is_string_literal() {
            return Ok(Kind::Host);
        }
        if of_type.is_callable() {
            return Ok(if is_class(cx, of_type)? {
                Kind::Class
            } else {
                Kind::Function
            });
        }
        let name = if of_type.is_symbol() {
            of_type
        } else {
            get(cx, of_type, Key::Kind)?
        };
        let kinds = [
            (Symbol::Fragment, Kind::Fragment),
            (Symbol::Portal, Kind::Portal),
            (Symbol::Suspense, Kind::Suspense),
            (Symbol::Context, Kind::Provider),
            (Symbol::Memo, Kind::Memo),
            (Symbol::ForwardRef, Kind::ForwardRef),
        ];
        Ok(kinds
            .into_iter()
            .find(|it| self.symbol(it.0) == name)
            .map_or(Kind::Function, |it| it.1))
    }

    /// The type, which is empty for a text, the key and the props.
    fn describe<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JSValue,
        index: u32,
    ) -> Result<'a, Option<[JSValue; 3]>> {
        let (index, fragment) = (
            JSValue::js_number_from_int32(index as i32),
            self.symbol(Symbol::Fragment),
        );
        if !value.is_object() {
            if value.is_undefined_or_null()
                || value.is_boolean()
                || value.is_string_literal() && !value.to_boolean()
            {
                return Ok(None);
            }
            return Ok(Some([
                JSValue::NULL,
                index,
                if value.is_string_literal() {
                    value
                } else {
                    value.to_js_string(cx.global())?.to_js()
                },
            ]));
        }
        if value.is_callable() {
            return Err(cx.heap.type_error(format_args!(
                "A function cannot be rendered. Write <Component /> to render one."
            )));
        }
        if value.is_array() {
            return Ok(Some([fragment, index, value]));
        }
        if let Some([kind, of_type, key, mut props]) = self.read_element(cx, value)? {
            let reference = if kind == self.symbol(Symbol::LegacyElement) {
                get(cx, value, Key::Ref)?
            } else {
                JSValue::NULL
            };
            if reference.to_boolean() {
                props = spread(cx, props, JSValue::UNDEFINED, None)?;
                set(cx, props, Key::Ref, reference)?;
            }
            let key = if key.is_undefined_or_null() {
                index
            } else {
                key.to_js_string(cx.global())?.to_js()
            };
            return Ok(Some([
                if of_type == self.symbol(Symbol::StrictMode) {
                    fragment
                } else {
                    of_type
                },
                key,
                props,
            ]));
        }
        if is_iterable(cx, value)? {
            return Ok(Some([
                fragment,
                index,
                listed(cx, value).and_then(|it| exposed(cx, it))?,
            ]));
        }
        let keys = value.keys(cx.global())?;
        let keys = string(cx, keys)?;
        Err(cx.heap.type_error(format_args!(
            "An object cannot be rendered. It has the keys {{{}}}.",
            keys.to_utf8()
        )))
    }

    pub(super) fn reconcile<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        parent: &'a Fiber,
        rendered: JSValue,
    ) -> Result<'a, ()> {
        cx.check_stack()?;
        let (is_list, previous) = (
            rendered.is_array(),
            js_Fiber::children(parent).map(List::from_value),
        );
        let (count, known) = (
            if is_list {
                rendered.get_length(cx.global())? as u32
            } else {
                1
            },
            previous.map_or(0, List::len),
        );
        // SAFETY: nothing else is put in the list.
        let old = |index| previous.map(|it| unsafe { Fiber::from_js_unchecked(it.get(index)) });
        let (mut cursor, mut next, mut by_identity) =
            (0, None::<List<'a>>, None::<Map<Identity, u32>>);
        for index in 0..count {
            let value = if is_list {
                rendered.get_index(cx.global(), index)?
            } else {
                rendered
            };
            let Some([of_type, key, props]) = self.describe(cx, value, index)? else {
                continue;
            };
            if let Some(candidate) = (next.is_none() && cursor < known)
                .then(|| old(cursor))
                .flatten()
                && is_same(cx, candidate.key(), key)?
                && is_same(cx, candidate.of_type(), of_type)?
            {
                js_Fiber::set_next_props(candidate, props);
                cursor += 1;
                continue;
            }
            let next = *next.get_or_insert_with(|| {
                let made = List::with_capacity(&cx.heap, count.min(1024));
                (0..cursor)
                    .filter_map(old)
                    .for_each(|it| made.push(&cx.heap, it.to_js()));
                made
            });
            if by_identity.is_none() && cursor < known {
                let all = by_identity.insert(Map::default());
                for (at, fiber) in (cursor..known).filter_map(|it| Some((it, old(it)?))) {
                    fiber.is_kept.set(false);
                    all.entry(Identity::of(cx, fiber.key())?).or_insert(at);
                }
            }
            let found = match &by_identity {
                Some(all) => all
                    .get(&Identity::of(cx, key)?)
                    .and_then(|it| old(*it))
                    .filter(|it| !it.is_kept.get()),
                None => None,
            };
            let fiber = match found {
                Some(found) if is_same(cx, found.of_type(), of_type)? => {
                    found.is_kept.set(true);
                    found
                }
                _ => {
                    let kind = if of_type.is_null() && props.is_string_literal() {
                        Kind::Text
                    } else {
                        self.kind_of(cx, of_type)?
                    };
                    Fiber::new(&cx.heap, kind, of_type, key, Some(parent))
                }
            };
            js_Fiber::set_next_props(fiber, props);
            next.push(&cx.heap, fiber.to_js());
        }
        if next.is_some() || cursor < known {
            let next = next.unwrap_or_else(|| {
                List::from_fn(&cx.heap, cursor, |it| {
                    old(it).map_or(JSValue::UNDEFINED, Fiber::to_js)
                })
            });
            // Before anything can throw, so that `unmount` finds every fiber.
            js_Fiber::set_children(parent, next.to_js());
            self.place(&cx.heap, parent);
            (cursor..known)
                .filter_map(old)
                .filter(|it| by_identity.is_none() || !it.is_kept.get())
                .try_for_each(|it| self.discard(cx, it))?;
        }
        for fiber in parent.children() {
            let props = js_Fiber::next_props(fiber).unwrap_or(JSValue::UNDEFINED);
            if !(fiber.is_complete.get()
                && !fiber.is_dirty.get()
                && is_unchanged(cx, fiber, props)?)
            {
                self.update(cx, fiber, props)?;
            }
        }
        Ok(())
    }

    fn reconcile_children<'a>(&'a self, cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, ()> {
        let children = if fiber.props().is_array() {
            fiber.props()
        } else {
            get(cx, fiber.props(), Key::Children)?
        };
        self.reconcile(cx, fiber, children)
    }

    pub(super) fn update<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        props: JSValue,
    ) -> Result<'a, ()> {
        let previous = js_Fiber::props(fiber).unwrap_or(props);
        js_Fiber::set_props(fiber, props);
        fiber.is_dirty.set(false);
        fiber.is_complete.set(false);
        match fiber.kind {
            Kind::Text => {
                let text = string(cx, props)?;
                match fiber.node().and_then(Node::as_character_data) {
                    Some(node) => node.replace_all_data(cx, &text),
                    None => js_Fiber::set_node(
                        fiber,
                        fiber
                            .host()
                            .and_then(Fiber::node)
                            .map(|it| &***it.doc().create_text(&cx.heap, text)),
                    ),
                }
            }
            Kind::Host => self.update_host(cx, fiber, previous)?,
            Kind::Fragment => self.reconcile_children(cx, fiber)?,
            Kind::Portal => {
                let container = get(cx, props, Key::Container)?;
                let Some(container) = Node::from_js(&cx.heap, container) else {
                    return Err(cx
                        .heap
                        .type_error(format_args!("The container of a portal is not a node.")));
                };
                if fiber.node() != Some(container) {
                    js_Fiber::set_node(fiber, Some(container));
                    self.place(&cx.heap, fiber);
                }
                self.reconcile_children(cx, fiber)?;
            }
            Kind::Suspense => self.update_suspense(cx, fiber)?,
            Kind::Provider => {
                let (old, new) = (get(cx, previous, Key::Value)?, get(cx, props, Key::Value)?);
                if !is_same(cx, old, new)? {
                    fibers(js_Fiber::consumers(fiber)).for_each(|it| self.schedule(&cx.heap, it));
                }
                self.reconcile_children(cx, fiber)?;
            }
            Kind::Class => self.update_class(cx, fiber, previous)?,
            Kind::Memo | Kind::ForwardRef | Kind::Function => {
                let rendered = self.render_function(cx, fiber)?;
                self.reconcile(cx, fiber, rendered)?;
                if fiber.has_effects() {
                    self.committed(&cx.heap).push(&cx.heap, fiber.to_js());
                }
            }
        }
        fiber.is_complete.set(true);
        Ok(())
    }

    fn update_host<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        mut previous: JSValue,
    ) -> Result<'a, ()> {
        let element = match fiber.node().and_then(Node::as_element) {
            Some(known) => known,
            None => {
                let (Some(parent), name) = (
                    fiber.host().and_then(Fiber::node),
                    Atom::from_string(&string(cx, fiber.of_type())?),
                ) else {
                    return Ok(());
                };
                let made = props::create_element(cx, name, parent);
                js_Fiber::set_node(fiber, Some(made));
                if props::is_control(made) {
                    made.set_edge(&cx.heap, Edge::Fiber, fiber.to_js());
                }
                previous = JSValue::UNDEFINED;
                made
            }
        };
        self.set_props(cx, fiber, element, previous)?;
        self.reconcile_children(cx, fiber)?;
        if props::is_control(element)
            || fiber.wanted_ref(cx)? != js_Fiber::r#ref(fiber)
            || fiber.is_new.get() && get(cx, fiber.props(), Key::AutoFocus)?.to_boolean()
        {
            self.committed(&cx.heap).push(&cx.heap, fiber.to_js());
        } else {
            fiber.is_new.set(false);
        }
        Ok(())
    }

    fn render_function<'a>(&'a self, cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, JSValue> {
        let (mut function, mut arguments) = (fiber.of_type(), [fiber.props(), JSValue::UNDEFINED]);
        if fiber.kind == Kind::Memo {
            function = get(cx, function, Key::Type)?;
            if !function.is_callable() || is_class(cx, function)? {
                return Ok(self.element(&cx.heap, function, JSValue::NULL, arguments[0]));
            }
        } else if fiber.kind == Kind::ForwardRef {
            function = get(cx, function, Key::Render)?;
            arguments = [
                spread(cx, arguments[0], JSValue::UNDEFINED, Some(Key::Ref))?,
                fiber.wanted_ref(cx)?.unwrap_or(JSValue::NULL),
            ];
        }
        if !function.is_callable() {
            let name = function.js_type_string(cx.global()).to_owned_slice();
            return Err(cx.heap.type_error(format_args!(
                "An element's type is a string or a component, not {}",
                crate::values::text(&name)
            )));
        }
        js_Renderer::set_current(self, Some(fiber));
        self.hook_index.set(0);
        let rendered = call(
            cx,
            function,
            JSValue::UNDEFINED,
            &arguments[..1 + usize::from(fiber.kind == Kind::ForwardRef)],
        );
        js_Renderer::set_current(self, None);
        rendered
    }

    fn update_suspense<'a>(&'a self, cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, ()> {
        if let Err(error) = self.reconcile_children(cx, fiber) {
            let thrown = cx.catch(error)?;
            return if is_thenable(cx, thrown)? {
                self.suspend(cx, fiber, thrown)
            } else {
                Err(throw(cx, thrown))
            };
        }
        let Some(fallback) = js_Fiber::fallback(fiber) else {
            return Ok(());
        };
        self.discard(cx, fallback)?;
        js_Fiber::set_fallback(fiber, None);
        fibers(js_Fiber::postponed(fiber))
            .for_each(|it| self.committed(&cx.heap).push(&cx.heap, it.to_js()));
        js_Fiber::set_postponed(fiber, JSValue::ZERO);
        self.place(&cx.heap, fiber);
        Ok(())
    }

    /// The children keep their state meanwhile.
    fn suspend<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        thenable: JSValue,
    ) -> Result<'a, ()> {
        let retry = rerender(&cx.heap, fiber);
        invoke(cx, thenable, Key::Then, &[retry, retry])?;
        let fallback = js_Fiber::fallback(fiber).unwrap_or_else(|| {
            self.hide_contents(&cx.heap, fiber);
            Fiber::new(
                &cx.heap,
                Kind::Fragment,
                self.symbol(Symbol::Fragment),
                JSValue::NULL,
                Some(fiber),
            )
        });
        js_Fiber::set_fallback(fiber, Some(fallback));
        let shown = get(cx, fiber.props(), Key::Fallback).and_then(|it| array(cx, &[it]))?;
        self.update(cx, fallback, shown)?;
        self.place(&cx.heap, fiber);
        Ok(())
    }

    /// For what is thrown where no `update` of an ancestor is on the stack.
    #[cold]
    #[optimize(size)]
    pub(super) fn recover<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        error: bun_jsc::bindgen::Error<'a>,
    ) -> Result<'a, ()> {
        let (mut thrown, mut child) = (cx.catch(error)?, fiber);
        for parent in fiber.ancestors() {
            match self.handle(cx, parent, child, thrown) {
                Ok(true) => return Ok(()),
                Ok(false) => {}
                Err(error) => thrown = cx.catch(error)?,
            }
            child = parent;
        }
        self.unmount_children(cx, child)?;
        if is_thenable(cx, thrown)? {
            let error = cx.heap.error(format_args!(
                "A component suspended outside of a <Suspense>"
            ));
            thrown = cx.catch(error)?;
        }
        call_global(cx, Key::ReportError, thrown)
    }

    fn handle<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        parent: &'a Fiber,
        child: &'a Fiber,
        thrown: JSValue,
    ) -> Result<'a, bool> {
        if is_thenable(cx, thrown)? {
            // The way back down, for the retry.
            child.is_complete.set(false);
            let waits = parent.kind == Kind::Suspense
                && !js_Fiber::fallback(parent).is_some_and(|it| core::ptr::eq(it, child));
            return if waits {
                self.suspend(cx, parent, thrown).map(|()| true)
            } else {
                Ok(false)
            };
        }
        let Some(boundary) = classes::boundary(cx, parent)? else {
            return Ok(false);
        };
        self.caught(cx, parent, boundary, thrown)?;
        self.schedule(&cx.heap, parent);
        Ok(true)
    }
}

fn rerender<'a>(heap: &JsHeap<'a>, fiber: &'a Fiber) -> JSValue {
    let body: CallbackBody = |cx, [fiber, _], _, _| {
        Fiber::from_js(&cx.heap, fiber.to_js())
            .into_iter()
            .for_each(|it| Renderer::get(&cx.heap).schedule(&cx.heap, it));
        Ok(JSValue::UNDEFINED)
    };
    function(heap, body, [fiber.to_js(), JSValue::UNDEFINED])
}

fn is_unchanged<'a>(cx: Cx<'_, 'a>, fiber: &'a Fiber, props: JSValue) -> Result<'a, bool> {
    let old = fiber.props();
    match fiber.kind {
        _ if old == props => Ok(true),
        Kind::Text => is_same(cx, old, props),
        Kind::Memo => match get(cx, fiber.of_type(), Key::Compare)? {
            compare if compare.is_undefined_or_null() => are_shallow_equal(cx, old, props),
            compare => {
                call(cx, compare, JSValue::UNDEFINED, &[old, props]).map(JSValue::to_boolean)
            }
        },
        _ => Ok(false),
    }
}

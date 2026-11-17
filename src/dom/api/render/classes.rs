//! Components that are classes.

use super::*;

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    struct Is: u16 {
        const FORCED = 1;
        /// It caught an error, and has no state yet to render it with.
        const FAILED = 1 << 1;
        const MOUNTED = 1 << 2;
        const DUE = 1 << 3;
        const UPDATED = 1 << 4;
    }
}

#[derive(Default)]
pub(crate) struct Component(Cell<Is>);

impl Component {
    fn set(&self, flags: Is, value: bool) {
        self.0
            .update(|it| if value { it | flags } else { it - flags });
    }

    fn take(&self, flag: Is) -> bool {
        self.0.replace(self.0.get() - flag).contains(flag)
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        props: JsLocal<'a>,
    ) -> Result<'a, &'a Self> {
        let made = structure.create(&cx.heap, Component::default());
        set(cx, made.to_js(), Key::Props, props.to_js()).map(|()| made)
    }

    fn add_callback<'a>(&'a self, heap: &JsHeap<'a>, callback: JSValue) {
        list!(heap, js_RenderComponent::{callbacks, set_callbacks}(self)).push(heap, callback);
    }

    fn add_state<'a>(&'a self, heap: &JsHeap<'a>, state: JSValue) {
        list!(heap, js_RenderComponent::{pending, set_pending}(self)).push(heap, state);
    }

    pub(crate) fn set_state<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        state: JsLocal<'a>,
        callback: JsLocal<'a>,
    ) {
        self.add_state(heap, state.to_js());
        self.set(Is::FAILED, false);
        if callback.to_js().to_boolean() {
            self.add_callback(heap, callback.to_js());
        }
        js_RenderComponent::fiber(self)
            .into_iter()
            .for_each(|it| Renderer::get(heap).schedule(heap, it));
    }

    pub(crate) fn force_update<'a>(&'a self, heap: &JsHeap<'a>, callback: JsLocal<'a>) {
        self.set(Is::FORCED, true);
        self.set_state(heap, JsLocal::new(heap, JSValue::NULL), callback);
    }

    /// None if it need not.
    #[optimize(size)]
    fn render<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        is_mounting: bool,
    ) -> Result<'a, Option<JSValue>> {
        let (this, class, props) = (self.to_js(), fiber.of_type(), fiber.props());
        let (mut state, pending) = (
            get(cx, this, Key::State)?,
            js_RenderComponent::pending(self),
        );
        js_RenderComponent::set_pending(self, JSValue::ZERO);
        for change in pending
            .into_iter()
            .flat_map(|it| List::from_value(it).values())
        {
            let change = if change.is_callable() {
                call(cx, change, this, &[state, props])?
            } else {
                change
            };
            state = spread(cx, state, change, None)?;
        }
        let derive = get(cx, class, Key::GetDerivedStateFromProps)?;
        if derive.to_boolean() {
            let derived = call(cx, derive, class, &[props, state])?;
            state = spread(cx, state, derived, None)?;
        }
        let context_type = get(cx, class, Key::ContextType)?;
        let context = if context_type.to_boolean() {
            fiber.read_context(cx, context_type)?
        } else {
            context_type
        };
        let old_context = get(cx, this, Key::Context)?;
        let renders = is_mounting
            || self.0.get().contains(Is::FORCED)
            || !is_same(cx, context, old_context)?
            || fiber.children().any(|it| !it.is_complete.get())
            || invoke(
                cx,
                this,
                Key::ShouldComponentUpdate,
                &[props, state, context],
            )? != JSValue::FALSE;
        [
            (Key::Props, props),
            (Key::State, state),
            (Key::Context, context),
        ]
        .into_iter()
        .try_for_each(|it| set(cx, this, it.0, it.1))?;
        self.set(Is::FORCED, false);
        match renders {
            false => Ok(None),
            true if self.0.get().contains(Is::FAILED) => Ok(Some(JSValue::NULL)),
            true => get(cx, this, Key::Render)
                .and_then(|it| call(cx, it, this, &[]))
                .map(Some),
        }
    }

    pub(super) fn committed<'a>(&'a self, cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, ()> {
        let this = self.to_js();
        if !self.take(Is::DUE) {
            return Ok(());
        }
        if !self.0.get().contains(Is::MOUNTED) {
            invoke(cx, this, Key::ComponentDidMount, &[])?;
            self.set(Is::MOUNTED, true);
        }
        if fiber.is_unmounted.get() {
            return Ok(());
        }
        fiber.attach_ref(cx, this)?;
        if let Some(previous) = js_Fiber::hooks(fiber)
            .map(List::from_value)
            .filter(|_| self.take(Is::UPDATED))
        {
            invoke(
                cx,
                this,
                Key::ComponentDidUpdate,
                &[previous.get(0), previous.get(1)],
            )?;
        }
        let callbacks = js_RenderComponent::callbacks(self);
        js_RenderComponent::set_callbacks(self, JSValue::ZERO);
        callbacks
            .into_iter()
            .flat_map(|it| List::from_value(it).values())
            .try_for_each(|it| call(cx, it, this, &[]).map(drop))
    }

    pub(super) fn will_unmount<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        if self.take(Is::MOUNTED) {
            invoke(cx, self.to_js(), Key::ComponentWillUnmount, &[]).map(drop)
        } else {
            Ok(())
        }
    }
}

impl PureComponent {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        props: JsLocal<'a>,
    ) -> Result<'a, &'a Self> {
        let made = structure.create(&cx.heap, Component::default());
        set(cx, made.to_js(), Key::Props, props.to_js()).map(|()| made)
    }

    pub(crate) fn should_component_update<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        props: JsLocal<'a>,
        state: JsLocal<'a>,
    ) -> Result<'a, bool> {
        let (old_props, old_state) = (
            get(cx, self.to_js(), Key::Props)?,
            get(cx, self.to_js(), Key::State)?,
        );
        Ok(!are_shallow_equal(cx, old_props, props.to_js())?
            || !are_shallow_equal(cx, old_state, state.to_js())?)
    }
}

pub(super) fn boundary<'a>(cx: Cx<'_, 'a>, fiber: &'a Fiber) -> Result<'a, Option<&'a Component>> {
    let Some(instance) = js_Fiber::instance(fiber) else {
        return Ok(None);
    };
    let catches = get(cx, fiber.of_type(), Key::GetDerivedStateFromError)?.to_boolean()
        || get(cx, instance.to_js(), Key::ComponentDidCatch)?.to_boolean();
    Ok(catches.then_some(instance))
}

impl Renderer {
    pub(super) fn caught<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        instance: &'a Component,
        error: JSValue,
    ) -> Result<'a, ()> {
        self.unmount_children(cx, fiber)?;
        let state = invoke(cx, fiber.of_type(), Key::GetDerivedStateFromError, &[error])?;
        match state.to_boolean() {
            true => instance.add_state(&cx.heap, state),
            false => instance.set(Is::FAILED, true),
        }
        instance.set(Is::FORCED, true);
        let tell: CallbackBody = |cx, [instance, error], _, _| {
            let empty = JSValue::js_empty_string(cx.global());
            let info = object(cx, &[(Key::ComponentStack, empty)])?;
            invoke(
                cx,
                instance.to_js(),
                Key::ComponentDidCatch,
                &[error.to_js(), info],
            )
        };
        instance.add_callback(
            &cx.heap,
            cx.heap
                .create_callback(tell, [instance.to_js(), error], 0)
                .to_js(),
        );
        Ok(())
    }

    pub(super) fn update_class<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        previous_props: JSValue,
    ) -> Result<'a, ()> {
        let known = js_Fiber::instance(fiber);
        let instance = match known {
            Some(known) => known,
            None => {
                let made = construct(cx, fiber.of_type(), fiber.props())?;
                let made = Component::from_js(&cx.heap, made).ok_or_else(|| {
                    cx.heap
                        .type_error(format_args!("The constructor did not return a Component"))
                })?;
                js_Fiber::set_instance(fiber, Some(made));
                js_RenderComponent::set_fiber(made, Some(fiber));
                made
            }
        };
        let previous_state = get(cx, instance.to_js(), Key::State)?;
        let output = instance.render(cx, fiber, known.is_none())?;
        if let Some(Err(error)) = output.map(|it| self.reconcile(cx, fiber, it)) {
            let thrown = cx.catch(error)?;
            if is_thenable(cx, thrown)? || boundary(cx, fiber)?.is_none() {
                return Err(throw(cx, thrown));
            }
            self.caught(cx, fiber, instance, thrown)?;
            let output = instance.render(cx, fiber, known.is_none())?;
            self.reconcile(cx, fiber, output.unwrap_or(JSValue::NULL))?;
        }
        js_Fiber::set_hooks(
            fiber,
            List::from_fn(&cx.heap, 2, |it| {
                [previous_props, previous_state][it as usize]
            })
            .to_js(),
        );
        instance.set(Is::UPDATED, output.is_some() && known.is_some());
        instance.set(Is::DUE, true);
        self.committed(&cx.heap).push(&cx.heap, fiber.to_js());
        Ok(())
    }
}

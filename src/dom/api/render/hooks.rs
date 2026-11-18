//! What a function component keeps between its renders.

use bun_jsc::js_promise::Status;

use super::*;

#[derive(Default)]
pub(crate) struct StateHook(bun_jsc::bindgen::Interior);

#[derive(Default)]
pub(crate) struct MemoHook(bun_jsc::bindgen::Interior);

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Timing {
    Layout,
    Passive,
}

pub(crate) struct EffectHook {
    pub(super) timing: Timing,
    pub(super) is_due: Cell<bool>,
}

impl EffectHook {
    pub(super) fn clean_up<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let Some(cleanup) = js_EffectHook::cleanup(self) else {
            return Ok(());
        };
        js_EffectHook::set_cleanup(self, JSValue::ZERO);
        call(cx, cleanup, JSValue::UNDEFINED, &[]).map(drop)
    }

    pub(super) fn run<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        self.clean_up(cx)?;
        let cleanup = call(
            cx,
            js_EffectHook::create_effect(self).unwrap_or(JSValue::UNDEFINED),
            JSValue::UNDEFINED,
            &[],
        )?;
        if cleanup.is_callable() {
            js_EffectHook::set_cleanup(self, cleanup);
        }
        Ok(())
    }
}

impl MemoHook {
    fn new<'a>(heap: &JsHeap<'a>, value: JSValue) -> &'a MemoHook {
        let made = js_MemoHook::create(heap, MemoHook::default());
        js_MemoHook::set_value(made, value);
        made
    }

    fn value(&self) -> JSValue {
        js_MemoHook::value(self).unwrap_or(JSValue::UNDEFINED)
    }
}

fn rendering<'a>(heap: &JsHeap<'a>) -> Result<'a, &'a Fiber> {
    js_Renderer::current(Renderer::get(heap)).ok_or_else(|| {
        heap.error(format_args!(
            "Hooks can only be called while a function component renders"
        ))
    })
}

fn hook<'a, T: JsInterface>(
    cx: Cx<'_, 'a>,
    create: impl FnOnce(Cx<'_, 'a>, &'a Fiber) -> Result<'a, &'a T>,
) -> Result<'a, &'a T> {
    let (fiber, index) = (rendering(&cx.heap)?, &Renderer::get(&cx.heap).hook_index);
    let (hooks, at) = (
        list!(&cx.heap, js_Fiber::{hooks, set_hooks}(fiber)),
        index.get(),
    );
    let found = if at < hooks.len() {
        T::from_js(&cx.heap, hooks.get(at)).ok_or_else(|| {
            cx.heap.error(format_args!(
                "The hooks were called in another order than in the previous render"
            ))
        })?
    } else {
        let made = create(cx, fiber)?;
        hooks.push(&cx.heap, made.to_js());
        made
    };
    index.set(at + 1);
    Ok(found)
}

fn constant<'a>(
    cx: Cx<'_, 'a>,
    create: impl FnOnce(Cx<'_, 'a>) -> Result<'a, JSValue>,
) -> Result<'a, JSValue> {
    hook(cx, |cx, _| create(cx).map(|it| MemoHook::new(&cx.heap, it))).map(MemoHook::value)
}

fn have_changed<'a>(cx: Cx<'_, 'a>, previous: Option<JSValue>, next: JSValue) -> Result<'a, bool> {
    let (Some(previous), global) = (
        previous.filter(|it| it.is_object() && next.is_object()),
        cx.global(),
    ) else {
        return Ok(true);
    };
    let length = next.get_length(global)?;
    if previous.get_length(global)? != length {
        return Ok(true);
    }
    for index in 0..length as u32 {
        let (old, new) = (
            previous.get_index(global, index)?,
            next.get_index(global, index)?,
        );
        if old != new && !old.is_same_value(new, global)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn dispatch<'a>(
    cx: Cx<'_, 'a>,
    [state, fiber]: [JsLocal<'a>; 2],
    _: u64,
    action: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(state), Some(fiber)) = (
        StateHook::from_js(&cx.heap, state.to_js()),
        Fiber::from_js(&cx.heap, fiber.to_js()),
    ) else {
        return Ok(JSValue::UNDEFINED);
    };
    let (old, action) = (
        js_StateHook::value(state).unwrap_or(JSValue::UNDEFINED),
        argument(action, 0),
    );
    let value = match js_StateHook::reducer(state) {
        Some(reducer) => call(cx, reducer, JSValue::UNDEFINED, &[old, action])?,
        None if action.is_callable() => call(cx, action, JSValue::UNDEFINED, &[old])?,
        None => action,
    };
    if !is_same(
        cx,
        value,
        js_StateHook::value(state).unwrap_or(JSValue::UNDEFINED),
    )? {
        js_StateHook::set_value(state, value);
        Renderer::get(&cx.heap).schedule(&cx.heap, fiber);
    }
    Ok(JSValue::UNDEFINED)
}

/// The value, and what changes it. `reducer` may be empty.
fn state<'a>(
    cx: Cx<'_, 'a>,
    reducer: JSValue,
    initial: impl FnOnce(Cx<'_, 'a>) -> Result<'a, JSValue>,
) -> Result<'a, [JSValue; 2]> {
    let state = hook(cx, |cx, fiber| {
        let (value, made) = (
            initial(cx)?,
            js_StateHook::create(&cx.heap, StateHook::default()),
        );
        js_StateHook::set_value(made, value);
        js_StateHook::set_dispatch(
            made,
            function(&cx.heap, dispatch, [made.to_js(), fiber.to_js()]),
        );
        Ok(made)
    })?;
    js_StateHook::set_reducer(state, reducer);
    Ok([js_StateHook::value(state), js_StateHook::dispatch(state)]
        .map(|it| it.unwrap_or(JSValue::UNDEFINED)))
}

pub(crate) fn use_reducer<'a>(
    cx: Cx<'_, 'a>,
    reducer: JsLocal<'a>,
    initial: JsLocal<'a>,
    init: JsLocal<'a>,
) -> Result<'a, JSValue> {
    let (initial, init) = (initial.to_js(), init.to_js());
    let pair = state(cx, reducer.to_js(), |cx| {
        if init.to_boolean() {
            call(cx, init, JSValue::UNDEFINED, &[initial])
        } else {
            Ok(initial)
        }
    })?;
    array(cx, &pair)
}

pub(crate) fn use_state<'a>(cx: Cx<'_, 'a>, initial: JsLocal<'a>) -> Result<'a, JSValue> {
    let initial = initial.to_js();
    let pair = state(cx, JSValue::ZERO, |cx| {
        if initial.is_callable() {
            call(cx, initial, JSValue::UNDEFINED, &[])
        } else {
            Ok(initial)
        }
    })?;
    array(cx, &pair)
}

fn effect<'a>(
    cx: Cx<'_, 'a>,
    timing: Timing,
    deps: JSValue,
    create: impl FnOnce(&JsHeap<'a>) -> JSValue,
) -> Result<'a, ()> {
    let effect = hook(cx, |cx, fiber| {
        let made = js_EffectHook::create(
            &cx.heap,
            EffectHook {
                timing,
                is_due: Cell::new(true),
            },
        );
        list!(&cx.heap, js_Fiber::{effects, set_effects}(fiber)).push(&cx.heap, made.to_js());
        Ok(made)
    })?;
    if effect.is_due.get() || have_changed(cx, js_EffectHook::deps(effect), deps)? {
        js_EffectHook::set_create_effect(effect, create(&cx.heap));
        js_EffectHook::set_deps(effect, deps);
        effect.is_due.set(true);
    }
    Ok(())
}

pub(crate) fn use_effect<'a>(
    cx: Cx<'_, 'a>,
    create: JsLocal<'a>,
    deps: JsLocal<'a>,
) -> Result<'a, ()> {
    effect(cx, Timing::Passive, deps.to_js(), |_| create.to_js())
}

pub(crate) fn use_layout_effect<'a>(
    cx: Cx<'_, 'a>,
    create: JsLocal<'a>,
    deps: JsLocal<'a>,
) -> Result<'a, ()> {
    effect(cx, Timing::Layout, deps.to_js(), |_| create.to_js())
}

fn memoized<'a>(
    cx: Cx<'_, 'a>,
    deps: JSValue,
    create: impl FnOnce(Cx<'_, 'a>) -> Result<'a, JSValue>,
) -> Result<'a, JSValue> {
    let memo = hook(cx, |cx, _| Ok(MemoHook::new(&cx.heap, JSValue::UNDEFINED)))?;
    if have_changed(cx, js_MemoHook::deps(memo), deps)? {
        js_MemoHook::set_value(memo, create(cx)?);
        js_MemoHook::set_deps(memo, deps);
    }
    Ok(memo.value())
}

pub(crate) fn use_memo<'a>(
    cx: Cx<'_, 'a>,
    create: JsLocal<'a>,
    deps: JsLocal<'a>,
) -> Result<'a, JSValue> {
    memoized(cx, deps.to_js(), |cx| {
        call(cx, create.to_js(), JSValue::UNDEFINED, &[])
    })
}

pub(crate) fn use_callback<'a>(
    cx: Cx<'_, 'a>,
    callback: JsLocal<'a>,
    deps: JsLocal<'a>,
) -> Result<'a, JSValue> {
    memoized(cx, deps.to_js(), |_| Ok(callback.to_js()))
}

pub(crate) fn use_ref<'a>(cx: Cx<'_, 'a>, initial: JsLocal<'a>) -> Result<'a, JSValue> {
    constant(cx, |cx| object(cx, &[(Key::Current, initial.to_js())]))
}

#[optimize(size)]
pub(crate) fn use_id<'a>(cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
    constant(cx, |cx| {
        let next = &Renderer::get(&cx.heap).next_id;
        Ok(
            DomString::from_utf8(&format!(":r{:x}:", next.replace(next.get() + 1)))
                .to_js(&cx.heap)
                .to_js(),
        )
    })
}

pub(crate) fn use_debug_value() {}

#[optimize(size)]
pub(crate) fn use_imperative_handle<'a>(
    cx: Cx<'_, 'a>,
    reference: JsLocal<'a>,
    create: JsLocal<'a>,
    deps: JsLocal<'a>,
) -> Result<'a, ()> {
    let mut deps = deps.to_js();
    if deps.to_boolean() {
        let all = listed(cx, deps)?;
        all.push(&cx.heap, reference.to_js());
        deps = exposed(cx, all)?;
    }
    let body: CallbackBody = |cx, [reference, create], _, _| match reference.to_js().to_boolean() {
        true => call(cx, create.to_js(), JSValue::UNDEFINED, &[])
            .and_then(|it| fiber::hand_over(cx, reference.to_js(), it)),
        false => Ok(JSValue::UNDEFINED),
    };
    effect(cx, Timing::Layout, deps, |heap| {
        heap.create_callback(body, [reference.to_js(), create.to_js()], 0)
            .to_js()
    })
}

#[optimize(size)]
pub(crate) fn use_effect_event<'a>(cx: Cx<'_, 'a>, callback: JsLocal<'a>) -> Result<'a, JSValue> {
    let latest = hook(cx, |cx, _| Ok(MemoHook::new(&cx.heap, JSValue::UNDEFINED)))?;
    js_MemoHook::set_value(latest, callback.to_js());
    let run: CallbackBody = |cx, [latest, _], _, arguments| {
        let (callback, arguments) = (
            MemoHook::from_js(&cx.heap, latest.to_js()).map(MemoHook::value),
            arguments.iter().map(|it| it.to_js()).collect::<Vec<_>>(),
        );
        call(
            cx,
            callback.unwrap_or(JSValue::UNDEFINED),
            JSValue::UNDEFINED,
            &arguments,
        )
    };
    constant(cx, |cx| {
        Ok(function(
            &cx.heap,
            run,
            [latest.to_js(), JSValue::UNDEFINED],
        ))
    })
}

/// `deps` of the store is what takes the snapshot.
fn check_store<'a>(
    cx: Cx<'_, 'a>,
    [store, fiber]: [JsLocal<'a>; 2],
    _: u64,
    _: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(store), Some(fiber)) = (
        MemoHook::from_js(&cx.heap, store.to_js()),
        Fiber::from_js(&cx.heap, fiber.to_js()),
    ) else {
        return Ok(JSValue::UNDEFINED);
    };
    let snapshot = call(
        cx,
        js_MemoHook::deps(store).unwrap_or(JSValue::UNDEFINED),
        JSValue::UNDEFINED,
        &[],
    )?;
    if !is_same(cx, snapshot, store.value())? {
        Renderer::get(&cx.heap).schedule(&cx.heap, fiber);
    }
    Ok(JSValue::UNDEFINED)
}

#[optimize(size)]
pub(crate) fn use_sync_external_store<'a>(
    cx: Cx<'_, 'a>,
    subscribe: JsLocal<'a>,
    get_snapshot: JsLocal<'a>,
) -> Result<'a, JSValue> {
    let fiber = rendering(&cx.heap)?;
    let value = call(cx, get_snapshot.to_js(), JSValue::UNDEFINED, &[])?;
    let store = hook(cx, |cx, _| Ok(MemoHook::new(&cx.heap, value)))?;
    js_MemoHook::set_value(store, value);
    js_MemoHook::set_deps(store, get_snapshot.to_js());
    let start: CallbackBody = |cx, [subscribe, check], _, _| {
        call(cx, check.to_js(), JSValue::UNDEFINED, &[])?;
        call(cx, subscribe.to_js(), JSValue::UNDEFINED, &[check.to_js()])
    };
    let deps = array(cx, &[subscribe.to_js()])?;
    effect(cx, Timing::Layout, deps, |heap| {
        heap.create_callback(
            start,
            [
                subscribe.to_js(),
                function(heap, check_store, [store.to_js(), fiber.to_js()]),
            ],
            0,
        )
        .to_js()
    })?;
    Ok(value)
}

pub(crate) fn start_transition<'a>(cx: Cx<'_, 'a>, callback: JsLocal<'a>) -> Result<'a, ()> {
    call(cx, callback.to_js(), JSValue::UNDEFINED, &[]).map(drop)
}

fn add_to_count<'a>(cx: Cx<'_, 'a>, set_count: JSValue, step: i32) -> Result<'a, JSValue> {
    let add: CallbackBody = |_, [step, _], _, count| {
        Ok(JSValue::js_number_from_int32(
            argument(count, 0).to_int32() + step.to_js().to_int32(),
        ))
    };
    let add = cx
        .heap
        .create_callback(
            add,
            [JSValue::js_number_from_int32(step), JSValue::UNDEFINED],
            0,
        )
        .to_js();
    call(cx, set_count, JSValue::UNDEFINED, &[add])
}

#[optimize(size)]
pub(crate) fn use_transition<'a>(cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
    let [pending, set_pending] =
        state(cx, JSValue::ZERO, |_| Ok(JSValue::js_number_from_int32(0)))?;
    let start: CallbackBody = |cx, [set_pending, _], _, callback| {
        let result = call(cx, argument(callback, 0), JSValue::UNDEFINED, &[])?;
        if is_thenable(cx, result)? {
            add_to_count(cx, set_pending.to_js(), 1)?;
            let settled: CallbackBody = |cx, [set_pending, _], is_rejected, outcome| {
                add_to_count(cx, set_pending.to_js(), -1)?;
                if is_rejected == 0 {
                    Ok(JSValue::UNDEFINED)
                } else {
                    call_global(cx, Key::ReportError, argument(outcome, 0))
                        .map(|()| JSValue::UNDEFINED)
                }
            };
            let [fulfilled, rejected] = [0, 1].map(|it| {
                cx.heap
                    .create_callback(settled, [set_pending.to_js(), JSValue::UNDEFINED], it)
            });
            cx.promise_resolve(result)?
                .react(&cx.heap, Some(fulfilled), Some(rejected));
        }
        Ok(JSValue::UNDEFINED)
    };
    let start = constant(cx, |cx| {
        Ok(function(&cx.heap, start, [set_pending, JSValue::UNDEFINED]))
    })?;
    array(cx, &[JSValue::js_boolean(pending.to_int32() > 0), start])
}

#[optimize(size)]
pub(crate) fn use_deferred_value<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, JSValue> {
    let [deferred, set_deferred] = state(cx, JSValue::ZERO, |_| Ok(value.to_js()))?;
    let catch_up: CallbackBody = |cx, [set_deferred, value], _, _| {
        let value = cx
            .heap
            .create_callback(
                |_, [value, _], _, _| Ok(value.to_js()),
                [value.to_js(), JSValue::UNDEFINED],
                0,
            )
            .to_js();
        call(cx, set_deferred.to_js(), JSValue::UNDEFINED, &[value])
    };
    let deps = array(cx, &[value.to_js()])?;
    effect(cx, Timing::Passive, deps, |heap| {
        heap.create_callback(catch_up, [set_deferred, value.to_js()], 0)
            .to_js()
    })?;
    Ok(deferred)
}

pub(crate) fn use_context<'a>(cx: Cx<'_, 'a>, context: JsLocal<'a>) -> Result<'a, JSValue> {
    rendering(&cx.heap)?.read_context(cx, context.to_js())
}

pub(crate) fn use_window<'a>(cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
    let root = core::iter::successors(Some(rendering(&cx.heap)?), |it| js_Fiber::parent(it)).last();
    root.map_or(Ok(JSValue::NULL), |it| get(cx, it.props(), Key::Value))
}

#[optimize(size)]
pub(crate) fn r#use<'a>(cx: Cx<'_, 'a>, usable: JsLocal<'a>) -> Result<'a, JSValue> {
    let thenable = usable.to_js();
    if let Some(promise) = thenable.as_any_promise() {
        return match promise.status() {
            Status::Pending => Err(throw(cx, thenable)),
            Status::Fulfilled => Ok(promise.result(cx.global().vm())),
            Status::Rejected => {
                promise.set_handled(cx.global().vm());
                let reason = promise.result(cx.global().vm());
                Err(throw(cx, reason))
            }
        };
    }
    if get(cx, thenable, Key::Kind)? == Renderer::get(&cx.heap).symbol(Symbol::Context) {
        return use_context(cx, usable);
    }
    let status = get(cx, thenable, Key::Status)?;
    if status.is_undefined() {
        let settled: CallbackBody = |cx, [thenable, status], is_rejected, outcome| {
            set(
                cx,
                thenable.to_js(),
                if is_rejected == 0 {
                    Key::Value
                } else {
                    Key::Reason
                },
                argument(outcome, 0),
            )?;
            set(cx, thenable.to_js(), Key::Status, status.to_js()).map(|()| JSValue::UNDEFINED)
        };
        let name = |it: &str| DomString::from(it).to_js(&cx.heap).to_js();
        let [fulfilled, rejected] = [("fulfilled", 0), ("rejected", 1)].map(|it| {
            cx.heap
                .create_callback(settled, [thenable, name(it.0)], it.1)
                .to_js()
        });
        let pending = name("pending");
        set(cx, thenable, Key::Status, pending)?;
        invoke(cx, thenable, Key::Then, &[fulfilled, rejected])?;
    }
    match &*get(cx, thenable, Key::Status)
        .and_then(|it| string(cx, it))?
        .to_utf8()
    {
        "fulfilled" => get(cx, thenable, Key::Value),
        "rejected" => get(cx, thenable, Key::Reason).and_then(|it| Err(throw(cx, it))),
        _ => Err(throw(cx, thenable)),
    }
}

pub(crate) fn lazy<'a>(heap: &JsHeap<'a>, load: JsLocal<'a>) -> JSValue {
    let render: CallbackBody = |cx, [load, loading], _, props| {
        let Some(loading) = MemoHook::from_js(&cx.heap, loading.to_js()) else {
            return Ok(JSValue::NULL);
        };
        if loading.value().is_undefined_or_null() {
            js_MemoHook::set_value(loading, call(cx, load.to_js(), JSValue::UNDEFINED, &[])?);
        }
        let module = r#use(cx, JsLocal::new(&cx.heap, loading.value()))?;
        let component = get(cx, module, Key::Default)?;
        Ok(Renderer::get(&cx.heap).element(&cx.heap, component, JSValue::NULL, argument(props, 0)))
    };
    function(
        heap,
        render,
        [
            load.to_js(),
            MemoHook::new(heap, JSValue::UNDEFINED).to_js(),
        ],
    )
}

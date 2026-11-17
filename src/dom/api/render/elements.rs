//! What components return.

use super::*;

fn keyed<'a>(
    cx: Cx<'_, 'a>,
    of_type: JSValue,
    mut props: JSValue,
    mut key: JSValue,
) -> Result<'a, JSValue> {
    if has(cx, props, Key::Key)? {
        key = get(cx, props, Key::Key)?;
        props = spread(cx, props, JSValue::UNDEFINED, Some(Key::Key))?;
    }
    let key = if key.is_undefined_or_null() {
        JSValue::NULL
    } else {
        key.to_js_string(cx.global())?.to_js()
    };
    Ok(Renderer::get(&cx.heap).element(&cx.heap, of_type, key, props))
}

pub(crate) fn jsx<'a>(
    cx: Cx<'_, 'a>,
    of_type: JsLocal<'a>,
    props: JsLocal<'a, JSObject>,
    key: JsLocal<'a>,
) -> Result<'a, JSValue> {
    keyed(cx, of_type.to_js(), props.to_js(), key.to_js())
}

fn with_children<'a>(
    cx: Cx<'_, 'a>,
    of_type: JSValue,
    props: JSValue,
    key: JSValue,
    children: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let children: Vec<_> = children.iter().map(|it| it.to_js()).collect();
    match children[..] {
        [] => {}
        [only] => set(cx, props, Key::Children, only)?,
        _ => array(cx, &children).and_then(|it| set(cx, props, Key::Children, it))?,
    }
    keyed(cx, of_type, props, key)
}

pub(crate) fn create_element<'a>(
    cx: Cx<'_, 'a>,
    of_type: JsLocal<'a>,
    props: JsLocal<'a>,
    children: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let props = spread(cx, props.to_js(), JSValue::UNDEFINED, None)?;
    with_children(cx, of_type.to_js(), props, JSValue::NULL, children)
}

pub(crate) fn clone_element<'a>(
    cx: Cx<'_, 'a>,
    element: JsLocal<'a>,
    props: JsLocal<'a>,
    children: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let [_, of_type, key, own] = require_element(cx, element.to_js())?;
    let props = spread(cx, own, props.to_js(), None)?;
    with_children(cx, of_type, props, key, children)
}

fn require_element<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, [JSValue; 4]> {
    Renderer::get(&cx.heap)
        .read_element(cx, value)?
        .ok_or_else(|| {
            cx.heap
                .type_error(format_args!("Expected a single element"))
        })
}

pub(crate) fn is_valid_element<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, bool> {
    Renderer::get(&cx.heap)
        .read_element(cx, value.to_js())
        .map(|it| it.is_some())
}

fn marked<'a>(cx: Cx<'_, 'a>, symbol: Symbol, members: &[(Key, JSValue)]) -> Result<'a, JSValue> {
    let kind = (Key::Kind, Renderer::get(&cx.heap).symbol(symbol));
    object(cx, &[&[kind], members].concat())
}

pub(crate) fn create_context<'a>(
    cx: Cx<'_, 'a>,
    default_value: JsLocal<'a>,
) -> Result<'a, JSValue> {
    let context = marked(
        cx,
        Symbol::Context,
        &[(Key::DefaultValue, default_value.to_js())],
    )?;
    let consume: CallbackBody = |cx, [context, _], _, props| {
        let (children, value) = (
            get(cx, argument(props, 0), Key::Children)?,
            use_context(cx, context)?,
        );
        call(cx, children, JSValue::UNDEFINED, &[value])
    };
    set(cx, context, Key::Provider, context)?;
    let consumer = function(&cx.heap, consume, [context, JSValue::UNDEFINED]);
    set(cx, context, Key::Consumer, consumer).map(|()| context)
}

pub(crate) fn memo<'a>(
    cx: Cx<'_, 'a>,
    of_type: JsLocal<'a>,
    compare: JsLocal<'a>,
) -> Result<'a, JSValue> {
    marked(
        cx,
        Symbol::Memo,
        &[
            (Key::Type, of_type.to_js()),
            (Key::Compare, compare.to_js()),
        ],
    )
}

pub(crate) fn forward_ref<'a>(cx: Cx<'_, 'a>, render: JsLocal<'a>) -> Result<'a, JSValue> {
    marked(cx, Symbol::ForwardRef, &[(Key::Render, render.to_js())])
}

pub(crate) fn create_ref<'a>(cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
    object(cx, &[(Key::Current, JSValue::NULL)])
}

pub(crate) fn create_portal<'a>(
    cx: Cx<'_, 'a>,
    children: JsLocal<'a>,
    container: JsLocal<'a>,
    key: JsLocal<'a>,
) -> Result<'a, JSValue> {
    let (props, portal) = (
        object(
            cx,
            &[
                (Key::Children, children.to_js()),
                (Key::Container, container.to_js()),
            ],
        )?,
        Renderer::get(&cx.heap).symbol(Symbol::Portal),
    );
    keyed(cx, portal, props, key.to_js())
}

fn flatten<'a>(cx: Cx<'_, 'a>, children: JSValue, out: List<'a>) -> Result<'a, ()> {
    cx.check_stack()?;
    if is_iterable(cx, children)? {
        return listed(cx, children)?
            .values()
            .try_for_each(|it| flatten(cx, it, out));
    }
    if !children.is_undefined_or_null() && !children.is_boolean() {
        out.push(&cx.heap, children);
    }
    Ok(())
}

fn flat<'a>(cx: Cx<'_, 'a>, children: JsLocal<'a>) -> Result<'a, List<'a>> {
    let out = List::new(&cx.heap);
    flatten(cx, children.to_js(), out).map(|()| out)
}

pub(crate) fn to_array<'a>(cx: Cx<'_, 'a>, children: JsLocal<'a>) -> Result<'a, JSValue> {
    flat(cx, children).and_then(|it| exposed(cx, it))
}

pub(crate) fn count<'a>(cx: Cx<'_, 'a>, children: JsLocal<'a>) -> Result<'a, u32> {
    flat(cx, children).map(List::len)
}

fn visit_all<'a>(
    cx: Cx<'_, 'a>,
    children: JsLocal<'a>,
    visit: JsLocal<'a>,
) -> Result<'a, List<'a>> {
    let results = List::new(&cx.heap);
    for (index, child) in flat(cx, children)?.values().enumerate() {
        let result = call(
            cx,
            visit.to_js(),
            JSValue::UNDEFINED,
            &[child, JSValue::js_number_from_int32(index as i32)],
        )?;
        results.push(&cx.heap, result);
    }
    Ok(results)
}

pub(crate) fn map<'a>(
    cx: Cx<'_, 'a>,
    children: JsLocal<'a>,
    visit: JsLocal<'a>,
) -> Result<'a, JSValue> {
    if children.to_js().is_undefined_or_null() {
        return Ok(children.to_js());
    }
    let (results, out) = (visit_all(cx, children, visit)?, List::new(&cx.heap));
    results.values().try_for_each(|it| flatten(cx, it, out))?;
    exposed(cx, out)
}

pub(crate) fn for_each<'a>(
    cx: Cx<'_, 'a>,
    children: JsLocal<'a>,
    visit: JsLocal<'a>,
) -> Result<'a, ()> {
    visit_all(cx, children, visit).map(drop)
}

pub(crate) fn only<'a>(cx: Cx<'_, 'a>, children: JsLocal<'a>) -> Result<'a, JSValue> {
    require_element(cx, children.to_js()).map(|_| children.to_js())
}

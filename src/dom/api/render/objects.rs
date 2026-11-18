//! Plain objects.

use core::ffi::c_void;

use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::{JSGlobalObject, call_zero_is_throw, from_js_host_call_generic as checked};

use super::*;

type VisitChange = unsafe extern "C" fn(*mut c_void, &Impl, JSValue, JSValue) -> bool;

unsafe extern "C" {
    safe fn Bun__Render__get(global: &JSGlobalObject, value: JSValue, name: &Impl) -> JSValue;
    fn Bun__Render__has(global: &JSGlobalObject, object: JSValue, name: &Impl) -> bool;
    fn Bun__Render__set(global: &JSGlobalObject, object: JSValue, name: &Impl, value: JSValue);
    safe fn Bun__Render__construct(
        global: &JSGlobalObject,
        constructor: JSValue,
        argument: JSValue,
    ) -> JSValue;
    fn Bun__Render__makeFunction(global: &JSGlobalObject, callable: JSValue);
    safe fn Bun__Render__createElementStructure(global: &JSGlobalObject) -> JSValue;
    fn Bun__Render__createElement(
        global: &JSGlobalObject,
        structure: JSValue,
        members: &[JSValue; 4],
    ) -> JSValue;
    fn Bun__Render__readElement(
        element: JSValue,
        structure: JSValue,
        members: &mut [JSValue; 4],
    ) -> bool;
    safe fn Bun__Render__spread(
        global: &JSGlobalObject,
        first: JSValue,
        second: JSValue,
        except: Option<&Impl>,
    ) -> JSValue;
    fn Bun__Render__forEachChange(
        global: &JSGlobalObject,
        before: JSValue,
        now: JSValue,
        context: *mut c_void,
        visit: Option<VisitChange>,
    ) -> bool;
}

macro_rules! keys {
    ($($name:ident $text:literal)*) => {
        #[derive(Clone, Copy)]
        pub(super) enum Key {
            $($name,)*
        }

        thread_local! {
            static KEYS: Box<[Atom; [$($text),*].len()]> = Box::new([$(Atom::new($text)),*]);
        }
    };
}

keys! {
    AutoFocus "autoFocus" Checked "checked" Children "children" Compare "compare" ComponentDidCatch "componentDidCatch"
    ComponentDidMount "componentDidMount" ComponentDidUpdate "componentDidUpdate" ComponentStack "componentStack"
    ComponentWillUnmount "componentWillUnmount" Consumer "Consumer" Container "container" Context "context" ContextType "contextType"
    Current "current" Default "default" DefaultChecked "defaultChecked" DefaultValue "defaultValue" Fallback "fallback"
    GetDerivedStateFromError "getDerivedStateFromError" GetDerivedStateFromProps "getDerivedStateFromProps" Html "__html"
    InnerHtml "innerHTML" Key "key" Kind "$$typeof" Props "props" Provider "Provider" Reason "reason" Ref "ref" Render "render"
    ReportError "reportError" Selected "selected" SetImmediate "setImmediate" ShouldComponentUpdate "shouldComponentUpdate"
    State "state" Status "status" Then "then" Type "type" Value "value"
}

pub(super) trait Name: Copy {
    fn with<R>(self, body: impl FnOnce(&Impl) -> R) -> R;
}

impl Name for Key {
    #[inline]
    fn with<R>(self, body: impl FnOnce(&Impl) -> R) -> R {
        KEYS.with(|it| body(it[self as usize].as_impl()))
    }
}

impl Name for &Atom {
    fn with<R>(self, body: impl FnOnce(&Impl) -> R) -> R {
        body(self.as_impl())
    }
}

/// `value?.[name]`
pub(super) fn get<'a>(cx: Cx<'_, 'a>, value: JSValue, name: impl Name) -> Result<'a, JSValue> {
    if value.is_undefined_or_null() {
        return Ok(JSValue::UNDEFINED);
    }
    let global = cx.global();
    Ok(checked(global, || {
        name.with(|it| Bun__Render__get(global, value, it))
    })?)
}

pub(super) fn has<'a>(cx: Cx<'_, 'a>, object: JSValue, name: impl Name) -> Result<'a, bool> {
    let global = cx.global();
    // SAFETY: it is called for an object.
    let has = |it: &Impl| unsafe { Bun__Render__has(global, object, it) };
    Ok(object.is_object() && checked(global, || name.with(has))?)
}

pub(super) fn set<'a>(
    cx: Cx<'_, 'a>,
    object: JSValue,
    name: impl Name,
    value: JSValue,
) -> Result<'a, ()> {
    if !object.is_object() {
        return Err(cx.heap.type_error(format_args!("Expected an object")));
    }
    let global = cx.global();
    // SAFETY: it is an object.
    let set = |it: &Impl| unsafe { Bun__Render__set(global, object, it, value) };
    Ok(checked(global, || name.with(set))?)
}

pub(super) fn object<'a>(cx: Cx<'_, 'a>, members: &[(Key, JSValue)]) -> Result<'a, JSValue> {
    let made = JSValue::create_empty_object(cx.global(), members.len());
    members
        .iter()
        .try_for_each(|it| set(cx, made, it.0, it.1))
        .map(|()| made)
}

pub(super) fn array<'a>(cx: Cx<'_, 'a>, values: &[JSValue]) -> Result<'a, JSValue> {
    Ok(JSValue::create_array_from_slice(cx.global(), values)?)
}

pub(super) fn exposed<'a>(cx: Cx<'_, 'a>, list: List<'a>) -> Result<'a, JSValue> {
    let made = array(cx, &list.values().collect::<Vec<_>>());
    list.to_js().ensure_still_alive();
    made
}

pub(super) fn call<'a>(
    cx: Cx<'_, 'a>,
    function: JSValue,
    this: JSValue,
    arguments: &[JSValue],
) -> Result<'a, JSValue> {
    if !function.is_callable() {
        return Err(cx.heap.type_error(format_args!("Expected a function")));
    }
    Ok(function.call(cx.global(), this, arguments)?)
}

/// `function?.(..arguments)`
pub(super) fn call_if_any<'a>(
    cx: Cx<'_, 'a>,
    function: JSValue,
    this: JSValue,
    arguments: &[JSValue],
) -> Result<'a, JSValue> {
    if function.is_undefined_or_null() {
        Ok(JSValue::UNDEFINED)
    } else {
        call(cx, function, this, arguments)
    }
}

/// `object[name]?.(..arguments)`
pub(super) fn invoke<'a>(
    cx: Cx<'_, 'a>,
    object: JSValue,
    name: Key,
    arguments: &[JSValue],
) -> Result<'a, JSValue> {
    let method = get(cx, object, name)?;
    call_if_any(cx, method, object, arguments)
}

pub(super) fn construct<'a>(
    cx: Cx<'_, 'a>,
    constructor: JSValue,
    argument: JSValue,
) -> Result<'a, JSValue> {
    let global = cx.global();
    Ok(call_zero_is_throw(global, || {
        Bun__Render__construct(global, constructor, argument)
    })?)
}

/// For scripts to see.
pub(super) fn function(heap: &JsHeap<'_>, body: CallbackBody, captured: [JSValue; 2]) -> JSValue {
    let made = heap.create_callback(body, captured, 0).to_js();
    // SAFETY: it is an object.
    unsafe { Bun__Render__makeFunction(global_of(heap), made) };
    made
}

pub(super) fn argument(arguments: &[JsLocal<'_>], index: usize) -> JSValue {
    arguments
        .get(index)
        .map_or(JSValue::UNDEFINED, |it| it.to_js())
}

pub(super) fn element_structure(heap: &JsHeap<'_>) -> JSValue {
    Bun__Render__createElementStructure(global_of(heap))
}

impl Renderer {
    fn structure(&self) -> JSValue {
        js_Renderer::element_structure(self).expect("is set when it is made")
    }

    pub(super) fn element(
        &self,
        heap: &JsHeap<'_>,
        kind: JSValue,
        key: JSValue,
        props: JSValue,
    ) -> JSValue {
        // SAFETY: the structure has these four.
        unsafe {
            Bun__Render__createElement(
                global_of(heap),
                self.structure(),
                &[self.symbol(Symbol::Element), kind, key, props],
            )
        }
    }

    /// `$$typeof`, and if that says that it is an element `type`, `key` and `props`.
    pub(super) fn read_element<'a>(
        &self,
        cx: Cx<'_, 'a>,
        value: JSValue,
    ) -> Result<'a, Option<[JSValue; 4]>> {
        let mut members = [JSValue::UNDEFINED; 4];
        // SAFETY: it is an object.
        let is_read = value.is_object()
            && unsafe { Bun__Render__readElement(value, self.structure(), &mut members) };
        if !is_read {
            members[0] = get(cx, value, Key::Kind)?;
        }
        if members[0] != self.symbol(Symbol::Element)
            && members[0] != self.symbol(Symbol::LegacyElement)
        {
            return Ok(None);
        }
        if !is_read {
            members = [
                members[0],
                get(cx, value, Key::Type)?,
                get(cx, value, Key::Key)?,
                get(cx, value, Key::Props)?,
            ];
        }
        Ok(Some(members))
    }
}

pub(super) fn spread<'a>(
    cx: Cx<'_, 'a>,
    first: JSValue,
    second: JSValue,
    except: Option<Key>,
) -> Result<'a, JSValue> {
    let global = cx.global();
    let spread = |except: Option<&Impl>| {
        call_zero_is_throw(global, || {
            Bun__Render__spread(global, first, second, except)
        })
    };
    Ok(except.map_or_else(|| spread(None), |it| it.with(|it| spread(Some(it))))?)
}

/// With the name, the value and the value before.
pub(super) fn for_each_change<'a, F>(
    cx: Cx<'_, 'a>,
    before: JSValue,
    now: JSValue,
    visit: F,
) -> Result<'a, ()>
where
    F: FnMut(Cx<'_, 'a>, &Impl, JSValue, JSValue) -> Result<'a, ()>,
{
    unsafe extern "C" fn each<'a, F>(
        context: *mut c_void,
        name: &Impl,
        value: JSValue,
        old: JSValue,
    ) -> bool
    where
        F: FnMut(Cx<'_, 'a>, &Impl, JSValue, JSValue) -> Result<'a, ()>,
    {
        // SAFETY: what `for_each_change` passes.
        let (cx, visit, outcome) =
            unsafe { &mut *context.cast::<(Cx<'_, 'a>, F, Result<'a, ()>)>() };
        *outcome = visit(cx, name, value, old);
        outcome.is_ok()
    }
    if !now.is_object() {
        return Ok(());
    }
    let (global, before) = (
        core::ptr::from_ref(cx.global()),
        if before.is_object() {
            before
        } else {
            JSValue::ZERO
        },
    );
    let mut context = (cx, visit, Ok(()));
    // SAFETY: objects or null, and the context is of the type that `each` takes it for.
    let walked = unsafe {
        checked(&*global, || {
            Bun__Render__forEachChange(
                &*global,
                before,
                now,
                (&raw mut context).cast(),
                Some(each::<F>),
            )
        })
    };
    context.2.and_then(|()| Ok(walked.map(drop)?))
}

pub(super) fn are_shallow_equal<'a>(cx: Cx<'_, 'a>, a: JSValue, b: JSValue) -> Result<'a, bool> {
    let global = cx.global();
    let [a, b] = [a, b].map(|it| {
        if it.is_object() {
            it
        } else {
            JSValue::create_empty_object(global, 0)
        }
    });
    // SAFETY: objects.
    Ok(!checked(global, || unsafe {
        Bun__Render__forEachChange(global, a, b, core::ptr::null_mut(), None)
    })?)
}

pub(super) fn is_same<'a>(cx: Cx<'_, 'a>, a: JSValue, b: JSValue) -> Result<'a, bool> {
    Ok(a == b || a.is_same_value(b, cx.global())?)
}

pub(super) fn is_thenable<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, bool> {
    get(cx, value, Key::Then).map(JSValue::is_callable)
}

pub(super) fn is_iterable<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, bool> {
    Ok(value.is_object()
        && !JsLocal::new(&cx.heap, value)
            .get(cx, CommonProperty::Iterator)?
            .to_js()
            .is_undefined_or_null())
}

/// `[...value]`
pub(super) fn listed<'a>(cx: Cx<'_, 'a>, iterable: JSValue) -> Result<'a, List<'a>> {
    extern "C" fn push(
        _: *mut bun_jsc::VM,
        global: &JSGlobalObject,
        list: *mut c_void,
        value: JSValue,
    ) {
        // SAFETY: what `listed` passes, while it waits.
        unsafe {
            JsScope::with(global.as_mut_ptr(), |cx| {
                (*list.cast::<List<'_>>()).push(&cx.heap, value)
            })
        };
    }
    let mut list = List::new(&cx.heap);
    iterable.for_each(cx.global(), (&raw mut list).cast(), push)?;
    Ok(list)
}

pub(super) fn string<'a>(cx: Cx<'_, 'a>, value: JSValue) -> Result<'a, DomString> {
    DomString::from_js(cx, JsLocal::new(&cx.heap, value))
}

pub(super) fn throw<'a>(cx: Cx<'_, 'a>, value: JSValue) -> bun_jsc::bindgen::Error<'a> {
    cx.global().throw_value(value).into()
}

pub(super) fn call_global<'a>(cx: Cx<'_, 'a>, name: Key, argument: JSValue) -> Result<'a, ()> {
    let global = cx.global().to_js_value();
    invoke(cx, global, name, &[argument]).map(drop)
}

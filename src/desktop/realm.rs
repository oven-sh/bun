//! Values that go from one realm to another.

use bun_jsc::{JSGlobalObject, JSPromise, from_js_host_call, from_js_host_call_generic};

use bun_web::channel::Serialized;

use crate::prelude::*;

pub(crate) use bun_web::realm::native;

pub(crate) type Realm = JSGlobalObject;

#[repr(u8)]
pub(crate) enum Module {
    ChildProcess,
    Events,
    Module,
    Url,
    Dns,
    Fs,
    Os,
    Stream,
    Tls,
}

unsafe extern "C" {
    safe fn Bun__Desktop__realmOf(object: JSValue) -> &'static Realm;
    safe fn Bun__Desktop__clone(from: &Realm, to: &Realm, value: JSValue) -> JSValue;
    safe fn Bun__Desktop__isDOMException(value: JSValue) -> bool;
    safe fn Bun__Desktop__copyPlainData(to: &Realm, value: JSValue) -> JSValue;
    safe fn Bun__Desktop__require(realm: &Realm, module: Module) -> JSValue;
    safe fn Bun__Desktop__provideModule(realm: &Realm, name: &bun_core::String, load: JSValue);
    safe fn Bun__RealmBridge__peek(handle: JSValue) -> JSValue;
    safe fn Bun__RealmBridge__cross(to: &Realm, value: JSValue) -> JSValue;
    safe fn Bun__Desktop__createObject(realm: &Realm, prototype: JSValue) -> JSValue;
}

/// The object keeps it alive.
pub(crate) fn of(object: JSValue) -> &'static Realm {
    Bun__Desktop__realmOf(object)
}

/// As a message is. What it throws is of `from`.
pub(crate) fn clone(from: &Realm, to: &Realm, value: JSValue) -> JsResult<JSValue> {
    if value.is_object() {
        from_js_host_call(from, || Bun__Desktop__clone(from, to, value))
    } else {
        refuse_symbol(from, value)
    }
}

/// The same, for another process.
pub(crate) fn pack(from: &Realm, value: JSValue) -> JsResult<Serialized> {
    let packed = catch(Serialized::of_data(from, refuse_symbol(from, value)?))?;
    packed.map_err(|thrown| match Bun__Desktop__isDOMException(thrown) {
        true => from.throw(format_args!("An object could not be cloned.")),
        false => from.throw_value(thrown),
    })
}

pub(crate) fn unpack(to: &Realm, value: &Serialized) -> JsResult<JSValue> {
    catch(value.deserialize(to, &[]))?
        .map_err(|_| to.throw(format_args!("An object could not be cloned.")))
}

fn refuse_symbol(from: &Realm, value: JSValue) -> JsResult<JSValue> {
    if value.is_symbol() {
        Err(from.throw(format_args!("An object could not be cloned.")))
    } else {
        Ok(value)
    }
}

/// `None` if there is more to it than objects, arrays and primitives. No script runs.
pub(crate) fn copy_plain_data(to: &Realm, value: JSValue) -> JsResult<Option<JSValue>> {
    let copy = from_js_host_call_generic(to, || Bun__Desktop__copyPlainData(to, value))?;
    Ok(Some(copy).filter(|it| !it.is_empty()))
}

/// What a handle stands for.
pub(crate) fn peek(handle: JSValue) -> JSValue {
    Bun__RealmBridge__peek(handle)
}

/// Between a page and the app.
pub(crate) fn cross(to: &Realm, value: JSValue) -> JsResult<JSValue> {
    from_js_host_call(to, || Bun__RealmBridge__cross(to, value))
}

pub(crate) fn require(realm: &Realm, module: Module) -> JsResult<JSValue> {
    from_js_host_call(realm, || Bun__Desktop__require(realm, module))
}

/// `module` makes the value of the module from `captured`.
pub(crate) fn provide_module(
    name: &'static str,
    captured: JSValue,
    module: fn(JSValue) -> JsResult<JSValue>,
) -> JsResult<()> {
    let load = function(captured, move |captured, _| {
        let (module, exports) = (module(captured)?, object!({}));
        for name in texts_of(module.keys(global())?)? {
            exports.put(global(), name.as_bytes(), get(module, &name)?);
        }
        exports.put(global(), b"default", module);
        Ok(object!({ "loader": "object", "exports": exports }))
    })?;
    Bun__Desktop__provideModule(global(), &bun_core::String::static_(name), load);
    Ok(())
}

/// An object of a class has no members on the other side of the bridge. `handle` is among them.
pub(crate) fn methods_of(handle: JSValue) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn Bun__RealmBridge__methodsOf(global: &JSGlobalObject, handle: JSValue) -> JSValue;
    }
    from_js_host_call(global(), || Bun__RealmBridge__methodsOf(global(), handle))
}

pub(crate) fn construct(class: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
    instantiate(native(global(), class)?, arguments)
}

pub(crate) fn instantiate(class: JSValue, arguments: &[JSValue]) -> JsResult<JSValue> {
    bun_web::realm::construct(global(), class, arguments)
}

pub(crate) fn create_object(realm: &Realm, prototype: JSValue) -> JSValue {
    Bun__Desktop__createObject(realm, prototype)
}

/// An error of `realm` for what the app's realm has thrown.
pub(crate) fn own_error(realm: &Realm, thrown: JSValue) -> JsResult<JSValue> {
    let name = if thrown.is_object() {
        text_of(get(thrown, "name")?)?
    } else {
        String::new()
    };
    let message = message_of(thrown)?;
    Ok(match &*name {
        "RangeError" => realm.create_range_error_instance(format_args!("{message}")),
        "TypeError" => realm.create_type_error_instance(format_args!("{message}")),
        _ => realm.create_error_instance(format_args!("{message}")),
    })
}

/// What the app's realm answers to a script of `realm`.
pub(crate) fn answer_to<T>(realm: &Realm, result: JsResult<T>) -> JsResult<T> {
    catch(result)?.or_else(|thrown| Err(realm.throw_value(own_error(realm, thrown)?)))
}

pub(crate) fn settle(realm: &Realm, promise: JSValue, result: JsResult<JSValue>) -> JsResult<()> {
    (promise.as_promise()).map_or(Ok(()), |it| JSPromise::opaque_mut(it).settle(realm, result))
}

/// A promise of `realm` for one of the app's.
pub(crate) fn adopt(realm: &Realm, promise: JSValue) -> JsResult<JSValue> {
    let own = JSPromise::create(realm).to_js();
    let fulfilled = function(own, |own, arguments| {
        let copy = answer_to(of(own), clone(global(), of(own), argument(arguments, 0)));
        settle(of(own), own, copy).map(|()| JSValue::UNDEFINED)
    })?;
    let rejected = function(own, |own, arguments| {
        let error = own_error(of(own), argument(arguments, 0))?;
        settle(of(own), own, Err(of(own).throw_value(error))).map(|()| JSValue::UNDEFINED)
    })?;
    react(global(), promise, fulfilled, rejected)?;
    Ok(own)
}

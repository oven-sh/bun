//! `ObjCObject` / `ObjCClass` / `ObjCSelector` and the `objc*` binding
//! functions: the JavaScript face of `bun_appkit::dynamic`, which sends any
//! selector to any object or class. `src/js/bun/appkit.ts` wraps these in the
//! `objc` proxy layer (selector name mangling, `objc.classes`, `.native`).

use bun_appkit::dynamic::{self, Plain, Receiver};
use bun_appkit::{DynClass, DynObject};
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsClass, JsResult};

use super::conv::{self, JsStr};

fn selector_arg(global: &JSGlobalObject, value: JSValue, what: &str) -> JsResult<conv::Utf8> {
    Ok(JsStr::new(global, value, format_args!("{what} selector"))?.to_utf8())
}

/// Looks the method up, converts `args` by its signature, sends, and converts
/// the result back.
fn send(
    global: &JSGlobalObject,
    receiver: Receiver<'_>,
    frame: &CallFrame,
    what: &str,
) -> JsResult<JSValue> {
    let args = frame.arguments();
    let sel = selector_arg(global, frame.argument(0), what)?;
    let args = args.get(1..).unwrap_or_default();
    let sig = conv::check(global, dynamic::signature(receiver, &sel))?;
    if args.len() != sig.args.len() {
        return Err(conv::throw(
            global,
            &bun_appkit::Error::ArgCount {
                method: sig.method().to_owned(),
                expected: sig.args.len(),
                got: args.len(),
            },
        ));
    }
    let mut values = Vec::with_capacity(args.len());
    for (index, (enc, value)) in sig.args.iter().zip(args).enumerate() {
        values.push(conv::dyn_arg(global, &sig, index, enc, *value)?);
    }
    let result = conv::check(global, dynamic::invoke(receiver, &sig, &values))?;
    conv::dyn_to_js(global, result)
}

/// One retained Objective-C object. `appkit.ts` wraps it in a Proxy that
/// turns property access into bound `msgSend` calls.
#[bun_jsc::JsClass]
pub struct ObjCObject {
    object: DynObject,
}

impl ObjCObject {
    pub fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<ObjCObject>> {
        Err(_global.throw_illegal_constructor())
    }

    pub(super) fn wrap(global: &JSGlobalObject, object: DynObject) -> JSValue {
        JsClass::to_js(ObjCObject { object }, global)
    }

    pub(super) fn object(&self) -> &DynObject {
        &self.object
    }

    /// `msgSend(selector, ...args)`.
    pub fn msg_send(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        send(
            global,
            Receiver::Object(&self.object),
            frame,
            "ObjCObject.msgSend()",
        )
    }

    pub fn get_class_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let name = conv::check(global, self.object.class_name())?;
        conv::str_to_js(global, &name)
    }

    pub fn get_is_class(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.object.is_class()))
    }

    pub fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::from_uint64_no_truncate(global, self.object.address() as u64)
    }

    /// Drops the reference now; every later send throws. Idempotent.
    pub fn release(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        self.object.release();
        Ok(JSValue::UNDEFINED)
    }

    pub fn get_released(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.object.is_released()))
    }

    /// `-description`.
    pub fn to_string(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let text = conv::check(global, self.object.description())?;
        conv::utf16_to_js(global, &text)
    }
}

/// One Objective-C class.
#[bun_jsc::JsClass]
pub struct ObjCClass {
    class: DynClass,
}

impl ObjCClass {
    pub fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<ObjCClass>> {
        Err(_global.throw_illegal_constructor())
    }

    pub(super) fn wrap(global: &JSGlobalObject, class: DynClass) -> JSValue {
        JsClass::to_js(ObjCClass { class }, global)
    }

    pub(super) fn class(&self) -> DynClass {
        self.class
    }

    /// `msgSend(selector, ...args)`, sent to the class object.
    pub fn msg_send(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        send(
            global,
            Receiver::Class(&self.class),
            frame,
            "ObjCClass.msgSend()",
        )
    }

    pub fn get_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.class.name())
    }

    pub fn get_address(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        JSValue::from_uint64_no_truncate(global, self.class.address() as u64)
    }

    pub fn to_string(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.class.name())
    }
}

/// `new ObjCSelector(name)` (`objc.sel(name)`): a selector name marked as
/// one, so it fits a `SEL` argument and nothing else.
#[bun_jsc::JsClass]
pub struct ObjCSelector {
    name: String,
}

impl ObjCSelector {
    pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<ObjCSelector>> {
        let name = selector_arg(global, frame.argument(0), "objc.sel(name):")?.into_string();
        if name.is_empty() {
            return Err(global.throw_type_error(format_args!(
                "objc.sel(name): name must be a non-empty string"
            )));
        }
        Ok(Box::new(ObjCSelector { name }))
    }

    pub(super) fn name(&self) -> &str {
        &self.name
    }

    pub fn get_name(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.name)
    }

    pub fn to_string(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        conv::str_to_js(global, &self.name)
    }
}

/// `objcLookupClass(name)`: the class, or a TypeError naming it.
#[bun_jsc::host_fn]
fn objc_lookup_class(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let name = JsStr::new(global, frame.argument(0), format_args!("class name"))?.to_utf8();
    let class = conv::check(global, dynamic::lookup_class(&name))?;
    Ok(ObjCClass::wrap(global, class))
}

/// `objcJs(value)`: Foundation value objects as plain JavaScript data; any
/// other value (wrapped or not) comes back as it was.
#[bun_jsc::host_fn]
fn objc_js(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    let Some(wrapper) = conv::objc_object(value) else {
        return Ok(value);
    };
    match conv::check(global, wrapper.object.to_plain())? {
        Plain::Other(_) => Ok(value),
        plain => plain_to_js(global, plain),
    }
}

fn plain_to_js(global: &JSGlobalObject, plain: Plain) -> JsResult<JSValue> {
    match plain {
        Plain::Null => Ok(JSValue::NULL),
        Plain::String(text) => conv::utf16_to_js(global, &text),
        Plain::Number(n) => Ok(JSValue::js_number(n)),
        Plain::Boolean(b) => Ok(JSValue::js_boolean(b)),
        Plain::Array(items) => JSValue::create_array_from_iter(global, items.into_iter(), |item| {
            plain_to_js(global, item)
        }),
        Plain::Dictionary(entries) => {
            let object = JSValue::create_empty_object(global, entries.len());
            for (key, value) in entries {
                let value = plain_to_js(global, value)?;
                object.put_may_be_index(global, &bun_core::String::clone_utf16(&key), value)?;
            }
            Ok(object)
        }
        Plain::Other(object) => Ok(ObjCObject::wrap(global, object)),
    }
}

/// `objcNs(value)`: the Foundation object for a JavaScript value (`null` for `null`).
#[bun_jsc::host_fn]
fn objc_ns(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    match conv::ns_value(global, frame.argument(0), format_args!("objc.ns()"))? {
        Some(object) => Ok(ObjCObject::wrap(global, object)),
        None => Ok(JSValue::NULL),
    }
}

/// The address a live wrapper (or its proxy) holds; a released handle or an
/// unsent `alloc` has none to compare.
fn address_of(value: JSValue) -> Option<usize> {
    if let Some(o) = conv::objc_object(value) {
        return (!o.object.is_released() && o.object.address() != 0).then(|| o.object.address());
    }
    conv::objc_class(value).map(|c| c.class.address())
}

/// `objcSame(a, b)`: whether two live wrappers (or their proxies) name the same object.
#[bun_jsc::host_fn]
fn objc_same(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let (a, b) = (address_of(frame.argument(0)), address_of(frame.argument(1)));
    Ok(JSValue::js_boolean(
        matches!((a, b), (Some(a), Some(b)) if a == b),
    ))
}

/// Adds the classes and functions above to the `createBinding` object.
pub(super) fn install(global: &JSGlobalObject, binding: JSValue) {
    binding.put(global, b"ObjCObject", ObjCObject::get_constructor(global));
    binding.put(global, b"ObjCClass", ObjCClass::get_constructor(global));
    binding.put(
        global,
        b"ObjCSelector",
        ObjCSelector::get_constructor(global),
    );
    let functions: [(&str, bun_jsc::JSHostFn, u32); 4] = [
        ("objcLookupClass", __jsc_host_objc_lookup_class, 1),
        ("objcJs", __jsc_host_objc_js, 1),
        ("objcNs", __jsc_host_objc_ns, 1),
        ("objcSame", __jsc_host_objc_same, 2),
    ];
    for (name, host_fn, arity) in functions {
        binding.put(
            global,
            name,
            JSFunction::create(global, name, host_fn, arity, Default::default()),
        );
    }
}

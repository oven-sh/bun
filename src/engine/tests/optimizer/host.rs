//! Native code for the scripts, as an embedder would have it.

use core::cell::Cell;

use bun_engine_ffi::{FfiCallback, FfiFunction, NativeType, Signature};
use bun_engine_macros::{cell, native_abi, object_ops};
use bun_engine_text::{Identifier, PropertyName, StringRef, names};
use bun_engine_vm::*;

#[native_abi]
fn get_this(_: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(this)
}

#[native_abi]
fn get_name(cx: &mut Cx, _: Value, name: PropertyName<'_>) -> JsResult<Value> {
    Ok(JsString::from_name(cx, name).into())
}

#[native_abi]
fn get_nothing(_: &mut Cx, _: Value, _: PropertyName<'_>) -> u64 {
    0
}

#[native_abi]
fn get_by_calling(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    cx.invoke(this, names::get, &[])
}

#[native_abi]
fn set_by_calling(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    cx.invoke(this, names::set, &[value]).is_ok()
}

#[native_abi]
fn customs(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    // SAFETY: zero is what functions of the embedder give for undefined.
    let get_nothing: CustomGetter = unsafe { core::mem::transmute(get_nothing as *const ()) };
    let (value, accessor) = (Attributes::CUSTOM_VALUE, Attributes::CUSTOM_ACCESSOR);
    let object = cx.new_object();
    for (name, kind, getter) in [
        ("holder", value, get_this as CustomGetter),
        ("receiver", accessor, get_this),
        ("name", accessor, get_name),
        ("nothing", accessor, get_nothing),
        ("length", accessor, get_by_calling),
    ] {
        let custom = CustomGetterSetter::create(cx, Some(getter), Some(set_by_calling), None);
        object.put_direct_custom(cx, Identifier::from_literal(name).name(), custom, kind);
    }
    Ok(object.into())
}

#[cell(name = "Overriding", ops)]
struct Overriding {
    base: JsObject,
}

#[object_ops]
impl Overriding {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if name != names::name {
            return self.ordinary_get_own_property_slot(cx, name, slot);
        }
        slot.set_cacheable_custom(self, Attributes::CUSTOM_ACCESSOR, get_name);
        Ok(true)
    }
}

#[native_abi]
fn overriding(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let spec = ShapeSpec::of::<Overriding>();
    let base = JsObjectInit::new(cx, Shape::create(cx, Some(cx.global()), Value::NULL, spec));
    Ok(cx.allocate::<Overriding>(OverridingInit { base }).into())
}

#[native_abi]
fn tick(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    thread_local!(static TICKS: Cell<f64> = const { Cell::new(0.0) });
    Ok(TICKS.replace(TICKS.get() + 0.5).into())
}

extern "C" fn same(word: u64) -> u64 {
    word
}

extern "C" fn with_other_upper_bytes(word: u64) -> u64 {
    word ^ 0xa5a5_a5a5_a5a5_a500
}

extern "C" fn same_double(number: f64) -> f64 {
    number
}

extern "C" fn same_float(number: f32) -> f32 {
    number
}

extern "C" fn double_from_bits(bits: u64) -> f64 {
    f64::from_bits(bits)
}

#[rustfmt::skip]
extern "C" fn weigh(
    a: i32, b: f64, c: i64, d: f32, e: u32, f: f64, g: i64, h: f64, i: i64, j: f64, k: i64, l: f64, m: i64, n: f64,
    o: i64, p: f64, q: i64, r: f32, s: i64, t: f64,
) -> f64 {
    let integers = [a.into(), c, e.into(), g, i, k, m, o, q, s].map(|it| it as f64);
    let floats = [b, d.into(), f, h, j, l, n, p, r.into(), t];
    (integers.into_iter().chain(floats)).fold(0.0, |sum, it| sum * 3.0 + it)
}

unsafe extern "C" fn read_after_calling(
    function: extern "C" fn(i32) -> i32,
    bytes: *mut u8,
    length: usize,
) -> i32 {
    let result = function(length as i32);
    // SAFETY: those of a view.
    let bytes = unsafe { core::slice::from_raw_parts_mut(bytes, length) };
    bytes[0] += 1;
    result + bytes.iter().map(|&it| i32::from(it)).sum::<i32>()
}

fn signature(cx: &mut Cx, numbers: &[Value]) -> JsResult<&'static Signature> {
    let mut types = Vec::new();
    for number in numbers {
        types.extend(NativeType::from_number(number.to_uint32(cx)? as u8));
    }
    Ok(Signature::new(&types[1..], types[0]).unwrap())
}

/// The position of the function, the type of the result and those of the arguments.
#[native_abi]
fn foreign(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let targets = [
        same as *const (),
        with_other_upper_bytes as _,
        same_double as _,
        same_float as _,
        double_from_bits as _,
        weigh as _,
        read_after_calling as _,
    ];
    let target = targets[frame.argument(0).to_uint32(cx)? as usize];
    let signature = signature(cx, frame.rest(1))?;
    // SAFETY: up to the script.
    unsafe { FfiFunction::create(cx, signature, target.addr(), StringRef::empty(), None) }
        .map(Into::into)
}

#[native_abi]
fn callback(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let signature = signature(cx, frame.rest(1))?;
    // SAFETY: as above.
    unsafe { FfiCallback::create(cx, signature, frame.argument(0).cast(), None) }.map(Into::into)
}

#[native_abi]
fn run_script(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let text = frame.argument(0).to_string_ref(cx)?;
    let provider = SourceProvider::build(text, None, SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
}

/// A function that runs scripts there. The global object asks the argument first, if there is one.
#[native_abi]
fn new_realm(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let hooks = cx.global().hooks();
    let realm = match frame.argument(0).as_object() {
        Some(sandbox) => SandboxedGlobalObject::create(cx, hooks, sandbox),
        None => GlobalObject::create(cx, hooks),
    };
    Ok(JsFunction::native(cx.in_realm(realm), 1, &StringRef::empty(), run_script).into())
}

/// The namespace of `main`, from a loader of its own and an object that has the text of each module.
#[native_abi]
fn instantiate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (loader, files) = (
        ModuleLoader::create(cx, cx.global().cell()),
        frame.argument(0).to_object(cx)?,
    );
    let keys = files.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
    for key in keys.iter() {
        let text = files.get(cx, key.name())?.to_string_ref(cx)?;
        let provider = SourceProvider::build(text, Some(key.string().clone()), SourceType::Module);
        let code = JsSourceCode::create(cx, SourceCode::whole(provider.finish()));
        let key = ModuleKeyRef::new(key.name(), ModuleType::JavaScript);
        loader.provide_fetch(cx, key, code.into());
    }
    let main = Identifier::from_literal("main");
    let loaded = loader.load_synchronously(cx, &main, None)?;
    assert!(loaded.status() == PromiseStatus::Fulfilled);
    let module = (loader.find_entry_of_any_type(main.name())).and_then(|it| it.record());
    module.unwrap().extensible_namespace(cx).map(Into::into)
}

pub(crate) fn define(cx: &Cx) {
    for (name, function, intrinsic) in [
        ("customs", customs as NativeFunction, Intrinsic::None),
        ("overriding", overriding, Intrinsic::None),
        ("tick", tick, Intrinsic::Clock),
        ("foreign", foreign, Intrinsic::None),
        ("callback", callback, Intrinsic::None),
        ("newRealm", new_realm, Intrinsic::None),
        ("instantiate", instantiate, Intrinsic::None),
    ] {
        let name = Identifier::from_literal(name);
        let function = JsFunction::native_with_intrinsic(cx, 0, name.string(), function, intrinsic);
        (cx.global()).put_direct(cx, name.name(), function.into(), Attributes::NONE);
    }
}

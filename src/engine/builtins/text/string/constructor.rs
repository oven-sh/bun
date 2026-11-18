use bun_engine_bytecode::Visibility;
use bun_engine_text::{StringBuilder, StringRef};
use bun_engine_unicode::MAX_CODE_POINT;
use bun_engine_vm::direct::{self, ToInt32};
use bun_engine_vm::{
    Attributes, GlobalObject, JsFunction, NativeExecutable, RealmSlot, RopeBuilder, StringObject,
};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::fromCharCode, from_char_code, 1)
        .with_intrinsic(Intrinsic::FromCharCode),
    StaticProperty::function(names::fromCodePoint, from_code_point, 1)
        .with_intrinsic(Intrinsic::FromCodePoint),
    StaticProperty::function(names::raw, raw, 1),
    StaticProperty::realm_slot(names::prototype, RealmSlot::string_prototype)
        .with(Attributes::CONSTANT),
]);

#[cell(name = "Function", static_table = PROPERTIES)]
struct StringConstructor {
    base: JsFunction,
}

pub(super) fn initialize(cx: &Cx) {
    let (name, intrinsic) = (names::String, Intrinsic::StringConstructor);
    let name = name.to_identifier().into_string();
    let executable =
        NativeExecutable::shared(cx, 1, name, call, construct, intrinsic, Visibility::Public);
    let (parent, spec) = (
        cx.function_prototype(),
        ShapeSpec::of::<StringConstructor>(),
    );
    let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
    let constructor = cx.allocate::<StringConstructor>(StringConstructorInit {
        base: JsFunction::native_init(cx, shape, executable),
    });
    cx.global().init_string_constructor(constructor.upcast());
}

pub(super) fn initialize_object_shape(cx: &Cx) {
    let (global, spec) = (cx.global(), ShapeSpec::of::<StringObject>());
    let shape = Shape::create(cx, Some(global), cx.string_prototype().into(), spec);
    global.init_string_object_shape(shape);
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match frame.arguments().first() {
        Some(value) => value.to_string_or_description(cx).map(Into::into),
        None => Ok(cx.small_strings.empty().into()),
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = match frame.arguments().first() {
        Some(value) => value.to_string(cx)?,
        None => cx.small_strings.empty(),
    };
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape = cx.shape_from_new_target(new_target, &callee, GlobalObject::string_object_shape)?;
    Ok(StringObject::create(cx, shape, string).into())
}

#[native_abi]
fn from_char_code(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let codes = frame.arguments();
    if let [code] = codes {
        let code = ToInt32(code.to_int32(cx)?);
        return Ok(direct::string::from_char_code(cx, code).into());
    }
    // They have just been stored one by one, and a wider load would have to wait for that.
    if codes.len() <= 8 {
        let is_character = |it: &Value| it.to_bits() ^ Value::NUMBER_TAG <= 0xff;
        let characters = codes.iter().take_while(|it| is_character(it));
        let word = characters.fold((0u64, 0), |(word, count), it| {
            (word | (it.to_bits() & 0xff) << (8 * count), count + 1)
        });
        if let (word, count @ 1..) = word
            && count == codes.len()
        {
            let string = StringRef::try_from_prefix(&word.to_le_bytes(), count);
            return Ok(JsString::new(cx, cx.or_out_of_memory(string)?).into());
        }
    }
    let (in_all, in_any) = (codes.iter()).fold((u64::MAX, 0), |(in_all, in_any), code| {
        (in_all & code.to_bits(), in_any | code.to_bits())
    });
    if in_all < Value::NUMBER_TAG {
        return convert_char_codes(cx, codes);
    }
    let string = if in_any as u16 <= 0xff {
        StringRef::try_write(codes.len(), |cursor| {
            cursor.push_mapped(codes, |code| code.to_bits() as u8);
        })
    } else {
        StringRef::try_write(codes.len(), |cursor| {
            cursor.push_mapped(codes, |code| code.to_bits() as u16);
        })
    };
    Ok(JsString::new(cx, cx.or_out_of_memory(string)?).into())
}

#[inline(never)]
fn convert_char_codes(cx: &mut Cx, codes: &[Value]) -> JsResult<Value> {
    let mut builder = StringBuilder::with_capacity(codes.len());
    for code in codes {
        builder.push_unit(code.to_int32(cx)? as u16);
    }
    cx.finish_string(builder).map(Into::into)
}

#[inline(always)]
fn to_code_point(cx: &mut Cx, value: Value) -> JsResult<u32> {
    if let Some(code_point @ ..=MAX_CODE_POINT) = value.as_index_int32() {
        return Ok(code_point);
    }
    let number = value.to_number(cx)?;
    let code_point = number as u32;
    if f64::from(code_point) != number || code_point > MAX_CODE_POINT {
        let message = "Arguments contain a value that is out of range of code points";
        return Err(cx.throw_range_error(message));
    }
    Ok(code_point)
}

#[native_abi]
fn from_code_point(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if let &[value] = frame.arguments() {
        let code_point = to_code_point(cx, value)?;
        return Ok(JsString::from_code_point(cx, code_point).into());
    }
    let string = StringBuilder::on_stack::<128, _>(|builder| {
        for &value in frame.arguments() {
            builder.push_code_point(to_code_point(cx, value)?);
        }
        cx.or_out_of_memory(builder.take())
    });
    Ok(JsString::new(cx, string?).into())
}

#[native_abi]
fn raw(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.raw requires template not be null or undefined";
    let cooked = frame.argument(0).require_object_coercible(cx, message)?;
    let message = "String.raw requires template.raw not be null or undefined";
    let literals = cooked.to_object(cx)?.get(cx, names::raw)?;
    let literals = (literals.require_object_coercible(cx, message)?).to_object(cx)?;
    let count = literals.length_of_array_like(cx)?;
    let mut substitutions = frame.rest(1).iter();
    let mut builder = RopeBuilder::default();
    for index in 0..count {
        cx.check_traps()?;
        let literal = literals.get_index(cx, index)?.to_string(cx)?;
        builder.push(cx, literal)?;
        if index + 1 < count
            && let Some(substitution) = substitutions.next()
        {
            let substitution = substitution.to_string(cx)?;
            builder.push(cx, substitution)?;
        }
    }
    Ok(builder.finish(cx).into())
}

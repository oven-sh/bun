//! Calls to and from native code.

use core::ffi::{CStr, c_char, c_void};
use std::ffi::CString;
use std::sync::Mutex;

use bun_engine_ffi::{
    Dispatch, FfiCallback, FfiFunction, Invocation, NativeType, Signature, slot_to_value,
    value_to_slot,
};
use bun_engine_number::NumberText;
use bun_engine_text::names;

use super::{object_with, return_zero, string, to_text};
use crate::prelude::*;

pub(super) const VM_FUNCTIONS: Functions = &[
    ("ffiFunction", create_function, 4),
    ("ffiCallback", create_callback, 3),
    ("ffiSignatureString", signature_text, 1),
    ("ffiRead", read, 2),
    ("ffiWrite", write, 3),
    ("ffiCString", read_string, 1),
    ("ffiArenaDepth", return_zero, 0),
    ("drainThreadsafeCallbacks", run_invocations, 0),
];

pub(super) const FIXTURE_FUNCTIONS: Functions = &[
    ("ffiFixture", fixture, 1),
    ("ffiFixtures", fixture_names, 0),
];

const ALIASES: &[(&str, NativeType)] = &[
    ("napi_value", NativeType::Value),
    ("buffer_bytelength", NativeType::BufferLength),
    ("int8_t", NativeType::Int8),
    ("uint8_t", NativeType::Uint8),
    ("int16_t", NativeType::Int16),
    ("uint16_t", NativeType::Uint16),
    ("int32_t", NativeType::Int32),
    ("int", NativeType::Int32),
    ("c_int", NativeType::Int32),
    ("uint32_t", NativeType::Uint32),
    ("c_uint", NativeType::Uint32),
    ("int64_t", NativeType::Int64),
    ("isize", NativeType::Int64),
    ("uint64_t", NativeType::Uint64),
    ("usize", NativeType::Uint64),
    ("size_t", NativeType::Uint64),
    ("double", NativeType::Double),
    ("float", NativeType::Float),
    ("void*", NativeType::Pointer),
    ("pointer", NativeType::Pointer),
    ("char*", NativeType::Pointer),
    ("callback", NativeType::Function),
    ("fn", NativeType::Function),
];

fn get(cx: &mut Cx, object: Value, name: &'static str) -> JsResult<Value> {
    object.get(cx, Identifier::from_literal(name).name())
}

fn to_type(cx: &mut Cx, value: Value) -> JsResult<NativeType> {
    if let Some(number) = value.as_number() {
        let found =
            NativeType::from_number(number as u8).filter(|&it| f64::from(it as u8) == number);
        let text = NumberText::from(number);
        return found
            .ok_or_else(|| cx.throw_type_error(format_args!("Unknown FFI type tag {text}")));
    }
    if !value.is_string() {
        return Err(cx.throw_type_error("An FFI type must be a string or a number"));
    }
    let name = to_text(cx, value)?;
    let mut all =
        (NativeType::ALL.map(|it| (it.name(), it)).into_iter()).chain(ALIASES.iter().copied());
    let found = all.find(|it| it.0 == name).map(|it| it.1);
    found.ok_or_else(|| cx.throw_type_error(format_args!("Unknown FFI type '{name}'")))
}

fn to_signature(cx: &mut Cx, descriptor: Value) -> JsResult<&'static Signature> {
    if !descriptor.is_object() {
        return Err(cx.throw_type_error(
            "Expected an FFI signature descriptor object of the form { args, returns }",
        ));
    }
    let (mut arguments, mut result) = (Vec::new(), NativeType::Void);
    let list = get(cx, descriptor, "args")?;
    if let Some(list) = list.as_object() {
        let (length, most) = (list.length_of_array_like(cx)?, Signature::MAX_ARGUMENTS);
        if length > most as u64 {
            let message = format_args!("FFI signatures support at most {most} arguments");
            return Err(cx.throw_type_error(message));
        }
        for index in 0..length {
            let element = list.get_index(cx, index)?;
            let argument = to_type(cx, element)?;
            if !argument.can_be_argument() {
                let name = argument.name();
                let message = format_args!("FFI argument type '{name}' is not allowed");
                return Err(cx.throw_type_error(message));
            }
            arguments.push(argument);
        }
    } else if !list.is_undefined_or_null() {
        return Err(cx.throw_type_error("FFI signature 'args' must be an array of types"));
    }
    let returns = get(cx, descriptor, "returns")?;
    if !returns.is_undefined_or_null() {
        result = to_type(cx, returns)?;
    }
    Signature::new(&arguments, result).ok_or_else(|| {
        let name = result.name();
        cx.throw_type_error(format_args!("FFI return type '{name}' is not allowed"))
    })
}

fn to_address(cx: &mut Cx, value: Value, function: &str) -> JsResult<usize> {
    match value_to_slot(cx, NativeType::Pointer, value, None)? {
        0 => Err(cx.throw_type_error(format_args!("$vm.{function}: null pointer"))),
        address => Ok(address as usize),
    }
}

#[native_abi]
fn create_function(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let signature = to_signature(cx, frame.argument(0))?;
    let target = to_address(cx, frame.argument(1), "ffiFunction")?;
    let name = match frame.argument(2) {
        name if name.is_undefined_or_null() => StringRef::from_str(&signature.to_string()),
        name => name.to_string_ref(cx)?,
    };
    let owner = match frame.argument(3) {
        options if options.is_object() => get(cx, options, "owner")?.as_object(),
        _ => None,
    };
    // SAFETY: up to the script.
    unsafe { FfiFunction::create(cx, signature, target, name, owner) }.map(Into::into)
}

#[expect(clippy::vec_box, reason = "handed over by address")]
static INVOCATIONS: Mutex<Vec<Box<Invocation>>> = Mutex::new(Vec::new());

unsafe extern "C" fn enqueue(invocation: *mut Invocation, _: *mut c_void) {
    // SAFETY: handed over.
    (INVOCATIONS.lock().unwrap()).push(unsafe { Box::from_raw(invocation) });
}

#[native_abi]
fn run_invocations(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let invocations = core::mem::take(&mut *INVOCATIONS.lock().unwrap());
    for invocation in &invocations {
        // SAFETY: the script is trusted to be on the thread that made the callbacks.
        unsafe { invocation.run() }?;
    }
    Ok(invocations.len().into())
}

#[native_abi]
fn close(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(callback) = frame.this_value().downcast::<FfiCallback>() else {
        let message = "FFICallback.prototype.close called on an incompatible receiver";
        return Err(cx.throw_type_error(message));
    };
    callback.close(cx);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn create_callback(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let signature = to_signature(cx, frame.argument(0))?;
    let Some(callable) = frame.argument(1).as_object().filter(|it| it.is_callable()) else {
        return Err(cx.throw_type_error("$vm.ffiCallback: expected a callable"));
    };
    let options = frame.argument(2);
    let is_threadsafe = options.is_object() && options.get(cx, names::threadsafe)?.to_boolean(cx);
    let dispatch = is_threadsafe.then_some(Dispatch {
        function: enqueue,
        context: core::ptr::null_mut(),
    });
    // SAFETY: up to the script.
    let callback = unsafe { FfiCallback::create(cx, signature, callable, dispatch) }?;
    let prototype = object_with(cx, &[("close", close, 0)], Attributes::DONT_ENUM);
    callback.set_prototype_of(cx, prototype.into(), true)?;
    Ok(callback.into())
}

#[native_abi]
fn signature_text(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let signature = to_signature(cx, frame.argument(0))?;
    Ok(string(cx, &signature.to_string()))
}

/// The address, the type and its size.
fn memory_operand(
    cx: &mut Cx,
    frame: &CallFrame,
    function: &str,
) -> JsResult<(*mut u8, NativeType, usize)> {
    let address = to_address(cx, frame.argument(0), function)?;
    let operand = to_type(cx, frame.argument(1))?;
    let is_plain = (operand as u8) <= NativeType::Pointer as u8
        || matches!(operand, NativeType::Int64Fast | NativeType::Uint64Fast);
    match operand.representation().size().filter(|_| is_plain) {
        Some(size) => {
            let address = core::ptr::with_exposed_provenance_mut(address);
            Ok((address, operand, size.bytes().into()))
        }
        None => {
            let name = operand.name();
            Err(cx.throw_type_error(format_args!("$vm.{function}: unsupported type {name}")))
        }
    }
}

#[native_abi]
fn read(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (address, operand, size) = memory_operand(cx, frame, "ffiRead")?;
    let mut bytes = [0; size_of::<u64>()];
    // SAFETY: up to the script, and a type that any slot is a value of.
    unsafe {
        address.copy_to(bytes.as_mut_ptr(), size);
        let (slot, unused) = (
            u64::from_le_bytes(bytes),
            u64::BITS - size as u32 * u8::BITS,
        );
        let slot = match operand {
            NativeType::Char | NativeType::Int8 | NativeType::Int16 => {
                ((slot << unused) as i64 >> unused) as u64
            }
            _ => slot,
        };
        slot_to_value(cx, operand, slot)
    }
}

#[native_abi]
fn write(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (address, operand, size) = memory_operand(cx, frame, "ffiWrite")?;
    let slot = value_to_slot(cx, operand, frame.argument(2), None)?;
    // SAFETY: up to the script.
    unsafe { address.copy_from(slot.to_le_bytes().as_ptr(), size) };
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn read_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let address = value_to_slot(cx, NativeType::Pointer, frame.argument(0), None)?;
    // SAFETY: up to the script.
    unsafe { slot_to_value(cx, NativeType::CString, address) }
}

/// Names a library with functions for tests to call, and `fixture_name`, which lists them.
const FIXTURES_VARIABLE: &str = "ENGINE_FFI_FIXTURES";

pub(super) fn has_fixtures() -> bool {
    cfg!(unix) && std::env::var_os(FIXTURES_VARIABLE).is_some()
}

/// Zero if there is none.
#[cfg(unix)]
fn find_fixture(name: &CStr) -> usize {
    let path = std::env::var(FIXTURES_VARIABLE).unwrap_or_default();
    let path = CString::new(path).unwrap_or_default();
    // SAFETY: whoever runs the shell vouches for the library.
    unsafe {
        let library = libc::dlopen(path.as_ptr(), libc::RTLD_NOW);
        assert!(!library.is_null(), "cannot load {path:?}");
        libc::dlsym(library, name.as_ptr()).expose_provenance()
    }
}

#[cfg(not(unix))]
fn find_fixture(_: &CStr) -> usize {
    0
}

#[native_abi]
fn fixture(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let name = to_text(cx, frame.argument(0))?;
    match CString::new(name.as_str()).map_or(0, |name| find_fixture(&name)) {
        0 => Err(cx.throw_type_error(format_args!("Unknown FFI fixture '{name}'"))),
        address => Ok(address.into()),
    }
}

#[native_abi]
fn fixture_names(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    type NameAt = unsafe extern "C" fn(usize) -> *const c_char;
    let names = cx.new_array();
    // SAFETY: as above.
    unsafe {
        let name_at = core::mem::transmute::<usize, Option<NameAt>>(find_fixture(c"fixture_name"));
        let all = (0..).map_while(|index| Some(name_at?(index)).filter(|it| !it.is_null()));
        for name in all {
            let name = string(cx, &CStr::from_ptr(name).to_string_lossy());
            names.push(cx, name)?;
        }
    }
    Ok(names.into())
}

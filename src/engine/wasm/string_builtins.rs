//! The builtin set `js-string` (WebAssembly JavaScript Interface, "String Builtins").

use core::cell::Cell;
use core::cmp::Ordering;
use core::slice;

use bun_engine_text::{StringRef, Text};
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{Extern, Provided, StringBuiltin};
use bun_engine_wasm_runtime::{
    Failure, HostCell, Instance, NativeImport, Outcome, Reference, Thrown, char_codes,
};

use crate::instance_cell::WasmInstance;
use crate::prelude::*;

type CharCodes<'a> = Option<&'a [Cell<u16>]>;

/// What an argument stands for.
trait Word {
    /// # Safety
    /// Compiled code has passed it for the corresponding type, and it is used during the call.
    unsafe fn from_word(word: u64) -> Self;
}

impl Word for u32 {
    #[inline(always)]
    unsafe fn from_word(word: u64) -> u32 {
        word as u32
    }
}

impl Word for Value {
    #[inline(always)]
    unsafe fn from_word(word: u64) -> Value {
        // SAFETY: the caller's.
        unsafe { Value::from_bits(word) }
    }
}

impl Word for CharCodes<'_> {
    #[inline(always)]
    unsafe fn from_word(word: u64) -> Self {
        // SAFETY: the caller's. The slice points into the array.
        unsafe { char_codes(Reference(word)) }
    }
}

macro_rules! entries {
    ($($builtin:ident => $function:ident($($argument:ident),*),)*) => {
        fn entry_of(builtin: StringBuiltin) -> NativeImport {
            match builtin {
                $(StringBuiltin::$builtin => {
                    #[native_abi]
                    unsafe fn enter(a: u64, b: u64, c: u64, instance: HostCell) -> Outcome {
                        let [$($argument,)* ..] = [a, b, c];
                        // SAFETY: `link` has seen to the types. What called WebAssembly has lent its `Cx`.
                        unsafe {
                            let instance = Gc::<WasmInstance>::from_address(instance.address());
                            let cx = Cx::from_global(instance.realm());
                            $function(cx, $(Word::from_word($argument)),*).into()
                        }
                    }
                    enter
                })*
            }
        }
    };
}

entries! {
    Cast => cast(value),
    Test => test(value),
    FromCharCodeArray => from_char_code_array(array, start, end),
    IntoCharCodeArray => into_char_code_array(string, array, start),
    FromCharCode => from_char_code(unit),
    FromCodePoint => from_code_point(code_point),
    CharCodeAt => char_code_at(string, index),
    CodePointAt => code_point_at(string, index),
    Length => length(string),
    Concat => concat(first, second),
    Substring => substring(string, start, end),
    Equals => equals(first, second),
    Compare => compare(first, second),
}

/// The import with that index. False, having done nothing, if no builtin takes its place.
pub(crate) fn link(instance: &Instance, index: usize) -> bool {
    let module = instance.module();
    let (Some(Provided::StringBuiltin(builtin)), Extern::Func(func)) =
        (module.provided_import(index), module.imports()[index].item)
    else {
        return false;
    };
    // SAFETY: a builtin is provided only for an import that has its type.
    unsafe { instance.link_native_function(func, entry_of(builtin)) };
    true
}

type Returned = Result<u64, Failure>;

const TRAP: Trap = Trap::IllegalArgument;

#[inline(always)]
fn or_thrown<T>(result: JsResult<T>) -> Result<T, Thrown> {
    result.map_err(|_| Thrown)
}

#[inline(always)]
fn reference(string: Gc<JsString>) -> u64 {
    Value::from(string).to_bits()
}

fn cast(_: &Cx, value: Value) -> Returned {
    Ok(reference(value.as_string().ok_or(TRAP)?))
}

fn test(_: &Cx, value: Value) -> Returned {
    Ok(value.is_string().into())
}

fn from_char_code_array(cx: &Cx, array: CharCodes<'_>, start: u32, end: u32) -> Returned {
    let part = array.and_then(|it| it.get(start as usize..end as usize));
    let part = part.ok_or(TRAP)?;
    // SAFETY: nothing writes to them while they are copied.
    let units = unsafe { slice::from_raw_parts(part.as_ptr().cast::<u16>(), part.len()) };
    if let [unit] = *units {
        return Ok(reference(JsString::from_unit(cx, unit)));
    }
    let text = cx.or_out_of_memory(StringRef::try_narrowed(Text::Utf16(units)));
    Ok(reference(JsString::new(cx, or_thrown(text)?)))
}

fn into_char_code_array(cx: &Cx, string: Value, array: CharCodes<'_>, start: u32) -> Returned {
    let string = string.as_string().ok_or(TRAP)?;
    let end = start as usize + string.len() as usize;
    let part = array.and_then(|it| it.get(start as usize..end));
    let part = part.ok_or(TRAP)?;
    let view = or_thrown(string.view(cx))?;
    // SAFETY: nothing else accesses them meanwhile, and all are written.
    let units = unsafe { slice::from_raw_parts_mut(part.as_ptr().cast_mut().cast(), part.len()) };
    view.text().copy_to::<u16>(units);
    Ok(string.len().into())
}

fn from_char_code(cx: &Cx, unit: u32) -> Returned {
    Ok(reference(JsString::from_unit(cx, unit as u16)))
}

fn from_code_point(cx: &Cx, code_point: u32) -> Returned {
    match code_point {
        ..=0x10_ffff => Ok(reference(JsString::from_code_point(cx, code_point))),
        _ => Err(TRAP.into()),
    }
}

fn char_code_at(cx: &Cx, string: Value, index: u32) -> Returned {
    let string = string.as_string().filter(|it| index < it.len());
    Ok(or_thrown(string.ok_or(TRAP)?.unit_at(cx, index))?.into())
}

fn code_point_at(cx: &Cx, string: Value, index: u32) -> Returned {
    let string = string.as_string().filter(|it| index < it.len());
    let view = or_thrown(string.ok_or(TRAP)?.view(cx))?;
    Ok(view.text().code_point_at(index as usize).into())
}

fn length(_: &Cx, string: Value) -> Returned {
    Ok(string.as_string().ok_or(TRAP)?.len().into())
}

fn concat(cx: &Cx, first: Value, second: Value) -> Returned {
    let (first, second) = first.as_string().zip(second.as_string()).ok_or(TRAP)?;
    Ok(reference(or_thrown(JsString::concat(cx, first, second))?))
}

fn substring(cx: &Cx, string: Value, start: u32, end: u32) -> Returned {
    let string = string.as_string().ok_or(TRAP)?;
    let end = end.min(string.len());
    let part = string.substring(cx, start.min(end), end);
    Ok(reference(or_thrown(part)?))
}

fn equals(cx: &Cx, first: Value, second: Value) -> Returned {
    if let Some((first, second)) = first.as_string().zip(second.as_string()) {
        return Ok(or_thrown(first.equals(cx, &second))?.into());
    }
    let fits = |it: Value| it.is_null() || it.is_string();
    match fits(first) && fits(second) {
        true => Ok((first == second).into()),
        false => Err(TRAP.into()),
    }
}

fn compare(cx: &Cx, first: Value, second: Value) -> Returned {
    let (first, second) = first.as_string().zip(second.as_string()).ok_or(TRAP)?;
    let order: Ordering = or_thrown(first.compare(cx, &second))?;
    Ok((order as i32 as u32).into())
}

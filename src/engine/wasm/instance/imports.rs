//! Reading the imports, each of which is checked before the next is read.

use std::rc::Rc;

use bun_engine_text::{Identifier, StringBuilder};
use bun_engine_vm::{Thrown, errors as vm_errors};
use bun_engine_wasm_format::{
    AbstractHeapType, CanonicalValType, Extern, FuncIndex, GlobalIndex, MemoryIndex, Provided,
    RefType, TableIndex, TagIndex, ValType,
};
use bun_engine_wasm_runtime::{Bits, Instance, LinkError};

use crate::errors::{self, Kind};
use crate::global::{WasmGlobal, opaque_type};
use crate::instance_cell::WasmInstance;
use crate::memory::WasmMemory;
use crate::prelude::*;
use crate::suspension::Suspending;
use crate::table::WasmTable;
use crate::tag::WasmTag;
use crate::{function, string_builtins, values};

/// The module and the field.
pub(crate) type ImportName = (Identifier, Identifier);

/// What comes before the name in the message, and what comes after it.
type Complaint = (&'static str, &'static str);

fn message((before, after): Complaint, (module, field): &ImportName) -> StringBuilder {
    let mut message = StringBuilder::new();
    message.push_ascii(before);
    message.push_latin1(b' ');
    message.push_text(module.name().text());
    message.push_latin1(b':');
    message.push_text(field.name().text());
    message.push_latin1(b' ');
    message.push_ascii(after);
    message
}

pub(super) fn read(cx: &mut Cx, imports: &JsObject, name: &ImportName) -> JsResult<Value> {
    let Some(module) = imports.get(cx, name.0.name())?.as_object() else {
        let message = message(("import", "must be an object"), name);
        return Err(vm_errors::throw_type_error_with_source(cx, message));
    };
    module.get(cx, name.1.name())
}

/// `read` is for those that the engine does not provide.
pub(crate) fn link_imports(
    cx: &mut Cx,
    object: Gc<WasmInstance>,
    mut read: impl FnMut(&mut Cx, &ImportName) -> JsResult<Value>,
) -> JsResult<()> {
    let names = object.module().names(cx)?;
    let instance = object.instance();
    for (index, name) in names.imports.iter().enumerate() {
        if string_builtins::link(instance, index) {
            continue;
        }
        let value = match instance.module().provided_import(index) {
            Some(Provided::StringConstant) => JsString::from_name(cx, name.1.name()).into(),
            _ => read(cx, name)?,
        };
        let linked = match instance.module().imports()[index].item {
            Extern::Func(func) => link_function(instance, func, value),
            Extern::Table(table) => link_table(instance, table, value),
            Extern::Memory(memory) => link_memory(instance, memory, value),
            Extern::Global(global) => link_global(cx, instance, global, value),
            Extern::Tag(tag) => link_tag(instance, tag, value),
        };
        linked.map_err(|complaint| throw_link_error(cx, complaint, name))?;
    }
    Ok(())
}

#[cold]
pub(crate) fn throw_unknown_builtin(cx: &Cx, name: &ImportName) -> Thrown {
    cx.throw_type_error(message(
        ("import", "is not a valid builtin reference"),
        name,
    ))
}

#[cold]
fn throw_link_error(cx: &Cx, complaint: Complaint, name: &ImportName) -> Thrown {
    errors::throw(cx, Kind::Link, message(complaint, name))
}

fn link_function(instance: &Instance, func: FuncIndex, value: Value) -> Result<(), Complaint> {
    if let Some(suspending) = value.downcast::<Suspending>() {
        function::link_suspending_import(instance, func, &suspending);
        return Ok(());
    }
    let callable = value.as_object().filter(|it| it.is_callable());
    let callable = callable.ok_or(("import function", "must be callable"))?;
    function::link_import(instance, func, callable).map_err(|_| {
        let problem = "signature doesn't match the provided WebAssembly function's signature";
        ("imported function", problem)
    })
}

fn link_tag(instance: &Instance, index: TagIndex, value: Value) -> Result<(), Complaint> {
    let tag = value.downcast::<WasmTag>();
    let tag = tag.ok_or(("Tag import", "is not an instance of WebAssembly.Tag"))?;
    tag.link_to(instance, index).map_err(|_| {
        let problem = "signature doesn't match the imported WebAssembly Tag's signature";
        ("imported Tag", problem)
    })
}

fn link_table(instance: &Instance, index: TableIndex, value: Value) -> Result<(), Complaint> {
    const WHAT: &str = "Table import";
    let table = value.downcast::<WasmTable>();
    let table = table.ok_or((WHAT, "is not an instance of WebAssembly.Table"))?;
    let linked = instance.link_table(index, Rc::clone(table.table()));
    linked.map_err(|error| match error {
        LinkError::TooSmall => (WHAT, "provided an 'initial' that is too small"),
        LinkError::NoMaximum => (
            WHAT,
            "does not have a 'maximum' but the module requires that it does",
        ),
        LinkError::MaximumTooLarge => (
            "Imported Table",
            "'maximum' is larger than the module's expected 'maximum'",
        ),
        LinkError::Address => (
            WHAT,
            "provided an 'address' that is different from the module's declared 'address' import table attribute",
        ),
        LinkError::Type | LinkError::Mutability | LinkError::Sharing => {
            (WHAT, "provided a 'type' that is wrong")
        }
    })
}

fn link_memory(instance: &Instance, index: MemoryIndex, value: Value) -> Result<(), Complaint> {
    const WHAT: &str = "Memory import";
    let memory = value.downcast::<WasmMemory>();
    let memory = memory.ok_or((WHAT, "is not an instance of WebAssembly.Memory"))?;
    let linked = instance.link_memory(index, Rc::clone(memory.memory()));
    let problem = |error| match error {
        LinkError::TooSmall => {
            "provided a 'size' that is smaller than the module's declared 'initial' import memory size"
        }
        LinkError::NoMaximum => "did not have a 'maximum' but the module requires that it does",
        LinkError::MaximumTooLarge => {
            "provided a 'maximum' that is larger than the module's declared 'maximum' import memory size"
        }
        LinkError::Sharing => {
            "provided a 'shared' that is different from the module's declared 'shared' import memory attribute"
        }
        LinkError::Address | LinkError::Type | LinkError::Mutability => {
            "provided an 'address' that is different from the module's declared 'address' import memory attribute"
        }
    };
    linked.map_err(|error| (WHAT, problem(error)))
}

fn link_global(
    cx: &mut Cx,
    instance: &Instance,
    index: GlobalIndex,
    value: Value,
) -> Result<(), Complaint> {
    const WHAT: &str = "imported global";
    if let Some(global) = value.downcast::<WasmGlobal>() {
        let linked = instance.link_global(index, Rc::clone(global.global()));
        return linked.map_err(|error| match error {
            LinkError::Mutability => (WHAT, "must be a same mutability"),
            _ => (WHAT, "must be a same type"),
        });
    }
    let declared = instance.module().global(index);
    if declared.mutable {
        let problem = "must be a WebAssembly.Global object since it is mutable";
        return Err((WHAT, problem));
    }
    let ty = instance.module().types().canonical_value(declared.ty);
    let bits = global_value(cx, value, declared.ty, &ty).map_err(|problem| (WHAT, problem))?;
    // SAFETY: converted to that type. Each import is linked once.
    unsafe { instance.link_global_value(index, bits) };
    Ok(())
}

fn global_value(
    cx: &mut Cx,
    value: Value,
    declared: ValType,
    ty: &CanonicalValType,
) -> Result<Bits, &'static str> {
    if let Some(reference) = declared.as_ref() {
        if opaque_type(declared).is_some() {
            return Err("cannot be exnref");
        }
        let converted = values::try_to_reference(value, ty.into()).map(Into::into);
        return converted.ok_or_else(|| problem_with_reference(reference));
    }
    match declared {
        ValType::I64 if !value.is_bigint() => Err("must be a BigInt"),
        ValType::I64 => Ok(()),
        _ if !value.is_number() => Err("must be a number"),
        ValType::V128 => Err("cannot be v128"),
        _ => Ok(()),
    }?;
    let Ok(bits) = values::to_bits(cx, value, ty.into()) else {
        unreachable!("a number of the right kind")
    };
    Ok(bits)
}

fn problem_with_reference(declared: RefType) -> &'static str {
    let is = |ty| declared.heap_type().is(ty);
    if is(AbstractHeapType::Extern) {
        "must be a non-null value"
    } else if !is(AbstractHeapType::Func) {
        "Argument value did not match the reference type"
    } else if declared.is_nullable() {
        "must be a wasm exported function or null"
    } else {
        "must be a wasm exported function"
    }
}

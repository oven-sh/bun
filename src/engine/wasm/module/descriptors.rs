//! What the static methods of `WebAssembly.Module` tell of a module.

use bun_engine_text::Identifier;
use bun_engine_vm::{ArrayBufferContents, Attributes, JsArrayBuffer, errors, options};
use bun_engine_wasm_format::{Extern, Module};

use super::WasmModule;
use crate::prelude::*;
use crate::reflection;
use crate::source::name_in_module;

fn module_argument(cx: &Cx, frame: &CallFrame, method: &str) -> JsResult<Gc<WasmModule>> {
    frame.argument(0).downcast().ok_or_else(|| {
        cx.throw_type_error(format_args!(
            "WebAssembly.Module.{method} called with non WebAssembly.Module argument"
        ))
    })
}

fn kind_of(item: Extern) -> PropertyName<'static> {
    match item {
        Extern::Func(_) => names::function,
        Extern::Table(_) => names::table,
        Extern::Memory(_) => names::memory,
        Extern::Global(_) => names::global,
        Extern::Tag(_) => names::tag,
    }
}

/// `what` is `import` or `export`.
fn describe(
    cx: &mut Cx,
    module: &Module,
    from: Option<&Identifier>,
    name: &Identifier,
    item: Extern,
    what: &str,
) -> JsResult<Value> {
    let descriptor = cx.new_object();
    let members = [
        from.map(|from| (names::module, from.name())),
        Some((names::name, name.name())),
        Some((names::kind, kind_of(item))),
    ];
    for (member, text) in members.into_iter().flatten() {
        let text = JsString::from_name(cx, text).into();
        descriptor.put_direct(cx, member, text, Attributes::NONE);
    }
    if options().use_wasm_type_reflection && !matches!(item, Extern::Tag(_)) {
        let Some(ty) = reflection::extern_type(cx, module, item)? else {
            return Err(cx.throw_type_error(format_args!(
                "WebAssembly.Module.{what}s unable to produce {what} descriptors for the given module"
            )));
        };
        descriptor.put_direct(cx, names::r#type, ty.into(), Attributes::NONE);
    }
    Ok(descriptor.into())
}

#[native_abi]
pub(super) fn exports(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = module_argument(cx, frame, "exports")?;
    let (module, names) = (object.compiled(), object.names(cx)?);
    let result = cx.new_array();
    for (export, name) in module.exports().iter().zip(&names.exports) {
        let descriptor = describe(cx, &module, None, name, export.item, "export")?;
        append(cx, &result, descriptor)?;
    }
    Ok(result.into())
}

/// Without those that the engine provides.
#[native_abi]
pub(super) fn imports(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = module_argument(cx, frame, "imports")?;
    let (module, names) = (object.compiled(), object.names(cx)?);
    let result = cx.new_array();
    for (index, (from, name)) in names.imports.iter().enumerate() {
        if module.provided_import(index).is_none() {
            let item = module.imports()[index].item;
            let descriptor = describe(cx, &module, Some(from), name, item, "import")?;
            append(cx, &result, descriptor)?;
        }
    }
    Ok(result.into())
}

#[native_abi]
pub(super) fn custom_sections(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() < 2 {
        return Err(cx.throw_type_error(errors::NOT_ENOUGH_ARGUMENTS));
    }
    let module = module_argument(cx, frame, "customSections")?.compiled();
    let wanted = frame.argument(1).to_string_view(cx)?;
    let wanted = name_in_module(cx, wanted.text())?;
    let (result, sections) = (cx.new_array(), module.custom_sections().iter());
    for section in sections.filter(|it| Some(module.bytes(it.name)) == wanted.as_deref()) {
        let contents = ArrayBufferContents::try_from_slice(module.bytes(section.payload));
        let contents = cx.or_out_of_memory(contents)?;
        let buffer = JsArrayBuffer::from_contents(cx, cx.array_buffer_shape(), contents)?;
        append(cx, &result, buffer.into())?;
    }
    Ok(result.into())
}

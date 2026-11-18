//! Modules in the graph of ECMAScript modules (WebAssembly ES Module Integration).

use bun_engine_text::{Identifier, StringBuilder, Text};
use bun_engine_vm::{
    AbstractModuleRecord, CyclicModuleRecord, ExportSource, FastHashSet, ForeignModuleOps,
    JsPromise, JsSourceCode, ModuleKeyRef, ModuleLoader, ModuleRequest, ModuleType, Resolution,
    Thrown, options,
};
use bun_engine_wasm_format::Extern;

use crate::compile::{self, Goal};
use crate::compile_options::CompileOptions;
use crate::errors::{self, Kind};
use crate::global::{WasmGlobal, opaque_type};
use crate::instance::{self, ImportName};
use crate::instance_cell::WasmInstance;
use crate::module::WasmModule;
use crate::namespace::{Namespace, Slot};
use crate::prelude::*;

#[cell(name = "WebAssemblyModuleRecord")]
struct Record {
    base: CyclicModuleRecord,
    /// It is linked when the module is evaluated.
    instance: Gc<WasmInstance>,
}

static OPS: ForeignModuleOps = ForeignModuleOps {
    execute,
    read_export,
};

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let spec = ShapeSpec::of::<Record>();
    let shape = Shape::create(cx, Some(cx.global()), Value::NULL, spec);
    namespace.put(Slot::ModuleRecordShape, shape);
}

/// `Hooks::make_wasm_module`
pub fn make_module(
    cx: &mut Cx,
    loader: Gc<ModuleLoader>,
    key: &Identifier,
    code: Gc<JsSourceCode>,
    promise: Gc<JsPromise>,
) -> JsResult<()> {
    if !options().use_wasm {
        return promise.reject_with_caught(cx, cx.throw_type_error("WebAssembly is not enabled"));
    }
    let Text::Latin1(source) = code.anchor().source().text() else {
        unreachable!("bytes")
    };
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(source.len()).is_err() {
        return promise.reject_with_caught(cx, cx.throw_out_of_memory());
    }
    bytes.extend_from_slice(source);
    let key = Value::from_name(cx, key.name()).as_cell().expect("a name");
    let (options, goal) = (CompileOptions::for_imported(), Goal::Record { loader, key });
    compile::settle_later(cx, promise, bytes, options, goal);
    Ok(())
}

fn has_prefix(name: &Identifier, prefix: &'static str) -> bool {
    name.name().text().starts_with(Text::from_ascii(prefix))
}

fn is_reserved(name: &Identifier) -> bool {
    has_prefix(name, "wasm:") || has_prefix(name, "wasm-js:")
}

fn is_builtin_set(name: &Identifier) -> bool {
    name.name().text().eq_ascii("wasm:js-string")
}

fn quoting(before: &str, name: &Identifier, after: &str) -> StringBuilder {
    let mut message = StringBuilder::new();
    message.push_ascii(before);
    message.push_text(name.name().text());
    message.push_ascii(after);
    message
}

#[cold]
fn throw_reserved(cx: &Cx, before: &str, name: &Identifier) -> Thrown {
    errors::throw(cx, Kind::Link, quoting(before, name, "' is reserved"))
}

/// ParseModule, once the bytes are compiled.
pub(crate) fn create(
    cx: &mut Cx,
    loader: Gc<ModuleLoader>,
    key: Value,
    module: Gc<WasmModule>,
) -> JsResult<Value> {
    let key = key.to_property_key(cx)?.to_identifier();
    let namespace = Namespace::of(cx);
    let instance = instance::create(cx, namespace.shape(cx, Slot::InstanceShape), module)?;
    let (compiled, names) = (module.compiled(), module.names(cx)?);
    let imports = names.imports.iter().enumerate();
    let imports = imports.filter(|&(index, _)| compiled.provided_import(index).is_none());
    for (_, (from, field)) in imports.clone() {
        if has_prefix(from, "wasm-js:") {
            return Err(throw_reserved(cx, "Import module '", from));
        }
        if is_reserved(field) {
            return Err(throw_reserved(cx, "Import name '", field));
        }
    }
    if let Some(name) = names.exports.iter().find(|it| is_reserved(it)) {
        return Err(throw_reserved(cx, "Export name '", name));
    }

    let shape = namespace.shape(cx, Slot::ModuleRecordShape);
    let module_type = ModuleType::WebAssembly;
    let record = cx.allocate::<Record>(RecordInit {
        base: CyclicModuleRecord::init(cx, shape, loader, key, module_type, Some(&OPS)),
        instance,
    });
    record.edit_entries(|entries| {
        let mut requested = FastHashSet::default();
        for (_, (from, _)) in imports {
            if !is_builtin_set(from) && requested.insert(from) {
                entries.add_request(ModuleRequest::new(from.clone(), None));
            }
        }
        for name in &names.exports {
            entries.add_export(name.clone(), ExportSource::Local(name.clone()));
        }
    });
    record.create_environment_for_exports(cx);
    Ok(record.into())
}

/// The value that the binding has now.
fn read_import(cx: &mut Cx, record: &AbstractModuleRecord, name: &ImportName) -> JsResult<Value> {
    let (from, field) = name;
    if is_builtin_set(from) {
        return Err(instance::throw_unknown_builtin(cx, name));
    }
    let request = ModuleKeyRef::new(from.name(), ModuleType::JavaScript);
    let imported = record.imported_module(request).expect("it was requested");
    let problem = match imported.resolve_export(cx, field) {
        Resolution::Resolved(binding) if binding.is_live() => {
            return match binding.module == imported {
                true => imported.get_live_export(cx, binding.name.name()),
                false => (binding.module).get_reexported_live_export(cx, binding.name.name()),
            };
        }
        Resolution::Resolved(binding) => {
            let bound = binding.prepare(cx)?;
            let value = bound.and_then(|(scope, index)| scope.read_variable(cx, index));
            let unbound_export = || {
                let exports = binding.module.downcast::<Record>()?.instance.exports()?;
                exports.get_direct(binding.name.name())
            };
            return Ok(value.or_else(unbound_export).unwrap_or_default());
        }
        Resolution::NotFound => "' is not found.",
        Resolution::Ambiguous => "' cannot be resolved due to ambiguous multiple bindings.",
        Resolution::NoDefault => "' cannot be resolved by star export entries.",
    };
    Err(cx.throw_syntax_error(quoting("Importing binding name '", field, problem)))
}

/// `None` leaves the binding uninitialized.
fn binding_for(cx: &Cx, item: Extern, exported: Value) -> JsResult<Option<Value>> {
    let Extern::Global(_) = item else {
        return Ok(Some(exported));
    };
    let object = exported.cast::<WasmGlobal>();
    let global = object.anchor().global();
    if opaque_type(global.ty().erased()).is_some() {
        return Ok(None);
    }
    match global.is_mutable() {
        true => Ok(Some(exported)),
        false => object.value(cx).map(Some),
    }
}

fn execute(cx: &mut Cx, record: Gc<CyclicModuleRecord>) -> JsResult<()> {
    let cx = cx.in_realm_of(&record);
    let instance = record.cast::<Record>().instance;
    instance::link_imports(cx, instance, |cx, name| read_import(cx, &record, name))?;
    let (environment, mut index) = (record.environment().expect("made with it"), 0);
    instance::run_binding_exports(cx, instance, |cx, item, exported| {
        let value = binding_for(cx, item, exported)?;
        // SAFETY: its initialization. There is a slot for each export, in order.
        unsafe { environment.set(index, value) };
        index += 1;
        Ok(())
    })
}

/// The binding for a mutable global is live.
fn read_export(cx: &mut Cx, value: Value) -> JsResult<Option<Value>> {
    let global = value.downcast::<WasmGlobal>();
    let global = global.filter(|it| it.global().is_mutable());
    global.map(|it| it.value(cx)).transpose()
}

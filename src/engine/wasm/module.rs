//! `WebAssembly.Module`

mod descriptors;
mod property_names;

use core::cell::OnceCell;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_text::StringRef;
use bun_engine_vm::{
    GcFree, JsCell, JsDestructibleObject, Visitor, Vm, WasmModuleDescription, errors as vm_errors,
};
use bun_engine_wasm_runtime::{CompileError, Compiled, Module};

pub(crate) use self::property_names::Names;
use crate::compile_options::CompileOptions;
use crate::engine::engine;
use crate::errors::{self, Kind};
use crate::namespace::{Namespace, Slot, shape_for_new_target};
use crate::prelude::*;
use crate::source;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::position_of(names::constructor),
    StaticProperty::string(symbols::toStringTag, names::wasmModule),
]);

define_object!(Prototype, "WebAssembly.Module", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    member(StaticProperty::function(names::customSections, descriptors::custom_sections, 2)),
    member(StaticProperty::function(names::imports, descriptors::imports, 1)),
    member(StaticProperty::function(names::exports, descriptors::exports, 1)),
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
]);

define_constructor!(Constructor, CONSTRUCTOR_PROPERTIES, call, construct);

struct Shared(Arc<Module>);

// SAFETY: threads share it, and it knows of no heap.
unsafe impl GcFree for Shared {}

#[cell(
    name = "WebAssembly.Module",
    cell_type = WasmModule,
    export = "engine_class_WasmModule",
    visit_children
)]
pub(crate) struct WasmModule {
    base: JsDestructibleObject,
    module: Shared,
    names: OnceCell<Rc<Names>>,
    /// What the heap knows of the footprint.
    reported_bytes: AtomicUsize,
}

impl WasmModule {
    pub(crate) fn create(cx: &Cx, shape: Gc<Shape>, module: Arc<Module>) -> Gc<WasmModule> {
        let size = module.footprint();
        let object = cx.allocate::<WasmModule>(WasmModuleInit {
            base: JsObjectInit::new(cx, shape),
            module: Shared(module),
            names: OnceCell::new(),
            reported_bytes: AtomicUsize::new(size),
        });
        cx.heap.report_extra_memory_allocated(&object, size);
        if let Some(realm) = shape.global()
            && let Some(debugger) = realm.debugger()
        {
            debugger.did_create_wasm_module(cx.in_realm_shared(realm), object.cell());
        }
        object
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        let footprint = self.module.0.footprint();
        if visitor.is_first_visit() {
            self.reported_bytes.fetch_max(footprint, Ordering::Relaxed);
        }
        visitor.report_extra_memory(footprint);
    }

    /// Does not collect.
    pub(crate) fn report_growth(&self, vm: &Vm) {
        const WORTH_REPORTING: usize = 512;
        let footprint = self.module.0.footprint();
        let added = footprint.saturating_sub(self.reported_bytes.load(Ordering::Relaxed));
        if added >= WORTH_REPORTING {
            self.reported_bytes.fetch_max(footprint, Ordering::Relaxed);
            let _defer = vm.heap.defer_collection();
            vm.heap.report_extra_memory_allocated(self, added);
        }
    }

    pub(crate) fn compiled(&self) -> Arc<Module> {
        Arc::clone(&self.module.0)
    }

    pub(crate) fn names(&self, cx: &Cx) -> JsResult<Rc<Names>> {
        if let Some(names) = self.names.get() {
            return Ok(Rc::clone(names));
        }
        let names = cx.or_out_of_memory(Names::of(&self.module.0))?;
        Ok(Rc::clone(self.names.get_or_init(|| Rc::new(names))))
    }
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    let spec = ShapeSpec::of::<WasmModule>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::ModuleShape, shape);
    let parent = cx.function_prototype();
    let constructor = Constructor::create(cx, parent, 1, names::Module, &prototype);
    namespace.put(Slot::ModuleConstructor, constructor);
}

/// `Hooks::describe_wasm_module`
pub fn describe_module(object: Gc<JsCell>) -> WasmModuleDescription {
    let module = object.cast::<WasmModule>().compiled();
    let text = |bytes| StringRef::try_from_utf8_lossy(bytes).unwrap_or_default();
    let name = module.names().and_then(|it| it.module());
    WasmModuleDescription {
        name: text(module.bytes(name.unwrap_or_default())),
        source_map_url: text(module.source_map_url().unwrap_or_default().as_bytes()),
        end_of_code: module.end_of_code(),
    }
}

/// HostEnsureCanCompileWasmBytes
pub(crate) fn check_is_enabled(cx: &Cx) -> JsResult<()> {
    let message = cx.global().webassembly_disabled_message().borrow().clone();
    message.map_or(Ok(()), |it| Err(errors::throw(cx, Kind::Compile, it)))
}

/// On this thread, with the help of others.
pub(crate) fn compile_now(bytes: Vec<u8>) -> Compiled {
    engine().ok_or(CompileError::OutOfMemory)?.compile(bytes)
}

/// The object for what has just been compiled.
pub(crate) fn finish(
    cx: &Cx,
    shape: Gc<Shape>,
    compiled: Compiled,
    options: &CompileOptions,
) -> JsResult<Gc<WasmModule>> {
    match compiled.and_then(|module| options.apply_to(&module).map(|()| module)) {
        Ok(module) => Ok(WasmModule::create(cx, shape, module)),
        Err(CompileError::OutOfMemory) => Err(cx.throw_out_of_memory()),
        Err(CompileError::Invalid(error)) => {
            Err(errors::throw(cx, Kind::Compile, format_args!("{error}")))
        }
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(
        cx,
        "WebAssembly.Module",
    ))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    check_is_enabled(cx)?;
    let bytes = source::copy_bytes(cx, frame.argument(0))?;
    let options = optional_object(cx, frame.argument(1), "second", "Module")?;
    let options = CompileOptions::read(cx, options)?;
    let shape = shape_for_new_target(cx, frame, Slot::ModuleShape)?;
    finish(cx, shape, compile_now(bytes), &options).map(Into::into)
}

/// For imports and options. `position` is that of the argument.
pub(crate) fn optional_object(
    cx: &Cx,
    value: Value,
    position: &str,
    function: &str,
) -> JsResult<Option<Gc<JsObject>>> {
    if value.is_undefined() || value.is_object() {
        return Ok(value.as_object());
    }
    Err(vm_errors::throw_type_error_with_source(
        cx,
        format_args!(
            "{position} argument to WebAssembly.{function} must be undefined or an Object"
        ),
    ))
}

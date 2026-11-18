//! Exported Functions (js-api), which are also what a `funcref` refers to.

use core::cell::UnsafeCell;
use core::mem::offset_of;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_asm::Bank;
use bun_engine_bytecode::{Specialization, Visibility};
use bun_engine_number::NumberText;
use bun_engine_text::StringRef;
use bun_engine_vm::call::{WasmCallee, WasmKind, WasmPlace, native_not_a_constructor};
use bun_engine_vm::{
    CellType, GcFree, Intrinsic, JsCell, JsFunction, NativeExecutable, NativeFunction, Visitor,
};
use bun_engine_wasm_compiler::abi::{Callable, InstanceLayout, Place, Signature, frame};
use bun_engine_wasm_format::{FuncIndex, HeapType, Rtt, ValKind, ValType};
use bun_engine_wasm_runtime::interpreted::{Entry, Linkage};
use bun_engine_wasm_runtime::{Incoming, Instance, LinkError, Outgoing, Reference, Thrown};

use crate::host::realm_of;
use crate::instance_cell::WasmInstance;
use crate::namespace::{Namespace, Slot};
use crate::owned::host_cell;
use crate::prelude::*;
use crate::stubs::Direction;
use crate::suspension::{self, Suspending};
use crate::{calls, traps, values};

/// The data of an import that was a `WebAssembly.Suspending`.
pub(crate) const SUSPENDS: usize = 1;

/// The run time fills it in before anything sees the function.
#[repr(C)]
struct Target {
    callable: UnsafeCell<Callable>,
    stack_bytes: UnsafeCell<usize>,
}

// SAFETY: `visit_children` visits the instance.
unsafe impl GcFree for Target {}

#[cell(name = "WebAssemblyFunction", visit_children)]
pub(crate) struct WasmFunction {
    base: JsFunction,
    target: Target,
    /// The function of a script that the instance has imported as this one.
    imported: Option<Gc<JsObject>>,
}

impl WasmFunction {
    pub(crate) const OFFSET_OF_CALLABLE: usize = offset_of!(WasmFunction, target);

    pub(crate) fn create(cx: &Cx, instance: &Instance, func: FuncIndex) -> Gc<WasmFunction> {
        let ty = instance.module().func_type(func);
        let length = ty.params.len() as u32;
        let (imported, data) = instance.host_function(func).unzip();
        let imported = imported.and_then(|it| values::from_reference(it).as_object());
        let executable = if imported.is_some() {
            let can_cross = ty
                .params
                .iter()
                .chain(ty.results)
                .all(|&it| values::can_cross(it));
            NativeExecutable::shared(
                cx,
                length,
                StringRef::empty(),
                match (can_cross, data) {
                    (false, _) => refuse,
                    (true, Some(SUSPENDS)) => refuse_to_suspend,
                    (true, _) => call_imported,
                },
                native_not_a_constructor,
                Intrinsic::None,
                Visibility::Public,
            )
        } else {
            let engine = instance.store().engine();
            // Where nothing is compiled a stack trace shows the frames of the interpreter in its place.
            let (call, visibility) = match engine.compiles() {
                true => (call_again as NativeFunction, Visibility::Public),
                false => (call_interpreted as NativeFunction, Visibility::Private),
            };
            let executable = NativeExecutable::create(
                cx,
                length,
                StringRef::from_text(NumberText::from(func.0).text()),
                call,
                native_not_a_constructor,
                Intrinsic::WasmFunction,
                visibility,
            );
            if engine.compiles() {
                // SAFETY: only the function below has the executable.
                unsafe { executable.install(Specialization::Call, engine.enter_stub(), None) };
            }
            executable
        };
        let shape = Namespace::of(cx).shape(cx, Slot::FunctionShape);
        cx.allocate::<WasmFunction>(WasmFunctionInit {
            base: JsFunction::native_init(cx, shape, executable),
            target: Target {
                callable: UnsafeCell::new(Callable {
                    slot: 0,
                    instance: 0,
                    rtt: 0,
                }),
                stack_bytes: UnsafeCell::new(0),
            },
            imported,
        })
    }

    fn callable(&self) -> Callable {
        // SAFETY: it does not change any more.
        unsafe { *self.target.callable.get() }
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        // SAFETY: an aligned word, which is zero or the address of the instance.
        unsafe {
            let instance = &raw mut (*self.target.callable.get()).instance;
            match AtomicUsize::from_ptr(instance).load(Ordering::Relaxed) {
                0 => {}
                instance => visitor.append(Gc::<JsCell>::from_address(instance)),
            }
        }
    }

    /// The instance, and the index that the function has there.
    pub(crate) fn origin<'a>(&self) -> (&'a Instance, FuncIndex) {
        let Callable { slot, instance, .. } = self.callable();
        // SAFETY: what the run time wrote, and `visit_children` visits.
        let instance = unsafe { Gc::<WasmInstance>::from_address(instance) }.instance();
        (instance, instance.func_with_slot(slot))
    }

    /// While it is called through the stub for all types, with values that scripts have.
    pub(crate) fn prepare_for_more_calls(&self) {
        let (executable, (instance, func)) = (self.executable(), self.origin());
        if !instance.module().engine().compiles() {
            return;
        }
        if executable.entry(Specialization::Call) == instance.module().engine().enter_stub()
            && let Some(entry) = stub_for(instance, Direction::FromScript, func)
        {
            // SAFETY: made for the type. The function keeps the instance, and that the code.
            unsafe { executable.install(Specialization::Call, entry, None) };
        }
    }

    pub(crate) fn has_type(&self, expected: &Rtt) -> bool {
        // SAFETY: the instance keeps it.
        let rtt = unsafe { &*core::ptr::with_exposed_provenance::<Rtt>(self.callable().rtt) };
        rtt.is_subtype_of(expected)
    }
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let (prototype, spec) = (cx.function_prototype(), ShapeSpec::of::<WasmFunction>());
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::FunctionShape, shape);
}

fn kind_of_parameter(ty: ValType) -> Option<WasmKind> {
    Some(match ty.kind() {
        ValKind::I32 => WasmKind::I32,
        ValKind::I64 => WasmKind::I64,
        ValKind::F32 => WasmKind::F32,
        ValKind::F64 => WasmKind::F64,
        _ if ty == ValType::EXTERNREF => WasmKind::Value,
        _ if ty == HeapType::EXTERN.non_null().into() => WasmKind::NonNullValue,
        _ => return None,
    })
}

/// See `Hooks::wasm_callee`.
pub fn describe_callee(function: &JsObject) -> Option<WasmCallee> {
    let function = (function.downcast::<WasmFunction>()).filter(|it| it.imported.is_none())?;
    let (instance, func) = function.origin();
    if !instance.module().engine().compiles() {
        return None;
    }
    let ty = instance.module().func_type(func);
    let result = match *ty.results {
        [] => None,
        [ty] if values::can_cross(ty) => Some(kind_of_parameter(ty).unwrap_or(WasmKind::Value)),
        _ => return None,
    };
    let signature = Signature::new(ty);
    let from_stack_pointer = |offset| (offset + frame::CALLEE_FRAME_FROM_STACK_POINTER) as u32;
    let parameter = |(&ty, &place): (&ValType, &Place)| {
        let place = match place {
            Place::Register(reg) => WasmPlace::Register(match reg.bank() {
                Bank::Gpr => reg.gpr().number(),
                Bank::Fpr => reg.fpr().number(),
            }),
            Place::Stack(offset) => WasmPlace::Stack(from_stack_pointer(offset)),
        };
        Some((kind_of_parameter(ty)?, place))
    };
    let parameters = ty.params.iter().zip(&signature.params).map(parameter);
    Some(WasmCallee {
        instance: function.callable().instance,
        slot: function.callable().slot,
        offset_of_memory_base: InstanceLayout::memory_base(instance.module().engine().layout()),
        parameters: parameters.collect::<Option<_>>()?,
        result,
        outgoing_bytes: from_stack_pointer(frame::ARGUMENTS) + signature.stack_bytes,
    })
}

/// The one object for the function.
pub(crate) fn exported(cx: &Cx, instance: &Instance, func: FuncIndex) -> JsResult<Value> {
    let reference = instance.function_reference(func);
    (reference.map(values::from_reference)).map_err(|trap| traps::throw(cx, trap))
}

/// Panics if the object cannot be called.
pub(crate) fn link_import(
    instance: &Instance,
    func: FuncIndex,
    callable: Gc<JsObject>,
) -> Result<(), LinkError> {
    if callable.is::<WasmFunction>() {
        // SAFETY: a `funcref`, of the one store of the heap.
        return unsafe { instance.link_function(func, host_cell(callable.cell())) };
    }
    link_host_function(instance, func, callable, 0);
    Ok(())
}

pub(crate) fn link_suspending_import(instance: &Instance, func: FuncIndex, import: &Suspending) {
    link_host_function(instance, func, import.wrapped(), SUSPENDS);
}

fn link_host_function(instance: &Instance, func: FuncIndex, callable: Gc<JsObject>, data: usize) {
    assert!(callable.is_callable());
    // Where nothing is compiled the interpreter calls the host itself, with no stub in between.
    let engine = instance.store().engine();
    let stub = if engine.compiles() {
        engine.host_call_stub()
    } else {
        0
    };
    let function = Reference(callable.as_value().to_bits());
    // SAFETY: the stub takes calls of any type.
    unsafe { instance.link_host_function(func, stub, function, data) };
}

fn stub_for(instance: &Instance, direction: Direction, func: FuncIndex) -> Option<usize> {
    let (object, module) = (WasmInstance::of(instance), instance.module());
    (object.stubs()).address(module, direction, module.func_type_index(func))
}

/// For an import that does not suspend, with values that scripts have. Returns whether it has one now that it did
/// not have before.
pub(crate) fn give_import_its_own_stub(
    instance: &Instance,
    func: FuncIndex,
    callee: Value,
) -> bool {
    if !instance.store().engine().compiles() {
        return false;
    }
    let has_executable = |cell: Gc<JsCell>| CellType::FUNCTIONS.contains(cell.cell_type());
    let stub = (callee.as_cell().is_some_and(has_executable))
        .then(|| stub_for(instance, Direction::ToScript, func));
    // SAFETY: made for the type and for such a callee. The instance keeps the code.
    (stub.flatten()).is_some_and(|it| unsafe { instance.replace_stub_of_import(func, it) } != it)
}

/// For those who call the native function and not the entry of the executable.
#[native_abi]
fn call_again(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    cx.call(frame.callee().into(), Value::UNDEFINED, frame.arguments())
}

/// What the run time has thrown is pending in the `Vm`.
pub(crate) fn already_thrown(cx: &Cx) -> JsResult<Value> {
    cx.check_exception()?;
    Err(cx.throw_out_of_memory())
}

/// Where nothing is compiled. The frames of the interpreter stand on the stack of this call.
#[native_abi]
fn call_interpreted(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let function = frame.callee().cast::<WasmFunction>();
    let (instance, _) = function.origin();
    // The frames of the interpreter take the place of this one, which a stack trace does not show.
    let linkage = Linkage {
        frame: frame.address(),
        caller: frame.caller_address(),
        return_address: 0,
    };
    let engine = instance.store().engine();
    // SAFETY: a `funcref` that the frame keeps, and the host has nothing compiled to call.
    let entry = unsafe { Entry::new(engine, host_cell(function.cell()), linkage) };
    let Ok(entry) = entry else {
        return already_thrown(cx);
    };
    let put = |arguments: Outgoing<'_>| {
        calls::put_arguments(cx, function, frame, arguments).map_err(|_| Thrown)
    };
    let take = |results: Incoming<'_>| {
        calls::take_results(realm_of(instance), &results).map_err(|_| Thrown)
    };
    match bun_engine_wasm_interpreter::call(&entry, put, take) {
        Ok(Some(value)) => Ok(value),
        // It goes on when a promise is settled, and the result is not this one.
        Ok(None) => Ok(Value::UNDEFINED),
        Err(Thrown) => already_thrown(realm_of(instance)),
    }
}

#[native_abi]
fn call_imported(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let imported = frame.callee().cast::<WasmFunction>().imported;
    let imported = imported.expect("only these have this function");
    cx.call(imported.into(), Value::UNDEFINED, frame.arguments())
}

#[native_abi]
fn refuse_to_suspend(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(suspension::throw_not_in_promising_call(cx))
}

#[native_abi]
fn refuse(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(cx.throw_type_error(values::INVALID_SIGNATURE))
}

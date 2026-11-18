use core::cmp::Ordering;

use bun_engine_bytecode::Code;
use bun_engine_bytecode::{BuiltinFunction, FunctionKind, FunctionRef, Visibility};
use bun_engine_text::Identifier;

use crate::heap::{Scope, Survivors};
use crate::{
    BuiltinId, CallFrame, CodeBlock, CoverageCount, Cx, Gc, GlobalObject, Intrinsic, JsCell,
    JsObject, JsPromise, JsResult, JsSourceCode, JsString, ModuleLoader, PropertyCondition,
    RealmSlot, RealmWatchpoint, SampledWasmFrame, ScriptExecutable, Tier, Value, Visitor, Vm,
    WasmFrame, WasmModuleDescription, WasmNames,
};

/// What this crate needs from those above it.
pub struct Hooks {
    /// The entry of an executable whose code is interpreted.
    pub interpreter_entry: usize,
    /// Gives a new code block the machine code that there is for its code. Returns the entry.
    pub adopt_machine_code: fn(&CodeBlock) -> usize,
    /// Where code that is not optimized goes on at the handler at that offset.
    pub catch_address: fn(&CodeBlock, u32) -> usize,
    pub native_call_entry: fn(&Vm, Intrinsic) -> usize,
    pub jettison: fn(&Vm, &CodeBlock),
    /// The counter of the tier that runs the frame has run out, at the entry or at the head of a loop. Returns where to go
    /// on in the same frame, or zero.
    pub tier_up: fn(&Vm, Tier, &CodeBlock, &CallFrame, Option<u32>) -> usize,
    /// Code that counts its blocks is being linked. Returns a count for each.
    pub cover: fn(&Vm, &ScriptExecutable, &Code) -> Box<[CoverageCount]>,
    /// Sets the eager slots but `global_this`.
    pub initialize_realm: fn(&Cx),
    pub initialize_realm_slot: fn(&Cx, RealmSlot),
    /// `None` if it does not hold any more.
    pub realm_watchpoint_conditions: fn(&Cx, RealmWatchpoint) -> Option<Vec<PropertyCondition>>,
    pub did_start_having_a_bad_time: fn(&Vm, &GlobalObject),
    pub builtin_source: fn(BuiltinId) -> &'static BuiltinSource,
    /// `localeCompare` without options, in the locale with that name or the default one.
    pub compare_in_locale:
        fn(&Cx, Gc<JsString>, Gc<JsString>, Option<Gc<JsString>>) -> JsResult<Ordering>,
    /// `toLocaleString` of an instance of a class of `Temporal`, with the locales and the options.
    pub temporal_to_locale_string: fn(&mut Cx, Gc<JsObject>, Value, Value) -> JsResult<Value>,
    /// Of a `WebAssembly.Memory`, by so many pages. Returns whether it has grown.
    pub grow_wasm_memory: fn(&mut Cx, Gc<JsObject>, usize) -> bool,
    /// With the address of a native function or a custom getter, and the receiver.
    pub kept_result_of_wasm_getter: fn(usize, &JsObject) -> Option<crate::ic::KeptResult>,
    /// Settles the promise with the record of the module whose bytes are the Latin-1 characters of the source.
    pub make_wasm_module:
        fn(&mut Cx, Gc<ModuleLoader>, &Identifier, Gc<JsSourceCode>, Gc<JsPromise>) -> JsResult<()>,
    /// Where the frame goes on if it catches the pending exception, given the address that its callee returns to.
    pub find_wasm_handler: fn(&Vm, &CallFrame, usize) -> Option<usize>,
    /// Whether it would catch the value.
    pub wasm_frame_catches: fn(&CallFrame, usize, Value) -> bool,
    /// Of a function with `Intrinsic::WasmFunction`. `None` if it takes the entry.
    pub wasm_callee: fn(&JsObject) -> Option<crate::call::WasmCallee>,
    /// With the address that the callee returns to, or zero if the frame has called an operation, and the number of
    /// inlined functions that have been visited.
    pub wasm_frame: fn(&Vm, &CallFrame, usize, u32) -> WasmFrame,
    /// What a frame was running since the last collection, from the words for the code block and the callee and an
    /// address in its code. They may be anything.
    pub sampled_wasm_frame: fn(&Vm, usize, u64, usize) -> Option<SampledWasmFrame>,
    /// Of the function with that index. The cell may have just died.
    pub wasm_names: fn(Gc<JsCell>, u32) -> WasmNames,
    /// Of a `WebAssembly.Module`.
    pub describe_wasm_module: fn(Gc<JsCell>) -> WasmModuleDescription,
    /// The last moment at which the heap can tell which cells are alive.
    pub will_mark: fn(&Vm),
    pub visit_roots: fn(&Vm, &mut Visitor),
    /// With the words on the stack that point into executable memory.
    pub visit_code_on_stack: fn(&Vm, &[usize], &mut Visitor),
    pub reconcile_weak_references: fn(&Vm, &Survivors),
    pub did_collect: fn(&Vm, Scope),
    pub will_destroy: fn(&Vm),
}

/// A function of the standard library that is written in JavaScript.
pub struct BuiltinSource {
    pub name: &'static str,
    /// A strict function expression without a name, in parentheses.
    pub text: &'static str,
    pub parameters_start: u32,
    pub length: u32,
    pub is_async: bool,
    pub is_generator: bool,
    pub is_constructor: bool,
    pub is_always_inlined: bool,
    pub visibility: Visibility,
    pub intrinsic: Intrinsic,
}

impl BuiltinSource {
    pub(crate) fn to_function(&self) -> FunctionRef {
        BuiltinFunction {
            name: Identifier::from_literal(self.name),
            range: 1..self.text.len() as u32 - 1,
            parameters_start: self.parameters_start,
            length: self.length,
            kind: if self.is_constructor {
                FunctionKind::NakedConstructor
            } else {
                FunctionKind::Method
            },
            is_strict: true,
            is_async: self.is_async,
            is_generator: self.is_generator,
            visibility: self.visibility,
            has_positions: false,
        }
        .into_function()
    }
}

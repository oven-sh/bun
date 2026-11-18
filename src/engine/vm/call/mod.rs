//! Calls from native code, and the code that every tier enters and leaves frames through.

mod repeated;
mod section;
#[cfg_attr(target_arch = "aarch64", path = "stubs_aarch64.rs")]
#[cfg_attr(target_arch = "x86_64", path = "stubs_x86_64.rs")]
pub mod stubs;
mod unwind;
mod wasm;

use std::rc::Rc;

use bun_engine_bytecode::{Code, Specialization};
use bun_engine_macros::{FieldOffsets, native_abi};

pub use repeated::RepeatedCall;
pub use section::code_in_call_frames;
pub use unwind::unwind;
pub use wasm::{WasmCallee, WasmKind, WasmPlace};

use crate::heap::stack::stack_pointer;
use crate::scope::{is_chain_of, is_instance_of};
use crate::{
    CallFrame, CellType, CodeBlock, Coroutine, Cx, Executable, Forbidden, FunctionExecutable, Gc,
    InternalFunction, JsBoundFunction, JsCell, JsFunction, JsObject, JsResult, NativeExecutable,
    ScriptExecutable, TypeFlags, Value, Vm, errors,
};

/// `cx` is the realm of the function.
#[native_abi]
pub type NativeFunction = fn(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value>;

pub const MAX_ARGUMENTS: usize = 0x10_0000;

macro_rules! addresses {
    ($($(#[$doc:meta])* $name:ident,)*) => {$(
        $(#[$doc])*
        #[inline(always)]
        pub fn $name() -> usize {
            stubs::$name as *const () as usize
        }
    )*};
}

addresses! {
    native_call_entry,
    native_construct_entry,
    internal_function_call_entry,
    internal_function_construct_entry,
    /// In place of the executable it gets the `NativeFunction`, and calls it in the realm of the shape of the callee.
    call_data_entry,
    link_call_entry,
    link_construct_entry,
    watched_call_entry,
    watched_construct_entry,
    rare_data_call_entry,
    rare_data_construct_entry,
    /// Of a code block that is not installed. These go by the callee.
    replaced_call_entry,
    replaced_construct_entry,
    /// To jump to with an exception pending and the frame pointer at the frame that throws it.
    throw_from_frame,
    /// Where an exception leaves generated code, with the frame pointer at the entry frame.
    return_to_native_code_with_exception,
    /// To call right after the prologue, with the number of parameters including `this` in the first argument
    /// register. Moves the frame and both pointers to it down. The caller has checked that the stack has room.
    pad_arguments,
}

#[native_abi]
fn link_calls_again(caller: &CodeBlock) {
    caller.link_calls_again();
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
enum CallKind {
    None,
    Native,
    Script,
}

/// How an object is called.
#[derive(Clone, Copy, FieldOffsets)]
#[repr(C)]
pub struct CallData {
    kind: CallKind,
    /// The `NativeFunction` or the `FunctionExecutable`.
    target: usize,
    /// The scope, or whether it is a bound function.
    detail: usize,
}

impl !crate::GcFree for CallData {}

impl CallData {
    pub const NONE: CallData = CallData {
        kind: CallKind::None,
        target: 0,
        detail: 0,
    };

    pub fn native(function: NativeFunction) -> CallData {
        CallData {
            kind: CallKind::Native,
            target: function as usize,
            detail: 0,
        }
    }

    pub fn is_none(&self) -> bool {
        self.kind == CallKind::None
    }

    pub fn is_native(&self) -> bool {
        self.kind == CallKind::Native
    }

    pub fn for_call(callee: Value) -> CallData {
        Self::of(callee, Specialization::Call)
    }

    pub fn for_construct(callee: Value) -> CallData {
        Self::of(callee, Specialization::Construct)
    }

    #[inline(always)]
    fn of(callee: Value, specialization: Specialization) -> CallData {
        let is_call = specialization == Specialization::Call;
        let Some(object) = callee.as_object() else {
            return CallData::NONE;
        };
        if let Some(function) = object.downcast::<JsFunction>() {
            return Self::of_function(function, specialization);
        }
        if let Some(function) = object.downcast::<InternalFunction>() {
            return function
                .native_function(specialization)
                .map_or(CallData::NONE, CallData::native);
        }
        if !is_call {
            object.construct_data_of_class()
        } else if (object.inline_flags()).contains(TypeFlags::OVERRIDES_CALL_DATA) {
            object.call_data_of_class()
        } else {
            CallData::NONE
        }
    }

    pub(crate) fn of_function(function: Gc<JsFunction>, specialization: Specialization) -> Self {
        let is_call = specialization == Specialization::Call;
        let executable = function.executable();
        if let Some(script) = executable.downcast::<FunctionExecutable>() {
            if !is_call && !script.info().is_constructor() {
                return CallData::NONE;
            }
            return CallData {
                kind: CallKind::Script,
                target: script.address(),
                detail: function.scope().address(),
            };
        }
        let native = executable.cast::<NativeExecutable>();
        let bound = function.downcast::<JsBoundFunction>();
        let target = if is_call {
            native.function()
        } else {
            native.constructor()
        };
        if !is_call
            && (core::ptr::fn_addr_eq(target, native_not_a_constructor as NativeFunction)
                || bound.is_some_and(|bound| !bound.can_construct()))
        {
            return CallData::NONE;
        }
        CallData {
            detail: usize::from(bound.is_some()),
            ..CallData::native(target)
        }
    }
}

#[native_abi]
#[inline(never)]
#[unsafe(export_name = "engine_native_not_a_constructor")]
pub fn native_not_a_constructor(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_entered_as_constructor(cx, frame.callee()))
}

/// What `stubs::enter` makes a frame of.
#[repr(C)]
struct ProtoFrame {
    code_block: usize,
    callee: u64,
    argument_count_including_this: u32,
    this_value: u64,
    arguments: *const Value,
    executable: usize,
}

/// The entry, what goes in the register of the executable, and the code block.
pub struct CallTarget {
    pub entry: usize,
    pub executable: usize,
    pub code_block: usize,
}

impl CallTarget {
    #[inline(always)]
    fn of(executable: &Executable, specialization: Specialization) -> CallTarget {
        CallTarget {
            entry: executable.entry(specialization),
            executable: executable.address(),
            code_block: executable.code_block(specialization).map_or(0, Gc::address),
        }
    }

    /// `None` if the value cannot be called in that way. A function that is no constructor throws when it is entered.
    #[inline(always)]
    pub fn find(callee: Value, specialization: Specialization) -> Option<CallTarget> {
        let cell = callee.as_cell()?;
        if CellType::FUNCTIONS.contains(cell.cell_type()) {
            // SAFETY: both kinds of function have it there.
            let executable = unsafe { JsFunction::executable_of(cell) };
            return Some(Self::of(&executable, specialization));
        }
        Self::find_slow(callee, specialization)
    }

    /// The frames of native code have words that it does not write, in which earlier calls must have left no cells. For
    /// a call from generated code or the interpreter that is made before the thread moves to another stack.
    #[cold]
    pub fn on_clean_stack(mut self, vm: &Vm, specialization: Specialization) -> CallTarget {
        vm.clear_dead_stack();
        if self.entry != call_data_entry() {
            self.entry = match specialization {
                Specialization::Call => stubs::clearing_call_entry as *const () as usize,
                Specialization::Construct => stubs::clearing_construct_entry as *const () as usize,
            };
        }
        self
    }

    #[inline(never)]
    fn find_slow(callee: Value, specialization: Specialization) -> Option<CallTarget> {
        let data = CallData::of(callee, specialization);
        data.is_native().then(|| CallTarget {
            entry: call_data_entry(),
            executable: data.target,
            code_block: 0,
        })
    }
}

impl Cx {
    /// A native function does not look at the traps, so a loop that calls nothing else would never see them.
    #[inline(always)]
    fn check_stack_and_traps(&mut self, needed: usize) -> JsResult<()> {
        self.assert_is_allowed(Forbidden::SCRIPTS);
        if stack_pointer().saturating_sub(needed) < self.traps().stack_limit() {
            return self.check_stack_and_traps_slow(needed);
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn check_stack_and_traps_slow(&mut self, needed: usize) -> JsResult<()> {
        if self.is_entered() {
            self.check_traps()?;
        }
        if stack_pointer().saturating_sub(needed) < self.soft_stack_limit() {
            return Err(self.throw_stack_overflow());
        }
        Ok(())
    }

    #[inline(always)]
    fn enter(
        &mut self,
        target: &CallTarget,
        callee: Value,
        this_value: Value,
        arguments: &[Value],
    ) -> JsResult<Value> {
        debug_assert!(!self.has_exception());
        #[cfg(debug_assertions)]
        crate::direct::will_run_script();
        if arguments.len() > MAX_ARGUMENTS {
            return Err(self.throw_stack_overflow());
        }
        self.check_stack_and_traps(size_of_val(arguments))?;
        let vm = self.vm();
        let frame = ProtoFrame {
            code_block: target.code_block,
            callee: callee.to_bits(),
            argument_count_including_this: arguments.len() as u32 + 1,
            this_value: this_value.to_bits(),
            arguments: arguments.as_ptr(),
            executable: target.executable,
        };
        if !vm.is_entered() {
            return self.enter_from_outside(target.entry, &frame);
        }
        // SAFETY: the entry goes with the callee, and there is room for the frame.
        unsafe { stubs::enter(target.entry, vm, &frame) }
    }

    #[inline(never)]
    fn enter_from_outside(&mut self, entry: usize, frame: &ProtoFrame) -> JsResult<Value> {
        self.will_enter(self.global());
        // SAFETY: as above.
        let result = unsafe { stubs::enter(entry, self, frame) };
        self.did_leave();
        result
    }

    /// The frame has two words after `this`, whatever the count is.
    #[inline(always)]
    fn enter_short(
        &mut self,
        target: &CallTarget,
        callee: Value,
        argument_count_including_this: u32,
        this_value: Value,
        [first, second]: [Value; 2],
        context: Option<Value>,
    ) -> JsResult<Value> {
        debug_assert!(!self.has_exception());
        #[cfg(debug_assertions)]
        crate::direct::will_run_script();
        self.check_stack_and_traps(0)?;
        let is_outermost = !self.is_entered();
        if is_outermost {
            core::hint::cold_path();
            self.will_enter(self.global());
        }
        // SAFETY: as above.
        let result = unsafe {
            stubs::enter_short(
                target.entry,
                self,
                target.code_block,
                callee.to_bits(),
                argument_count_including_this.into(),
                this_value.to_bits(),
                Value::bits_of(context),
                target.executable,
                first.to_bits(),
                second.to_bits(),
            )
        };
        if is_outermost {
            core::hint::cold_path();
            self.did_leave();
        }
        result
    }

    /// `call` with the first `count` of `arguments`, in a microtask.
    #[inline(always)]
    pub(crate) fn call_in_job(
        &mut self,
        callee: Value,
        this: Value,
        count: u32,
        arguments: [Value; 2],
    ) -> JsResult<Value> {
        assert!(count <= 2);
        match CallTarget::find(callee, Specialization::Call) {
            Some(target) => self.enter_short(&target, callee, count + 1, this, arguments, None),
            None => Err(errors::throw_not_a_function(self, callee)),
        }
    }

    /// Call(F, V, argumentsList)
    #[inline]
    pub fn call(&mut self, callee: Value, this: Value, arguments: &[Value]) -> JsResult<Value> {
        match CallTarget::find(callee, Specialization::Call) {
            Some(target) => self.enter(&target, callee, this, arguments),
            None => Err(errors::throw_not_a_function(self, callee)),
        }
    }

    /// Construct(F, argumentsList, newTarget)
    pub fn construct(
        &mut self,
        callee: Value,
        arguments: &[Value],
        new_target: Value,
    ) -> JsResult<Gc<JsObject>> {
        let Some(target) = CallTarget::find(callee, Specialization::Construct) else {
            return Err(errors::throw_not_a_constructor(self, callee));
        };
        let result = self.enter(&target, callee, new_target, arguments)?;
        result
            .as_object()
            .ok_or_else(|| errors::throw_not_a_constructor(self, callee))
    }

    /// Invoke(V, P, argumentsList)
    pub fn invoke(
        &mut self,
        this: Value,
        name: bun_engine_text::PropertyName<'_>,
        arguments: &[Value],
    ) -> JsResult<Value> {
        let callee = this.get(self, name)?;
        self.call(callee, this, arguments)
    }

    /// Runs a script, a module or `eval` code. Panics unless that was compiled for the scope.
    pub(crate) fn execute(
        &mut self,
        executable: Gc<ScriptExecutable>,
        scope: Gc<JsCell>,
        this: Value,
    ) -> JsResult<Value> {
        assert!(is_instance_of(scope, executable.scope_of_callee().as_ref()));
        let callee = crate::JsCallee::create(self, executable, scope);
        let target = CallTarget::of(&executable, Specialization::Call);
        self.enter(&target, callee.into(), this, &[])
    }

    /// Enters the code of the coroutine where that left it.
    ///
    /// # Safety
    /// It was suspended, and has just been marked as executing.
    #[inline(always)]
    pub(crate) unsafe fn resume(
        &mut self,
        coroutine: &Coroutine,
        value: Value,
        mode: Value,
    ) -> JsResult<Value> {
        let target = CallTarget::of(&coroutine.executable(), Specialization::Call);
        let (callee, this) = (coroutine.callee().into(), coroutine.into());
        self.enter_short(&target, callee, 0, this, [value, mode], Some(this))
    }
}

/// The address to go on at, or zero if it threw.
#[native_abi]
unsafe fn link(vm: &Vm, frame: &CallFrame, specialization: u32) -> usize {
    let specialization = match specialization {
        0 => Specialization::Call,
        _ => Specialization::Construct,
    };
    let callee = frame.callee();
    // SAFETY: called from generated code, which is inside a call that has the `Cx`. Only these have the stub as entry.
    let (cx, executable) = unsafe {
        let executable = JsFunction::executable_of(callee.cell());
        let global = crate::scope::realm_of_scope(JsFunction::scope_of(callee.cell()));
        (Cx::from_global(global), executable)
    };
    debug_assert!(core::ptr::eq(vm, cx.vm()));
    let executable = executable.cast::<ScriptExecutable>();
    match link_executable(cx, callee, executable, specialization) {
        Ok(code_block) => {
            // SAFETY: what the entry expects.
            unsafe { frame.set_code_block(Some(code_block)) };
            executable.entry(specialization)
        }
        Err(_) => 0,
    }
}

fn link_executable(
    cx: &mut Cx,
    callee: Gc<JsObject>,
    executable: Gc<ScriptExecutable>,
    specialization: Specialization,
) -> JsResult<Gc<CodeBlock>> {
    if specialization == Specialization::Construct
        && !(executable.cast::<FunctionExecutable>().info()).is_constructor()
    {
        return Err(errors::throw_entered_as_constructor(cx, callee));
    }
    // SAFETY: what has such an executable has a scope.
    let scope = unsafe { JsFunction::scope_of(callee.cell()) };
    debug_assert!(is_chain_of(scope, executable.scope_of_callee().as_ref()));
    let code = executable.unlinked_code(cx, specialization)?;
    install_code(cx, executable, specialization, code)
}

pub(crate) fn install_code(
    cx: &mut Cx,
    executable: Gc<ScriptExecutable>,
    specialization: Specialization,
    code: Rc<Code>,
) -> JsResult<Gc<CodeBlock>> {
    cx.ensure_can_run(executable.anchor().provider())?;
    let code_block = CodeBlock::link(cx, executable, code)?;
    if code_block.has_debug_hooks()
        && let Some(debugger) = cx.global().debugger()
    {
        debugger.did_link(cx, &code_block);
    }
    let entry = if code_block.code().machine_code.exists() {
        (cx.hooks().adopt_machine_code)(&code_block)
    } else {
        cx.hooks().interpreter_entry
    };
    // SAFETY: the interpreter runs any code block, and the machine code was made from its code.
    unsafe { executable.install(specialization, entry, Some(code_block)) };
    Ok(code_block)
}

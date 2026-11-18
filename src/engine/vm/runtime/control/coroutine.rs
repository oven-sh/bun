//! What generators, async functions, async generators and modules that await have in common: code that leaves its frame
//! and is entered again.
//!
//! Registers are saved at the end of the `Coroutine`, in `CodeBlock::saved_words` words. Each is a value, a cell or empty,
//! and is kept alive until it is overwritten or the code is done. It goes on through `executable`, which has the code
//! that saved them even if that of `callee` has been generated anew.
//!
//! | instruction              | what a tier does                                                                      |
//! | ------------------------ | ------------------------------------------------------------------------------------- |
//! | `create_generator`       | `JsGenerator::for_frame`                                                              |
//! | `create_async_generator` | `JsAsyncGenerator::for_frame`                                                         |
//! | `suspend`                | `save`, returns the value                                                             |
//! | `await`                  | `JsAsyncFunctionGenerator::ensure`, `await_value`, `save`, returns `promise`          |
//! | `debug_await`            | `Coroutine::ensure`                                                                   |
//! | `resume_generator`       | `mark_executing`, calls `callee` through `executable` with a count of zero            |
//! | `resume_dispatch`        | if the count is zero, jumps to the `resume` of `point` of `Coroutine::of_frame`       |
//! | `resume`                 | `restore`                                                                             |
//! | `generator_return`       | `complete`, returns the value                                                         |
//! | `generator_throw`        | `complete`, throws                                                                    |
//! | `async_return`           | returns what `async_return` does                                                      |
//! | `async_throw`            | returns what `async_throw` does                                                       |
//! | `async_iterator_open`    | `open_async_iterator`                                                                 |
//! | `async_iterator_next`    | if `IterationMode::is_marker(next)`: `Coroutine::ensure`, `request_async_step`        |
//!
//! No script runs between `await_value` and `save`. `unwind` completes a coroutine whose resumed frame it removes.
//!
//! Inline, `save` stores the registers, `point` and the low half of `state`, and ends with the write barrier.

use core::cell::Cell;
use core::mem::offset_of;
use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use bun_engine_bytecode::{CodeKind, ResumeMode, SavedRegister, SuspendKind, SuspendPointIndex};
use bun_engine_macros::cell;

use super::initialize_at;
use crate::{
    CallFrame, CellKind, CellType, CodeBlock, Cx, Extends, Field, FunctionExecutable, Gc,
    JsAsyncFunctionGenerator, JsAsyncGenerator, JsFunction, JsGenerator, JsObject, JsObjectInit,
    JsResult, OFFSET_OF_INTERNAL_FIELDS, ScriptExecutable, Shape, Storage, Value, Visitor,
};

/// The first four are those of `SuspendKind`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CoroutineState {
    SuspendedStart,
    SuspendedYield,
    SuspendedDelegate,
    SuspendedAwait,
    Executing,
    Completed,
    /// Of an async generator whose body is done.
    DrainingQueue,
}

impl From<SuspendKind> for CoroutineState {
    #[inline(always)]
    fn from(kind: SuspendKind) -> CoroutineState {
        match kind {
            SuspendKind::Start => CoroutineState::SuspendedStart,
            SuspendKind::Yield => CoroutineState::SuspendedYield,
            SuspendKind::Delegate => CoroutineState::SuspendedDelegate,
            SuspendKind::Await => CoroutineState::SuspendedAwait,
        }
    }
}

#[cell(cell_type = Generator..=AsyncGenerator, visit_children)]
pub struct Coroutine {
    base: JsObject,
    /// The bits of an int32, for `get_internal_field`.
    state: Cell<u64>,
    point: Cell<u32>,
    /// Zero once the code is done.
    saved_count: AtomicU32,
    /// A `JsFunction`, or the `JsCallee` of a module.
    callee: Gc<JsObject>,
    pub(self) code_owner: Field<Gc<ScriptExecutable>>,
}

impl Coroutine {
    pub const STATE_FIELD: u32 = 0;
    pub const OFFSET_OF_STATE: usize = offset_of!(Coroutine, state);
    pub const OFFSET_OF_POINT: usize = offset_of!(Coroutine, point);
    pub const OFFSET_OF_SAVED_COUNT: usize = offset_of!(Coroutine, saved_count);
    pub const OFFSET_OF_CALLEE: usize = offset_of!(Coroutine, callee);
    pub const OFFSET_OF_EXECUTABLE: usize = offset_of!(Coroutine, code_owner);

    /// Of one of the three types.
    #[inline(always)]
    pub const fn offset_of_registers(cell_type: CellType) -> usize {
        const SIZES: u32 = u32::from_le_bytes([
            size_of::<JsGenerator>() as u8,
            size_of::<JsAsyncFunctionGenerator>() as u8,
            size_of::<JsAsyncGenerator>() as u8,
            0,
        ]);
        (SIZES >> ((cell_type.0 - CellType::Generator.0) * 8)) as u8 as usize
    }

    /// `shape` is one that the realm has for instances of `T`, or one like it but for the prototype.
    #[inline(always)]
    pub(super) fn init<T: CellKind>(shape: Gc<Shape>, frame: &CallFrame) -> CoroutineInit {
        assert!(shape.instance_type() == T::CELL_TYPE);
        debug_assert!(!shape.max_offset().is_valid() && !shape.is_dictionary());
        let code_block = frame.code_block().expect("a frame of bytecode");
        CoroutineInit {
            // SAFETY: it has neither properties nor elements.
            base: unsafe { JsObjectInit::with_storage(shape, Storage::NONE) },
            state: Cell::new(Value::int32(CoroutineState::Executing as i32).to_bits()),
            point: Cell::new(0),
            saved_count: AtomicU32::new(code_block.saved_words()),
            callee: frame.callee(),
            code_owner: code_block.executable(),
        }
    }

    #[inline(always)]
    pub(super) fn allocation_size<T>(code_block: &CodeBlock) -> usize {
        size_of::<T>() + code_block.saved_words() as usize * size_of::<u64>()
    }

    /// # Safety
    /// `address` is that of a new cell of `allocation_size` bytes for the code that `init` is for.
    #[inline(always)]
    pub(super) unsafe fn initialize_with_nothing_saved<T: CellKind + Extends<Coroutine>>(
        address: usize,
        init: T::Init,
    ) -> Gc<T> {
        // SAFETY: the caller's.
        unsafe {
            let cell = initialize_at::<T>(address, init);
            let coroutine = cell.upcast::<Coroutine>();
            let count = coroutine.saved_count.load(Ordering::Relaxed) as usize;
            coroutine.registers().write_bytes(0, count);
            cell
        }
    }

    /// For the code that `frame` runs.
    #[inline(always)]
    pub(super) fn allocate<T: CellKind + Extends<Coroutine>>(
        cx: &Cx,
        frame: &CallFrame,
        init: T::Init,
    ) -> JsResult<Gc<T>> {
        let code_block = frame.code_block().expect("code that suspends");
        let size = Self::allocation_size::<T>(&code_block);
        match cx.heap.cells.try_allocate(&cx.heap, size) {
            0 => Err(cx.throw_out_of_memory()),
            // SAFETY: new, and large enough.
            address => Ok(unsafe { Self::initialize_with_nothing_saved(address, init) }),
        }
    }

    /// OrdinaryCreateFromConstructor of the function that `frame` runs, as far as the shape goes.
    #[inline(always)]
    pub(super) fn shape_for_frame<T: CellKind>(
        cx: &mut Cx,
        frame: &CallFrame,
        base: fn(&Cx) -> Gc<Shape>,
    ) -> JsResult<Gc<Shape>> {
        let function = frame.callee().cast::<JsFunction>();
        match function.rare_data().and_then(|it| it.subclass_shape()) {
            Some(shape) if shape.instance_type() == T::CELL_TYPE => Ok(shape),
            _ if function.is_native_or_builtin() => Ok(base(cx)),
            _ => cx.subclass_shape(function.upcast(), base(cx)),
        }
    }

    /// `generator` is the operand of an instruction in the code that `frame` runs.
    #[inline(always)]
    pub fn ensure(cx: &Cx, frame: &CallFrame, generator: Option<Value>) -> JsResult<Gc<Coroutine>> {
        match generator {
            Some(generator) => Ok(generator.cast()),
            None => JsAsyncFunctionGenerator::for_frame(cx, frame).map(Gc::upcast),
        }
    }

    /// The one that the frame goes on with.
    #[inline(always)]
    pub fn of_frame(frame: &CallFrame) -> Option<Gc<Coroutine>> {
        if frame.argument_count_including_this() != 0 || frame.has_native_callee() {
            return None;
        }
        frame.this_value().downcast()
    }

    #[inline(always)]
    pub fn state(&self) -> CoroutineState {
        // SAFETY: from `set_state`, or from generated code that does the same.
        unsafe { core::mem::transmute(self.state.get() as u8) }
    }

    #[inline(always)]
    fn state_atomic(&self) -> &AtomicU64 {
        // SAFETY: aligned. The plain loads are on the only thread that stores.
        unsafe { AtomicU64::from_ptr(self.state.as_ptr()) }
    }

    #[inline(always)]
    pub(super) fn set_state(&self, state: CoroutineState) {
        (self.state_atomic()).store(Value::int32(state as i32).to_bits(), Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn is_suspended(&self) -> bool {
        (self.state() as u8) < CoroutineState::Executing as u8
    }

    /// Where it has suspended last.
    #[inline(always)]
    pub fn point(&self) -> SuspendPointIndex {
        SuspendPointIndex(self.point.get())
    }

    #[inline(always)]
    pub fn callee(&self) -> Gc<JsObject> {
        self.callee
    }

    #[inline(always)]
    pub fn executable(&self) -> Gc<ScriptExecutable> {
        self.code_owner()
    }

    /// One that has the same code.
    pub(crate) fn set_executable(&self, executable: Gc<ScriptExecutable>) {
        // SAFETY: a field of its own.
        unsafe { self.code_owner.publish(self, executable) };
    }

    #[inline(always)]
    fn registers(&self) -> *mut u64 {
        let address = self.address() + Self::offset_of_registers(self.cell_type());
        core::ptr::with_exposed_provenance_mut(address)
    }

    /// # Safety
    /// `frame` runs the code that this was made for and is about to return, and `registers` are those of `point`.
    #[inline(always)]
    pub unsafe fn save(
        &self,
        frame: &CallFrame,
        registers: &[SavedRegister],
        point: SuspendPointIndex,
        kind: SuspendKind,
    ) {
        // SAFETY: the caller's, and the barrier follows.
        unsafe { self.save_without_barrier(frame, registers, point, kind) };
        self.write_barrier_for_cell();
    }

    /// # Safety
    /// As for `save`, and the write barrier runs before the next allocation.
    #[inline(always)]
    pub unsafe fn save_without_barrier(
        &self,
        frame: &CallFrame,
        registers: &[SavedRegister],
        point: SuspendPointIndex,
        kind: SuspendKind,
    ) {
        let saved = self.registers();
        for &SavedRegister { register, word } in registers {
            debug_assert!(word < self.saved_count.load(Ordering::Relaxed));
            // SAFETY: the caller's.
            unsafe {
                let bits = frame.slot(register.offset() as isize).get();
                AtomicU64::from_ptr(saved.add(word as usize)).store(bits, Ordering::Relaxed);
            }
        }
        self.point.set(point.0);
        self.set_state(kind.into());
    }

    /// # Safety
    /// `frame` has been entered to go on with this, and `registers` are those of `point`.
    #[inline(always)]
    pub unsafe fn restore(&self, frame: &CallFrame, registers: &[SavedRegister]) {
        let saved = self.registers();
        for &SavedRegister { register, word } in registers {
            debug_assert!(word < self.saved_count.load(Ordering::Relaxed));
            // SAFETY: the caller's.
            unsafe { (frame.slot(register.offset() as isize)).set(*saved.add(word as usize)) };
        }
    }

    /// Panics unless it is suspended.
    #[inline(always)]
    pub fn mark_executing(&self) {
        assert!(self.is_suspended());
        self.set_state(CoroutineState::Executing);
    }

    #[inline(always)]
    pub fn complete(&self) {
        self.set_state(CoroutineState::Completed);
        self.saved_count.store(0, Ordering::Relaxed);
    }

    /// Runs the code until it leaves its frame. Panics unless it is suspended.
    #[inline(always)]
    pub(super) fn resume(&self, cx: &mut Cx, value: Value, mode: ResumeMode) -> JsResult<Value> {
        self.mark_executing();
        let mode = Value::int32(mode as i32);
        // SAFETY: as it asks.
        let result = unsafe { cx.resume(self, value, mode) };
        if result.is_err() {
            self.complete();
        }
        result
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        let state = self.state_atomic().load(Ordering::Relaxed);
        if state as u8 <= CoroutineState::Executing as u8
            && let Some(code) = (self.code_owner.get_published()).code_block_for_call_concurrently()
        {
            visitor.append(code);
        }
        let count = self.saved_count.load(Ordering::Relaxed) as usize;
        for index in 0..count {
            // SAFETY: empty, or saved and kept alive since.
            unsafe {
                let word = AtomicU64::from_ptr(self.registers().add(index));
                visitor.append_word(word.load(Ordering::Relaxed));
            }
        }
    }
}

impl CodeBlock {
    /// What the code suspends in, if it does.
    pub fn coroutine_type(&self) -> CellType {
        let function = self.executable().downcast::<FunctionExecutable>();
        match function.filter(|_| self.body().kind() == CodeKind::Call) {
            Some(it) if it.info().is_generator() && it.info().is_async() => {
                CellType::AsyncGenerator
            }
            Some(it) if it.info().is_generator() => CellType::Generator,
            _ => CellType::AsyncFunctionGenerator,
        }
    }
}

const _: () = assert!(Coroutine::OFFSET_OF_STATE == OFFSET_OF_INTERNAL_FIELDS);

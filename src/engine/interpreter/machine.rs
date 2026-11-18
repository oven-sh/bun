//! The registers of the interpreter, and how one handler gets to the next.

use core::marker::PhantomData;
use core::mem::MaybeUninit;

use bun_engine_bytecode::{Bytes, Field as _, Jump, Op, Operand, Register, Wide32, Width};
use bun_engine_vm::code::metadata::Entry;
use bun_engine_vm::{CallFrame, CellType, CodeBlock, Gc, JsCell, JsObject, Value, Vm};

use crate::slow::State;

/// At an opcode of verified code, after the prefix.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(crate) struct Pc(pub(crate) *const u8);

impl Bytes for Pc {
    #[inline(always)]
    fn u8(self, at: usize) -> u8 {
        // SAFETY: the decoder reads only inside the instruction.
        unsafe { *self.0.add(at) }
    }

    #[inline(always)]
    fn u16(self, at: usize) -> u16 {
        // SAFETY: as above.
        unsafe { self.0.add(at).cast::<u16>().read_unaligned() }
    }

    #[inline(always)]
    fn u32(self, at: usize) -> u32 {
        // SAFETY: as above.
        unsafe { self.0.add(at).cast::<u32>().read_unaligned() }
    }
}

/// Leaves the index of a constant as it is stored.
pub(crate) struct Raw<W>(PhantomData<W>);

impl<W: Width> Width for Raw<W> {
    const PREFIX_BYTES: usize = W::PREFIX_BYTES;
    const OPERAND_BYTES: usize = W::OPERAND_BYTES;
    const METADATA_BYTES: usize = W::METADATA_BYTES;
    const FIRST_CONSTANT: i32 = Wide32::FIRST_CONSTANT;

    #[inline(always)]
    fn signed(bytes: impl Bytes, index: usize) -> i32 {
        W::signed(bytes, index)
    }

    #[inline(always)]
    fn unsigned(bytes: impl Bytes, index: usize) -> u32 {
        W::unsigned(bytes, index)
    }

    #[inline(always)]
    fn metadata(bytes: impl Bytes, operands: usize) -> u32 {
        W::metadata(bytes, operands)
    }
}

/// An argument that only some handlers look at.
pub(crate) type Extra = MaybeUninit<u64>;
pub(crate) const UNUSED: Extra = Extra::uninit();

/// The order puts the second to the fourth in the registers that all tiers pin. The stack pointer is where a call
/// from below the locals would leave it. A handler does not return.
pub(crate) type Handler = unsafe extern "rust-preserve-none" fn(
    pc: Pc,
    vm: &'static Vm,
    number_tag: u64,
    not_cell_mask: u64,
    fp: *mut u64,
    metadata: *mut u64,
    constants: *const u64,
    a: Extra,
    b: Extra,
    c: Extra,
);

#[derive(Clone, Copy)]
pub(crate) struct Machine<W> {
    pub(crate) pc: Pc,
    pub(crate) vm: &'static Vm,
    pub(crate) number_tag: u64,
    pub(crate) not_cell_mask: u64,
    pub(crate) fp: *mut u64,
    pub(crate) metadata: *mut u64,
    pub(crate) constants: *const u64,
    pub(crate) width: PhantomData<fn() -> W>,
}

/// `handler! { fn name(m, op: Op) { .. } }`, or `fn name(m, a, b, c)` for one that is no instruction. `W` is the width.
macro_rules! handler {
    ($($(#[$attribute:meta])* fn $name:ident $(<$($parameter:ident $(: $bound:path)?),*>)? ($m:ident, $op:ident: $Op:ty $(, $a:ident $(, $b:ident)?)?) $body:block)*) => {$(
        $crate::machine::handler!(@define [$(#[$attribute])*] $name [$($($parameter $(: $bound)?,)*)?] $m, _a, _b, _c {
            let $op = <$Op as bun_engine_bytecode::Op>::decode::<$crate::machine::Raw<W>>($m.pc);
            $(
                // SAFETY: passed by whoever jumps here.
                let $a = unsafe { _a.assume_init() };
                // SAFETY: as above.
                $(let $b = unsafe { _b.assume_init() };)?
            )?
            $body
        });
    )*};
    (raw $($(#[$attribute:meta])* fn $name:ident $(<$($parameter:ident $(: $bound:path)?),*>)? ($m:ident, $a:ident, $b:ident, $c:ident) $body:block)*) => {$(
        $crate::machine::handler!(@define [$(#[$attribute])*] $name [$($($parameter $(: $bound)?,)*)?] $m, $a, $b, $c $body);
    )*};
    (@define [$($attribute:tt)*] $name:ident [$($generics:tt)*] $m:ident, $a:ident, $b:ident, $c:ident $body:block) => {
        $($attribute)*
        #[bun_engine_macros::in_call_frame]
        #[allow(unused_unsafe, unreachable_code, clippy::undocumented_unsafe_blocks)]
        pub(crate) unsafe extern "rust-preserve-none" fn $name<$($generics)* W: bun_engine_bytecode::Width>(
            pc: $crate::machine::Pc,
            vm: &'static bun_engine_vm::Vm,
            number_tag: u64,
            not_cell_mask: u64,
            fp: *mut u64,
            metadata: *mut u64,
            constants: *const u64,
            $a: $crate::machine::Extra,
            $b: $crate::machine::Extra,
            $c: $crate::machine::Extra,
        ) {
            let $m = $crate::machine::Machine::<W> {
                pc, vm, number_tag, not_cell_mask, fp, metadata, constants, width: core::marker::PhantomData,
            };
            // SAFETY: the code is verified and was generated for frames, scopes and metadata like these.
            unsafe { $body }
        }
    };
}

/// Goes on with another handler.
macro_rules! go {
    ($m:ident, $handler:expr) => {
        $crate::machine::go!($m, $handler, $m.pc)
    };
    ($m:ident, $handler:expr, $pc:expr) => {
        become $handler(
            $pc,
            $m.vm,
            $m.number_tag,
            $m.not_cell_mask,
            $m.fp,
            $m.metadata,
            $m.constants,
            $crate::machine::UNUSED,
            $crate::machine::UNUSED,
            $crate::machine::UNUSED,
        )
    };
    ($m:ident, $handler:expr; $a:expr) => {
        become $handler(
            $m.pc,
            $m.vm,
            $m.number_tag,
            $m.not_cell_mask,
            $m.fp,
            $m.metadata,
            $m.constants,
            $crate::machine::Extra::new($a as u64),
            $crate::machine::UNUSED,
            $crate::machine::UNUSED,
        )
    };
    ($m:ident, $handler:expr; $a:expr, $b:expr) => {
        become $handler(
            $m.pc,
            $m.vm,
            $m.number_tag,
            $m.not_cell_mask,
            $m.fp,
            $m.metadata,
            $m.constants,
            $crate::machine::Extra::new($a as u64),
            $crate::machine::Extra::new($b as u64),
            $crate::machine::UNUSED,
        )
    };
    ($m:ident, $handler:expr; $a:expr, $b:expr, $c:expr) => {
        become $handler(
            $m.pc,
            $m.vm,
            $m.number_tag,
            $m.not_cell_mask,
            $m.fp,
            $m.metadata,
            $m.constants,
            $crate::machine::Extra::new($a as u64),
            $crate::machine::Extra::new($b as u64),
            $crate::machine::Extra::new($c as u64),
        )
    };
}

/// Goes on with the instruction that starts there.
macro_rules! dispatch {
    ($m:ident, $pc:expr) => {{
        let pc: $crate::machine::Pc = $pc;
        $crate::machine::go!($m, $crate::table::NARROW[usize::from(*pc.0)], pc)
    }};
}

macro_rules! next {
    ($m:ident, $op:ident) => {
        $crate::machine::dispatch!($m, $m.after(&$op))
    };
}

macro_rules! jump {
    ($m:ident, $target:expr) => {
        $crate::machine::dispatch!($m, $m.target($target))
    };
}

macro_rules! branch {
    ($m:ident, $op:ident, $condition:expr, $target:expr) => {{
        if $condition {
            $crate::machine::jump!($m, $target)
        }
        $crate::machine::next!($m, $op)
    }};
}

/// Does the whole instruction the general way.
macro_rules! slow {
    ($m:ident, $Op:ty) => {
        $crate::machine::go!($m, $crate::slow::handler::<$Op, W>)
    };
}

pub(crate) use {branch, dispatch, go, handler, jump, next, slow};

/// `constants` is this many words below the first one, where a narrow operand finds it.
pub(crate) const CONSTANT_BIAS: i32 = bun_engine_bytecode::Narrow::FIRST_CONSTANT;

impl<W: Width> Machine<W> {
    /// With the prefix.
    #[inline(always)]
    pub(crate) fn start(&self) -> *const u8 {
        self.pc.0.wrapping_sub(W::PREFIX_BYTES)
    }

    #[inline(always)]
    pub(crate) fn after<O: Op>(&self, _: &O) -> Pc {
        Pc(self.start().wrapping_add(O::size::<W>()))
    }

    #[inline(always)]
    pub(crate) fn target(&self, jump: Jump) -> Pc {
        Pc(self.start().wrapping_offset(jump.0 as isize))
    }

    #[inline(always)]
    pub(crate) unsafe fn frame(&self) -> &'static CallFrame {
        // SAFETY: it is there while its code runs.
        unsafe { &*self.fp.cast() }
    }

    #[inline(always)]
    pub(crate) unsafe fn code_block(&self) -> Gc<CodeBlock> {
        // SAFETY: a frame of the interpreter has one.
        unsafe { Gc::from_address(self.frame().code_block_bits()) }
    }

    #[inline(always)]
    pub(crate) unsafe fn at_offset(&self, offset: u32) -> Pc {
        // SAFETY: the caller's.
        unsafe { Pc(self.code_block().instructions_ptr().add(offset as usize)) }
    }

    #[inline(always)]
    pub(crate) unsafe fn reg(&self, register: Register) -> u64 {
        // SAFETY: inside the frame.
        unsafe { *self.fp.offset(register.offset() as isize) }
    }

    /// Of an operand that was decoded with `Raw`.
    #[inline(always)]
    pub(crate) unsafe fn get(&self, operand: Operand) -> u64 {
        let stored = operand.word() as i32;
        // SAFETY: inside the frame or the constants.
        unsafe {
            if stored >= W::FIRST_CONSTANT {
                core::hint::cold_path();
                let bias = (CONSTANT_BIAS - W::FIRST_CONSTANT) as isize;
                return *self.constants.wrapping_offset(stored as isize + bias);
            }
            *self.fp.offset(stored as isize)
        }
    }

    #[inline(always)]
    pub(crate) unsafe fn set(&self, register: Register, bits: u64) {
        // SAFETY: inside the frame.
        unsafe { *self.fp.offset(register.offset() as isize) = bits }
    }

    /// Three registers, as what an instruction has put there.
    #[inline(always)]
    pub(crate) unsafe fn state<T: State>(&self, first: Register) -> &'static T {
        // SAFETY: inside the frame.
        unsafe { &*self.fp.offset(first.nth(2).offset() as isize).cast() }
    }

    #[inline(always)]
    pub(crate) unsafe fn entry<T: Entry>(&self, word: u32) -> &'static T {
        // SAFETY: the caller's.
        unsafe { &*self.metadata.add(word as usize).cast() }
    }

    #[inline(always)]
    pub(crate) fn is_int32(&self, bits: u64) -> bool {
        bits >= self.number_tag
    }

    #[inline(always)]
    pub(crate) fn are_int32(&self, a: u64, b: u64) -> bool {
        a & b >= self.number_tag
    }

    #[inline(always)]
    pub(crate) fn is_number(&self, bits: u64) -> bool {
        bits & self.number_tag != 0
    }

    /// Or empty.
    #[inline(always)]
    pub(crate) fn is_cell(&self, bits: u64) -> bool {
        bits & self.not_cell_mask == 0
    }

    #[inline(always)]
    pub(crate) fn box_int32(&self, value: i32) -> u64 {
        self.number_tag | u64::from(value as u32)
    }

    /// Of arithmetic on values, which makes no NaN that cannot be boxed.
    #[inline(always)]
    pub(crate) fn box_double(&self, value: f64) -> u64 {
        value.to_bits().wrapping_sub(self.number_tag)
    }

    #[inline(always)]
    pub(crate) fn unbox_double(&self, bits: u64) -> f64 {
        f64::from_bits(bits.wrapping_add(self.number_tag))
    }

    #[inline(always)]
    pub(crate) fn to_double(&self, bits: u64) -> Option<f64> {
        if self.is_int32(bits) {
            Some(f64::from(bits as i32))
        } else if self.is_number(bits) {
            Some(self.unbox_double(bits))
        } else {
            None
        }
    }

    /// The value is not empty.
    #[inline(always)]
    pub(crate) unsafe fn as_cell(&self, bits: u64) -> Option<Gc<JsCell>> {
        // SAFETY: the caller's.
        self.is_cell(bits).then(|| unsafe { cell(bits) })
    }

    #[inline(always)]
    pub(crate) unsafe fn as_object(&self, bits: u64) -> Option<Gc<JsObject>> {
        // SAFETY: the caller's.
        unsafe { self.as_cell(bits) }?.as_object()
    }

    #[inline(always)]
    pub(crate) unsafe fn has_type(&self, bits: u64, cell_type: CellType) -> bool {
        // SAFETY: the caller's.
        unsafe { self.as_cell(bits) }.is_some_and(|cell| cell.cell_type() == cell_type)
    }

    /// Between initializing a cell and letting go of it.
    #[inline(always)]
    pub(crate) fn publish(&self) {
        #[cfg(not(target_arch = "x86_64"))]
        if self.vm.heap.mutator_should_be_fenced.get() {
            core::sync::atomic::fence(core::sync::atomic::Ordering::Release);
        }
        core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::Release);
    }

    /// After storing `bits` in `owner`. False if the slow path of the barrier has to run.
    #[inline(always)]
    pub(crate) fn needs_no_barrier(&self, owner: &JsCell) -> bool {
        u32::from(owner.state_bits()) > self.vm.heap.barrier_threshold.get()
    }
}

/// # Safety
/// The bits of a cell that starts with a `T`.
#[inline(always)]
pub(crate) unsafe fn cell<T>(bits: u64) -> Gc<T> {
    // SAFETY: the caller's.
    unsafe { Gc::from_address(bits as usize) }
}

#[inline(always)]
pub(crate) const fn boolean(value: bool) -> u64 {
    Value::boolean(value).to_bits()
}

pub(crate) const UNDEFINED: u64 = Value::UNDEFINED.to_bits();
pub(crate) const EMPTY: u64 = 0;

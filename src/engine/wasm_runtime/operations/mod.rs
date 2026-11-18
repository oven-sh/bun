//! What compiled code calls. Validation vouches for the indices and for the types of the operands.

mod exception;
pub(crate) mod memory;
pub(crate) mod object;
pub(crate) mod table;

use bun_engine_asm::Width;
use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Operation;
use bun_engine_wasm_format::{FuncIndex, GlobalIndex};

#[cfg(not(all(windows, target_arch = "x86_64")))]
pub(crate) use libc::{memmove as move_bytes, memset as fill_bytes};

use crate::instance::Instance;
use crate::outcome::Outcome;
use crate::value::{HostCell, Reference};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Conduct {
    Succeeds,
    /// It returns an [`Outcome`].
    MayFail,
    /// Also, the host may collect garbage or look at the stack.
    CallsHost,
}

const fn describe(operation: Operation) -> (Conduct, *const ()) {
    use Conduct::{CallsHost, MayFail, Succeeds};
    match operation {
        Operation::MemoryGrow => (CallsHost, memory::grow as _),
        Operation::MemoryFill => (MayFail, memory::fill as _),
        Operation::MemoryCopy => (MayFail, memory::copy as _),
        Operation::MemoryInit => (MayFail, memory::init as _),
        Operation::DataDrop => (Succeeds, memory::drop_data as _),
        Operation::AtomicWait32 => (CallsHost, memory::wait32 as _),
        Operation::AtomicWait64 => (CallsHost, memory::wait64 as _),
        Operation::AtomicNotify => (MayFail, memory::notify as _),
        Operation::TableGet => (CallsHost, table::get as _),
        Operation::TableSet => (MayFail, table::set as _),
        Operation::TableGrow => (CallsHost, table::grow as _),
        Operation::TableFill => (MayFail, table::fill as _),
        Operation::TableCopy => (MayFail, table::copy as _),
        Operation::TableInit => (MayFail, table::init as _),
        Operation::ElemDrop => (Succeeds, table::drop_elements as _),
        Operation::RefFunc => (CallsHost, ref_func as _),
        Operation::GlobalSetReference => (Succeeds, set_global_reference as _),
        Operation::WriteBarrier => (Succeeds, write_barrier as _),
        Operation::StructNew => (CallsHost, object::new_struct as _),
        Operation::ArrayNew => (CallsHost, object::new_array as _),
        Operation::ArrayNewDefault => (CallsHost, object::new_default_array as _),
        Operation::ArrayNewData => (CallsHost, object::new_array_from_data as _),
        Operation::ArrayNewElem => (CallsHost, object::new_array_from_elements as _),
        Operation::ArrayFill => (MayFail, object::fill_array as _),
        Operation::ArrayCopy => (MayFail, object::copy_array as _),
        Operation::ArrayInitData => (MayFail, object::init_array_from_data as _),
        Operation::ArrayInitElem => (CallsHost, object::init_array_from_elements as _),
        Operation::AnyConvertExtern => (Succeeds, any_convert_extern as _),
        Operation::Throw => (CallsHost, exception::throw as _),
        Operation::ThrowRef => (MayFail, exception::throw_ref as _),
    }
}

pub(crate) const ALL: [(Conduct, *const ()); Operation::COUNT] = {
    let mut all = [describe(Operation::ALL[0]); Operation::COUNT];
    let mut index = 0;
    while index < all.len() {
        all[index] = describe(Operation::ALL[index]);
        index += 1;
    }
    all
};

fn minus_one(width: Width) -> u64 {
    u64::MAX >> (64 - width.bits())
}

#[native_abi]
unsafe fn ref_func(instance: &Instance, func: FuncIndex) -> Outcome {
    let reference = instance.function_reference(func);
    reference.map(|reference| reference.0).into()
}

#[native_abi]
unsafe fn set_global_reference(instance: &Instance, global: GlobalIndex, value: Reference) {
    // SAFETY: validated.
    unsafe { instance.linked_global(global).set(value.into()) };
}

#[native_abi]
pub(crate) unsafe fn write_barrier(instance: &Instance, cell: HostCell) {
    let (host, vm) = instance.store().host();
    host.write_barrier(vm, cell);
}

#[native_abi]
unsafe fn any_convert_extern(_: &Instance, value: Reference) -> Reference {
    value.internalized()
}

#[cfg(all(windows, target_arch = "x86_64"))]
pub(crate) unsafe extern "sysv64" fn move_bytes(dst: *mut u8, src: *const u8, count: usize) {
    // SAFETY: compiled code checked the bounds.
    unsafe { crate::memory::copy_bytes(dst, src, count) };
}

#[cfg(all(windows, target_arch = "x86_64"))]
pub(crate) unsafe extern "sysv64" fn fill_bytes(dst: *mut u8, value: u64, count: usize) {
    // SAFETY: compiled code checked the bounds.
    unsafe { crate::memory::fill_bytes(dst, value as u8, count) };
}

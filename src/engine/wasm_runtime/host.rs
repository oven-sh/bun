//! What the run time needs of whoever owns the heap and the exceptions.

use core::ptr;
use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use core::time::Duration;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_wasm_compiler::abi::{HostLayout, Trap};
use bun_engine_wasm_format::{FuncIndex, TypeIndex};

use crate::call::{HostCall, Incoming, Outgoing};
use crate::frames::Catch;
use crate::global::Global;
use crate::instance::Instance;
use crate::memory::Memory;
use crate::table::Table;
use crate::tag::Tag;
use crate::value::HostCell;

/// The address of what the host keeps for a thread and its heap.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Vm(pub usize);

/// The host has an exception pending.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Thrown;

/// Why a function of the host does not return.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Interrupted {
    Thrown,
    /// The host has saved the frames. See [`HostCall::frames`].
    Suspended,
    /// The call starts over. See [`Instance::replace_stub_of_import`].
    Redirected,
}

/// What an instance defines and can share.
pub enum Owned {
    Memory(Rc<Memory>),
    Table(Rc<Table>),
    Global(Rc<Global>),
    Tag(Arc<Tag>),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Urgency {
    Soon,
    /// Memories that cannot be reached are dropped before the call returns.
    Now,
}

/// Of a new cell.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Contents {
    Any,
    Zeros,
}

/// What `memory.atomic.wait` compares the memory with.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Expected {
    Bits32(u32),
    Bits64(u64),
}

impl Expected {
    /// # Safety
    /// The address is aligned and accessible for a value of that size.
    pub unsafe fn is_at(self, address: usize) -> bool {
        // SAFETY: the caller's.
        unsafe {
            match self {
                Self::Bits32(bits) => {
                    let place = AtomicU32::from_ptr(ptr::with_exposed_provenance_mut(address));
                    place.load(Ordering::SeqCst) == bits
                }
                Self::Bits64(bits) => {
                    let place = AtomicU64::from_ptr(ptr::with_exposed_provenance_mut(address));
                    place.load(Ordering::SeqCst) == bits
                }
            }
        }
    }
}

/// As `memory.atomic.wait` numbers them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Waited {
    Woken,
    NotEqual,
    TimedOut,
}

/// The methods that make cells may collect garbage, and give `None` for want of memory.
///
/// # Safety
/// Cells and the VM are laid out as `layout` says. Cells are aligned to 8 bytes, do not move, and live while the
/// stack of the thread points at or into them or a live cell refers to them, which the `trace` methods of this crate
/// tell for its own objects. Those are dropped on the thread.
pub unsafe trait Host: Sync {
    /// The engine fills in `null_guard_size`.
    fn layout(&self) -> HostLayout;

    /// The address of the first of those that the layout describes.
    fn allocators(&self, vm: Vm) -> usize;
    /// For a struct or an array of `size` bytes in all.
    fn allocate_object(&self, vm: Vm, size: usize, contents: Contents) -> Option<HostCell>;
    /// The first word of structs or arrays of the type, given that for the supertype, and the cell with the
    /// `ObjectType`. An object with that word keeps the cell alive, which keeps the canonical type and the cell of the
    /// supertype.
    fn object_type(
        &self,
        instance: &Instance,
        ty: TypeIndex,
        supertype: Option<u64>,
    ) -> Option<(u64, HostCell)>;
    /// With room for what the layout says. It keeps the instance alive.
    fn new_function(&self, instance: &Instance, func: FuncIndex) -> Option<HostCell>;
    /// With the tag, and room for the payload. It keeps alive `owner`, which keeps the tag, and the references in the
    /// payload.
    fn new_exception(&self, instance: &Instance, tag: &Tag, owner: HostCell) -> Option<HostCell>;
    /// A cell that keeps and traces the object.
    fn new_owner(&self, instance: &Instance, owned: Owned) -> Option<HostCell>;
    fn write_barrier(&self, vm: Vm, cell: HostCell);

    /// Makes an exception pending that WebAssembly cannot catch.
    fn throw_trap(&self, instance: &Instance, trap: Trap);
    /// For what does not leave WebAssembly, unless the host has something else to throw.
    ///
    /// # Safety
    /// Compiled code throws the `exnref`.
    unsafe fn will_catch(&self, instance: &Instance, exception: HostCell) -> Result<(), Thrown>;
    /// Makes pending what leaves WebAssembly.
    ///
    /// # Safety
    /// As above.
    unsafe fn throw(&self, instance: &Instance, exception: HostCell);
    /// For an interpreter, which unwinds by itself: the pending exception as an `exnref`, if it has a tag and is caught
    /// by that. Then it is not pending any more.
    ///
    /// # Safety
    /// As above.
    unsafe fn take_exception(
        &self,
        instance: &Instance,
        is_caught: &dyn Fn(&Tag) -> bool,
    ) -> Option<HostCell>;
    /// See [`crate::Interrupts`].
    ///
    /// # Safety
    /// Compiled code asks.
    unsafe fn interrupt(&self, instance: &Instance) -> Result<(), Thrown>;
    /// For code that cannot stand more than a question. See [`crate::Interrupts`].
    fn must_terminate(&self, vm: Vm) -> bool;
    /// After that was so. Makes an exception pending that nothing catches.
    fn terminate(&self, instance: &Instance);
    /// Where to go on with the pending exception. See [`crate::Engine::find_handler`].
    ///
    /// # Safety
    /// `fp` is that of the innermost frame that may have a say, which is not that of a function.
    unsafe fn unwind(&self, vm: Vm, fp: usize) -> Catch;

    /// For imports with [`crate::Engine::host_call_stub`]. It sets every result to a value of its type.
    fn call(&self, call: HostCall<'_>) -> Result<(), Interrupted>;
    /// The same, or throws.
    ///
    /// # Safety
    /// For [`crate::Engine::end_of_host_call_stub`], with what that was given.
    unsafe fn put_results(
        &self,
        instance: &Instance,
        returned: u64,
        results: Outgoing<'_>,
    ) -> Result<(), Thrown>;
    /// It sets every argument to a value of its type, or throws.
    ///
    /// # Safety
    /// `fp` is that of a frame of [`crate::Engine::enter_stub`], which has been called for the `funcref`.
    unsafe fn put_arguments(
        &self,
        instance: &Instance,
        function: HostCell,
        fp: usize,
        arguments: Outgoing<'_>,
    ) -> Result<(), Thrown>;
    /// Gives what the stub returns.
    ///
    /// # Safety
    /// As above.
    unsafe fn take_results(
        &self,
        instance: &Instance,
        fp: usize,
        results: Incoming<'_>,
    ) -> Result<u64, Thrown>;

    /// The bytes may have moved. For a memory that is not shared, this follows growth by zero pages too.
    fn memory_grew(&self, vm: Vm, memory: &Memory, old_length: u64);
    /// `owner` keeps this many more bytes outside the heap.
    fn report_allocation(&self, vm: Vm, owner: HostCell, bytes: usize);
    /// [`crate::Module::footprint`] of its module may be larger now. It does not collect garbage.
    fn module_grew(&self, instance: &Instance);
    fn collect_garbage(&self, vm: Vm, urgency: Urgency);

    /// Blocks until `notify` is called with the address, if the memory has that value.
    ///
    /// # Safety
    /// The address is aligned and in a shared memory of the instance.
    unsafe fn wait(
        &self,
        instance: &Instance,
        address: usize,
        expected: Expected,
        timeout: Option<Duration>,
    ) -> Result<Waited, Thrown>;
    /// Gives the number of those that were woken.
    fn notify(&self, address: usize, count: u32) -> u32;
}

//! What compiled code, the stubs and the run time agree on: registers, frames and the layout of data.

use core::mem::offset_of;
use core::slice;
use core::sync::atomic::{AtomicI32, AtomicU32, AtomicU64, AtomicUsize};

use bun_engine_asm::{Fpr, Gpr, Reg, abi};
use bun_engine_wasm_format::{
    FuncIndex, FuncType, GlobalIndex, MemoryIndex, ModuleHeader, Rtt, StorageType, TableIndex,
    TagIndex, TypeIndex, TypeKind, ValKind, ValType,
};
use smallvec::SmallVec;

pub const INSTANCE: Gpr = abi::VM;
/// Of memory 0 of [`INSTANCE`], whichever that is after a call. With [`MemoryMode::Checked`] it means nothing across
/// calls.
pub const MEMORY_BASE: Gpr = abi::NUMBER_TAG;
/// At the entry of a function that is called through a [`FunctionSlot`] or an [`Import`], the address of that.
pub const SLOT: Gpr = abi::NON_ARGUMENT_GPRS[0];

/// For [`Stubs::note_callee`], the address of the [`CallProfile`].
pub const PROFILE: Gpr = abi::SAVED_GPRS[0];

pub const ARGUMENT_GPRS: &[Gpr] = &abi::ARGUMENT_GPRS;
pub const ARGUMENT_FPRS: &[Fpr] = &abi::ARGUMENT_FPRS;
pub const RESULT_GPRS: &[Gpr] = &abi::RETURN_GPRS;
pub const RESULT_FPRS: &[Fpr] = abi::ARGUMENT_FPRS.split_at(2).0;

/// Offsets from the frame pointer. The caller makes room for the two words above the return address, and the
/// function fills them in. That goes for calls of operations too.
pub mod frame {
    pub const INSTANCE: i32 = 16;
    pub const CALLEE: i32 = 24;
    pub const ARGUMENTS: i32 = 32;
    /// Where the frame pointer of the callee will be, from the stack pointer of the caller.
    pub const CALLEE_FRAME_FROM_STACK_POINTER: i32 = -16;
}

/// The low bits of the word in the place of the callee, which no cell has.
pub const CALLEE_TAG: u32 = 3;

/// Fits in 31 bits.
pub const fn callee_word(func: FuncIndex) -> u32 {
    func.0 << 2 | CALLEE_TAG
}

/// Undoes [`callee_word`].
pub const fn func_of(callee_word: u32) -> FuncIndex {
    FuncIndex(callee_word >> 2)
}

/// In place of a [`callee_word`], in the frames of the stubs that compiled code calls.
pub const STUB_CALLEE: u32 = i32::MAX as u32;
/// The same, in those of the stubs that the host calls.
pub const ENTRY_CALLEE: u32 = STUB_CALLEE - (1 << 2);

/// References are JavaScript values. An `i31ref` is an int32 whose sign is extended from 31 bits, and below `any`
/// there is no other int32.
pub const NULL: i32 = 0x02;
pub const INT32_TAG: u64 = 0xfffe_0000_0000_0000;

pub const PAGE_SIZE_LOG2: u8 = 16;
/// What follows the 4 GiB of a guarded memory. An access with `offset + size` up to this needs no check.
pub const GUARD_SIZE: u64 = 1 << 31;
/// What precedes a guarded memory. An access faults there too.
pub const LOW_GUARD_SIZE: u64 = 1 << 21;
/// A function that calls nothing, not even in its own place, and has a frame up to this size does not check the stack.
pub const UNCHECKED_FRAME_SIZE: u32 = 256;
/// How far the stack pointer may go below an address that was checked.
pub const UNCHECKED_STACK_EXTENSION: u32 = 1024;

/// How memory 0 is accessed. Other memories are always checked.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum MemoryMode {
    /// It does not move, and a fault tells of an access that is out of bounds.
    Guarded,
    Checked,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Place {
    Register(Reg),
    /// From the frame pointer of the callee.
    Stack(i32),
}

/// An `i32` in a register has the upper half clear. On the stack it takes 8 bytes of which the low 4 count.
pub struct Signature {
    pub params: SmallVec<[Place; 8]>,
    pub results: SmallVec<[Place; 2]>,
    /// From [`frame::ARGUMENTS`] up, a multiple of 16. Results end at the top of it, and a tail call keeps that top
    /// where it is.
    pub stack_bytes: u32,
}

/// Those that are left for the arguments or the results of a function.
pub struct Registers {
    gprs: slice::Iter<'static, Gpr>,
    fprs: slice::Iter<'static, Fpr>,
}

impl Registers {
    #[inline]
    pub fn for_arguments() -> Self {
        Self {
            gprs: ARGUMENT_GPRS.iter(),
            fprs: ARGUMENT_FPRS.iter(),
        }
    }

    #[inline]
    pub fn for_results() -> Self {
        Self {
            gprs: RESULT_GPRS.iter(),
            fprs: RESULT_FPRS.iter(),
        }
    }

    #[inline]
    pub fn next(&mut self, kind: ValKind) -> Option<Reg> {
        match kind {
            ValKind::F32 | ValKind::F64 | ValKind::V128 => self.fprs.next().map(|&reg| reg.into()),
            _ => self.gprs.next().map(|&reg| reg.into()),
        }
    }
}

fn assign<A: smallvec::Array<Item = Place>>(
    types: &[ValType],
    mut registers: Registers,
) -> (SmallVec<A>, u32) {
    let mut bytes = 0u32;
    let places = types.iter().map(|ty| {
        registers.next(ty.kind()).map_or_else(
            || {
                let size = ty.size_in_bytes().max(8);
                let start = bytes.next_multiple_of(size);
                bytes = start + size;
                Place::Stack(frame::ARGUMENTS + start as i32)
            },
            Place::Register,
        )
    });
    (places.collect(), bytes.next_multiple_of(16))
}

impl Signature {
    pub fn new(ty: FuncType<'_>) -> Self {
        let (params, param_bytes) = assign(ty.params, Registers::for_arguments());
        let (mut results, result_bytes): (SmallVec<_>, _) =
            assign(ty.results, Registers::for_results());
        let stack_bytes = param_bytes.max(result_bytes);
        for place in &mut results {
            if let Place::Stack(offset) = place {
                *offset += (stack_bytes - result_bytes) as i32;
            }
        }
        Self {
            params,
            results,
            stack_bytes,
        }
    }

    pub fn has_results_on_stack(&self) -> bool {
        (self.results.iter()).any(|place| matches!(place, Place::Stack(_)))
    }
}

/// Where the values are in the payload of an exception, and then its size. It is aligned to 8 bytes.
pub fn payload_offsets(params: &[ValType]) -> impl Iterator<Item = u32> {
    let ends = params.iter().scan(0, |end, ty| {
        *end += ty.size_in_bytes().max(8);
        Some(*end)
    });
    core::iter::once(0).chain(ends)
}

/// One for each function that a module defines and each [`MemoryMode`], shared by instances and threads.
#[repr(C)]
pub struct FunctionSlot {
    /// The best code so far, or the stub that compiles some.
    pub entry: AtomicUsize,
    /// Baseline code counts up at its entry, without synchronization, and asks for better code when this is no longer
    /// negative. Each loop has a countdown of its own.
    pub countdown: AtomicI32,
}

impl FunctionSlot {
    pub const SIZE: usize = size_of::<Self>();
    pub const ENTRY: i32 = offset_of!(Self, entry) as i32;
    pub const COUNTDOWN: i32 = offset_of!(Self, countdown) as i32;
}

/// What baseline code has seen at a call site.
#[repr(C)]
pub struct CallProfile {
    /// Of the only function that an indirect call reached, zero, or what [`Stubs::note_callee`] makes of more.
    pub slot: AtomicUsize,
    pub count: AtomicU32,
}

impl CallProfile {
    pub const SIZE: usize = size_of::<Self>();
    pub const SLOT: i32 = offset_of!(Self, slot) as i32;
    pub const COUNT: i32 = offset_of!(Self, count) as i32;
}

/// How to call a function: with `instance` in [`INSTANCE`], its memory in [`MEMORY_BASE`] and `slot` in [`SLOT`],
/// at the address that `slot` points to.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Callable {
    pub slot: usize,
    pub instance: usize,
    /// Zero in an element of a table that is null.
    pub rtt: usize,
}

impl Callable {
    pub const SLOT: i32 = offset_of!(Self, slot) as i32;
    pub const INSTANCE: i32 = offset_of!(Self, instance) as i32;
    pub const RTT: i32 = offset_of!(Self, rtt) as i32;
}

/// An element of a table of functions. Other tables have references of 8 bytes.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FunctionElement {
    pub callable: Callable,
    /// Zero until [`Operation::TableGet`] finds or makes it, whether the element is null or not.
    pub reference: u64,
}

impl FunctionElement {
    pub const SIZE_LOG2: u8 = size_of::<Self>().ilog2() as u8;
    pub const REFERENCE: i32 = offset_of!(Self, reference) as i32;
}

const _: () = assert!(size_of::<FunctionElement>().is_power_of_two());

/// For a function of the host, the slot of `callable` is `stub`, and the instance is the one that imports.
#[repr(C)]
pub struct Import {
    pub callable: Callable,
    pub stub: usize,
    pub host_function: u64,
    pub host_data: usize,
}

impl Import {
    pub const STUB: i32 = offset_of!(Self, stub) as i32;
    pub const HOST_FUNCTION: i32 = offset_of!(Self, host_function) as i32;
    pub const HOST_DATA: i32 = offset_of!(Self, host_data) as i32;
}

/// The instance's view of a memory, brought up to date when the memory grows.
#[repr(C)]
pub struct MemoryView {
    pub base: usize,
    /// In bytes. Not for shared memories.
    pub length: u64,
    /// For shared memories, the address of an [`AtomicU64`] with the length in bytes.
    pub shared_length: usize,
}

impl MemoryView {
    pub const BASE: i32 = offset_of!(Self, base) as i32;
    pub const LENGTH: i32 = offset_of!(Self, length) as i32;
    pub const SHARED_LENGTH: i32 = offset_of!(Self, shared_length) as i32;
}

const _: () = assert!(size_of::<AtomicU64>() == 8);

/// The instance's view of a table, brought up to date when the table grows.
#[repr(C)]
pub struct TableView {
    pub elements: usize,
    pub length: u64,
    /// The cell for the barrier after a reference is stored in the table.
    pub owner: usize,
}

impl TableView {
    pub const ELEMENTS: i32 = offset_of!(Self, elements) as i32;
    pub const LENGTH: i32 = offset_of!(Self, length) as i32;
    pub const OWNER: i32 = offset_of!(Self, owner) as i32;
}

/// Offsets in structs and arrays. They start with [`InstanceLayout::object_header`].
pub mod object {
    use super::StorageType;

    /// 32 bits. See [`super::ObjectType`].
    pub const TYPE_NUMBER: i32 = 0;
    pub const FIELDS: i32 = 8;
    /// 32 bits.
    pub const LENGTH: i32 = 8;

    /// Those of 8 bytes or more.
    pub const WIDE_ELEMENTS: i32 = LENGTH + 8;

    pub const fn elements(ty: StorageType) -> i32 {
        match ty.size_in_bytes() {
            ..=4 => LENGTH + 4,
            _ => WIDE_ELEMENTS,
        }
    }
}

/// What a heap keeps for a type of structs or arrays, once, at its number from [`HostLayout::object_types`].
#[repr(C)]
pub struct ObjectType {
    /// The numbers of the supertypes from the root down and that of the type itself, as far as there is room. Then
    /// zeros, which is no number.
    display: [u32; Self::DISPLAY_LENGTH as usize],
    rtt: usize,
    /// For [`References::InWords`], a bit for each word from the first field on.
    reference_words: u64,
    references: References,
    kind: TypeKind,
}

#[derive(Clone, Copy)]
pub enum References {
    InWords,
    /// The `Rtt` has them.
    AtOffsets,
    InElements,
}

impl ObjectType {
    pub const DISPLAY_LENGTH: u32 = 8;
    pub const DISPLAY: i32 = offset_of!(Self, display) as i32;
    pub const RTT: i32 = offset_of!(Self, rtt) as i32;
    /// A [`TypeKind`], 8 bits.
    pub const KIND: i32 = offset_of!(Self, kind) as i32;

    pub fn new(number: u32, rtt: &Rtt, supertype: Option<&Self>) -> Self {
        let mut display = supertype.map_or_default(|it| it.display);
        if let Some(own) = display.get_mut(rtt.depth() as usize) {
            *own = number;
        }
        let bit = |offset: &u32| 1u64.checked_shl(offset / 8);
        let words = (rtt.reference_offsets().iter()).try_fold(0, |all, it| Some(all | bit(it)?));
        Self {
            display,
            rtt: rtt.address(),
            reference_words: words.unwrap_or(0),
            references: match (rtt.element(), words) {
                (Some(element), _) if element.storage.is_ref() => References::InElements,
                (_, Some(_)) => References::InWords,
                (_, None) => References::AtOffsets,
            },
            kind: rtt.kind(),
        }
    }

    #[inline]
    pub fn references(&self) -> (References, u64) {
        (self.references, self.reference_words)
    }

    /// The address.
    #[inline]
    pub fn rtt(&self) -> usize {
        self.rtt
    }
}

/// Where structs and arrays come from: one allocator for each class of sizes, in a row.
///
/// If the address at `start` is below the one at `end`, there is a free cell, and adding the size of the cells takes
/// it. It has any contents. Before the next call it needs the header, the length, and values in the fields or elements
/// that are references.
#[derive(Clone, Copy, Debug)]
pub struct AllocatorLayout {
    /// From one allocator to the next.
    pub stride: u32,
    pub start: i32,
    pub end: i32,
    /// 32 bits.
    pub cell_size: i32,
    /// By the size in steps, rounded up. The cells of a class have the size of its last step. What is larger than all
    /// comes from the operations.
    pub class_of_step: &'static [u8],
}

impl AllocatorLayout {
    pub const STEP_LOG2: u8 = 4;

    /// The offset of the allocator from the first, and the size of its cells.
    pub fn for_size(&self, size: u32) -> Option<(i32, u32)> {
        let step = size.div_ceil(1 << Self::STEP_LOG2) as usize;
        let class = *self.class_of_step.get(step)?;
        let steps = self.class_of_step.partition_point(|&other| other <= class) - 1;
        let offset = u32::from(class) * self.stride;
        Some((offset as i32, (steps as u32) << Self::STEP_LOG2))
    }
}

/// Where things are in the objects of the heap.
#[derive(Clone, Copy, Debug)]
pub struct HostLayout {
    /// The bytes at the start of an instance that are the host's, a multiple of 16.
    pub instance_header_size: u32,
    /// A byte of every cell.
    pub cell_kind: i32,
    /// That of structs and arrays.
    pub object_kind: u8,
    /// A byte of every cell. After a reference is stored in the cell, [`Operation::WriteBarrier`] is due if the byte
    /// is not above the one at `barrier_threshold_address`.
    pub cell_state: i32,
    /// While the byte there is not zero the collector may be reading objects. So a reference is stored at once, and
    /// after all stores that initialize what it refers to. It becomes so only while the host allocates a cell.
    pub barrier_threshold_address: usize,
    /// The address that the number of an [`ObjectType`] is added to.
    pub object_types: usize,
    pub allocators: AllocatorLayout,
    /// The [`Callable`] in the object that a `funcref` is. A word with [`Signature::stack_bytes`] follows.
    pub function_callable: i32,
    /// In the object that an `exnref` is, the word that identifies its tag.
    pub exception_tag: i32,
    /// See [`payload_offsets`].
    pub exception_payload: i32,
    /// In the VM, the frame pointer of the stub that last called the host.
    pub vm_top_frame: i32,
    /// An access to null plus an offset below this faults. Zero if faults are not handled.
    pub null_guard_size: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GlobalPlace {
    /// The value is at this offset in the instance.
    Inline(i32),
    /// The address of the value is. References are written through [`Operation::GlobalSetReference`].
    Indirect(i32),
}

/// Offsets in an instance, which is a cell.
pub struct InstanceLayout {
    header: i32,
    memories: i32,
    tables: i32,
    imports: i32,
    tags: i32,
    types: i32,
    function_references: i32,
    globals: Vec<GlobalPlace>,
    size: u32,
}

impl InstanceLayout {
    const FIXED_WORDS: i32 = 7;

    /// The limits on what a module declares keep the size below 2^27.
    pub fn new(module: &ModuleHeader, host: &HostLayout) -> Self {
        let header = host.instance_header_size as i32;
        let mut end = header + Self::FIXED_WORDS * 8;
        let mut take = |count: usize, size: usize| {
            let start = end;
            end += (count * size) as i32;
            start
        };
        // An instance without memory has a view too, for those who load the base without asking.
        let memories = take(module.memories().len().max(1), size_of::<MemoryView>());
        let tables = take(module.tables().len(), size_of::<TableView>());
        let imported_globals = module.imported().globals as usize;
        let place = |(index, global): (usize, &bun_engine_wasm_format::Global)| {
            if global.mutable && (global.exported || index < imported_globals) {
                GlobalPlace::Indirect(take(1, 8))
            } else {
                GlobalPlace::Inline(take(1, global.ty.size_in_bytes().max(8) as usize))
            }
        };
        let globals = module.globals().iter().enumerate().map(place).collect();
        let imports = take(module.imported().funcs as usize, size_of::<Import>());
        let tags = take(module.tags().len(), 8);
        let types = take(module.types().len() as usize, 8);
        let function_references = take(module.funcs().len(), 8);
        Self {
            header,
            memories,
            tables,
            imports,
            tags,
            types,
            function_references,
            globals,
            size: end as u32,
        }
    }

    pub fn size(&self) -> u32 {
        self.size
    }

    pub fn vm(host: &HostLayout) -> i32 {
        host.instance_header_size as i32
    }

    /// The stack pointer must stay above the address here.
    pub fn stack_limit(host: &HostLayout) -> i32 {
        Self::vm(host) + 8
    }

    /// The address of what the run time keeps for the instance.
    pub fn runtime_data(host: &HostLayout) -> i32 {
        Self::vm(host) + 16
    }

    /// The address of the first allocator. See [`AllocatorLayout`].
    pub fn allocators(host: &HostLayout) -> i32 {
        Self::vm(host) + 24
    }

    /// A copy of [`HostLayout::object_types`].
    pub fn object_types(host: &HostLayout) -> i32 {
        Self::vm(host) + 32
    }

    /// The `exnref`, when a handler is entered. It is not null.
    pub fn caught(host: &HostLayout) -> i32 {
        Self::vm(host) + 40
    }

    /// What a prologue takes for the limit of the stack. Other threads raise it. See [`Stubs::check_entry`].
    pub fn entry_limit(host: &HostLayout) -> i32 {
        Self::vm(host) + 48
    }

    /// The same for every instance.
    pub fn memory_base(host: &HostLayout) -> i32 {
        Self::vm(host) + Self::FIXED_WORDS * 8 + MemoryView::BASE
    }

    pub fn header_size(&self) -> i32 {
        self.header
    }

    pub fn memory(&self, memory: MemoryIndex) -> i32 {
        self.memories + memory.0 as i32 * size_of::<MemoryView>() as i32
    }

    pub fn table(&self, table: TableIndex) -> i32 {
        self.tables + table.0 as i32 * size_of::<TableView>() as i32
    }

    pub fn import(&self, func: FuncIndex) -> i32 {
        self.imports + func.0 as i32 * size_of::<Import>() as i32
    }

    /// A word that identifies the tag.
    pub fn tag(&self, tag: TagIndex) -> i32 {
        self.tags + tag.0 as i32 * 8
    }

    /// The first word of a new struct or array of the type.
    pub fn object_header(&self, ty: TypeIndex) -> i32 {
        self.types + ty.0 as i32 * 8
    }

    /// The `funcref`, or zero until [`Operation::RefFunc`] makes it.
    pub fn function_reference(&self, func: FuncIndex) -> i32 {
        self.function_references + func.0 as i32 * 8
    }

    pub fn global(&self, global: GlobalIndex) -> GlobalPlace {
        self.globals[global.usize()]
    }
}

macro_rules! numbered {
    ($(#[$meta:meta])* $name:ident { $($(#[$variant_meta:meta])* $variant:ident,)* }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum $name {
            $($(#[$variant_meta])* $variant,)*
        }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant,)*];
            pub const COUNT: usize = Self::ALL.len();
        }
    };
}

numbered! {
    Trap {
        Unreachable,
        MemoryOutOfBounds,
        UnalignedAtomic,
        TableOutOfBounds,
        IndirectCallOutOfBounds,
        /// Also for an element that is null.
        SignatureMismatch,
        DivisionByZero,
        IntegerOverflow,
        TruncationOutOfRange,
        StackOverflow,
        /// An access to a struct or an array, and every fault at null.
        NullReference,
        NullExnref,
        NullI31,
        NullFunction,
        NullAsNonNull,
        NullArrayInitData,
        NullArrayInitElem,
        CastFailure,
        ArrayGetOutOfBounds,
        ArraySetOutOfBounds,
        ArrayFillOutOfBounds,
        ArrayCopyOutOfBounds,
        ArrayInitDataOutOfBounds,
        ArrayInitElemOutOfBounds,
        StructNewFailure,
        ArrayNewFailure,
        ArrayNewDataFailure,
        ArrayNewElemFailure,
        IllegalArgument,
        OutOfMemory,
    }
}

numbered! {
    /// Functions of the run time. They follow the C calling convention, but for overwriting both [`RESULT_GPRS`], and
    /// take the instance and then what is listed, all in general registers and extended to 64 bits with zeros. They
    /// check bounds, alignment and null. One that fails unwinds and does not return.
    Operation {
        /// `(memory, pages)`. The result has the width of an address of the memory.
        MemoryGrow,
        /// `(memory, dst, value, count)`
        MemoryFill,
        /// `(dst_memory, src_memory, dst, src, count)`
        MemoryCopy,
        /// `(memory, data, dst, src, count)`
        MemoryInit,
        /// `(data)`
        DataDrop,
        /// `(memory, offset, address, expected, timeout)`
        AtomicWait32,
        /// `(memory, offset, address, expected, timeout)`
        AtomicWait64,
        /// `(memory, offset, address, count)`
        AtomicNotify,
        /// `(table, index)`, for a [`FunctionElement`] without a reference.
        TableGet,
        /// `(table, index, value)`
        TableSet,
        /// `(table, value, count)`. The result has the width of an index of the table.
        TableGrow,
        /// `(table, dst, value, count)`
        TableFill,
        /// `(dst_table, src_table, dst, src, count)`
        TableCopy,
        /// `(table, elem, dst, src, count)`
        TableInit,
        /// `(elem)`
        ElemDrop,
        /// `(func)`
        RefFunc,
        /// `(global, value)`
        GlobalSetReference,
        /// `(cell)`
        WriteBarrier,
        /// `(type)`. The fields are zero or null.
        StructNew,
        /// `(type, low, high, length)`, with the bits of the value in `low` and, for a `v128`, in `high`.
        ArrayNew,
        /// `(type, length)`. The elements are zero or null.
        ArrayNewDefault,
        /// `(type, data, src, length)`
        ArrayNewData,
        /// `(type, elem, src, length)`
        ArrayNewElem,
        /// `(array, dst, low, high, count)`
        ArrayFill,
        /// `(dst_array, dst, src_array, src, count)`
        ArrayCopy,
        /// `(data, array, dst, src, count)`
        ArrayInitData,
        /// `(elem, array, dst, src, count)`
        ArrayInitElem,
        /// `(value)`
        AnyConvertExtern,
        /// `(tag, address of the payload)`
        Throw,
        /// `(exnref)`
        ThrowRef,
    }
}

/// Addresses of code that is the same for all modules.
pub struct Stubs {
    pub operations: [usize; Operation::COUNT],
    /// Called, so that the return address tells where. The frame is entered and filled in, and the stack pointer is
    /// anywhere in the stack.
    pub traps: [usize; Trap::COUNT],
    /// A C function that takes two addresses, the destination first, and a number of bytes. They may overlap.
    pub move_bytes: usize,
    /// A C function that takes an address, a byte and a number of bytes.
    pub fill_bytes: usize,
    /// Called from a prologue if the frame, which is entered and filled in, reaches below
    /// [`InstanceLayout::entry_limit`]. Returns if there is room for it, and keeps the arguments, [`SLOT`] and the
    /// other register that C functions take no argument in.
    pub check_entry: usize,
    /// Called if the frame pointer is below [`InstanceLayout::entry_limit`], where a trap could be. If it returns, it
    /// has done nothing, and has kept all registers that a jump keeps.
    pub poll: usize,
    /// Does [`Operation::WriteBarrier`] for the cell in [`SLOT`]. Keeps all registers that a jump keeps.
    pub write_barrier: usize,
    /// Called before an indirect call if [`SLOT`] is not what the profile has, which has counted the call. Keeps all
    /// registers but [`PROFILE`].
    pub note_callee: usize,
    /// Called from the prologue of baseline code, once the stack is checked. Keeps all registers.
    pub tier_up_at_entry: usize,
    /// Called from the start of a loop with its index in [`SLOT`]. Returns in [`SLOT`] zero or the address at which
    /// optimized code takes over the frame, for which there is room on the stack. Keeps all other registers.
    pub tier_up_in_loop: usize,
}

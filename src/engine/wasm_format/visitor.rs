//! What is called for each instruction.
//!
//! A method that is not implemented calls [`Visit::unhandled`]. `#[deny(clippy::missing_trait_methods)]` on an
//! `impl` proves that there is none.

use bun_engine_asm::{
    AtomicOp, Cond, FloatCond, FloatWidth, Rounding, Shift, Sign, Size, VectorBinary, VectorReduce,
    VectorShift, VectorTernary, VectorUnary, Width,
};

use crate::index::{
    DataIndex, ElemIndex, FuncIndex, GlobalIndex, MemoryIndex, TableIndex, TagIndex, TypeIndex,
};
use crate::ops::{
    BrTable, Catches, FloatBinaryOp, FloatUnaryOp, Flow, IntBinaryOp, IntUnaryOp, LaneType, LoadOp,
    MemArg, StoreOp, VectorLoadOp,
};
use crate::types::{BlockType, HeapType, RefType, ValType};

pub trait Visit {
    type Error;

    fn unhandled(&mut self) -> Result<(), Self::Error>;

    /// Before each instruction. The offset is from the start of the body, where the locals are declared.
    #[inline]
    fn at(&mut self, _offset: u32) {}

    /// After each instruction. If the visitor knows that control does not go on, the rest of the block is skipped.
    #[inline]
    fn flow(&self) -> Flow {
        Flow::Live
    }
}

macro_rules! visitors {
    ($($(#[$trait_meta:meta])* trait $trait:ident {
        $($(#[$meta:meta])* fn $name:ident($($argument:ident: $type:ty),*);)*
    })*) => {
        $($(#[$trait_meta])*
        pub trait $trait: Visit {
            $($(#[$meta])*
            #[inline]
            fn $name(&mut self, $($argument: $type),*) -> Result<(), Self::Error> {
                $(let _ = $argument;)*
                self.unhandled()
            })*
        })*

        pub trait Visitor: $($trait +)* {}

        impl<T: $($trait +)*> Visitor for T {}
    };
}

visitors! {
    /// A label counts blocks outwards from 0. The last is the body itself.
    trait VisitControl {
        fn unreachable();
        fn nop();
        fn block(ty: BlockType);
        /// `index` counts the loops of the body, skipped ones too.
        fn loop_(ty: BlockType, index: u32);
        fn if_(ty: BlockType);
        fn else_(flow: Flow);
        /// The body has one too.
        fn end(flow: Flow);
        fn br(label: u32);
        fn br_if(label: u32);
        fn br_table(table: BrTable<'_>);
        fn br_on_null(label: u32);
        fn br_on_non_null(label: u32);
        fn br_on_cast(label: u32, from: RefType, to: RefType);
        fn br_on_cast_fail(label: u32, from: RefType, to: RefType);
        fn return_();

        /// `site` counts the calls of the body, of all kinds, skipped ones too.
        fn call(func: FuncIndex, site: u32);
        fn call_indirect(ty: TypeIndex, table: TableIndex, site: u32);
        fn call_ref(ty: TypeIndex, site: u32);
        fn return_call(func: FuncIndex, site: u32);
        fn return_call_indirect(ty: TypeIndex, table: TableIndex, site: u32);
        fn return_call_ref(ty: TypeIndex, site: u32);

        fn throw(tag: TagIndex);
        fn throw_ref();
        fn try_table(ty: BlockType, catches: Catches<'_>);
        fn try_(ty: BlockType);
        fn catch(tag: TagIndex, flow: Flow);
        fn catch_all(flow: Flow);
        /// Ends the `try`. The label counts from outside it and names a block of any kind: what the `try` caught
        /// is thrown again as if by an instruction directly in that block.
        fn delegate(label: u32, flow: Flow);
        /// The label names a `try` that is in a `catch` or `catch_all`.
        fn rethrow(label: u32);
    }

    trait VisitVariable {
        fn drop_();
        /// `None` is for numbers and vectors.
        fn select(ty: Option<ValType>);
        fn local_get(local: u32);
        fn local_set(local: u32);
        fn local_tee(local: u32);
        fn global_get(global: GlobalIndex);
        fn global_set(global: GlobalIndex);
    }

    trait VisitNumeric {
        fn i32_const(value: i32);
        fn i64_const(value: i64);
        fn f32_const(bits: u32);
        fn f64_const(bits: u64);
        fn int_eqz(width: Width);
        fn int_compare(width: Width, cond: Cond);
        fn int_unary(width: Width, op: IntUnaryOp);
        fn int_binary(width: Width, op: IntBinaryOp);
        fn int_div(width: Width, sign: Sign);
        fn int_rem(width: Width, sign: Sign);
        fn int_shift(width: Width, shift: Shift);
        /// The low `from` bits of an integer of `width`.
        fn int_sign_extend(width: Width, from: Size);
        fn float_compare(width: FloatWidth, cond: FloatCond);
        fn float_unary(width: FloatWidth, op: FloatUnaryOp);
        fn float_round(width: FloatWidth, rounding: Rounding);
        fn float_binary(width: FloatWidth, op: FloatBinaryOp);
        fn i32_wrap_i64();
        fn i64_extend_i32(sign: Sign);
        fn truncate_float(from: FloatWidth, sign: Sign, to: Width);
        fn truncate_float_saturating(from: FloatWidth, sign: Sign, to: Width);
        fn convert_int_to_float(sign: Sign, from: Width, to: FloatWidth);
        fn f32_demote_f64();
        fn f64_promote_f32();
        fn reinterpret_float_as_int(width: FloatWidth);
        fn reinterpret_int_as_float(width: FloatWidth);
        fn i64_add128();
        fn i64_sub128();
        fn i64_mul_wide(sign: Sign);
    }

    /// For atomics `width` is that of the value on the operand stack, `size` that in memory.
    trait VisitMemory {
        fn load(op: LoadOp, arg: MemArg);
        fn store(op: StoreOp, arg: MemArg);
        fn memory_size(memory: MemoryIndex);
        fn memory_grow(memory: MemoryIndex);
        fn memory_fill(memory: MemoryIndex);
        fn memory_copy(dst: MemoryIndex, src: MemoryIndex);
        fn memory_init(memory: MemoryIndex, data: DataIndex);
        fn data_drop(data: DataIndex);

        fn atomic_load(width: Width, size: Size, arg: MemArg);
        fn atomic_store(width: Width, size: Size, arg: MemArg);
        fn atomic_update(op: AtomicOp, width: Width, size: Size, arg: MemArg);
        fn atomic_compare_exchange(width: Width, size: Size, arg: MemArg);
        fn atomic_wait(width: Width, arg: MemArg);
        fn atomic_notify(arg: MemArg);
        fn atomic_fence();

        fn table_get(table: TableIndex);
        fn table_set(table: TableIndex);
        fn table_size(table: TableIndex);
        fn table_grow(table: TableIndex);
        fn table_fill(table: TableIndex);
        fn table_copy(dst: TableIndex, src: TableIndex);
        fn table_init(table: TableIndex, elem: ElemIndex);
        fn elem_drop(elem: ElemIndex);
    }

    trait VisitReference {
        fn ref_null(ty: HeapType);
        fn ref_is_null();
        fn ref_func(func: FuncIndex);
        fn ref_eq();
        fn ref_as_non_null();
        fn ref_test(ty: RefType);
        fn ref_cast(ty: RefType);
        fn ref_i31();
        fn i31_get(sign: Sign);
        fn any_convert_extern();
        fn extern_convert_any();

        fn struct_new(ty: TypeIndex);
        fn struct_new_default(ty: TypeIndex);
        /// `sign` is for packed fields.
        fn struct_get(ty: TypeIndex, field: u32, sign: Option<Sign>);
        fn struct_set(ty: TypeIndex, field: u32);

        fn array_new(ty: TypeIndex);
        fn array_new_default(ty: TypeIndex);
        fn array_new_fixed(ty: TypeIndex, length: u32);
        fn array_new_data(ty: TypeIndex, data: DataIndex);
        fn array_new_elem(ty: TypeIndex, elem: ElemIndex);
        /// `sign` is for packed elements.
        fn array_get(ty: TypeIndex, sign: Option<Sign>);
        fn array_set(ty: TypeIndex);
        fn array_len();
        fn array_fill(ty: TypeIndex);
        fn array_copy(dst: TypeIndex, src: TypeIndex);
        fn array_init_data(ty: TypeIndex, data: DataIndex);
        fn array_init_elem(ty: TypeIndex, elem: ElemIndex);
    }

    trait VisitVector {
        /// Lane 0 is in the low bits.
        fn v128_const(bits: u128);
        fn vector_load(op: VectorLoadOp, arg: MemArg);
        fn vector_store(arg: MemArg);
        fn vector_load_lane(size: Size, lane: u8, arg: MemArg);
        fn vector_store_lane(size: Size, lane: u8, arg: MemArg);
        fn vector_splat(ty: LaneType);
        /// `sign` matters for lanes of 8 and 16 bits and is `Unsigned` otherwise.
        fn vector_extract_lane(ty: LaneType, sign: Sign, lane: u8);
        fn vector_replace_lane(ty: LaneType, lane: u8);
        fn vector_shuffle(lanes: [u8; 16]);
        fn vector_unary(op: VectorUnary);
        fn vector_binary(op: VectorBinary);
        fn vector_ternary(op: VectorTernary);
        fn vector_shift(op: VectorShift);
        fn vector_reduce(op: VectorReduce);
    }
}

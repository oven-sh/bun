//! What the run time does. The operands are in the slots from `low` on, and a result takes the place of the first.
//! Indices are in `imm` and in a second record.

use bun_engine_asm::Width;
use bun_engine_wasm_format::{DataIndex, ElemIndex, FuncIndex, MemoryIndex, TableIndex, TypeIndex};

use crate::machine::{attempt, given, handlers};

macro_rules! operations {
    ($($(#[$collects:ident])? fn $name:ident($m:ident, $op:ident $(, $more:ident)?) $(-> $result:ident)? $body:block)*) => {
        handlers! {$(
            fn $name($m, $op $(, $more)?) {
                $(operations!(@$collects $m);)?
                let _outcome = attempt!($body);
                $m.forget_last_results();
                $(operations!(@$result $m, $op, _outcome);)?
            }
        )*}
    };
    (@collects $m:ident) => {
        $m.keep_frame()
    };
    (@value $m:ident, $op:ident, $outcome:ident) => {
        given!(given!($m.range($op.low(), 1)).first()).set($outcome);
        $m.int = $outcome;
    };
}

fn join(low: u64, high: u64) -> u128 {
    u128::from(low) | u128::from(high) << 64
}

operations! {
    #[collects]
    fn memory_grow(m, op) -> value {
        let [pages] = given!(m.operands(op.low()));
        let old = m.cx.memory_grow(MemoryIndex(op.imm), pages);
        m.memory = m.cx.first_memory();
        old
    }

    fn memory_fill(m, op) {
        m.cx.memory_fill(MemoryIndex(op.imm), given!(m.operands(op.low())))
    }

    fn memory_copy(m, op, from) {
        m.cx.memory_copy(MemoryIndex(op.imm), MemoryIndex(from.imm), given!(m.operands(op.low())))
    }

    fn memory_init(m, op, data) {
        m.cx.memory_init(MemoryIndex(op.imm), DataIndex(data.imm), given!(m.operands(op.low())))
    }

    #[collects]
    fn atomic_wait32(m, op, offset) -> value {
        m.cx.atomic_wait(Width::W32, MemoryIndex(op.imm), offset.whole(), given!(m.operands(op.low())))
    }

    #[collects]
    fn atomic_wait64(m, op, offset) -> value {
        m.cx.atomic_wait(Width::W64, MemoryIndex(op.imm), offset.whole(), given!(m.operands(op.low())))
    }

    fn atomic_notify(m, op, offset) -> value {
        m.cx.atomic_notify(MemoryIndex(op.imm), offset.whole(), given!(m.operands(op.low())))
    }

    #[collects]
    fn table_get(m, op) -> value {
        let [index] = given!(m.operands(op.low()));
        m.cx.table_get(TableIndex(op.imm), index)
    }

    fn table_set(m, op) {
        m.cx.table_set(TableIndex(op.imm), given!(m.operands(op.low())))
    }

    #[collects]
    fn table_grow(m, op) -> value {
        m.cx.table_grow(TableIndex(op.imm), given!(m.operands(op.low())))
    }

    fn table_fill(m, op) {
        m.cx.table_fill(TableIndex(op.imm), given!(m.operands(op.low())))
    }

    fn table_copy(m, op, from) {
        m.cx.table_copy(TableIndex(op.imm), TableIndex(from.imm), given!(m.operands(op.low())))
    }

    #[collects]
    fn table_init(m, op, elem) {
        m.cx.table_init(TableIndex(op.imm), ElemIndex(elem.imm), given!(m.operands(op.low())))
    }

    #[collects]
    fn ref_func(m, op) -> value {
        m.cx.ref_func(FuncIndex(op.imm))
    }

    #[collects]
    fn struct_new(m, op, slots) -> value {
        m.cx.struct_new(TypeIndex(op.imm), given!(m.range(op.low(), slots.imm as usize)))
    }

    #[collects]
    fn struct_new_default(m, op) -> value {
        m.cx.struct_new_default(TypeIndex(op.imm))
    }

    #[collects]
    fn array_new(m, op) -> value {
        let [value, length] = given!(m.operands(op.low()));
        m.cx.array_new(TypeIndex(op.imm), value.into(), length as u32)
    }

    #[collects]
    fn array_of_vectors_new(m, op) -> value {
        let [low, high, length] = given!(m.operands(op.low()));
        m.cx.array_new(TypeIndex(op.imm), join(low, high), length as u32)
    }

    #[collects]
    fn array_new_default(m, op) -> value {
        let [length] = given!(m.operands(op.low()));
        m.cx.array_new_default(TypeIndex(op.imm), length as u32)
    }

    #[collects]
    fn array_new_fixed(m, op, counts) -> value {
        let values = given!(m.range(op.low(), counts.imm as usize));
        m.cx.array_new_fixed(TypeIndex(op.imm), counts.low(), values)
    }

    #[collects]
    fn array_new_data(m, op, data) -> value {
        m.cx.array_new_data(TypeIndex(op.imm), DataIndex(data.imm), given!(m.operands(op.low())))
    }

    #[collects]
    fn array_new_elem(m, op, elem) -> value {
        m.cx.array_new_elem(TypeIndex(op.imm), ElemIndex(elem.imm), given!(m.operands(op.low())))
    }

    fn array_fill(m, op) {
        let [array, dst, value, count] = given!(m.operands(op.low()));
        m.cx.array_fill(array, dst as u32, value.into(), count as u32)
    }

    fn array_of_vectors_fill(m, op) {
        let [array, dst, low, high, count] = given!(m.operands(op.low()));
        m.cx.array_fill(array, dst as u32, join(low, high), count as u32)
    }

    fn array_copy(m, op) {
        m.cx.array_copy(given!(m.operands(op.low())))
    }

    fn array_init_data(m, op) {
        m.cx.array_init_data(DataIndex(op.imm), given!(m.operands(op.low())))
    }

    #[collects]
    fn array_init_elem(m, op) {
        m.cx.array_init_elem(ElemIndex(op.imm), given!(m.operands(op.low())))
    }
}

handlers! {
    fn data_drop(m, op) {
        m.cx.data_drop(DataIndex(op.imm));
        m.forget_last_results();
    }

    fn elem_drop(m, op) {
        m.cx.elem_drop(ElemIndex(op.imm));
        m.forget_last_results();
    }

    fn table_size(m, op) {
        let size = m.cx.table_size(TableIndex(op.imm));
        m.forget_last_results();
        m.produce(op.a, size);
    }
}

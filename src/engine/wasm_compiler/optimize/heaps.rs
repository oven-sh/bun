//! The parts of memory that do not overlap.

use bun_engine_codegen::ir::{Function, Heap, HeapRange};
use bun_engine_wasm_format::limits::{MAX_GLOBALS, MAX_MEMORIES, MAX_TABLES};
use bun_engine_wasm_format::{
    GlobalIndex, MemoryIndex, ModuleHeader, TableIndex, TypeIndex, TypeKind, Types,
};

use super::map::Map;

// Imports may be the same object, so each kind has one place for all of them.
const MEMORIES: u32 = 0;
const MEMORY_VIEWS: u32 = MEMORIES + 1 + MAX_MEMORIES;
const COLLECTOR: u32 = MEMORY_VIEWS + 1;
const FUNCTION_REFERENCES: u32 = COLLECTOR + 1;
const TABLE_VIEWS: u32 = FUNCTION_REFERENCES + 1;
const TABLES: u32 = TABLE_VIEWS + 1;
const GLOBALS: u32 = TABLES + 1 + MAX_TABLES;
const PAYLOAD: u32 = GLOBALS + 1 + MAX_GLOBALS;
const MUTABLE_FIELDS: u32 = PAYLOAD + 1;
const IMMUTABLE_FIELDS: u32 = 1 << 31;

#[derive(Clone, Copy)]
pub(super) struct Named {
    /// All but the fields that only the code that makes an object writes.
    pub(super) mutable: Heap,
    /// What changes when a memory grows.
    pub(super) memories: Heap,
    pub(super) memory_views: Heap,
    /// What changes when a cell is allocated.
    pub(super) collector: Heap,
    pub(super) function_references: Heap,
    pub(super) table_views: Heap,
    /// What changes when a table does, or a reference to a function is made.
    pub(super) tables: Heap,
    pub(super) payload: Heap,
    first_memory: Heap,
}

#[derive(Default)]
pub(super) struct Heaps {
    known: Map<Heap>,
    field_count: u32,
}

fn add(function: &mut Function, start: u32, end: u32) -> Heap {
    function.add_heap(HeapRange { start, end })
}

fn place(first: u32, index: u32, imported: u32) -> u32 {
    if index < imported {
        first
    } else {
        first + 1 + index
    }
}

impl Named {
    pub(super) fn new(function: &mut Function, module: &ModuleHeader) -> Self {
        let mut at = |place: u32| add(function, place, place + 1);
        Self {
            memory_views: at(MEMORY_VIEWS),
            collector: at(COLLECTOR),
            function_references: at(FUNCTION_REFERENCES),
            table_views: at(TABLE_VIEWS),
            payload: at(PAYLOAD),
            first_memory: at(place(MEMORIES, 0, module.imported().memories)),
            mutable: add(function, 0, IMMUTABLE_FIELDS),
            memories: add(function, MEMORIES, COLLECTOR + 1),
            tables: add(function, COLLECTOR, GLOBALS),
        }
    }
}

impl Heaps {
    pub(super) fn clear(&mut self) {
        self.known.clear();
        self.field_count = 0;
    }

    fn at(&mut self, function: &mut Function, place: u32) -> Heap {
        (self.known).get_or_insert_with(place.into(), || add(function, place, place + 1))
    }

    #[inline]
    pub(super) fn memory(
        &mut self,
        function: &mut Function,
        named: &Named,
        module: &ModuleHeader,
        memory: MemoryIndex,
    ) -> Heap {
        if memory.0 == 0 {
            return named.first_memory;
        }
        let imported = module.imported().memories;
        self.at(function, place(MEMORIES, memory.0, imported))
    }

    pub(super) fn table(
        &mut self,
        function: &mut Function,
        module: &ModuleHeader,
        table: TableIndex,
    ) -> Heap {
        self.at(function, place(TABLES, table.0, module.imported().tables))
    }

    pub(super) fn global(
        &mut self,
        function: &mut Function,
        module: &ModuleHeader,
        global: GlobalIndex,
    ) -> Heap {
        let imported = module.imported().globals;
        self.at(function, place(GLOBALS, global.0, imported))
    }

    /// The elements of an array are its field 0. Subtypes share the field of the type that declares it.
    pub(super) fn field(
        &mut self,
        function: &mut Function,
        types: &Types,
        mut ty: TypeIndex,
        field: u32,
    ) -> Heap {
        let is_array = types.kind(ty) == TypeKind::Array;
        while let Some(supertype) = types.supertype(ty)
            && (is_array || (field as usize) < types.struct_type(supertype).fields.len())
        {
            ty = supertype;
        }
        let key = u64::from(ty.0 + 1) << 32 | u64::from(field);
        self.known.get_or_insert_with(key, || {
            let is_mutable = if is_array {
                types.array_type(ty).element.mutable
            } else {
                types.struct_type(ty).fields[field as usize].ty.mutable
            };
            let first = if is_mutable {
                MUTABLE_FIELDS
            } else {
                IMMUTABLE_FIELDS
            };
            self.field_count += 1;
            add(
                function,
                first + self.field_count,
                first + self.field_count + 1,
            )
        })
    }
}

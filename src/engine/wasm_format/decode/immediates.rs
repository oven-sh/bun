//! Indices, constants and memory arguments.

use bun_engine_asm::Width;

use super::{Decoder, Mode, Purpose};
use crate::error::Error;
use crate::index::{
    DataIndex, ElemIndex, FuncIndex, GlobalIndex, MemoryIndex, TableIndex, TypeIndex,
};
use crate::opcode;
use crate::ops::MemArg;
use crate::types::{HeapType, ValType};

const HAS_MEMORY_INDEX: u32 = 1 << 6;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Access {
    Load(u8),
    Store(u8),
    AtomicStore,
    /// Any other atomic instruction.
    Atomic,
    Vector,
}

impl<M: Mode> Decoder<'_, '_, M> {
    /// Error messages quote the index that the code has. Compilers get the one that value types have.
    #[inline(always)]
    pub(super) fn visible_type_index(&self, index: TypeIndex) -> TypeIndex {
        if M::PURPOSE == Purpose::Run {
            self.cx.header.types.first_index(index)
        } else {
            index
        }
    }

    #[inline]
    pub(super) fn value_type(&mut self) -> Option<ValType> {
        self.cx.header.value_type(&mut self.reader)
    }

    #[inline]
    pub(super) fn heap_type(&mut self) -> Option<HeapType> {
        self.cx.header.heap_type(&mut self.reader)
    }

    /// The visitor knows how many there are.
    #[inline(always)]
    pub(super) fn local(&mut self) -> Result<u32, M::Error> {
        Ok(read!(self, self.reader.u32(), "can't get index for local"))
    }

    #[inline(always)]
    pub(super) fn global(&mut self) -> Result<GlobalIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't get global's index");
        let count = self.cx.header.globals.len();
        ensure!(
            self,
            (index as usize) < count,
            validation,
            "{index} of unknown global, limit is {count}"
        );
        Ok(GlobalIndex(index))
    }

    #[inline(always)]
    pub(super) fn table(&mut self) -> Result<TableIndex, M::Error> {
        self.table_as("")
    }

    #[inline(always)]
    pub(super) fn table_as(&mut self, role: &'static str) -> Result<TableIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't parse {role}table index");
        let count = self.cx.header.tables.len();
        ensure!(
            self,
            (index as usize) < count,
            validation,
            "table index {index} is invalid, limit is {count}"
        );
        Ok(TableIndex(index))
    }

    pub(super) fn elem(&mut self) -> Result<ElemIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't parse element index");
        let count = self.cx.header.elems.len();
        ensure!(
            self,
            (index as usize) < count,
            validation,
            "element index {index} is invalid, limit is {count}"
        );
        Ok(ElemIndex(index))
    }

    pub(super) fn data(&mut self) -> Result<DataIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't parse data segment index");
        let count = self.cx.header.data_count.unwrap_or(0);
        ensure!(
            self,
            index < count,
            validation,
            "data segment index {index} is invalid, limit is {count}"
        );
        Ok(DataIndex(index))
    }

    #[inline(always)]
    pub(super) fn memory(&mut self) -> Result<MemoryIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't get memory index");
        ensure!(
            self,
            (index as usize) < self.cx.header.memories.len(),
            validation,
            "memory index {index} is out of range"
        );
        Ok(MemoryIndex(index))
    }

    #[inline(always)]
    pub(super) fn sized_memory(&mut self, name: &'static str) -> Result<MemoryIndex, M::Error> {
        let name = if self.is_dead() {
            "grow_memory/current_memory"
        } else {
            name
        };
        ensure!(
            self,
            !self.cx.header.memories.is_empty(),
            parse,
            "{name} is only valid if a memory is defined or imported"
        );
        self.memory()
    }

    #[inline(always)]
    pub(super) fn mem_arg(&mut self, access: Access, natural: u8) -> Result<MemArg, M::Error> {
        let mut reader = self.reader;
        let fits = |alignment: u8| match access {
            Access::Atomic | Access::AtomicStore => alignment == natural,
            _ => alignment <= natural,
        };
        if reader.u8().is_some_and(fits)
            && let Some(offset) = reader.u32()
            && (M::PURPOSE != Purpose::Check || !self.cx.header.memories.is_empty())
        {
            self.reader = reader;
            return Ok(MemArg {
                offset: offset.into(),
                memory: MemoryIndex(0),
            });
        }
        self.apart(|decoder| decoder.rare_mem_arg(access, natural))
    }

    #[inline(never)]
    fn rare_mem_arg(&mut self, access: Access, natural: u8) -> Result<MemArg, M::Error> {
        let dead = self.is_dead();
        let name = match access {
            Access::Load(_) | Access::Atomic => "load",
            Access::AtomicStore if dead => "load",
            Access::Store(_) | Access::AtomicStore => "store",
            Access::Vector => "simd memory op",
        };
        if M::PURPOSE == Purpose::Check && self.cx.header.memories.is_empty() {
            match access {
                Access::Load(_) | Access::Store(_) if dead => {
                    fail!(self, parse, "load/store instruction without memory")
                }
                Access::Load(_) | Access::Store(_) => {
                    fail!(self, validation, "{name} instruction without memory")
                }
                Access::Atomic | Access::AtomicStore => {
                    fail!(self, validation, "atomic instruction without memory")
                }
                Access::Vector => fail!(
                    self,
                    validation,
                    "simd memory instructions need a memory defined in the module"
                ),
            }
        }

        let flags = match (self.reader.u32(), access) {
            (Some(flags), _) => flags,
            (None, Access::Load(op) | Access::Store(op)) if dead => {
                let name = opcode::name(op);
                fail!(
                    self,
                    parse,
                    "can't get first immediate for {name} in unreachable context"
                )
            }
            (None, _) => fail!(self, parse, "can't get {name} alignment"),
        };
        ensure!(
            self,
            flags < 2 * HAS_MEMORY_INDEX,
            parse,
            "byte alignment immediate {flags} is too large"
        );
        let memory = if flags & HAS_MEMORY_INDEX != 0 {
            self.memory()?
        } else {
            MemoryIndex(0)
        };

        let alignment = flags % HAS_MEMORY_INDEX;
        let (bytes, natural_bytes) = (1u64 << alignment, 1u64 << natural);
        match access {
            Access::Load(op) | Access::Store(op) => {
                let name = if dead { opcode::name(op) } else { name };
                ensure!(
                    self,
                    bytes <= natural_bytes,
                    parse,
                    "byte alignment {bytes} exceeds {name}'s natural alignment {natural_bytes}"
                );
            }
            Access::Atomic | Access::AtomicStore => ensure!(
                self,
                bytes == natural_bytes,
                parse,
                "byte alignment {bytes} does not match against atomic op's natural alignment {natural_bytes}"
            ),
            Access::Vector => {}
        }

        let offset = read!(self, self.reader.u64(), "can't get memory offset");
        ensure!(
            self,
            offset <= u32::MAX.into() || self.cx.header.memory(memory).address == Width::W64,
            validation,
            "memory offset {offset} is out of range for an i32 memory"
        );
        ensure!(
            self,
            bytes <= natural_bytes,
            validation,
            "alignment: {alignment} can't be larger than max alignment for simd operation: {natural}"
        );
        Ok(MemArg { offset, memory })
    }

    #[inline(always)]
    pub(super) fn i32_immediate(&mut self) -> Result<i32, M::Error> {
        Ok(read!(
            self,
            self.reader.i32(),
            live: "can't parse 32-bit constant",
            dead: "can't get immediate for I32Const"
        ))
    }

    #[inline(always)]
    pub(super) fn i64_immediate(&mut self) -> Result<i64, M::Error> {
        Ok(read!(
            self,
            self.reader.i64(),
            live: "can't parse 64-bit constant",
            dead: "can't get immediate for I64Const"
        ))
    }

    #[inline(always)]
    pub(super) fn float_immediate<const N: usize>(&mut self) -> Result<[u8; N], M::Error> {
        let bits = 8 * N;
        Ok(read!(
            self,
            self.reader.array(),
            "can't parse {bits}-bit floating-point constant"
        ))
    }

    #[inline(never)]
    pub(super) fn select_type(&mut self) -> Result<ValType, M::Error> {
        let count = read!(
            self,
            self.reader.u32(),
            "select can't parse the size of annotation vector"
        );
        ensure!(self, count == 1, parse, "select invalid result arity for");
        Ok(read!(
            self,
            self.value_type(),
            "select can't parse annotations"
        ))
    }

    #[inline(never)]
    pub(super) fn null_type(&mut self) -> Result<HeapType, M::Error> {
        Ok(read!(
            self,
            self.heap_type(),
            live: "ref.null heaptype must be funcref, externref or type_idx",
            dead: "can't get heap type for RefNull"
        ))
    }

    /// The validator checks that it is declared.
    #[inline(never)]
    pub(super) fn referenced_func(&mut self) -> Result<FuncIndex, M::Error> {
        match self.func() {
            Err(_) if !self.is_dead() => fail!(self, parse, "can't get index for ref.func"),
            result => result,
        }
    }
}

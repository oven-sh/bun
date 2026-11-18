//! Blocks, labels and calls.

use super::types::{self, EMPTY, I32, I64, V128};
use super::{Decoder, Mode, Purpose};
use crate::error::Error;
use crate::index::{FuncIndex, TableIndex, TagIndex, TypeIndex};
use crate::module::FunctionFlags;
use crate::opcode::{self, BLOCK, IF, LOOP, TRY, TRY_TABLE};
use crate::ops::{BrTable, Catches, Flow};
use crate::types::{AbstractHeapType, BlockType, TypeKind, ValType};

const MAX_BLOCK_TYPE_INDEX_BYTES: usize = 5;

impl<'a, M: Mode> Decoder<'_, 'a, M> {
    #[inline(always)]
    pub(super) fn is_dead(&self) -> bool {
        self.cx.dead != 0
    }

    /// What messages end with.
    #[inline(always)]
    pub(super) fn context(&self) -> &'static str {
        if self.is_dead() {
            " in unreachable context"
        } else {
            ""
        }
    }

    #[inline(always)]
    pub(super) fn note_if_live(&mut self, flag: FunctionFlags) {
        if !self.is_dead() {
            self.cx.flags |= flag;
        }
    }

    #[inline(always)]
    pub(super) fn open_block(&mut self) {
        self.cx.depth += 1;
        if M::PURPOSE == Purpose::Check && self.is_dead() {
            self.cx.dead += 1;
        }
    }

    #[inline(always)]
    fn flow(&self) -> Flow {
        if self.is_dead() {
            Flow::Dead
        } else {
            Flow::Live
        }
    }

    #[inline(always)]
    pub(super) fn next_arm(&mut self) -> Flow {
        let flow = self.flow();
        if M::PURPOSE != Purpose::Skip && self.cx.dead == 1 {
            self.cx.dead = 0;
        }
        flow
    }

    #[inline(always)]
    pub(super) fn close_block(&mut self) -> Flow {
        let flow = self.flow();
        self.cx.depth -= 1;
        if M::PURPOSE != Purpose::Skip {
            self.cx.dead = self.cx.dead.saturating_sub(1);
        }
        flow
    }

    /// For an instruction after which control does not go on.
    #[inline(always)]
    pub(super) fn transfer(
        &mut self,
        visit: impl FnOnce() -> Result<(), M::Error>,
    ) -> Result<(), M::Error> {
        self.cx.dead = self.cx.dead.max(1);
        visit()?;
        if M::PURPOSE == Purpose::Run {
            self.skip_dead_code();
        }
        Ok(())
    }

    #[inline(always)]
    pub(super) fn ensure_in_block(&self, what: &'static str) -> Result<(), M::Error> {
        ensure!(
            self,
            self.cx.depth > 1 || self.is_dead(),
            parse,
            "can't use {what} at the top-level of a function"
        );
        Ok(())
    }

    #[inline(always)]
    pub(super) fn call_site(&mut self) -> u32 {
        self.cx.calls += 1;
        self.cx.calls - 1
    }

    #[inline(always)]
    pub(super) fn tail_call_site(&mut self) -> u32 {
        self.cx.flags |= FunctionFlags::HAS_TAIL_CALL;
        self.call_site()
    }

    #[inline(always)]
    pub(crate) fn block_type(&mut self, op: u8) -> Result<BlockType, M::Error> {
        let ty = match self.reader.peek() {
            Some(EMPTY) => BlockType::Empty,
            Some(I32) => BlockType::Value(ValType::I32),
            Some(I64) => BlockType::Value(ValType::I64),
            _ => return self.apart(|decoder| decoder.rare_block_type(op)),
        };
        self.reader.set_position(self.reader.position() + 1);
        Ok(ty)
    }

    #[inline(never)]
    fn rare_block_type(&mut self, op: u8) -> Result<BlockType, M::Error> {
        if let Some(ty) = self.try_block_type() {
            return Ok(ty);
        }
        if self.is_dead() && op != TRY_TABLE {
            let name = opcode::name(op);
            fail!(
                self,
                parse,
                "can't get inline type for {name} in unreachable context"
            );
        }
        let context = self.context();
        let name = match op {
            BLOCK => "block",
            LOOP => "loop",
            IF => "if",
            TRY => "try",
            _ => "try_table",
        };
        fail!(self, parse, "can't get {name}'s signature{context}");
    }

    fn try_block_type(&mut self) -> Option<BlockType> {
        let start = self.reader.position();
        let first = self.reader.peek()?;
        if types::starts_value_type(first) {
            let ty = self.value_type();
            if ty.is_none() && first == V128 {
                self.reader.set_position(start);
            }
            return ty.map(BlockType::Value);
        }
        let index = u32::try_from(self.reader.i64()?).ok()?;
        let heap_type = self.cx.header.types.get_heap_type(index)?;
        let is_valid = heap_type.has_kind(TypeKind::Func)
            && self.reader.position() - start <= MAX_BLOCK_TYPE_INDEX_BYTES;
        heap_type.index().filter(|_| is_valid).map(BlockType::Func)
    }

    #[inline(always)]
    pub(super) fn label(&mut self) -> Result<u32, M::Error> {
        let label = read!(self, self.reader.u32(), "can't get br / br_if's target");
        let depth = self.cx.depth;
        ensure!(
            self,
            label < depth,
            parse,
            "br / br_if's target {label} exceeds control stack size {depth}"
        );
        Ok(label)
    }

    #[inline(always)]
    pub(super) fn delegate_label(&mut self) -> Result<u32, M::Error> {
        let outer = self.cx.depth - 1;
        ensure!(
            self,
            outer > 0,
            parse,
            "can't use delegate at the top-level of a function"
        );
        let label = read!(self, self.reader.u32(), "can't get delegate target");
        ensure!(
            self,
            label < outer,
            parse,
            "delegate target {label} exceeds control stack size {outer}"
        );
        Ok(label)
    }

    #[inline(never)]
    pub(super) fn br_table(&mut self) -> Result<BrTable<'a>, M::Error> {
        let context = self.context();
        let depth = self.cx.depth;
        let count = read!(
            self,
            self.reader.u32(),
            "can't get the number of targets for br_table{context}"
        );
        ensure!(
            self,
            count != u32::MAX,
            parse,
            "br_table's number of targets is too big {count}"
        );
        let reader = self.reader;
        for i in 0..count {
            let label = self.reader.u32();
            if label.is_some_and(|label| M::PURPOSE != Purpose::Check || label < depth) {
                continue;
            }
            // In live code the error is reported after the last label.
            if !self.is_dead() {
                for _ in 0..(count - i - 1).min(self.reader.remaining() as u32) {
                    let _ = self.reader.u32();
                }
            }
            match label {
                Some(label) => fail!(
                    self,
                    parse,
                    "br_table's {i}th target {label} exceeds control stack size {depth}"
                ),
                None => fail!(self, parse, "can't get {i}th target for br_table{context}"),
            }
        }
        let default = read!(
            self,
            self.reader.u32(),
            "can't get default target for br_table{context}"
        );
        ensure!(
            self,
            default < depth,
            parse,
            "br_table's default target {default} exceeds control stack size {depth}"
        );
        Ok(BrTable {
            reader,
            count,
            default,
        })
    }

    #[inline(never)]
    pub(super) fn catches(&mut self) -> Result<Catches<'a>, M::Error> {
        let context = self.context();
        let depth = self.cx.depth;
        let count = read!(
            self,
            self.reader.u32(),
            "can't get the number of catch statements for try_table{context}"
        );
        ensure!(
            self,
            count != u32::MAX || self.is_dead(),
            parse,
            "try_table's number of catch targets is too big {count}"
        );
        let reader = self.reader;
        for i in 0..count {
            let kind = read!(
                self,
                self.reader.u8(),
                live: "can't read opcode of try_table catch at index {i}",
                dead: "can't get catch opcode for try_table"
            );
            ensure!(
                self,
                kind <= Catches::ALL_TAGS | Catches::PASSES_EXNREF,
                parse,
                live: "invalid opcode of try_table catch at index {i},  opcode {kind} is invalid",
                dead: "invalid catch opcode for try_table"
            );
            if kind & Catches::ALL_TAGS == 0 {
                read!(
                    self,
                    self.tag().ok(),
                    live: "can't read tag of try_table catch at index {i}",
                    dead: "invalid exception tag for try_table"
                );
            }
            let label = read!(
                self,
                self.reader.u32(),
                live: "can't read label of try_table catch at index {i}",
                dead: "invalid destination label for try_table"
            );
            ensure!(
                self,
                label < depth,
                parse,
                "try_table's catch target {label} exceeds control stack size {depth}"
            );
        }
        Ok(Catches { reader, count })
    }

    #[inline(always)]
    pub(super) fn tag(&mut self) -> Result<TagIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't parse exception index");
        let count = self.cx.header.tags.len();
        ensure!(
            self,
            (index as usize) < count,
            validation,
            "exception index {index} is invalid, limit is {count}"
        );
        Ok(TagIndex(index))
    }

    #[inline(always)]
    pub(super) fn func(&mut self) -> Result<FuncIndex, M::Error> {
        let index = read!(self, self.reader.u32(), "can't parse function index");
        let count = self.cx.header.funcs.len();
        ensure!(
            self,
            (index as usize) < count,
            parse,
            "function index {index} exceeds function index space {count}"
        );
        Ok(FuncIndex(index))
    }

    #[inline(never)]
    pub(super) fn call_indirect_immediates(&mut self) -> Result<(TypeIndex, TableIndex), M::Error> {
        let header = self.cx.header;
        let (tables, types) = (header.tables.len(), header.types.len());
        ensure!(
            self,
            tables != 0,
            parse,
            "call_indirect is only valid when a table is defined or imported"
        );
        let ty = read!(
            self,
            self.reader.u32(),
            "can't get call_indirect's signature index"
        );
        let table = read!(
            self,
            self.reader.u32(),
            "can't get call_indirect's table index"
        );
        ensure!(
            self,
            (table as usize) < tables,
            parse,
            "call_indirect's table index {table} invalid, limit is {tables}"
        );
        ensure!(
            self,
            ty < types,
            parse,
            "call_indirect's signature index {ty} exceeds known signatures {types}"
        );
        let (ty, table) = (TypeIndex(ty), TableIndex(table));
        ensure!(
            self,
            header
                .table(table)
                .element
                .heap_type()
                .abstract_type()
                .top()
                == AbstractHeapType::Func,
            parse,
            "call_indirect is only valid when a table has type funcref"
        );
        ensure!(
            self,
            header.types.kind(ty) == TypeKind::Func,
            validation,
            "invalid type index (not a function signature) for call_indirect, got {ty}"
        );
        Ok((self.visible_type_index(ty), table))
    }

    /// The validator checks the kind.
    #[inline(never)]
    pub(super) fn call_ref_type(&mut self) -> Result<TypeIndex, M::Error> {
        let index = read!(
            self,
            self.reader.u32(),
            live: "can't get call_ref's signature index",
            dead: "can't call_ref's signature index"
        );
        ensure!(
            self,
            index < self.cx.header.types.len(),
            validation,
            "call_ref index {index} is out of bounds"
        );
        Ok(self.visible_type_index(TypeIndex(index)))
    }
}

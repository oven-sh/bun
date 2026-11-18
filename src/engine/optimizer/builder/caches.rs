//! Accesses that go through the caches which the lower tiers fill.

use bun_engine_bytecode::{MetadataKind, op};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_text::PropertyName;
use bun_engine_vm::SpeculatedType as T;
use bun_engine_vm::code::metadata::{CasesAndValue, GetByVal};

use super::Builder;
use crate::graph::{Cache, CachedAccess, Kind};

impl Builder<'_> {
    /// The operands are the base, the key or the address of the name, and the value or the receiver.
    pub(super) fn cached<Start>(
        &mut self,
        cache: Cache<Start>,
        start: &Start,
        operands: &[Ssa],
    ) -> Ssa {
        let access = CachedAccess::new(cache, start);
        self.graph.writes_profiles |= access.notes_shapes();
        self.graph.cached_accesses.push(access);
        let roots: smallvec::SmallVec<[Ssa; 3]> =
            operands.iter().map(|&it| self.graph.root(it)).collect();
        let data = self.graph.cached_accesses.len() as u32 - 1;
        self.node(Kind::Cached, &roots, data)
    }

    /// `None` if the instruction has never given a value, in which case the code exits.
    pub(super) fn cached_load<Start>(
        &mut self,
        cache: Cache<Start>,
        start: &Start,
        operands: &[Ssa],
        metadata: u32,
    ) -> Option<Ssa> {
        let prediction = self.prediction_or_exit(metadata)?;
        let value = self.cached(cache, start, operands);
        self.graph.predict(value, prediction);
        self.note_profile(value, metadata);
        Some(value)
    }

    pub(super) fn name(&mut self, name: PropertyName<'_>) -> Ssa {
        self.word(name.address())
    }

    pub(super) fn get_by_id_with_this(&mut self, op: op::GetByIdWithThis) {
        let code_block = self.frame().code_block;
        let kind = MetadataKind::LazyCacheAndValue;
        let entry = (code_block.anchor()).checked_metadata::<CasesAndValue>(kind, op.metadata);
        let name = self.name(code_block.identifier(op.name));
        let operands = [self.get(op.base), name, self.get(op.this)];
        let cache = Cache::GetByIdWithThis;
        if let Some(value) = self.cached_load(cache, &entry.cases, &operands, op.metadata) {
            self.set(op.dst, value);
        }
    }

    pub(super) fn get_by_val_with_this(&mut self, op: op::GetByValWithThis) {
        let code_block = self.frame().code_block;
        let entry =
            (code_block.anchor()).checked_metadata::<GetByVal>(MetadataKind::GetByVal, op.metadata);
        let operands = [self.get(op.base), self.get(op.key), self.get(op.this)];
        let cache = Cache::GetByValWithThis;
        if let Some(value) = self.cached_load(cache, &entry.access, &operands, op.metadata) {
            self.set(op.dst, value);
        }
    }

    pub(super) fn cached_test<Start>(
        &mut self,
        cache: Cache<Start>,
        start: &Start,
        operands: &[Ssa],
    ) -> Ssa {
        let answer = self.cached(cache, start, operands);
        self.graph.predict(answer, T::BOOLEAN);
        self.assume_type(answer, T::BOOLEAN);
        answer
    }
}

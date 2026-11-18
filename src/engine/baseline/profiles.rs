//! What the code has done so far, which decides the cases that get a place in its templates.

#![forbid(unsafe_code)]

use bun_engine_bytecode::{MetadataKind, RawInstruction, Specialization};
use bun_engine_vm::code::metadata::{
    ArrayAccess, Call, Entries, Flags, ForIn, ForInGet, GetById, GetByVal, GetGlobal, GetLength,
    GetPrivateName, GlobalAccess, IteratorNext, NewObject, PutPrivateName,
};
use bun_engine_vm::ic::{AccessCases, AccessKind, InlineKind, InlineLoad, InlineStore, StoreCache};
use bun_engine_vm::{Arithmetic, ArrayModes, CodeBlock, Intrinsic, ValueProfile};

/// What a register is likely to hold.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Likely {
    #[default]
    Unknown,
    Int32,
    Double,
    Boolean,
    Cell,
}

pub(crate) struct Profiles<'a> {
    code_block: &'a CodeBlock,
    entries: Entries<'a>,
}

macro_rules! entry {
    ($self:ident, $word:expr, $type:ty, $($kind:ident)|+) => {
        $self.entries.get::<$type, _>([$(MetadataKind::$kind),+], $word)
    };
}

fn likely(profile: &ValueProfile) -> Likely {
    match profile.last() {
        None => Likely::Unknown,
        Some(value) if value.is_int32() => Likely::Int32,
        Some(value) if value.is_number() => Likely::Double,
        Some(value) if value.is_boolean() => Likely::Boolean,
        Some(value) if value.is_cell() => Likely::Cell,
        Some(_) => Likely::Unknown,
    }
}

impl<'a> Profiles<'a> {
    pub(crate) fn new(code_block: &'a CodeBlock) -> Profiles<'a> {
        Profiles {
            code_block,
            entries: code_block.entries(),
        }
    }

    pub(crate) fn has_run(&self, instruction: &RawInstruction) -> Option<bool> {
        self.entries.has_run(instruction)
    }

    pub(crate) fn arithmetic(&self, word: u32) -> Arithmetic {
        self.entries.arithmetic(word).get()
    }

    /// With `this`.
    pub(crate) fn argument(&self, index: usize) -> Likely {
        (self.code_block.argument_profiles().get(index)).map_or(Likely::Unknown, likely)
    }

    /// Of an instruction that has a value profile.
    pub(crate) fn result(&self, instruction: &RawInstruction) -> Likely {
        (instruction.opcode.metadata())
            .and_then(|kind| self.entries.value_profile(kind, instruction.metadata))
            .map_or(Likely::Unknown, likely)
    }

    pub(crate) fn get_by_id(&self, word: u32) -> Option<InlineLoad> {
        (entry!(self, word, GetById, GetById | GetByIdDirect).cache).likely_kind()
    }

    pub(crate) fn get_length(&self, word: u32) -> (ArrayModes, Option<InlineLoad>) {
        let entry = entry!(self, word, GetLength, GetLength);
        (entry.array.modes(), entry.cache.likely_kind())
    }

    /// Of the first case in the list.
    pub(crate) fn first_load(&self, word: u32) -> Option<AccessKind> {
        let cache = &entry!(self, word, GetById, GetById).cache;
        Some(cache.all_cases().iter().next()?.kind())
    }

    pub(crate) fn is_megamorphic_load(&self, word: u32) -> bool {
        (entry!(self, word, GetById, GetById).cache.all_cases()).is_megamorphic()
    }

    pub(crate) fn is_megamorphic_store(&self, word: u32) -> bool {
        (entry!(self, word, StoreCache, PutById).all_cases()).is_megamorphic()
    }

    pub(crate) fn has_first_answer(&self, word: u32) -> bool {
        let first = entry!(self, word, AccessCases, LazyCache).iter().next();
        first.is_some_and(|case| case.kind().has_answer())
    }

    pub(crate) fn put_by_id(&self, word: u32) -> Option<InlineStore> {
        entry!(self, word, StoreCache, PutById).likely_kind()
    }

    pub(crate) fn get_private_name(&self, word: u32) -> Option<InlineLoad> {
        (entry!(self, word, GetPrivateName, GetPrivateName).cache).likely_kind()
    }

    pub(crate) fn put_private_name(&self, word: u32) -> Option<InlineStore> {
        (entry!(self, word, PutPrivateName, PutPrivateName | PrivateBrand).cache).likely_kind()
    }

    pub(crate) fn get_by_val(&self, word: u32) -> ArrayModes {
        entry!(self, word, GetByVal, GetByVal).array.modes()
    }

    pub(crate) fn keyed_load(&self, word: u32) -> Option<InlineLoad> {
        (entry!(self, word, GetByVal, GetByVal).cases).likely_keyed_kind()
    }

    pub(crate) fn keyed_access<K: InlineKind>(&self, word: u32) -> Option<K> {
        (entry!(self, word, ArrayAccess, ArrayAccess).cases).likely_keyed_kind()
    }

    pub(crate) fn array_access(&self, word: u32) -> ArrayModes {
        entry!(self, word, ArrayAccess, ArrayAccess).array.modes()
    }

    /// The flags of the modes, and what has been iterated over.
    pub(crate) fn iterator_next(&self, word: u32) -> (u32, ArrayModes) {
        let entry = entry!(self, word, IteratorNext, IteratorNext);
        (entry.modes.0.get(), entry.array.modes())
    }

    pub(crate) fn iteration_modes(&self, word: u32) -> u32 {
        entry!(self, word, Flags, IterationModes).0.get()
    }

    pub(crate) fn for_in(&self, word: u32) -> (u32, ArrayModes) {
        let entry = entry!(self, word, ForIn, ForIn);
        (entry.modes.0.get(), entry.array.modes())
    }

    pub(crate) fn for_in_get(&self, word: u32) -> (u32, ArrayModes) {
        let entry = &entry!(self, word, ForInGet, ForInGet).for_in;
        (entry.modes.0.get(), entry.array.modes())
    }

    /// Whether the name is that of a property in the shape of the global object, and whether that has a plain value.
    pub(crate) fn reads_global_property(&self, word: u32) -> (bool, bool) {
        let access = &entry!(self, word, GetGlobal, GetGlobal).access;
        (!access.shape.get().is_none(), access.pointer.get() != 0)
    }

    pub(crate) fn writes_global_property(&self, word: u32) -> bool {
        !entry!(self, word, GlobalAccess, PutGlobal)
            .shape
            .get()
            .is_none()
    }

    /// The only callee, if it is a native function.
    pub(crate) fn native_callee(&self, word: u32) -> Option<Intrinsic> {
        entry!(self, word, Call, Call).profile.native_callee()
    }

    /// With `this`, if all callees have run the same code.
    pub(crate) fn parameters_of_callee(
        &self,
        word: u32,
        specialization: Specialization,
    ) -> Option<u32> {
        let executable = self.entries.call_profile(word).only_executable()?;
        Some(executable.code_block(specialization)?.parameters())
    }

    pub(crate) fn calls_closures(&self, word: u32) -> bool {
        self.entries.call_profile(word).executable().get().is_some()
    }

    pub(crate) fn inline_capacity(&self, word: u32) -> Option<u32> {
        let entry = entry!(self, word, NewObject, NewObject);
        (!entry.allocator.get().is_null()).then(|| entry.inline_capacity.get())
    }
}

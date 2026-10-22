//! What a checker has answered about a type, a signature or a declaration holds in every file that it visits, and neighbors
//! in the program ask about the same ones. So those answers live as long as the checker, with their lists in an arena of
//! their own: a file that asks again reads the answer where it lies.
//!
//! A type has one record for all that is asked about it, found by its number without hashing.
//!
//! Only an answer is kept. That the checker gave up holds for the file that heard it (`Memo::gave_up`).

use super::answers::{
    CheckedMember, ClassRef, FunctionRef, GaveUp, IndexSignature, ListedMember, ObjectMember, PositionTypes,
    SignatureShape, WrittenType,
};
use super::queries::AliasScan;
use super::type_identity::TypeIdentity;
use super::type_shape::{BuiltinShape, PrimitiveKinds, TypeShape};
use crate::check::links::ByType;
use crate::hir::TypeNodeId;
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::types::{SigId, TypeId};
use crate::util::FxHashMap;

#[derive(Default)]
pub(crate) struct KeptAnswers {
    // In front of the arena, which its references point into: fields are dropped in this order.
    memo: KeptMemo<'static>,
    arena: Option<Box<Arena>>,
}

impl KeptAnswers {
    pub(super) fn take<'c>(&mut self) -> (KeptMemo<'c>, Box<Arena>) {
        let arena = self.arena.take().unwrap_or_default();
        (std::mem::take(&mut self.memo), arena)
    }

    /// `memo`: its references point into `arena`.
    pub(super) fn put_back(&mut self, memo: KeptMemo<'static>, arena: Box<Arena>) {
        self.memo = memo;
        self.arena = Some(arena);
    }

    /// Forgets every answer and keeps the memory of the tables.
    pub(crate) fn clear(&mut self) {
        self.memo.clear();
        self.arena = None;
    }
}

impl KeptMemo<'_> {
    /// # Safety
    /// Every reference in it points into the arena that it is put back with.
    pub(super) unsafe fn outliving_its_borrow(self) -> KeptMemo<'static> {
        // SAFETY: that arena is freed behind the memo, and `KeptAnswers::take` hands both out together.
        unsafe { std::mem::transmute::<KeptMemo<'_>, KeptMemo<'static>>(self) }
    }
}

/// What is asked about any type.
#[derive(Default)]
pub(super) struct TypeAnswers<'c> {
    pub(super) shape: Option<TypeShape<'c>>,
    pub(super) identity: Option<TypeIdentity>,
    pub(super) awaited: Option<TypeId>,
    pub(super) reads_untrusted_declaration: Option<bool>,
    /// Two bits a `KeptFact`: whether it is known, and what it is.
    pub(super) facts: u8,
    /// 1 + the index of its `ObjectAnswers`, or 0.
    object: u32,
}

/// What is asked about a type that has members.
#[derive(Default)]
pub(super) struct ObjectAnswers<'c> {
    pub(super) primitives: Option<PrimitiveKinds>,
    pub(super) builtin_base: Option<Option<TypeShape<'c>>>,
    pub(super) accepted_builtins: Option<&'c [BuiltinShape]>,
    pub(super) accepted_class_constructors: Option<&'c [ClassRef]>,
    pub(super) members: Option<&'c [ObjectMember]>,
    pub(super) checked_members: Option<&'c [CheckedMember]>,
    pub(super) listed_members: Option<&'c [ListedMember]>,
    pub(super) index_signatures: Option<&'c [IndexSignature]>,
    /// Its part of `KeptMemo::member_types`, by `ListedMember::property_index`. Empty until the first is asked for.
    first_member_type: u32,
    member_type_count: u32,
}

#[derive(Default)]
pub(super) struct KeptMemo<'c> {
    /// 1 + the index in `types`, or 0.
    rows: ByType,
    types: Vec<TypeAnswers<'c>>,
    objects: Vec<ObjectAnswers<'c>>,
    member_types: Vec<Option<PositionTypes>>,
    /// As every file but that of the declaration hears them.
    pub(super) signatures: FxHashMap<SigId, SignatureShape<'c>>,
    pub(super) function_signatures: FxHashMap<FunctionRef, SignatureShape<'c>>,
    pub(super) signature_results: FxHashMap<SigId, TypeId>,
    pub(super) variables: FxHashMap<Sym, WrittenType>,
    pub(super) written_forms: FxHashMap<(FileId, TypeNodeId), TypeId>,
    pub(super) alias_scans: FxHashMap<Sym, AliasScan>,
    pub(super) alias_reads: FxHashMap<Sym, bool>,
    pub(super) recursive_conditionals: FxHashMap<(FileId, TypeNodeId), bool>,
}

/// Where the answers about a type lie. It stays valid while others are added.
#[derive(Copy, Clone)]
pub(super) struct TypeRow(u32);

#[derive(Copy, Clone)]
pub(super) struct ObjectRow(u32);

impl<'c> KeptMemo<'c> {
    fn clear(&mut self) {
        let KeptMemo {
            rows,
            types,
            objects,
            member_types,
            signatures,
            function_signatures,
            signature_results,
            variables,
            written_forms,
            alias_scans,
            alias_reads,
            recursive_conditionals,
        } = self;
        rows.clear();
        types.clear();
        objects.clear();
        member_types.clear();
        signatures.clear();
        function_signatures.clear();
        signature_results.clear();
        variables.clear();
        written_forms.clear();
        alias_scans.clear();
        alias_reads.clear();
        recursive_conditionals.clear();
    }

    #[inline]
    pub(super) fn find_type(&self, ty: TypeId) -> Option<&TypeAnswers<'c>> {
        match self.rows.get(ty) {
            0 => None,
            row => Some(&self.types[row as usize - 1]),
        }
    }

    #[inline]
    pub(super) fn type_row(&mut self, ty: TypeId) -> TypeRow {
        match self.rows.get(ty) {
            0 => self.add_type(ty),
            row => TypeRow(row - 1),
        }
    }

    #[cold]
    #[inline(never)]
    fn add_type(&mut self, ty: TypeId) -> TypeRow {
        self.types.push(TypeAnswers::default());
        let count = self.types.len() as u32;
        self.rows.set(ty, count);
        TypeRow(count - 1)
    }

    #[inline]
    pub(super) fn object_row(&mut self, ty: TypeId) -> ObjectRow {
        let TypeRow(row) = self.type_row(ty);
        match self.types[row as usize].object {
            0 => {
                self.objects.push(ObjectAnswers::default());
                let count = self.objects.len() as u32;
                self.types[row as usize].object = count;
                ObjectRow(count - 1)
            }
            object => ObjectRow(object - 1),
        }
    }

    #[inline]
    pub(super) fn type_at(&mut self, row: TypeRow) -> &mut TypeAnswers<'c> {
        &mut self.types[row.0 as usize]
    }

    #[inline]
    pub(super) fn object_at(&mut self, row: ObjectRow) -> &mut ObjectAnswers<'c> {
        &mut self.objects[row.0 as usize]
    }

    #[inline]
    pub(super) fn find_member_types(&self, row: ObjectRow, index: u32) -> Option<PositionTypes> {
        let object = &self.objects[row.0 as usize];
        match index < object.member_type_count {
            true => self.member_types[(object.first_member_type + index) as usize],
            false => None,
        }
    }

    pub(super) fn has_room_for_member_types(&self, row: ObjectRow) -> bool {
        self.objects[row.0 as usize].member_type_count != 0
    }

    pub(super) fn make_room_for_member_types(&mut self, row: ObjectRow, count: u32) {
        let object = &mut self.objects[row.0 as usize];
        object.first_member_type = self.member_types.len() as u32;
        object.member_type_count = count;
        self.member_types.resize(self.member_types.len() + count as usize, None);
    }

    pub(super) fn keep_member_types(&mut self, row: ObjectRow, index: u32, types: PositionTypes) {
        let object = &self.objects[row.0 as usize];
        if index < object.member_type_count {
            self.member_types[(object.first_member_type + index) as usize] = Some(types);
        }
    }
}

/// What whoever asks the questions works out from the answers about a type alone, and keeps with them.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum KeptFact {
    IsMappedAlikeInEveryFile,
    ListsInt32,
    HasLayoutInEveryValue,
}

/// The questions about a type for which `Memo::gave_up` holds that the checker gave up.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub(super) enum TypeQuestion {
    Shape,
    Awaited,
    Primitives,
    BuiltinBase,
    AcceptedBuiltins,
    AcceptedClassConstructors,
    ListedMembers,
    IndexSignatures,
    Identity,
}

pub(super) type GaveUpAnswers = FxHashMap<(TypeId, TypeQuestion), GaveUp>;

use super::answers::{
    ClassRef, FunctionRef, GaveUp, IndexSignature, ListedMember, ObjectMember, PositionTypes,
    SignatureShape, WrittenType,
};
use super::class_stores::StoreIndex;
use super::queries::AliasScan;
use super::type_identity::TypeIdentity;
use super::type_shape::{BuiltinShape, PrimitiveKinds, ShapeKind, TypeShape};
use crate::atom::Atom;
use crate::check::links::ByType;
use crate::hir::TypeNodeId;
use crate::program::{FileId, Sym};
use crate::session::Arena;
use crate::types::{SigId, TypeId};
use crate::util::FxHashMap;

#[derive(Default)]
pub(crate) struct KeptAnswers {
    memo: KeptMemo<'static>,
    arena: Option<Box<Arena>>,
    pub(super) of_lowering: Option<Box<dyn core::any::Any + Send>>,
    pub(super) of_lowering_in_last_task: Option<Box<dyn core::any::Any + Send>>,
    pub(super) hand_on_of_lowering: Option<HandOn>,
    pub(crate) outlives_task: bool,
}

pub(super) type HandOn = fn(
    Box<dyn core::any::Any + Send>,
    Option<&RowsCarriedOver<'_>>,
) -> Option<Box<dyn core::any::Any + Send>>;

pub struct RowsCarriedOver<'a> {
    new_rows: &'a [u32],
}

impl RowsCarriedOver<'_> {
    #[inline]
    pub fn new_row(&self, old_row: u32) -> Option<u32> {
        self.new_rows.get(old_row as usize)?.checked_sub(1)
    }
}

impl KeptAnswers {
    pub(super) fn take<'c>(&mut self) -> (KeptMemo<'c>, Box<Arena>) {
        let arena = self.arena.take().unwrap_or_default();
        let mut memo = std::mem::take(&mut self.memo);
        memo.visit += 1;
        memo.last_row = None;
        (memo, arena)
    }

    pub(super) fn put_back(&mut self, memo: KeptMemo<'static>, arena: Box<Arena>) {
        self.memo = memo;
        self.arena = Some(arena);
    }

    pub(crate) fn clear(&mut self) {
        self.memo.clear();
        self.arena = None;
        let state = self.of_lowering.take();
        if let Some(state) = state.or_else(|| self.of_lowering_in_last_task.take()) {
            let hand_on = self.hand_on_of_lowering;
            self.of_lowering_in_last_task = hand_on.and_then(|hand_on| hand_on(state, None));
        }
    }

    pub(crate) fn end_task(&mut self) {
        match std::mem::take(&mut self.outlives_task) {
            true => self.carry_over(),
            false => self.clear(),
        }
    }

    fn carry_over(&mut self) {
        let Some(state) = self.of_lowering.take() else {
            return;
        };
        let old_arena = self.arena.take();
        let mut old = std::mem::take(&mut self.memo);
        let arena: Box<Arena> = Box::default();
        let (memo, new_rows) = old.copy_shared_rows(&arena);
        // SAFETY: `arena` is the only source of its references, and `put_back` lays both down together.
        let memo = unsafe { memo.outliving_its_borrow() };
        let carried = RowsCarriedOver {
            new_rows: &new_rows,
        };
        let hand_on = self.hand_on_of_lowering;
        self.of_lowering_in_last_task = hand_on.and_then(|hand_on| hand_on(state, Some(&carried)));
        drop(old);
        drop(old_arena);
        self.put_back(memo, arena);
    }
}

fn copy_list<'n, T: Copy>(list: &[T], arena: &'n Arena) -> &'n [T] {
    match list.is_empty() {
        true => &[],
        false => arena.alloc_slice_copy(list),
    }
}

fn copy_shape<'n>(shape: TypeShape<'_>, arena: &'n Arena) -> TypeShape<'n> {
    let kind = match shape.kind {
        ShapeKind::TemplateLiteral { texts, types } => ShapeKind::TemplateLiteral {
            texts: copy_list(texts, arena),
            types: copy_list(types, arena),
        },
        ShapeKind::Function(signatures) => ShapeKind::Function(copy_list(signatures, arena)),
        ShapeKind::Tuple {
            elements,
            is_readonly,
        } => ShapeKind::Tuple {
            elements: copy_list(elements, arena),
            is_readonly,
        },
        ShapeKind::Builtin { class, arguments } => ShapeKind::Builtin {
            class,
            arguments: copy_list(arguments, arena),
        },
        ShapeKind::Union(members) => ShapeKind::Union(copy_list(members, arena)),
        ShapeKind::Anything(reason) => ShapeKind::Anything(reason),
        ShapeKind::TypeVariable { constraint } => ShapeKind::TypeVariable { constraint },
        ShapeKind::Never => ShapeKind::Never,
        ShapeKind::Undefined => ShapeKind::Undefined,
        ShapeKind::Null => ShapeKind::Null,
        ShapeKind::Boolean => ShapeKind::Boolean,
        ShapeKind::BooleanLiteral(value) => ShapeKind::BooleanLiteral(value),
        ShapeKind::Number => ShapeKind::Number,
        ShapeKind::NumberLiteral(value) => ShapeKind::NumberLiteral(value),
        ShapeKind::NumericEnumMember(value) => ShapeKind::NumericEnumMember(value),
        ShapeKind::BigInt => ShapeKind::BigInt,
        ShapeKind::BigIntLiteral {
            digits,
            is_negative,
        } => ShapeKind::BigIntLiteral {
            digits,
            is_negative,
        },
        ShapeKind::String => ShapeKind::String,
        ShapeKind::StringLiteral(text) => ShapeKind::StringLiteral(text),
        ShapeKind::Symbol => ShapeKind::Symbol,
        ShapeKind::AnyObject => ShapeKind::AnyObject,
        ShapeKind::ClassConstructor(class) => ShapeKind::ClassConstructor(class),
        ShapeKind::Array {
            element,
            is_readonly,
        } => ShapeKind::Array {
            element,
            is_readonly,
        },
        ShapeKind::Class(class) => ShapeKind::Class(class),
        ShapeKind::Object => ShapeKind::Object,
        ShapeKind::Int32 { base } => ShapeKind::Int32 { base },
    };
    TypeShape {
        kind,
        trust: shape.trust,
    }
}

const ROWS_IN_BLOCK: usize = 1 << 10;

pub struct Blocks<T> {
    blocks: Vec<Box<[T; ROWS_IN_BLOCK]>>,
    len: usize,
}

impl<T> Default for Blocks<T> {
    fn default() -> Blocks<T> {
        Blocks {
            blocks: Vec::new(),
            len: 0,
        }
    }
}

impl<T: Copy + Default> Blocks<T> {
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn get(&self, index: usize) -> Option<&T> {
        match index < self.len {
            true => Some(&self[index]),
            false => None,
        }
    }

    #[inline]
    pub fn get_mut(&mut self, index: usize) -> Option<&mut T> {
        match index < self.len {
            true => Some(&mut self[index]),
            false => None,
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.blocks
            .iter()
            .flat_map(|block| block.iter())
            .take(self.len)
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut T> {
        self.blocks
            .iter_mut()
            .flat_map(|block| block.iter_mut())
            .take(self.len)
    }

    #[inline]
    pub fn push(&mut self, value: T) {
        let index = self.len;
        self.grow_to(index + 1);
        self[index] = value;
    }

    #[inline]
    pub fn grow_to(&mut self, len: usize) {
        debug_assert!(self.len <= len);
        self.len = len;
        if self.blocks.len() * ROWS_IN_BLOCK < len {
            self.add_blocks();
        }
    }

    #[cold]
    #[inline(never)]
    fn add_blocks(&mut self) {
        while self.blocks.len() * ROWS_IN_BLOCK < self.len {
            let block = vec![T::default(); ROWS_IN_BLOCK].into_boxed_slice();
            let block: Result<Box<[T; ROWS_IN_BLOCK]>, _> = block.try_into();
            let Ok(block) = block else {
                unreachable!("the list was made as long as a block");
            };
            self.blocks.push(block);
        }
    }

    pub fn truncate(&mut self, len: usize) {
        debug_assert!(len <= self.len);
        self.blocks.truncate(self.len.div_ceil(ROWS_IN_BLOCK));
        for index in len..self.len {
            self[index] = T::default();
        }
        self.len = len;
    }

    fn replace_rows_with(&mut self, rows: &[T]) {
        self.truncate(0);
        for &row in rows {
            self.push(row);
        }
    }
}

impl<T> core::ops::Index<usize> for Blocks<T> {
    type Output = T;

    #[inline]
    fn index(&self, index: usize) -> &T {
        debug_assert!(index < self.len);
        &self.blocks[index / ROWS_IN_BLOCK][index % ROWS_IN_BLOCK]
    }
}

impl<T> core::ops::IndexMut<usize> for Blocks<T> {
    #[inline]
    fn index_mut(&mut self, index: usize) -> &mut T {
        debug_assert!(index < self.len);
        &mut self.blocks[index / ROWS_IN_BLOCK][index % ROWS_IN_BLOCK]
    }
}

impl KeptMemo<'_> {
    pub(super) unsafe fn outliving_its_borrow(self) -> KeptMemo<'static> {
        // SAFETY: that arena is freed behind the memo, and `KeptAnswers::take` hands both out together.
        unsafe { std::mem::transmute::<KeptMemo<'_>, KeptMemo<'static>>(self) }
    }
}

#[derive(Copy, Clone)]
pub(super) struct TypeAnswers<'c> {
    pub(super) shape: Option<TypeShape<'c>>,
    pub(super) identity: Option<TypeIdentity>,
    pub(super) awaited: Option<TypeId>,
    pub(super) reads_untrusted_declaration: Option<bool>,
    pub(super) facts: u8,
    object: u32,
    ty: TypeId,
    made_in: u32,
}

impl Default for TypeAnswers<'_> {
    fn default() -> Self {
        TypeAnswers {
            shape: None,
            identity: None,
            awaited: None,
            reads_untrusted_declaration: None,
            facts: 0,
            object: 0,
            ty: TypeId::ANY,
            made_in: 0,
        }
    }
}

#[derive(Copy, Clone, Default)]
pub(super) struct ObjectAnswers<'c> {
    pub(super) primitives: Option<PrimitiveKinds>,
    pub(super) builtin_base: Option<Option<TypeShape<'c>>>,
    pub(super) accepted_builtins: Option<&'c [BuiltinShape]>,
    pub(super) accepted_class_constructors: Option<&'c [ClassRef]>,
    pub(super) members: Option<&'c [ObjectMember]>,
    pub(super) listed_members: Option<&'c [ListedMember]>,
    pub(super) index_signatures: Option<&'c [IndexSignature]>,
    first_member_type: u32,
    member_type_count: u32,
}

#[derive(Default)]
pub(super) struct KeptMemo<'c> {
    rows: ByType,
    types: Blocks<TypeAnswers<'c>>,
    seen_in: Vec<u32>,
    objects: Blocks<ObjectAnswers<'c>>,
    member_types: Blocks<Option<(Atom, PositionTypes)>>,
    pub(super) signatures: FxHashMap<SigId, SignatureShape<'c>>,
    pub(super) function_signatures: FxHashMap<FunctionRef, SignatureShape<'c>>,
    pub(super) signature_results: FxHashMap<SigId, TypeId>,
    pub(super) variables: FxHashMap<Sym, WrittenType>,
    pub(super) written_forms: FxHashMap<(FileId, TypeNodeId), TypeId>,
    pub(super) alias_scans: FxHashMap<Sym, AliasScan>,
    pub(super) alias_reads: FxHashMap<Sym, bool>,
    pub(super) store_indexes: FxHashMap<FileId, StoreIndex<'c>>,
    visit: u32,
    last_row: Option<(TypeId, TypeRow)>,
}

#[derive(Copy, Clone)]
pub(super) struct TypeRow(u32);

impl TypeRow {
    #[inline]
    pub(super) fn number(self) -> u32 {
        self.0
    }
}

#[derive(Copy, Clone)]
pub(super) struct ObjectRow(u32);

impl<'c> KeptMemo<'c> {
    fn clear(&mut self) {
        let KeptMemo {
            rows,
            types,
            seen_in,
            objects,
            member_types,
            signatures,
            function_signatures,
            signature_results,
            variables,
            written_forms,
            alias_scans,
            alias_reads,
            store_indexes,
            visit,
            last_row,
        } = self;
        *visit = 0;
        *last_row = None;
        rows.clear();
        types.truncate(0);
        seen_in.clear();
        objects.truncate(0);
        member_types.truncate(0);
        signatures.clear();
        function_signatures.clear();
        signature_results.clear();
        variables.clear();
        written_forms.clear();
        alias_scans.clear();
        alias_reads.clear();
        store_indexes.clear();
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
        if let Some((last, row)) = self.last_row
            && last == ty
        {
            return row;
        }
        let row = match self.rows.get(ty) {
            0 => self.add_type(ty),
            row => {
                self.seen_in[row as usize - 1] = self.visit;
                TypeRow(row - 1)
            }
        };
        self.last_row = Some((ty, row));
        row
    }

    #[cold]
    #[inline(never)]
    fn add_type(&mut self, ty: TypeId) -> TypeRow {
        self.types.push(TypeAnswers {
            ty,
            made_in: self.visit,
            ..TypeAnswers::default()
        });
        self.seen_in.push(self.visit);
        let count = self.types.len() as u32;
        self.rows.set(ty, count);
        TypeRow(count - 1)
    }

    fn copy_shared_rows<'n>(&mut self, arena: &'n Arena) -> (KeptMemo<'n>, Vec<u32>)
    where
        'c: 'n,
    {
        let mut next = KeptMemo {
            rows: std::mem::take(&mut self.rows),
            signature_results: std::mem::take(&mut self.signature_results),
            variables: std::mem::take(&mut self.variables),
            written_forms: std::mem::take(&mut self.written_forms),
            alias_scans: std::mem::take(&mut self.alias_scans),
            alias_reads: std::mem::take(&mut self.alias_reads),
            visit: self.visit,
            ..KeptMemo::default()
        };
        next.rows.clear();
        next.signature_results.clear();
        next.variables.clear();
        next.written_forms.clear();
        next.alias_scans.clear();
        next.alias_reads.clear();
        let mut types: Blocks<TypeAnswers<'n>> = std::mem::take(&mut self.types);
        let mut seen_in = std::mem::take(&mut self.seen_in);
        let (mut object_count, mut member_type_count) = (0, 0);
        for (row, &last_visit) in seen_in.iter().enumerate() {
            let answers = &types[row];
            if last_visit != answers.made_in && answers.object != 0 {
                let object = &self.objects[answers.object as usize - 1];
                object_count += 1;
                member_type_count += object.member_type_count as usize;
            }
        }
        let mut objects: Vec<ObjectAnswers<'n>> = Vec::with_capacity(object_count);
        let mut member_types = Vec::with_capacity(member_type_count);
        let mut new_rows = vec![0u32; types.len()];
        let mut carried_count = 0;
        for (row, new_row) in new_rows.iter_mut().enumerate() {
            let answers = types[row];
            if seen_in[row] == answers.made_in {
                continue;
            }
            let object = match answers.object {
                0 => 0,
                object => {
                    let object = &self.objects[object as usize - 1];
                    let first = object.first_member_type as usize;
                    let first_member_type = member_types.len() as u32;
                    for index in first..first + object.member_type_count as usize {
                        member_types.push(self.member_types[index]);
                    }
                    objects.push(ObjectAnswers {
                        primitives: object.primitives,
                        builtin_base: (object.builtin_base)
                            .map(|base| base.map(|shape| copy_shape(shape, arena))),
                        accepted_builtins: object.accepted_builtins.map(|it| copy_list(it, arena)),
                        accepted_class_constructors: (object.accepted_class_constructors)
                            .map(|it| copy_list(it, arena)),
                        members: object.members.map(|it| copy_list(it, arena)),
                        listed_members: object.listed_members.map(|it| copy_list(it, arena)),
                        index_signatures: object.index_signatures.map(|it| copy_list(it, arena)),
                        first_member_type,
                        member_type_count: object.member_type_count,
                    });
                    objects.len() as u32
                }
            };
            types[carried_count] = TypeAnswers {
                shape: answers.shape.map(|shape| copy_shape(shape, arena)),
                object,
                ..answers
            };
            seen_in[carried_count] = seen_in[row];
            carried_count += 1;
            *new_row = carried_count as u32;
            next.rows.set(answers.ty, *new_row);
        }
        types.truncate(carried_count);
        seen_in.truncate(carried_count);
        (next.types, next.seen_in) = (types, seen_in);
        next.objects = std::mem::take(&mut self.objects);
        next.objects.replace_rows_with(&objects);
        next.member_types = std::mem::take(&mut self.member_types);
        next.member_types.replace_rows_with(&member_types);
        (next, new_rows)
    }

    #[inline]
    pub(super) fn object_row(&mut self, ty: TypeId) -> ObjectRow {
        let TypeRow(row) = self.type_row(ty);
        match self.types[row as usize].object {
            0 => self.add_object(row),
            object => ObjectRow(object - 1),
        }
    }

    #[cold]
    #[inline(never)]
    fn add_object(&mut self, row: u32) -> ObjectRow {
        self.objects.push(ObjectAnswers::default());
        let count = self.objects.len() as u32;
        self.types[row as usize].object = count;
        ObjectRow(count - 1)
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
    pub(super) fn find_member_types(
        &self,
        row: ObjectRow,
        member: ListedMember,
    ) -> Option<PositionTypes> {
        let object = &self.objects[row.0 as usize];
        if member.property_index >= object.member_type_count {
            return None;
        }
        let kept = self.member_types[(object.first_member_type + member.property_index) as usize];
        kept.and_then(|(name, types)| (name == member.name.atom()).then_some(types))
    }

    #[inline]
    pub(super) fn has_room_for_member_types(&self, row: ObjectRow) -> bool {
        self.objects[row.0 as usize].member_type_count != 0
    }

    pub(super) fn make_room_for_member_types(&mut self, row: ObjectRow, count: u32) {
        let object = &mut self.objects[row.0 as usize];
        object.first_member_type = self.member_types.len() as u32;
        object.member_type_count = count;
        self.member_types
            .grow_to(self.member_types.len() + count as usize);
    }

    #[inline]
    pub(super) fn keep_member_types(
        &mut self,
        row: ObjectRow,
        member: ListedMember,
        types: PositionTypes,
    ) {
        let object = &self.objects[row.0 as usize];
        if member.property_index < object.member_type_count {
            self.member_types[(object.first_member_type + member.property_index) as usize] =
                Some((member.name.atom(), types));
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum KeptFact {
    ListsInt32,
    HasLayoutInEveryValue,
}

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

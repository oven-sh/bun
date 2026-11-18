//! The types that a module defines.

use std::sync::Arc;

use hashbrown::HashTable;

use super::canonical::{
    Candidate, CanonicalType, CanonicalValType, NO_SUPERTYPE, RecGroup, Rtt, Shape,
};
use super::layout::StructLayout;
use super::value::{BlockType, FieldType, HeapType, StorageType, TypeKind, ValType};
use crate::alloc::{OutOfMemory, TryPush, shrink};
use crate::index::TypeIndex;
use crate::limits::MAX_SUBTYPE_DEPTH;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FuncType<'a> {
    pub params: &'a [ValType],
    pub results: &'a [ValType],
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Field {
    pub ty: FieldType,
    /// From the start of the payload, a multiple of the size of the field.
    pub offset: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct StructType<'a> {
    pub fields: &'a [Field],
    /// Of the payload, a multiple of 8.
    pub size: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ArrayType {
    pub element: FieldType,
}

/// Up to this many steps from a type to its supertype take less than looking at the display.
const SHORT_WALK: u32 = 2;

#[derive(Clone, Copy)]
struct Definition {
    /// With the first index that has this type.
    heap_type: HeapType,
    /// In `values` for a function, otherwise in `fields`.
    start: u32,
    /// Parameters or fields. An array has one field.
    count: u16,
    results: u16,
    supertype: u32,
    size: u32,
    group: u32,
    member: u32,
    kind: TypeKind,
    depth: u8,
    is_final: bool,
    /// For a function, whether `v128` is in the signature. For a struct, whether all fields have a default.
    trait_of_kind: bool,
}

#[derive(Default)]
pub struct Types {
    definitions: Vec<Definition>,
    values: Vec<ValType>,
    fields: Vec<Field>,
    groups: Vec<Arc<RecGroup>>,
}

impl Types {
    #[inline]
    pub fn len(&self) -> u32 {
        self.definitions.len() as u32
    }

    #[inline]
    fn definition(&self, index: TypeIndex) -> &Definition {
        &self.definitions[index.usize()]
    }

    #[inline]
    pub fn kind(&self, index: TypeIndex) -> TypeKind {
        self.definition(index).kind
    }

    #[inline]
    pub fn heap_type(&self, index: TypeIndex) -> HeapType {
        self.definition(index).heap_type
    }

    #[inline]
    pub(crate) fn get_heap_type(&self, index: u32) -> Option<HeapType> {
        Some(self.definitions.get(index as usize)?.heap_type)
    }

    /// The first index that has the same type. Value types and the driver give only these.
    #[inline]
    pub fn first_index(&self, index: TypeIndex) -> TypeIndex {
        self.heap_type(index).index().expect("a defined type")
    }

    #[inline]
    pub fn is_final(&self, index: TypeIndex) -> bool {
        self.definition(index).is_final
    }

    #[inline]
    pub fn supertype(&self, index: TypeIndex) -> Option<TypeIndex> {
        let supertype = self.definition(index).supertype;
        (supertype != NO_SUPERTYPE).then_some(TypeIndex(supertype))
    }

    /// The number of supertypes.
    #[inline]
    pub fn depth(&self, index: TypeIndex) -> u32 {
        self.definition(index).depth.into()
    }

    #[inline]
    pub fn func_type(&self, index: TypeIndex) -> FuncType<'_> {
        let definition = self.definition(index);
        assert!(definition.kind == TypeKind::Func);
        let start = definition.start as usize;
        let count = usize::from(definition.count);
        let values = &self.values[start..start + count + usize::from(definition.results)];
        let (params, results) = values.split_at(count);
        FuncType { params, results }
    }

    #[inline]
    pub fn struct_type(&self, index: TypeIndex) -> StructType<'_> {
        let definition = self.definition(index);
        assert!(definition.kind == TypeKind::Struct);
        StructType {
            fields: self.fields_of(definition),
            size: definition.size,
        }
    }

    #[inline]
    pub fn array_type(&self, index: TypeIndex) -> ArrayType {
        let definition = self.definition(index);
        assert!(definition.kind == TypeKind::Array);
        ArrayType {
            element: self.fields[definition.start as usize].ty,
        }
    }

    #[inline]
    pub fn block_type<'a>(&'a self, ty: &'a BlockType) -> FuncType<'a> {
        match ty {
            BlockType::Empty => FuncType {
                params: &[],
                results: &[],
            },
            BlockType::Value(result) => FuncType {
                params: &[],
                results: core::slice::from_ref(result),
            },
            BlockType::Func(index) => self.func_type(*index),
        }
    }

    #[inline]
    pub fn is_subtype(&self, sub: ValType, sup: ValType) -> bool {
        sub == sup || self.is_subtype_of_different(sub, sup)
    }

    #[inline(never)]
    fn is_subtype_of_different(&self, sub: ValType, sup: ValType) -> bool {
        sub.is_subtype_of(sup, |sub, sup| self.is_defined_subtype(sub, sup))
    }

    pub fn is_heap_subtype(&self, sub: HeapType, sup: HeapType) -> bool {
        sub.is_subtype_of(sup, |sub, sup| self.is_defined_subtype(sub, sup))
    }

    pub(crate) fn is_storage_subtype(&self, sub: StorageType, sup: StorageType) -> bool {
        self.is_subtype(sub.as_value_bits(), sup.as_value_bits())
    }

    fn is_defined_subtype(&self, mut sub: TypeIndex, sup: TypeIndex) -> bool {
        if sub == sup {
            return true;
        }
        let has_rtt = |index| (self.definition(index).group as usize) < self.groups.len();
        if self.depth(sub) > self.depth(sup) + SHORT_WALK && has_rtt(sub) && has_rtt(sup) {
            return self.rtt(sub).is_subtype_of(self.rtt(sup));
        }
        for _ in self.depth(sup)..self.depth(sub) {
            sub = TypeIndex(self.definition(sub).supertype);
        }
        sub == sup
    }

    #[inline]
    pub fn rtt(&self, index: TypeIndex) -> &Rtt {
        let definition = self.definition(index);
        self.groups[definition.group as usize].rtt(definition.member)
    }

    pub fn canonical(&self, index: TypeIndex) -> CanonicalType {
        let definition = self.definition(index);
        let group = Arc::clone(&self.groups[definition.group as usize]);
        CanonicalType::new(group, definition.member)
    }

    pub fn canonical_value(&self, ty: ValType) -> CanonicalValType {
        CanonicalValType::new(ty, ty.defined_index().map(|index| self.canonical(index)))
    }

    #[inline]
    pub(crate) fn signature_has_v128(&self, func: TypeIndex) -> bool {
        self.definition(func).trait_of_kind
    }

    #[inline]
    pub(crate) fn fields_are_defaultable(&self, structure: TypeIndex) -> bool {
        self.definition(structure).trait_of_kind
    }

    #[inline]
    fn fields_of(&self, definition: &Definition) -> &[Field] {
        &self.fields[definition.start as usize..][..usize::from(definition.count)]
    }

    fn values_of(&self, definition: &Definition) -> &[ValType] {
        let count = usize::from(definition.count) + usize::from(definition.results);
        &self.values[definition.start as usize..][..count]
    }

    fn matches_supertype(&self, sub: &Definition, sup: &Definition) -> bool {
        if sub.kind != sup.kind {
            return false;
        }
        if sub.kind == TypeKind::Func {
            let params = usize::from(sub.count);
            let pairs = || self.values_of(sub).iter().zip(self.values_of(sup));
            return (sub.count, sub.results) == (sup.count, sup.results)
                && pairs().take(params).all(|(a, b)| self.is_subtype(*b, *a))
                && pairs().skip(params).all(|(a, b)| self.is_subtype(*a, *b));
        }
        let mut pairs = self.fields_of(sub).iter().zip(self.fields_of(sup));
        sub.count >= sup.count
            && pairs.all(|(a, b)| {
                a.ty == b.ty
                    || (!a.ty.mutable
                        && !b.ty.mutable
                        && self.is_storage_subtype(a.ty.storage, b.ty.storage))
            })
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Subtyping {
    pub(crate) supertype: Option<TypeIndex>,
    pub(crate) is_final: bool,
}

pub(crate) enum GroupError {
    TooDeep { member: u32 },
    FinalSupertype,
    SupertypeMismatch,
    OutOfMemory,
}

impl From<OutOfMemory> for GroupError {
    fn from(_: OutOfMemory) -> Self {
        Self::OutOfMemory
    }
}

/// Takes one recursion group after the other.
#[derive(Default)]
pub(crate) struct TypesBuilder {
    types: Types,
    /// Where the open group starts in the vectors of `types`.
    group_start: u32,
    values_start: usize,
    fields_start: usize,
    /// Where the open type starts in `values` or `fields`.
    pending_values: usize,
    pending_fields: usize,
    /// The hash and the first type of each group.
    seen: HashTable<(u64, u32)>,
    candidate: Candidate,
    /// By type index, while a candidate is made: one more than its place among the outside types.
    outside_numbers: Vec<u32>,
    outside: Vec<TypeIndex>,
}

impl TypesBuilder {
    #[inline]
    pub(crate) fn len(&self) -> u32 {
        self.types.len()
    }

    /// The kind of a type of the open group is filled in when the group ends.
    pub(crate) fn heap_type(&self, index: u32) -> HeapType {
        if index < self.group_start {
            self.types.heap_type(TypeIndex(index))
        } else {
            HeapType::defined(TypeIndex(index), TypeKind::Func)
        }
    }

    pub(crate) fn push_value(&mut self, ty: ValType) -> Result<(), OutOfMemory> {
        self.types.values.try_push(ty)
    }

    pub(crate) fn push_field(&mut self, ty: FieldType) -> Result<(), OutOfMemory> {
        self.types.fields.try_push(Field { ty, offset: 0 })
    }

    /// Of the values pushed since the last definition, the first `params` are parameters.
    pub(crate) fn define_func(&mut self, params: u32, sub: Subtyping) -> Result<(), OutOfMemory> {
        let values = &self.types.values[self.pending_values..];
        let has_v128 = values.contains(&ValType::V128);
        let results = (values.len() - params as usize) as u16;
        let start = core::mem::replace(&mut self.pending_values, self.types.values.len());
        let definition = self.define(TypeKind::Func, start, params as usize, sub)?;
        definition.results = results;
        definition.trait_of_kind = has_v128;
        Ok(())
    }

    pub(crate) fn define_struct(&mut self, sub: Subtyping) -> Result<(), OutOfMemory> {
        let fields = &mut self.types.fields[self.pending_fields..];
        let mut layout = StructLayout::default();
        let mut defaultable = true;
        for field in &mut *fields {
            field.offset = layout.place(field.ty.storage.log2_size());
            defaultable &= field.ty.storage.unpacked().is_defaultable();
        }
        let count = fields.len();
        let start = core::mem::replace(&mut self.pending_fields, self.types.fields.len());
        let definition = self.define(TypeKind::Struct, start, count, sub)?;
        definition.size = layout.size();
        definition.trait_of_kind = defaultable;
        Ok(())
    }

    pub(crate) fn define_array(&mut self, sub: Subtyping) -> Result<(), OutOfMemory> {
        let start = core::mem::replace(&mut self.pending_fields, self.types.fields.len());
        self.define(TypeKind::Array, start, 1, sub)?;
        Ok(())
    }

    fn define(
        &mut self,
        kind: TypeKind,
        start: usize,
        count: usize,
        sub: Subtyping,
    ) -> Result<&mut Definition, OutOfMemory> {
        let index = self.len();
        let supertype = sub.supertype.map(|sup| self.types.definition(sup));
        let definition = Definition {
            heap_type: HeapType::defined(TypeIndex(index), kind),
            start: start as u32,
            count: count as u16,
            results: 0,
            supertype: supertype
                .and_then(|sup| sup.heap_type.index())
                .map_or(NO_SUPERTYPE, |sup| sup.0),
            size: 0,
            group: self.types.groups.len() as u32,
            member: index - self.group_start,
            kind,
            depth: supertype.map_or(0, |sup| sup.depth.saturating_add(1)),
            is_final: sub.is_final,
            trait_of_kind: false,
        };
        self.types.definitions.try_push(definition)?;
        Ok(&mut self.types.definitions[index as usize])
    }

    pub(crate) fn end_group(&mut self) -> Result<(), GroupError> {
        self.fill_in_kinds();
        self.make_candidate()?;
        let hash = self.candidate.hash();
        let earlier = self.seen.find(hash, |&(other, first)| {
            let group = self.types.definitions[first as usize].group;
            other == hash && self.candidate.describes(&self.types.groups[group as usize])
        });
        match earlier {
            Some(&(_, first)) => self.repeat_group(first as usize),
            None => self.add_group(hash)?,
        }

        let types = &self.types;
        self.group_start = types.len();
        self.values_start = types.values.len();
        self.fields_start = types.fields.len();
        self.pending_values = self.values_start;
        self.pending_fields = self.fields_start;
        Ok(())
    }

    fn repeat_group(&mut self, first: usize) {
        let (types, start) = (&mut self.types, self.group_start as usize);
        let count = types.definitions.len() - start;
        types.definitions.copy_within(first..first + count, start);
        types.values.truncate(self.values_start);
        types.fields.truncate(self.fields_start);
    }

    fn add_group(&mut self, hash: u64) -> Result<(), GroupError> {
        self.check_subtyping()?;
        let group = self.candidate.intern(hash, |number| {
            let definition = self.types.definition(self.outside[number]);
            (
                &self.types.groups[definition.group as usize],
                definition.member,
            )
        })?;
        let rehash = |&(hash, _): &(u64, u32)| hash;
        self.seen.try_reserve(1, rehash).map_err(|_| OutOfMemory)?;
        self.seen
            .insert_unique(hash, (hash, self.group_start), rehash);
        Ok(self.types.groups.try_push(group)?)
    }

    pub(crate) fn finish(mut self) -> Types {
        shrink(&mut self.types.definitions);
        shrink(&mut self.types.values);
        shrink(&mut self.types.fields);
        shrink(&mut self.types.groups);
        self.types
    }

    fn fill_in_kinds(&mut self) {
        let definitions = &self.types.definitions;
        let resolve = |ty: ValType| match ty.defined_index() {
            Some(index) => ty.with_heap_type(definitions[index.usize()].heap_type),
            None => ty,
        };
        for value in &mut self.types.values[self.values_start..] {
            *value = resolve(*value);
        }
        for field in &mut self.types.fields[self.fields_start..] {
            let bits = resolve(field.ty.storage.as_value_bits());
            field.ty.storage = StorageType::from_value_bits(bits);
        }
    }

    fn check_subtyping(&self) -> Result<(), GroupError> {
        let members = &self.types.definitions[self.group_start as usize..];
        // First, because it bounds the cost of the rest.
        if let Some(deep) = members
            .iter()
            .find(|member| u32::from(member.depth) > MAX_SUBTYPE_DEPTH)
        {
            return Err(GroupError::TooDeep {
                member: deep.member,
            });
        }
        for member in members {
            if member.supertype == NO_SUPERTYPE {
                continue;
            }
            let supertype = self.types.definition(TypeIndex(member.supertype));
            if supertype.is_final {
                return Err(GroupError::FinalSupertype);
            }
            if !self.types.matches_supertype(member, supertype) {
                return Err(GroupError::SupertypeMismatch);
            }
        }
        Ok(())
    }

    fn make_candidate(&mut self) -> Result<(), OutOfMemory> {
        let types = &self.types;
        let start = self.group_start;
        let member_count = types.len() - start;
        let missing = (start as usize).saturating_sub(self.outside_numbers.len());
        self.outside_numbers.try_reserve(missing)?;
        self.outside_numbers.resize(start as usize, 0);
        self.outside.clear();
        self.candidate.clear();

        let mut relative = |index: u32| -> Result<u32, OutOfMemory> {
            if index >= start {
                return Ok(index - start);
            }
            let number = &mut self.outside_numbers[index as usize];
            if *number == 0 {
                self.outside.try_push(TypeIndex(index))?;
                *number = self.outside.len() as u32;
            }
            Ok(member_count + *number - 1)
        };
        for member in &types.definitions[start as usize..] {
            let supertype = match member.supertype {
                NO_SUPERTYPE => NO_SUPERTYPE,
                index => relative(index)?,
            };
            self.candidate.push_shape(Shape {
                kind: member.kind,
                is_final: member.is_final,
                count: member.count,
                results: member.results,
                supertype,
            })?;
            let mut relative_type = |ty: ValType| match ty.defined_index() {
                Some(index) => Ok::<_, OutOfMemory>(ty.with_index(relative(index.0)?)),
                None => Ok(ty),
            };
            if member.kind == TypeKind::Func {
                for &ty in types.values_of(member) {
                    self.candidate.push_value(relative_type(ty)?)?;
                }
                continue;
            }
            for field in types.fields_of(member) {
                let bits = relative_type(field.ty.storage.as_value_bits())?;
                self.candidate.push_field(FieldType {
                    storage: StorageType::from_value_bits(bits),
                    mutable: field.ty.mutable,
                })?;
            }
        }

        for &index in &self.outside {
            self.outside_numbers[index.usize()] = 0;
            self.candidate.push_outside(types.rtt(index))?;
        }
        Ok(())
    }
}

use core::hash::BuildHasher;

use hashbrown::HashTable;
use rustc_hash::FxBuildHasher;

pub use super::generated::{ClassPart, OpaqueKind, Primitives, Type, TypeFlags};
use super::ids::{FunctionId, Id, LayoutId, StringId, TypeId};
use super::parallel::{InParallel, map_each};
use super::references::Reference;
use super::type_union::{normalize_type, normalize_without_table};
use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::builtins::table::{BuiltinKind, canonical_id, class_data, entry, well_known_symbol};

fn copy_of_list<T: Clone>(list: &[T]) -> Vec<T> {
    match list {
        [] => Vec::new(),
        _ => list.to_vec(),
    }
}

impl Type {
    #[inline]
    pub fn never() -> Type {
        Type::default()
    }

    pub fn anything() -> Type {
        Type {
            primitives: Primitives::OBSERVABLE,
            flags: TypeFlags::ANY_OBJECT_OR_FUNCTION,
            ..Type::default()
        }
    }

    pub fn primitives(primitives: Primitives) -> Type {
        Type {
            primitives,
            ..Type::default()
        }
    }

    pub fn integers(minimum: i64, maximum: i64) -> Type {
        debug_assert!(minimum <= maximum);
        Type {
            flags: TypeFlags::HAS_INTEGERS,
            minimum,
            maximum,
            ..Type::default()
        }
    }

    pub fn string_literal(string: StringId) -> Type {
        Type {
            strings: vec![string],
            ..Type::default()
        }
    }

    pub fn layout(layout: LayoutId) -> Type {
        Type {
            layouts: vec![layout],
            ..Type::default()
        }
    }

    pub fn class(builtin_class: BuiltinClass, contents: &[TypeId]) -> Type {
        debug_assert_eq!(contents.len(), class_data(builtin_class).contents.len());
        let contents = contents.to_vec();
        Type {
            classes: vec![ClassPart {
                builtin_class,
                contents,
            }],
            ..Type::default()
        }
    }

    pub fn builtin(builtin: BuiltinId) -> Type {
        debug_assert_ne!(entry(builtin).kind, BuiltinKind::Constant);
        Type {
            builtins: vec![canonical_id(builtin)],
            ..Type::default()
        }
    }

    pub fn value_of_builtin(builtin: BuiltinId) -> Option<Type> {
        if entry(builtin).kind != BuiltinKind::Constant {
            return Some(Type::builtin(builtin));
        }
        well_known_symbol(builtin).map(|_| Type::primitives(Primitives::SYMBOL))
    }

    pub fn function(function: FunctionId) -> Type {
        Type {
            functions: vec![function],
            ..Type::default()
        }
    }

    pub fn any_object() -> Type {
        Type {
            flags: TypeFlags::ANY_OBJECT_OR_FUNCTION,
            ..Type::default()
        }
    }

    pub fn any_function() -> Type {
        Type {
            flags: TypeFlags::ANY_FUNCTION,
            ..Type::default()
        }
    }

    pub fn environment(layout: LayoutId) -> Type {
        Type {
            environment: Some(layout),
            ..Type::default()
        }
    }

    pub fn opaque(kind: OpaqueKind) -> Type {
        Type {
            opaque: Some(kind),
            ..Type::default()
        }
    }

    #[inline]
    pub fn integer_range(&self) -> Option<(i64, i64)> {
        let has_integers = self.flags.0 & TypeFlags::HAS_INTEGERS.0 != 0;
        has_integers.then_some((self.minimum, self.maximum))
    }

    #[cfg(test)]
    pub fn is_never(&self) -> bool {
        *self == Type::default()
    }

    #[cfg(any(test, feature = "ir_text"))]
    pub fn is_anything(&self) -> bool {
        let has_every_primitive = self.primitives.contains(Primitives::OBSERVABLE);
        has_every_primitive && self.flags.contains(TypeFlags::ANY_OBJECT)
    }

    #[inline]
    pub fn is_internal(&self) -> bool {
        self.opaque.is_some() || self.environment.is_some()
    }

    fn references_only_types_below(&self, count: usize) -> bool {
        let mut is_below = true;
        self.for_each_reference(&mut |reference| {
            if let Reference::Type(child) = reference {
                is_below &= child.index() < count;
            }
        });
        is_below
    }

    fn is_normalized(&self) -> bool {
        let mut normalized = self.clone();
        normalize_without_table(&mut normalized) && normalized == *self
    }
}

#[derive(Clone)]
pub struct TypeTable {
    types: Vec<Type>,
    hashes: Vec<u64>,
    type_ids: HashTable<TypeId>,
    spare_union: Type,
}

#[inline]
pub(super) fn hash_of<T: core::hash::Hash>(value: &T) -> u64 {
    FxBuildHasher.hash_one(value)
}

fn order_by_place_in_table(hashes: &[u64], capacity: usize) -> Vec<(u64, u32)> {
    const PART_BITS: u32 = 8;
    let place_count = (capacity / 7 * 8).next_power_of_two();
    let shift = place_count.trailing_zeros().saturating_sub(PART_BITS);
    let part_of = |hash: u64| (hash as usize & (place_count - 1)) >> shift;
    let mut next_places = [0usize; (1 << PART_BITS) + 1];
    for &hash in hashes {
        next_places[part_of(hash) + 1] += 1;
    }
    for part in 0..1 << PART_BITS {
        next_places[part + 1] += next_places[part];
    }
    let mut ordered = vec![(0u64, 0u32); hashes.len()];
    for (index, &hash) in (0u32..).zip(hashes) {
        let place = &mut next_places[part_of(hash)];
        ordered[*place] = (hash, index);
        *place += 1;
    }
    ordered
}

impl TypeTable {
    pub const NEVER: TypeId = TypeId::from_word(0);
    pub const UNDEFINED: TypeId = TypeId::from_word(1);
    pub const NULL: TypeId = TypeId::from_word(2);
    pub const NULLISH: TypeId = TypeId::from_word(3);
    pub const BOOLEAN: TypeId = TypeId::from_word(4);
    pub const NUMBER: TypeId = TypeId::from_word(5);
    pub const INT32: TypeId = TypeId::from_word(6);
    pub const UINT32: TypeId = TypeId::from_word(7);
    pub const STRING: TypeId = TypeId::from_word(8);
    pub const SYMBOL: TypeId = TypeId::from_word(9);
    pub const BIGINT: TypeId = TypeId::from_word(10);
    pub const OBJECT: TypeId = TypeId::from_word(11);
    pub const FUNCTION: TypeId = TypeId::from_word(12);
    pub const ANYTHING: TypeId = TypeId::from_word(13);
    pub const ABSENT: TypeId = TypeId::from_word(14);
    pub const ARRAY: TypeId = TypeId::from_word(15);
    pub const ANYTHING_OR_ABSENT: TypeId = TypeId::from_word(16);
    pub const WELL_KNOWN_COUNT: usize = 17;

    pub fn new() -> TypeTable {
        let well_known_types: [(TypeId, Type); Self::WELL_KNOWN_COUNT] = [
            (Self::NEVER, Type::never()),
            (Self::UNDEFINED, Type::primitives(Primitives::UNDEFINED)),
            (Self::NULL, Type::primitives(Primitives::NULL)),
            (Self::NULLISH, Type::primitives(Primitives::NULLISH)),
            (Self::BOOLEAN, Type::primitives(Primitives::BOOLEAN)),
            (Self::NUMBER, Type::primitives(Primitives::NUMBER)),
            (
                Self::INT32,
                Type::integers(i32::MIN.into(), i32::MAX.into()),
            ),
            (Self::UINT32, Type::integers(0, u32::MAX.into())),
            (Self::STRING, Type::primitives(Primitives::STRING)),
            (Self::SYMBOL, Type::primitives(Primitives::SYMBOL)),
            (Self::BIGINT, Type::primitives(Primitives::BIG_INT)),
            (Self::OBJECT, Type::any_object()),
            (Self::FUNCTION, Type::any_function()),
            (Self::ANYTHING, Type::anything()),
            (Self::ABSENT, Type::primitives(Primitives::ABSENT)),
            (
                Self::ARRAY,
                Type::class(BuiltinClass::Array, &[Self::ANYTHING]),
            ),
            (
                Self::ANYTHING_OR_ABSENT,
                Type {
                    primitives: Primitives::ALL,
                    ..Type::anything()
                },
            ),
        ];
        let mut table = TypeTable {
            types: Vec::with_capacity(Self::WELL_KNOWN_COUNT),
            hashes: Vec::with_capacity(Self::WELL_KNOWN_COUNT),
            type_ids: HashTable::with_capacity(Self::WELL_KNOWN_COUNT),
            spare_union: Type::never(),
        };
        for (id, ty) in well_known_types {
            let interned = table.intern(ty);
            debug_assert_eq!(interned, id);
        }
        table
    }

    pub fn of_distinct_types(types: Vec<Type>, in_parallel: InParallel<'_>) -> TypeTable {
        const TYPES_IN_A_TASK: usize = 1 << 12;
        debug_assert!(
            types.starts_with(TypeTable::new().types()),
            "the well-known types stand first, at their ids"
        );
        let tasks: Vec<&[Type]> = types.chunks(TYPES_IN_A_TASK).collect();
        let hashes = map_each(tasks, in_parallel, &|types: &[Type]| {
            types.iter().map(hash_of).collect::<Vec<u64>>()
        });
        let hashes: Vec<u64> = hashes.into_iter().flatten().collect();
        let capacity = types.len() + types.len() / 8;
        let mut type_ids: HashTable<TypeId> = HashTable::with_capacity(capacity);
        for (hash, index) in order_by_place_in_table(&hashes, type_ids.capacity()) {
            let (index, ty) = (index as usize, &types[index as usize]);
            debug_assert!(ty.references_only_types_below(index));
            debug_assert!(ty.is_normalized());
            debug_assert!(
                type_ids
                    .find(hash, |&id| types[id.index()] == *ty)
                    .is_none(),
                "no two types are alike"
            );
            type_ids.insert_unique(hash, TypeId::new(index), |&id| hashes[id.index()]);
        }
        TypeTable {
            types,
            hashes,
            type_ids,
            spare_union: Type::never(),
        }
    }

    pub fn intern(&mut self, mut ty: Type) -> TypeId {
        normalize_type(self, &mut ty);
        let hash = hash_of(&ty);
        if let Some(id) = self.find_hashed(hash, &ty) {
            return id;
        }
        self.add_hashed(hash, ty)
    }

    pub(super) fn types_and_spare_union(&mut self) -> (&[Type], &mut Type) {
        (&self.types, &mut self.spare_union)
    }

    pub(super) fn intern_spare_union(&mut self) -> TypeId {
        if !normalize_without_table(&mut self.spare_union) {
            let union = core::mem::take(&mut self.spare_union);
            return self.intern(union);
        }
        let hash = hash_of(&self.spare_union);
        if let Some(id) = self.find_hashed(hash, &self.spare_union) {
            return id;
        }
        let Type {
            primitives,
            flags,
            opaque,
            environment,
            minimum,
            maximum,
            ref strings,
            ref layouts,
            ref classes,
            ref builtins,
            ref functions,
        } = self.spare_union;
        let union = Type {
            primitives,
            flags,
            opaque,
            environment,
            minimum,
            maximum,
            strings: copy_of_list(strings),
            layouts: copy_of_list(layouts),
            classes: copy_of_list(classes),
            builtins: copy_of_list(builtins),
            functions: copy_of_list(functions),
        };
        self.add_hashed(hash, union)
    }

    pub(super) fn clear_spare_union(&mut self) {
        let Type {
            primitives,
            flags,
            opaque,
            environment,
            minimum,
            maximum,
            strings,
            layouts,
            classes,
            builtins,
            functions,
        } = &mut self.spare_union;
        (*primitives, *flags) = (Primitives::default(), TypeFlags::default());
        (*opaque, *environment) = (None, None);
        (*minimum, *maximum) = (0, 0);
        strings.clear();
        layouts.clear();
        classes.clear();
        builtins.clear();
        functions.clear();
    }

    fn add_hashed(&mut self, hash: u64, ty: Type) -> TypeId {
        let count = self.types.len();
        debug_assert!(ty.references_only_types_below(count));
        let id = TypeId::new(count);
        self.types.push(ty);
        self.hashes.push(hash);
        let hashes = &self.hashes;
        self.type_ids
            .insert_unique(hash, id, |&id| hashes[id.index()]);
        id
    }

    pub fn truncate(&mut self, length: usize) {
        let length = length.max(Self::WELL_KNOWN_COUNT);
        if self.types.len() <= length {
            return;
        }
        self.types.truncate(length);
        self.hashes.truncate(length);
        self.type_ids.retain(|id| id.index() < length);
    }

    pub fn with_nullish(&mut self, ty: TypeId) -> TypeId {
        let nullish = Primitives::NULLISH.0;
        if self.get(ty).primitives.0 & nullish == nullish {
            return ty;
        }
        self.union(ty, Self::NULLISH)
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &Type {
        &self.types[id.index()]
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.types.len()
    }

    #[inline]
    pub fn types(&self) -> &[Type] {
        &self.types
    }

    pub(super) fn find_hashed(&self, hash: u64, ty: &Type) -> Option<TypeId> {
        let is_equal = |&id: &TypeId| self.types[id.index()] == *ty;
        self.type_ids.find(hash, is_equal).copied()
    }
}

impl Default for TypeTable {
    fn default() -> TypeTable {
        TypeTable::new()
    }
}

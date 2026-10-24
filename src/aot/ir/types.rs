use core::hash::BuildHasher;
use std::sync::{Arc, OnceLock, Weak};

use bun_threading::Guarded;
use hashbrown::HashTable;
use rustc_hash::FxBuildHasher;

pub use super::generated::{ClassPart, OpaqueKind, Primitives, Type, TypeFlags};
use super::ids::{FunctionId, Id, LayoutId, StringId, TypeId};
use super::references::Reference;
use super::type_union::{normalize_type, normalize_without_table};
use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::builtins::table::class_data;

impl Type {
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
        Type {
            builtins: vec![builtin],
            ..Type::default()
        }
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

    pub fn is_never(&self) -> bool {
        *self == Type::default()
    }

    pub fn is_anything(&self) -> bool {
        let has_every_primitive = self.primitives.contains(Primitives::OBSERVABLE);
        has_every_primitive && self.flags.contains(TypeFlags::ANY_OBJECT)
    }

    pub fn integer_range(&self) -> Option<(i64, i64)> {
        let has_integers = self.flags.contains(TypeFlags::HAS_INTEGERS);
        has_integers.then_some((self.minimum, self.maximum))
    }

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
}

#[derive(Default)]
pub struct PreparedType {
    ty: Type,
    // `None`: only the table can put the type into its form.
    hash: Option<u64>,
}

impl PreparedType {
    pub fn ty(&self) -> &Type {
        &self.ty
    }
}

pub struct TypeTable {
    types: TypeList,
    type_ids: HashTable<TypeId>,
}

enum TypeList {
    Own(Vec<Type>),
    Shared(SharedTypeList),
}

struct SharedTypeList {
    known: Arc<TypesOfAllTables>,
    types: Vec<Arc<Type>>,
    copies: OnceLock<Box<[Type]>>,
}

// The ids in a type count from 0 in every file, and nine types in ten have one part, so most types of a file read like a type of another file.
struct TypesOfAllTables {
    shards: [Guarded<HashTable<Arc<Type>>>; TypesOfAllTables::SHARD_COUNT],
}

impl TypesOfAllTables {
    const SHARD_COUNT: usize = 64;

    fn current() -> Arc<TypesOfAllTables> {
        static CURRENT: Guarded<Weak<TypesOfAllTables>> = Guarded::new(Weak::new());
        let mut current = CURRENT.lock();
        if let Some(known) = current.upgrade() {
            return known;
        }
        let known = Arc::new(TypesOfAllTables {
            shards: core::array::from_fn(|_| Guarded::new(HashTable::new())),
        });
        *current = Arc::downgrade(&known);
        known
    }

    fn intern(&self, hash: u64, ty: Type) -> Arc<Type> {
        // The table itself goes by the lowest and by the highest bits.
        let shard = (hash >> 32) as usize % Self::SHARD_COUNT;
        let mut types = self.shards[shard].lock();
        if let Some(known) = types.find(hash, |known| **known == ty) {
            return Arc::clone(known);
        }
        let added = Arc::new(ty);
        types.insert_unique(hash, Arc::clone(&added), |known| hash_of(&**known));
        added
    }
}

impl TypeList {
    #[inline]
    fn get(&self, index: usize) -> &Type {
        match self {
            TypeList::Own(types) => &types[index],
            TypeList::Shared(list) => &list.types[index],
        }
    }

    fn len(&self) -> usize {
        match self {
            TypeList::Own(types) => types.len(),
            TypeList::Shared(list) => list.types.len(),
        }
    }
}

// Not `shrink_to_fit`: the allocator leaves a block where it is while more than half of it stays in use.
pub fn release_spare_capacity<T>(list: &mut Vec<T>) {
    if list.len() == list.capacity() {
        return;
    }
    let mut exact = Vec::with_capacity(list.len());
    exact.append(list);
    *list = exact;
}

pub(super) fn hash_of<T: core::hash::Hash>(value: &T) -> u64 {
    FxBuildHasher.hash_one(value)
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
    /// What a variable holds that link defines and that may stay empty.
    pub const ANYTHING_OR_ABSENT: TypeId = TypeId::from_word(16);
    pub const WELL_KNOWN_COUNT: usize = 17;

    /// For a table that waits with many others: a type that reads the same in several of them is held once.
    pub fn share_types(&mut self) {
        let TypeList::Own(types) = &mut self.types else {
            return;
        };
        let known = TypesOfAllTables::current();
        // Not `collect`, which would keep the block of the types for the pointers to them.
        let mut shared = Vec::with_capacity(types.len());
        let types = core::mem::take(types).into_iter();
        shared.extend(types.map(|ty| known.intern(hash_of(&ty), ty)));
        self.types = TypeList::Shared(SharedTypeList {
            known,
            types: shared,
            copies: OnceLock::new(),
        });
    }

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
            types: TypeList::Own(Vec::with_capacity(Self::WELL_KNOWN_COUNT)),
            type_ids: HashTable::with_capacity(Self::WELL_KNOWN_COUNT),
        };
        for (id, ty) in well_known_types {
            let interned = table.intern(ty);
            debug_assert_eq!(interned, id);
        }
        table
    }

    pub fn intern(&mut self, mut ty: Type) -> TypeId {
        normalize_type(self, &mut ty);
        let hash = hash_of(&ty);
        self.intern_normalized(hash, ty)
    }

    /// What `intern` does with a type before it looks at the table, which many threads can do at a time.
    pub fn prepare(mut ty: Type) -> PreparedType {
        let is_normalized = normalize_without_table(&mut ty);
        PreparedType {
            hash: is_normalized.then(|| hash_of(&ty)),
            ty,
        }
    }

    pub fn intern_prepared(&mut self, prepared: PreparedType) -> TypeId {
        match prepared.hash {
            Some(hash) => self.intern_normalized(hash, prepared.ty),
            None => self.intern(prepared.ty),
        }
    }

    fn intern_normalized(&mut self, hash: u64, ty: Type) -> TypeId {
        if let Some(id) = self.find_hashed(hash, &ty) {
            return id;
        }
        let count = self.types.len();
        debug_assert!(ty.references_only_types_below(count));
        let id = TypeId::new(count);
        match &mut self.types {
            TypeList::Own(types) => types.push(ty),
            TypeList::Shared(list) => {
                debug_assert!(list.copies.get().is_none());
                list.types.push(list.known.intern(hash, ty));
            }
        }
        let types = &self.types;
        self.type_ids
            .insert_unique(hash, id, |&id| hash_of(types.get(id.index())));
        id
    }

    /// Makes room for that many more types, so that none that is there is moved or hashed again while they are added.
    pub fn reserve(&mut self, additional: usize) {
        match &mut self.types {
            TypeList::Own(types) => types.reserve(additional),
            TypeList::Shared(list) => list.types.reserve(additional),
        }
        let types = &self.types;
        self.type_ids
            .reserve(additional, |&id| hash_of(types.get(id.index())));
    }

    pub fn release_spare_capacity(&mut self) {
        match &mut self.types {
            TypeList::Own(types) => release_spare_capacity(types),
            TypeList::Shared(list) => release_spare_capacity(&mut list.types),
        }
    }

    pub fn with_nullish(&mut self, ty: TypeId) -> TypeId {
        if self.get(ty).primitives.contains(Primitives::NULLISH) {
            return ty;
        }
        self.union(ty, Self::NULLISH)
    }

    #[inline]
    pub fn get(&self, id: TypeId) -> &Type {
        self.types.get(id.index())
    }

    pub fn len(&self) -> usize {
        self.types.len()
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = &Type> {
        (0..self.len()).map(|index| self.types.get(index))
    }

    /// Of a table that shares its types: copies, which stay. `iter` makes none.
    pub fn types(&self) -> &[Type] {
        match &self.types {
            TypeList::Own(types) => types,
            TypeList::Shared(list) => list
                .copies
                .get_or_init(|| list.types.iter().map(|ty| Type::clone(ty)).collect()),
        }
    }

    fn find_hashed(&self, hash: u64, ty: &Type) -> Option<TypeId> {
        let is_equal = |&id: &TypeId| *self.types.get(id.index()) == *ty;
        self.type_ids.find(hash, is_equal).copied()
    }
}

impl Default for TypeTable {
    fn default() -> TypeTable {
        TypeTable::new()
    }
}

use core::hash::BuildHasher;

use hashbrown::HashTable;
use rustc_hash::FxBuildHasher;

pub use super::generated::{ClassPart, OpaqueKind, Primitives, Type, TypeFlags};
use super::ids::{FunctionId, Id, LayoutId, StringId, TypeId};
use super::references::Reference;
use super::type_union::{normalize_type, normalize_without_table};
use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::builtins::table::{BuiltinKind, canonical_id, class_data, entry, well_known_symbol};

#[inline]
fn copy_of_list<T: Clone>(list: &[T]) -> Vec<T> {
    match list {
        [] => Vec::new(),
        _ => list.to_vec(),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TypeRef<'a> {
    pub primitives: Primitives,
    pub flags: TypeFlags,
    pub opaque: Option<OpaqueKind>,
    pub environment: Option<LayoutId>,
    pub minimum: i64,
    pub maximum: i64,
    pub strings: &'a [StringId],
    pub layouts: &'a [LayoutId],
    pub classes: &'a [ClassPart],
    pub builtins: &'a [BuiltinId],
    pub functions: &'a [FunctionId],
}

impl<'a> TypeRef<'a> {
    const NEVER: TypeRef<'static> = TypeRef {
        primitives: Primitives(0),
        flags: TypeFlags(0),
        opaque: None,
        environment: None,
        minimum: 0,
        maximum: 0,
        strings: &[],
        layouts: &[],
        classes: &[],
        builtins: &[],
        functions: &[],
    };

    #[inline]
    pub fn of(ty: &'a Type) -> TypeRef<'a> {
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
        } = *ty;
        TypeRef {
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
        }
    }

    pub fn to_type(self) -> Type {
        let TypeRef {
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
        } = self;
        Type {
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
        }
    }

    pub fn copy_to(self, ty: &mut Type) {
        fn refill<T: Clone>(list: &mut Vec<T>, with: &[T]) {
            list.clear();
            list.extend_from_slice(with);
        }
        let TypeRef {
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
        } = self;
        (ty.primitives, ty.flags) = (primitives, flags);
        (ty.opaque, ty.environment) = (opaque, environment);
        (ty.minimum, ty.maximum) = (minimum, maximum);
        refill(&mut ty.strings, strings);
        refill(&mut ty.layouts, layouts);
        refill(&mut ty.classes, classes);
        refill(&mut ty.builtins, builtins);
        refill(&mut ty.functions, functions);
    }

    #[inline]
    pub fn integer_range(self) -> Option<(i64, i64)> {
        let has_integers = self.flags.0 & TypeFlags::HAS_INTEGERS.0 != 0;
        has_integers.then_some((self.minimum, self.maximum))
    }

    #[cfg(test)]
    pub fn is_never(self) -> bool {
        self == Type::default()
    }

    #[cfg(any(test, feature = "ir_text"))]
    pub fn is_anything(self) -> bool {
        let has_every_primitive = self.primitives.contains(Primitives::OBSERVABLE);
        has_every_primitive && self.flags.contains(TypeFlags::ANY_OBJECT)
    }

    #[inline]
    pub fn is_internal(self) -> bool {
        self.opaque.is_some() || self.environment.is_some()
    }

    fn references_only_types_below(self, count: usize) -> bool {
        let mut is_below = true;
        self.for_each_reference(&mut |reference| {
            if let Reference::Type(child) = reference {
                is_below &= child.index() < count;
            }
        });
        is_below
    }
}

impl PartialEq<Type> for TypeRef<'_> {
    #[inline]
    fn eq(&self, other: &Type) -> bool {
        *self == TypeRef::of(other)
    }
}

type PartsBesidePrimitives<'a> = (
    TypeFlags,
    Option<OpaqueKind>,
    Option<LayoutId>,
    (i64, i64),
    &'a [StringId],
    &'a [LayoutId],
    &'a [ClassPart],
    &'a [BuiltinId],
    &'a [FunctionId],
);

#[inline]
fn parts_beside_primitives<'a>(ty: &TypeRef<'a>) -> PartsBesidePrimitives<'a> {
    let TypeRef {
        primitives: _,
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
    } = *ty;
    (
        flags,
        opaque,
        environment,
        (minimum, maximum),
        strings,
        layouts,
        classes,
        builtins,
        functions,
    )
}

#[inline]
fn spread_primitives(primitives: Primitives) -> u64 {
    u64::from(primitives.0).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

#[inline]
fn hash_of_parts(ty: &TypeRef<'_>) -> u64 {
    hash_of(&parts_beside_primitives(ty)).wrapping_add(spread_primitives(ty.primitives))
}

pub(super) fn hash_of_type(ty: &Type) -> u64 {
    hash_of_parts(&TypeRef::of(ty))
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
        TypeRef::of(self).integer_range()
    }

    #[cfg(test)]
    pub fn is_never(&self) -> bool {
        TypeRef::of(self).is_never()
    }

    #[cfg(test)]
    pub fn is_anything(&self) -> bool {
        TypeRef::of(self).is_anything()
    }

    #[cfg(test)]
    pub fn is_internal(&self) -> bool {
        TypeRef::of(self).is_internal()
    }

    fn is_normalized(&self) -> bool {
        let mut normalized = self.clone();
        normalize_without_table(&mut normalized) && normalized == *self
    }
}

#[derive(Clone, Copy, Default)]
enum Held<T> {
    #[default]
    Nothing,
    One(T),
    Many(u32),
}

impl<T: Copy> Held<T> {
    #[inline(always)]
    fn as_slice<'a>(&'a self, longer_lists: &'a [Vec<T>]) -> &'a [T] {
        match self {
            Held::Nothing => &[],
            Held::One(only) => core::slice::from_ref(only),
            Held::Many(at) => longer_lists.get(*at as usize).map_or(&[], Vec::as_slice),
        }
    }

    #[inline]
    fn keep(list: Vec<T>, longer_lists: &mut Vec<Vec<T>>) -> Held<T> {
        match list[..] {
            [] => Held::Nothing,
            [only] => Held::One(only),
            _ => {
                longer_lists.push(list);
                Held::Many(place_of_last(longer_lists))
            }
        }
    }

    #[inline]
    fn keep_copy(list: &[T], longer_lists: &mut Vec<Vec<T>>) -> Held<T> {
        match *list {
            [] => Held::Nothing,
            [only] => Held::One(only),
            _ => {
                longer_lists.push(list.to_vec());
                Held::Many(place_of_last(longer_lists))
            }
        }
    }

    fn forget(self, longer_lists: &mut Vec<Vec<T>>) {
        if let Held::Many(at) = self {
            longer_lists.truncate(at as usize);
        }
    }
}

#[inline]
fn count_of<T>(list: &[T]) -> u32 {
    u32::try_from(list.len()).expect("a list of a table of types holds fewer than 2^32 entries")
}

#[inline]
fn place_of_last<T>(list: &[T]) -> u32 {
    count_of(list) - 1
}

#[derive(Clone, Copy)]
struct Row {
    primitives: Primitives,
    flags: TypeFlags,
    opaque: Option<OpaqueKind>,
    environment: Option<LayoutId>,
    strings: Held<StringId>,
    layouts: Held<LayoutId>,
    builtins: Held<BuiltinId>,
    functions: Held<FunctionId>,
    first_class: u32,
    class_count: u32,
    range_count: u32,
}

const _: () = assert!(size_of::<Row>() == 60);

#[derive(Clone)]
struct StoredTypes {
    rows: Vec<Row>,
    strings: Vec<Vec<StringId>>,
    layouts: Vec<Vec<LayoutId>>,
    builtins: Vec<Vec<BuiltinId>>,
    functions: Vec<Vec<FunctionId>>,
    classes: Vec<ClassPart>,
    ranges: Vec<(i64, i64)>,
}

impl StoredTypes {
    fn with_capacity(capacity: usize) -> StoredTypes {
        StoredTypes {
            rows: Vec::with_capacity(capacity),
            strings: Vec::new(),
            layouts: Vec::new(),
            builtins: Vec::new(),
            functions: Vec::new(),
            classes: Vec::new(),
            ranges: Vec::new(),
        }
    }

    #[inline]
    fn len(&self) -> usize {
        self.rows.len()
    }

    #[inline(always)]
    fn get(&self, index: usize) -> TypeRef<'_> {
        let row = &self.rows[index];
        let (minimum, maximum) = match row.range_count {
            0 => (0, 0),
            count => {
                let range = self.ranges.get(count as usize - 1);
                range.copied().unwrap_or_default()
            }
        };
        let classes = match row.class_count {
            0 => &[],
            count => {
                let first = row.first_class as usize;
                let classes = self.classes.get(first..first + count as usize);
                classes.unwrap_or_default()
            }
        };
        TypeRef {
            primitives: row.primitives,
            flags: row.flags,
            opaque: row.opaque,
            environment: row.environment,
            minimum,
            maximum,
            strings: row.strings.as_slice(&self.strings),
            layouts: row.layouts.as_slice(&self.layouts),
            classes,
            builtins: row.builtins.as_slice(&self.builtins),
            functions: row.functions.as_slice(&self.functions),
        }
    }

    fn keep_range(&mut self, minimum: i64, maximum: i64) -> u32 {
        if (minimum, maximum) == (0, 0) {
            return 0;
        }
        self.ranges.push((minimum, maximum));
        count_of(&self.ranges)
    }

    fn push(&mut self, ty: Type) {
        let Type {
            primitives,
            flags,
            opaque,
            environment,
            minimum,
            maximum,
            strings,
            layouts,
            mut classes,
            builtins,
            functions,
        } = ty;
        let first_class = count_of(&self.classes);
        self.classes.append(&mut classes);
        let row = Row {
            primitives,
            flags,
            opaque,
            environment,
            strings: Held::keep(strings, &mut self.strings),
            layouts: Held::keep(layouts, &mut self.layouts),
            builtins: Held::keep(builtins, &mut self.builtins),
            functions: Held::keep(functions, &mut self.functions),
            first_class,
            class_count: count_of(&self.classes) - first_class,
            range_count: self.keep_range(minimum, maximum),
        };
        self.rows.push(row);
    }

    fn push_copy(&mut self, ty: &TypeRef<'_>) {
        let first_class = count_of(&self.classes);
        self.classes.extend_from_slice(ty.classes);
        let row = Row {
            primitives: ty.primitives,
            flags: ty.flags,
            opaque: ty.opaque,
            environment: ty.environment,
            strings: Held::keep_copy(ty.strings, &mut self.strings),
            layouts: Held::keep_copy(ty.layouts, &mut self.layouts),
            builtins: Held::keep_copy(ty.builtins, &mut self.builtins),
            functions: Held::keep_copy(ty.functions, &mut self.functions),
            first_class,
            class_count: count_of(&self.classes) - first_class,
            range_count: self.keep_range(ty.minimum, ty.maximum),
        };
        self.rows.push(row);
    }

    fn push_again(&mut self, index: usize, primitives: Primitives) {
        fn keep_again<T: Copy>(held: Held<T>, longer_lists: &mut Vec<Vec<T>>) -> Held<T> {
            let Held::Many(at) = held else {
                return held;
            };
            longer_lists.push(longer_lists[at as usize].clone());
            Held::Many(place_of_last(longer_lists))
        }
        let row = self.rows[index];
        let TypeRef {
            minimum, maximum, ..
        } = self.get(index);
        let first_class = count_of(&self.classes);
        let classes = row.first_class as usize..(row.first_class + row.class_count) as usize;
        self.classes.extend_from_within(classes);
        let range_count = self.keep_range(minimum, maximum);
        self.rows.push(Row {
            primitives,
            strings: keep_again(row.strings, &mut self.strings),
            layouts: keep_again(row.layouts, &mut self.layouts),
            builtins: keep_again(row.builtins, &mut self.builtins),
            functions: keep_again(row.functions, &mut self.functions),
            first_class,
            range_count,
            ..row
        });
    }

    fn append(&mut self, mut added: StoredTypes) {
        fn move_by<T>(held: Held<T>, lists_in_front: u32) -> Held<T> {
            match held {
                Held::Many(at) => Held::Many(at + lists_in_front),
                Held::Nothing | Held::One(_) => held,
            }
        }
        let strings = count_of(&self.strings);
        let layouts = count_of(&self.layouts);
        let builtins = count_of(&self.builtins);
        let functions = count_of(&self.functions);
        let classes = count_of(&self.classes);
        let ranges = count_of(&self.ranges);
        self.rows.extend(added.rows.iter().map(|&row| Row {
            strings: move_by(row.strings, strings),
            layouts: move_by(row.layouts, layouts),
            builtins: move_by(row.builtins, builtins),
            functions: move_by(row.functions, functions),
            first_class: row.first_class + classes,
            range_count: match row.range_count {
                0 => 0,
                count => count + ranges,
            },
            ..row
        }));
        self.strings.append(&mut added.strings);
        self.layouts.append(&mut added.layouts);
        self.builtins.append(&mut added.builtins);
        self.functions.append(&mut added.functions);
        self.classes.append(&mut added.classes);
        self.ranges.append(&mut added.ranges);
    }

    fn truncate(&mut self, length: usize) {
        for row in self.rows.drain(length..).rev() {
            row.strings.forget(&mut self.strings);
            row.layouts.forget(&mut self.layouts);
            row.builtins.forget(&mut self.builtins);
            row.functions.forget(&mut self.functions);
            self.classes.truncate(row.first_class as usize);
            if let Some(kept) = row.range_count.checked_sub(1) {
                self.ranges.truncate(kept as usize);
            }
        }
    }
}

pub struct DistinctTypes {
    stored: StoredTypes,
    hashes: Vec<u64>,
}

impl DistinctTypes {
    pub fn with_capacity(capacity: usize) -> DistinctTypes {
        DistinctTypes {
            stored: StoredTypes::with_capacity(capacity),
            hashes: Vec::with_capacity(capacity),
        }
    }

    pub fn push(&mut self, ty: &Type) {
        debug_assert!(ty.is_normalized());
        self.hashes.push(hash_of_type(ty));
        self.stored.push_copy(&TypeRef::of(ty));
    }
}

#[derive(Clone, Copy)]
pub struct Types<'a> {
    stored: &'a StoredTypes,
    start: usize,
    end: usize,
}

impl<'a> Types<'a> {
    #[inline]
    pub fn len(self) -> usize {
        self.end - self.start
    }

    #[inline(always)]
    pub fn get(self, index: usize) -> TypeRef<'a> {
        debug_assert!(index < self.len());
        self.stored.get(self.start + index)
    }

    #[inline]
    pub fn iter(self) -> TypesIter<'a> {
        TypesIter { left: self }
    }

    pub fn first(self, count: usize) -> Types<'a> {
        let end = self.end.min(self.start + count);
        Types { end, ..self }
    }

    pub fn skip(self, count: usize) -> Types<'a> {
        let start = self.end.min(self.start + count);
        Types { start, ..self }
    }

    pub fn chunks(self, size: usize) -> impl Iterator<Item = Types<'a>> {
        let starts = (self.start..self.end).step_by(size);
        starts.map(move |start| Types { start, ..self }.first(size))
    }

    #[cfg(test)]
    pub fn to_records(self) -> Vec<Type> {
        self.iter().map(TypeRef::to_type).collect()
    }
}

pub struct TypesIter<'a> {
    left: Types<'a>,
}

impl<'a> Iterator for TypesIter<'a> {
    type Item = TypeRef<'a>;

    #[inline(always)]
    fn next(&mut self) -> Option<TypeRef<'a>> {
        if self.left.start == self.left.end {
            return None;
        }
        let ty = self.left.stored.get(self.left.start);
        self.left.start += 1;
        Some(ty)
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.left.len(), Some(self.left.len()))
    }
}

#[derive(Clone)]
pub struct TypeTable {
    stored: StoredTypes,
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
            stored: StoredTypes::with_capacity(Self::WELL_KNOWN_COUNT),
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

    pub fn of_distinct_types(parts: Vec<DistinctTypes>) -> TypeTable {
        let count: usize = parts.iter().map(|part| part.hashes.len()).sum();
        let capacity = count + count / 8;
        let mut stored = StoredTypes::with_capacity(capacity);
        let mut hashes: Vec<u64> = Vec::with_capacity(capacity);
        for mut part in parts {
            stored.append(part.stored);
            hashes.append(&mut part.hashes);
        }
        debug_assert!(
            TypeTable::new()
                .types()
                .iter()
                .eq((0..Self::WELL_KNOWN_COUNT.min(count)).map(|index| stored.get(index))),
            "the well-known types stand first, at their ids"
        );
        let mut type_ids: HashTable<TypeId> = HashTable::with_capacity(capacity);
        for (hash, index) in order_by_place_in_table(&hashes, type_ids.capacity()) {
            let (index, ty) = (index as usize, stored.get(index as usize));
            debug_assert!(ty.references_only_types_below(index));
            debug_assert!(
                type_ids
                    .find(hash, |&id| stored.get(id.index()) == ty)
                    .is_none(),
                "no two types are alike"
            );
            type_ids.insert_unique(hash, TypeId::new(index), |&id| hashes[id.index()]);
        }
        TypeTable {
            stored,
            hashes,
            type_ids,
            spare_union: Type::never(),
        }
    }

    pub fn intern(&mut self, mut ty: Type) -> TypeId {
        normalize_type(self, &mut ty);
        let hash = hash_of_type(&ty);
        if let Some(id) = self.find_hashed(hash, &ty) {
            return id;
        }
        debug_assert!(TypeRef::of(&ty).references_only_types_below(self.len()));
        self.stored.push(ty);
        self.add_hash(hash)
    }

    fn intern_normalized(&mut self, ty: &TypeRef<'_>) -> TypeId {
        debug_assert!(ty.to_type().is_normalized());
        let hash = hash_of_parts(ty);
        let is_equal = |&id: &TypeId| self.get(id) == *ty;
        if let Some(&id) = self.type_ids.find(hash, is_equal) {
            return id;
        }
        self.stored.push_copy(ty);
        self.add_hash(hash)
    }

    pub fn intern_layout(&mut self, layout: LayoutId) -> TypeId {
        self.intern_normalized(&TypeRef {
            layouts: &[layout],
            ..TypeRef::NEVER
        })
    }

    pub fn intern_function(&mut self, function: FunctionId) -> TypeId {
        self.intern_normalized(&TypeRef {
            functions: &[function],
            ..TypeRef::NEVER
        })
    }

    pub(super) fn types_and_spare_union(&mut self) -> (Types<'_>, &mut Type) {
        let (stored, end) = (&self.stored, self.stored.len());
        let types = Types {
            stored,
            start: 0,
            end,
        };
        (types, &mut self.spare_union)
    }

    pub(super) fn intern_spare_union(&mut self) -> TypeId {
        if !normalize_without_table(&mut self.spare_union) {
            let union = core::mem::take(&mut self.spare_union);
            return self.intern(union);
        }
        let hash = hash_of_type(&self.spare_union);
        if let Some(id) = self.find_hashed(hash, &self.spare_union) {
            return id;
        }
        debug_assert!(TypeRef::of(&self.spare_union).references_only_types_below(self.len()));
        self.stored.push_copy(&TypeRef::of(&self.spare_union));
        self.add_hash(hash)
    }

    pub(super) fn add_primitives(&mut self, ty: TypeId, added: Primitives) -> TypeId {
        let current = self.get(ty);
        let primitives = Primitives(current.primitives.0 | added.0);
        if primitives == current.primitives {
            return ty;
        }
        let hash = self.hashes[ty.index()];
        let hash = hash.wrapping_sub(spread_primitives(current.primitives));
        let hash = hash.wrapping_add(spread_primitives(primitives));
        let parts = parts_beside_primitives(&current);
        let is_widened = |&id: &TypeId| {
            let other = self.get(id);
            other.primitives == primitives && parts_beside_primitives(&other) == parts
        };
        if let Some(&id) = self.type_ids.find(hash, is_widened) {
            return id;
        }
        self.stored.push_again(ty.index(), primitives);
        self.add_hash(hash)
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

    fn add_hash(&mut self, hash: u64) -> TypeId {
        let id = TypeId::new(self.hashes.len());
        self.hashes.push(hash);
        let hashes = &self.hashes;
        self.type_ids
            .insert_unique(hash, id, |&id| hashes[id.index()]);
        id
    }

    pub fn truncate(&mut self, length: usize) {
        let length = length.max(Self::WELL_KNOWN_COUNT);
        if self.len() <= length {
            return;
        }
        for (index, &hash) in self.hashes.iter().enumerate().skip(length) {
            let id = TypeId::new(index);
            if let Ok(entry) = self.type_ids.find_entry(hash, |&other| other == id) {
                let _ = entry.remove();
            }
        }
        self.stored.truncate(length);
        self.hashes.truncate(length);
    }

    pub fn with_nullish(&mut self, ty: TypeId) -> TypeId {
        let nullish = Primitives::NULLISH.0;
        if self.get(ty).primitives.0 & nullish == nullish {
            return ty;
        }
        self.union(ty, Self::NULLISH)
    }

    #[inline(always)]
    pub fn get(&self, id: TypeId) -> TypeRef<'_> {
        self.stored.get(id.index())
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.stored.len()
    }

    #[inline]
    pub fn types(&self) -> Types<'_> {
        Types {
            stored: &self.stored,
            start: 0,
            end: self.stored.len(),
        }
    }

    pub(super) fn find_hashed(&self, hash: u64, ty: &Type) -> Option<TypeId> {
        let is_equal = |&id: &TypeId| self.get(id) == *ty;
        self.type_ids.find(hash, is_equal).copied()
    }
}

impl Default for TypeTable {
    fn default() -> TypeTable {
        TypeTable::new()
    }
}

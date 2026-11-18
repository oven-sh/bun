//! Types as the whole process knows them: recursion groups of the same structure are one group.

use core::hash::BuildHasher;
use core::mem::{self, offset_of};
use core::ptr;
use std::hash::RandomState;
use std::sync::{Arc, LazyLock, Weak};

use bun_threading::Guarded;
use hashbrown::HashTable;
use smallvec::SmallVec;

use super::layout::StructLayout;
use super::value::{FieldType, HeapType, StorageType, TypeKind, ValType};
use crate::alloc::{OutOfMemory, TryPush, try_boxed};

pub(super) const NO_SUPERTYPE: u32 = u32::MAX;

/// An index in a group names a member or, from the number of members up, a type outside the group.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(C)]
pub(super) struct Shape {
    pub(super) supertype: u32,
    /// Parameters or fields. An array has one field.
    pub(super) count: u16,
    pub(super) results: u16,
    pub(super) kind: TypeKind,
    pub(super) is_final: bool,
}

/// A type at run time. Its address identifies it, in every module and thread.
///
/// The display holds the addresses of the supertypes from the root down, then that of the type itself. `a` is a
/// subtype of `b` if entry `b.depth` of the display of `a` is `b`.
#[repr(C)]
pub struct Rtt {
    display: [usize; Self::INLINE_DISPLAY_LENGTH as usize],
    long_display_address: usize,
    depth: u32,
    shape: Shape,
    struct_size: u32,
    /// In the values or the fields of the group.
    start: u32,
    element: Option<FieldType>,
    long_display: Box<[usize]>,
    reference_offsets: Box<[u32]>,
}

impl Rtt {
    pub const INLINE_DISPLAY_LENGTH: u32 = 6;
    /// The first entries, 8 bytes each, zero after the last.
    pub const DISPLAY_OFFSET: i32 = offset_of!(Self, display) as i32;
    /// The address of all `depth + 1` entries if they do not fit inline.
    pub const LONG_DISPLAY_OFFSET: i32 = offset_of!(Self, long_display_address) as i32;
    /// 32 bits.
    pub const DEPTH_OFFSET: i32 = offset_of!(Self, depth) as i32;
    /// A [`TypeKind`], 8 bits.
    pub const KIND_OFFSET: i32 = offset_of!(Self, shape.kind) as i32;
    /// 0 or 1, 8 bits.
    pub const IS_FINAL_OFFSET: i32 = offset_of!(Self, shape.is_final) as i32;

    #[inline]
    pub fn address(&self) -> usize {
        ptr::from_ref(self).expose_provenance()
    }

    #[inline]
    pub fn kind(&self) -> TypeKind {
        self.shape.kind
    }

    #[inline]
    pub fn is_final(&self) -> bool {
        self.shape.is_final
    }

    /// The number of supertypes.
    #[inline]
    pub fn depth(&self) -> u32 {
        self.depth
    }

    #[inline]
    pub fn is_subtype_of(&self, other: &Self) -> bool {
        self.display().get(other.depth as usize) == Some(&other.address())
    }

    /// Of the payload of a struct.
    #[inline]
    pub fn struct_size(&self) -> u32 {
        self.struct_size
    }

    /// Of the fields of a struct that hold references.
    #[inline]
    pub fn reference_offsets(&self) -> &[u32] {
        &self.reference_offsets
    }

    /// For an array. In place of a defined type it has the closest abstract one.
    #[inline]
    pub fn element(&self) -> Option<FieldType> {
        self.element
    }

    #[inline]
    fn display(&self) -> &[usize] {
        if self.depth < Self::INLINE_DISPLAY_LENGTH {
            &self.display[..=self.depth as usize]
        } else {
            &self.long_display
        }
    }

    fn new(shape: Shape, start: usize, fields: &[FieldType]) -> Result<Self, OutOfMemory> {
        let mut layout = StructLayout::default();
        let mut reference_offsets = Vec::new();
        let mut element = None;
        match shape.kind {
            TypeKind::Func => {}
            TypeKind::Struct => {
                let references = fields.iter().filter(|field| field.storage.is_ref());
                reference_offsets.try_reserve_exact(references.count())?;
                for field in fields {
                    let offset = layout.place(field.storage.log2_size());
                    if field.storage.is_ref() {
                        reference_offsets.push(offset);
                    }
                }
            }
            TypeKind::Array => {
                let bits = erased(fields[0].storage.as_value_bits());
                element = Some(FieldType {
                    storage: StorageType::from_value_bits(bits),
                    mutable: fields[0].mutable,
                });
            }
        }
        Ok(Self {
            display: Default::default(),
            long_display_address: 0,
            depth: 0,
            shape,
            struct_size: layout.size(),
            start: start as u32,
            element,
            long_display: Box::default(),
            reference_offsets: reference_offsets.into_boxed_slice(),
        })
    }

    /// `self` is where it stays.
    fn set_display(&mut self, supertypes: &[usize]) -> Result<(), OutOfMemory> {
        let address = self.address();
        let entry = |i: usize| supertypes.get(i).copied().unwrap_or(address);
        let length = supertypes.len() + 1;
        self.depth = supertypes.len() as u32;
        for (i, slot) in self.display.iter_mut().enumerate().take(length) {
            *slot = entry(i);
        }
        if length > self.display.len() {
            self.long_display = try_boxed((0..length).map(entry))?;
            self.long_display_address = self.long_display.as_ptr().expose_provenance();
        }
        Ok(())
    }
}

fn erased(ty: ValType) -> ValType {
    match ty.as_ref() {
        Some(reference) => ty.with_heap_type(HeapType::of(reference.heap_type().abstract_type())),
        None => ty,
    }
}

pub(super) struct RecGroup {
    hash: u64,
    members: Box<[Rtt]>,
    values: Box<[ValType]>,
    fields: Box<[FieldType]>,
    /// In the order of their first use.
    outside: Box<[CanonicalType]>,
}

impl RecGroup {
    #[inline]
    pub(super) fn rtt(&self, member: u32) -> &Rtt {
        &self.members[member as usize]
    }

    /// Unlike the address of the group, it survives a move.
    fn identity(&self) -> usize {
        self.members.as_ptr().addr()
    }
}

impl Drop for RecGroup {
    fn drop(&mut self) {
        REGISTRY.remove(self);
        // Groups can depend on each other in chains too long for recursion.
        let mut released = mem::take(&mut self.outside).into_vec();
        while let Some(ty) = released.pop() {
            if let Some(mut group) = Arc::into_inner(ty.group) {
                let more = mem::take(&mut group.outside);
                if released.try_reserve(more.len()).is_ok() {
                    released.extend(more);
                } else {
                    Box::leak(more);
                }
            }
        }
    }
}

/// The structure of a group that may exist already.
#[derive(Default)]
pub(super) struct Candidate {
    shapes: Vec<Shape>,
    values: Vec<ValType>,
    fields: Vec<FieldType>,
    outside: Vec<usize>,
}

impl Candidate {
    pub(super) fn clear(&mut self) {
        self.shapes.clear();
        self.values.clear();
        self.fields.clear();
        self.outside.clear();
    }

    pub(super) fn push_shape(&mut self, shape: Shape) -> Result<(), OutOfMemory> {
        self.shapes.try_push(shape)
    }

    pub(super) fn push_value(&mut self, ty: ValType) -> Result<(), OutOfMemory> {
        self.values.try_push(ty)
    }

    pub(super) fn push_field(&mut self, ty: FieldType) -> Result<(), OutOfMemory> {
        self.fields.try_push(ty)
    }

    pub(super) fn push_outside(&mut self, rtt: &Rtt) -> Result<(), OutOfMemory> {
        self.outside.try_push(rtt.address())
    }

    pub(super) fn hash(&self) -> u64 {
        let [seed, multiplier] = REGISTRY.keys;
        let shapes = self.shapes.iter().flat_map(|shape| {
            let kind = u64::from(shape.kind as u8) << 1 | u64::from(shape.is_final);
            let counts = u64::from(shape.count) << 16 | u64::from(shape.results);
            [kind << 32 | counts, shape.supertype.into()]
        });
        let values = self.values.iter().map(|ty| ty.bits().into());
        let fields = self.fields.iter().map(|field| {
            u64::from(field.storage.as_value_bits().bits()) << 1 | u64::from(field.mutable)
        });
        let outside = self.outside.iter().map(|&address| address as u64);
        let words = shapes.chain(values).chain(fields).chain(outside);
        words.fold(seed, |hash, word| {
            let product = u128::from(hash ^ word) * u128::from(multiplier);
            product as u64 ^ (product >> 64) as u64
        })
    }

    /// The group is valid and not empty. `outside` finds an outside type by its number.
    pub(super) fn intern<'a>(
        &self,
        hash: u64,
        outside: impl Fn(usize) -> (&'a Arc<RecGroup>, u32),
    ) -> Result<Arc<RecGroup>, OutOfMemory> {
        // Released after the lock, which the drop of a group takes.
        let mut upgraded = SmallVec::<[Arc<RecGroup>; 1]>::new();
        let mut entries = REGISTRY.entries.lock();
        let found = entries.find(hash, |entry| {
            let group = (entry.hash == hash).then(|| entry.group.upgrade());
            group.flatten().is_some_and(|group| {
                let equal = self.describes(&group);
                upgraded.push(group);
                equal
            })
        });
        if found.is_some() {
            return Ok(upgraded.pop().expect("the group that was found"));
        }

        let rehash = |entry: &Entry| entry.hash;
        entries.try_reserve(1, rehash).map_err(|_| OutOfMemory)?;
        let group = Arc::new(self.build(hash, outside)?);
        let entry = Entry {
            hash,
            identity: group.identity(),
            group: Arc::downgrade(&group),
        };
        entries.insert_unique(hash, entry, rehash);
        Ok(group)
    }

    pub(super) fn describes(&self, group: &RecGroup) -> bool {
        let shapes = group.members.iter().map(|member| member.shape);
        let outside = group.outside.iter().map(|ty| ty.rtt().address());
        *self.values == *group.values
            && *self.fields == *group.fields
            && self.shapes.iter().copied().eq(shapes)
            && self.outside.iter().copied().eq(outside)
    }

    fn build<'a>(
        &self,
        hash: u64,
        outside: impl Fn(usize) -> (&'a Arc<RecGroup>, u32),
    ) -> Result<RecGroup, OutOfMemory> {
        let outside = try_boxed((0..self.outside.len()).map(|number| {
            let (group, member) = outside(number);
            CanonicalType::new(Arc::clone(group), member)
        }))?;

        let mut members = Vec::new();
        members.try_reserve_exact(self.shapes.len())?;
        let (mut values_end, mut fields_end) = (0, 0);
        for &shape in &self.shapes {
            let count = usize::from(shape.count);
            if shape.kind == TypeKind::Func {
                members.push(Rtt::new(shape, values_end, &[])?);
                values_end += count + usize::from(shape.results);
            } else {
                let fields = &self.fields[fields_end..][..count];
                members.push(Rtt::new(shape, fields_end, fields)?);
                fields_end += count;
            }
        }

        let mut members = members.into_boxed_slice();
        for i in 0..self.shapes.len() {
            let (earlier, rest) = members.split_at_mut(i);
            let supertypes = match self.shapes[i].supertype {
                NO_SUPERTYPE => &[],
                index => match earlier.get(index as usize) {
                    Some(member) => member.display(),
                    None => outside[index as usize - self.shapes.len()].rtt().display(),
                },
            };
            rest[0].set_display(supertypes)?;
        }

        Ok(RecGroup {
            hash,
            members,
            values: try_boxed(self.values.iter().copied())?,
            fields: try_boxed(self.fields.iter().copied())?,
            outside,
        })
    }
}

struct Entry {
    hash: u64,
    identity: usize,
    group: Weak<RecGroup>,
}

struct Registry {
    /// Of the hash, and different in each process.
    keys: [u64; 2],
    entries: Guarded<HashTable<Entry>>,
}

static REGISTRY: LazyLock<Registry> = LazyLock::new(|| Registry {
    keys: [0, 1].map(|i| RandomState::new().hash_one(i) | 1),
    entries: Guarded::new(HashTable::new()),
});

impl Registry {
    fn remove(&self, group: &RecGroup) {
        let mut entries = self.entries.lock();
        let entry = entries.find_entry(group.hash, |entry| entry.identity == group.identity());
        entry.ok().expect("a registered group").remove();
        let mut smaller = HashTable::new();
        let rehash = |entry: &Entry| entry.hash;
        if entries.capacity() > 1024.max(entries.len() * 8)
            && smaller.try_reserve(entries.len() * 2, rehash).is_ok()
        {
            for entry in mem::take(&mut *entries) {
                smaller.insert_unique(entry.hash, entry, rehash);
            }
            *entries = smaller;
        }
    }
}

/// How many recursion groups are alive.
pub fn canonical_group_count() -> usize {
    REGISTRY.entries.lock().len()
}

/// Keeps a defined type alive, whatever becomes of the module it came from.
#[derive(Clone)]
pub struct CanonicalType {
    group: Arc<RecGroup>,
    member: u32,
}

impl CanonicalType {
    pub(super) fn new(group: Arc<RecGroup>, member: u32) -> Self {
        Self { group, member }
    }

    /// The final type of functions with this signature, which names no defined type.
    pub fn function(params: &[ValType], results: &[ValType]) -> Result<Self, OutOfMemory> {
        let mut candidate = Candidate::default();
        candidate.push_shape(Shape {
            supertype: NO_SUPERTYPE,
            count: u16::try_from(params.len()).map_err(|_| OutOfMemory)?,
            results: u16::try_from(results.len()).map_err(|_| OutOfMemory)?,
            kind: TypeKind::Func,
            is_final: true,
        })?;
        for &ty in params.iter().chain(results) {
            assert!(ty.defined_index().is_none());
            candidate.push_value(ty)?;
        }
        let group = candidate.intern(candidate.hash(), |_| unreachable!())?;
        Ok(Self::new(group, 0))
    }

    #[inline]
    pub fn rtt(&self) -> &Rtt {
        self.group.rtt(self.member)
    }

    /// Of a function.
    pub fn params(&self) -> impl ExactSizeIterator<Item = CanonicalValType> {
        self.values(0, self.rtt().shape.count)
    }

    /// Of a function.
    pub fn results(&self) -> impl ExactSizeIterator<Item = CanonicalValType> {
        let shape = self.rtt().shape;
        self.values(shape.count, shape.results)
    }

    /// Of a struct, in its payload.
    pub fn field_offsets(&self) -> impl Iterator<Item = u32> {
        let (rtt, mut layout) = (self.rtt(), StructLayout::default());
        assert!(rtt.kind() == TypeKind::Struct);
        let fields = &self.group.fields[rtt.start as usize..][..usize::from(rtt.shape.count)];
        (fields.iter()).map(move |field| layout.place(field.storage.log2_size()))
    }

    fn values(&self, skip: u16, count: u16) -> impl ExactSizeIterator<Item = CanonicalValType> {
        let rtt = self.rtt();
        assert!(rtt.kind() == TypeKind::Func);
        let start = rtt.start as usize + usize::from(skip);
        let values = &self.group.values[start..][..usize::from(count)];
        values.iter().map(|&ty| {
            let defined = ty.defined_index().map(|index| {
                match index.usize().checked_sub(self.group.members.len()) {
                    Some(number) => self.group.outside[number].clone(),
                    None => Self::new(Arc::clone(&self.group), index.0),
                }
            });
            CanonicalValType::new(ty, defined)
        })
    }
}

impl PartialEq for CanonicalType {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        ptr::eq(self.rtt(), other.rtt())
    }
}

impl Eq for CanonicalType {}

/// A value type that means the same in every module.
#[derive(Clone, PartialEq, Eq)]
pub struct CanonicalValType {
    erased: ValType,
    defined: Option<CanonicalType>,
}

impl CanonicalValType {
    pub(super) fn new(ty: ValType, defined: Option<CanonicalType>) -> Self {
        Self {
            erased: erased(ty),
            defined,
        }
    }

    /// `ty` names no defined type.
    pub fn plain(ty: ValType) -> Self {
        assert!(ty.defined_index().is_none());
        Self::new(ty, None)
    }

    /// In place of a defined type it has the closest abstract one.
    #[inline]
    pub fn erased(&self) -> ValType {
        self.erased
    }

    #[inline]
    pub fn defined(&self) -> Option<&CanonicalType> {
        self.defined.as_ref()
    }

    pub fn is_subtype_of(&self, other: &Self) -> bool {
        let erased_fits = || {
            self.erased
                .is_subtype_of(other.erased, |_, _| unreachable!())
        };
        match (&self.defined, &other.defined) {
            (_, None) => erased_fits(),
            (Some(sub), Some(sup)) => erased_fits() && sub.rtt().is_subtype_of(sup.rtt()),
            (None, Some(_)) => {
                let is_bottom = |heap: HeapType| heap.is(heap.abstract_type().bottom());
                erased_fits()
                    && self
                        .erased
                        .as_ref()
                        .is_some_and(|ty| is_bottom(ty.heap_type()))
            }
        }
    }
}

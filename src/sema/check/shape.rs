//! The members of an object type: properties, signatures, index signatures.

use super::instantiate::PropInstantiation;
use super::relate::Ternary;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, SymbolId};
use crate::table::Handle;
use crate::util::{PositionSet, SharedSort, in_order_of_decimal_text};
use smallvec::{SmallVec, smallvec};

#[path = "unlisted_intersections.rs"]
mod unlisted;
use unlisted::Constituents;
pub(super) use unlisted::UnlistedIntersections;

#[path = "sibling_intersections.rs"]
mod siblings;
pub(super) use siblings::SiblingIntersections;
use siblings::{FactsOfName, Holder};

/// `thisAssignmentDeclarationKind`, with its location.
#[derive(Copy, Clone)]
pub(super) enum ThisAssignmentDeclaration {
    None,
    Typed(TypeNodeId),
    Constructor(FnId),
    Method,
}

/// A property declaration without a type annotation.
#[derive(Copy, Clone)]
pub(super) enum UntypedProperty {
    Member(MemberId),
    /// `f.name = value`, `this.name = value`, or `Object.defineProperty(f, "name", descriptor)`.
    Assignment(ExprId),
}

/// Hash index from name to position in a property list. Only used for more than `FEW` properties.
/// Shorter lists are scanned linearly. `P` is the storage: arena memory for the index stored with a
/// shape, a box for a `Builder`'s index.
#[derive(Default)]
struct Names<P> {
    /// Each slot is 0 or a property's position plus one. The length is a power of two, at least
    /// twice the number of properties.
    slots: P,
}

const FEW: usize = 8;

impl<'s> Names<ArenaBox<'s, [u32]>> {
    /// The flag is `add_all`'s result, or `true` for a list too short to have an index.
    fn of(props: &[Prop<'s>], arena: &'s Arena) -> (Self, bool) {
        if props.len() <= FEW {
            return (Names::default(), true);
        }
        let slots = std::iter::repeat_n(0, (props.len() * 2).next_power_of_two());
        let mut names = Self {
            slots: ArenaBox::from_iter_in(slots, arena),
        };
        let are_distinct = names.add_all(props);
        (names, are_distinct)
    }
}

impl Names<Box<[u32]>> {
    fn with_capacity(count: usize) -> Self {
        Names {
            slots: vec![0; (count * 2).next_power_of_two()].into_boxed_slice(),
        }
    }
}

impl<P: std::ops::DerefMut<Target = [u32]>> Names<P> {
    #[inline]
    fn first_slot(&self, name: Atom) -> usize {
        (u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize
            & (self.slots.len() - 1)
    }

    /// The position of the first property in `props` named `name`. All of `props` must have been
    /// added.
    #[inline]
    fn find(&self, props: &[Prop], name: Atom) -> Option<usize> {
        let mut slot = self.first_slot(name);
        loop {
            let at = (self.slots[slot] as usize).checked_sub(1)?;
            if props[at].name == name {
                return Some(at);
            }
            slot = (slot + 1) & (self.slots.len() - 1);
        }
    }

    /// Adds `props[at]`. Returns `false` without adding it if a property with its name already
    /// exists.
    fn add(&mut self, props: &[Prop], at: usize) -> bool {
        let name = props[at].name;
        let mut slot = self.first_slot(name);
        while let Some(other) = (self.slots[slot] as usize).checked_sub(1) {
            if props[other].name == name {
                return false;
            }
            slot = (slot + 1) & (self.slots.len() - 1);
        }
        self.slots[slot] = at as u32 + 1;
        true
    }

    /// Returns `false` if two of `props` have the same name.
    fn add_all(&mut self, props: &[Prop]) -> bool {
        let mut are_distinct = true;
        for at in 0..props.len() {
            are_distinct &= self.add(props, at);
        }
        are_distinct
    }
}

/// Two cache lines. The fields a lookup by name reads are in the first.
#[repr(C, align(64))]
pub struct Resolved<'s> {
    names: Names<ArenaBox<'s, [u32]>>,
    pub shape: Listed<'s>,
    /// `isWeakType` of an object type with these members: it has properties, all of them optional, and nothing else.
    is_weak: bool,
    /// Only meaningful with more than `FEW` properties: true if all their names are distinct.
    has_distinct_names: bool,
}

/// Every field is listed so that adding one is a compile error. The fields other than `shape` are derived from it, so
/// they aren't visited.
impl crate::types::Follow for Resolved<'_> {
    fn visit<V: crate::types::Visitor>(&self, visitor: &mut V) {
        let Resolved {
            shape,
            names: _,
            is_weak: _,
            has_distinct_names: _,
        } = self;
        shape.visit(visitor);
    }
}

impl<'s> Resolved<'s> {
    fn new(shape: Shape<'s>) -> Resolved<'s> {
        let arena: &'s Arena = shape.props.allocator();
        Resolved::of(shape.into(), arena)
    }

    fn of(shape: Listed<'s>, arena: &'s Arena) -> Resolved<'s> {
        let (names, has_distinct_names) = Names::of(&shape.props, arena);
        let is_weak = Resolved::is_weak_shape(&shape);
        Resolved {
            names,
            is_weak,
            has_distinct_names,
            shape,
        }
    }

    /// True if all property names are distinct.
    fn has_distinct_names(&self) -> bool {
        let props = &self.shape.props;
        if props.len() > FEW {
            return self.has_distinct_names;
        }
        (1..props.len()).all(|at| !props[..at].iter().any(|it| it.name == props[at].name))
    }

    pub(super) fn is_weak_shape(shape: &Listed) -> bool {
        let is_optional = |prop: &Prop| prop.flags.contains(PropFlags::OPTIONAL);
        !shape.props.is_empty()
            && shape.call.is_empty()
            && shape.construct.is_empty()
            && shape.index.is_empty()
            && shape.props.iter().all(is_optional)
    }

    #[inline]
    pub(super) fn is_weak(&self) -> bool {
        self.is_weak
    }

    /// True if the two have a property name in common. Looks up the names of the one with fewer properties in the
    /// other.
    fn shares_a_name_with(&self, other: &Self) -> bool {
        let (few, many) = match self.shape.props.len() < other.shape.props.len() {
            true => (self, other),
            false => (other, self),
        };
        let mut few = few.shape.props.iter();
        few.any(|prop| many.prop(prop.name).is_some())
    }

    #[inline]
    pub fn prop(&self, name: Atom) -> Option<&Prop<'s>> {
        self.position(name).map(|at| &self.shape.props[at])
    }

    #[inline]
    fn position(&self, name: Atom) -> Option<usize> {
        let props = &self.shape.props;
        if props.len() > FEW {
            return self.names.find(props, name);
        }
        props.iter().position(|p| p.name == name)
    }
}

/// The members of a type: a shape shared by instantiations, and the mapper of this instantiation.
#[derive(Copy, Clone)]
pub struct Members<'p> {
    pub resolved: &'p Resolved<'p>,
    pub mapper: MapperId,
}

impl<'p> Members<'p> {
    #[inline]
    pub fn shape(&self) -> &'p Listed<'p> {
        &self.resolved.shape
    }

    /// Don't call this or the next two on the `members` of an intersection. See `structured`.
    #[inline]
    pub fn index_infos(&self) -> &'p [IndexInfo] {
        debug_assert!(self.shape().properties_of().is_none());
        &self.shape().index
    }

    #[inline]
    pub fn call_signatures(&self) -> &'p [SigId] {
        debug_assert!(self.shape().properties_of().is_none());
        &self.shape().call
    }

    #[inline]
    pub fn construct_signatures(&self) -> &'p [SigId] {
        debug_assert!(self.shape().properties_of().is_none());
        &self.shape().construct
    }

    /// True if there's a call or construct signature. Also valid for the `members` of an intersection.
    #[inline]
    pub fn has_signatures(&self) -> bool {
        !(self.shape().call.is_empty() && self.shape().construct.is_empty())
    }

    /// See `has_signatures`.
    #[inline]
    pub fn has_signatures_of_kind(&self, construct: bool) -> bool {
        match construct {
            true => !self.shape().construct.is_empty(),
            false => !self.shape().call.is_empty(),
        }
    }

    /// The shape, for a caller that needs all the members. Not for an intersection.
    #[inline]
    pub fn whole_shape(&self) -> &'p Listed<'p> {
        debug_assert!(self.shape().properties_of().is_none());
        self.shape()
    }

    /// The first call signature and the first construct signature. See `has_signatures`.
    #[inline]
    fn first_signatures(&self) -> [Option<SigId>; 2] {
        let shape = self.shape();
        [
            shape.call.first().copied(),
            shape.construct.first().copied(),
        ]
    }
}

pub(super) const RECENT_MEMBERS: usize = 512;

/// A type, and its entry in `Program::members`.
#[derive(Copy, Clone)]
pub(super) struct RecentMembers<'p> {
    resolved: Option<&'p Resolved<'p>>,
    ty: TypeId,
    mapper: MapperId,
}

impl<'p> RecentMembers<'p> {
    pub(super) const NONE: RecentMembers<'p> = RecentMembers {
        resolved: None,
        ty: TypeId(u32::MAX),
        mapper: MapperId::IDENTITY,
    };
}

/// `Members` as cached for a type: the shape's handle and the mapper.
#[derive(Copy, Clone)]
pub(super) struct CachedMembers {
    /// A handle into `Program::shapes`.
    shape: Handle,
    mapper: MapperId,
}

crate::types::follow_struct!(CachedMembers { shape, mapper });

impl CachedMembers {
    /// For publishing, which replaces the handle with the published shape's.
    pub(super) fn shape_mut(&mut self) -> &mut Handle {
        &mut self.shape
    }
}

/// A shape, and its handle in the store if it's final.
#[derive(Copy, Clone)]
struct Built<'p> {
    resolved: &'p Resolved<'p>,
    store_handle: Option<Handle>,
}

/// The kind of result a property lookup by name produced.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Found {
    Property,
    /// There's no such property, but an index signature applies.
    ByIndex,
}

/// Where `getPropertyOfTypeEx` looks up a name in a type. This is the part it computes before it uses the name.
#[derive(Copy, Clone)]
pub(super) enum PropertyHolder<'p> {
    /// `getReducedApparentType` of the type is this union.
    Union(TypeId),
    /// `getReducedApparentType` of the type is this type, with these members.
    Members(TypeId, Members<'p>),
    /// It's this intersection, whose properties aren't listed. See check/unlisted_intersections.rs.
    Unlisted(TypeId),
    /// It has no members.
    Nothing,
}

/// A property of an intersection's constituent, and the mapper of the constituent's members. Two are equal if both
/// parts are.
#[derive(Copy, Clone)]
struct PropOfConstituent<'a>(&'a Prop<'a>, MapperId);

impl PartialEq for PropOfConstituent<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.1 == other.1 && (std::ptr::eq(self.0, other.0) || self.0 == other.0)
    }
}

impl Eq for PropOfConstituent<'_> {}

impl std::hash::Hash for PropOfConstituent<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, hasher: &mut H) {
        hasher.write_u32(self.1.0);
        self.0.hash_without_lists(hasher);
    }
}

/// A property list of at least this length that's searched once per constituent of a union or intersection is mirrored
/// in a hash set.
pub(super) const LONG_PROP_LIST: usize = 8;

/// An intersection's members are compared pairwise only up to this many, since the number of pairs grows quadratically.
const FEW_MEMBERS: usize = 8;

/// The property names of an intersection's members, in `getPropertiesOfUnionOrIntersectionType` order, and which
/// members have each name. Looking up every name in every member would take names times members lookups, each a cache
/// miss. So the properties are read once, in memory order.
struct SharedNames {
    /// For each name, the end of its range in `holders`.
    ends: Vec<u32>,
    /// The members that have the name, in order, each with the position of its first property of that name.
    holders: Vec<(u32, u32)>,
}

impl SharedNames {
    fn of(all: &[Members]) -> SharedNames {
        const DUPLICATE_IN_MEMBER: u32 = u32::MAX;
        let mut name_indexes = FxHashMap::<Atom, u32>::default();
        // For each property, the index of its name.
        let mut found: Vec<u32> = Vec::new();
        // For each name, the last member seen that has it, and the number of members that have it.
        let mut last_holders: Vec<u32> = Vec::new();
        let mut ends: Vec<u32> = Vec::new();
        for (at, member) in all.iter().enumerate() {
            let at = at as u32;
            for prop in &member.shape().props {
                let next = ends.len() as u32;
                let name_index = *name_indexes.entry(prop.name).or_insert(next);
                if name_index == next {
                    ends.push(1);
                    last_holders.push(at);
                    found.push(name_index);
                } else if last_holders[name_index as usize] == at {
                    found.push(DUPLICATE_IN_MEMBER);
                } else {
                    ends[name_index as usize] += 1;
                    last_holders[name_index as usize] = at;
                    found.push(name_index);
                }
            }
        }
        let mut start = 0;
        for end in &mut ends {
            start += std::mem::replace(end, start);
        }
        let mut holders = vec![(0, 0); start as usize];
        let mut found = found.into_iter();
        for (at, member) in all.iter().enumerate() {
            for (position, name_index) in (0..member.shape().props.len()).zip(&mut found) {
                if name_index != DUPLICATE_IN_MEMBER {
                    let next = &mut ends[name_index as usize];
                    holders[*next as usize] = (at as u32, position as u32);
                    *next += 1;
                }
            }
        }
        SharedNames { ends, holders }
    }

    /// The holders of each name that more than one member has.
    fn iter(&self) -> impl Iterator<Item = &[(u32, u32)]> {
        let mut start = 0;
        let holder_ranges = self.ends.iter().map(move |&end| {
            let name_holders = &self.holders[start..end as usize];
            start = end as usize;
            name_holders
        });
        holder_ranges.filter(|name_holders| name_holders.len() > 1)
    }
}

/// How the looked-up property is used (`getAssignmentTargetKind`, `accessKind`).
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Access {
    Read,
    /// `IsWriteOnlyAccess`
    Written,
}

/// Selects the instance or static members of a declaration. Only a class has a static side
/// (`declareClassMember`).
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ClassSide {
    Instance,
    Static,
}

/// How far `getResolvedMembersOrExportsOfSymbol` has progressed on a declaration's members.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum MemberBinding {
    /// `earlySymbols`: only the members the binder can name, without checking any expression.
    Early,
    /// Also the members with late-bound names.
    Late,
}

/// How far `resolveAnonymousTypeMembers` has progressed on a class or enum used as a value.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(super) enum MembersInPlace {
    /// `setStructuredTypeMembers(t, nil, nil, nil, nil)`: a type literal, until it has returned.
    Empty,
    /// `setStructuredTypeMembers(t, members, nil, nil, nil)` with `getExportsOfSymbol(symbol)`.
    Exports,
    /// .. and with the properties of the base constructor type.
    Inherited,
    /// `d.indexInfos = indexInfos`
    IndexInfos,
    /// `d.signatures`: it has returned.
    Signatures,
}

/// See `Checker::index_infos_in_instantiation`.
pub(super) struct IndexInfosInInstantiation {
    /// The type whose members are being resolved.
    pub(super) ty: TypeId,
    /// The results of `instantiate` since `instantiateIndexInfos` began, each with a flag for
    /// whether it read members that were in place. Older results aren't read, because `ty` counts
    /// as `{}` in the meantime and tsgo's only instantiation cache is that of the active mappers.
    pub(super) instantiations: FxHashMap<(TypeId, MapperId), (TypeId, bool)>,
    /// Only used in the outermost entry: the number of `Checker::members_in_place_hits` that were
    /// hits on a type in this stack (`note_no_members_in_place`).
    hits: u64,
}

/// A call of `resolveDeclaredMembers`. See `Checker::declared_index_infos_in_progress`.
#[derive(Copy, Clone)]
pub(super) struct Declaring {
    /// `t.symbol`
    symbol: Sym,
    /// `t` of the calling `resolveObjectTypeMembers`.
    resolving: Option<TypeId>,
}

/// Selects whether a class or interface shape includes the members of its base types
/// (`resolveObjectTypeMembers`) or only the ones it declares (`resolveDeclaredMembers`).
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum BaseMembers {
    Omitted,
    Inherited,
}

/// `partialMatch` of `compareSignaturesIdentical`: a target with no fewer required parameters than
/// the source matches too.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum PartialMatch {
    No,
    Yes,
}

/// `ignoreThisTypes` of `compareSignaturesIdentical`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum IgnoreThisTypes {
    No,
    Yes,
}

/// `ignoreReturnTypes` of `compareSignaturesIdentical`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum IgnoreReturnTypes {
    No,
    Yes,
}

/// The arguments of `get_spread_symbol` other than the property.
#[derive(Copy, Clone)]
pub(super) struct SpreadSymbolOptions {
    /// The type the property belongs to.
    pub(super) owner: TypeId,
    /// `has_type_variables(owner)`
    pub(super) owner_is_generic: bool,
    /// `readonly` of `getSpreadSymbol`.
    pub(super) readonly: bool,
    /// The caller calls `getTypeOfSymbol` for the result.
    pub(super) resolves: bool,
}

/// Collects properties by name, in the order they are first seen.
struct Builder<'s> {
    shape: Shape<'s>,
    /// Position of each property, while there are more than `FEW`. Empty otherwise.
    names: Names<Box<[u32]>>,
    /// `lateBindIndexSignature`: the members whose computed name doesn't name a property, from
    /// every declaration added so far. `add_index_signatures_of_computed_names` consumes them once
    /// all the members are in place.
    computed_names: Vec<(FileId, MemberId)>,
    /// True if the member table also contains a symbol that isn't a property but has an ordinary
    /// name: a type parameter, a constructor, a signature, a type that a merged namespace exports.
    has_non_property_symbols: bool,
    /// The call of `resolveDeclaredMembers` that collects them.
    declaring: Option<Declaring>,
}

impl<'s> Builder<'s> {
    fn new_in(arena: &'s Arena) -> Builder<'s> {
        Builder {
            shape: Shape::new_in(arena),
            names: Names::default(),
            computed_names: Vec::new(),
            has_non_property_symbols: false,
            declaring: None,
        }
    }
    /// A builder that adds to `shape`.
    fn of(shape: Shape<'s>, arena: &'s Arena) -> Builder<'s> {
        let mut b = Builder {
            shape,
            ..Builder::new_in(arena)
        };
        if b.shape.props.len() > FEW {
            b.reserve_names(b.shape.props.len());
        }
        b
    }
    #[inline]
    fn position(&self, name: Atom) -> Option<usize> {
        if self.shape.props.len() <= FEW {
            return self.shape.props.iter().position(|p| p.name == name);
        }
        self.names.find(&self.shape.props, name)
    }
    #[inline]
    fn has(&self, name: Atom) -> bool {
        self.position(name).is_some()
    }
    fn reserve(&mut self, more: usize) {
        self.shape.props.reserve_exact(more);
        let all = self.shape.props.len() + more;
        if all > FEW && all * 2 > self.names.slots.len() {
            self.reserve_names(all);
        }
    }
    /// Rebuilds `names` with capacity for `count` properties.
    fn reserve_names(&mut self, count: usize) {
        self.names = Names::with_capacity(count);
        if self.shape.props.len() > FEW {
            self.names.add_all(&self.shape.props);
        }
    }
    fn add(&mut self, prop: Prop<'s>) {
        match self.position(prop.name) {
            Some(i) => self.shape.props[i] = prop,
            None => self.add_new(prop),
        }
    }
    /// Adds a property whose name isn't present yet.
    fn add_new(&mut self, prop: Prop<'s>) {
        self.shape.props.push(prop);
        let count = self.shape.props.len();
        if count <= FEW {
            return;
        }
        if count * 2 > self.names.slots.len() {
            self.reserve_names(count * 2);
        } else if count == FEW + 1 {
            self.names.add_all(&self.shape.props);
        } else {
            self.names.add(&self.shape.props, count - 1);
        }
    }
    fn remove(&mut self, name: Atom) {
        let Some(i) = self.position(name) else {
            return;
        };
        self.shape.props.remove(i);
        // The properties after it have shifted.
        if self.shape.props.len() >= FEW {
            self.names.slots.fill(0);
            if self.shape.props.len() > FEW {
                self.names.add_all(&self.shape.props);
            }
        }
    }
}

/// Collects the properties of an intersection's constituents by name. This is the first loop of
/// `createUnionOrIntersectionProperty`, run for every name at once.
struct IntersectionBuilder<'s> {
    b: Builder<'s>,
    /// For each name that several members have, the properties with that name, starting with the
    /// one in `b`. A property's type is resolved lazily, because with `this` bound to the whole
    /// intersection it can depend on the intersection's other properties.
    lists: Vec<Vec<Prop<'s>, &'s Arena>>,
    /// The contents of the long lists: a list's index, and `hash_for_is_own` of a property in it. An intersection can
    /// have hundreds of members with a property of the same name.
    in_long_lists: crate::util::FxHashSet<(usize, u64)>,
}

impl<'s> IntersectionBuilder<'s> {
    fn new_in(arena: &'s Arena) -> IntersectionBuilder<'s> {
        IntersectionBuilder {
            b: Builder::new_in(arena),
            lists: Vec::new(),
            in_long_lists: Default::default(),
        }
    }

    /// `own` is a constituent's property, instantiated with the mapper of the constituent's
    /// members.
    fn add(&mut self, own: Prop<'s>, arena: &'s Arena) {
        let IntersectionBuilder {
            b,
            lists,
            in_long_lists,
        } = self;
        // A spread reuses the symbol itself (`getSpreadSymbol`) with different `PropFlags`. If the
        // modifiers differ, the two are combined and get the declaration's modifiers.
        let modifiers =
            PropFlags::PRIVATE | PropFlags::PROTECTED | PropFlags::READONLY | PropFlags::OPTIONAL;
        let is_own = |other: &Prop| {
            *other == own
                || matches!(own.source, PropSource::Symbol(_))
                    && (&other.source, other.mapper) == (&own.source, own.mapper)
                    && other.flags & modifiers == own.flags & modifiers
        };
        // Two properties that satisfy `is_own` have equal hashes.
        let hash_for_is_own = |prop: &Prop| match prop.source {
            PropSource::Symbol(_) => {
                crate::util::fx_hash(&(&prop.source, prop.mapper, prop.flags & modifiers))
            }
            _ => prop.fx_hash_without_lists(),
        };
        match b.position(own.name) {
            // The same property reached through two paths is added once.
            Some(i) => {
                if lists[i].is_empty() {
                    if !is_own(&b.shape.props[i]) {
                        lists[i].reserve_exact(2);
                        lists[i].push(b.shape.props[i].clone_in(arena));
                        lists[i].push(own);
                    }
                } else if lists[i].len() < LONG_PROP_LIST {
                    if !lists[i].iter().any(is_own) {
                        lists[i].push(own);
                    }
                } else {
                    if lists[i].len() == LONG_PROP_LIST {
                        let hashes = lists[i].iter().map(|it| (i, hash_for_is_own(it)));
                        in_long_lists.extend(hashes);
                    }
                    // A new hash means a new property. Otherwise the list has to be searched.
                    if in_long_lists.insert((i, hash_for_is_own(&own)))
                        || !lists[i].iter().any(is_own)
                    {
                        lists[i].push(own);
                    }
                }
            }
            None => {
                b.add_new(own);
                lists.push(Vec::new_in(arena));
            }
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `getTypeArguments` for a reference to a class or interface, an array type or a tuple type.
    #[inline]
    pub fn type_arguments(&mut self, ty: TypeId) -> &'p [TypeId] {
        match self.resolved_type_arguments(ty) {
            Some(resolved) => resolved,
            None if self.types().deferred(ty).is_some() => self.resolve_type_arguments(ty),
            None => &[],
        }
    }

    /// `d.resolvedTypeArguments` of a reference or a tuple type, if they're resolved.
    #[inline(always)]
    fn resolved_type_arguments(&mut self, ty: TypeId) -> Option<&'p [TypeId]> {
        match self.data(ty) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args.actual()
            {
                Some(actual) => Some(actual),
                None => (self.p.resolved_type_arguments.get_ref(&self.task, &ty)).map(|it| &it[..]),
            },
            _ => None,
        }
    }

    /// `getTypeArguments` for a deferred type reference whose arguments aren't resolved yet.
    #[cold]
    #[inline(never)]
    fn resolve_type_arguments(&mut self, ty: TypeId) -> &'p [TypeId] {
        let Some(deferred) = self.types().deferred(ty) else {
            return &[];
        };
        let (file, node, mapper) = (deferred.file, deferred.node, deferred.mapper);
        // This scope encloses the resolution frame, because the arguments are instantiated after
        // `popTypeResolution` and the result depends on that too.
        let scope = self.begin_scope();
        if !self.enter(Query::TypeArguments(ty)) {
            let _ = self.end_scope_as(scope, true);
            // `errorType` for all of `n.TypeParameters()`, including the outer type parameters of
            // the declaration.
            let count = match self.data(ty) {
                TypeData::Ref { target, .. } => {
                    let declared = self.declared_type(*target);
                    match self.resolved_type_arguments(declared) {
                        Some(parameters) => parameters.len(),
                        // The declared type failed too, so the native stack is exhausted. The
                        // length still has to be right, because callers index into the list: an
                        // array type has an element type.
                        None => {
                            self.outer_type_params_of_symbol(*target).len()
                                + self.local_type_params_of_symbol(*target).len()
                        }
                    }
                }
                TypeData::Tuple { flags, .. } => flags.len(),
                _ => 0,
            };
            return self.provisional_type_arguments(ty, &vec![TypeId::ERROR; count]);
        }
        let declared = self.type_arguments_from_node(ty, file, node);
        let is_frame_cacheable = self.leave(Query::TypeArguments(ty)).is_ok();
        if self.left_a_cycle {
            // `popTypeResolution` fails.
            let errors = self.list_of(std::iter::repeat_n(TypeId::ERROR, declared.len()));
            let stored = (self.end_scope_as(scope, false)).unwrap_or_else(|_| self.cycle_result());
            let resolved: &'p [TypeId] = (self
                .p
                .resolved_type_arguments
                .insert_ref(&self.task, ty, errors, stored))
            .1;
            let at = (
                file,
                self.hir(file)[node].pos,
                self.end_of_type_node(file, node),
            );
            let err = match *self.data(ty) {
                TypeData::Ref { target, .. } => self.new_diagnostic(at, 4109, &[Arg::Sym(target)]),
                _ => self.new_diagnostic(at, 4110, &[]),
            };
            self.add_diagnostic_of(Some(Query::TypeArguments(ty)), err);
            return resolved;
        }
        // `c.instantiateTypes(typeArguments, d.mapper)`. It may request the type arguments of `ty`
        // again, which is not a cycle. tsgo recurses until `instantiationDepth == 100`, every level
        // assigns, and the outermost assigns last. So only the outermost level stores.
        let is_outermost = !self.type_arguments_in_instantiation.contains(&ty);
        self.type_arguments_in_instantiation.push(ty);
        let (before, in_place) = (self.non_cacheable_mark(), self.members_in_place_hits);
        let instantiated = self.instantiate_list(&declared, mapper);
        self.type_arguments_in_instantiation.pop();
        // `d.resolvedTypeArguments = ..` is assigned no matter which members were in place, since a
        // default type argument can need a member of the reference itself. See
        // `members_in_place_hits`.
        let in_place = self.members_in_place_hits - in_place;
        let is_final = self.non_cacheable_mark() == (before.0 + in_place, before.1);
        let is_open = !(is_frame_cacheable && is_outermost && is_final);
        match self.end_scope_as(scope, is_open) {
            Ok(stored) => {
                (self.p.resolved_type_arguments)
                    .insert_ref(&self.task, ty, instantiated, stored)
                    .1
            }
            Err(_) => self.provisional_type_arguments(ty, &instantiated),
        }
    }

    /// Returns `arguments` for a result about `ty` that isn't cacheable. They're stored as the
    /// arguments of `createTypeReference(ty.Target(), arguments)`.
    fn provisional_type_arguments(&mut self, ty: TypeId, arguments: &[TypeId]) -> &'p [TypeId] {
        let reference = self.create_type_reference(ty, arguments);
        self.resolved_type_arguments(reference).unwrap_or(&[])
    }

    /// `createTypeReference(ty.Target(), arguments)`. A type that isn't a reference is returned
    /// unchanged.
    pub(super) fn create_type_reference(&self, ty: TypeId, arguments: &[TypeId]) -> TypeId {
        match self.data(ty) {
            TypeData::Ref { target, .. } => self.intern_key(TypeKey::Ref {
                target: *target,
                args: arguments,
            }),
            TypeData::Tuple {
                flags, readonly, ..
            } => self.intern_key(TypeKey::Tuple {
                elems: arguments,
                flags,
                readonly: *readonly,
            }),
            _ => ty,
        }
    }

    /// `ty` for callers outside inference, where `NoInfer<T>`, by itself or in a union, is just
    /// `T`.
    pub(super) fn without_no_infer(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        self.map_type(ty, |c, m| match *c.data(m) {
            TypeData::Substitution {
                base,
                constraint: TypeId::UNKNOWN,
            } => base,
            _ => m,
        })
    }

    /// `isNoInferType`
    #[inline]
    pub(super) fn is_no_infer(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Substitution {
                constraint: TypeId::UNKNOWN,
                ..
            }
        )
    }

    /// `getNoInferType`
    pub(super) fn no_infer(&mut self, ty: TypeId) -> TypeId {
        if self.is_no_infer_target_type(ty) {
            self.intern(TypeData::Substitution {
                base: ty,
                constraint: TypeId::UNKNOWN,
            })
        } else {
            ty
        }
    }

    /// `getSubstitutionType`
    pub(super) fn substitution_type(&mut self, base: TypeId, constraint: TypeId) -> TypeId {
        if self.is_any(constraint)
            || constraint == TypeId::UNKNOWN
            || constraint == base
            || self.is_any(base)
        {
            return base;
        }
        self.intern(TypeData::Substitution { base, constraint })
    }

    /// `getSubstitutionIntersection`
    pub(super) fn substitution_intersection(&mut self, base: TypeId, constraint: TypeId) -> TypeId {
        if constraint == TypeId::UNKNOWN {
            base
        } else {
            self.intersection(&[constraint, base])
        }
    }

    /// `getActualTypeVariable`
    pub(super) fn actual_type_variable(&mut self, ty: TypeId) -> TypeId {
        let is_substitution = |c: &Self, t: TypeId| c.is_kind(t, tf::SUBSTITUTION);
        match *self.data(ty) {
            TypeData::Substitution { base, .. } => self.actual_type_variable(base),
            TypeData::IndexedAccess { obj, index, .. }
                if is_substitution(self, obj) || is_substitution(self, index) =>
            {
                let (obj, index) = (
                    self.actual_type_variable(obj),
                    self.actual_type_variable(index),
                );
                self.indexed_access(obj, index)
            }
            _ => ty,
        }
    }

    /// `isNoInferTargetType`
    fn is_no_infer_target_type(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&part| self.is_no_infer_target_type(part))
            }
            &TypeData::Substitution { base, constraint } => {
                constraint != TypeId::UNKNOWN && self.is_no_infer_target_type(base)
            }
            _ => {
                self.is_object_type(ty) && !self.is_empty_anonymous_object_type(ty)
                    || self.is_instantiable(ty) && !self.is_pattern_literal(ty)
            }
        }
    }

    fn shape_memo(&mut self, key: TypeId, build: impl FnOnce(&mut Self) -> Shape<'s>) -> Built<'p> {
        self.shape_memo_or(key, build, |_| Shape::new_in(self.arena))
    }

    /// A shape that isn't final. It lives until `release_provisional_shapes`.
    fn provisional_shape(&mut self, shape: Shape<'s>) -> Built<'p> {
        self.provisional_members(Resolved::new(shape))
    }

    fn provisional_members(&mut self, shape: Resolved<'s>) -> Built<'p> {
        let at = self.provisional_shapes.push(shape);
        let resolved = self.provisional_shapes.get(at);
        // SAFETY: a `LocalVec`'s elements don't move, and they're only dropped by
        // `release_provisional_shapes`, which is only called between files, when no `Members` is
        // live.
        let provisional: &'p Resolved<'p> = unsafe { &*std::ptr::from_ref(resolved) };
        Built {
            resolved: provisional,
            store_handle: None,
        }
    }

    fn cache_shape(&mut self, key: TypeId, mut shape: Shape<'s>, stored: Stored) -> Built<'p> {
        shape.props.shrink_to_fit();
        shape.call.shrink_to_fit();
        shape.construct.shrink_to_fit();
        shape.index.shrink_to_fit();
        let resolved = Resolved::new(shape);
        let (shape_handle, resolved) =
            (self.p.shapes).insert_ref(&self.task, key, resolved, stored);
        Built {
            resolved,
            store_handle: Some(shape_handle),
        }
    }

    /// The shape `cache_shape_provisionally` cached for `q`.
    fn provisionally_cached_shape(&mut self, q: Query) -> Option<Built<'p>> {
        let raw = self.provisional(q)?;
        // SAFETY: a pointer returned by `provisional_shape`. `check_file` clears `provisional` before it calls `release_provisional_shapes`.
        let resolved = unsafe { &*(raw as usize as *const Resolved) };
        Some(Built {
            resolved,
            store_handle: None,
        })
    }

    fn cache_shape_provisionally(&mut self, q: Query, shape: Shape<'s>, open: Open) -> Built<'p> {
        let built = self.provisional_shape(shape);
        let raw = std::ptr::from_ref(built.resolved) as usize as u64;
        self.cache_provisionally(q, raw, open);
        built
    }

    /// Call this only when no value returned by `members` is live.
    pub(super) fn release_provisional_shapes(&mut self) {
        debug_assert!(self.stack.is_empty());
        self.provisional_shapes.clear();
    }

    /// `meanwhile` computes the result for callers that re-enter while `build` is running.
    fn shape_memo_or(
        &mut self,
        key: TypeId,
        build: impl FnOnce(&mut Self) -> Shape<'s>,
        meanwhile: impl FnOnce(&mut Self) -> Shape<'s>,
    ) -> Built<'p> {
        self.shape_memo_bound(MemberBinding::Late, key, build, meanwhile)
    }

    /// `binding` is `MemberBinding::Early` if `build` resolves the members from `earlySymbols` and
    /// nothing assigns them again. See `gets_early_symbols_permanently`.
    fn shape_memo_bound(
        &mut self,
        binding: MemberBinding,
        key: TypeId,
        build: impl FnOnce(&mut Self) -> Shape<'s>,
        meanwhile: impl FnOnce(&mut Self) -> Shape<'s>,
    ) -> Built<'p> {
        if let Some(shape_handle) = self.p.shapes.handle(&self.task, &key) {
            return Built {
                resolved: self.p.shapes.at(&self.task, shape_handle),
                store_handle: Some(shape_handle),
            };
        }
        // `resolveAnonymousTypeMembers` has already set `ObjectFlagsMembersResolved`, so a request
        // in the meantime isn't a circular resolution, and whatever was computed from the members
        // in place stays as it is.
        if !self.anonymous_members_in_place.is_empty()
            && let TypeData::Anon { origin, .. } = *self.data(key)
            && let Some((_, height)) = self.members_in_place_of(origin)
        {
            self.note_members_in_place();
            self.note_members_in_place_read_above(height);
            let shape = meanwhile(self);
            return self.provisional_shape(shape);
        }
        // `resolveDeclaredMembers` has the members in place before it requests the index
        // signatures. Resolving them again in the meantime isn't a circular resolution, so nothing
        // is pushed and the result is provisional.
        if (self.declared_index_infos_in_progress.iter())
            .any(|it| it.0 > 0 && self.stack.get(it.0 - 1) == Some(&Query::Shape(key)))
        {
            self.task.hold_back();
            self.close_cycle(0);
            let mut shape = build(self);
            // `resolveAnonymousTypeMembers` computes the index signatures of the static side of a
            // class before its signatures.
            if let TypeData::Anon {
                origin: Origin::ClassStatic(_),
                ..
            } = self.data(key)
            {
                shape.call.clear();
                shape.construct.clear();
            }
            return self.provisional_shape(shape);
        }
        let mut resolved_before = self.members_resolved_before_base_types.iter();
        if let Some(&(_, resolved, _)) = resolved_before.find(|it| it.0 == key)
            && let TypeData::Ref { target, .. } = *self.data(key)
            && self.stack[self.resolution_start..].contains(&Query::Bases(target))
        {
            self.note_members_in_place();
            return Built {
                resolved,
                store_handle: None,
            };
        }
        // It isn't a circular resolution while the base types are being resolved either.
        // `resolveStructuredTypeMembers` has no guard, so it resolves the members again with the
        // base types found so far.
        // Nor for a mapped type. `resolveMappedTypeMembers` starts with empty members, "such that recursive references
        // see an empty object type". Whatever was computed from them stays as it is.
        // Nor when the declared members (`ObjectFlagsUnresolvedMembers`) or the early-bound members
        // are in place.
        if (self.are_base_types_in_progress(key) || self.is_mapped_type(key))
            && self.stack[self.resolution_start..].contains(&Query::Shape(key))
            || self.inheriting.iter().any(|it| it.0 == key)
            || binding == MemberBinding::Late && self.is_late_binding(key)
        {
            self.note_members_in_place_of(key);
            let shape = meanwhile(self);
            return self.provisional_shape(shape);
        }
        if let Some(built) = self.provisionally_cached_shape(Query::Shape(key)) {
            return built;
        }
        if !self.enter(Query::Shape(key)) {
            // `enter` also fails when the stack is low.
            let is_in_progress = !self.is_stack_low()
                && self.stack[self.resolution_start..].contains(&Query::Shape(key));
            let shape = if is_in_progress {
                meanwhile(self)
            } else {
                Shape::new_in(self.arena)
            };
            return self.provisional_shape(shape);
        }
        let in_place = self.members_in_place_hits;
        let shape = build(self);
        // `getReducedType` is listing this intersection's properties, and sets `resolvedProperties`
        // once it has them all. A list built in the meantime from members in place is only valid
        // until then.
        let is_listed_again =
            self.members_in_place_hits != in_place && self.never_in_progress.contains(&key);
        match self.leave(Query::Shape(key)) {
            Ok(_) if is_listed_again => self.provisional_shape(shape),
            Ok(stored) => {
                // See `resolving_at_base_types`: these members are only valid until `getBaseTypes`
                // returns.
                let overwritten_at = if self.resolving_at_base_types.contains(&key)
                    && let TypeData::Ref { target, .. } = *self.data(key)
                {
                    (self.base_types_so_far.iter()).rposition(|it| it.0 == target)
                } else {
                    None
                };
                match overwritten_at {
                    Some(at) => {
                        let built = self.provisional_shape(shape);
                        self.members_resolved_before_base_types
                            .push((key, built.resolved, at));
                        built
                    }
                    None => self.cache_shape(key, shape, stored),
                }
            }
            Err(open) => {
                let built = self.cache_shape_provisionally(Query::Shape(key), shape, open);
                if let TypeData::Ref { target, .. } = *self.data(key)
                    && let Some(at) = (self.base_types_so_far.iter()).rposition(|it| it.0 == target)
                {
                    self.members_resolved_before_base_types
                        .push((key, built.resolved, at));
                }
                built
            }
        }
    }

    /// True if `getResolvedMembersOrExportsOfSymbol` is binding the computed names of `ty`'s
    /// members. It assigns the early-bound symbols to its links first, and neither it nor
    /// `resolveStructuredTypeMembers` has a guard, so a request in the meantime resolves `ty`'s
    /// members from the early-bound symbols.
    fn is_late_binding(&self, ty: TypeId) -> bool {
        if self.late_binding.is_empty() {
            return false;
        }
        let (container, is_static) = match *self.data(ty) {
            TypeData::Ref { target, .. } => (target, false),
            TypeData::Anon {
                origin: Origin::ClassStatic(sym) | Origin::Function(sym),
                ..
            } => (sym, true),
            _ => return false,
        };
        let side = (self.files().canonical(container), is_static);
        // `add_members` resolves an index signature where it finds it, at the same depth of
        // `stack`. `getIndexInfosOfSymbol` runs after all names are bound.
        self.late_binding.iter().any(|it| {
            (it.1, it.2) == side
                && !(self.declared_index_infos_in_progress.iter()).any(|at| at.0 == it.0)
        })
    }

    /// Called when a request in the meantime (see `is_late_binding`) assigns the early-bound symbols of one side of
    /// `container`. The `resolveDeclaredMembers` or `resolveAnonymousTypeMembers` call that requested the names assigns
    /// the members again once they're bound. `getLateBoundSymbol` requests them with no such caller. See
    /// `permanently_early_bound`.
    fn note_members_from_early_symbols(&mut self, container: Sym, is_static: bool) {
        let side = (self.files().canonical(container), is_static);
        if self.late_binding_by_symbol.contains(&side) {
            self.permanently_early_bound.insert(side);
        }
    }

    /// `binding`, or `MemberBinding::Early` for a side that is `permanently_early_bound`.
    #[inline]
    fn binding_of_side(
        &self,
        container: Sym,
        is_static: bool,
        binding: MemberBinding,
    ) -> MemberBinding {
        if !self.permanently_early_bound.is_empty()
            && (self.permanently_early_bound)
                .contains(&(self.files().canonical(container), is_static))
        {
            return MemberBinding::Early;
        }
        binding
    }

    /// `getMembersOfSymbol(sym)` or `getExportsOfSymbol(sym)`, which `resolveDeclaredMembers` and
    /// `resolveAnonymousTypeMembers` start with. The caller reads the computed names once more and
    /// then pops `late_binding`. Returns `false`, which only happens for the members, if there's
    /// nothing to pop. See `resolve_members_from_nil_links`.
    fn begin_late_binding(&mut self, sym: Sym, is_static: bool) -> bool {
        let container = self.files().canonical(sym);
        self.late_bound_members(container, is_static);
        let mut in_progress = self.late_binding.iter();
        let has_started_over = !is_static
            && in_progress.any(|it| (it.1, it.2) == (container, false))
            && !self.files().has_members_table(container);
        if !has_started_over {
            self.late_binding
                .push((self.stack.len(), container, is_static));
        }
        !has_started_over
    }

    /// `resolveStructuredTypeMembers` of `ty`, a reference to the class or interface `sym`,
    /// requested by a computed name that `getResolvedMembersOrExportsOfSymbol` is binding, when
    /// `symbol.Members` is nil. The links are nil too, so the names are bound again. The outer
    /// call's table replaces this one, and nothing recomputes what was derived from this one, so
    /// re-entering a query here is no reason to roll those results back.
    fn resolve_members_from_nil_links(
        &mut self,
        ty: TypeId,
        sym: Sym,
        under: MapperId,
    ) -> Shape<'s> {
        let dropped: Vec<bool> = self
            .frames
            .iter()
            .map(|frame| frame.drops_reported)
            .collect();
        let (binding, bases) = (MemberBinding::Late, BaseMembers::Inherited);
        let shape = self.build_declared_shape(sym, under, binding, bases, None, Some(ty));
        for (frame, dropped) in self.frames.iter_mut().zip(dropped) {
            frame.drops_reported = dropped;
        }
        shape
    }

    /// `getMembersOfSymbol(sym)` in `getTypeFromTypeLiteralOrFunctionOrConstructorTypeNode`: the
    /// computed names among the `members` of a type literal are bound before `links.resolvedType`
    /// is assigned, and therefore within the resolution of an alias whose body is the literal.
    pub(super) fn get_members_of_type_literal(&mut self, file: FileId, members: Span<MemberId>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_dynamic =
            |m: &MemberId| matches!(hir[*m].key, PropKey::Computed(e) if is_dynamic_name(hir, e));
        let Some(first) = members.iter().find(is_dynamic) else {
            return;
        };
        let own = bound.member_symbol[first.idx()];
        if own.is_some() && bound.symbol(own).parent.is_some() {
            let container = self.files().sym(file, bound.symbol(own).parent);
            self.late_bound_members(container, false);
        }
    }

    /// The members of an object type. For an intersection of object types, this has its properties
    /// and only enough of its signatures to tell whether it has any. The rest is in
    /// `structured_members`. `None` for anything else.
    #[inline]
    pub fn members(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let recent = self.recent_members[ty.0 as usize % RECENT_MEMBERS];
        if recent.ty == ty && self.unresolved_members.is_empty() {
            return recent.resolved.map(|resolved| Members {
                resolved,
                mapper: recent.mapper,
            });
        }
        self.members_not_recent(ty)
    }

    /// `members` for a type that wasn't queried recently.
    fn members_not_recent(&mut self, ty: TypeId) -> Option<Members<'p>> {
        if let Some(known) = self.p.members.get(&self.task, &ty) {
            if !self.unresolved_members.is_empty()
                && let Some(declared) = self.declared_members_if_unresolved(ty, known.mapper)
            {
                return Some(declared);
            }
            let resolved = self.p.shapes.at(&self.task, known.shape);
            self.recent_members[ty.0 as usize % RECENT_MEMBERS] = RecentMembers {
                resolved: Some(resolved),
                ty,
                mapper: known.mapper,
            };
            return Some(Members {
                resolved,
                mapper: known.mapper,
            });
        }
        let members = self.members_on_cache_miss(ty)?;
        if !self.unresolved_members.is_empty()
            && let Some(declared) = self.declared_members_if_unresolved(ty, members.mapper)
        {
            return Some(declared);
        }
        Some(members)
    }

    /// The members of `ty`, if they've already been resolved (`ObjectFlagsMembersResolved`).
    /// Resolves nothing.
    pub(super) fn resolved_members(&self, ty: TypeId) -> Option<Members<'p>> {
        let recent = self.recent_members[ty.0 as usize % RECENT_MEMBERS];
        if recent.ty == ty {
            return recent.resolved.map(|resolved| Members {
                resolved,
                mapper: recent.mapper,
            });
        }
        let known = self.p.members.get(&self.task, &ty)?;
        Some(Members {
            resolved: self.p.shapes.at(&self.task, known.shape),
            mapper: known.mapper,
        })
    }

    /// True if `members`, a result of `members(ty)`, are the stored members. Stored members stay valid for as long as
    /// the task runs. Others are replaced later and don't outlive the file.
    fn has_stored_members(&self, ty: TypeId, members: Members<'p>) -> bool {
        self.resolved_members(ty).is_some_and(|stored| {
            std::ptr::eq(stored.resolved, members.resolved) && stored.mapper == members.mapper
        })
    }

    /// `resolveStructuredTypeMembers` of a type reference that has `ObjectFlagsUnresolvedMembers`:
    /// the members that its class or interface declares. `mapper` is the mapper of `ty`'s members.
    /// `None` if `ty` isn't such a type reference. See `unresolved_members`.
    #[cold]
    #[inline(never)]
    fn declared_members_if_unresolved(
        &mut self,
        ty: TypeId,
        mapper: MapperId,
    ) -> Option<Members<'p>> {
        let at = (self.unresolved_members.iter()).position(|it| it.0 == mapper)?;
        let &TypeData::Ref { target, .. } = self.data(ty) else {
            return None;
        };
        if self.base_types(target).is_empty() {
            return None;
        }
        // Anything derived from this result is only valid until that `compose` returns.
        self.lowest_unresolved_members_hit = self.lowest_unresolved_members_hit.min(at as u32);
        self.unresolved_members_hits += 1;
        self.mark_tainted_by_pattern_from(self.unresolved_members[at].1 as usize);
        self.note_members_in_place();
        let shape = self.resolve_declared_members(target);
        Some(Members {
            resolved: self.provisional_shape(shape).resolved,
            mapper,
        })
    }

    /// `resolveDeclaredMembers`: the members that the class or interface `sym` declares itself. The
    /// members of its base types aren't resolved.
    pub(super) fn resolve_declared_members(&mut self, sym: Sym) -> Shape<'s> {
        let (binding, bases) = (MemberBinding::Late, BaseMembers::Omitted);
        self.build_declared_shape(sym, MapperId::IDENTITY, binding, bases, None, None)
    }

    /// True if `resolveObjectTypeMembers` of `ty`, a reference to `target`, finds
    /// `declaredMembersResolved` set and `declaredIndexInfos` nil, and no enclosing call for `ty`
    /// assigns its members again. Then `ty`, and no other reference, ends up without the declared
    /// index infos.
    #[inline]
    fn gets_no_declared_index_infos(&self, target: Sym, ty: TypeId) -> bool {
        let mut callers = (self.declared_index_infos_in_progress.iter())
            .filter_map(|it| it.3)
            .filter(|it| it.symbol == target)
            .peekable();
        callers.peek().is_some() && callers.all(|it| it.resolving != Some(ty))
    }

    /// True if `resolveObjectTypeMembers` of `ty`, a reference to `target`, finds `earlySymbols` in
    /// `target`'s links, the names were requested by `resolveDeclaredMembers`, and no enclosing
    /// call for `ty` assigns its members again. `declaredMembers` is assigned again, so `ty`, and
    /// no other reference, ends up without the late-bound members.
    fn gets_early_symbols_permanently(&self, target: Sym, ty: TypeId) -> bool {
        let mut is_requested_by_declared_members = false;
        for caller in &self.declared_members_in_progress {
            if caller.symbol == target {
                if caller.resolving == Some(ty) {
                    return false;
                }
                is_requested_by_declared_members = true;
            }
        }
        is_requested_by_declared_members
            && self.is_late_binding(ty)
            && self.files().has_members_table(target)
    }

    /// `members` for a type with no cached entry.
    fn members_on_cache_miss(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let scope = self.begin_scope();
        let built = self.members_uncached(ty);
        self.cache_members(ty, scope, built)
    }

    /// Caches `built`, computed since `scope` began, as the members of `ty`.
    fn cache_members(
        &mut self,
        ty: TypeId,
        scope: Scope,
        built: Option<(Built<'p>, MapperId)>,
    ) -> Option<Members<'p>> {
        // The entry is cached exactly when the shape is.
        let is_open = !built.is_some_and(|(built, _)| built.store_handle.is_some());
        let ended = self.end_scope_as(scope, is_open);
        let (built, mapper) = built?;
        if let (Some(shape), Ok(stored)) = (built.store_handle, ended) {
            let entry = CachedMembers { shape, mapper };
            self.p.members.insert(&self.task, ty, entry, stored);
            self.recent_members[ty.0 as usize % RECENT_MEMBERS] = RecentMembers {
                resolved: Some(built.resolved),
                ty,
                mapper,
            };
        }
        Some(Members {
            resolved: built.resolved,
            mapper,
        })
    }

    fn members_uncached(&mut self, ty: TypeId) -> Option<(Built<'p>, MapperId)> {
        match self.data(ty) {
            &TypeData::Substitution { base, constraint } => {
                let both = self.substitution_intersection(base, constraint);
                self.members(both).map(|members| {
                    (
                        Built {
                            resolved: members.resolved,
                            store_handle: None,
                        },
                        members.mapper,
                    )
                })
            }
            &TypeData::Ref { target, .. } => {
                let declared = self.declared_type(target);
                if !matches!(self.data(declared), TypeData::Ref { .. }) {
                    return None;
                }
                let (params, args) = (self.type_arguments(declared), self.type_arguments(ty));
                // Compared by value, because `args` can be provisional while the final arguments
                // are stored.
                let are_provisional = self.resolved_type_arguments(ty) != Some(args);
                // `resolveTypeReferenceMembers`: the arguments correspond to the outer type
                // parameters of the declaration, then its own, then `this`. Without an argument for
                // `this`, `this` is the type the member is looked up in.
                let this = args.get(params.len()).copied().unwrap_or(ty);
                let actual = if declared == ty {
                    0
                } else {
                    params.len().min(args.len())
                };
                let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::new();
                pairs.extend(
                    params
                        .iter()
                        .copied()
                        .zip(args.iter().copied())
                        .take(actual),
                );
                pairs.push((self.intern(TypeData::ThisParam(target)), this));
                let mapper = self.types().mapper_of(&pairs);
                let binding = match self.gets_early_symbols_permanently(target, ty) {
                    true => MemberBinding::Early,
                    false => MemberBinding::Late,
                };
                // All instantiations share the declared type's shape, unless their base types depend on the type
                // arguments or on the type's members. In `interface D extends M<D>`, `D` can end up without the members
                // of `M<D>` while `D` with a `this` argument has them.
                // `ObjectFlagsUnresolvedMembers` and `ObjectFlagsMembersResolved` are per-reference flags. A different
                // reference that's requested while the shared shape is resolving the base types' members, or while
                // `getBaseTypes` is resolving the base types, is resolved separately and keeps what it gets.
                let is_other_inheriting =
                    (self.inheriting.iter()).any(|it| it.0 == declared && it.1 != ty);
                // `baseTypes := c.getBaseTypes(source)` of `resolveObjectTypeMembers`
                let inherits_from_type_arguments = declared != ty && {
                    self.resolving_at_base_types.push(ty);
                    let inherits = self.inherits_from_type_arguments(target);
                    self.resolving_at_base_types.pop();
                    inherits
                };
                // `thisArgument` of `resolveObjectTypeMembers` is `t` itself for the reference that inherits. With a
                // `this` type in its place, this isn't the reference that keeps these members.
                let is_at_base_types = !matches!(self.data(this), TypeData::ThisParam(_))
                    && self.base_types_so_far.iter().any(|it| it.0 == target);
                let gets_no_declared_index_infos = self.gets_no_declared_index_infos(target, ty);
                let has_circular_base_types =
                    (self.p.circular_base_types.get(&self.task, &target)).is_some();
                // In `interface D extends Pick<D & E, "e">`, resolving the base type's members requests `D` with
                // `D & E` as `this` (`getApparentType(modifiersType)`). Only that reference ends up without them.
                let is_other_inheriting =
                    is_other_inheriting || declared != ty && self.has_base_type_in_progress(target);
                // Which shape it gets, and what's in that shape, depends on what this checker has in progress, or on a
                // note that not every task can see.
                let depends_on_state = is_other_inheriting
                    || is_at_base_types
                    || gets_no_declared_index_infos
                    || has_circular_base_types
                    || binding == MemberBinding::Early;
                // This covers the members of `ty`, even if the shape already exists. The shape is covered below.
                if depends_on_state {
                    self.note_state_was_read();
                }
                // `has_circular_base_types` doesn't count: a task that can't see that note yet re-enters the base types
                // itself.
                if is_other_inheriting
                    || is_at_base_types
                    || gets_no_declared_index_infos
                    || binding == MemberBinding::Early
                {
                    self.close_cycle(0);
                }
                let (key, under) = if declared != ty
                    && (inherits_from_type_arguments
                        || has_circular_base_types
                        || is_other_inheriting
                        || is_at_base_types)
                {
                    (ty, mapper)
                } else if binding == MemberBinding::Early
                    || gets_no_declared_index_infos
                    || is_other_inheriting
                {
                    // The declared type is the key of the shared shape, so its own shape is stored
                    // under `paddedTypeArguments`.
                    let own = if declared == ty {
                        self.type_with_this_argument(ty, this)
                    } else {
                        ty
                    };
                    (own, MapperId::IDENTITY)
                } else {
                    (declared, MapperId::IDENTITY)
                };
                // `getResolvedMembersOrExportsOfSymbol`: while the late-bound names are being
                // resolved, the members with literal names are available.
                let mut resolved = self.shape_memo_bound(
                    binding,
                    key,
                    |c| {
                        if are_provisional && key == ty {
                            c.mark_tainted_from(c.frames.len() - 1);
                        }
                        if depends_on_state {
                            c.note_state_was_read();
                        }
                        let bases = BaseMembers::Inherited;
                        c.build_declared_shape(target, under, binding, bases, Some(key), Some(ty))
                    },
                    |c| {
                        // `resolveObjectTypeMembers`: the declared members, then the base types,
                        // then the members of those.
                        let is_bound = !c.is_late_binding(key);
                        if !is_bound && !c.files().has_members_table(target) {
                            return c.resolve_members_from_nil_links(ty, target, under);
                        }
                        if !is_bound {
                            c.note_members_from_early_symbols(target, false);
                        }
                        let is_in_place = c.inheriting.iter().any(|it| it.0 == key);
                        let (binding, bases) = if is_bound && is_in_place {
                            (MemberBinding::Late, BaseMembers::Omitted)
                        } else if is_bound && c.base_types_so_far.iter().any(|it| it.0 == target) {
                            (MemberBinding::Late, BaseMembers::Inherited)
                        } else {
                            (MemberBinding::Early, BaseMembers::Inherited)
                        };
                        c.build_declared_shape(target, under, binding, bases, None, Some(ty))
                    },
                );
                // `mapper` is built from the provisional arguments.
                if are_provisional {
                    resolved.store_handle = None;
                }
                // A separate shape is already instantiated. Its inherited members are those of the
                // instantiated base types, where `target`'s type parameters come from `args`.
                let outer = if under == mapper {
                    MapperId::IDENTITY
                } else {
                    mapper
                };
                Some((resolved, outer))
            }
            &TypeData::Anon { origin, mapper } => {
                if let Origin::Mapped(file, node) = origin {
                    // `resolveMappedTypeMembers` starts with no members in place, regardless of what `resolutionStart`
                    // hides.
                    if self.mapped_types_in_progress.contains(&ty)
                        && !self.stack[self.resolution_start..].contains(&Query::Shape(ty))
                    {
                        self.note_members_in_place();
                        let no_members = self.provisional_shape(Shape::new_in(self.arena));
                        return Some((no_members, MapperId::IDENTITY));
                    }
                    let resolved = self.shape_memo(ty, |c| {
                        c.mapped_types_in_progress.push(ty);
                        let shape = c.build_mapped_shape(file, node, mapper);
                        c.mapped_types_in_progress.pop();
                        shape
                    });
                    return Some((resolved, MapperId::IDENTITY));
                }
                let identity = self.identity_of(mapper);
                let key = if identity == mapper {
                    ty
                } else {
                    self.intern(TypeData::Anon {
                        origin,
                        mapper: identity,
                    })
                };
                if identity != mapper && self.has_no_members_in_place(ty) {
                    let no_members = Shape::new_in(self.arena);
                    return Some((self.provisional_shape(no_members), MapperId::IDENTITY));
                }
                let resolved = self.shape_memo_or(
                    key,
                    |c| {
                        let (binding, until) = (MemberBinding::Late, MembersInPlace::Signatures);
                        c.build_origin_shape(origin, binding, until)
                    },
                    |c| c.origin_shape_in_the_meantime(key, origin),
                );
                if identity == mapper {
                    return Some((resolved, MapperId::IDENTITY));
                }
                Some(self.instantiate_index_infos(ty, resolved, mapper))
            }
            &TypeData::Fns { ref decls, mapper } => {
                let identity = self.identity_of(mapper);
                let key = if identity == mapper {
                    ty
                } else {
                    self.intern_key(TypeKey::Fns {
                        decls,
                        mapper: identity,
                    })
                };
                let resolved = self.shape_memo(key, |c| {
                    let mut shape = Shape::new_in(self.arena);
                    for &(file, func) in decls.iter() {
                        let sig = c.sig_of_declaration(file, func);
                        let is_constructor = c.hir(file)[func].kind == FnKind::ConstructorType;
                        let list = match is_constructor {
                            true => &mut shape.construct,
                            false => &mut shape.call,
                        };
                        if list.is_empty() {
                            list.reserve_exact(decls.len());
                        }
                        list.push(sig);
                    }
                    if let [(file, func)] = decls[..] {
                        let symbol = c.bound(file).symbol_of_function(c.hir(file), func);
                        shape = c.with_expandos(shape, file, symbol);
                    }
                    shape
                });
                Some((
                    resolved,
                    if identity == mapper {
                        MapperId::IDENTITY
                    } else {
                        mapper
                    },
                ))
            }
            TypeData::Synth(shape) => {
                let resolved = self.shape_memo(ty, |_| (**shape).clone_in(self.arena));
                Some((resolved, MapperId::IDENTITY))
            }
            &TypeData::ReverseMapped { source, mapped, of } => {
                let resolved =
                    self.shape_memo(ty, |c| c.build_reverse_mapped_shape(ty, source, mapped, of));
                Some((resolved, MapperId::IDENTITY))
            }
            TypeData::Tuple { flags, .. } => {
                self.count_instantiation_of_tuple_base_type(flags);

                self.tuple_members(ty, ty)
            }
            // Its properties. See `structured_members`.
            TypeData::Intersection(parts) => Some((
                self.properties_of_intersection(ty, parts, false),
                MapperId::IDENTITY,
            )),
            _ => None,
        }
    }

    /// True if `ty` has `ObjectFlagsMembersResolved` but no members yet, because
    /// `resolveAnonymousTypeMembers` is instantiating them.
    pub(super) fn has_no_members_in_place(&mut self, ty: TypeId) -> bool {
        let mut in_progress = self.index_infos_in_instantiation.iter();
        let is_in_progress = in_progress.any(|it| it.ty == ty);
        if is_in_progress {
            self.note_no_members_in_place();
        }
        is_in_progress
    }

    /// `note_members_in_place` for a type that satisfies `has_no_members_in_place`, or for a result
    /// derived from one.
    pub(super) fn note_no_members_in_place(&mut self) {
        self.note_members_in_place();
        if let Some(outermost) = self.index_infos_in_instantiation.first_mut() {
            outermost.hits += 1;
        }
    }

    /// `instantiateIndexInfos` in `resolveAnonymousTypeMembers`, which instantiates the value types
    /// eagerly. `ty` is the instantiation with `mapper` of a type whose members are `target`.
    /// Returns the members of `ty`.
    ///
    /// FOR SPEED, an instantiation shares its target's members, and each reader instantiates the
    /// member it reads. For a value type that produces the same type as here, unless members in
    /// place were read, for instance `ty`'s own. In that case `ty` gets its own members.
    fn instantiate_index_infos(
        &mut self,
        ty: TypeId,
        target: Built<'p>,
        mapper: MapperId,
    ) -> (Built<'p>, MapperId) {
        let declared = &target.resolved.shape;
        if declared.index.is_empty() {
            return (target, mapper);
        }
        let (scope, in_place) = (self.begin_scope(), self.members_in_place_hits);
        let (limit_hits, hit_at) = (self.instantiation_limit_hits, self.members_in_place_hit_at);
        self.index_infos_in_instantiation
            .push(IndexInfosInInstantiation {
                ty,
                instantiations: FxHashMap::default(),
                hits: 0,
            });
        let values: SmallVec<[TypeId; 2]> = (declared.index.iter())
            .map(|info| self.instantiate(info.value, mapper))
            .collect();
        let popped = self.index_infos_in_instantiation.pop();
        let marks = self.members_in_place_hits - in_place;
        if marks == 0 {
            let is_valid_for_every_caller = self.instantiation_limit_hits == limit_hits
                && self.index_infos_in_instantiation.is_empty();
            if let (Ok(stored), true) =
                (self.end_scope_by_counters(scope), is_valid_for_every_caller)
            {
                for (info, &value) in declared.index.iter().zip(&values) {
                    if value != info.value && self.flags(info.value) & tf::TYPE_PARAMETER == 0 {
                        let key = (info.value, mapper);
                        (self.p.instantiations).rewrite(&self.task, key, value, stored);
                    }
                }
            }
            return (target, mapper);
        }
        if self.index_infos_in_instantiation.is_empty()
            && popped.is_some_and(|outermost| outermost.hits == marks)
            && self.non_cacheable_mark() == (scope.counters.0 + marks, scope.counters.1)
        {
            // The only members read in place are the ones that are complete now, and no caller has
            // seen the marks.
            self.members_in_place_hits = in_place;
            (self.cycles, self.members_in_place_hit_at) = (scope.counters.0, hit_at);
        }
        let mut shape = declared.clone_in(self.arena);
        for prop in &mut shape.props {
            self.instantiate_prop(prop, mapper);
        }
        for sig in shape.call.iter_mut().chain(shape.construct.iter_mut()) {
            *sig = self.instantiate_sig(*sig, mapper);
        }
        for (info, value) in shape.index.iter_mut().zip(values) {
            info.value = value;
        }
        let own = Resolved::of(shape, self.arena);
        let built = match self.end_scope(scope) {
            Ok(stored) if target.store_handle.is_some() => {
                let (shape_handle, resolved) =
                    (self.p.shapes).insert_ref(&self.task, ty, own, stored);
                Built {
                    resolved,
                    store_handle: Some(shape_handle),
                }
            }
            _ => self.provisional_members(own),
        };
        (built, MapperId::IDENTITY)
    }

    /// The identity mapper over the same type parameters.
    fn identity_of(&mut self, mapper: MapperId) -> MapperId {
        let mapping = self.types().mapping(mapper);
        if mapping.iter().all(|p| p.0 == p.1) {
            return mapper;
        }
        let pairs: SmallVec<[(TypeId, TypeId); 8]> = mapping.iter().map(|p| (p.0, p.0)).collect();
        self.types().mapper_of(&pairs)
    }

    // ───────────────────────────── building ─────────────────────────────

    /// `member` is the first declaration of a symbol with `symbol_flags`. `modifiers` is
    /// `getDeclarationModifierFlagsFromSymbol`.
    fn member_flags(member: &Member, modifiers: Flags, symbol_flags: SymFlags) -> PropFlags {
        let mut flags = PropFlags::empty();
        // `isReadonlySymbol`: the modifier only counts on a `SymbolFlagsProperty`.
        if modifiers.contains(Flags::READONLY) && symbol_flags.contains(SymFlags::PROPERTY) {
            flags |= PropFlags::READONLY;
        }
        if modifiers.contains(Flags::PRIVATE) {
            flags |= PropFlags::PRIVATE;
        }
        if modifiers.contains(Flags::PROTECTED) {
            flags |= PropFlags::PROTECTED;
        }
        if modifiers.contains(Flags::ABSTRACT) {
            flags |= PropFlags::ABSTRACT;
        }
        match member.kind {
            MemberKind::Method => flags |= PropFlags::METHOD,
            MemberKind::Getter | MemberKind::Setter => flags |= PropFlags::ACCESSOR,
            // `bindPropertyWorker`: an `accessor` field is a getter and a setter.
            MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                flags |= PropFlags::ACCESSOR;
            }
            _ => {}
        }
        flags
    }

    /// A member's name, if it's statically known. A computed name is determined only by the
    /// expression's type, as in an object literal or a binding pattern
    /// (`checkComputedPropertyName`, `isTypeUsableAsPropertyName`).
    #[inline(always)]
    pub fn member_name(&mut self, file: FileId, key: PropKey) -> Option<Atom> {
        match key {
            PropKey::Name(name) | PropKey::Private(name) => Some(name),
            PropKey::Computed(e) => self.computed_member_name(file, e),
            PropKey::None => None,
        }
    }

    #[inline(never)]
    fn computed_member_name(&mut self, file: FileId, e: ExprId) -> Option<Atom> {
        // For `[Symbol.iterator]`, unless `Symbol` is shadowed, read that property of the global `Symbol` without
        // checking the expression. This is very common in the default libraries.
        let hir = self.hir(file);
        if let ExprKind::Dot { obj, name, .. } = hir[e].kind
            && matches!(hir[obj].kind, ExprKind::Ident(known::Symbol))
            && self.bound(file).symbol_of_expr(obj).is_none()
            && let Some(global) = self.files().global(known::Symbol, SymFlags::VALUE)
        {
            let constructor = self.type_of_symbol(global);
            if let Some(ty) = self.type_of_property(constructor, name)
                && let Some(found) = self.property_name_of_type(ty)
            {
                return Some(found);
            }
        }
        let ty = self.check_computed_property_name(file, e);
        self.property_name_of_type(ty)
    }

    /// True if the computed name `[e]` of a member of a class, interface or type literal can
    /// declare a member: `e` is a literal, which the binder uses as the name (`IsDynamicName`), or
    /// an entity name expression (`isLateBindableAST`).
    pub(super) fn can_name_a_member(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        !is_dynamic_name(hir, e) || is_entity_name_expression(hir, e)
    }

    /// `e.Name()` of a component of an index signature, and the file it is in.
    pub(super) fn name_of_index_component(&self, component: IndexComponent) -> (FileId, PropKey) {
        match component {
            IndexComponent::Property(file, p) => (file, self.hir(file)[p].key),
            IndexComponent::Member(file, m) => (file, self.hir(file)[m].key),
        }
    }

    /// The name of a member's symbol: the one the binder gives it (`getDeclarationName`), or the
    /// late-bound one (`isLateBindableName`).
    pub fn declared_member_name(&mut self, file: FileId, key: PropKey) -> Option<Atom> {
        if let PropKey::Computed(e) = key {
            if !self.can_name_a_member(file, e) {
                return None;
            }
            // `IsSignedNumericLiteral`: `TokenToString(operator) + operand.Text()`
            let hir = self.hir(file);
            if let ExprKind::Unary { op, operand } = hir[e].kind
                && let ExprKind::Number(n) = hir[operand].kind
            {
                let sign: &[u8] = if op == UnOp::Plus { b"+" } else { b"-" };
                let digits = crate::atom::number_to_string(hir.numbers[n as usize]);
                return Some(self.atoms().intern(&cat!(sign, digits)));
            }
        }
        self.member_name(file, key)
    }

    /// `getPropertyNameFromType`: the property a value of type `ty` names when used as a key.
    pub fn property_name_of_type(&mut self, ty: TypeId) -> Option<Atom> {
        match *self.data(ty) {
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => Some(value),
            TypeData::NumberLit { bits, .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(bits),
                ..
            } => Some(self.number_name(f64::from_bits(bits))),
            TypeData::UniqueSymbol { symbol, name } => {
                let mut text = self.atoms().bytes(name).to_vec();
                match symbol {
                    UniqueSymbolDeclaration::Variable(variable) => {
                        let id = format!("@{}.{}", variable.file.0, variable.id.0);
                        text.extend_from_slice(id.as_bytes());
                    }
                    UniqueSymbolDeclaration::Member(file, member) => {
                        text.extend_from_slice(format!("@{}.m{}", file.0, member.0).as_bytes());
                    }
                    UniqueSymbolDeclaration::SymbolConstructor => {}
                }
                Some(self.atoms().symbol_name(&text))
            }
            _ => None,
        }
    }

    pub fn number_name(&self, n: f64) -> Atom {
        let intern = || self.atoms().intern(&crate::atom::number_to_string(n));
        // FOR SPEED: every element of an array literal with a contextual type looks up the name of
        // its index.
        let index = n as usize;
        if index as f64 != n || index >= 256 {
            return intern();
        }
        let mut names = self.names_of_small_numbers.borrow_mut();
        if names.len() <= index {
            names.resize(index + 1, Atom::NONE);
        }
        if names[index] == Atom::NONE {
            names[index] = intern();
        }
        names[index]
    }

    /// Adds the members declared in `members` (the static ones or the instance ones) to `b`.
    fn add_members(
        &mut self,
        b: &mut Builder<'s>,
        file: FileId,
        members: Span<MemberId>,
        side: ClassSide,
        binding: MemberBinding,
    ) {
        let want_static = side == ClassSide::Static;
        let early = binding == MemberBinding::Early;
        let hir = self.hir(file);
        // Only a class has a static side (`declareClassMember`). Elsewhere the modifier is an error
        // and has no effect.
        let has_static_side = !members
            .iter()
            .next()
            .is_some_and(|m| self.is_declared_outside_classes(file, m));
        // Declarations with the same name form one property.
        let mut groups: Vec<(Atom, SmallVec<[MemberId; 4]>)> = Vec::new();
        for m in members.iter() {
            let member = &hir[m];
            if (has_static_side && member.flags.contains(Flags::STATIC)) != want_static {
                continue;
            }
            let is_dynamic = matches!(member.key, PropKey::Computed(e) if is_dynamic_name(hir, e));
            // `getResolvedMembersOrExportsOfSymbol`: `isStatic == HasStaticModifier(member)`, no
            // matter what declares the member.
            if is_dynamic && (early || member.flags.contains(Flags::STATIC) != want_static) {
                continue;
            }
            // `getDeclarationName`: a private name outside every class is `InternalSymbolNameMissing`, and
            // `declareSymbolEx` doesn't add such a symbol to the member table.
            if !has_static_side
                && matches!(member.key, PropKey::Private(_))
                && !self.is_signature_inside_a_class(file, m)
            {
                continue;
            }
            match member.kind {
                MemberKind::Property
                | MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter => {
                    let Some(name) = self.declared_member_name(file, member.key) else {
                        b.computed_names.push((file, m));
                        // `getMembersOfSymbol`: the instance member table also contains the type
                        // parameters.
                        b.has_non_property_symbols |= !want_static
                            && match self.bound(file).member_owner[m.idx()] {
                                MemberOwner::Class(c) => !hir[c].type_params.is_empty(),
                                MemberOwner::Interface(i) => !hir[i].type_params.is_empty(),
                                _ => false,
                            };
                        continue;
                    };
                    if is_dynamic && self.is_late_bound_by_another_call(file, m) {
                        continue;
                    }
                    match groups.iter_mut().find(|g| g.0 == name) {
                        Some(group) => group.1.push(m),
                        None => groups.push((name, smallvec![m])),
                    }
                }
                MemberKind::CallSignature => {
                    b.has_non_property_symbols = true;
                    b.shape.call.push(self.sig_of_fn(file, member.func));
                }
                MemberKind::ConstructSignature => {
                    b.has_non_property_symbols = true;
                    b.shape.construct.push(self.sig_of_fn(file, member.func));
                }
                MemberKind::IndexSignature => {
                    // `getIndexInfosOfIndexSymbol` requires exactly one parameter, with a type. Of that type as
                    // written, only the parts that are valid key types count.
                    let f = &hir[member.func];
                    if f.params.len() != 1 || hir[f.params.at(0)].ty.is_none() {
                        continue;
                    }
                    // `resolveDeclaredMembers`: a caller that resolves the members while their index
                    // signatures are being resolved gets the members without index signatures.
                    let is_static = member.flags.contains(Flags::STATIC);
                    let mut in_progress = self.declared_index_infos_in_progress.iter();
                    if in_progress.any(|it| match (b.declaring, it.3) {
                        // `declaredIndexInfos` is nil until those of all declarations are resolved.
                        (Some(own), Some(other)) => own.symbol == other.symbol,
                        _ => {
                            it.1 == file
                                && members.range().contains(&it.2.idx())
                                && hir[it.2].kind == MemberKind::IndexSignature
                                && hir[it.2].flags.contains(Flags::STATIC) == is_static
                        }
                    }) {
                        continue;
                    }
                    // With `early`, the innermost query isn't the one for these members. A type
                    // literal has no members in place (`resolveAnonymousTypeMembers`).
                    let is_type_literal = matches!(
                        self.bound(file).member_owner[m.idx()],
                        MemberOwner::TypeLiteral(_)
                    );
                    let is_in_place = !early && !is_type_literal;
                    if is_in_place {
                        self.declared_index_infos_in_progress.push((
                            self.stack.len(),
                            file,
                            m,
                            b.declaring,
                        ));
                    }
                    let value = if member.ty.is_some() {
                        self.type_from_node(file, member.ty)
                    } else {
                        TypeId::ANY
                    };
                    let keys = self.type_from_node(file, hir[f.params.at(0)].ty);
                    if is_in_place {
                        self.declared_index_infos_in_progress.pop();
                    }
                    for &key in self.parts(keys) {
                        if !self.is_valid_index_key_type(key) {
                            continue;
                        }
                        let info = IndexInfo {
                            declaration: Some((file, m)),
                            ..IndexInfo::new(key, value, member.flags.contains(Flags::READONLY))
                        };
                        // The first index signature for a key type wins.
                        if !b.shape.index.iter().any(|i| i.key == key) {
                            b.shape.index.push(info);
                        }
                    }
                }
                MemberKind::Constructor => {
                    if want_static {
                        continue;
                    }
                    b.has_non_property_symbols = true;
                    for p in hir[member.func].params.iter() {
                        let param = &hir[p];
                        if !param.flags.contains(Flags::PARAMETER_PROPERTY) {
                            continue;
                        }
                        let PatKind::Ident(name) = hir[param.pat].kind else {
                            continue;
                        };
                        let mut flags = PropFlags::empty();
                        if param.flags.contains(Flags::OPTIONAL) {
                            flags |= PropFlags::OPTIONAL | PropFlags::WITHOUT_OPTIONALITY;
                        }
                        if param.flags.contains(Flags::READONLY) {
                            flags |= PropFlags::READONLY;
                        }
                        if param.flags.contains(Flags::PRIVATE) {
                            flags |= PropFlags::PRIVATE;
                        }
                        if param.flags.contains(Flags::PROTECTED) {
                            flags |= PropFlags::PROTECTED;
                        }
                        if param.flags.contains(Flags::ABSTRACT) {
                            flags |= PropFlags::ABSTRACT;
                        }
                        let symbol = self
                            .bound(file)
                            .symbol_of_declaration(Decl::ParameterProperty(p));
                        if symbol.is_none() {
                            continue;
                        }
                        b.add(Prop {
                            name,
                            flags,
                            source: PropSource::Symbol(self.files().sym(file, symbol)),
                            mapper: MapperId::IDENTITY,
                            name_type: TypeId::UNRESOLVED,
                        });
                    }
                }
                MemberKind::StaticBlock => {}
            }
        }
        b.reserve(groups.len());
        // Whether any name is late-bound, for the instance members and for the static ones.
        // Computed once per side.
        let mut is_late_bound = [None; 2];
        let files = self.files();
        let is_dynamic =
            |m: &MemberId| matches!(hir[*m].key, PropKey::Computed(e) if is_dynamic_name(hir, e));
        for (name, group) in groups {
            // `combineSymbolTables`: the table keeps an early-bound symbol, whether or not the late-bound one of that
            // name merges with it.
            // `declareSymbolEx`: the symbol of a declaration that was rejected, or discarded in favor of a method,
            // isn't in the table either.
            let early_bound = || group.iter().copied().filter(|m| !is_dynamic(m));
            let bound = self.bound(file);
            let first = (early_bound())
                .find(|&m| group.len() == 1 || !bound.is_member_not_in_table(m))
                .or_else(|| early_bound().next())
                .unwrap_or(group[0]);
            let sym = self.symbol_of_member(file, first);
            let is_static = hir[first].flags.contains(Flags::STATIC);
            let is_late_bound = !early
                && match is_late_bound[is_static as usize] {
                    Some(known) => known,
                    None => {
                        let own = bound.symbol_of_declaration(Decl::Member(first));
                        let parent = bound.symbol(own).parent;
                        let known = parent.is_some()
                            && (self.late_bound_members(self.files().sym(file, parent), is_static))
                                .is_some();
                        is_late_bound[is_static as usize] = Some(known);
                        known
                    }
                };
            // All its declarations, across all declarations of the class or interface. Overloads of
            // a merged interface stay in declaration order. Call resolution reorders them.
            let list = if is_late_bound {
                self.members_of_symbol(sym)
            } else {
                members_among(&self.files().decls_of(sym))
            };
            let symbol_flags = if is_late_bound {
                self.flags_of_property(sym)
            } else {
                files.flags(sym)
            };
            let prop = Prop {
                name,
                flags: self.flags_of_declarations(&list, symbol_flags),
                source: PropSource::Symbol(sym),
                mapper: MapperId::IDENTITY,
                name_type: TypeId::UNRESOLVED,
            };
            match b.position(name) {
                None => b.add_new(prop),
                // A symbol that `declareSymbolEx` or `mergeSymbol` rejected isn't in any table.
                // Between an early-bound and a late-bound symbol, the late-bound one is rejected,
                // wherever it's declared.
                Some(i) if b.shape.props[i].source != prop.source => {
                    let is_late = |source: &PropSource| {
                        matches!(*source, PropSource::Symbol(it)
                            if files.symbol(it).name == known::computed)
                    };
                    if is_late(&b.shape.props[i].source) && !is_late(&prop.source) {
                        b.shape.props[i] = prop;
                    }
                }
                // The same symbol again, in another declaration of the class or interface.
                Some(i) => {
                    let existing_prop = &mut b.shape.props[i];
                    let mut other = prop.flags;
                    // A parameter property and a member with the same name are one symbol.
                    // `symbol.ValueDeclaration` determines its flags.
                    if matches!(files.value_declaration(sym), Some((_, Decl::Member(_)))) {
                        other = std::mem::replace(&mut existing_prop.flags, other);
                    }
                    if other.contains(PropFlags::OPTIONAL)
                        && !existing_prop.flags.contains(PropFlags::OPTIONAL)
                    {
                        let is_method = existing_prop.flags.contains(PropFlags::METHOD);
                        existing_prop.flags |= PropFlags::OPTIONAL;
                        (existing_prop.flags).set(PropFlags::WITHOUT_OPTIONALITY, !is_method);
                    }
                }
            }
        }
    }

    /// True if `m` is a member of an interface or a type literal.
    fn is_declared_outside_classes(&self, file: FileId, m: MemberId) -> bool {
        matches!(
            self.bound(file).member_owner[m.idx()],
            crate::bind::MemberOwner::Interface(_) | crate::bind::MemberOwner::TypeLiteral(_)
        )
    }

    /// `GetContainingClass(node) != nil` for the member `m` of an interface or a type literal.
    pub(super) fn is_signature_inside_a_class(&self, file: FileId, m: MemberId) -> bool {
        use crate::bind::ScopeKind;
        let bound = self.bound(file);
        let mut scope = match bound.member_owner[m.idx()] {
            MemberOwner::TypeLiteral(node) => bound.type_scope[node.idx()],
            MemberOwner::Interface(i) => bound.interface_scope[i.idx()],
            _ => return true,
        };
        while scope.is_some() {
            if matches!(bound.scopes[scope.idx()].kind, ScopeKind::Class(_)) {
                return true;
            }
            scope = bound.scopes[scope.idx()].parent;
        }
        false
    }

    /// The flags of one property, computed from its declarations `list`, which are in source order,
    /// and from `symbol.Flags`.
    fn flags_of_declarations(
        &self,
        list: &[(FileId, MemberId)],
        symbol_flags: SymFlags,
    ) -> PropFlags {
        let kind = |&(f, m): &(FileId, MemberId)| self.hir(f)[m].kind;
        // `getDeclarationModifierFlagsFromSymbol`: the getter determines them, or
        // `ValueDeclaration` if there's no getter.
        let (file, modifier_source) = match symbol_flags.contains(SymFlags::GET_ACCESSOR) {
            true => list
                .iter()
                .copied()
                .find(|d| kind(d) == MemberKind::Getter)
                .unwrap_or(list[0]),
            false => list[0],
        };
        let (first, modifiers) = (
            &self.hir(list[0].0)[list[0].1],
            self.hir(file)[modifier_source].flags,
        );
        let mut flags = Self::member_flags(first, modifiers, symbol_flags);
        // Only class members can be private or protected. Elsewhere the modifier is an error and
        // has no effect.
        if self.is_declared_outside_classes(file, modifier_source) {
            flags.remove(PropFlags::PRIVATE | PropFlags::PROTECTED);
        }
        // `addDeclarationToSymbol`: each declaration adds its flags to the one symbol, so one `?` makes it optional.
        if list
            .iter()
            .any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::OPTIONAL))
        {
            flags |= PropFlags::OPTIONAL;
            // A method includes `undefined` if any of its declarations is optional
            // (`getTypeOfFuncClassEnumModule`), a property if the declaration that determines its
            // type is (`getTypeForVariableLikeDeclaration`). `getTypeOfAccessors` never adds it.
            if !flags.contains(PropFlags::METHOD)
                && (!first.flags.contains(Flags::OPTIONAL)
                    || self.has_get_or_set_accessor(list)
                    || (list.iter()).any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ACCESSOR)))
            {
                flags |= PropFlags::WITHOUT_OPTIONALITY;
            }
        }
        if list.iter().all(|d| kind(d) == MemberKind::Setter) {
            flags |= PropFlags::WRITE_ONLY;
        }
        // `isReadonlySymbol`
        if symbol_flags.intersects(SymFlags::ACCESSOR)
            && !symbol_flags.contains(SymFlags::SET_ACCESSOR)
        {
            flags |= PropFlags::READONLY;
        }
        flags
    }

    /// `isValidIndexKeyType`
    pub(super) fn is_valid_index_key_type(&mut self, ty: TypeId) -> bool {
        if matches!(ty, TypeId::STRING | TypeId::NUMBER | TypeId::SYMBOL)
            || self.is_pattern_literal(ty)
        {
            return true;
        }
        match self.data(ty) {
            TypeData::Intersection(parts) => {
                !self.is_generic(ty) && parts.iter().any(|&t| self.is_valid_index_key_type(t))
            }
            _ => false,
        }
    }

    /// `getTypeOfSymbol(e.Symbol())` for a component of an index signature.
    pub(super) fn type_of_index_component(&mut self, component: IndexComponent) -> TypeId {
        match component {
            IndexComponent::Property(file, p) => self.type_of_literal_prop(file, p),
            IndexComponent::Member(file, m) => {
                let ty = self.type_of_member_declaration(file, m);
                // An optional member may be undefined.
                if self.hir(file)[m].flags.contains(Flags::OPTIONAL) {
                    self.optional_property(ty)
                } else {
                    ty
                }
            }
        }
    }

    /// `getIndexInfosOfIndexSymbol`, for the declarations that `lateBindIndexSignature` has added
    /// to the index symbol: `[k] = v` with a `k` of type string, number or symbol implies an index
    /// signature for that key type, together with the sibling members whose names match that key
    /// type. `b` has the members and index signatures of all the symbol's declarations, and its
    /// properties are the siblings.
    fn add_index_signatures_of_computed_names(&mut self, b: &mut Builder<'s>) {
        let computed = std::mem::take(&mut b.computed_names);
        let Some(&first) = computed.first() else {
            return;
        };
        // A caller that resolves the members while their index signatures are being resolved gets
        // the members without index signatures.
        let mut in_progress = self.declared_index_infos_in_progress.iter();
        if in_progress.any(|it| match (b.declaring, it.3) {
            (Some(own), Some(other)) => own.symbol == other.symbol,
            _ => (it.1, it.2) == first,
        }) {
            return;
        }
        self.declared_index_infos_in_progress.push((
            self.stack.len(),
            first.0,
            first.1,
            b.declaring,
        ));
        self.add_index_signatures_implied_by(b, &computed);
        self.declared_index_infos_in_progress.pop();
    }

    /// `add_index_signatures_of_computed_names` for the members `computed`.
    fn add_index_signatures_implied_by(
        &mut self,
        b: &mut Builder<'s>,
        computed: &[(FileId, MemberId)],
    ) {
        // For string, number and symbol keys.
        let keys = [TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL];
        let (mut has_computed, mut readonly) = ([false; 3], [true; 3]);
        // `propertySymbols` before the siblings, with `isSymbolWithNumericName` and
        // `isSymbolWithSymbolName`.
        let mut declaring: Vec<(IndexComponent, bool, bool)> = Vec::new();
        for &(file, m) in computed {
            let member = &self.hir(file)[m];
            let PropKey::Computed(e) = member.key else {
                continue;
            };
            // `isLateBindableIndexSignature`
            if !self.can_name_a_member(file, e) {
                continue;
            }
            let key = self.type_of_expr(file, e);
            // "Explicit index for key type takes priority"
            if b.shape.index.iter().any(|i| i.key == key) {
                continue;
            }
            // A key that isn't definitely a number or a symbol counts as a string.
            let kind = if self.is_assignable(key, TypeId::NUMBER) {
                1
            } else if self.is_assignable(key, TypeId::SYMBOL) {
                2
            } else {
                let any_key = self.union(&keys);
                if !self.is_assignable(key, any_key) {
                    continue;
                }
                0
            };
            has_computed[kind] = true;
            readonly[kind] &= member.flags.contains(Flags::READONLY);
            // An `any` key can be a number and a symbol.
            let is_symbol = kind == 2 || kind == 1 && self.is_assignable(key, TypeId::SYMBOL);
            declaring.push((IndexComponent::Member(file, m), kind == 1, is_symbol));
        }
        if !has_computed.contains(&true) {
            return;
        }
        // `getObjectLiteralIndexInfo`: the string index signature covers every member that isn't
        // named by a symbol (`isSymbolWithSymbolName`), including those named by a number.
        let mut values: [Vec<TypeId>; 3] = Default::default();
        let mut components: [Vec<IndexComponent>; 3] = Default::default();
        let mut add = |value: TypeId,
                       component: Option<IndexComponent>,
                       is_numeric: bool,
                       is_symbol: bool| {
            for (kind, covers) in [!is_symbol, is_numeric, is_symbol].into_iter().enumerate() {
                if covers && has_computed[kind] {
                    values[kind].push(value);
                    components[kind].extend(component);
                }
            }
        };
        for (component, is_numeric, is_symbol) in declaring {
            let value = self.type_of_index_component(component);
            add(value, Some(component), is_numeric, is_symbol);
        }
        // `getTypeOfSymbol` of a symbol that isn't a property is the error type.
        if b.has_non_property_symbols {
            add(TypeId::ERROR, None, false, false);
        }
        for prop in &b.shape.props {
            let is_symbol = self.atoms().is_symbol_name(prop.name);
            // `symbol.Declarations[0]`
            let first = match prop.source {
                PropSource::Symbol(sym) => self.declarations_of_property(sym).first().copied(),
                _ => None,
            };
            let is_numeric = has_computed[1] && self.is_symbol_with_numeric_name(prop.name, first);
            if !(has_computed[0] && !is_symbol || is_numeric || has_computed[2] && is_symbol) {
                continue;
            }
            let value = self.type_of_prop(prop, MapperId::IDENTITY);
            // `isSymbolWithComputedName`. `["a"]` is stored as a plain name.
            let component = match first {
                Some((file, Decl::Member(m))) => {
                    let hir = self.hir(file);
                    let has_computed_name = matches!(hir[m].key, PropKey::Computed(_))
                        || hir.text.get(hir[m].name_pos as usize) == Some(&b'[');
                    has_computed_name.then_some(IndexComponent::Member(file, m))
                }
                _ => None,
            };
            add(value, component, is_numeric, is_symbol);
        }
        for (kind, key) in keys.into_iter().enumerate() {
            if !has_computed[kind] || b.shape.index.iter().any(|i| i.key == key) {
                continue;
            }
            let value = self.union_reduced(&values[kind]);
            b.shape.index.push(IndexInfo {
                components: self.types().intern_components(&components[kind]),
                ..IndexInfo::new(key, value, readonly[kind])
            });
        }
    }

    /// `isSymbolWithNumericName` for a symbol named `name` whose `Declarations[0]` is `first`.
    fn is_symbol_with_numeric_name(&mut self, name: Atom, first: Option<(FileId, Decl)>) -> bool {
        if self.is_numeric_name(name) {
            return true;
        }
        // `isNumericName`: the text of a non-computed name is the symbol's name.
        let Some((file, Decl::Member(m))) = first else {
            return false;
        };
        let PropKey::Computed(e) = self.hir(file)[m].key else {
            return false;
        };
        // `isNumericComputedName`
        let ty = self.check_computed_property_name(file, e);
        self.is_assignable_to_kind(ty, Self::is_number_like, TypeId::NUMBER, false)
    }

    /// `SymbolName`: `#x` for a private name, and any other name unchanged.
    pub(super) fn written_name(&self, name: Atom) -> &'p [u8] {
        crate::atom::written_name(self.atoms().bytes(name))
    }

    /// `isStaticPrivateIdentifierProperty`
    pub(super) fn is_static_private_name(&self, prop: &Prop) -> bool {
        matches!(self.value_declaration_of_prop(prop), Some((file, Decl::Member(m))) if {
            let member = &self.hir(file)[m];
            matches!(member.key, PropKey::Private(_)) && member.flags.contains(Flags::STATIC)
        })
    }

    /// `isSpreadableProperty`: a property counts as an own property if it isn't a method, an
    /// accessor or a `#x`, or if it isn't declared in a class.
    pub(super) fn is_spreadable_property(&mut self, prop: &Prop) -> bool {
        // Sets `in_class` if any declaration is in a class, and `is_private` if any is named `#x`.
        fn scan_declarations(
            c: &mut Checker<'_, '_>,
            source: &PropSource,
            in_class: &mut bool,
            is_private: &mut bool,
        ) {
            match source {
                PropSource::Symbol(sym) => {
                    for &(file, decl) in c.declarations_of_property(*sym).iter() {
                        let Decl::Member(m) = decl else { continue };
                        *in_class |= matches!(
                            c.bound(file).member_owner[m.idx()],
                            crate::bind::MemberOwner::Class(_)
                        );
                        *is_private |= matches!(c.hir(file)[m].key, PropKey::Private(_));
                    }
                }
                PropSource::Intersected(_, parts) => parts
                    .iter()
                    .for_each(|part| scan_declarations(c, &part.source, in_class, is_private)),
                _ => {}
            }
        }
        let (mut in_class, mut is_private) = (false, false);
        scan_declarations(self, &prop.source, &mut in_class, &mut is_private);
        // `createUnionOrIntersectionProperty`: a property that several members of an intersection
        // have is never a method.
        let kinds = match prop.source {
            PropSource::Intersected(..) => PropFlags::ACCESSOR,
            _ => PropFlags::METHOD | PropFlags::ACCESSOR,
        };
        !in_class || !is_private && !prop.flags.intersects(kinds)
    }

    /// `getTypeWithThisArgument`: `ty` with `this_argument` substituted for `this` in its members.
    /// The argument is appended to a reference's type arguments, where `members` finds it. An
    /// intersection is mapped member by member.
    pub(super) fn type_with_this_argument(&mut self, ty: TypeId, this_argument: TypeId) -> TypeId {
        self.type_with_this_argument_ex(ty, this_argument, false)
    }

    /// With `need_apparent_type`, a type that doesn't take a `this` argument is replaced by its
    /// apparent type.
    pub(super) fn type_with_this_argument_ex(
        &mut self,
        ty: TypeId,
        this_argument: TypeId,
        need_apparent_type: bool,
    ) -> TypeId {
        match self.data(ty) {
            TypeData::Ref { target, args } => {
                // FOR SPEED: every `this.x` in a class asks for the class with the same `this` argument.
                if let Some(known) = self.recent_with_this.get(ty.0, this_argument.0) {
                    return TypeId(known);
                }
                let is_given = args.actual().is_some();
                let declared = self.declared_type(*target);
                let args = self.type_arguments(ty);
                if !matches!(self.data(declared), TypeData::Ref { .. })
                    || self.type_arguments(declared).len() != args.len()
                    || args.is_empty() && !self.has_this_type(*target)
                {
                    return ty;
                }
                let with_this: SmallVec<[TypeId; 8]> =
                    args.iter().copied().chain([this_argument]).collect();
                let result = self.intern_key(TypeKey::Ref {
                    target: *target,
                    args: &with_this,
                });
                // Same rule as for `recent_instantiations`. Deferred type arguments can still change.
                if is_given && (ty.is_local() || this_argument.is_local() || !result.is_local()) {
                    (self.recent_with_this).put(ty.0, this_argument.0, result.0);
                }
                result
            }
            TypeData::Intersection(parts) => {
                let with_this: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| {
                        self.type_with_this_argument_ex(part, this_argument, need_apparent_type)
                    })
                    .collect();
                // The reference created for a tuple is a different type, so the intersection is
                // too.
                if with_this[..] == parts[..] && !parts.iter().any(|&part| self.is_tuple(part)) {
                    ty
                } else {
                    self.intersection(&with_this)
                }
            }
            // A tuple has no slot for the argument. The recreated reference has no alias.
            TypeData::Tuple { .. } => self.without_alias_of_reference(ty),
            _ if need_apparent_type => self.apparent_type(ty),
            _ => ty,
        }
    }

    /// True if the declared type of the class or interface `sym` is a type reference, which has a
    /// `thisType` (`getDeclaredTypeOfClassOrInterface`).
    pub(super) fn has_this_type(&mut self, sym: Sym) -> bool {
        if self.files().flags(sym).contains(SymFlags::CLASS) {
            return true;
        }
        if let Some(&known) = self.this_types.get(&sym) {
            return known;
        }
        // `links.declaredType` is assigned first, so an interface that extends itself finds its
        // type without a `thisType`.
        self.this_types.insert(sym, false);
        self.this_types_in_progress.push(sym);
        let has_this_type = !self.local_type_params_of_symbol(sym).is_empty()
            || !self.outer_type_params_of_symbol(sym).is_empty()
            || !self.is_thisless_interface(sym);
        self.this_types_in_progress.pop();
        self.this_types.insert(sym, has_this_type);
        has_this_type
    }

    /// `thisArgument` of `getTypeWithThisArgument(base, t.thisType)`, where `t` is `sym`'s declared type. If `t` has no
    /// `thisType`, it's the `thisType` of `base`'s target.
    pub(super) fn this_argument_for_base_type(&mut self, sym: Sym, base: TypeId) -> TypeId {
        let has_this_type = self.has_this_type(sym);
        let owner = match *self.data(base) {
            TypeData::Ref { target, .. } if !has_this_type => target,
            _ => sym,
        };
        self.intern(TypeData::ThisParam(owner))
    }

    /// `isThislessInterface`
    fn is_thisless_interface(&mut self, sym: Sym) -> bool {
        for (file, decl) in self.files().decls_of(sym) {
            let Decl::Interface(i) = decl else { continue };
            let (hir, bound) = (self.hir(file), self.bound(file));
            if bound.interface_contains_this[i.idx()] {
                return false;
            }
            for node in hir.ids(hir[i].extends) {
                // `ast.IsEntityNameExpression(node.Expression())`
                let TypeNodeKind::Ref { name, .. } = hir[node].kind else {
                    continue;
                };
                let scope = bound.type_scope[node.idx()];
                let base = self.resolve_type_reference_name(file, scope, name, true);
                if !base.is_some_and(|base| {
                    self.files().flags(base).contains(SymFlags::INTERFACE)
                        && !self.has_this_type(base)
                }) {
                    return false;
                }
            }
        }
        true
    }

    /// `resolveTypeReferenceMembers` for a tuple: the shape `createTupleTargetType` builds, cached
    /// per element flags, and the mapper for its type parameters and for `this`. `None` if `ty`
    /// isn't a tuple.
    fn tuple_members(
        &mut self,
        ty: TypeId,
        this_argument: TypeId,
    ) -> Option<(Built<'p>, MapperId)> {
        let TypeData::Tuple {
            flags, readonly, ..
        } = self.data(ty)
        else {
            return None;
        };
        let mut pairs: SmallVec<[(TypeId, TypeId); 8]> = SmallVec::new();
        let arguments = self.type_arguments(ty);
        for (i, &argument) in (0..).zip(arguments) {
            let parameter = self.intern(TypeData::Marker(Marker::TupleElement(i)));
            pairs.push((parameter, argument));
        }
        let parameters: Vec<TypeId> = pairs.iter().map(|pair| pair.0).collect();
        let this = self.intern(TypeData::Marker(Marker::TupleThis));
        // Labels don't change the members, so tuples that differ only in labels share one shape.
        let flags: SmallVec<[ElemFlags; 8]> = (flags.iter())
            .map(|flags| flags.with_label(LabeledDeclaration::NONE))
            .collect();
        let target = self.intern_key(TypeKey::Tuple {
            elems: &parameters,
            flags: &flags,
            readonly: *readonly,
        });
        let mut resolved = self.shape_memo(target, |c| {
            c.build_tuple_shape(this, &parameters, &flags, *readonly)
        });
        // The mapper is built from `arguments`, which are provisional unless they're the stored
        // ones.
        if self.resolved_type_arguments(ty) != Some(arguments) {
            resolved.store_handle = None;
        }
        pairs.push((this, this_argument));
        Some((resolved, self.types().mapper_of(&pairs)))
    }

    /// `resolveStructuredTypeMembers(getTypeWithThisArgument(ty, this_argument))`
    fn members_with_this(&mut self, ty: TypeId, this_argument: TypeId) -> Option<Members<'p>> {
        self.type_and_members_with_this(ty, this_argument).1
    }

    /// `members_with_this`, plus `getTypeWithThisArgument(ty, this_argument)`. For a tuple that's `ty`, which has no
    /// slot for the argument.
    fn type_and_members_with_this(
        &mut self,
        ty: TypeId,
        this_argument: TypeId,
    ) -> (TypeId, Option<Members<'p>>) {
        if let Some((built, mapper)) = self.tuple_members(ty, this_argument) {
            let members = Members {
                resolved: built.resolved,
                mapper,
            };
            return (ty, Some(members));
        }
        let ty = self.type_with_this_argument(ty, this_argument);
        (ty, self.members(ty))
    }

    /// `resolveStructuredTypeMembers(apparent)`, where `apparent` is `getApparentType(ty)`.
    /// `getApparentType` passes the type variable `ty` as the `this` argument to a base constraint
    /// that's a reference, and to the reference that the members of an intersection become. That intersection is the
    /// base constraint or `ty` itself. A tuple has no slot for it. No other apparent type gets a `this` argument.
    fn members_of_apparent_type(&mut self, ty: TypeId, apparent: TypeId) -> Option<Members<'p>> {
        if ty != apparent && self.is_tuple(apparent) {
            let is_passed = if self.is_deferred(ty) {
                let constraint = self.base_constraint(ty);
                self.is_tuple(constraint) || self.is_intersection(constraint)
            } else {
                self.is_intersection(ty)
            };
            if is_passed {
                let this_argument = ty;
                return self.members_with_this(apparent, this_argument);
            }
        }
        self.members(apparent)
    }

    /// The members `resolveObjectTypeMembers` inherits from one base type.
    fn inherit(&mut self, b: &mut Builder<'s>, base: TypeId, this: Option<TypeId>) {
        // `anyBaseTypeIndexInfo`
        if base == TypeId::ANY {
            if !b.shape.index.iter().any(|i| i.key == TypeId::STRING) {
                b.shape
                    .index
                    .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
            }
            return;
        }
        // `instantiatedBaseType`: `this` in an inherited member is the derived type. This step comes first, because in
        // an intersection's apparent type `this` is the intersection.
        let base = match this {
            Some(this_param) => self.type_with_this_argument(base, this_param),
            None => base,
        };
        // `getPropertiesOfType`, `getSignaturesOfType` and `getIndexInfosOfType` work on
        // `getReducedApparentType`. For a union that means the members common to all its
        // constituents.
        let base = self.reduced_apparent_type_as_object(base);
        // A tuple has no slot for the argument.
        let members = match this {
            Some(this_param) => self.members_with_this(base, this_param),
            None => self.members(base),
        };
        let Some(members) = members else { return };
        let mapper = members.mapper;
        b.reserve(members.shape().props.len());
        // The mapper of the most recent property that had its own mapper, whether that property is
        // a member, and the mapper's composition with `mapper`.
        let mut composed = (MapperId::IDENTITY, true, mapper);
        for prop in &members.shape().props {
            if b.has(prop.name) {
                continue;
            }
            let mut prop = prop.clone_in(self.arena);
            if self.types().separate_key(&prop).is_some() {
                self.compose_mapper_of_prop(&mut prop, mapper);
                // The composed mapper includes the property's key, so no other property shares it.
                composed = (MapperId::IDENTITY, true, mapper);
                b.add_new(prop);
                continue;
            }
            match &mut prop.source {
                PropSource::Type(t) | PropSource::Copy(t, ..) => *t = self.instantiate(*t, mapper),
                // `instantiateSymbol` returns the symbol unchanged. A symbol that it instantiated
                // for a base type has a mapper.
                PropSource::Symbol(_) if prop.flags.contains(PropFlags::THISLESS) => {}
                &mut PropSource::Symbol(sym)
                    if prop.mapper == MapperId::IDENTITY
                        && self.is_thisless_for_this_mapper(sym) =>
                {
                    prop.flags |= PropFlags::THISLESS;
                }
                source => {
                    let is_member = matches!(source, PropSource::Symbol(_));
                    if prop.mapper == MapperId::IDENTITY {
                        prop.mapper = mapper;
                    } else {
                        if (prop.mapper, is_member) != (composed.0, composed.1) {
                            // A member's mapper maps the type parameters of the class or interface
                            // that declares it, and `mapper` maps those of `base`, which the
                            // declaration can't mention. A plain composition would grow with every
                            // level.
                            let both = match is_member {
                                true => self.map_mapper(prop.mapper, mapper),
                                false => self.compose(prop.mapper, mapper),
                            };
                            composed = (prop.mapper, is_member, both);
                        }
                        prop.mapper = composed.2;
                    }
                }
            }
            b.add_new(prop);
        }
        let members = match self.data(base) {
            TypeData::Intersection(_) => match self.structured_members(base) {
                Some(members) => members,
                None => return,
            },
            _ => members,
        };
        for &sig in members.call_signatures() {
            let sig = self.instantiate_sig(sig, mapper);
            b.shape.call.push(sig);
        }
        for &sig in members.construct_signatures() {
            let sig = self.instantiate_sig(sig, mapper);
            b.shape.construct.push(sig);
        }
        for info in members.index_infos() {
            if b.shape.index.iter().any(|i| i.key == info.key) {
                continue;
            }
            let value = self.instantiate(info.value, mapper);
            b.shape.index.push(IndexInfo { value, ..*info });
        }
    }

    /// True if, for the class or interface `sym`, "the members of a base type, instantiated" can
    /// differ from "the members of the instantiated base type". That's the case if a base type is a
    /// type parameter (`isValidBaseType`), a generic intersection, which `getReducedType` can turn
    /// into `never`, a tuple with a `...T` (`createNormalizedTupleType`), or an instantiation of
    /// such a class or interface with a generic type argument.
    fn inherits_from_type_arguments(&mut self, sym: Sym) -> bool {
        for &base in self.base_types(sym).iter() {
            let is_keyed_by_arguments = match self.data(base) {
                TypeData::TypeParam(..) => true,
                TypeData::Intersection(_) => self.has_type_variables(base),
                TypeData::Tuple { flags, .. } => {
                    flags.iter().any(|it| it.contains(ElemFlags::VARIADIC))
                }
                &TypeData::Ref { target, .. } => {
                    target != sym
                        && self.has_type_variables(base)
                        && self.inherits_from_type_arguments(target)
                }
                _ => false,
            };
            if is_keyed_by_arguments {
                return true;
            }
        }
        false
    }

    /// True if a mapped type whose members are being resolved is a base type of the class or interface `sym`, or of one
    /// of its base types. `resolveMappedTypeMembers` starts with no members in place.
    fn has_base_type_in_progress(&mut self, sym: Sym) -> bool {
        if self.mapped_types_in_progress.is_empty() {
            return false;
        }
        let in_progress = self.mapped_types_in_progress.clone();
        self.has_base_type_among(sym, &in_progress)
    }

    /// The members of `part`, a constituent of the intersection `whole`, for deciding whether `whole` is `never`.
    ///
    /// In `interface D extends Pick<D & E, "e">`, resolving the mapped type's members requests
    /// `getApparentType(D & E)`, in which `D` has `D & E` as `this`. The members found for that intersection aren't the
    /// ones a later request for `D & E` itself gets.
    fn members_for_reduction(&mut self, part: TypeId, whole: TypeId) -> Option<Members<'p>> {
        if let TypeData::Ref { target, .. } = *self.data(part)
            && self.has_base_type_in_progress(target)
        {
            self.note_members_in_place();
            return self.members_with_this(part, whole);
        }
        self.members(part)
    }

    fn has_base_type_among(&mut self, sym: Sym, types: &[TypeId]) -> bool {
        for &base in self.base_types(sym).iter() {
            let is_among = types.contains(&base)
                || matches!(*self.data(base), TypeData::Ref { target, .. }
                    if target != sym && self.has_base_type_among(target, types));
            if is_among {
                return true;
            }
        }
        false
    }

    /// The instance shape of a class or interface, with its own type parameters instantiated by
    /// `under` (`mapper` of `resolveObjectTypeMembers`). `in_place` is the key the shape is stored
    /// under (see `inheriting`). `resolving` is `t` of `resolveObjectTypeMembers`, or `None` for
    /// just `resolveDeclaredMembers`.
    fn build_declared_shape(
        &mut self,
        sym: Sym,
        under: MapperId,
        binding: MemberBinding,
        base_members: BaseMembers,
        in_place: Option<TypeId>,
        resolving: Option<TypeId>,
    ) -> Shape<'s> {
        let mut b = Builder::new_in(self.arena);
        let declaring = Declaring {
            symbol: sym,
            resolving,
        };
        b.declaring = Some(declaring);
        let binding = self.binding_of_side(sym, false, binding);
        let is_late = binding == MemberBinding::Late;
        if is_late {
            self.declared_members_in_progress.push(declaring);
        }
        let reads_names = is_late && self.begin_late_binding(sym, false);
        for (file, decl) in self.files().decls_of(sym) {
            let Some(members) = decl.members_of_class_or_interface(self.hir(file)) else {
                continue;
            };
            if !self.is_declaration_of_symbol(sym, file, decl) {
                continue;
            }
            self.add_members(&mut b, file, members, ClassSide::Instance, binding);
            if let Decl::Class(c) = decl {
                self.add_this_properties(&mut b, file, c, false);
            }
        }
        if reads_names {
            self.late_binding.pop();
        }
        if is_late {
            self.declared_members_in_progress.pop();
        }
        self.add_index_signatures_of_computed_names(&mut b);
        // `thisArgument`: `resolveClassOrInterfaceMembers` has none.
        let mut this = self
            .has_this_type(sym)
            .then(|| self.intern(TypeData::ThisParam(sym)));
        if under != MapperId::IDENTITY {
            // `instantiateSymbolTable`, `instantiateSignatures`, `instantiateIndexInfos`
            for prop in &mut b.shape.props {
                self.instantiate_prop(prop, under);
            }
            for sig in (b.shape.call.iter_mut()).chain(b.shape.construct.iter_mut()) {
                *sig = self.instantiate_sig(*sig, under);
            }
            for info in &mut b.shape.index {
                info.value = self.instantiate(info.value, under);
            }
            if let Some(this_argument) = &mut this {
                *this_argument = self.instantiate(*this_argument, under);
            }
        }
        // `baseTypes := c.getBaseTypes(source)` of `resolveObjectTypeMembers`
        self.resolving_at_base_types.extend(resolving);
        let bases = self.base_types(sym);
        if resolving.is_some() {
            self.resolving_at_base_types.pop();
        }
        let own = b.shape.props.len();
        let inherits = base_members == BaseMembers::Inherited;
        self.inheriting.extend(in_place.zip(resolving));
        for base in bases.iter().copied().filter(|_| inherits) {
            let base = self.instantiate(base, under);
            self.inherit(&mut b, base, this);
        }
        if in_place.is_some() {
            self.inheriting.pop();
        }
        // `getNamedMembers`: the members declared here, then the inherited ones, each in the order
        // of `compareSymbols`.
        let ranges = if own < b.shape.props.len() {
            self.ranges_of_declarations(sym)
        } else {
            Vec::new()
        };
        self.get_named_members(&mut b.shape.props, |i| i < own, &ranges);
        b.shape
    }

    /// `getNamedMembers`: sorts `props` into the order in which TypeScript stores a resolved type's
    /// properties. Properties contained in the declarations of the class or interface come first,
    /// then the rest, each in `compareSymbols` order: by position of the first declaration, with
    /// those without a declaration last, then by name. `is_contained` returns true if the property
    /// at an index is known to be contained. The others are tested with `isDeclarationContainedBy`
    /// and `ranges`. For a type that isn't a class or interface, every property is contained.
    pub(super) fn get_named_members(
        &mut self,
        props: &mut ArenaVec<'s, Prop<'s>>,
        is_contained: impl Fn(usize) -> bool,
        ranges: &[(u32, u32)],
    ) {
        if props.len() < 2 {
            return;
        }
        let atoms = &self.atoms();
        let mut keyed = Vec::with_capacity(props.len());
        for (i, prop) in props.drain(..).enumerate() {
            let is_outside =
                !is_contained(i) && !self.is_within_ranges_of_declarations(&prop, ranges);
            let (is_undeclared, declaration_position) = self.order_of_property(&prop);
            keyed.push((
                (
                    is_outside,
                    is_undeclared,
                    declaration_position,
                    atoms.bytes(prop.name),
                ),
                prop,
            ));
        }
        keyed.shared_sort_by(|x, y| x.0.cmp(&y.0));
        props.extend(keyed.into_iter().map(|entry| entry.1));
    }

    /// `Loc` of each declaration of the class or interface `sym`.
    fn ranges_of_declarations(&self, sym: Sym) -> Vec<(u32, u32)> {
        let mut ranges = Vec::new();
        for (file, decl) in self.files().decls_of(sym) {
            match (decl, self.files().loc_of_declaration(file, decl)) {
                (Decl::Class(_) | Decl::Interface(_), Some(loc)) => ranges.push((loc.pos, loc.end)),
                (Decl::Class(class), None) => ranges.push((
                    self.end_of_token_before(file, self.hir(file)[class].start),
                    self.end_of_class(file, class),
                )),
                _ => {}
            }
        }
        ranges
    }

    /// `isDeclarationContainedBy`: true if `prop`'s `symbol.ValueDeclaration` lies within one of `ranges`. Only
    /// positions are compared, regardless of which files they're in.
    fn is_within_ranges_of_declarations(&self, prop: &Prop, ranges: &[(u32, u32)]) -> bool {
        let is_near = |pos: u32| ranges.iter().any(|&(from, to)| from <= pos && pos < to);
        let (start, end) = match self.value_declaration_of_prop(prop) {
            Some((file, Decl::ParameterProperty(parameter))) => {
                let pos = self.hir(file)[parameter].pos;
                if !is_near(pos) {
                    return false;
                }
                (
                    self.hir(file)[parameter].loc.pos,
                    self.end_of_param(file, parameter),
                )
            }
            Some((file, Decl::Member(member))) => {
                if !is_near(self.hir(file)[member].name_pos) {
                    return false;
                }
                let loc = self.hir(file)[member].loc;
                (loc.pos, loc.end)
            }
            _ => return false,
        };
        ranges.iter().any(|&(from, to)| from <= start && end <= to)
    }

    /// `declareSymbolEx`: a class or interface whose name conflicts is listed with the symbol that
    /// owns the name, but is a separate symbol.
    fn is_declaration_of_symbol(&self, sym: Sym, file: FileId, decl: Decl) -> bool {
        let bound = self.bound(file);
        let own = match decl {
            Decl::Class(c) => bound.class_symbol[c.idx()],
            Decl::Interface(i) => bound.interface_symbol[i.idx()],
            _ => return true,
        };
        let (whole, own_symbol) = (self.files().canonical(sym), Sym { file, id: own });
        // A symbol that was merged into `whole` is one of its parts, of which there can be thousands.
        own.is_none()
            || self.files().canonical(own_symbol) == whole
            || self.files().parts(whole).contains(&own_symbol)
    }

    /// The declaration of class `sym` that has the `extends` clause.
    fn extending_declaration(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        self.files()
            .decls_of(sym)
            .into_iter()
            .find_map(|(file, decl)| match decl {
                Decl::Class(c)
                    if self.hir(file)[c].extends.is_some()
                        && self.is_declaration_of_symbol(sym, file, decl) =>
                {
                    Some((file, c))
                }
                _ => None,
            })
    }

    /// `getBaseConstructorTypeOfClass`: the type of the expression in the `extends` clause of class
    /// `class`. `undefined` if it has no `extends` clause, the error type if the expression depends
    /// on the class (2506) or its type isn't a constructor type (2507).
    pub(super) fn base_constructor_type_of_class(&mut self, class: Sym) -> TypeId {
        if let Some(known) = self.p.base_constructor_types.get(&self.task, &class) {
            return known;
        }
        // This scope encloses the resolution frame, because `isConstructorType` is evaluated after
        // `popTypeResolution` and the result depends on it too.
        let scope = self.begin_scope();
        let Some((file, c)) = self.extending_declaration(class) else {
            return match self.end_scope(scope) {
                Ok(stored) => (self.p.base_constructor_types).insert(
                    &self.task,
                    class,
                    TypeId::UNDEFINED,
                    stored,
                ),
                Err(_) => TypeId::UNDEFINED,
            };
        };
        if !self.enter(Query::BaseConstructor(class)) {
            let fallback = if self.found_cycle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
            let _ = self.end_scope(scope);
            return fallback;
        }
        // `checkExpression`, not `checkExpressionCached`: this resolution and the base types resolution right below it
        // don't hide any loop from the expression.
        let resolutions = self.resolutions_below(self.stack.len());
        self.quick_initializers.push(resolutions);
        let constructor = self.type_of_expr(file, self.hir(file)[c].extends);
        // `resolveStructuredTypeMembers`: the members of a class need its base constructor type, so
        // a cycle is detected here.
        let _ = self.members(constructor);
        self.quick_initializers.pop();
        let is_frame_cacheable = self.leave(Query::BaseConstructor(class)).is_ok();
        if self.left_a_cycle {
            let stored = (self.end_scope_as(scope, false)).unwrap_or_else(|_| self.cycle_result());
            // `t.symbol.ValueDeclaration`, which is the function if one is merged with the class.
            let declaration = self.files().value_declaration(class);
            let range = declaration.and_then(|(of, declaration)| {
                let (start, end) = self.error_range_of_declaration(of, declaration)?;
                Some((of, start, end))
            });
            let at = range.unwrap_or_else(|| {
                let (start, end) = self.error_range_of_class(file, c);
                (file, start, end)
            });
            let err = self.new_diagnostic(at, 2506, &[Arg::Sym(class)]);
            self.add_diagnostic_of(Some(Query::BaseConstructor(class)), err);
            let error = TypeId::ERROR;
            return self
                .p
                .base_constructor_types
                .insert(&self.task, class, error, stored);
        }
        let ty = if constructor == self.null_widening()
            || self.has_any_flag(constructor)
            || self.is_constructor_type(constructor)
        {
            constructor
        } else {
            if let Some(at) = self.span_to_report_base_at(file, c) {
                // `TypeToString` comes before `data.resolvedBaseConstructorType` is assigned. If it
                // leads back here the type is resolved and printed again, which closes a cycle
                // through what the first printing is resolving:
                // `const a = f(class extends (() => a) {})` is 7022 and 7024 too.
                let mut err = self.new_diagnostic(at, 2507, &[Arg::Type(constructor)]);
                if let TypeData::TypeParam(of, tp, _) = *self.data(constructor) {
                    let constraint = self.constraint_of_type_param(constructor);
                    let first = constraint.and_then(|t| self.signatures(t, true).first().copied());
                    let returned = first.map_or(TypeId::UNKNOWN, |sig| self.sig_return(sig));
                    let at = self.span_of_type_parameter_declaration(of, tp);
                    let args = [Arg::Atom(self.hir(of)[tp].name), Arg::Type(returned)];
                    let related = self.new_diagnostic(at, 2735, &args);
                    err.add_related_info(related);
                }
                if is_frame_cacheable {
                    self.add_diagnostic_of(Some(Query::BaseConstructor(class)), err);
                }
            }
            TypeId::ERROR
        };
        // `if data.resolvedBaseConstructorType == nil`. It's stored exactly when the frame was
        // cacheable.
        match self.end_scope_as(scope, !is_frame_cacheable) {
            Ok(stored) => self
                .p
                .base_constructor_types
                .insert(&self.task, class, ty, stored),
            Err(_) => (self.p.base_constructor_types.get(&self.task, &class)).unwrap_or(ty),
        }
    }

    /// `classDeclarationExtendsNull`
    pub(super) fn class_declaration_extends_null(&mut self, class: Sym) -> bool {
        self.base_constructor_type_of_class(class) == self.null_widening()
    }

    /// `isConstructorType`
    fn is_constructor_type(&mut self, ty: TypeId) -> bool {
        if !self.signatures(ty, true).is_empty() {
            return true;
        }
        if !self.is_type_variable(ty) {
            return false;
        }
        let Some(constraint) = self.base_constraint_of(ty) else {
            return false;
        };
        let sigs = self.signatures(constraint, true);
        self.is_mixin_constructor_type(&sigs)
    }

    /// `resolveAnonymousTypeMembers`: true if the base constructor type of class `sym` is `any` itself.
    fn extends_any(&mut self, sym: Sym) -> bool {
        self.extending_declaration(sym).is_some()
            && self.base_constructor_type_of_class(sym) == TypeId::ANY
    }

    fn sigs_of_function_declarations(&mut self, sym: Sym) -> ArenaVec<'s, SigId> {
        let decls: Vec<(FileId, FnId)> = self
            .files()
            .decls_of(sym)
            .into_iter()
            .filter_map(|(file, d)| match d {
                Decl::Fn(f) => Some((file, f)),
                _ => None,
            })
            .collect();
        let mut sigs = ArenaVec::with_capacity_in(decls.len(), self.arena);
        for (i, &(file, f)) in decls.iter().enumerate() {
            // `getSignaturesOfSymbol`: a declaration with a body that immediately follows another
            // declaration of the function is the implementation of the preceding overloads.
            if i > 0
                && has_body(&self.hir(file)[f])
                && decls[i - 1].0 == file
                && self.is_next_statement(file, decls[i - 1].1, f)
            {
                continue;
            }
            sigs.push(self.sig_of_declaration(file, f));
        }
        sigs
    }

    /// `getSignaturesOfSymbol` for two methods with the same name or two constructors. True if `m`
    /// is "the implementation of an overloaded function", which isn't a signature itself. It "has a
    /// body and the previous node is of the same kind and immediately precedes" it: "has the same
    /// parent and ends where the implementation starts", or is synthesized from an `@overload` tag.
    fn is_implementation_after(&self, file: FileId, previous: MemberId, m: MemberId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        has_body(&hir[hir[m].func])
            && bound.member_owner[previous.idx()] == bound.member_owner[m.idx()]
            && (hir[m].loc.pos == hir[previous].loc.end
                || hir[previous].flags.contains(Flags::REPARSED))
    }

    /// The same for two declarations of a function, without the check for a body.
    pub(super) fn is_next_statement(&self, file: FileId, previous: FnId, f: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (FnOwner::Stmt(before), FnOwner::Stmt(s)) =
            (bound.fns[previous.idx()].owner, bound.fns[f.idx()].owner)
        else {
            return false;
        };
        bound.parent_of_stmt(before) == bound.parent_of_stmt(s)
            && (hir[s].loc.pos == hir[before].loc.end
                || hir[previous].flags.contains(Flags::REPARSED))
    }

    /// `hasBaseType`: true if `ty` is any instantiation of `sym` or has one as a base type. This is
    /// why `class C<T> extends C<T[]>` has no base type.
    pub(super) fn has_base(&mut self, ty: TypeId, sym: Sym) -> bool {
        // FOR SPEED: a target that several paths lead to is visited once.
        let mut seen: SmallVec<[Sym; 16]> = SmallVec::new();
        // The targets seen after the first 16.
        let mut seen_later = crate::util::FxHashSet::<Sym>::default();
        // Depth first: the last entry is visited next.
        let mut todo: SmallVec<[TypeId; 16]> = smallvec![ty];
        while let Some(next) = todo.pop() {
            match *self.data(next) {
                TypeData::Ref { target, .. } => {
                    if target == sym {
                        return true;
                    }
                    let is_new = !seen.contains(&target)
                        && if seen.len() < seen.inline_size() {
                            seen.push(target);
                            true
                        } else {
                            seen_later.insert(target)
                        };
                    if is_new {
                        todo.extend(self.base_types(target).iter().rev().copied());
                    }
                }
                // `getBaseTypes` of a tuple target is `getTupleBaseType`.
                TypeData::Tuple {
                    ref flags,
                    readonly,
                    ..
                } => {
                    let elems = self.type_arguments(next);
                    todo.push(self.tuple_base_type(elems, flags, readonly));
                }
                TypeData::Intersection(ref parts) => todo.extend(parts.iter().rev().copied()),
                _ => {}
            }
        }
        false
    }

    /// `getBaseTypes`: the base types of a class or interface, in terms of its own type parameters.
    pub fn base_types(&mut self, sym: Sym) -> List<'p, TypeId> {
        if let Some(known) = self.p.base_types.get_ref(&self.task, &sym) {
            return List::Permanent(known);
        }
        if !self.enter(Query::Bases(sym)) {
            return self.base_types_in_progress(sym);
        }
        let so_far = self.base_types_so_far.len();
        self.base_types_so_far.push((sym, Vec::new()));
        // `resolveBaseTypesOfClass`: the base class comes first, whichever declaration has the
        // `extends` clause.
        if let Some((file, c)) = self.extending_declaration(sym) {
            let base = self.base_instance_type(sym, file, c);
            let valid = self.as_base_type(base, |checker, reduced, unreduced| {
                let Some(at) = checker.span_to_report_base_at(file, c) else {
                    return;
                };
                let chain = checker.elaborate_never_intersection(None, at, unreduced);
                let args = [Arg::Type(reduced)];
                let diagnostic = checker.new_diagnostic_chain(chain, at, 2509, &args);
                checker.add_diagnostic(diagnostic);
            });
            if let Some(base) = valid {
                if !self.has_base(base, sym) {
                    self.base_types_so_far[so_far].1.push(base);
                } else if let Some((file, declaration)) = self.files().value_declaration(sym)
                    && let Some(err) = self.circular_base_type(sym, file, declaration)
                {
                    // `resolveBaseTypesOfClass` reports at `t.symbol.ValueDeclaration`.
                    self.add_diagnostic(err);
                }
            }
        }
        // `resolveBaseTypesOfInterface`
        for (file, decl) in self.files().decls_of(sym) {
            let Decl::Interface(i) = decl else { continue };
            let hir = self.hir(file);
            for node in hir.ids(hir[i].extends) {
                // A base that isn't of the form `A.B<C>` has the error type (2499), which is
                // skipped.
                if matches!(
                    hir[node].kind,
                    TypeNodeKind::Error | TypeNodeKind::Heritage { .. }
                ) {
                    continue;
                }
                let base = self.type_from_node(file, node);
                let valid = self.as_base_type(base, |checker, _, _| {
                    let at = (file, hir[node].pos, checker.end_of_type_node(file, node));
                    checker.error_at(at, 2312, &[]);
                });
                let Some(base) = valid else { continue };
                if !self.has_base(base, sym) {
                    self.base_types_so_far[so_far].1.push(base);
                } else if let Some(err) = self.circular_base_type(sym, file, decl) {
                    self.add_diagnostic(err);
                }
            }
        }
        let left = self.leave(Query::Bases(sym));
        let in_cycle = self.left_a_cycle;
        // `data.baseTypesResolved = true`, even with a loop on `flowLoopStack`.
        let left = match left {
            Err(open) if !in_cycle => (self.incomplete_flow_result(Query::Bases(sym))).ok_or(open),
            left => left,
        };
        debug_assert_eq!(self.base_types_so_far.len(), so_far + 1);
        // `t.objectFlags &^= ObjectFlagsMembersResolved`
        self.members_resolved_before_base_types
            .retain(|it| it.2 < so_far);
        let bases = self
            .base_types_so_far
            .pop()
            .map_or_else(Vec::new, |it| it.1);
        let bases = match left {
            Ok(stored) => {
                let bases = self.list(&bases);
                List::Permanent(self.p.base_types.insert_ref(&self.task, sym, bases, stored))
            }
            // See `base_types_in_progress`.
            Err(_) => match self.p.base_types.get_ref(&self.task, &sym) {
                Some(known) => List::Permanent(known),
                None => List::Own(bases),
            },
        };
        // `popTypeResolution`: they were requested again while being resolved. The error is
        // reported at every class declaration and every interface declaration of the name,
        // regardless of which one has which base type.
        if in_cycle {
            (self.p.circular_base_types).insert(&self.task, sym, (), Stored::new());
            for (file, decl) in self.files().decls_of(sym) {
                let is_declaration = match decl {
                    Decl::Class(c) => matches!(
                        self.bound(file).class_owner[c.idx()],
                        crate::bind::ClassOwner::Stmt(_)
                    ),
                    Decl::Interface(_) => true,
                    _ => false,
                };
                if is_declaration && let Some(err) = self.circular_base_type(sym, file, decl) {
                    self.add_diagnostic_of(Some(Query::Bases(sym)), err);
                }
            }
        }
        bases
    }

    /// `getBaseTypes(sym)` when `pushTypeResolution` fails. `hasBaseType` rejects the base type that closes the cycle,
    /// so the base types of every member of the cycle depend on which member is resolved first. With one checker that's
    /// the first one requested in program order. A task doesn't know what the files before its own file request, but
    /// `checkSourceFile` requests the base types of every class and interface it visits. So the member that those files
    /// declare first is resolved first, above a `resolution_start` barrier. The cycle's frames below the barrier are
    /// tainted, except for `sym`'s, and `base_types` returns the stored value for them.
    #[cold]
    fn base_types_in_progress(&mut self, sym: Sym) -> List<'p, TypeId> {
        let own = self.task.file.filter(|_| self.found_cycle);
        let from = self.resolution_start.min(self.stack.len());
        let head = self.stack[from..]
            .iter()
            .rposition(|&q| q == Query::Bases(sym));
        // `return data.resolvedBaseTypes`
        let mut in_progress = self.base_types_so_far.iter().rev();
        let so_far = in_progress.find(|it| it.0 == sym);
        let so_far = so_far.map_or_else(List::default, |it| List::Own(it.1.clone()));
        let (Some(own), Some(head)) = (own, head) else {
            return so_far;
        };
        let before = self.files().rank_of_file(own);
        let members = self.stack[from + head..].iter().filter_map(|&q| match q {
            Query::Bases(member) => Some((
                self.first_declaration_checked_before(member, before)?,
                member,
            )),
            _ => None,
        });
        match members.min_by_key(|member| member.0) {
            Some((_, first)) if first != sym => {
                let height = self.stack.len();
                let resolution_start = std::mem::replace(&mut self.resolution_start, height);
                self.base_types(first);
                self.resolution_start = resolution_start;
                let known = self.p.base_types.get_ref(&self.task, &sym);
                known.map_or_else(List::default, |known| List::Permanent(known))
            }
            _ => so_far,
        }
    }

    /// True if `ty` refers to a class or interface whose base types are being resolved. Every request in the meantime
    /// sees the members that follow from `resolvedBaseTypes` so far.
    pub(super) fn are_base_types_in_progress(&self, ty: TypeId) -> bool {
        matches!(*self.data(ty), TypeData::Ref { target, .. }
            if self.base_types_so_far.iter().any(|it| it.0 == target))
    }

    /// The position in check order of `sym`'s first class or interface declaration, among the files
    /// that `checkSourceFile` visits before the file with rank `before`.
    fn first_declaration_checked_before(&self, sym: Sym, before: u32) -> Option<(u32, u32)> {
        let declarations = self.files().decls_of(sym).into_iter();
        let check_positions = declarations.filter_map(|(file, declaration)| {
            let start = declaration.name_pos_of_class_or_interface(self.hir(file))?;
            let rank = self.files().rank_of_file(file);
            (rank < before && self.reports_semantic_errors(file)).then_some((rank, start))
        });
        check_positions.min()
    }

    /// True if `checkSourceFile` visits a class or interface declaration of `sym` before the task's
    /// file. It requests the base types of every declaration it visits, so with one checker `sym`'s
    /// would already be resolved.
    pub(super) fn are_base_types_resolved_by_check(&self, sym: Sym) -> bool {
        self.task.file.is_some_and(|own| {
            let before = self.files().rank_of_file(own);
            self.first_declaration_checked_before(sym, before).is_some()
        })
    }

    /// The diagnostic `reportCircularBaseType` reports at `declaration`, a class or interface
    /// declaration of `sym`.
    fn circular_base_type(
        &mut self,
        sym: Sym,
        file: FileId,
        declaration: Decl,
    ) -> Option<Reported> {
        let (start, end) = self.error_range_of_declaration(file, declaration)?;
        let ty = self.declared_type(sym);
        let name = self.type_to_string_with_generic_arrays(ty);
        Some(self.new_diagnostic((file, start, end), 2310, &[Arg::Bytes(&name)]))
    }

    /// `getReducedType`, `isErrorType`, `isValidBaseType`. Returns `base` as a base type of the
    /// class or interface whose base types are being resolved, if it's valid. `report` is called
    /// with an invalid base type, both reduced and unreduced.
    fn as_base_type(
        &mut self,
        base: TypeId,
        report: impl FnOnce(&mut Self, TypeId, TypeId),
    ) -> Option<TypeId> {
        let unreduced = base;
        // `isGenericMappedType`: the constraint type of a mapped type must be resolved, and `keyof
        // Y` needs the members of `Y`, which need its base types. `getResolvedBaseConstraint`: a
        // resulting cycle goes through the key.
        let parts: &[TypeId] = match self.data(base) {
            TypeData::Intersection(parts) => &parts[..],
            _ => std::slice::from_ref(&base),
        };
        for &part in parts {
            if let TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } = *self.data(part)
            {
                self.mapped_constraint(file, node, mapper);
            }
        }
        let base = self.reduced(base);
        // `is_valid_base_type` accepts a type that couldn't be resolved. Only an object type with
        // such a constituent is listed.
        if self.is_error_type(base) {
            return None;
        }
        if self.is_valid_base_type(base) {
            return Some(base);
        }
        if self.is_settled_base(base) {
            report(self, base, unreduced);
        }
        None
    }

    /// `baseTypeNode.Expression()` of class `c`. `None` if nothing is reported for it, because
    /// `checkSourceFile` never visits it or its type is a guess.
    pub(super) fn span_to_report_base_at(
        &self,
        file: FileId,
        c: ClassId,
    ) -> Option<(FileId, u32, u32)> {
        let extends = self.hir(file)[c].extends;
        if self.bound(file).is_unchecked(extends.idx()) {
            return None;
        }
        Some(self.span_of_parenthesized_expr(file, extends))
    }

    /// `baseType` of `resolveBaseTypesOfClass`: the instance type of the base class of `sym`. `c`
    /// is its `extending_declaration`.
    fn base_instance_type(&mut self, sym: Sym, file: FileId, c: ClassId) -> TypeId {
        let hir = self.hir(file);
        let type_arguments = hir[c].extends_args;
        let constructor = self.base_constructor_type_of_class(sym);
        // `baseType = baseConstructorType`, which has no symbol.
        if self.has_any_flag(constructor) {
            return constructor;
        }
        // "if baseConstructorType.flags&(TypeFlagsObject|TypeFlagsIntersection|TypeFlagsAny) == 0":
        // a union of constructor types gives no base type and no error.
        let constructor = self.apparent_type(constructor);
        if !self.is_object_type(constructor) && !self.is_intersection(constructor) {
            return TypeId::ERROR;
        }
        // `baseConstructorType.symbol.Flags&ast.SymbolFlagsClass != 0`
        let class = match *self.data(constructor) {
            TypeData::Anon {
                origin: Origin::ClassStatic(base),
                ..
            } => Some(base),
            TypeData::Ref { target, .. }
                if self.files().flags(target).contains(SymFlags::CLASS) =>
            {
                Some(target)
            }
            _ => None,
        };
        // `areAllOuterTypeParametersApplied`, applied to the declared type: a class declared inside
        // a generic declaration is resolved through its construct signatures.
        if let Some(base) = class
            && self.outer_type_params_of_symbol(base).is_empty()
        {
            // `getTypeFromClassOrInterfaceReference`. With the error type the class has no base
            // type.
            let count = type_arguments.len();
            let Some(most) = self.check_type_argument_count(base, count, file, Err(c)) else {
                return TypeId::ERROR;
            };
            let args = self.types_from_nodes(file, type_arguments);
            // `fillMissingTypeArguments`
            if hir.is_js && most > 0 {
                let params = self.type_params_of_symbol(base);
                let filled = self.fill_type_args_as(&params, &args, true);
                return self.type_reference_of_node(base, &filled);
            }
            return self.type_reference_of_node(base, &args);
        }
        let sigs = self.signatures(constructor, true);
        let args = self.types_from_nodes(file, type_arguments);
        match self
            .constructors_taking(&sigs, &args, hir.is_js, false)
            .first()
        {
            Some(&sig) => self.sig_return(sig),
            None => {
                if let Some(at) = self.span_to_report_base_at(file, c) {
                    self.error_at(at, 2508, &[]);
                }
                TypeId::ERROR
            }
        }
    }

    /// `getInstantiatedConstructorsForTypeArguments`: the signatures in `sigs` that accept `args.len()` type arguments,
    /// instantiated with `args`. `is_js` means the `extends` clause is in a JavaScript file, so
    /// `fillMissingTypeArguments` fills with `any`. `any_arity` skips the type argument count check, as
    /// `getDefaultConstructSignatures` does for a JavaScript class.
    pub(super) fn constructors_taking(
        &mut self,
        sigs: &[SigId],
        args: &[TypeId],
        is_js: bool,
        any_arity: bool,
    ) -> Vec<SigId> {
        let mut fitting = Vec::with_capacity(sigs.len());
        for &sig in sigs {
            let params = self.sig_type_params(sig);
            if !any_arity
                && (args.len() < self.min_type_argument_count(&params) || args.len() > params.len())
            {
                continue;
            }
            if params.is_empty() {
                fitting.push(sig);
                continue;
            }
            let filled = self.fill_sig_type_args_as(sig, &params, args, is_js);
            let mapper = self.mapper_from(&params, &filled);
            fitting.push(self.instantiate_sig(sig, mapper));
        }
        fitting
    }

    /// Returns whether the base constructor type of `class` has any construct signature, along with its construct
    /// signatures instantiated with the `extends` clause's type arguments. `for_default_constructor` selects them the
    /// way `getDefaultConstructSignatures` does. Otherwise they're selected the way
    /// `getInstantiatedConstructorsForTypeArguments` does.
    fn base_constructors(
        &mut self,
        class: Sym,
        for_default_constructor: bool,
    ) -> (bool, Vec<SigId>) {
        let Some((file, c)) = self.extending_declaration(class) else {
            return (false, Vec::new());
        };
        let hir = self.hir(file);
        let constructor = self.base_constructor_type_of_class(class);
        let sigs = self.signatures(constructor, true);
        // `getDefaultConstructSignatures` returns before `getTypeArgumentsFromNode`.
        if for_default_constructor && sigs.is_empty() {
            return (false, Vec::new());
        }
        let args = self.types_from_nodes(file, hir[c].extends_args);
        (
            !sigs.is_empty(),
            self.constructors_taking(
                &sigs,
                &args,
                hir.is_js,
                for_default_constructor && hir.is_js,
            ),
        )
    }

    /// `getInstantiatedConstructorsForTypeArguments` for the `extends` clause of `class`: the candidates of `super(..)`, and the
    /// signatures `resolveBaseTypesOfClass` takes the base type from. The type argument count is checked in JavaScript too.
    pub(super) fn super_constructor_sigs(&mut self, class: Sym) -> Vec<SigId> {
        self.base_constructors(class, false).1
    }

    /// `getWidenedProperty` (`is_widening`) and `transformTypeOfMembers` call `getTypeOfSymbol` for
    /// the properties of the object literal type `ty`, and continue with each property's type. Here
    /// a property is widened or made regular when it's read (`PropFlags::WIDEN`,
    /// `PropFlags::REGULAR`). By then `checkObjectLiteral` has resolved the type of each of the
    /// literal's members except accessors, so this resolves the accessors and the symbols that
    /// `get_spread_symbol` left unresolved. A cycle through one of them is detected here.
    fn resolve_spread_symbols(&mut self, ty: TypeId, is_widening: bool) {
        match self.data(ty) {
            &TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } => {
                if let ExprKind::Object(props) = self.hir(file)[e].kind {
                    for p in props.iter() {
                        self.resolve_member_of_literal(file, p, is_widening);
                    }
                }
            }
            TypeData::Synth(shape) => {
                for prop in &shape.props {
                    match prop.source {
                        PropSource::Type(member) | PropSource::Copy(member, ..) => {
                            self.resolve_spread_symbols_in(member, is_widening);
                        }
                        PropSource::Literal(file, p) => {
                            self.resolve_member_of_literal(file, p, is_widening);
                        }
                        // `prop.Flags&ast.SymbolFlagsProperty == 0`
                        PropSource::Symbol(symbol)
                            if !is_widening
                                || self.files().flags(symbol).contains(SymFlags::PROPERTY) =>
                        {
                            self.type_of_prop(prop, MapperId::IDENTITY);
                        }
                        PropSource::Mapped(..) | PropSource::ReverseMapped(..) => {
                            self.type_of_prop(prop, MapperId::IDENTITY);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    /// `resolve_spread_symbols` for the property declared by `p`, a member of an object literal.
    fn resolve_member_of_literal(&mut self, file: FileId, p: PropId, is_widening: bool) {
        let hir = self.hir(file);
        let prop = &hir[p];
        match prop.kind {
            PropKind::Init | PropKind::Shorthand => {
                let member = self.type_of_literal_prop(file, p);
                self.resolve_spread_symbols_in(member, is_widening);
            }
            // `getTypeOfAccessors`, where the getter comes first.
            PropKind::Getter | PropKind::Setter
                if self.member_name(file, prop.key).is_some()
                    && (!is_widening || self.is_accessor_widened_as_property(file, p)) =>
            {
                let getter = match hir[prop.value].kind {
                    ExprKind::Fn(setter) if prop.kind == PropKind::Setter => {
                        self.sibling_accessor(file, setter, FnKind::Getter)
                    }
                    _ => None,
                };
                match getter {
                    Some((of, getter)) => self.return_type_of_fn(of, getter),
                    None => self.type_of_literal_prop(file, p),
                };
            }
            _ => {}
        }
    }

    /// True if `getWidenedProperty` gets past its `prop.Flags&ast.SymbolFlagsProperty == 0` check for `p`, an accessor
    /// of an object literal. `checkObjectLiteral` puts `member` itself in `propertiesTable`, and a plain member of that
    /// name shares the symbol (`PropertyExcludes`). A later member of that name replaces it in the table.
    fn is_accessor_widened_as_property(&mut self, file: FileId, p: PropId) -> bool {
        if !self
            .flags_of_literal_member(file, p)
            .contains(SymFlags::PROPERTY)
        {
            return false;
        }
        let owner = self.bound(file).prop_owner[p.idx()];
        let owner = self.hir(file).exprs.get(owner.idx());
        let Some(ExprKind::Object(props)) = owner.map(|owner| owner.kind) else {
            return false;
        };
        let name = self.name_of_literal_member(file, p);
        let mut later = props.iter().skip_while(|&q| q != p).skip(1);
        !later.any(|q| self.name_of_literal_member(file, q) == name)
    }

    /// Continues `resolve_spread_symbols` with `member`, a property's type.
    fn resolve_spread_symbols_in(&mut self, member: TypeId, is_widening: bool) {
        let flags = self.types().object_flags(member);
        if !flags.contains(ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL) {
            return;
        }
        if is_widening {
            self.get_widened_type(member);
        } else {
            self.resolve_spread_symbols_of_regular_literal(member);
        }
    }

    /// The loop over the properties in `getWidenedTypeOfObjectLiteral`. See `resolve_spread_symbols`.
    pub(super) fn resolve_spread_symbols_of_widened_literal(&mut self, ty: TypeId) {
        self.resolve_spread_symbols(ty, true);
    }

    /// `transformTypeOfMembers(t, c.getRegularTypeOfObjectLiteral)`. See `resolve_spread_symbols`.
    pub(super) fn resolve_spread_symbols_of_regular_literal(&mut self, ty: TypeId) {
        let is_fresh = match self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(.., is_fresh),
                ..
            } => *is_fresh,
            TypeData::Synth(shape) => shape.literal.is_of_expression() && !shape.is_regular,
            _ => false,
        };
        if is_fresh {
            self.resolve_spread_symbols(ty, false);
        }
    }

    /// `getRegularTypeOfObjectLiteral`
    pub(super) fn regular_type_of_object_literal(&mut self, ty: TypeId) -> TypeId {
        self.resolve_spread_symbols_of_regular_literal(ty);
        self.regular_type_of_resolved_object_literal(ty)
    }

    /// `getRegularTypeOfObjectLiteral` for a property's type, where the property belongs to a type
    /// returned by `regular_type_of_object_literal`.
    fn regular_type_of_resolved_object_literal(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            &TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(
                        file,
                        e,
                        is_js_literal,
                        in_const_context,
                        created_by,
                        object_flags,
                        true,
                    ),
                mapper,
            } => self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(
                    file,
                    e,
                    is_js_literal,
                    in_const_context,
                    created_by,
                    object_flags,
                    false,
                ),
                mapper,
            }),
            TypeData::Synth(shape) if shape.literal.is_of_expression() && !shape.is_regular => {
                let mut shape = shape.clone_in(self.arena);
                shape.is_regular = true;
                for prop in &mut shape.props {
                    prop.flags |= PropFlags::REGULAR;
                }
                self.intern(TypeData::Synth(shape))
            }
            _ => ty,
        }
    }

    /// The shape for a caller that requests the members of `key`, whose origin is `origin`, while
    /// `build_origin_shape` is resolving them. `resolveAnonymousTypeMembers` has no guard. For a
    /// class or function it starts with `getExportsOfSymbol`, which assigns the early-bound symbols
    /// to `links.resolvedExports` before it checks the computed names. So a re-entry from a
    /// computed name resolves everything from the early-bound symbols:
    /// `f(class { static [a] = 1 })` has its construct signature at that point. After that the
    /// members are in place (`has_members_in_place`), up to the stage recorded in
    /// `anonymous_members_in_place`.
    fn origin_shape_in_the_meantime(&mut self, key: TypeId, origin: Origin) -> Shape<'s> {
        if self.is_late_binding(key) {
            if let Origin::ClassStatic(sym) | Origin::Function(sym) = origin {
                self.note_members_from_early_symbols(sym, true);
            }
            return self.build_origin_shape(
                origin,
                MemberBinding::Early,
                MembersInPlace::Signatures,
            );
        }
        match self.members_in_place_of(origin) {
            Some((in_place, _)) => self.build_origin_shape(origin, MemberBinding::Late, in_place),
            None => Shape::new_in(self.arena),
        }
    }

    /// The innermost entry of `anonymous_members_in_place` for `origin`, without the origin.
    fn members_in_place_of(&self, origin: Origin) -> Option<(MembersInPlace, usize)> {
        let mut in_progress = self.anonymous_members_in_place.iter().rev();
        let found = in_progress.find(|it| it.0 == origin)?;
        Some((found.1, found.2))
    }

    /// `symbol.Flags&SymbolFlagsPrototype != 0`: `symbol` is the `prototype` that
    /// `bindClassLikeDeclaration` puts in a class's exports. Nothing replaces it there, and the
    /// symbol of a declaration that `declareSymbolEx` rejects isn't in any table.
    pub(super) fn is_prototype_symbol(&self, symbol: Sym) -> bool {
        let files = self.files();
        files.symbol(symbol).name == known::prototype
            && files.parent_of_symbol(symbol).is_some_and(|class| {
                files.flags(class).contains(SymFlags::CLASS)
                    && files.export(class, known::prototype) == Some(files.canonical(symbol))
            })
    }

    /// `prop.Flags&SymbolFlagsPrototype != 0`. It's synthesized unless a static member declares it.
    pub(super) fn is_prototype_of_class(&self, prop: &Prop) -> bool {
        prop.name == known::prototype
            && match prop.source {
                PropSource::Type(_) => true,
                PropSource::Symbol(symbol) => self.is_prototype_symbol(symbol),
                _ => false,
            }
    }

    /// `getTypeOfPrototypeProperty` for the `prototype` of `class`: `any` for each type parameter,
    /// including the outer type parameters of the class.
    pub(super) fn get_type_of_prototype_property(&mut self, class: Sym) -> TypeId {
        let declared = self.declared_type(class);
        let count = self.type_arguments(declared).len();
        match self.data(declared) {
            TypeData::Ref { target, .. } if count != 0 => self.intern_key(TypeKey::Ref {
                target: *target,
                args: &vec![TypeId::ANY; count],
            }),
            _ => declared,
        }
    }

    /// `binding` applies to the exports of a class or function. `until` is the stage up to which
    /// the members of a class or enum value are included. Short of `MembersInPlace::Signatures`,
    /// the result is what a caller finds in place, and nothing is requested that
    /// `resolveAnonymousTypeMembers` wouldn't have requested by that stage.
    fn build_origin_shape(
        &mut self,
        origin: Origin,
        binding: MemberBinding,
        until: MembersInPlace,
    ) -> Shape<'s> {
        let binding = match origin {
            Origin::ClassStatic(sym) | Origin::Function(sym) => {
                self.binding_of_side(sym, true, binding)
            }
            _ => binding,
        };
        let early = binding == MemberBinding::Early;
        let is_whole = until == MembersInPlace::Signatures;
        if until == MembersInPlace::Empty {
            return Shape::new_in(self.arena);
        }
        let mut b = Builder::new_in(self.arena);
        // Argument for `get_named_members`. Only the static side of a class has a container.
        let mut contained = [0..usize::MAX, 0..0];
        let mut ranges = Vec::new();
        match origin {
            Origin::TypeLiteral(file, node) => {
                if let TypeNodeKind::Object(members) = self.hir(file)[node].kind {
                    let side = ClassSide::Instance;
                    // `resolveAnonymousTypeMembers` of a type literal begins with
                    // `setStructuredTypeMembers(t, nil, nil, nil, nil)`.
                    let entry = (origin, MembersInPlace::Empty, self.stack.len());
                    self.anonymous_members_in_place.push(entry);
                    self.add_members(&mut b, file, members, side, MemberBinding::Late);
                    self.add_index_signatures_of_computed_names(&mut b);
                    self.anonymous_members_in_place.pop();
                }
            }
            Origin::ObjectLiteral(file, expr, _, in_const_context, .., is_fresh) => {
                let mut shape =
                    self.build_object_literal_shape(file, expr, in_const_context, false);
                if !is_fresh {
                    for prop in &mut shape.props {
                        prop.flags |= PropFlags::REGULAR;
                    }
                }
                return shape;
            }
            Origin::WidenedLiteral(file, expr, _, in_const_context, ..) => {
                let mut shape =
                    self.build_object_literal_shape(file, expr, in_const_context, false);
                // `getWidenedProperty`: methods and accessors are left unchanged.
                for prop in &mut shape.props {
                    if !prop
                        .flags
                        .intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
                    {
                        prop.flags |= PropFlags::WIDEN;
                    }
                }
                // `getWidenedTypeOfObjectLiteral`: the value type of an index signature is widened
                // like a property.
                for info in &mut shape.index {
                    info.value = self.get_widened_type(info.value);
                }
                return shape;
            }
            Origin::ClassStatic(sym) => {
                let mut has_constructor = false;
                let mut outer = MapperId::IDENTITY;
                for (file, decl) in self.files().decls_of(sym) {
                    let Decl::Class(c) = decl else { continue };
                    if !self.is_declaration_of_symbol(sym, file, decl) {
                        continue;
                    }
                    let hir = self.hir(file);
                    // `resolveAnonymousTypeMembers` also instantiates the signatures with the
                    // mappings of the outer type parameters of the class, and `instantiate_sig`
                    // only propagates the type parameters that the mapper of a signature covers.
                    let scope = self.bound(file).class_scope[c.idx()];
                    if scope.is_some() {
                        let parent = self.bound(file).scopes[scope.idx()].parent;
                        outer = self.identity_mapper(file, parent);
                    }
                    if !early {
                        self.begin_late_binding(sym, true);
                    }
                    self.add_members(&mut b, file, hir[c].members, ClassSide::Static, binding);
                    self.add_this_properties(&mut b, file, c, true);
                    if !early {
                        if hir.is_js {
                            self.add_late_bound_expandos(&mut b, sym);
                        }
                        self.late_binding.pop();
                    }
                    // `symbol.Members[InternalSymbolNameConstructor]`: `declareClassMember` puts a static one in the exports.
                    let constructors: Vec<MemberId> = hir[c]
                        .members
                        .iter()
                        .filter(|&m| {
                            hir[m].kind == MemberKind::Constructor
                                && !hir[m].flags.contains(Flags::STATIC)
                        })
                        .collect();
                    for (i, &m) in constructors.iter().enumerate() {
                        has_constructor = true;
                        if i > 0 && self.is_implementation_after(file, constructors[i - 1], m) {
                            continue;
                        }
                        let sig = self.sig_of_constructor(sym, file, c, hir[m].func);
                        b.shape.construct.push(sig);
                    }
                }
                // `declareSymbolEx` adds a static property or accessor of that name to the symbol
                // that `bindClassLikeDeclaration` has put in the table. A declaration it rejects
                // isn't in any table.
                let declared_prototype = b.position(known::prototype).filter(|&i| {
                    matches!(b.shape.props[i].source, PropSource::Symbol(it)
                        if self.is_prototype_symbol(it))
                });
                match declared_prototype {
                    // Neither `getTypeOfPrototypeProperty` nor `getTypeOfAccessors` adds `undefined`.
                    Some(i) if b.shape.props[i].flags.contains(PropFlags::OPTIONAL) => {
                        b.shape.props[i].flags |= PropFlags::WITHOUT_OPTIONALITY;
                    }
                    Some(_) => {}
                    None => b.remove(known::prototype),
                }
                let own = b.shape.props.len();
                // `declare function C(): T` next to `declare class C`.
                b.shape.call = self.sigs_of_function_declarations(sym);
                if declared_prototype.is_none() {
                    let instance = self.get_type_of_prototype_property(sym);
                    b.add_new(Prop {
                        name: known::prototype,
                        flags: PropFlags::empty(),
                        source: PropSource::Type(instance),
                        mapper: MapperId::IDENTITY,
                        name_type: TypeId::UNRESOLVED,
                    });
                }
                let exports_from = b.shape.props.len();
                self.add_namespace_exports(&mut b, sym);
                // The static members, and the exports of a merged namespace, but not a `prototype`
                // without a declaration.
                contained = [0..own, exports_from..b.shape.props.len()];
                ranges = self.ranges_of_declarations(sym);
                let at = self.anonymous_members_in_place.len();
                if is_whole {
                    let entry = (origin, MembersInPlace::Exports, self.stack.len());
                    self.anonymous_members_in_place.push(entry);
                }
                if until >= MembersInPlace::Inherited {
                    // Static members are inherited too.
                    let base = self.base_constructor_type_of_class(sym);
                    // `getPropertiesOfType`: a type variable is replaced by its constraint.
                    let base = if self.is_type_variable(base) {
                        self.apparent_type(base)
                    } else {
                        base
                    };
                    if let Some(members) = self.members(base) {
                        // `addInheritedMembers`
                        for prop in &members.shape().props {
                            if !b.has(prop.name) && !self.is_static_private_name(prop) {
                                let mut prop = prop.clone_in(self.arena);
                                self.compose_mapper_of_prop(&mut prop, members.mapper);
                                b.add(prop);
                            }
                        }
                    }
                }
                if is_whole {
                    self.anonymous_members_in_place[at].1 = MembersInPlace::Inherited;
                }
                if until >= MembersInPlace::IndexInfos {
                    // `getIndexInfosOfIndexSymbol`: on this side, the siblings of a computed name
                    // are the whole member table. A type exported by a merged namespace is in it
                    // too.
                    if !b.computed_names.is_empty()
                        && self.files().flags(sym).intersects(SymFlags::MODULE)
                    {
                        let mut exports = self.files().each_export(sym);
                        let exports_types = exports.any(|export| !b.has(export.0));
                        b.has_non_property_symbols |= exports_types;
                    }
                    self.add_index_signatures_of_computed_names(&mut b);
                    // `anyBaseTypeIndexInfo`, if the class has no static index signature at all.
                    if b.shape.index.is_empty() && self.extends_any(sym) {
                        b.shape
                            .index
                            .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
                    }
                } else {
                    b.shape.index.clear();
                }
                if is_whole {
                    self.anonymous_members_in_place[at].1 = MembersInPlace::IndexInfos;
                    if !has_constructor {
                        // `getDefaultConstructSignatures`: one for each construct signature of the
                        // base constructor that accepts the type arguments of the `extends` clause,
                        // which may be none; a single default one if the base constructor has no
                        // construct signatures at all. Only the base constructor type is used,
                        // regardless of the base types.
                        let (can_be_created, fitting) = self.base_constructors(sym, true);
                        let bases = if can_be_created {
                            fitting.into_iter().map(Some).collect()
                        } else {
                            vec![None]
                        };
                        for base in bases {
                            b.shape.construct.push(self.types().intern_sig(
                                SigData::DefaultConstruct {
                                    class: sym,
                                    base,
                                    mapper: outer,
                                },
                            ));
                        }
                    }
                    self.anonymous_members_in_place.pop();
                } else {
                    b.shape.call.clear();
                    b.shape.construct.clear();
                }
            }
            Origin::Function(sym) => {
                b.shape.call = self.sigs_of_function_declarations(sym);
                self.add_namespace_exports(&mut b, sym);
                if !early {
                    self.begin_late_binding(sym, true);
                    self.add_late_bound_expandos(&mut b, sym);
                    self.late_binding.pop();
                }
            }
            Origin::EnumObject(sym) => {
                for (name, member) in self.exports_in_order(sym) {
                    // The values exported by a namespace merged with it are properties as well.
                    if !self.symbol_is_value(member) {
                        continue;
                    }
                    b.add(Prop {
                        name,
                        flags: self.export_flags(member),
                        source: PropSource::Symbol(member),
                        mapper: MapperId::IDENTITY,
                        name_type: TypeId::UNRESOLVED,
                    });
                }
                self.get_named_members(&mut b.shape.props, |_| true, &[]);
                if !is_whole {
                    return b.shape;
                }
                let entry = (origin, MembersInPlace::Exports, self.stack.len());
                self.anonymous_members_in_place.push(entry);
                // `enumNumberIndexInfo`, the reverse mapping: a numeric value maps back to the name
                // of its member.
                let declared = self.declared_type(sym);
                let has_numbers = self.flags(declared) & tf::ENUM != 0
                    || b.shape.props.iter().any(|prop| {
                        let ty = self.type_of_prop(prop, MapperId::IDENTITY);
                        self.is_number_like(ty)
                    });
                self.anonymous_members_in_place.pop();
                if has_numbers {
                    b.shape.index.push(IndexInfo {
                        is_enum_number_index_info: true,
                        ..IndexInfo::new(TypeId::NUMBER, TypeId::STRING, true)
                    });
                }
                return b.shape;
            }
            Origin::Module(sym) => {
                for &(name, export) in self.files().exports_of_module(sym) {
                    if name == known::export_equals || !self.symbol_is_value(export) {
                        continue;
                    }
                    b.add(Prop {
                        name,
                        flags: self.export_flags(export),
                        source: PropSource::Symbol(export),
                        mapper: MapperId::IDENTITY,
                        name_type: TypeId::UNRESOLVED,
                    });
                }
            }
            // `cloneTypeAsModuleType` over `getTypeWithSyntheticDefaultImportType`: the properties, never the signatures.
            Origin::Namespace {
                module,
                with_default,
                is_default_only,
                ..
            } => {
                let ty = self.type_of_symbol(module);
                // `getSpreadType(ty, { default })` only if `isValidSpreadType(ty)`. It begins with
                // `tryMergeUnionOfObjectTypeAndEmptyObject`.
                let spreads = !is_default_only && (!with_default || self.is_valid_spread_type(ty));
                let left = if spreads && with_default {
                    self.try_merge_union_of_object_type_and_empty_object(ty)
                } else {
                    ty
                };
                // `getSpreadType` maps over a union, and
                // `resolveStructuredTypeMembers(moduleType).members` of a union is empty, so
                // there's no `default` either.
                if spreads && self.is_union(left) {
                    return b.shape;
                }
                if spreads && let Some(members) = self.members(left) {
                    for prop in &members.shape().props {
                        let mut prop = prop.clone_in(self.arena);
                        if with_default {
                            // `getSpreadType(ty, { default })`: the spreadable properties, and the
                            // synthesized `default` wins.
                            if prop.name == known::default || !self.is_spreadable_property(&prop) {
                                continue;
                            }
                            // `getSpreadSymbol`: a copy is writable, and a write-only property
                            // isn't copied.
                            if prop.flags.contains(PropFlags::WRITE_ONLY) {
                                prop = Prop {
                                    name: prop.name,
                                    flags: prop.flags & PropFlags::OPTIONAL,
                                    source: Self::copy_of(
                                        TypeId::UNDEFINED,
                                        &[&prop],
                                        false,
                                        self.arena,
                                    ),
                                    mapper: MapperId::IDENTITY,
                                    name_type: TypeId::UNRESOLVED,
                                };
                            } else if prop.flags.contains(PropFlags::READONLY) {
                                // A readonly property (an `export const`) is recreated too, with
                                // its declarations but without a parent.
                                let ty = self.type_of_prop(&prop, MapperId::IDENTITY);
                                let source = Self::copy_of(ty, &[&prop], false, self.arena);
                                self.forget_separate_key(&mut prop);
                                prop.source = source;
                                prop.mapper = MapperId::IDENTITY;
                            }
                            prop.flags.remove(PropFlags::READONLY);
                        }
                        self.compose_mapper_of_prop(&mut prop, members.mapper);
                        b.add(prop);
                    }
                    // `getUnionIndexInfos`: `{ default }` has no index signature, so the result of
                    // spreading with it has none.
                    if !with_default {
                        for info in self.structured(members).index_infos() {
                            let value = self.instantiate(info.value, members.mapper);
                            b.shape.index.push(IndexInfo { value, ..*info });
                        }
                    }
                }
                // `createDefaultPropertyWrapperForModule`
                if with_default {
                    b.add(Prop {
                        name: known::default,
                        flags: PropFlags::empty(),
                        source: PropSource::Type(ty),
                        mapper: MapperId::IDENTITY,
                        name_type: TypeId::UNRESOLVED,
                    });
                }
            }
            // The globals declared with `var` and `function`. `let`, `const` and `class` don't become properties.
            Origin::GlobalThis => {
                let global_this = self.files().global_this_symbol;
                for &(name, sym) in self.files().globals.iter() {
                    // The alias target determines whether it's a value. The symbol itself
                    // determines its scoping.
                    if self.symbol_is_value(sym)
                        && !self.files().flags(sym).intersects(
                            SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM,
                        )
                    {
                        // `globalThisSymbol` is created with `CheckFlagsReadonly`.
                        let flags = if sym == global_this {
                            PropFlags::READONLY
                        } else {
                            PropFlags::empty()
                        };
                        b.add(Prop {
                            name,
                            flags,
                            source: PropSource::Symbol(sym),
                            mapper: MapperId::IDENTITY,
                            name_type: TypeId::UNRESOLVED,
                        });
                    }
                }
            }
            Origin::Mapped(..) => {}
        }
        let is_contained = |i: usize| contained.iter().any(|range| range.contains(&i));
        self.get_named_members(&mut b.shape.props, is_contained, &ranges);
        b.shape
    }

    /// `symbolIsValue`: a value itself, or an alias whose resolution chain reaches a value with no
    /// type-only step before it (`getSymbolFlagsEx`, `excludeTypeOnlyMeanings`). An alias that
    /// doesn't resolve is an error, and an error symbol has every meaning, including value.
    pub(super) fn symbol_is_value(&mut self, sym: Sym) -> bool {
        let flags = self.get_symbol_flags_ex(sym);
        // `resolveAlias` reports why it finds no target.
        if flags == SymFlags::all() {
            self.check_target_of_alias_symbol(sym);
        }
        flags.intersects(SymFlags::VALUE)
    }

    /// `PropFlags` of an export of a module, namespace or enum. Constants and enum members are read-only
    /// (`isReadonlySymbol`). An alias's target isn't considered. An expando assignment (`f.name = value`) takes its
    /// modifiers from JSDoc (`getDeclarationModifierFlagsFromSymbol`).
    fn export_flags(&self, export: Sym) -> PropFlags {
        let own = self.files().flags(export);
        let mut flags = PropFlags::empty();
        if own.intersects(SymFlags::VARIABLE) && own.contains(SymFlags::CONST)
            || own.contains(SymFlags::ENUM_MEMBER)
        {
            flags |= PropFlags::READONLY;
        }
        if own.contains(SymFlags::ASSIGNMENT)
            && let Some((file, Decl::Expando(first))) = self.files().value_declaration(export)
        {
            let modifiers = self.hir(file).jsdoc_modifiers_of(first);
            if modifiers.contains(Flags::READONLY) {
                flags |= PropFlags::READONLY;
            }
            if self.declaring_class_of_symbol(export).is_some() {
                flags.set(PropFlags::PRIVATE, modifiers.contains(Flags::PRIVATE));
                flags.set(PropFlags::PROTECTED, modifiers.contains(Flags::PROTECTED));
            }
        }
        flags
    }

    pub(super) fn exports_in_order(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        let mut all = self.files().exports(sym);
        all.shared_sort_by_key(|e| e.1);
        all
    }

    /// `lateBindMember` for `f[key] = value`: it declares the property named by the type of `key`,
    /// together with the `f.name = value` declarations of that name. A key whose type isn't usable
    /// as a property name declares nothing. `this[key] = value` in a class declares a static
    /// property, even in an instance member, because `getResolvedMembersOrExportsOfSymbol` only
    /// binds these declarations for the exports.
    fn add_late_bound_expandos(&mut self, b: &mut Builder<'s>, owner: Sym) {
        let files = self.files();
        let Some(all) = files.export(owner, known::assignment_declaration) else {
            return;
        };
        // `checkObjectLiteral` uses the exports as the binder left them.
        if files.flags(owner).contains(SymFlags::OBJECT_LITERAL) {
            return;
        }
        for &(file, decl) in files.decls_of(all).iter() {
            if let Decl::Expando(e) | Decl::ThisProperty(e) = decl
                && let ExprKind::Assign { target, .. } = self.hir(file)[e].kind
                && let ExprKind::Index { index, .. } = self.hir(file)[target].kind
                && let Some(name) = self.declared_member_name(file, PropKey::Computed(index))
                && !b.has(name)
                && let Some(&(of, first)) = self.declarations_of_member(file, decl).first()
            {
                b.add(Prop {
                    name,
                    flags: PropFlags::empty(),
                    source: PropSource::Symbol(
                        files.sym(of, self.bound(of).symbol_of_declaration(first)),
                    ),
                    mapper: MapperId::IDENTITY,
                    name_type: TypeId::UNRESOLVED,
                });
            }
        }
    }

    /// Extends `shape`, the shape of a function or of an object literal with its members, with
    /// `getExportsOfSymbol(owner)`, which are declared by assignments. The result is in
    /// `getNamedMembers` order.
    pub(super) fn with_expandos(
        &mut self,
        shape: Shape<'s>,
        file: FileId,
        owner: SymbolId,
    ) -> Shape<'s> {
        // Fast path: every function expression and object literal gets here.
        if owner.is_none() || self.bound(file).symbol(owner).exports.is_none() {
            return shape;
        }
        let mut b = Builder::of(shape, self.arena);
        let before = b.shape.props.len();
        let owner = self.files().sym(file, owner);
        self.add_namespace_exports(&mut b, owner);
        self.add_late_bound_expandos(&mut b, owner);
        if b.shape.props.len() > before {
            self.get_named_members(&mut b.shape.props, |_| true, &[]);
        }
        b.shape
    }

    /// Adds the properties declared by `this.name = value` in JavaScript that have no other
    /// declaration.
    fn add_this_properties(
        &mut self,
        b: &mut Builder<'s>,
        file: FileId,
        class: ClassId,
        is_static: bool,
    ) {
        // Fast path: every class gets here.
        if !self.hir(file).is_js {
            return;
        }
        let (bound, files) = (self.bound(file), self.files());
        let of = bound.symbol(bound.class_symbol[class.idx()]);
        for &(name, symbol) in bound.table(if is_static { of.exports } else { of.members }) {
            let sym = files.sym(file, symbol);
            if let Some((of, Decl::ThisProperty(first))) = files.value_declaration(sym)
                && !b.has(name)
            {
                // `getDeclarationModifierFlagsFromSymbol`: the modifiers of `symbol.ValueDeclaration`.
                let modifiers = self.hir(of).jsdoc_modifiers_of(first);
                let mut flags = PropFlags::empty();
                flags.set(PropFlags::READONLY, modifiers.contains(Flags::READONLY));
                flags.set(PropFlags::PRIVATE, modifiers.contains(Flags::PRIVATE));
                flags.set(PropFlags::PROTECTED, modifiers.contains(Flags::PROTECTED));
                b.add(Prop {
                    name,
                    flags,
                    source: PropSource::Symbol(sym),
                    mapper: MapperId::IDENTITY,
                    name_type: TypeId::UNRESOLVED,
                });
            }
        }
    }

    /// Adds the values exported by a namespace merged with a function, class or enum.
    fn add_namespace_exports(&mut self, b: &mut Builder<'s>, sym: Sym) {
        for (name, export) in self.exports_in_order(sym) {
            // `mergeSymbol` resolves an alias that a late-bound symbol is merged into.
            let export = match self.files().is_non_local_alias(export) {
                true => {
                    let container = self.files().canonical(sym);
                    self.resolved_export_of_alias(container, name, export)
                }
                false => Some(export),
            };
            let Some(export) = export else { continue };
            // The static members are left to `add_members`, their assignments to `this` to
            // `add_this_properties`.
            let is_member =
                |d: &(FileId, Decl)| matches!(d.1, Decl::Member(_) | Decl::ThisProperty(_));
            // `combineSymbolTables`: the table keeps an early-bound symbol, whether or not the
            // late-bound one of that name merges with it.
            let is_free = b.position(name).is_none_or(|i| {
                matches!(b.shape.props[i].source, PropSource::Symbol(it)
                    if self.files().symbol(it).name == known::computed)
            });
            if self.symbol_is_value(export)
                && is_free
                && !self.files().decls_of(export).iter().all(is_member)
            {
                b.add(Prop {
                    name,
                    flags: self.export_flags(export),
                    source: PropSource::Symbol(export),
                    mapper: MapperId::IDENTITY,
                    name_type: TypeId::UNRESOLVED,
                });
            }
        }
    }

    /// `createTupleTargetType`, and the members `resolveObjectTypeMembers` inherits from `Array`,
    /// in which `this` is the tuple, or the type that represents it.
    fn build_tuple_shape(
        &mut self,
        this: TypeId,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
    ) -> Shape<'s> {
        let mut b = Builder::new_in(self.arena);
        let fixed = Self::fixed_length(flags);
        let is_optional = |i: usize| flags[i].contains(ElemFlags::OPTIONAL);
        let mut elements: SmallVec<[(TypeId, Atom); 8]> = SmallVec::with_capacity(fixed);
        for i in 0..fixed {
            let ty = if is_optional(i) {
                self.optional_property(elems[i])
            } else {
                elems[i]
            };
            elements.push((ty, self.number_name(i as f64)));
        }
        // `getNamedMembers` sorts the members without a declaration by name: "0", "1", "10", "2", .., "length".
        for i in in_order_of_decimal_text(fixed) {
            let optional = is_optional(i);
            let (ty, name) = elements[i];
            b.add(Prop {
                name,
                // `getLiteralTypeFromProperty`: synthesized without a declaration or a `nameType`,
                // it is keyed by the string "0".
                flags: PropFlags::STRING_NAME
                    | if optional {
                        PropFlags::OPTIONAL
                    } else {
                        PropFlags::empty()
                    }
                    | if readonly {
                        PropFlags::READONLY
                    } else {
                        PropFlags::empty()
                    },
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
                name_type: TypeId::UNRESOLVED,
            });
        }
        let length = if fixed == flags.len() {
            // `createTupleTargetType`: the minimum length is the number of required elements,
            // regardless of their positions.
            let min = flags
                .iter()
                .filter(|f| f.contains(ElemFlags::REQUIRED))
                .count();
            let lengths: SmallVec<[TypeId; 4]> = (min..=fixed)
                .map(|n| self.number_literal(n as f64, false))
                .collect();
            self.union(&lengths)
        } else {
            TypeId::NUMBER
        };
        b.add(Prop {
            name: known::length,
            flags: if readonly {
                PropFlags::READONLY
            } else {
                PropFlags::empty()
            },
            source: PropSource::Type(length),
            mapper: MapperId::IDENTITY,
            name_type: TypeId::UNRESOLVED,
        });
        let array = self.tuple_base_type(elems, flags, readonly);
        let heir = matches!(self.data(array), TypeData::Ref { .. }).then_some(this);
        let own = b.shape.props.len();
        self.inherit(&mut b, array, heir);
        // `getNamedMembers`: members without a declaration come last. The inherited ones are in order.
        b.shape.props.rotate_left(own);
        b.shape
    }

    /// `getTupleBaseType`
    fn tuple_base_type(&mut self, elems: &[TypeId], flags: &[ElemFlags], readonly: bool) -> TypeId {
        let element = self.tuple_element_union(elems, flags);
        self.array_as(element, readonly, FirstRequest::NONE)
    }

    /// `createNormalizedTupleType`, starting with its first step: `[A, ...(X | Y)]` is `[A, ...X] | [A, ...Y]`.
    fn distributed_tuple(
        &mut self,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
    ) -> TypeId {
        let Some(i) = (0..elems.len())
            .find(|&i| flags[i].contains(ElemFlags::VARIADIC) && self.is_union(elems[i]))
        else {
            return self.normalized_tuple(elems, flags, readonly);
        };
        let mut variant_elems = elems.to_vec();
        let mut all = Vec::new();
        for &part in self.parts(elems[i]) {
            variant_elems[i] = part;
            all.push(self.distributed_tuple(&variant_elems, flags, readonly));
        }
        self.union(&all)
    }

    /// The union of the element types of the tuple.
    pub fn tuple_element_union(&mut self, elems: &[TypeId], flags: &[ElemFlags]) -> TypeId {
        let arity = elems.len().min(flags.len());
        self.element_type_of_slice(&elems[..arity], flags, 0, 0, false)
            .unwrap_or(TypeId::NEVER)
    }

    fn signatures_identical(&mut self, a: SigId, b: SigId) -> bool {
        self.compare_signatures_identical(
            a,
            b,
            PartialMatch::No,
            IgnoreThisTypes::No,
            IgnoreReturnTypes::No,
            &mut Self::compare_types_identical,
        )
        .holds()
    }

    /// `isMixinConstructorType` for a type whose construct signatures are `sigs`: one signature,
    /// without type parameters, whose only parameter is `...args: any[]`.
    pub(super) fn is_mixin_constructor_type(&mut self, sigs: &[SigId]) -> bool {
        let &[sig] = sigs else { return false };
        // The number of declared parameters is known without resolving their types.
        if self
            .sig_decl(sig)
            .is_some_and(|(file, func, _)| self.hir(file)[func].params.len() != 1)
        {
            return false;
        }
        if !self.sig_type_params(sig).is_empty() {
            return false;
        }
        let params = self.sig_params(sig);
        let [param] = &params[..] else { return false };
        param.rest && (self.is_any(param.ty) || self.array_element(param.ty) == Some(TypeId::ANY))
    }

    /// `findMixins`: the construct signatures of each member of an intersection, and which members
    /// are mixin constructors whose signatures are dropped.
    fn find_mixins(
        &mut self,
        parts: &[TypeId],
    ) -> (SmallVec<[List<'p, SigId>; 4]>, SmallVec<[bool; 8]>) {
        let mut constructors: SmallVec<[List<'p, SigId>; 4]> = SmallVec::new();
        let mut is_mixin: SmallVec<[bool; 8]> = SmallVec::new();
        for &part in parts {
            let sigs = self.signatures(part, true);
            is_mixin.push(self.is_mixin_constructor_type(&sigs));
            constructors.push(sigs);
        }
        let constructor_types = constructors.iter().filter(|sigs| !sigs.is_empty()).count();
        let mixins = is_mixin.iter().filter(|&&mixin| mixin).count();
        // If all constructor types are mixin constructors, the first one remains a constructor.
        if constructor_types > 0
            && constructor_types == mixins
            && let Some(first) = is_mixin.iter().position(|&mixin| mixin)
        {
            is_mixin[first] = false;
        }
        (constructors, is_mixin)
    }

    /// `resolveStructuredTypeMembers`, for the signatures and the index signatures of `ty`.
    ///
    /// For an intersection they aren't in `members`, which only has its properties.
    /// `getPropertyOfType` and `getPropertiesOfType` go from constituent to constituent, and only
    /// `resolveIntersectionTypeMembers` compares the constituents' signatures, which resolves the
    /// types in them. A union keeps them separate in the same way (`signatures`,
    /// `union_as_object`).
    pub(super) fn structured_members(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let TypeData::Intersection(parts) = self.data(ty) else {
            // The members of a substitution type are those of an intersection.
            let members = self.members(ty)?;
            return Some(self.structured(members));
        };
        // They're cached as the members of a separate object type, because the shape under the key
        // `ty` has the properties, which are far more numerous.
        if let Some(known) = self.p.intersection_objects.get(&self.task, &ty) {
            return self.members(known);
        }
        let q = Query::Shape(ty);
        let built = if let Some(built) = self.provisionally_cached_shape(q) {
            built
        } else if !self.enter(q) {
            self.provisional_shape(Shape::new_in(self.arena))
        } else {
            let shape = self.resolve_intersection_type_members(ty, parts);
            match self.leave(q) {
                Ok(stored) => {
                    let object = self.synth(shape);
                    let objects_table = &self.p.intersection_objects;
                    let object = objects_table.insert(&self.task, ty, object, stored);
                    return self.members(object);
                }
                Err(open) => self.cache_shape_provisionally(q, shape, open),
            }
        };
        Some(Members {
            resolved: built.resolved,
            mapper: MapperId::IDENTITY,
        })
    }

    /// The properties of the intersection `ty`. `may_wait` means the caller is `members_for_a_name`, which handles the
    /// result as described at `leave_unlisted`.
    fn properties_of_intersection(
        &mut self,
        ty: TypeId,
        parts: &[TypeId],
        may_wait: bool,
    ) -> Built<'p> {
        if let Some(shape_handle) = self.p.shapes.handle(&self.task, &ty) {
            return Built {
                resolved: self.p.shapes.at(&self.task, shape_handle),
                store_handle: Some(shape_handle),
            };
        }
        if let Some((shape, stored)) = self.list_unlisted_intersection(ty) {
            return self.cache_shape(ty, shape, stored);
        }
        let q = Query::Properties(ty);
        if let Some(built) = self.provisionally_cached_shape(q) {
            return built;
        }
        // The members of a constituent can depend on the properties of the whole.
        if !self.enter(q) {
            return self.provisional_shape(Shape {
                properties_of: Some(ty),
                ..Shape::new_in(self.arena)
            });
        }
        let counters = self.non_cacheable_mark();
        let (shape, waiting) = self.build_intersection_shape(ty, parts, may_wait);
        // A constituent whose members are in place doesn't have all of them yet.
        let is_in_place = self.non_cacheable_mark() != counters;
        let left = self.leave(q);
        let shape = match (waiting, left) {
            (Some(waiting), Ok(stored)) if !is_in_place => {
                return self.leave_unlisted(ty, shape, waiting, stored);
            }
            (Some(waiting), _) => {
                Self::list_properties(&Resolved::new(shape), &waiting, self.arena)
            }
            (None, _) => shape,
        };
        match left {
            Ok(_) if is_in_place => self.provisional_shape(shape),
            Ok(stored) => self.cache_shape(ty, shape, stored),
            Err(open) => self.cache_shape_provisionally(q, shape, open),
        }
    }

    /// `structured_members` of the type that `members` belongs to.
    #[inline]
    pub fn structured(&mut self, members: Members<'p>) -> Members<'p> {
        match members.shape().properties_of() {
            Some(intersection) => self.structured_members(intersection).unwrap_or(members),
            None => members,
        }
    }

    /// The members of `constituent`, which is part of the intersection `whole`, with the type they were read from and,
    /// if they're the common members of a union, that union. The third value is the type `members` was called with,
    /// unless they're the members of a tuple with a different `this`.
    fn members_of_constituent(
        &mut self,
        whole: TypeId,
        constituent: TypeId,
    ) -> (TypeId, Option<TypeId>, TypeId, Option<Members<'p>>) {
        let part = self.apparent_type(constituent);
        // `getPropertiesOfType`, `getIndexInfosOfType`, `getSignaturesOfType`: for a union, the
        // members common to all its constituents.
        let union = self.is_union(part).then_some(part);
        let part = union.map_or(part, |union| self.union_as_object(union));
        // `getTypeWithThisArgument`: `this` in a member of a constituent is the whole
        // intersection, unless the constituent specifies its own, as the apparent type of a
        // type variable does.
        let (queried_type, members) = if self.is_deferred(constituent) {
            (part, self.members_of_apparent_type(constituent, part))
        } else {
            self.type_and_members_with_this(part, whole)
        };
        (part, union, queried_type, members)
    }

    /// `resolveIntersectionTypeMembers`
    fn resolve_intersection_type_members(&mut self, whole: TypeId, parts: &[TypeId]) -> Shape<'s> {
        let mut shape = Shape::new_in(self.arena);
        let (constructors, is_mixin) = self.find_mixins(parts);
        let has_mixins = is_mixin.contains(&true);
        for (at, &constituent) in parts.iter().enumerate() {
            let (_, union, _, Some(members)) = self.members_of_constituent(whole, constituent)
            else {
                continue;
            };
            // The apparent type of a type variable can be an intersection.
            let members = self.structured(members);
            let (call, construct) = match union {
                Some(union) => (self.signatures(union, false), self.signatures(union, true)),
                None => (
                    List::Permanent(members.call_signatures()),
                    List::Permanent(members.construct_signatures()),
                ),
            };
            // A signature identical to an existing one isn't added.
            for &sig in call.iter() {
                let sig = self.instantiate_sig(sig, members.mapper);
                if !shape
                    .call
                    .iter()
                    .any(|&s| self.signatures_identical(s, sig))
                {
                    shape.call.push(sig);
                }
            }
            // A mixin constructor doesn't contribute a construct signature. Its return type becomes
            // part of the return types of the other members' signatures.
            if !is_mixin[at] {
                for &sig in construct.iter() {
                    let mut sig = self.instantiate_sig(sig, members.mapper);
                    if has_mixins {
                        // `includeMixinType`
                        let mut mixed = Vec::with_capacity(parts.len());
                        for other in 0..parts.len() {
                            if other == at {
                                mixed.push(self.sig_return(sig));
                            } else if is_mixin[other] {
                                mixed.push(self.sig_return(constructors[other][0]));
                            }
                        }
                        let ret = self.intersection(&mixed);
                        sig = self.types().intern_sig(SigData::WithReturn { sig, ret });
                    }
                    if !shape
                        .construct
                        .iter()
                        .any(|&s| self.signatures_identical(s, sig))
                    {
                        shape.construct.push(sig);
                    }
                }
            }
            // `appendIndexInfo`
            for info in members.index_infos() {
                let value = self.instantiate(info.value, members.mapper);
                match shape.index.iter_mut().find(|i| i.key == info.key) {
                    Some(existing) => {
                        let value = self.intersection(&[existing.value, value]);
                        let readonly = existing.readonly && info.readonly;
                        *existing = IndexInfo::new(info.key, value, readonly);
                    }
                    None => shape.index.push(IndexInfo { value, ..*info }),
                }
            }
        }
        shape
    }

    /// `getPropertiesOfUnionOrIntersectionType`: `createUnionOrIntersectionProperty` for each name.
    /// See `structured_members`.
    ///
    /// With `may_wait`, the properties may stay unlisted (see `unlisted`). If they do, the constituents are returned
    /// too, and the shape has only the properties whose name several constituents share.
    fn build_intersection_shape(
        &mut self,
        whole: TypeId,
        parts: &[TypeId],
        may_wait: bool,
    ) -> (Shape<'s>, Option<Constituents<'p>>) {
        let mut properties = IntersectionBuilder::new_in(self.arena);
        let mut waiting = may_wait.then(Constituents::new);
        for &constituent in parts {
            let (part, union, queried_type, Some(members)) =
                self.members_of_constituent(whole, constituent)
            else {
                continue;
            };
            let is_module = matches!(
                self.data(part),
                TypeData::Anon {
                    origin: Origin::Module(_) | Origin::Namespace { .. },
                    ..
                }
            );
            // The properties a module lists aren't the same as the ones a lookup finds in it.
            if is_module && let Some(waiting) = waiting.take() {
                properties.add_all(&waiting, self.arena);
            }
            if let Some(waiting) = &mut waiting {
                waiting.push(self.instantiate_constituent(queried_type, members));
            } else {
                properties.b.reserve(members.shape().props.len());
                for prop in &members.shape().props {
                    // `getPropertyOfTypeEx(t, name, .., false)`
                    if is_module && self.is_type_only_member(part, prop.name) {
                        continue;
                    }
                    let mut own = prop.clone_in(self.arena);
                    self.instantiate_prop(&mut own, members.mapper);
                    properties.add(own, self.arena);
                }
            }
            // Whether it has signatures determines which global types' properties it gets.
            let [call, construct] = match union {
                Some(union) => {
                    [false, true].map(|kind| self.signatures(union, kind).first().copied())
                }
                None => members.first_signatures(),
            };
            for (all, part_signature) in [
                (&mut properties.b.shape.call, call),
                (&mut properties.b.shape.construct, construct),
            ] {
                if all.is_empty()
                    && let Some(sig) = part_signature
                {
                    all.push(self.instantiate_sig(sig, members.mapper));
                }
            }
        }
        let waiting = match waiting {
            Some(mut waiting) if self.may_stay_unlisted(whole, &waiting) => properties
                .add_shared(&mut waiting, self.arena)
                .then_some(waiting),
            Some(waiting) => {
                properties.add_all(&waiting, self.arena);
                None
            }
            None => None,
        };
        (self.combine_properties(whole, properties), waiting)
    }

    /// The tail of `createUnionOrIntersectionProperty`, run for each name.
    fn combine_properties(
        &mut self,
        whole: TypeId,
        properties: IntersectionBuilder<'s>,
    ) -> Shape<'s> {
        let IntersectionBuilder { mut b, lists, .. } = properties;
        b.shape.properties_of = Some(whole);
        let mut members_seen = crate::util::FxHashSet::<(Sym, PropFlags)>::default();
        for (prop, mut list) in b.shape.props.iter_mut().zip(lists) {
            // `propSet` contains each symbol once. The constituents gave the same member different mappers.
            members_seen.clear();
            list.retain(|it| match it.source {
                PropSource::Symbol(sym) if self.is_uninstantiated_member(it, sym) => {
                    members_seen.insert((sym, it.flags.difference(PropFlags::THISLESS)))
                }
                _ => true,
            });
            if list.len() > 1 {
                let every = |flag: PropFlags| list.iter().all(|p| p.flags.contains(flag));
                // Optional if every property, method or accessor among them is. A variable of a
                // module or of `globalThis` isn't considered.
                let is_member = |p: &&Prop| !matches!(p.source, PropSource::Symbol(sym) if !self.is_member_symbol(sym));
                let optional =
                    (list.iter().filter(is_member)).all(|p| p.flags.contains(PropFlags::OPTIONAL));
                prop.flags.set(PropFlags::OPTIONAL, optional);
                // The type is the intersection of their types, and such a variable's type has no
                // `undefined`.
                let has_variable = !list.iter().all(|p| is_member(&p));
                prop.flags
                    .set(PropFlags::WITHOUT_OPTIONALITY, optional && has_variable);
                prop.flags
                    .set(PropFlags::READONLY, every(PropFlags::READONLY));
                prop.flags.set(PropFlags::METHOD, every(PropFlags::METHOD));
                // Private if one is, else public if one is, else protected (`getDeclarationModifierFlagsFromSymbol`).
                let private = list.iter().any(|p| p.flags.contains(PropFlags::PRIVATE));
                prop.flags.set(PropFlags::PRIVATE, private);
                prop.flags.set(
                    PropFlags::PROTECTED,
                    !private && every(PropFlags::PROTECTED),
                );
                // An accessor only if all are, and all have the same combination of getter and
                // setter.
                let accessors = |p: &Prop| {
                    let kind = PropFlags::ACCESSOR | PropFlags::READONLY | PropFlags::WRITE_ONLY;
                    if p.flags.contains(PropFlags::ACCESSOR) {
                        p.flags & kind
                    } else {
                        PropFlags::empty()
                    }
                };
                if list.iter().any(|p| accessors(p) != accessors(&list[0])) {
                    prop.flags
                        .remove(PropFlags::ACCESSOR | PropFlags::WRITE_ONLY);
                }
                self.forget_separate_key(prop);
                prop.source = PropSource::Intersected(whole, list.into());
                prop.mapper = MapperId::IDENTITY;
                self.set_modifiers_of_value_declaration(prop);
            }
        }
        b.shape
    }

    /// `tryMergeUnionOfObjectTypeAndEmptyObject`: `{ a: T } | {}`, which is what `cond ? { a } : {}` and `cond && { a }` are,
    /// spreads like `{ a?: T }`.
    pub fn try_merge_union_of_object_type_and_empty_object(&mut self, ty: TypeId) -> TypeId {
        if !self.is_union(ty) {
            return ty;
        }
        let mut object = None;
        let mut empty = None;
        for &part in self.parts(ty) {
            if self.is_empty_object_type(part) {
                empty.get_or_insert(part);
            } else if (self.is_primitive(part)
                && part != TypeId::VOID
                && !self.is_symbol_like(part))
                || self.is_kind(part, tf::INDEX)
            {
            } else if object.replace(part).is_some() {
                return ty;
            }
        }
        let Some(object) = object else {
            return empty.unwrap_or(TypeId::EMPTY_OBJECT);
        };
        // `getPropertiesOfType`, `getIndexInfosOfType`: whatever the single member is, even a type
        // parameter, its `getReducedApparentType` is used. For a union that means the members
        // common to all its constituents.
        let owner = self.reduced_apparent_type_as_object(object);
        if owner == TypeId::UNRESOLVED {
            return ty;
        }
        let mut shape = Shape::new_in(self.arena);
        // A type that isn't an object type has nothing to copy.
        if let Some(members) = self.members(owner) {
            for prop in &members.shape().props {
                if prop
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                    || !self.is_spreadable_property(prop)
                {
                    continue;
                }
                let ty = if prop.flags.contains(PropFlags::WRITE_ONLY) {
                    TypeId::UNDEFINED
                } else {
                    let ty = self.type_of_prop(prop, members.mapper);
                    self.optional_property(ty)
                };
                let flags = PropFlags::OPTIONAL | self.name_flag_of_copy(owner, prop, true);
                shape.props.push(Prop {
                    name: prop.name,
                    flags,
                    source: Self::copy_of(ty, &[prop], false, self.arena),
                    mapper: MapperId::IDENTITY,
                    name_type: self.name_type_of_copy(owner, prop),
                });
            }
            for info in self.structured(members).index_infos() {
                let value = self.instantiate(info.value, members.mapper);
                shape.index.push(IndexInfo { value, ..*info });
            }
        }
        shape.literal = Literalness::Literal;
        self.synth(shape)
    }

    /// `getLiteralTypeFromProperty` of a copy of `prop`, a property of `owner`. Returns
    /// `STRING_NAME` if its name looks numeric but is a string. `is_new_symbol` means the copy is a new
    /// symbol (`getSpreadSymbol`) with the original's `nameType` but without its declaration, so a
    /// name declared as `1` is keyed by "1".
    pub(super) fn name_flag_of_copy(
        &mut self,
        owner: TypeId,
        prop: &Prop,
        is_new_symbol: bool,
    ) -> PropFlags {
        if prop.flags.contains(PropFlags::STRING_NAME) {
            return PropFlags::STRING_NAME;
        }
        if !self.is_numeric_name(prop.name) {
            return PropFlags::empty();
        }
        // A `nameType` is stored for a late-bound name (`lateBindMember`), and in an object literal
        // for any computed name (`checkObjectLiteral`).
        let is_explicit = match &prop.source {
            PropSource::Symbol(sym) => {
                matches!(self.files().value_declaration(*sym), Some((file, Decl::Member(m)))
                    if matches!(self.hir(file)[m].key, PropKey::Name(_)))
            }
            PropSource::Literal(file, literal_prop) => {
                let hir = self.hir(*file);
                matches!(hir[*literal_prop].key, PropKey::Name(_))
                    && hir.text.get(hir[*literal_prop].pos as usize) != Some(&b'[')
            }
            _ => false,
        };
        if is_new_symbol && is_explicit
            || self
                .key_type_of_prop(owner, prop)
                .is_some_and(|key| self.is_string_like(key))
        {
            PropFlags::STRING_NAME
        } else {
            PropFlags::empty()
        }
    }

    /// `isNonGenericObjectType`
    fn is_non_generic_object_type(&mut self, ty: TypeId) -> bool {
        self.is_object_type(ty) && !(self.is_mapped_type(ty) && self.is_generic(ty))
    }

    /// True if `prop`'s symbol has `SymbolFlagsFunction`: a function that a module or namespace exports.
    fn is_function_symbol_property(&self, prop: &Prop) -> bool {
        matches!(prop.source, PropSource::Symbol(symbol) if self.files().flags(symbol).contains(SymFlags::FUNCTION))
    }

    /// `getSpreadType`: `{ ...left, ...right }`
    pub fn spread(&mut self, left: TypeId, right: TypeId) -> TypeId {
        self.get_spread_type(left, right, false, &mut 0)
    }

    /// `getSpreadSymbol(prop, readonly)` for `prop`, a property of a type whose members have the
    /// mapper `mapper`.
    /// When it returns `prop` itself, the type of a declared, mapped or reverse mapped symbol is
    /// left unresolved, since it may be the one being resolved:
    /// `class C { x = f({ ...new C() }) }`. `get_widened_type` and `regular_type_of_object_literal`
    /// resolve it at the point where tsgo calls `getTypeOfSymbol` for every property.
    pub(super) fn get_spread_symbol(
        &mut self,
        prop: &Prop,
        mapper: MapperId,
        options: SpreadSymbolOptions,
    ) -> Prop<'s> {
        let SpreadSymbolOptions {
            owner,
            owner_is_generic,
            readonly,
            resolves,
        } = options;
        let is_setonly_accessor = prop.flags.contains(PropFlags::WRITE_ONLY);
        let is_same_symbol = !is_setonly_accessor && readonly == self.is_readonly_symbol(prop);
        let mut flags =
            prop.flags & PropFlags::OPTIONAL | self.name_flag_of_copy(owner, prop, !is_same_symbol);
        flags.set(PropFlags::READONLY, readonly);
        if is_same_symbol {
            // A method stays a method, and an accessor stays an accessor.
            flags |= prop.flags & (PropFlags::METHOD | PropFlags::ACCESSOR);
            if self.is_function_symbol_property(prop) {
                flags |= PropFlags::METHOD;
            }
            let is_resolved_on_demand = matches!(
                prop.source,
                PropSource::Symbol(_) | PropSource::Mapped(..) | PropSource::ReverseMapped(..)
            );
            if !resolves && is_resolved_on_demand {
                let (mut composed, is_separate_key) = self.composed_mapper_of_prop(prop, mapper);
                // `Types::object_flags` finds the type variables of such a property in its mapper. The members of a
                // type literal in a generic declaration have none in theirs, and a key that's stored separately
                // (`Types::separate_key`) isn't in the mapper either.
                let mapping = self.types().mapping(composed);
                if !owner_is_generic || mapping.iter().any(|it| self.has_type_variables(it.1)) {
                    let read_with =
                        PropFlags::WITHOUT_OPTIONALITY | PropFlags::WIDEN | PropFlags::REGULAR;
                    let mut name_type = self.name_type_of_copy(owner, prop);
                    if is_separate_key && name_type == TypeId::UNRESOLVED {
                        name_type = prop.name_type;
                    } else if is_separate_key {
                        composed = self.mapper_of_prop(prop);
                    }
                    return Prop {
                        name: prop.name,
                        flags: flags | prop.flags & read_with,
                        source: prop.source.clone_in(self.arena),
                        mapper: composed,
                        name_type,
                    };
                }
            }
        }
        let ty = if is_setonly_accessor {
            TypeId::UNDEFINED
        } else {
            self.type_of_prop(prop, mapper)
        };
        Prop {
            name: prop.name,
            flags,
            source: Self::copy_of(ty, &[prop], is_same_symbol, self.arena),
            mapper: MapperId::IDENTITY,
            name_type: self.name_type_of_copy(owner, prop),
        }
    }

    /// The members of the union `ty` in the order `mapType` visits them.
    fn members_in_map_type_order(&self, ty: TypeId, members: &mut Vec<TypeId>) {
        let types: &[TypeId] = match self.origin(ty) {
            UnionOrigin::Union(origin) => origin,
            _ => self.parts(ty),
        };
        for &member in types {
            if self.is_union(member) {
                self.members_in_map_type_order(member, members);
            } else {
                members.push(member);
            }
        }
    }

    /// `getSpreadType`. `readonly` is set in a const context. For `rank`, see `Shape::spread_rank`.
    pub(super) fn get_spread_type(
        &mut self,
        left: TypeId,
        right: TypeId,
        readonly: bool,
        rank: &mut u32,
    ) -> TypeId {
        if self.is_any(left) || self.is_any(right) {
            return if left == TypeId::UNRESOLVED || right == TypeId::UNRESOLVED {
                TypeId::UNRESOLVED
            } else {
                TypeId::ANY
            };
        }
        if left == TypeId::UNKNOWN || right == TypeId::UNKNOWN {
            return TypeId::UNKNOWN;
        }
        if left.is_never() {
            return right;
        }
        if right.is_never() {
            return left;
        }
        let left = self.try_merge_union_of_object_type_and_empty_object(left);
        if self.is_union(left) {
            if !self.check_cross_product_union(&[left, right]) {
                return TypeId::ERROR;
            }
            let mut members = Vec::new();
            self.members_in_map_type_order(left, &mut members);
            let spread: Vec<TypeId> = members
                .into_iter()
                .map(|p| self.get_spread_type(p, right, readonly, rank))
                .collect();
            return self.union(&spread);
        }
        let right = self.try_merge_union_of_object_type_and_empty_object(right);
        if self.is_union(right) {
            if !self.check_cross_product_union(&[left, right]) {
                return TypeId::ERROR;
            }
            let mut members = Vec::new();
            self.members_in_map_type_order(right, &mut members);
            let spread: Vec<TypeId> = members
                .into_iter()
                .map(|p| self.get_spread_type(left, p, readonly, rank))
                .collect();
            return self.union(&spread);
        }
        // Booleans, numbers, bigints, strings, enums, `object` and `keyof T` add nothing, so the result is `left`
        // itself.
        let is_nullish_or_symbol = self.is_nullish(right) || self.is_symbol_like(right);
        if self.is_primitive(right) && !is_nullish_or_symbol
            || right == TypeId::OBJECT
            || self.is_kind(right, tf::INDEX)
        {
            return left;
        }
        if self.is_generic_object_type(left) || self.is_generic_object_type(right) {
            if self.is_empty_object_type(left) {
                return right;
            }
            // `T & { a: string }` and `{ b: string }` make `T & { a: string, b: string }`.
            if let TypeData::Intersection(parts) = self.data(left)
                && let Some((&last, others)) = parts.split_last()
                && self.is_non_generic_object_type(last)
                && self.is_non_generic_object_type(right)
            {
                let mut parts = others.to_vec();
                parts.push(self.get_spread_type(last, right, readonly, rank));
                return self.intersection(&parts);
            }
            return self.intersection(&[left, right]);
        }
        // `getPropertiesOfType`, `getIndexInfosOfType`: `null`, `undefined` and `void` have no members, so spreading
        // one of them copies the other side without its index signatures. `never`, which the apparent type can reduce
        // to, has no members either.
        let members_of = |c: &mut Self, ty: TypeId| {
            let ty = match c.is_nullish(ty) {
                true => TypeId::EMPTY_OBJECT,
                false => c.reduced_apparent_type_as_object(ty),
            };
            c.members(if ty.is_never() {
                TypeId::EMPTY_OBJECT
            } else {
                ty
            })
        };
        let (Some(l), Some(r)) = (members_of(self, left), members_of(self, right)) else {
            return TypeId::UNRESOLVED;
        };
        let mut b = Builder::new_in(self.arena);
        b.reserve(l.shape().props.len() + r.shape().props.len());
        // The result of spreading into a JSX attributes type is still a JSX attributes type
        // (`objectFlags`).
        let is_jsx = |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        let (left_is_jsx, right_is_jsx) = (is_jsx(self, left), is_jsx(self, right));
        // Properties declared in the literal itself remain marked as such
        // (`shouldCheckAsExcessProperty`): on the left in the accumulated spread result, or in the
        // run that follows a generic spread (`lastLeft`), on the right in a run of properties
        // between spreads.
        let left_is_accumulated = left_is_jsx
            || matches!(self.data(left), TypeData::Synth(shape) if matches!(shape.literal, Literalness::WithSpread | Literalness::Written));
        let right_is_declared_in_literal = right_is_jsx
            || matches!(self.data(right), TypeData::Synth(shape) if shape.literal == Literalness::Written);
        // `getSpreadSymbol` returns the same symbol, so the synthesized JSX children property keeps
        // the declaration that makes it count as declared in the element.
        let is_declared_in_literal = |prop: &Prop| {
            matches!(prop.source, PropSource::Literal(..))
                || prop
                    .flags
                    .intersects(PropFlags::JSX_CHILDREN | PropFlags::DECLARED_IN_LITERAL)
        };
        let left_is_generic = self.has_type_variables(left);
        let right_is_generic = self.has_type_variables(right);
        for prop in &l.shape().props {
            if !self.is_spreadable_property(prop) {
                continue;
            }
            // `skippedPrivateMembers`, and `members[leftProp.Name] != nil`: `getSpreadSymbol` isn't called for the
            // property on the left. If the one on the right is optional, the left property itself holds the position
            // for the symbol that the loop below creates from the two.
            if let Some(later) = r.resolved.prop(prop.name) {
                if later
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                {
                    continue;
                }
                if self.is_spreadable_property(later) {
                    if later.flags.contains(PropFlags::OPTIONAL) {
                        b.add(prop.clone_in(self.arena));
                    }
                    continue;
                }
            }
            // `getSpreadSymbol`: a write-only property reads as `undefined`. It's recreated, and so is a property whose
            // readonly-ness differs from the result's.
            let is_recreated = prop.flags.contains(PropFlags::WRITE_ONLY)
                || prop.flags.contains(PropFlags::READONLY) != readonly;
            if left_is_accumulated && !is_recreated && is_declared_in_literal(prop) {
                b.add(prop.clone_in(self.arena));
                continue;
            }
            let options = SpreadSymbolOptions {
                owner: left,
                owner_is_generic: left_is_generic,
                readonly,
                resolves: false,
            };
            b.add(self.get_spread_symbol(prop, l.mapper, options));
        }
        for prop in &r.shape().props {
            // `skippedPrivateMembers`: it hides the existing property of that name, and isn't
            // copied itself.
            if prop
                .flags
                .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
            {
                b.remove(prop.name);
                continue;
            }
            if !self.is_spreadable_property(prop) {
                continue;
            }
            let is_write_only = prop.flags.contains(PropFlags::WRITE_ONLY);
            let is_recreated =
                is_write_only || prop.flags.contains(PropFlags::READONLY) != readonly;
            let is_merged = prop.flags.contains(PropFlags::OPTIONAL) && b.has(prop.name);
            if right_is_declared_in_literal
                && !is_recreated
                && !is_merged
                && is_declared_in_literal(prop)
            {
                b.remove(prop.name);
                b.add_new(prop.clone_in(self.arena));
                continue;
            }
            let copy = if is_merged && let Some(left_prop) = l.resolved.prop(prop.name) {
                let mut ty = if is_write_only {
                    TypeId::UNDEFINED
                } else {
                    self.type_of_prop(prop, r.mapper)
                };
                // `leftType := c.getTypeOfSymbol(leftProp)`: of the property itself, which for a
                // set-only accessor isn't the `undefined` that `getSpreadSymbol` gives its copy.
                let left_ty = self.type_of_prop(left_prop, l.mapper);
                // It's recreated, and named like the one on the left.
                let named = self.name_flag_of_copy(left, left_prop, true);
                let name_type = self.name_type_of_copy(left, left_prop);
                let flags = left_prop.flags & PropFlags::OPTIONAL | named;
                // `getSpreadType`: the type on the left, or the type on the right when that
                // property is present.
                let left_present = self.remove_missing_or_undefined_type(left_ty);
                let present = self.remove_missing_or_undefined_type(ty);
                ty = if left_present == present {
                    left_ty
                } else {
                    self.union_reduced(&[left_ty, present])
                };
                Prop {
                    name: prop.name,
                    flags,
                    source: Self::copy_of(ty, &[left_prop, prop], false, self.arena),
                    mapper: MapperId::IDENTITY,
                    name_type,
                }
            } else {
                // `rightType := c.getTypeOfSymbol(rightProp)`, for a property that the left has too.
                let replaces = (l.resolved.prop(prop.name))
                    .is_some_and(|earlier| self.is_spreadable_property(earlier));
                let options = SpreadSymbolOptions {
                    owner: right,
                    owner_is_generic: right_is_generic,
                    readonly,
                    resolves: replaces,
                };
                self.get_spread_symbol(prop, r.mapper, options)
            };
            match b.position(prop.name) {
                Some(i) if prop.flags.contains(PropFlags::OPTIONAL) => b.shape.props[i] = copy,
                // A later property goes last.
                _ => {
                    b.remove(prop.name);
                    b.add_new(copy);
                }
            }
        }
        self.get_named_members(&mut b.shape.props, |_| true, &[]);
        // `getIndexInfoWithReadonly`
        if left == TypeId::EMPTY_OBJECT {
            for info in self.structured(r).index_infos() {
                let value = self.instantiate(info.value, r.mapper);
                b.shape.index.push(IndexInfo {
                    value,
                    readonly,
                    is_enum_number_index_info: info.is_enum_number_index_info
                        && info.readonly == readonly,
                    ..*info
                });
            }
        } else if !self.structured(l).index_infos().is_empty() {
            for info in self.union_index_infos(&[left, right]) {
                b.shape.index.push(IndexInfo { readonly, ..info });
            }
        }
        b.shape.literal = if left_is_jsx || right_is_jsx {
            Literalness::JsxAttributes
        } else {
            Literalness::WithSpread
        };
        b.shape.created_from = Some((left, right));
        b.shape.spread_rank = *rank;
        *rank += 1;
        self.synth(b.shape)
    }

    // ───────────────────────────── reading ─────────────────────────────

    /// The type of `prop`, which was found in a type whose mapper is `outer`.
    pub fn type_of_prop(&mut self, prop: &Prop, outer: MapperId) -> TypeId {
        let mut adds_undefined = false;
        let mut own_mapper = prop.mapper;
        // `base` is `links.resolvedType` of the instantiated symbol: the mapper has been applied.
        let mut has_resolved_type = false;
        let base = match &prop.source {
            PropSource::Type(t) | PropSource::Copy(t, ..) => *t,
            PropSource::ReverseMapped(of, _) => self.type_of_reverse_mapped_prop(*of, prop.name),
            // `getTypeOfMappedSymbol` instantiates the template with `prop.mapper` before it adjusts for optionality.
            PropSource::Mapped(of, strips_optional, _) => {
                own_mapper = MapperId::IDENTITY;
                self.type_of_mapped_prop(*of, prop, *strips_optional)
            }
            PropSource::Literal(file, p) => self.type_of_literal_prop(*file, *p),
            PropSource::Symbol(sym) => {
                let optionality = PropFlags::OPTIONAL | PropFlags::WITHOUT_OPTIONALITY;
                adds_undefined = prop.flags & optionality == PropFlags::OPTIONAL;
                let linked_type = match self.instantiated_symbol_links.is_empty() {
                    true => None,
                    false => {
                        cold_path();
                        self.link_of_instantiated_symbol(prop, *sym, outer)
                    }
                };
                has_resolved_type = linked_type.is_some();
                match linked_type {
                    Some(resolved_type) => resolved_type,
                    None => {
                        let work = self.work;
                        let target_type = self.type_of_symbol(*sym);
                        if self.work != work {
                            self.assign_resolved_type_of_instantiated_symbol(
                                prop,
                                *sym,
                                outer,
                                target_type,
                            );
                        }
                        target_type
                    }
                }
            }
            PropSource::Intersected(whole, parts) => {
                let key = (*whole, prop.name);
                if let Some(known) = self.p.intersected_props.get(&self.task, &key) {
                    known
                } else {
                    let scope = self.begin_scope();
                    let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                    let is_union = self.is_union(*whole);
                    for part in parts.iter() {
                        let ty = self.type_of_prop(part, MapperId::IDENTITY);
                        let single = (&parts[0], types.first());
                        if is_union || !Self::is_merged_instantiation(single, (part, ty)) {
                            types.push(ty);
                        }
                    }
                    let all = match types[..] {
                        _ if is_union => self.union(&types),
                        // An intersection of one aliased intersection would lose the alias.
                        [only] => only,
                        _ => self.intersection(&types),
                    };
                    if let Ok(stored) = self.end_scope_by_counters(scope) {
                        self.p
                            .intersected_props
                            .insert(&self.task, key, all, stored);
                    }
                    all
                }
            }
        };
        let is_changed =
            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES | ObjectFlags::HAS_OTHER_INSTANTIATION;
        let is_instantiated = !has_resolved_type
            && self.types().object_flags(base).intersects(is_changed)
            && match prop.source {
                PropSource::Symbol(sym) => {
                    !prop.flags.contains(PropFlags::THISLESS)
                        && !self.is_thisless_for_this_mapper(sym)
                }
                _ => true,
            };
        let ty = if is_instantiated {
            // `getTypeOfInstantiatedSymbol`: for an inherited member, the mapper of the base type
            // that `resolveObjectTypeMembers` has instantiated.
            let mapper = self.compose(own_mapper, outer);
            self.type_of_instantiated_symbol(base, mapper)
        } else {
            base
        };
        let ty = if prop.flags.contains(PropFlags::WIDEN) {
            cold_path();
            self.get_widened_type(ty)
        } else if prop.flags.contains(PropFlags::REGULAR) {
            cold_path();
            self.regular_type_of_resolved_object_literal(ty)
        } else {
            ty
        };
        if adds_undefined {
            self.cached_optional_property(ty)
        } else {
            ty
        }
    }

    /// `m.MapsThisOnly() && isThisless(symbol)`: true if `instantiateSymbol` returns `sym`, a member of a class or
    /// interface, unchanged. `m` is the mapper of `resolveObjectTypeMembers`, whose sources are the type parameters of
    /// the class or interface, including the outer ones, and its `this` type. Without a `this` type there's no mapper
    /// (`resolveClassOrInterfaceMembers`).
    pub(super) fn is_thisless_for_this_mapper(&mut self, sym: Sym) -> bool {
        if let Some(&known_thisless) = self.thisless_members.get(&sym) {
            return known_thisless;
        }
        let scope = self.begin_scope();
        let is_thisless = self.compute_is_thisless_for_this_mapper(sym);
        // `has_this_type` returns false for an interface it's in the middle of examining, and a container whose
        // computed names are being bound has only its early-bound members.
        if self.end_scope_by_counters(scope).is_ok()
            && self.this_types_in_progress.is_empty()
            && self.late_binding.is_empty()
        {
            self.thisless_members.insert(sym, is_thisless);
        }
        is_thisless
    }

    fn compute_is_thisless_for_this_mapper(&mut self, sym: Sym) -> bool {
        let Some((file, Decl::Member(m))) = self.files().value_declaration(sym) else {
            return false;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (type_params, owner) = match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => (hir[c].type_params, bound.class_symbol[c.idx()]),
            MemberOwner::Interface(i) => (hir[i].type_params, bound.interface_symbol[i.idx()]),
            _ => return false,
        };
        if !type_params.is_empty() || owner.is_none() {
            return false;
        }
        let owner = self.files().sym(file, owner);
        (self.is_thisless(sym) || !self.has_this_type(owner))
            && self.outer_type_params_of_symbol(owner).is_empty()
    }

    /// `isThisless`, for a member of a class or interface.
    fn is_thisless(&mut self, sym: Sym) -> bool {
        let declarations = self.declarations_of_property(sym);
        let [(file, Decl::Member(m))] = declarations[..] else {
            return false;
        };
        let hir = self.hir(file);
        let member = &hir[m];
        match member.kind {
            // `isThislessVariableLikeDeclaration`
            MemberKind::Property if member.ty.is_some() => {
                super::errors_unused::is_thisless_type(hir, member.ty)
            }
            MemberKind::Property => member.init.is_none(),
            _ => super::errors_unused::is_thisless(hir, m),
        }
    }

    /// `optional_property`, cached per type.
    pub(super) fn cached_optional_property(&mut self, ty: TypeId) -> TypeId {
        if let Some(known) = self.p.optional_properties.get(&self.task, &ty) {
            return known;
        }
        let scope = self.begin_scope();
        let optional = self.optional_property(ty);
        // Whether it's stored is decided below.
        let ended = self.end_scope_as(scope, false);
        // `union` runs further queries for members of these kinds on every call, so the result isn't cached.
        let runs_queries = self.may_be_reduced(ty)
            || self.is_some_type_of_kind(ty, tf::TEMPLATE_LITERAL | tf::STRING_MAPPING);
        if !runs_queries && let Ok(stored) = ended {
            self.p
                .optional_properties
                .insert(&self.task, ty, optional, stored);
        }
        optional
    }

    /// `GetErrorRangeForNode` of `declaration`: for a property declaration or signature, its name.
    pub(super) fn span_of_untyped_property(
        &self,
        file: FileId,
        declaration: UntypedProperty,
    ) -> (FileId, u32, u32) {
        match declaration {
            UntypedProperty::Member(member) => {
                let (hir, end) = (self.hir(file), self.end_of_member_name(file, member));
                let start = super::spans::start_of_error_range(hir, hir[member].name_pos, end);
                (file, start, end)
            }
            UntypedProperty::Assignment(e) => (
                file,
                self.start_inside_parentheses(file, e),
                self.end_inside_parentheses(file, e),
            ),
        }
    }

    /// `reportImplicitAny` for a property whose type resolves to `ty`.
    fn report_implicit_any(&mut self, file: FileId, declaration: UntypedProperty, ty: TypeId) {
        let no_implicit_any = self.p.files.options.no_implicit_any;
        if self.hir(file).is_js && !self.is_check_js(file)
            || !no_implicit_any && !self.captures_suggestions()
        {
            return;
        }
        // `case KindBinaryExpression, KindPropertyDeclaration, KindPropertySignature`. A call expression takes the default case.
        let is_call = matches!(declaration, UntypedProperty::Assignment(e)
            if !matches!(self.hir(file)[e].kind, ExprKind::Assign { .. }));
        let code = match (is_call, no_implicit_any) {
            (false, true) => 7008,
            (false, false) => 7045,
            (true, true) => 7005,
            (true, false) => 7043,
        };
        let at = self.span_of_untyped_property(file, declaration);
        // `DeclarationNameToString(GetNameOfDeclaration(declaration))`
        let name = match declaration {
            UntypedProperty::Member(_) if at.1 != at.2 => Some(self.source_text(file, at.1, at.2)),
            UntypedProperty::Member(_) => None,
            UntypedProperty::Assignment(e) => self.name_of_assignment_declaration(file, e),
        };
        let name = name.unwrap_or_else(|| b"(Missing)".to_vec());
        let diagnostic = self.new_diagnostic(at, code, &[Arg::Bytes(&name), Arg::Type(ty)]);
        self.add_error_or_suggestion(no_implicit_any, diagnostic);
    }

    /// `filterType(ty, flags &^ TypeFlagsNullable != 0) == neverType`: `ty` is `never`, or a union of `null` and
    /// `undefined` only. `void` isn't nullable, and `any` passes the filter.
    pub(super) fn is_all_null_or_undefined(&self, ty: TypeId) -> bool {
        ty.is_never() || self.is_every_type_of_kind(ty, tf::NULLABLE)
    }

    /// `isConstructorDeclaredThisProperty` for the symbol in `file` whose `Declarations` are
    /// `declarations`.
    pub(super) fn is_constructor_declared_this_property(
        &self,
        file: FileId,
        declarations: &[(FileId, Decl)],
    ) -> ThisAssignmentDeclaration {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let hir = self.hir(file);
        let mut type_annotation = TypeNodeId::NONE;
        for &declaration in declarations {
            let Some(e) = assignment_declaration_in(file, declaration) else {
                return ThisAssignmentDeclaration::None;
            };
            let ExprKind::Assign { target, .. } = hir[e].kind else {
                return ThisAssignmentDeclaration::None;
            };
            if assignment_declaration_kind(hir, e) != JsDeclarationKind::ThisProperty
                || matches!(hir[target].kind, ExprKind::Index { index, .. }
                    if !is_string_or_numeric_literal_like(hir, index))
            {
                return ThisAssignmentDeclaration::None;
            }
            let annotation = hir.jsdoc_type(JsDocTypeOwner::Assign(e));
            if annotation.is_some() {
                type_annotation = annotation;
            }
        }
        if declarations.is_empty() {
            return ThisAssignmentDeclaration::None;
        }
        if type_annotation.is_some() {
            return ThisAssignmentDeclaration::Typed(type_annotation);
        }
        let constructor = self.get_declaring_constructor(file, declarations);
        constructor.map_or(
            ThisAssignmentDeclaration::Method,
            ThisAssignmentDeclaration::Constructor,
        )
    }

    /// `getWidenedTypeForAssignmentDeclaration` for the symbol `name` whose `Declarations` are
    /// `declarations` and whose `ValueDeclaration` is `value_declaration`, in `file`.
    pub(super) fn get_widened_type_for_assignment_declaration(
        &mut self,
        file: FileId,
        name: Atom,
        declarations: &[(FileId, Decl)],
        value_declaration: ExprId,
    ) -> TypeId {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let kind = self.is_constructor_declared_this_property(file, declarations);
        let inherited = |c: &mut Self| {
            let class = c.class_of_this_property(file, value_declaration)?;
            c.type_of_property_in_base_class(file, class, name)
        };
        let resolved = match kind {
            ThisAssignmentDeclaration::None => None,
            ThisAssignmentDeclaration::Typed(annotation) => {
                Some(self.type_from_node(file, annotation))
            }
            ThisAssignmentDeclaration::Constructor(func) => {
                // `getFlowTypeOfProperty`: the walk starts from the inherited type, or from `undefinedType`.
                let initial = inherited(self).unwrap_or(TypeId::UNDEFINED);
                let first = UntypedProperty::Assignment(value_declaration);
                self.flow_type_in_constructor_from(file, func, name, initial, first)
            }
            ThisAssignmentDeclaration::Method => inherited(self),
        };
        let is_method_only = matches!(kind, ThisAssignmentDeclaration::Method);
        let ty = match resolved {
            Some(ty) => ty,
            None => {
                let mut types = Vec::with_capacity(declarations.len());
                let mut declared = None;
                for (i, &declaration) in declarations.iter().enumerate() {
                    let Some((of, e)) = assignment_declaration(declaration) else {
                        continue;
                    };
                    let hir = self.hir(of);
                    // `declaration.Type()`: the first annotated declaration decides.
                    let annotation = hir.jsdoc_type(JsDocTypeOwner::Assign(e));
                    if annotation.is_some() {
                        declared = Some(self.type_from_node(of, annotation));
                        break;
                    }
                    // `getAssignmentDeclarationInitializerType`
                    let assigned = match hir[e].kind {
                        ExprKind::Assign { target, value, .. } => {
                            if assignment_declaration_kind(hir, e)
                                == JsDeclarationKind::ThisProperty
                                && self.contains_same_named_this_property(of, target, value)
                            {
                                continue;
                            }
                            self.type_of_assignment_declaration(of, e, value)
                        }
                        ExprKind::Call(call) => match hir.ids(hir[call].args).nth(2) {
                            Some(descriptor) => self.type_from_property_descriptor(of, descriptor),
                            None => continue,
                        },
                        _ => continue,
                    };
                    // "We ignore initial assignments of undefined to CommonJS exports when there are multiple assignment declarations"
                    let is_ignored = i == 0
                        && declarations.len() > 1
                        && assigned.is_undefined()
                        && matches!(
                            assignment_declaration_kind(hir, e),
                            JsDeclarationKind::ExportsProperty(_)
                        );
                    if !is_ignored && !types.contains(&assigned) {
                        types.push(assigned);
                    }
                }
                if let Some(declared) = declared {
                    declared
                } else if types.is_empty() {
                    TypeId::ANY
                } else {
                    let all = self.union(&types);
                    // A property that's only assigned in methods also includes `undefinedOrMissingType` under
                    // strictNullChecks.
                    if is_method_only {
                        self.optional_property(all)
                    } else {
                        all
                    }
                }
            }
        };
        let ty = self.widened(ty);
        // "report an all-nullable or empty union as an implicit any in JS files"
        if self.hir(file).is_js && self.is_all_null_or_undefined(ty) {
            // `checkBinaryExpression` requests the type of the symbol an assignment declares, but
            // `checkCallExpression` doesn't request it for `Object.defineProperty(f, "name", d)`.
            let is_requested_by_check = declarations.iter().any(|&declaration| {
                assignment_declaration(declaration)
                    .is_none_or(|(of, e)| !matches!(self.hir(of)[e].kind, ExprKind::Call(_)))
            });
            if !is_requested_by_check
                && !self.is_emitting
                && !self.is_reported_in_time_on_request(file)
            {
                // A single checker would already have collected `file`'s diagnostics. Nothing is
                // stored, so the task of a file that requests this in time evaluates it and
                // reports.
                self.mark_tainted_from(self.frames.len().saturating_sub(1));
                return TypeId::ANY;
            }
            let value_declaration = UntypedProperty::Assignment(value_declaration);
            self.report_implicit_any(file, value_declaration, TypeId::ANY);
            return TypeId::ANY;
        }
        ty
    }

    /// `getThisClassAndSymbolTable`: the class whose member contains `e`, an assignment to `this.name`.
    fn class_of_this_property(&self, file: FileId, e: ExprId) -> Option<ClassId> {
        let bound = self.bound(file);
        let member = match self.this_container(file, e)? {
            Ok(func) => match bound.fns[func.idx()].owner {
                FnOwner::Member(member) => member,
                _ => return None,
            },
            Err((class, _)) => return Some(class),
        };
        match bound.member_owner[member.idx()] {
            MemberOwner::Class(class) => Some(class),
            _ => None,
        }
    }

    /// `getTypeOfPropertyInBaseClass`: the type of the property `name` in the first base type of `class`.
    /// `getDeclaringClass` is the instance type, even for a static property.
    pub(super) fn type_of_property_in_base_class(
        &mut self,
        file: FileId,
        class: ClassId,
        name: Atom,
    ) -> Option<TypeId> {
        let base = *self.base_types(self.class_sym(file, class)).first()?;
        self.type_of_property_of_type(base, name)
    }

    /// `getTypeOfPropertyOfType`: unlike in a property access, no index signature substitutes for a
    /// missing property, and `any` has no properties.
    pub(super) fn type_of_property_of_type(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        match self.type_of_property_or_index_signature(ty, name)? {
            (_, Found::ByIndex) => None,
            (found, _) => Some(found),
        }
    }

    /// `getTypeOfPropertyOrIndexSignatureOfType`, plus which of the two it found. A property that
    /// only an index signature provides may be missing.
    fn type_of_property_or_index_signature(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<(TypeId, Found)> {
        if self.has_any_flag(ty) {
            return None;
        }
        Some(match self.find_property(ty, ty, name, Access::Read)? {
            (value, Found::ByIndex) => (self.optional_property(value), Found::ByIndex),
            found => found,
        })
    }

    pub(super) fn type_of_property_or_index_signature_of_type(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<TypeId> {
        Some(self.type_of_property_or_index_signature(ty, name)?.0)
    }

    /// `containsSameNamedThisProperty`: true if `value`, the right side of `target = value`, mentions `target` outside
    /// of nested function-like nodes.
    fn contains_same_named_this_property(
        &mut self,
        file: FileId,
        target: ExprId,
        value: ExprId,
    ) -> bool {
        let hir = self.hir(file);
        let within = hir.node(value);
        if value.is_none() || hir.kind(within).is_function_like() {
            return false;
        }
        let reference = self.reference_of(file, target);
        // Lowering numbers expressions in post-order and lowers `target` before `value`, so this range is the subtree of `value`.
        (target.0 + 1..=value.0).map(ExprId).any(|e| {
            self.matches(&reference, e)
                && within
                    == hir.find_ancestor(hir.node(e), |n| {
                        n == within || hir.kind(n).is_function_like()
                    })
        })
    }

    /// `getTypeFromPropertyDescriptor`
    fn type_from_property_descriptor(&mut self, file: FileId, descriptor: ExprId) -> TypeId {
        let ty = self.type_of_expr(file, descriptor);
        if let Some(value) = self.type_of_property_of_type(ty, known::value) {
            return value;
        }
        if let Some(getter) = self.type_of_property_of_type(ty, known::get)
            && let Some(sig) = self.single_call_signature(getter)
        {
            return self.sig_return(sig);
        }
        if let Some(setter) = self.type_of_property_of_type(ty, known::set)
            && let Some(sig) = self.single_call_signature(setter)
        {
            return self.type_of_first_parameter(sig);
        }
        TypeId::ANY
    }

    /// `isReadonlyAssignmentDeclaration`: true if `e` is `Object.defineProperty(f, "name", descriptor)` with a
    /// descriptor that has a `value` and isn't `writable`, or has neither a `value` nor a `set`.
    pub(super) fn is_readonly_assignment_declaration(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let Some(descriptor) = hir.ids(hir[call].args).nth(2) else {
            return false;
        };
        let ty = self.type_of_expr(file, descriptor);
        if self.type_of_property_of_type(ty, known::value).is_none() {
            return self.type_of_property_of_type(ty, known::set).is_none();
        }
        let apparent = self.reduced_apparent_type(ty);
        let Some((writable, mapper)) = self.prop_ref(apparent, known::writable) else {
            return true;
        };
        // The type of the property is `boolean`. Its initializer distinguishes `false` from `true`.
        let writable = match writable.source {
            PropSource::Literal(of, p) if self.hir(of)[p].kind == PropKind::Init => {
                self.type_of_expr(of, self.hir(of)[p].value)
            }
            _ => self.type_of_prop(writable, mapper),
        };
        matches!(writable, TypeId::FALSE | TypeId::FRESH_FALSE)
    }

    /// `isReadonlySymbol`. `PropFlags::READONLY` covers everything but its last line.
    pub(super) fn is_readonly_symbol(&mut self, prop: &Prop) -> bool {
        prop.flags.contains(PropFlags::READONLY) || self.has_readonly_assignment_declaration(prop)
    }

    /// `isReadonlySymbol`: `core.Some(symbol.Declarations, c.isReadonlyAssignmentDeclaration)`. A
    /// symbol derived from others has their declarations, as in `declared_properties`.
    pub(super) fn has_readonly_assignment_declaration(&mut self, prop: &Prop) -> bool {
        let declared = match &prop.source {
            &PropSource::Symbol(sym) => {
                let flags = self.files().flags(sym);
                if flags.contains(SymFlags::ASSIGNMENT) {
                    return (self.assignments_of_symbol(sym).iter())
                        .any(|&(file, e)| self.is_readonly_assignment_declaration(file, e));
                }
                // `Object.defineProperty(exports, "name", descriptor)`
                return flags.contains(SymFlags::FUNCTION_SCOPED_VARIABLE)
                    && (self.files().decls_of(sym).iter()).any(|&(file, decl)| {
                        matches!(decl, Decl::ExportsProperty(e) if self.is_readonly_assignment_declaration(file, e))
                    });
            }
            PropSource::Type(_) | PropSource::Literal(..) => return false,
            PropSource::Copy(_, declared, _)
            | PropSource::Intersected(_, declared)
            | PropSource::ReverseMapped(_, declared) => &declared[..],
            PropSource::Mapped(..) => prop.declared_by_modifiers_property(),
        };
        (declared.iter()).any(|declared| self.has_readonly_assignment_declaration(declared))
    }

    /// `getAssignmentDeclarationInitializerType` for `declaration`, an assignment of `value` that declares a property.
    fn type_of_assignment_declaration(
        &mut self,
        file: FileId,
        declaration: ExprId,
        value: ExprId,
    ) -> TypeId {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let hir = self.hir(file);
        let is_export = matches!(
            assignment_declaration_kind(hir, declaration),
            JsDeclarationKind::ModuleExports | JsDeclarationKind::ExportsProperty(_)
        );
        // `GetRightMostAssignedExpression`, which steps through compound assignments too.
        let mut rightmost = value;
        while let (true, ExprKind::Assign { value: next, .. }) = (is_export, hir[rightmost].kind) {
            rightmost = next;
        }
        // `checkExpressionCached` for an export. For any other kind `checkExpressionForMutableLocation`,
        // which leaves `flowLoopStack` as it is.
        let ty = if is_export {
            self.type_of_expr(file, rightmost)
        } else {
            self.with_flow_loops_visible(|c| c.type_of_expr(file, rightmost))
        };
        let ty = match *self.data(ty) {
            _ if is_export => self.regular(ty),
            // `checkExpressionForMutableLocation` doesn't go through `checkExpressionCached`, so an
            // object literal gets a separate type.
            TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(
                        of,
                        literal,
                        is_js_literal,
                        in_const_context,
                        ObjectLiteralCheck::ForParent,
                        object_flags,
                        is_fresh,
                    ),
                mapper,
            } if (of, literal) == (file, value) => self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(
                    of,
                    literal,
                    is_js_literal,
                    in_const_context,
                    ObjectLiteralCheck::ForAssignmentDeclaration,
                    object_flags,
                    is_fresh,
                ),
                mapper,
            }),
            _ => ty,
        };
        if self.is_empty_array_literal_type(ty)
            && !self.has_parent_with_type_annotation(file, declaration)
        {
            let any_array = self.array_of(TypeId::ANY);
            self.report_implicit_any(file, UntypedProperty::Assignment(declaration), any_array);
            return any_array;
        }
        // `checkExpressionForMutableLocation`: an asserted expression has the asserted type, and a
        // literal type is preserved where a literal type is expected.
        if is_export || matches!(hir[value].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
            return ty;
        }
        let expected = self.contextual_type(file, value, ContextFlags::empty());
        self.widen_literal_for_context(ty, expected)
    }

    /// `hasParentWithTypeAnnotation(node.Symbol())` for the assignment `node`.
    fn has_parent_with_type_annotation(&mut self, file: FileId, node: ExprId) -> bool {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        // The parent of an export is the file.
        let Some(symbol) = bound.symbols.get(bound.symbol_of_expr(node).idx()) else {
            return false;
        };
        // `symbol.Parent.ValueDeclaration`
        let function = if symbol.name == known::computed && bound.is_expando_declaration(node) {
            // `bindAnonymousDeclaration`: `symbol.Parent = b.container.Symbol()`. `Symbol::parent`
            // is that of the late-bound symbol.
            hir.find_ancestor(hir.parent(hir.node(node)), |it| is_container(hir.kind(it)))
        } else {
            let parent = bound.symbols.get(symbol.parent.idx());
            parent
                .and_then(|parent| parent.decls.get(parent.value_declaration as usize))
                .map_or(Node::NONE, |&declaration| hir.node(declaration))
        };
        if function.is_none()
            || !matches!(
                hir.kind(function),
                Kind::FunctionExpression | Kind::ArrowFunction
            )
        {
            return false;
        }
        // `getSymbolOfNode(function.Parent)`
        let declaration = match hir.data(hir.parent(function)) {
            NodeData::VarDecl(d) => Decl::Var(hir[d].pat),
            NodeData::Param(p) => Decl::Param(hir[p].pat),
            NodeData::Member(m) => Decl::Member(m),
            NodeData::Prop(p) => Decl::Property(p),
            NodeData::Stmt(s) => Decl::ExportExpr(s),
            NodeData::Expr(e) => match (hir[e].kind, assignment_declaration_kind(hir, e)) {
                (ExprKind::Fn(outer), _) => Decl::Fn(outer),
                (_, JsDeclarationKind::ModuleExports) => Decl::ModuleExports(e),
                (_, JsDeclarationKind::ExportsProperty(_)) => Decl::ExportsProperty(e),
                _ => Decl::Expando(e),
            },
            _ => return false,
        };
        let possibly_annotated = bound.symbol_of_declaration(declaration);
        let value_declaration = match bound.symbols.get(possibly_annotated.idx()) {
            // `getLateBoundSymbol`
            Some(symbol) if symbol.name == known::computed => {
                self.value_declaration_of_property(files.sym(file, possibly_annotated))
            }
            Some(_) => files.value_declaration(files.sym(file, possibly_annotated)),
            // `Bound` doesn't have an export's symbol, or the symbol of an object literal member
            // that's its only declaration.
            None => match declaration {
                Decl::Property(_) => Some((file, declaration)),
                Decl::ModuleExports(_) | Decl::ExportsProperty(_) => {
                    (bound.commonjs_indicator.is_some()).then_some((file, declaration))
                }
                Decl::ExportExpr(s) => matches!(
                    hir[s].kind,
                    StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                )
                .then_some((file, declaration)),
                _ => None,
            },
        };
        value_declaration.is_some_and(|(of, it)| self.type_node_of_declaration(of, it).is_some())
    }

    /// `getTypeOfSymbol(prop)`, then `getWriteTypeOfSymbol(prop)`.
    /// `createUnionOrIntersectionProperty` requests both, in that order, for every symbol it
    /// combines.
    pub(super) fn type_and_write_type_of_prop(&mut self, prop: &Prop) -> (TypeId, TypeId) {
        let before = self.non_cacheable_mark();
        let ty = self.type_of_prop(prop, MapperId::IDENTITY);
        // FOR SPEED: for these, `write_type_of_prop` would request the type once more, where tsgo reads
        // `links.resolvedType`. That request recomputes a type that isn't final, so in that case `write_type_of_prop`
        // is still called.
        let write_type_follows_from_type = !prop.flags.contains(PropFlags::ACCESSOR)
            && !matches!(prop.source, PropSource::Intersected(..));
        if write_type_follows_from_type && self.non_cacheable_mark() == before {
            let is_optional = prop.flags.contains(PropFlags::OPTIONAL);
            return (ty, self.remove_missing_type(ty, is_optional));
        }
        (ty, self.write_type_of_prop(prop, MapperId::IDENTITY))
    }

    /// `type_and_write_type_of_prop` for `prop` with `instantiation` applied, or for `prop` unchanged if it's `None`.
    ///
    /// FOR SPEED, the copy that's queried omits the symbols the property takes its declarations from. A property of
    /// `Omit<React.HTMLAttributes<T>, K>` has one, in its own list. Only `write_type_of_prop` reads them, and only for
    /// an accessor.
    fn types_of_instantiated_prop(
        &mut self,
        prop: &Prop,
        instantiation: Option<PropInstantiation>,
    ) -> (TypeId, TypeId) {
        let Some(instantiation) = instantiation else {
            return self.type_and_write_type_of_prop(prop);
        };
        let can_drop_parts = !prop.flags.contains(PropFlags::ACCESSOR);
        let source = match prop.source {
            PropSource::Mapped(of, strips, Some(_)) if can_drop_parts => {
                PropSource::Mapped(of, strips, None)
            }
            PropSource::Copy(ty, _, has_value_declaration) if can_drop_parts => {
                PropSource::Copy(ty, ArenaBox::empty(), has_value_declaration)
            }
            PropSource::ReverseMapped(of, _) if can_drop_parts => {
                PropSource::ReverseMapped(of, ArenaBox::empty())
            }
            ref source => source.clone_in(self.arena),
        };
        let mut copy = Prop {
            name: prop.name,
            flags: prop.flags,
            source,
            mapper: prop.mapper,
            name_type: prop.name_type,
        };
        instantiation.apply_to(&mut copy);
        self.type_and_write_type_of_prop(&copy)
    }

    /// Adds the positions of `member`'s properties whose name one of `others` also has. For each pair of members, the
    /// names of the one with fewer properties are looked up in the other.
    fn add_positions_of_shared_names(
        member: Members<'p>,
        others: &[Members<'p>],
        positions: &mut PositionSet,
    ) {
        let props = &member.shape().props;
        for other in others {
            let other_props = &other.shape().props;
            if other_props.len() < props.len() {
                for prop in other_props {
                    if let Some(position) = member.resolved.position(prop.name) {
                        positions.insert(position);
                    }
                }
            } else {
                for (position, prop) in props.iter().enumerate() {
                    if other.resolved.prop(prop.name).is_some() {
                        positions.insert(position);
                    }
                }
            }
        }
    }

    /// `getWriteTypeOfSymbol`: the type that may be assigned to `prop`, which was found in a type
    /// whose mapper is `outer`.
    pub fn write_type_of_prop(&mut self, prop: &Prop, outer: MapperId) -> TypeId {
        // `links.writeType`, falling back to `links.resolvedType`.
        // `createUnionOrIntersectionProperty` has `writeTypes` as soon as one constituent's write
        // type differs from its type.
        if let PropSource::Intersected(whole, parts) = &prop.source {
            let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
            let mut has_write_types = false;
            // `writeTypes` has no `indexTypes`.
            for part in parts
                .iter()
                .filter(|part| !part.flags.contains(PropFlags::WRITE_PARTIAL))
            {
                let (ty, write_type) = self.type_and_write_type_of_prop(part);
                has_write_types |= write_type != ty;
                types.push(write_type);
            }
            if !has_write_types {
                return self.type_of_prop(prop, outer);
            }
            let all = if self.is_union(*whole) {
                self.union(&types)
            } else {
                self.intersection(&types)
            };
            let mapper = self.compose(prop.mapper, outer);
            return self.instantiate(all, mapper);
        }
        // The symbol itself, if `getSpreadSymbol` returned it unchanged.
        let source = match &prop.source {
            PropSource::Copy(_, declared, true) => match &declared[..] {
                [only] => &only.source,
                _ => &prop.source,
            },
            source => source,
        };
        // `SymbolFlagsProperty` is tested before `SymbolFlagsAccessor`, and a property shares one
        // symbol with the accessors of its name.
        let is_property = !prop.flags.contains(PropFlags::ACCESSOR)
            || match *source {
                PropSource::Symbol(sym) => self.flags_of_property(sym),
                PropSource::Literal(file, p) => self.flags_of_literal_member(file, p),
                _ => SymFlags::empty(),
            }
            .contains(SymFlags::PROPERTY);
        if is_property {
            // `removeMissingType`: the missing type of an optional property can't be assigned to
            // it.
            let ty = self.type_of_prop(prop, outer);
            return self.remove_missing_type(ty, prop.flags.contains(PropFlags::OPTIONAL));
        }
        // `getAnnotatedAccessorTypeNode(setter)` of `getWriteTypeOfAccessors`, and the start of the
        // name of `setter`.
        let annotation: Option<(FileId, TypeNodeId, u32)> = match source {
            PropSource::Symbol(sym) => {
                let members = self.members_of_symbol(*sym);
                let first_of = |kind: MemberKind| {
                    let mut declarations = members.iter().map(|&(f, m)| (f, &self.hir(f)[m]));
                    declarations.find(|(_, member)| member.kind == kind)
                };
                match first_of(MemberKind::Setter) {
                    Some((f, setter)) => {
                        let hir = self.hir(f);
                        let func = &hir[setter.func];
                        let node = func.effective_set_accessor_type_annotation_node(hir);
                        Some((f, node, setter.name_pos))
                    }
                    // `IsAutoAccessorPropertyDeclaration`
                    None => first_of(MemberKind::Property)
                        .filter(|(_, property)| property.flags.contains(Flags::ACCESSOR))
                        .map(|(f, property)| (f, property.ty, property.name_pos)),
                }
            }
            // The shape stores the getter.
            PropSource::Literal(file, p) => {
                let (file, hir) = (*file, self.hir(*file));
                let setter = self.accessor_of_literal(file, *p, PropKind::Setter);
                setter.and_then(|setter| match hir[hir[setter].value].kind {
                    ExprKind::Fn(func) => {
                        let node = hir[func].effective_set_accessor_type_annotation_node(hir);
                        Some((file, node, hir[setter].pos))
                    }
                    _ => None,
                })
            }
            _ => None,
        };
        // "Absent an explicit setter type annotation we use the read type of the accessor."
        let Some((file, node, name_pos)) = annotation.filter(|it| it.1.is_some()) else {
            return self.type_of_prop(prop, outer);
        };
        let ty = self.write_type_of_accessors(prop, (file, node), name_pos);
        let mapper = self.compose(prop.mapper, outer);
        self.instantiate(ty, mapper)
    }

    /// `getWriteTypeOfAccessors` for the accessors `prop`, whose setter has the annotation
    /// `annotation` and its name at `name_pos`.
    fn write_type_of_accessors(
        &mut self,
        prop: &Prop,
        annotation: (FileId, TypeNodeId),
        name_pos: u32,
    ) -> TypeId {
        // `links.writeType` is either the annotation's type, which is cached with its node, or
        // `any` for an entry here.
        let circular = &self.p.circular_write_types;
        if circular.get(&self.task, &annotation).is_some() {
            return TypeId::ANY;
        }
        let (file, node) = annotation;
        let q = Query::WriteType(file, node);
        if !self.enter(q) {
            return match self.found_cycle {
                true => TypeId::ERROR,
                false => TypeId::UNRESOLVED,
            };
        }
        let write_type = self.type_from_node(file, node);
        let _ = self.leave(q);
        if !self.left_a_cycle {
            return write_type;
        }
        let stored = self.cycle_result();
        (self.p.circular_write_types).insert(&self.task, annotation, (), stored);
        let name = self.prop_to_string(prop);
        let at = (file, name_pos, self.end_of_name_at(file, name_pos));
        let diagnostic = self.new_diagnostic(at, 2502, &[Arg::Bytes(&name)]);
        self.add_diagnostic_of(Some(q), diagnostic);
        TypeId::ANY
    }

    /// `getTypeOfSymbol(member.Symbol)`, if `member` is `symbol.ValueDeclaration`. For a later
    /// declaration, the type of just that declaration (`getWidenedTypeForVariableLikeDeclaration`),
    /// which isn't cached.
    pub(super) fn type_of_member_declaration(&mut self, file: FileId, member: MemberId) -> TypeId {
        if self.bound(file).member_symbol[member.idx()].is_some() {
            let sym = self.symbol_of_member(file, member);
            if self.value_declaration_of_property(sym) == Some((file, Decl::Member(member))) {
                return self.type_of_symbol(sym);
            }
        }
        self.type_of_members_uncached(&[(file, member)])
    }

    /// `symbol.Flags&(SymbolFlagsGetAccessor|SymbolFlagsSetAccessor) != 0`
    fn has_get_or_set_accessor(&self, members: &[(FileId, MemberId)]) -> bool {
        members
            .iter()
            .any(|&(f, m)| matches!(self.hir(f)[m].kind, MemberKind::Getter | MemberKind::Setter))
    }

    pub(super) fn type_of_members_uncached(&mut self, members: &[(FileId, MemberId)]) -> TypeId {
        let (file, first) = members[0];
        let hir = self.hir(file);
        let member = &hir[first];
        match member.kind {
            // `getTypeOfSymbol` checks for an accessor first, and `PropertyExcludes` lets a
            // property share one symbol with the accessors of its name.
            MemberKind::Property if !self.has_get_or_set_accessor(members) => {
                // `reportErrors`: set when the caller is `getTypeOfSymbol`. For just a later
                // declaration, the call is `getWidenedTypeForVariableLikeDeclaration(node, false)`.
                let value_declaration = (file, Decl::Member(first));
                let symbol = self.bound(file).symbol_of_declaration(value_declaration.1);
                let reports_errors = members.len() > 1
                    || (self.files())
                        .value_declaration(self.files().sym(file, symbol))
                        .is_none_or(|it| it == value_declaration);
                let value_declaration = UntypedProperty::Member(first);
                // `getTypeOfAccessors`:
                // `core.Find(symbol.Declarations, ast.IsAutoAccessorPropertyDeclaration)`
                // determines the type.
                let (file, first) = members
                    .iter()
                    .copied()
                    .find(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ACCESSOR))
                    .unwrap_or((file, first));
                let hir = self.hir(file);
                let member = &hir[first];
                let owner = self.bound(file).member_owner[first.idx()];
                // For any other property a `unique symbol` is a `symbol`.
                let unique_symbol_name = self
                    .is_valid_es_symbol_declaration(file, first)
                    .then(|| Self::name_of_unique_symbol(member));
                if member.ty.is_some() {
                    let has_unique_keyword =
                        matches!(hir[member.ty].kind, TypeNodeKind::UniqueSymbol);
                    if let Some(name) = unique_symbol_name {
                        // `isGlobalSymbolConstructor`: compared by symbol, so
                        // `declare global { interface SymbolConstructor }` counts and an interface of that name in a
                        // module or namespace doesn't.
                        let in_symbol_constructor = match owner {
                            MemberOwner::Interface(i)
                                if self.atoms().bytes(hir[i].name) == b"SymbolConstructor" =>
                            {
                                let own = self.bound(file).interface_symbol[i.idx()];
                                own.is_some()
                                    && self.global_type_symbol(hir[i].name)
                                        == Some(self.files().sym(file, own))
                            }
                            _ => false,
                        };
                        if in_symbol_constructor {
                            // `widenTypeForVariableLikeDeclaration`: there `symbol` is equivalent
                            // to `unique symbol`, unless the property may be undefined as well.
                            let may_be_undefined = member.flags.contains(Flags::OPTIONAL)
                                && self.p.files.options.strict_null_checks;
                            if has_unique_keyword
                                || !may_be_undefined
                                    && self.type_from_node(file, member.ty) == TypeId::SYMBOL
                            {
                                // `Symbol.iterator` and the like are keyed only by their name, so
                                // that they map to `known::sym_iterator`.
                                return self.intern(TypeData::UniqueSymbol {
                                    symbol: UniqueSymbolDeclaration::SymbolConstructor,
                                    name,
                                });
                            }
                        } else if has_unique_keyword {
                            let symbol = self.unique_symbol_declaration(file, first, name);
                            return self.intern(TypeData::UniqueSymbol { symbol, name });
                        }
                    }
                    return self.type_from_node(file, member.ty);
                }
                if member.init.is_some() {
                    // `checkCallExpression`: `Symbol()` creates a unique symbol for the declaration
                    // it initializes.
                    if let Some(name) = unique_symbol_name
                        && self.is_symbol_or_symbol_for_call(file, member.init)
                    {
                        let symbol = UniqueSymbolDeclaration::Member(file, first);
                        return self.intern(TypeData::UniqueSymbol { symbol, name });
                    }
                    let ty = self.type_of_declaration_initializer(file, member.init);
                    // `widenTypeForVariableLikeDeclaration`: a `unique symbol` belongs to the
                    // declaration it was created for. For any other it is a `symbol`.
                    let ty = if matches!(self.data(ty), TypeData::UniqueSymbol { .. }) {
                        TypeId::SYMBOL
                    } else {
                        ty
                    };
                    let ty = if member.flags.contains(Flags::READONLY) {
                        ty
                    } else {
                        self.widen_literal(ty)
                    };
                    // `widenTypeInferredFromInitializer`
                    if let Some(any) = self.implicit_any_of_empty_literal(file, ty) {
                        if !matches!(owner, MemberOwner::None) {
                            self.report_implicit_any(file, UntypedProperty::Member(first), any);
                        }
                        return any;
                    }
                    let widened = self.get_widened_type(ty);
                    // `widenTypeForVariableLikeDeclaration`
                    if reports_errors && self.report_errors_from_widening(ty) {
                        self.report_implicit_any(file, UntypedProperty::Member(first), widened);
                    }
                    return widened;
                }
                // `getTypeForVariableLikeDeclaration`: when an implicit `any` is an error, the
                // assignments to it are inspected first.
                if self.p.files.options.no_implicit_any
                    && let MemberOwner::Class(c) = owner
                    // `declaration.Symbol()` is the binder's symbol, and no reference and no
                    // property of a base class is named `InternalSymbolNameComputed`.
                    && !matches!(member.key, PropKey::Computed(e) if is_dynamic_name(hir, e))
                    && let Some(name) = self.declared_member_name(file, member.key)
                {
                    // `getTypeOfPropertyInBaseClass`, for a property with its own `declare` modifier.
                    let inherited = if hir
                        .find_modifier(member.modifiers, Flags::AMBIENT)
                        .is_some()
                    {
                        self.type_of_property_in_base_class(file, c, name)
                    } else {
                        None
                    };
                    // `getFlowTypeOfProperty`: the walk starts from the inherited type, or from `undefinedType`.
                    let initial = inherited.unwrap_or(TypeId::UNDEFINED);
                    let mut has_flow_container = false;
                    if !member.flags.contains(Flags::STATIC) {
                        if let Some(constructor) = hir[c].members.iter().find(|&m| {
                            hir[m].kind == MemberKind::Constructor
                                && !matches!(hir[hir[m].func].body, FnBody::None)
                        }) {
                            has_flow_container = true;
                            if let Some(ty) = self.flow_type_in_constructor_from(
                                file,
                                hir[constructor].func,
                                name,
                                initial,
                                value_declaration,
                            ) {
                                return ty;
                            }
                        }
                    } else {
                        // `getFlowTypeInStaticBlocks`: the first static block whose flow type is
                        // more than null or undefined.
                        for block in hir[c].members.iter().filter(|&m| {
                            hir[m].kind == MemberKind::StaticBlock && hir[m].func.is_some()
                        }) {
                            has_flow_container = true;
                            if let Some(ty) = self.flow_type_in_constructor_from(
                                file,
                                hir[block].func,
                                name,
                                initial,
                                value_declaration,
                            ) {
                                return ty;
                            }
                        }
                    }
                    // The inherited type is the type of the property only in a class without a constructor or static blocks.
                    if !has_flow_container && let Some(inherited) = inherited {
                        return inherited;
                    }
                }
                // `widenTypeForVariableLikeDeclaration`,
                // `declarationBelongsToPrivateAmbientMember`. A property with a `declare` modifier
                // is ambient by itself. `bindClassLikeDeclaration`: a static `prototype` shares one
                // symbol with the `prototype` of the class, whose type is
                // `getTypeOfPrototypeProperty`.
                let is_exempt = match owner {
                    MemberOwner::Class(c) => {
                        let is_ambient = hir[c].flags.contains(Flags::AMBIENT)
                            || member.flags.contains(Flags::AMBIENT)
                            || hir.kind == FileKind::Declaration;
                        is_ambient
                            && (member.flags.contains(Flags::PRIVATE)
                                || matches!(member.key, PropKey::Private(_)))
                            || member.flags.contains(Flags::STATIC)
                                && member.key == PropKey::Name(known::prototype)
                    }
                    MemberOwner::None => true,
                    _ => false,
                };
                if reports_errors && !is_exempt {
                    self.report_implicit_any(file, UntypedProperty::Member(first), TypeId::ANY);
                }
                TypeId::ANY
            }
            MemberKind::Method => {
                let members: Vec<(FileId, MemberId)> = members
                    .iter()
                    .copied()
                    .filter(|&(f, m)| self.hir(f)[m].kind == MemberKind::Method)
                    .collect();
                let decls = members
                    .iter()
                    .enumerate()
                    .filter(|&(i, &(f, m))| {
                        !(i > 0
                            && members[i - 1].0 == f
                            && self.is_implementation_after(f, members[i - 1].1, m))
                    })
                    .map(|(_, &(f, m))| (f, self.hir(f)[m].func));
                let decls: SmallVec<[(FileId, FnId); 4]> = decls.collect();
                let scope = self.bound(file).fns[member.func.idx()].scope;
                let parent = self.bound(file).scopes[scope.idx()].parent;
                // `getObjectTypeInstantiation` calls `isTypeParameterPossiblyReferenced` on every
                // declaration of the symbol, the implementation of overloads included.
                let declarations: Vec<(FileId, FnId)> = members
                    .iter()
                    .map(|&(f, m)| (f, self.hir(f)[m].func))
                    .collect();
                let mapper = self.identity_mapper_for_fns(file, parent, &declarations);
                self.intern_key(TypeKey::Fns {
                    decls: &decls,
                    mapper,
                })
            }
            MemberKind::Property | MemberKind::Getter | MemberKind::Setter => {
                let getter = members
                    .iter()
                    .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Getter)
                    .map(|&(f, getter)| (f, self.hir(f)[getter].func));
                // `getTypeOfAccessors`: an annotation is resolved from its type node, without
                // resolving the function.
                if let Some((f, func)) = getter
                    && self.hir(f)[func].ret.is_some()
                {
                    return self.type_from_node(f, self.hir(f)[func].ret);
                }
                // A getter without an annotation next to a setter with one has the setter's type.
                if let Some(&(f, setter)) = members
                    .iter()
                    .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Setter)
                {
                    let hir = self.hir(f);
                    let node =
                        hir[hir[setter].func].effective_set_accessor_type_annotation_node(hir);
                    if node.is_some() {
                        return self.type_from_node(f, node);
                    }
                }
                match getter {
                    // `getTypeOfAccessors` calls `getReturnTypeFromBody` directly. The return type of the getter's
                    // signature is a separate resolution (`getReturnTypeOfSignature`), so a cycle through the property
                    // doesn't mark it.
                    Some((f, func)) => self.return_type_of_fn_uncached(f, func, CheckMode::empty()),
                    // The initializer of a setter's parameter doesn't determine the property's type.
                    None => TypeId::ANY,
                }
            }
            _ => TypeId::UNRESOLVED,
        }
    }

    /// `isValidESSymbolDeclaration` for the member `m`: a property that is `readonly` in an
    /// interface or a type literal, `static readonly` in a class, regardless of its name.
    pub(super) fn is_valid_es_symbol_declaration(&self, file: FileId, m: MemberId) -> bool {
        let member = &self.hir(file)[m];
        member.kind == MemberKind::Property
            && member.flags.contains(Flags::READONLY)
            && (member.flags.contains(Flags::STATIC)
                || !matches!(
                    self.bound(file).member_owner[m.idx()],
                    MemberOwner::Class(_)
                ))
    }

    /// The `name` of the `TypeData::UniqueSymbol` that `member` declares. `property_name_of_type`
    /// builds a property name from it that `key_type_of_name` parses, so it must not contain `@`.
    pub(super) fn name_of_unique_symbol(member: &Member) -> Atom {
        member.key.name().unwrap_or(known::computed)
    }

    /// `getESSymbolLikeTypeForNode` caches one `unique symbol` per symbol: among the declarations
    /// of the property `name` in the class or interface that contains the member `m`, the first one
    /// annotated `unique symbol` represents all.
    pub(super) fn unique_symbol_declaration(
        &self,
        file: FileId,
        m: MemberId,
        name: Atom,
    ) -> UniqueSymbolDeclaration {
        let member = &self.hir(file)[m];
        let own = UniqueSymbolDeclaration::Member(file, m);
        let Some(symbol) = self.symbol_of_member_owner(file, m) else {
            return own;
        };
        for (f, decl) in self.files().decls_of(symbol) {
            let hir = self.hir(f);
            let Some(members) = decl.members_of_class_or_interface(hir) else {
                continue;
            };
            let first = members.iter().find(|&other| {
                let other = &hir[other];
                other.kind == MemberKind::Property
                    && other.key.name() == Some(name)
                    && other.flags.contains(Flags::STATIC) == member.flags.contains(Flags::STATIC)
                    && other.ty.is_some()
                    && matches!(hir[other.ty].kind, TypeNodeKind::UniqueSymbol)
            });
            if let Some(first) = first {
                return UniqueSymbolDeclaration::Member(f, first);
            }
        }
        own
    }

    /// `links.uniqueESSymbolType` of the `const` named `name` that `pat` declares.
    pub(super) fn unique_symbol_of_variable(
        &mut self,
        file: FileId,
        pat: PatId,
        name: Atom,
    ) -> TypeId {
        let variable = self
            .files()
            .sym(file, self.bound(file).pat_symbol[pat.idx()]);
        let symbol = UniqueSymbolDeclaration::Variable(variable);
        self.intern(TypeData::UniqueSymbol { symbol, name })
    }

    /// `getESSymbolLikeTypeForNode` of the declaration `call` initializes: its unique symbol if `isValidESSymbolDeclaration`,
    /// otherwise `symbol`.
    pub(super) fn get_es_symbol_like_type_for_node(
        &mut self,
        file: FileId,
        call: ExprId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.parent_of_expr(call) {
            Parent::VarInit(d) => {
                let decl = &hir[d];
                let stmt = bound.var_stmt[d.idx()];
                let PatKind::Ident(name) = hir[decl.pat].kind else {
                    return TypeId::SYMBOL;
                };
                if decl.kind != VarKind::Const
                    || stmt.is_none()
                    || !matches!(hir[stmt].kind, StmtKind::Var(_))
                    || matches!(bound.parent_of_stmt(stmt), Parent::Stmt(parent) if parent.is_some() && matches!(hir[parent].kind, StmtKind::For { init, .. } if init == stmt))
                {
                    return TypeId::SYMBOL;
                }
                self.unique_symbol_of_variable(file, decl.pat, name)
            }
            Parent::MemberInit(m) if hir[m].init == call => {
                let member = &hir[m];
                if !self.is_valid_es_symbol_declaration(file, m) {
                    return TypeId::SYMBOL;
                }
                let name = Self::name_of_unique_symbol(member);
                let symbol = if member.ty.is_some()
                    && matches!(hir[member.ty].kind, TypeNodeKind::UniqueSymbol)
                {
                    self.unique_symbol_declaration(file, m, name)
                } else {
                    UniqueSymbolDeclaration::Member(file, m)
                };
                self.intern(TypeData::UniqueSymbol { symbol, name })
            }
            _ => TypeId::SYMBOL,
        }
    }

    /// `isSymbolOrSymbolForCall`: `Symbol()` or `Symbol.for()`, resolved to the global value of
    /// that name.
    pub(super) fn is_symbol_or_symbol_for_call(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        // A parenthesized expression is neither a property access nor an identifier.
        let left = hir[call].callee;
        let left = match hir[left].kind {
            ExprKind::Dot { obj, name, .. }
                if !is_parenthesized(hir, left) && self.atoms().bytes(name) == b"for" =>
            {
                obj
            }
            _ => left,
        };
        !is_parenthesized(hir, left)
            && matches!(hir[left].kind, ExprKind::Ident(known::Symbol))
            && (self.files().global(known::Symbol, SymFlags::VALUE)).is_some_and(|global| {
                self.resolve_identifier(file, left, known::Symbol, true) == Ok(Some(global))
            })
    }

    /// The apparent type of `ty` for a property access: the wrapper of a primitive, the constraint
    /// of a type parameter.
    #[inline]
    pub fn apparent_type(&mut self, ty: TypeId) -> TypeId {
        if self.is_plain_object_type(ty) || self.is_union(ty) && !self.is_boolean(ty) {
            ty
        } else {
            self.apparent_type_of_other(ty)
        }
    }

    /// `ObjectFlags::HAS_ONLY_OWN_APPARENT_TYPES`
    #[inline]
    pub(super) fn has_only_own_apparent_types(&self, ty: TypeId) -> bool {
        let flags = self.types().object_flags(ty);
        flags.contains(ObjectFlags::HAS_ONLY_OWN_APPARENT_TYPES)
    }

    /// `apparent_type` for a type whose apparent type may differ from it.
    fn apparent_type_of_other(&mut self, ty: TypeId) -> TypeId {
        // An unconstrained type parameter has the base constraint `unknown`. The original type is passed as the `this`
        // argument (`getTypeWithThisArgument`, `getApparentTypeOfIntersectionType`), so in inherited members `this` is
        // `ty` itself.
        let original_type = ty;
        let ty = if self.is_deferred(ty) {
            let constraint = self.base_constraint(ty);
            self.type_with_this_argument(constraint, original_type)
        } else {
            ty
        };
        let wrapper = match self.data(ty) {
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => return self.apparent_type_of_mapped(ty),
            // FOR SPEED, an intersection of types that are their own apparent types is left
            // unchanged: `getTypeWithThisArgument` gives them the `this` argument and nothing else,
            // and `build_intersection_shape` passes that.
            TypeData::Intersection(members) => {
                if self.has_only_own_apparent_types(ty) {
                    return ty;
                }
                let apparent = self.apparent_type_of_intersection_type(ty, original_type);
                // References that could have become one type and haven't are left unchanged too.
                let is_unchanged = self.is_intersection(apparent)
                    && self.types().can_become_one_reference(members);
                return if is_unchanged { ty } else { apparent };
            }
            TypeData::Intrinsic(Intrinsic::String)
            | TypeData::StringLit { .. }
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
            | TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => known::String,
            TypeData::Intrinsic(Intrinsic::Number)
            | TypeData::NumberLit { .. }
            | TypeData::EnumLit {
                value: EnumValue::Number(_),
                ..
            }
            | TypeData::Enum { .. } => known::Number,
            TypeData::BoolLit { .. } => known::Boolean,
            TypeData::Union(_) if self.is_boolean(ty) => known::Boolean,
            TypeData::Intrinsic(Intrinsic::BigInt) | TypeData::BigIntLit { .. } => known::BigInt,
            TypeData::Intrinsic(Intrinsic::Symbol) | TypeData::UniqueSymbol { .. } => known::Symbol,
            _ if ty == TypeId::OBJECT => return TypeId::EMPTY_OBJECT,
            // `unknown` has no properties, not even those every object has, except without
            // strictNullChecks.
            _ if ty == TypeId::UNKNOWN && !self.p.files.options.strict_null_checks => {
                return TypeId::EMPTY_OBJECT;
            }
            _ => return ty,
        };
        self.plain_global_ref(wrapper)
    }

    /// `resolved_base_constraint`, with `unknown` for a type that has no constraint.
    pub fn base_constraint(&mut self, ty: TypeId) -> TypeId {
        self.resolved_base_constraint(ty).unwrap_or(TypeId::UNKNOWN)
    }

    /// `getResolvedBaseConstraint(ty, nil)`: the widest type `ty` can be, with no type parameter at
    /// the top level. `None` means `noConstraintType` or `circularConstraintType`.
    pub(super) fn resolved_base_constraint(&mut self, ty: TypeId) -> Option<TypeId> {
        // FOR SPEED: most requests are for a type parameter or a `this` type whose constraint is known. This is the
        // path they take through `next_base_constraint`.
        if matches!(
            self.data(ty),
            TypeData::TypeParam(..) | TypeData::ThisParam(_)
        ) && self.unresolved_renamed_params.is_empty()
            && let Some((known, _)) = self.known_constraint(ty)
        {
            return known;
        }
        // A union or intersection has its own `resolvedBaseConstraint`, with or without type variables.
        if !matches!(
            self.data(ty),
            TypeData::Union(_) | TypeData::Intersection(_)
        ) && self.is_own_base_constraint(ty)
        {
            return Some(ty);
        }
        // A call from outside starts a new stack.
        let outer_stack = std::mem::take(&mut self.constraint_stack);
        let result = self.next_base_constraint(ty);
        self.constraint_stack = outer_stack;
        result
    }

    /// FOR SPEED: true if `computeBaseConstraint` returns `ty` unchanged, decided without an entry
    /// in `constraints`. Among types without type variables, it only changes a string mapping type
    /// such as `Uppercase<string>`, which becomes `string`, and therefore anything built from one.
    fn is_own_base_constraint(&self, ty: TypeId) -> bool {
        !self.has_type_variables(ty) && !self.contains_string_mapping(ty)
    }

    /// True if `ty` is a string mapping type, or a template literal type, union or intersection
    /// that contains one.
    fn contains_string_mapping(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::StringMapping { .. } => true,
            TypeData::Template { types, .. } => {
                types.iter().any(|&t| self.contains_string_mapping(t))
            }
            TypeData::Union(types) | TypeData::Intersection(types) => {
                types.iter().any(|&t| self.contains_string_mapping(t))
            }
            _ => false,
        }
    }

    /// `ConstrainedType.resolvedBaseConstraint` of `ty`: the entry in `constraints_of_this_task`, falling back to
    /// `Program::constraints`. Anything computed from the former is also valid only for this task. It comes first so
    /// that the answer doesn't change in the middle of a file when another task publishes its own.
    #[inline(always)]
    pub(super) fn known_constraint(&self, ty: TypeId) -> Option<(Option<TypeId>, bool)> {
        if self.constraints_of_this_task.is_empty() {
            return self.p.constraints.get(&self.task, &ty);
        }
        let Some(&task_local) = self.constraints_of_this_task.get(&ty) else {
            return self.p.constraints.get(&self.task, &ty);
        };
        self.constraint_cuts.set(self.constraint_cuts.get() + 1);
        self.task.hold_back();
        Some(task_local)
    }

    /// Records that `getResolvedBaseConstraint` hit its depth limit and stopped recursing.
    fn cut_constraint_short(&self) {
        self.constraint_cuts.set(self.constraint_cuts.get() + 1);
        self.task.hold_back();
    }

    /// `t.resolvedBaseConstraint = constraint`, without the flag. `cuts` is the value of `constraint_cuts` when the
    /// computation began.
    fn store_constraint(
        &mut self,
        ty: TypeId,
        constraint: Option<TypeId>,
        cuts: u64,
        stored: Stored,
    ) {
        if self.task.commits() && self.constraint_cuts.get() != cuts {
            (self.constraints_of_this_task.entry(ty)).or_insert((constraint, false));
            return;
        }
        // A task that starts from an outer type reaches this one at a greater depth, and may be cut short where this
        // task wasn't.
        (self.p.constraints).insert_for_every_task(&self.task, ty, (constraint, false), stored);
    }

    /// `getNextBaseConstraint`: `resolved_base_constraint` as part of the constraint computation in
    /// progress.
    pub(super) fn next_base_constraint(&mut self, ty: TypeId) -> Option<TypeId> {
        // `computeBaseConstraint` of a type parameter assigns `tp.constraint`.
        if !self.unresolved_renamed_params.is_empty() {
            cold_path();
            self.unresolved_renamed_params.remove(&ty);
        }
        let data = self.data(ty);
        let is_union_or_intersection =
            matches!(data, TypeData::Union(_) | TypeData::Intersection(_));
        if is_union_or_intersection && let Some((known, _)) = self.known_constraint(ty) {
            return known;
        }
        let is_own_base_constraint = self.is_own_base_constraint(ty);
        if is_own_base_constraint
            && !is_union_or_intersection
            && !super::relate::is_object_kind(data)
        {
            return Some(ty);
        }
        // `getBaseConstraintOfType`: the kinds that have one.
        let may_have_constraint = match data {
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::Keyof(_)
            | TypeData::Union(_)
            | TypeData::Intersection(_)
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
            | TypeData::Substitution { .. } => true,
            // `isGenericTupleType`
            TypeData::Tuple { flags, .. } => flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)),
            _ => false,
        };
        if is_own_base_constraint || !may_have_constraint {
            let is_object_type = !may_have_constraint && super::relate::is_object_kind(data);
            let depth = self.constraint_stack.len();
            if is_object_type {
                // `getBaseConstraintOfType` doesn't resolve an object type.
                if depth == 0 {
                    return Some(ty);
                }
                if let Some((known, _)) = self.known_constraint(ty) {
                    return known;
                }
            } else if !is_union_or_intersection {
                return Some(ty);
            }
            // `getResolvedBaseConstraint`: a `StructuredType` is a `ConstrainedType`, so the depth test applies to it,
            // and `resolvedBaseConstraint` caches `noConstraintType` or the type itself from the first visit on.
            let is_cut = depth >= 10
                && (depth >= 50 || self.constraint_stack.contains(&self.recursion_identity(ty)));
            let (held_back, cuts) = (self.task.held_back(), self.constraint_cuts.get());
            let result = if is_cut {
                self.cut_constraint_short();
                None
            } else if is_object_type {
                Some(ty)
            } else {
                let identity = self.recursion_identity(ty);
                self.constraint_stack.push(identity);
                let result = self.compute_base_constraint(ty);
                self.constraint_stack.pop();
                result
            };
            // It's stored no matter what's in progress.
            self.store_constraint(ty, result, cuts, Stored::since(held_back));
            return result;
        }
        if let Some((known, _)) = self.known_constraint(ty) {
            return known;
        }
        if let Some(raw) = self.provisional(Query::Constraint(ty)) {
            return (raw != 0).then(|| TypeId(raw as u32 - 1));
        }
        if !self.enter(Query::Constraint(ty)) {
            // `pushTypeResolution` marks every entry from the start of the cycle to the top of the
            // stack, regardless of the kind of type. Callers call
            // `has_non_circular_base_constraint` while these entries are still on the stack.
            let from = self.resolution_start;
            if let Some(i) = self.stack[from..]
                .iter()
                .rposition(|q| *q == Query::Constraint(ty))
                .map(|i| i + from)
                && !self.eager.iter().any(|&eager| eager > i)
            {
                for j in i..self.stack.len() {
                    if let Query::Constraint(t) = self.stack[j]
                        && !self.constraints_marked_circular.contains(&t)
                    {
                        self.constraints_marked_circular.push(t);
                    }
                }
            }
            return None;
        }
        // `computeBaseConstraint(getSimplifiedType(t, false))`: `{ [P in K]: E }[X]` is `E` with
        // `X` substituted for `P` before anything is replaced by its constraint.
        // The recursion goes at least 10 levels deep and at most 50, and from level 10 on it stops
        // at an instantiation of the same declaration as an earlier level. The cutoff depends on
        // the enclosing chain, and `resolvedBaseConstraint` caches the result anyway.
        let identity = self.recursion_identity(ty);
        let depth = self.constraint_stack.len();
        let continues = depth < 10 || depth < 50 && !self.constraint_stack.contains(&identity);
        self.constraint_stack.push(identity);
        let cuts = self.constraint_cuts.get();
        let result = if continues {
            let simplified = self.simplified(ty, false);
            self.compute_base_constraint(simplified)
        } else {
            self.cut_constraint_short();
            None
        };
        self.constraint_stack.pop();
        let left = self.leave(Query::Constraint(ty));
        // `!popTypeResolution()`: any resolution can close the cycle, and `resolvedBaseConstraint`
        // is then cached as `circularConstraintType`.
        // `constraints_marked_circular` is filled when `enter` fails, in which case the frame
        // itself isn't marked.
        let marked = self
            .constraints_marked_circular
            .iter()
            .position(|&t| t == ty);
        if self.left_a_cycle || marked.is_some() {
            if matches!(self.data(ty), TypeData::TypeParam(..))
                && !(self.circular_constraint_origins.iter()).any(|it| it.0 == ty)
            {
                let current = if self.eager.is_empty() {
                    self.current_node().or(self.current_source_element)
                } else {
                    None
                };
                self.circular_constraint_origins.push((ty, current));
            }
            // Another frame of `ty` can be in progress below a `resolution_start` barrier. Its
            // first read was a miss, so it learns of the cycle at its own `leave`. The mark stays
            // for that frame too.
            let is_in_flight = self.stack.contains(&Query::Constraint(ty));
            match marked {
                Some(marked) if !is_in_flight => {
                    self.constraints_marked_circular.swap_remove(marked);
                }
                None if is_in_flight => self.constraints_marked_circular.push(ty),
                _ => {}
            }
            // The value of an inner evaluation above a `resolution_start` barrier stays, if one was stored. It gets the flag.
            let known = self.known_constraint(ty);
            let known = known.and_then(|(known, _)| known);
            match self.constraints_of_this_task.get_mut(&ty) {
                Some(task_local) => task_local.1 = true,
                None => {
                    (self.p.constraints).rewrite(&self.task, ty, (known, true), Stored::new());
                }
            }
            return None;
        }
        match left {
            // An outer frame of `ty` may give the entry the flag.
            Ok(stored) if self.stack.contains(&Query::Constraint(ty)) => {
                self.store_constraint(ty, result, cuts, stored.held_back());
            }
            Ok(stored) => self.store_constraint(ty, result, cuts, stored),
            Err(open) => {
                let raw = result.map_or(0, |constraint| u64::from(constraint.0) + 1);
                self.cache_provisionally(Query::Constraint(ty), raw, open);
            }
        }
        result
    }

    /// `computeBaseConstraint`, with `constraint_stack` as its `stack`.
    fn compute_base_constraint(&mut self, t: TypeId) -> Option<TypeId> {
        match self.data(t) {
            // `isThisType`
            TypeData::ThisParam(_) => self.constraint_from_type_param(t),
            TypeData::TypeParam(..) | TypeData::Marker(_) => {
                let constraint = self.constraint_from_type_param(t)?;
                self.next_base_constraint(constraint)
            }
            TypeData::Union(types) | TypeData::Intersection(types) => {
                let mut constraints = Vec::with_capacity(types.len());
                for &s in types.iter() {
                    constraints.extend(self.next_base_constraint(s));
                }
                if constraints[..] == types[..] {
                    Some(t)
                } else if matches!(self.data(t), TypeData::Union(_)) {
                    (constraints.len() == types.len()).then(|| self.union(&constraints))
                } else {
                    (!constraints.is_empty()).then(|| self.intersection(&constraints))
                }
            }
            &TypeData::IndexedAccess {
                obj,
                index,
                undefined,
            } => {
                if let Some(template) = self.substitute_indexed_mapped(obj, index) {
                    return self.next_base_constraint(template);
                }
                let base_object = self.next_base_constraint(obj);
                let base_index = self.next_base_constraint(index);
                let (base_object, base_index) = (base_object?, base_index?);
                // `t.accessFlags`: read under noUncheckedIndexedAccess, a value from an index
                // signature may be missing.
                let found =
                    self.indexed_access_flagged(base_object, base_index, undefined, None)?;
                // The result is resolved in turn. If it's `t` itself, the constraint is circular.
                let found = self.next_base_constraint(found)?;
                (!self.is_deferred(found)).then_some(found)
            }
            &TypeData::Keyof(of) => {
                // The keys of a generic mapped type with an `as` clause whose constraint isn't
                // declared with `keyof` are its name type.
                if let Some((file, node, _)) = self.mapped_origin(of)
                    && self.is_generic_mapped_type(of)
                    && self.mapped_decl(file, node).name_ty.is_some()
                    && !matches!(self.mapped_modifiers_source(file, node), Some((_, true)))
                {
                    let names = self.get_index_type_for_mapped_type(of, IndexFlags::empty());
                    return self.next_base_constraint(names);
                }
                Some(self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]))
            }
            TypeData::Template { texts, types } => {
                let mut constraints = Vec::with_capacity(types.len());
                for &s in types.iter() {
                    constraints.extend(self.next_base_constraint(s));
                }
                Some(if constraints.len() == types.len() {
                    self.template_type(texts, &constraints)
                } else {
                    TypeId::STRING
                })
            }
            &TypeData::StringMapping { kind, ty } => Some(match self.next_base_constraint(ty) {
                Some(constraint) if constraint != ty => self.string_mapping(kind, constraint),
                _ => TypeId::STRING,
            }),
            TypeData::Cond { .. } => self.constraint_of_conditional(t),
            &TypeData::Substitution { base, constraint } => {
                let both = self.substitution_intersection(base, constraint);
                self.next_base_constraint(both)
            }
            // A variadic element is replaced by its constraint only if that consists of arrays and
            // tuples with no variadic element of their own.
            TypeData::Tuple {
                flags, readonly, ..
            } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) => {
                let elems = self.type_arguments(t);
                let mut new_elems = Vec::with_capacity(elems.len());
                for (&elem, flag) in elems.iter().zip(flags.iter()) {
                    let mut new_elem = elem;
                    if flag.contains(ElemFlags::VARIADIC)
                        && matches!(self.data(elem), TypeData::TypeParam(..))
                        && let Some(constraint) = self.next_base_constraint(elem)
                        && constraint != elem
                        && self.every_type(constraint, |c, n| {
                            c.is_array_or_tuple(n) && !c.is_generic_tuple_type(n)
                        })
                    {
                        new_elem = constraint;
                    }
                    new_elems.push(new_elem);
                }
                Some(self.distributed_tuple(&new_elems, flags, *readonly))
            }
            _ => Some(t),
        }
    }

    /// The property `name` of an object type, an intersection, or the wrapper type of a primitive.
    pub fn prop_ref(&mut self, ty: TypeId, name: Atom) -> Option<(&'p Prop<'p>, MapperId)> {
        let members = if self.is_intersection(ty) {
            match self.members_for_a_name(ty) {
                Some(members) => members,
                None => return self.property_of_unlisted_intersection(ty, name, true),
            }
        } else {
            self.members(ty)?
        };
        let prop = members.resolved.prop(name)?;
        if self.is_type_only_member(ty, name) {
            return None;
        }
        Some((prop, members.mapper))
    }

    /// `getPropertyOfTypeEx`: true if `ty` is the object type of a module that has `name` only
    /// through `export type *`. It's listed among the properties, but a lookup doesn't find it, and
    /// nothing substitutes for it.
    #[inline(always)]
    pub(super) fn is_type_only_member(&self, ty: TypeId, name: Atom) -> bool {
        self.types().is_module_object(ty) && self.is_type_only_member_of_module(ty, name)
    }

    #[inline(never)]
    fn is_type_only_member_of_module(&self, ty: TypeId, name: Atom) -> bool {
        matches!(*self.data(ty), TypeData::Anon { origin: Origin::Module(module) | Origin::Namespace { module, .. }, .. } if self.files().is_type_only_star_export(module, name))
    }

    /// `getSymbolOfDeclaration(member)`. A late-bound symbol is identified by the symbol the binder
    /// gave the first of its declarations.
    pub(super) fn symbol_of_member(&mut self, file: FileId, m: MemberId) -> Sym {
        let own = (file, Decl::Member(m));
        let (of, first) = match self.hir(file)[m].key {
            PropKey::Computed(_) => {
                let declarations = self.declarations_of_member(file, own.1);
                declarations.first().copied().unwrap_or(own)
            }
            _ => own,
        };
        self.files()
            .sym(of, self.bound(of).symbol_of_declaration(first))
    }

    /// True if `sym` is a member of a class, interface or type literal, or a parameter property, as
    /// opposed to an export of a module, namespace or enum.
    pub(super) fn is_member_symbol(&self, sym: Sym) -> bool {
        matches!(
            self.files().value_declaration(sym),
            Some((
                _,
                Decl::Member(_)
                    | Decl::ParameterProperty(_)
                    | Decl::Expando(_)
                    | Decl::ThisProperty(_)
            ))
        )
    }

    /// `symbol.Declarations` of a property's symbol.
    pub(super) fn declarations_of_property(&mut self, sym: Sym) -> List<'p, (FileId, Decl)> {
        self.merged_symbol_of_property(sym).2
    }

    /// `symbol.ValueDeclaration` of a property's symbol.
    pub(super) fn value_declaration_of_property(&mut self, sym: Sym) -> Option<(FileId, Decl)> {
        self.merged_symbol_of_property(sym).1
    }

    /// True if `symbol.ValueDeclaration` is an assignment. A property declared after
    /// `this.name = value` shares one symbol with it, and determines its type.
    pub(super) fn is_declared_by_assignment(&mut self, sym: Sym) -> bool {
        matches!(
            self.value_declaration_of_property(sym),
            Some((_, Decl::Expando(_) | Decl::ThisProperty(_)))
        )
    }

    /// The `symbol.Declarations` that are assignments.
    pub(super) fn assignments_of_symbol(&mut self, sym: Sym) -> SmallVec<[(FileId, ExprId); 2]> {
        let assignment = |&(file, decl): &(FileId, Decl)| match decl {
            Decl::Expando(e) | Decl::ThisProperty(e) => Some((file, e)),
            _ => None,
        };
        (self.declarations_of_property(sym).iter())
            .filter_map(assignment)
            .collect()
    }

    /// The `symbol.Declarations` that are members of classes, interfaces and type literals.
    pub(super) fn members_of_symbol(&mut self, sym: Sym) -> SmallVec<[(FileId, MemberId); 2]> {
        members_among(&self.declarations_of_property(sym))
    }

    /// `symbol.Flags` of a property's symbol.
    pub(super) fn flags_of_property(&mut self, sym: Sym) -> SymFlags {
        self.merged_symbol_of_property(sym).0
    }

    /// `prop.ValueDeclaration`
    pub(super) fn value_declaration_of_prop(&self, prop: &Prop) -> Option<(FileId, Decl)> {
        match *Self::value_declaration(prop)? {
            PropSource::Symbol(sym) => self.files().value_declaration(sym),
            PropSource::Literal(file, p) => Some((file, Decl::Property(p))),
            _ => None,
        }
    }

    /// `ValueDeclaration`: the source that locates the declaration of `prop`. `None` if it's
    /// synthesized, or if it represents properties of the members of an intersection that are
    /// declared in several places (`createUnionOrIntersectionProperty`), not counting synthesized
    /// ones.
    pub(super) fn value_declaration<'a>(prop: &'a Prop<'a>) -> Option<&'a PropSource<'a>> {
        match &prop.source {
            // `addMemberForKeyTypeWorker` links `Declarations` to a mapped property, never a `ValueDeclaration`.
            PropSource::Type(_)
            | PropSource::Mapped(..)
            | PropSource::Copy(_, _, false)
            | PropSource::ReverseMapped(..) => None,
            PropSource::Copy(_, of, true) => of.iter().find_map(Self::value_declaration),
            PropSource::Intersected(_, parts) => {
                Self::value_declaration(Self::prop_with_shared_value_declaration(parts.iter())?)
            }
            source => Some(source),
        }
    }

    /// `createUnionOrIntersectionProperty`: the first of `props` that has the `ValueDeclaration` of
    /// the property combined from them. `None` if none has one, or they have different ones.
    pub(super) fn prop_with_shared_value_declaration<'a, 'b: 'a>(
        props: impl Iterator<Item = &'a Prop<'b>>,
    ) -> Option<&'a Prop<'b>> {
        let mut declared = props.filter(|prop| Self::value_declaration(prop).is_some());
        let first = declared.next()?;
        let is_same = |other| Self::value_declaration(other) == Self::value_declaration(first);
        declared.all(is_same).then_some(first)
    }

    /// `getDeclarationModifierFlagsFromSymbol` and `isReadonlySymbol` for a property created by
    /// `createUnionOrIntersectionProperty`. If it has a `ValueDeclaration`, that declaration's modifiers count, not the
    /// constituents'. A mapped type's property has none.
    pub(super) fn set_modifiers_of_value_declaration(&mut self, prop: &mut Prop<'s>) {
        if Self::value_declaration(prop).is_none() {
            return;
        }
        let modifiers = self.get_declaration_modifier_flags_from_symbol_ex(prop, false);
        let is = |modifier| modifiers.contains(modifier);
        prop.flags.set(PropFlags::PRIVATE, is(Flags::PRIVATE));
        prop.flags.set(PropFlags::PROTECTED, is(Flags::PROTECTED));
        // The modifier only counts on a `SymbolFlagsProperty`.
        if is(Flags::READONLY) && !prop.flags.contains(PropFlags::ACCESSOR) {
            prop.flags |= PropFlags::READONLY;
        }
    }

    /// The source of a property of type `ty` that has the `Declarations` of the properties `of`,
    /// concatenated.
    /// With `preserves_value_declaration` it also has the `ValueDeclaration` and `Parent` of the
    /// first one (`createSymbolWithType`, and where `getSpreadSymbol` returns the symbol itself),
    /// not just the `Declarations` (the symbols `getSpreadSymbol` and `getSpreadType` recreate).
    pub(super) fn copy_of(
        ty: TypeId,
        of: &[&Prop],
        preserves_value_declaration: bool,
        arena: &'s Arena,
    ) -> PropSource<'s> {
        let declared = Self::declared_properties(of, arena);
        if declared.is_empty() {
            return PropSource::Type(ty);
        }
        let has_value_declaration =
            preserves_value_declaration && Self::value_declaration(of[0]).is_some();
        let declared = ArenaBox::from_iter_in(declared, arena);
        PropSource::Copy(ty, declared, has_value_declaration)
    }

    /// The symbols whose `Declarations` the properties `of` have, concatenated. None of them is
    /// synthesized, a copy, `Intersected` or `Mapped`.
    pub(super) fn declared_properties(of: &[&Prop], arena: &'s Arena) -> SmallVec<[Prop<'s>; 2]> {
        fn add_declared<'s>(prop: &Prop, arena: &'s Arena, declared: &mut SmallVec<[Prop<'s>; 2]>) {
            match &prop.source {
                PropSource::Type(_) => {}
                PropSource::Copy(_, parts, _)
                | PropSource::Intersected(_, parts)
                | PropSource::ReverseMapped(_, parts) => {
                    (parts.iter()).for_each(|part| add_declared(part, arena, declared));
                }
                PropSource::Mapped(..) => {
                    let declaring = prop.declared_by_modifiers_property();
                    declared.extend(declaring.iter().map(|it| it.clone_in(arena)));
                }
                _ => declared.push(Prop {
                    mapper: MapperId::IDENTITY,
                    ..prop.clone_in(arena)
                }),
            }
        }
        let mut declared = SmallVec::new();
        (of.iter()).for_each(|prop| add_declared(prop, arena, &mut declared));
        declared
    }

    /// The symbol of `literal_prop`, an object literal member or JSX attribute, with the type `ty`. For
    /// when the member is checked differently from how `type_of_literal_prop` checks it.
    pub(super) fn literal_member_of_type(
        file: FileId,
        literal_prop: PropId,
        name: Atom,
        ty: TypeId,
        arena: &'s Arena,
    ) -> Prop<'s> {
        let mut prop = Prop {
            name,
            flags: PropFlags::empty(),
            source: PropSource::Literal(file, literal_prop),
            mapper: MapperId::IDENTITY,
            name_type: TypeId::UNRESOLVED,
        };
        prop.source = Self::copy_of(ty, &[&prop], true, arena);
        prop
    }

    /// True if `ty` is an intersection that reduces to `never`.
    #[inline]
    pub fn is_never_intersection(&mut self, ty: TypeId) -> bool {
        self.is_intersection(ty) && self.is_empty_intersection(ty)
    }

    /// `is_never_intersection` for an intersection.
    fn is_empty_intersection(&mut self, ty: TypeId) -> bool {
        if let Some(known) = self.p.never_intersections.get(&self.task, &ty) {
            return known;
        }
        // `ObjectFlagsIsNeverIntersectionComputed` is set before the properties are examined, so a recursive query gets `false`.
        let in_progress = &self.never_in_progress;
        if let Some(at) = in_progress.iter().position(|&it| it == ty) {
            // `never_in_progress_from` only has an entry for the first occurrence of each type.
            let nth = (0..at).filter(|&i| !in_progress[..i].contains(&in_progress[i]));
            self.close_cycle_above(self.never_in_progress_from[nth.count()]);
            return false;
        }
        let scope = self.begin_scope();
        self.never_in_progress.push(ty);
        self.never_in_progress_from.push(self.stack.len());
        // `getPropertiesOfUnionOrIntersectionType` requests each member's properties. For an
        // instantiable member that goes through `getReducedApparentType`, so its base constraint is
        // resolved here, along with any errors and cycles that causes.
        let (mut listed_now, mut unions_now) = (
            SmallVec::<[TypeId; 4]>::new(),
            SmallVec::<[TypeId; 4]>::new(),
        );
        if let TypeData::Intersection(members) = self.data(ty) {
            let mut has_union = false;
            for &member in members.iter() {
                if self.is_instantiable(member) {
                    let apparent = self.apparent_type(member);
                    has_union |= self.is_union(apparent);
                }
            }
            // A union's properties are created when they're listed, each with the types of the properties it combines,
            // whether or not another member has the name. The members are listed in order, and each name is immediately
            // looked up in all of them. So in `Partial<T> & T`, and in `{ a: 1 } & T & Partial<T>`, the mapped type has
            // its (still empty) members in place while the constraint of `T` is listed.
            if has_union {
                let apparent: SmallVec<[TypeId; 4]> =
                    members.iter().map(|&it| self.apparent_type(it)).collect();
                let mut checked = crate::util::FxHashSet::<Atom>::default();
                let mut has_resolved_the_others = false;
                for &current in &apparent {
                    let listed = match self.is_union(current) {
                        true => self.union_as_object(current),
                        false => current,
                    };
                    let Some(current_members) = self.members(listed) else {
                        continue;
                    };
                    let props = &current_members.shape().props;
                    // FOR SPEED. Thousands of intersections have the same few unions among their constraints.
                    let is_listed_in_all = apparent.iter().all(|&other| {
                        !self.is_union(other) || self.listed_in_unions.contains(&(listed, other))
                    });
                    listed_now.push(listed);
                    if !has_resolved_the_others && !props.is_empty() {
                        has_resolved_the_others = true;
                        for &other in &apparent {
                            if !self.is_union(other) {
                                self.members(other);
                            }
                        }
                    }
                    if is_listed_in_all {
                        continue;
                    }
                    for prop in props {
                        if !checked.insert(prop.name) {
                            continue;
                        }
                        for &other in &apparent {
                            if self.is_union(other) {
                                self.union_property(other, prop.name);
                            }
                        }
                    }
                }
                unions_now.extend(apparent.iter().copied().filter(|&it| self.is_union(it)));
            }
        }
        // `isNeverReducedProperty`
        let is_never = self.has_property_in_several_members(ty)
            && match self.may_have_never_reduced_property(ty, false) {
                NeverReduced::No => false,
                NeverReduced::Yes => true,
                NeverReduced::NeedsShape => self.why_never_intersection(ty).is_some(),
            };
        self.never_in_progress.pop();
        self.never_in_progress_from.pop();
        match self.end_scope_by_counters(scope) {
            Ok(stored) => {
                // Every property that was requested is stored.
                for &listed in &listed_now {
                    (self.listed_in_unions).extend(unions_now.iter().map(|&union| (listed, union)));
                }
                (self.p.never_intersections).insert(&self.task, ty, is_never, stored)
            }
            Err(_) => is_never,
        }
    }

    /// `getReducedType(getApparentType(ty))` for an intersection `ty` whose properties
    /// `getReducedType(ty)` is examining. `getApparentTypeOfIntersectionType` passes `ty` to its
    /// classes, interfaces and tuples as the `this` argument and takes the apparent type of the
    /// other members. If that changes a member, the result is a different intersection with its own
    /// `ObjectFlagsIsNeverIntersectionComputed`. Its properties are created, which requests the
    /// types of the properties that several members have once more. In any other state those all
    /// have their types already, which is why one type represents both intersections here.
    #[cold]
    #[inline(never)]
    pub(super) fn reduce_apparent_type_of_intersection_in_progress(&mut self, ty: TypeId) {
        if self
            .never_in_progress
            .iter()
            .filter(|&&it| it == ty)
            .count()
            != 1
        {
            return;
        }
        let TypeData::Intersection(parts) = self.data(ty) else {
            return;
        };
        let this_argument = ty;
        let is_another_type = parts.iter().any(|&part| {
            matches!(self.data(part), TypeData::Tuple { .. })
                || self.type_with_this_argument(part, this_argument) != part
                || self.apparent_type(part) != part
        });
        if !is_another_type {
            return;
        }
        // With a member whose apparent type is a union, like `U extends A | B`, the result is a union of intersections.
        // Each is reduced when the union is, and none of them lists the properties of `A | B`.
        let has_union = parts.iter().any(|&part| {
            let apparent = self.apparent_type(part);
            self.is_union(apparent)
        });
        if has_union {
            return;
        }
        self.never_in_progress.push(ty);
        if self.has_property_in_several_members(ty) {
            self.may_have_never_reduced_property(ty, true);
        }
        self.never_in_progress.pop();
    }

    /// `getPropertiesOfUnionOrIntersectionType(ty)` for an intersection `ty` whose properties
    /// `getReducedType(ty)` is examining. `resolvedProperties` isn't set yet and the property being
    /// created isn't in `propertyCache`, so `createUnionOrIntersectionProperty` requests the types
    /// of the symbols it combines once more.
    #[cold]
    #[inline(never)]
    pub(super) fn create_properties_of_intersection_in_progress(&mut self, ty: TypeId) {
        if self
            .never_in_progress
            .iter()
            .filter(|&&it| it == ty)
            .count()
            != 1
        {
            return;
        }
        self.never_in_progress.push(ty);
        if self.has_property_in_several_members(ty) {
            self.may_have_never_reduced_property(ty, false);
        }
        self.never_in_progress.pop();
    }

    /// FOR SPEED: true if two members of the intersection `ty` may have a property with the same
    /// name. If not, every property of `ty` comes from one member (`singleProp` of
    /// `createUnionOrIntersectionProperty`), and `isNeverReducedProperty` is false for all of them.
    /// This is decided without building the shape of `ty` or, in `T & {}`, the base constraint of
    /// `T`. Most intersections with a type parameter never need them, and every task would compute
    /// them separately.
    fn has_property_in_several_members(&mut self, ty: TypeId) -> bool {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return false;
        };
        // `keyof T & keyof U & string`: the apparent type of each is `String`, `Number`, `Symbol`
        // .. or a union of them (`getApparentType`). Two kinds of primitive reduce to `never` when
        // the intersection is created, so the remaining members share a wrapper type, and a
        // property of that wrapper combined with the same property on the other side isn't `never`.
        let is_wrapper_like = tf::STRING_LIKE
            | tf::NUMBER_LIKE
            | tf::BIGINT_LIKE
            | tf::BOOLEAN_LIKE
            | tf::ES_SYMBOL_LIKE
            | tf::INDEX;
        if parts
            .iter()
            .all(|&part| self.flags(part) & is_wrapper_like != 0)
        {
            return false;
        }
        // The members that have properties. FOR SPEED, there's no set of all the names, since each
        // member has its own index.
        let mut seen: SmallVec<[Members<'p>; 4]> = SmallVec::new();
        let mut unions: SmallVec<[TypeId; 2]> = SmallVec::new();
        let deferred = parts.iter().filter(|&&part| self.is_deferred(part)).count();
        // Members whose apparent type needs no resolution come first.
        for is_deferred in [false, true] {
            // One member is left, and the others have no property for it to share.
            if is_deferred && deferred == 1 && seen.is_empty() {
                return false;
            }
            for &part in parts.iter() {
                if self.is_deferred(part) != is_deferred {
                    continue;
                }
                let part = self.apparent_type(part);
                if self.is_union(part) {
                    unions.push(part);
                } else if let Some(members) = self.members_for_reduction(part, ty)
                    && !members.shape().props.is_empty()
                {
                    let mut earlier = seen.iter();
                    if earlier.any(|it| members.resolved.shares_a_name_with(it.resolved)) {
                        return true;
                    }
                    seen.push(members);
                }
            }
        }
        match unions[..] {
            [] => false,
            [union] => seen.iter().any(|members| {
                let mut props = members.shape().props.iter();
                props.any(|prop| self.union_property(union, prop.name).is_some())
            }),
            _ => true,
        }
    }

    /// FOR SPEED: decides whether `isNeverReducedProperty` is true for some property of the intersection `ty`. It looks
    /// at the properties that two members share, read the way `build_intersection_shape` reads them, without building
    /// the shape. Most intersections are never queried for anything else, and a shape has a copy of every property of
    /// every member. The product of two unions of 170 object types with a discriminant is 28,900 intersections, nearly
    /// all empty.
    ///
    /// `isDiscriminantWithNeverType` needs a property that some member X has without `?`, with
    /// `CheckFlagsNonUniformAndLiteral`. If for every other member with that property its type and X's are the same, or
    /// neither is a literal type, then no type is a literal type, or X's is one and all are the same.
    /// `isConflictingPrivateProperty` needs a property that is private in some member.
    ///
    /// `getReducedType` creates every property of `ty` first, and `createUnionOrIntersectionProperty` resolves the
    /// types of all the symbols that it combines, in `compareProperties` or in its last loop. One of them may be in the
    /// middle of being resolved: ``class C { x? = `${this}` as const }``. So no pair is skipped, and the search doesn't
    /// stop at the first pair that decides the answer, not even when nothing is in progress. The result is stored, and
    /// a member whose resolution starts later and needs this reduction would read it, whereas tsgo would have started
    /// that resolution from here and closed the cycle in the reduction of the apparent type:
    /// `f(null! as C & { x?: 1 }); class C { x? = { a: f(null! as C & { x?: 1 }) } }`
    ///
    /// `is_apparent` means this is for `getApparentType(ty)`, in whose classes `this` is `ty`. In the classes of `ty`
    /// itself, `this` is the class (`resolveTypeReferenceMembers`), so `p?: this["z"]` of `C` requests `C["z"]` first
    /// and `ty["z"]` in the reduction of the apparent type.
    fn may_have_never_reduced_property(&mut self, ty: TypeId, is_apparent: bool) -> NeverReduced {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return NeverReduced::No;
        };
        let mut all: SmallVec<[Members<'p>; 4]> = SmallVec::new();
        for &constituent in parts.iter() {
            let part = self.apparent_type(constituent);
            // `getPropertiesOfType(current)` lists the properties of a constraint that is a union, and so creates them all.
            let part = if self.is_union(part) {
                self.union_as_object(part)
            } else {
                part
            };
            let members = if self.is_deferred(constituent) {
                self.members_of_apparent_type(constituent, part)
            } else if is_apparent {
                let this_argument = ty;
                self.members_with_this(part, this_argument)
            } else {
                self.members_for_reduction(part, ty)
            };
            if let Some(members) = members {
                all.push(members);
            }
        }
        // The names in the order of `getPropertiesOfUnionOrIntersectionType`, and for each the members
        // in order. `createUnionOrIntersectionProperty` compares every symbol with the first
        // (`singleProp`, `firstType`), so the cost is linear in the number of members:
        // `JSX.IntrinsicElements[keyof JSX.IntrinsicElements]` in a parameter has hundreds.
        let mut needs_shape = false;
        // The types of the symbols of each property that may be a discriminant of type `never`, in the order of the properties.
        let mut discriminants: SmallVec<[(SmallVec<[TypeId; 4]>, Option<TypeId>); 2]> =
            SmallVec::new();
        // Whether the members are the same as in `ty`'s shape, where each has `ty` as `this`
        // (`members_of_constituent`). Computed lazily.
        let mut is_shape_of_whole = is_apparent.then_some(true);
        // Replaces `prop_set` of `combine_props` once it has `LONG_PROP_LIST` entries. It gets those entries and all
        // later ones.
        let mut long_prop_set = crate::util::FxHashSet::<PropOfConstituent<'p>>::default();
        // `prop` is the first property with a name. `combined` and `scope` are what `combine_props` returned for it.
        let mut examine = |c: &mut Self, prop: &Prop, combined: Combined, scope: Option<Scope>| {
            let Combined {
                types,
                some,
                every,
                is_non_uniform,
                has_literal,
                has_non_member_symbol,
            } = combined;
            let Some(scope) = scope else {
                return;
            };
            // `createUnionOrIntersectionProperty` resolves the type of a property made of two
            // symbols immediately, and defers it for more than two (`CheckFlagsDeferredType`).
            let (mut resolved_type, mut is_new) = (None, false);
            if types.len() == 2 {
                let whole = ty;
                let is_whole_shape = *is_shape_of_whole.get_or_insert_with(|| {
                    parts.iter().all(|&constituent| {
                        let part = c.apparent_type(constituent);
                        c.is_deferred(constituent)
                            || c.is_union(part)
                            || !matches!(c.data(part), TypeData::Tuple { .. })
                                && c.type_with_this_argument(part, whole) == part
                    })
                });
                let known = match is_whole_shape {
                    true => c.p.intersected_props.get(&c.task, &(ty, prop.name)),
                    false => None,
                };
                is_new = is_whole_shape && known.is_none();
                resolved_type = Some(match known {
                    Some(known) => known,
                    None => c.intersection(&types),
                });
            }
            if let (Ok(stored), Some(all), true) =
                (c.end_scope_by_counters(scope), resolved_type, is_new)
            {
                c.p.intersected_props
                    .insert(&c.task, (ty, prop.name), all, stored);
            }
            let may_be_discriminant =
                !every.contains(PropFlags::OPTIONAL) && is_non_uniform && has_literal;
            if some.contains(PropFlags::PRIVATE) || may_be_discriminant && has_non_member_symbol {
                needs_shape = true;
            } else if may_be_discriminant {
                discriminants.push((types, resolved_type));
            }
        };
        // FOR SPEED, a name that no later member has is skipped, since there's nothing to combine it with.
        let mut holders: SmallVec<[Holder<'p>; 8]> = SmallVec::new();
        let holder = |(at, position): (u32, u32)| {
            let member = all[at as usize];
            (member, &member.shape().props[position as usize])
        };
        if all.len() > FEW_MEMBERS {
            let names = SharedNames::of(&all);
            self.note_names_of_constituents(ty, &names);
            // Taken out of the checker while in use. See check/sibling_intersections.rs.
            let mut memo = match self.may_reuse_for_siblings() {
                true => self.sibling_intersections.take(),
                false => None,
            };
            let numbers = memo.as_mut().map_or(Vec::new(), |it| it.numbers_of(&all));
            for name_holders in names.iter() {
                holders.clear();
                holders.extend(name_holders[1..].iter().map(|&it| holder(it)));
                let first = holder(name_holders[0]);
                if memo.as_mut().is_some_and(|it| !self.are_facts_usable(it)) {
                    memo = None;
                }
                let facts =
                    (memo.as_mut()).map(|all| FactsOfName::new(all, &numbers, name_holders));
                let (combined, scope) =
                    self.combine_props(first, &holders, &mut long_prop_set, facts);
                examine(self, first.1, combined, scope);
            }
            if memo.is_some() {
                self.sibling_intersections = memo;
            }
        } else {
            let mut seen = crate::util::FxHashSet::<Atom>::default();
            // The positions of a member's properties that need to be examined.
            let mut shared = PositionSet::default();
            for (at, &member) in all.iter().enumerate() {
                let rest = &all[at + 1..];
                let props = &member.shape().props;
                shared.reset(props.len());
                Self::add_positions_of_shared_names(member, rest, &mut shared);
                for position in shared.iter() {
                    let prop = &props[position];
                    // With two members, only the first gets here, and all its names are new.
                    if all.len() > 2 && !seen.insert(prop.name) {
                        continue;
                    }
                    holders.clear();
                    for &later in rest {
                        if let Some(other) = later.resolved.prop(prop.name) {
                            holders.push((later, other));
                        }
                    }
                    let (combined, scope) =
                        self.combine_props((member, prop), &holders, &mut long_prop_set, None);
                    examine(self, prop, combined, scope);
                }
            }
        }
        if needs_shape {
            return NeverReduced::NeedsShape;
        }
        // `isDiscriminantWithNeverType`, as in `why_never_intersection`.
        for (types, resolved_type) in &discriminants {
            if !(types.iter()).any(|&t| t.is_never() && t != TypeId::UNIQUE_LITERAL)
                && resolved_type
                    .unwrap_or_else(|| self.intersection(types))
                    .is_never()
            {
                return NeverReduced::Yes;
            }
        }
        NeverReduced::No
    }

    /// `isInstantiation && compareProperties(singleProp, prop, compareTypesEqual)`: true if `prop` is an instantiation of
    /// the same symbol as `single` and has the same type. `type_of_single` is `None` if `prop` is `single`.
    fn is_merged_instantiation(
        (single, type_of_single): (&Prop, Option<&TypeId>),
        (prop, ty): (&Prop, TypeId),
    ) -> bool {
        type_of_single == Some(&ty)
            && matches!(single.source, PropSource::Symbol(_))
            && single.source == prop.source
            && (single.flags ^ prop.flags)
                .difference(PropFlags::THISLESS)
                .is_empty()
    }

    /// The part of `createUnionOrIntersectionProperty` that looks at each symbol. `prop` is the first property with a
    /// name, and belongs to `member`. `holders` has the later members that have the name, each with its property.
    /// `long_prop_set` is scratch space. `facts` covers `prop`, then the properties in `holders`. See
    /// check/sibling_intersections.rs.
    ///
    /// Also returns the scope it begins before it requests the first type, or `None` if there's only one symbol.
    fn combine_props(
        &mut self,
        (member, prop): Holder<'p>,
        holders: &[Holder<'p>],
        long_prop_set: &mut crate::util::FxHashSet<PropOfConstituent<'p>>,
        mut facts: Option<FactsOfName<'_, 'p>>,
    ) -> (Combined, Option<Scope>) {
        // The properties `build_intersection_shape` ignores when it decides whether the property is optional.
        let is_non_member_symbol = |c: &Self, prop: &Prop| matches!(prop.source, PropSource::Symbol(sym) if !c.is_member_symbol(sym));
        // `singleProp` is `prop`, instantiated. With the identity mapper that's `prop` itself.
        let mut single_instantiation: Option<PropInstantiation> = None;
        let mut type_of_single: Option<TypeId> = None;
        let (mut some, mut every) = (prop.flags, prop.flags);
        let (mut is_non_uniform, mut has_literal) = (false, false);
        let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
        let mut has_non_member_symbol = is_non_member_symbol(self, prop);
        // `propSet`: a symbol that several members have is considered once.
        let mut prop_set: SmallVec<[PropOfConstituent<'p>; 4]> = SmallVec::new();
        long_prop_set.clear();
        let mut scope = None;
        for (nth, &(later, other)) in (1..).zip(holders) {
            // The same property under the same mapper is the same property, whatever the mapper
            // turns it into.
            if std::ptr::eq(prop, other) && member.mapper == later.mapper {
                continue;
            }
            if self.is_same_uninstantiated_member(prop, other) {
                continue;
            }
            // FOR SPEED, neither is copied for the comparison, because a union's property contains a property of each
            // constituent.
            let instantiation =
                self.instantiation_of_prop_with_facts(facts.as_mut(), nth, other, later.mapper);
            if single_instantiation.is_none() && member.mapper != MapperId::IDENTITY {
                let mapper = member.mapper;
                let it = self.instantiation_of_prop_with_facts(facts.as_mut(), 0, prop, mapper);
                single_instantiation = Some(it);
            }
            // The same property reached through two paths.
            let is_same = match single_instantiation {
                Some(single_instantiation) => {
                    instantiation.yields_same_prop_as(other, single_instantiation, prop)
                }
                None => instantiation.makes(prop, other),
            };
            if is_same {
                continue;
            }
            let first_type = match type_of_single {
                Some(first_type) => first_type,
                None => {
                    scope = Some(self.begin_scope());
                    let first =
                        self.type_of_prop_with_facts(facts.as_mut(), 0, prop, single_instantiation);
                    has_literal = first.is_literal;
                    type_of_single = Some(first.ty);
                    types.push(first.ty);
                    first.ty
                }
            };
            let later_symbol = PropOfConstituent(other, later.mapper);
            if let Some(facts) = &mut facts {
                if !facts.add_symbol(nth, later_symbol) {
                    continue;
                }
            } else if prop_set.len() < LONG_PROP_LIST {
                if prop_set.contains(&later_symbol) {
                    continue;
                }
                prop_set.push(later_symbol);
            } else {
                if long_prop_set.is_empty() {
                    long_prop_set.extend(prop_set.iter().copied());
                }
                if !long_prop_set.insert(later_symbol) {
                    continue;
                }
            }
            let other_instantiation = (later.mapper != MapperId::IDENTITY).then_some(instantiation);
            let second =
                self.type_of_prop_with_facts(facts.as_mut(), nth, other, other_instantiation);
            if Self::is_merged_instantiation((prop, Some(&first_type)), (other, second.ty)) {
                continue;
            }
            types.push(second.ty);
            has_non_member_symbol |= is_non_member_symbol(self, other);
            (some, every) = (some | other.flags, every & other.flags);
            is_non_uniform |= second.ty != first_type;
            has_literal |= second.is_literal;
        }
        let combined = Combined {
            types,
            some,
            every,
            is_non_uniform,
            has_literal,
            has_non_member_symbol,
        };
        (combined, scope)
    }

    /// True for an intersection, or a type with `ObjectFlagsContainsIntersections`.
    #[inline]
    pub(super) fn may_be_reduced(&self, ty: TypeId) -> bool {
        let flags = self.types().object_flags(ty);
        flags.contains(ObjectFlags::MAY_BE_REDUCED)
    }

    /// `ty` without the intersections that reduce to `never`.
    #[inline]
    pub fn reduced(&mut self, ty: TypeId) -> TypeId {
        if self.may_be_reduced(ty) {
            cold_path();
            self.reduced_members(ty)
        } else {
            ty
        }
    }

    /// `reduced` for an intersection or a union with one among its members.
    fn reduced_members(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Intersection(_) if self.is_empty_intersection(ty) => TypeId::NEVER,
            TypeData::Union(members) => {
                if let Some(known) = self.reduced_unions.get(ty) {
                    return known;
                }
                let before = self.non_cacheable_mark();
                // The first intersection computes the facts, the second finds that recomputing them leaves no trace,
                // and only the third saves work.
                let is_large = |m: &&TypeId| matches!(self.data(**m), TypeData::Intersection(parts) if parts.len() > FEW_MEMBERS);
                let has_three = members.iter().filter(is_large).nth(2).is_some();
                let facts = has_three.then(|| self.facts_for_siblings());
                let outer = std::mem::replace(&mut self.sibling_intersections, facts);
                // `getReducedUnionType` builds a union of the remaining members. Unlike `filterType`, it drops the
                // origin, so `A | (X & Y)` is printed as the members of the alias `A`.
                let mut kept: SmallVec<[TypeId; 8]> = SmallVec::new();
                for &member in members.iter() {
                    if !self.is_never_intersection(member) {
                        kept.push(member);
                    }
                }
                let reduced = match kept.len() == members.len() {
                    true => ty,
                    false => self.union(&kept),
                };
                self.sibling_intersections = outer;
                // A member that's being reduced counts as not `never` for now, and doesn't change any counter.
                let is_in_progress = |member: &TypeId| self.never_in_progress.contains(member);
                if self.non_cacheable_mark() == before && !members.iter().any(is_in_progress) {
                    self.reduced_unions.insert(ty, reduced);
                }
                reduced
            }
            _ => ty,
        }
    }

    /// The type of `ty.name`. `None` if there's no such property.
    pub fn type_of_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        self.property_type(ty, ty, name, Access::Read)
            .map(|found| found.0)
    }

    /// The type of `ty.name` where it's only assigned: the target of `=`, of a destructuring
    /// assignment, of `for..of`.
    pub fn write_type_of_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        self.property_type(ty, ty, name, Access::Written)
            .map(|found| found.0)
    }

    /// `prop` or `indexInfo` of `checkPropertyAccessExpressionOrQualifiedName`: the type, and which of the two it
    /// belongs to.
    pub(super) fn property_type(
        &mut self,
        left_type: TypeId,
        apparent_type: TypeId,
        name: Atom,
        access: Access,
    ) -> Option<(TypeId, Found)> {
        let (found, how) = self.find_property(left_type, apparent_type, name, access)?;
        // `noUncheckedIndexedAccess`: a value read through an index signature may be missing.
        let may_be_missing = how == Found::ByIndex
            && access == Access::Read
            && self.p.files.options.no_unchecked_indexed_access;
        let found = if may_be_missing {
            self.with_missing(found)
        } else {
            found
        };
        Some((found, how))
    }

    /// `checkPropertyAccessExpressionOrQualifiedName`: the type of the property `name` of
    /// `apparent_type`, or failing that of the applicable index signature, and which of the two it
    /// is.
    fn find_property(
        &mut self,
        left_type: TypeId,
        apparent_type: TypeId,
        name: Atom,
        access: Access,
    ) -> Option<(TypeId, Found)> {
        if self.is_any(apparent_type) {
            return Some((apparent_type, Found::Property));
        }
        let skips = self.is_const_enum_object(apparent_type);
        if let Some((prop, mapper)) = self.get_property_of_type_ex(apparent_type, name, skips) {
            let found = if access == Access::Written {
                self.write_type_of_prop(prop, mapper)
            } else {
                self.type_of_prop(prop, mapper)
            };
            return Some((found, Found::Property));
        }
        let apparent = self.reduced_apparent_type(apparent_type);
        if self.is_any(apparent) {
            return Some((apparent, Found::Property));
        }
        // `!ast.IsPrivateIdentifier(right)`: no index signature substitutes for the `#x` of a class. And nothing is
        // written through an index signature of a type parameter's constraint.
        if self.atoms().is_private_symbol_name(name)
            || access != Access::Read
                && !matches!(self.data(left_type), TypeData::ThisParam(_))
                && self.is_generic_object_type(left_type)
        {
            return None;
        }
        let members = self.members_for_index_infos(apparent)?;
        let info = self.applicable_index_info_for_name(&members, name)?;
        Some((info.value, Found::ByIndex))
    }

    /// `getRestTypeOfTupleType` of the apparent type of `ty`, if that is a tuple: the type of its
    /// elements from the first non-fixed one on, `undefined` if all are fixed.
    pub(super) fn beyond_fixed_elements(&mut self, ty: TypeId) -> Option<TypeId> {
        let apparent = self.apparent_type(ty);
        let TypeData::Tuple { flags, .. } = self.data(apparent) else {
            return None;
        };
        let elems = self.type_arguments(apparent);
        let fixed = Self::fixed_length(flags);
        Some(if fixed < flags.len() {
            self.tuple_element_union(&elems[fixed..], &flags[fixed..])
        } else {
            TypeId::UNDEFINED
        })
    }

    /// `isConstEnumObjectType`
    #[inline(always)]
    pub(super) fn is_const_enum_object(&self, ty: TypeId) -> bool {
        // This runs for every expression. Most have a type that isn't an object type, which can be read from a column.
        if !self.types().is_plain_object(ty) {
            return false;
        }
        self.is_const_enum_object_by_record(ty)
    }

    #[inline(never)]
    fn is_const_enum_object_by_record(&self, ty: TypeId) -> bool {
        matches!(*self.data(ty), TypeData::Anon { origin: Origin::EnumObject(sym), .. }
            if self.files().decls_of(sym).iter().any(|&(f, d)| matches!(d, Decl::Enum(id) if self.hir(f)[id].flags.contains(Flags::CONST))))
    }

    /// `getPropertyOfType`
    pub(super) fn get_property_of_type(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        self.get_property_of_type_ex(ty, name, false)
    }

    /// The type to pass to `get_property_of_type_ex` for `getPropertyOfTypeEx(apparent_type, ..)`,
    /// where `apparent_type` is `getApparentType(ty)`. `get_property_of_type_ex` takes the apparent
    /// type once more, which matters because the apparent type of a `T & {}` is `string`, not
    /// `String`. For a type variable's apparent type that changes nothing, but the apparent type
    /// doesn't tell what `this` is in a tuple type. `get_property_of_type_ex` gets that from the
    /// variable, or from the intersection whose members have become one tuple type.
    #[inline(always)]
    pub(super) fn apparent_type_or_type_variable(
        &self,
        ty: TypeId,
        apparent_type: TypeId,
    ) -> TypeId {
        if self.is_deferred(ty)
            || ty != apparent_type && self.is_intersection(ty) && self.is_tuple(apparent_type)
        {
            ty
        } else {
            apparent_type
        }
    }

    /// `getPropertyOfTypeEx`
    pub(super) fn get_property_of_type_ex(
        &mut self,
        ty: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        let holder = self.property_holder_for_a_name(ty);
        if self.is_deferred(ty)
            && let PropertyHolder::Members(apparent, _) | PropertyHolder::Unlisted(apparent) =
                holder
            && let Some(found) = self.property_of_only_tuple_constituent(ty, apparent, name)
        {
            return Some(found);
        }
        self.property_of_holder(holder, name, skip_object_function_property_augment)
    }

    /// Returns the property `name` of the tuple in the intersection `apparent`, if no other constituent has that property.
    /// `createUnionOrIntersectionProperty` returns such a property as it is. `apparent` is the apparent type of the type
    /// variable `ty`, so `this` is `ty` in each constituent. A tuple has no slot for that, and in the intersection's own
    /// members its `this` is the intersection.
    fn property_of_only_tuple_constituent(
        &mut self,
        ty: TypeId,
        apparent: TypeId,
        name: Atom,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        let TypeData::Intersection(parts) = self.data(apparent) else {
            return None;
        };
        let tuple = *parts.iter().find(|&&part| self.is_tuple(part))?;
        let this_argument = ty;
        let members = self.members_with_this(tuple, this_argument)?;
        let prop = members.resolved.prop(name)?;
        for &part in parts.iter() {
            if part != tuple && self.get_property_of_type(part, name).is_some() {
                return None;
            }
        }
        Some((prop, members.mapper))
    }

    /// The part of `getPropertyOfTypeEx(ty, ..)` that doesn't depend on the name.
    #[inline(always)]
    pub(super) fn property_holder(&mut self, ty: TypeId) -> PropertyHolder<'p> {
        let apparent = self.reduced_apparent_type(ty);
        self.holder_of_apparent_type(ty, apparent)
    }

    /// `property_holder` for a member of a union. `is_listed` means every name that the union's members have will be
    /// looked up in the union.
    #[inline]
    pub(super) fn property_holder_of_member(
        &mut self,
        ty: TypeId,
        is_listed: bool,
    ) -> PropertyHolder<'p> {
        match is_listed {
            true => self.property_holder(ty),
            false => self.property_holder_for_a_name(ty),
        }
    }

    /// The identity `UnionPropertyBuilder::symbols` uses for `prop`, a property of `of`: its address. An intersection
    /// has one property per name, but that property has no address until the properties are listed, so it's identified
    /// by the intersection instead. The two can't collide, because no address is odd.
    #[inline]
    pub(super) fn identity_of_own_property(
        &self,
        of: TypeId,
        prop: &'p Prop<'p>,
    ) -> *const Prop<'p> {
        match self.is_intersection(of) {
            true => std::ptr::without_provenance(((of.0 as usize) << 1) | 1),
            false => std::ptr::from_ref(prop),
        }
    }

    /// `identity_of_own_property` for a property that `property_of_holder(holder, ..)` found, which belongs to the type
    /// or to a global type whose properties the type has.
    pub(super) fn identity_of_found_property(
        &mut self,
        holder: PropertyHolder<'p>,
        prop: &'p Prop<'p>,
    ) -> *const Prop<'p> {
        let address = std::ptr::from_ref(prop);
        match holder {
            PropertyHolder::Members(of, members)
                if members.shape().props.as_ptr_range().contains(&address) =>
            {
                self.identity_of_own_property(of, prop)
            }
            PropertyHolder::Unlisted(of) if self.is_own_property_of_intersection(of, prop) => {
                self.identity_of_own_property(of, prop)
            }
            _ => address,
        }
    }

    /// `property_holder`, for a caller that looks up one name in it.
    #[inline(always)]
    pub(super) fn property_holder_for_a_name(&mut self, ty: TypeId) -> PropertyHolder<'p> {
        let apparent = self.reduced_apparent_type(ty);
        if self.is_intersection(apparent) {
            return match self.members_for_a_name(apparent) {
                Some(members) => PropertyHolder::Members(apparent, members),
                None => PropertyHolder::Unlisted(apparent),
            };
        }
        self.holder_of_apparent_type(ty, apparent)
    }

    /// `apparent` is `getReducedApparentType(ty)`.
    #[inline(always)]
    fn holder_of_apparent_type(&mut self, ty: TypeId, apparent: TypeId) -> PropertyHolder<'p> {
        if self.is_union(apparent) {
            return PropertyHolder::Union(apparent);
        }
        match self.members_of_apparent_type(ty, apparent) {
            Some(members) => PropertyHolder::Members(apparent, members),
            None => PropertyHolder::Nothing,
        }
    }

    /// The rest of `getPropertyOfTypeEx`. Both halves are inlined so that `get_property_of_type_ex`, which every property access
    /// goes through, doesn't pass a `PropertyHolder` through memory.
    #[inline(always)]
    pub(super) fn property_of_holder(
        &mut self,
        holder: PropertyHolder<'p>,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        match holder {
            PropertyHolder::Union(apparent) => {
                // `getPropertyOfUnionOrIntersectionType`: "We need to filter out partial properties in union types"
                let skips = skip_object_function_property_augment;
                let prop = self.union_property_ex(apparent, name, skips)?;
                (!prop.flags.contains(PropFlags::READ_PARTIAL))
                    .then_some((prop, MapperId::IDENTITY))
            }
            PropertyHolder::Members(apparent, members) => {
                if self.is_type_only_member(apparent, name) {
                    return None;
                }
                if skip_object_function_property_augment {
                    return Some((members.resolved.prop(name)?, members.mapper));
                }
                self.property_in_type(apparent, &members, name)
            }
            PropertyHolder::Unlisted(apparent) => {
                let skips = skip_object_function_property_augment;
                self.property_of_unlisted_intersection(apparent, name, skips)
            }
            PropertyHolder::Nothing => None,
        }
    }

    /// The members with the index signatures `getIndexInfosOfType(ty)` returns: for a union, those
    /// that `resolveUnionTypeMembers` has set.
    pub(super) fn members_for_index_infos(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let ty = self.reduced_apparent_type(ty);
        if !matches!(self.data(ty), TypeData::Union(_)) {
            return self.structured_members(ty);
        }
        // A request while the union is being resolved resolves it again, with the index signatures
        // its constituents have at that point.
        Some(self.resolve_union_type_members(ty, |c| {
            let parts = c.parts(ty);
            Shape {
                index: vec_from_iter_in(c.union_index_infos(parts), c.arena),
                ..Shape::new_in(c.arena)
            }
        }))
    }

    /// `getApplicableIndexInfoForName`
    pub(super) fn applicable_index_info_for_name(
        &mut self,
        members: &Members<'p>,
        name: Atom,
    ) -> Option<IndexInfo> {
        let members = &self.structured(*members);
        if members.index_infos().is_empty() {
            return None;
        }
        let key_type = if self.atoms().is_symbol_name(name) {
            TypeId::SYMBOL
        } else {
            self.string_literal(name, false)
        };
        self.applicable_index_info(members, key_type)
    }

    /// `findIndexInfo`, with the value type instantiated for `members`: the index signature with
    /// exactly that key type. `string` is applicable to `string & {}` but isn't the same type.
    pub fn find_index_info(
        &mut self,
        members: &Members<'p>,
        key_type: TypeId,
    ) -> Option<IndexInfo> {
        let members = &self.structured(*members);
        let mut infos = members.index_infos().iter();
        let found = *infos.find(|info| info.key == key_type)?;
        Some(IndexInfo {
            value: self.instantiate(found.value, members.mapper),
            ..found
        })
    }

    /// `findApplicableIndexInfo`, with the value type instantiated for `members`.
    pub fn applicable_index_info(
        &mut self,
        members: &Members<'p>,
        key_type: TypeId,
    ) -> Option<IndexInfo> {
        let members = &self.structured(*members);
        // The string index signature applies only if no other does.
        let mut string_index_info = None;
        let mut applicable: SmallVec<[&IndexInfo; 4]> = SmallVec::new();
        for info in members.index_infos() {
            if info.key == TypeId::STRING {
                string_index_info = Some(info);
            } else if self.is_applicable_index_type(key_type, info.key) {
                applicable.push(info);
            }
        }
        let found = match applicable[..] {
            [] => string_index_info
                .filter(|_| self.is_applicable_index_type(key_type, TypeId::STRING))?,
            [only] => only,
            // Together they form one index signature without a declaration. It is readonly only if
            // all of them are.
            _ => {
                let types: SmallVec<[TypeId; 4]> = applicable
                    .iter()
                    .map(|info| self.instantiate(info.value, members.mapper))
                    .collect();
                let is_readonly = applicable.iter().all(|info| info.readonly);
                return Some(IndexInfo::new(
                    TypeId::UNKNOWN,
                    self.intersection(&types),
                    is_readonly,
                ));
            }
        };
        Some(IndexInfo {
            value: self.instantiate(found.value, members.mapper),
            ..*found
        })
    }

    /// `isApplicableIndexType`
    pub(super) fn is_applicable_index_type(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_assignable(source, target)
            || target == TypeId::STRING && self.is_assignable(source, TypeId::NUMBER)
            || target == TypeId::NUMBER
                && (self.is_numeric_string_type(source)
                    || matches!(*self.data(source), TypeData::StringLit { value, .. } | TypeData::EnumLit { value: EnumValue::String(value), .. }
                        if self.is_numeric_name(value)))
    }

    /// `numericStringType`: `${number}`
    pub fn is_numeric_string_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Template { texts, types } if types[..] == [TypeId::NUMBER] && texts.iter().all(|&t| t == known::empty))
    }

    /// `isNumericLiteralName`: the name round-trips through a number and back to a string.
    pub fn is_numeric_name(&self, name: Atom) -> bool {
        self.atoms().is_numeric_name(name)
    }

    /// The call or construct signatures of `ty`.
    pub fn signatures(&mut self, ty: TypeId, construct: bool) -> List<'p, SigId> {
        let stored_signatures = match construct {
            true => self.p.construct_signatures.get_ref(&self.task, &ty),
            false => self.p.call_signatures.get_ref(&self.task, &ty),
        };
        if let Some(known) = stored_signatures {
            let known: &'p [SigId] = known;
            return List::Permanent(known);
        }
        let scope = self.begin_scope();
        let signatures = self.signatures_uncached(ty, construct);
        let ended = self.end_scope_by_counters(scope);
        // A type whose members are in place doesn't have its signatures yet (`shape_memo_or`).
        if self.declared_index_infos_in_progress.is_empty()
            && let Ok(stored) = ended
        {
            let signatures = signatures.into();
            let known: &'p [SigId] = match construct {
                true => {
                    (self.p.construct_signatures)
                        .insert_ref(&self.task, ty, signatures, stored)
                        .1
                }
                false => {
                    (self.p.call_signatures)
                        .insert_ref(&self.task, ty, signatures, stored)
                        .1
                }
            };
            return List::Permanent(known);
        }
        List::Own(signatures.to_vec())
    }

    /// `resolveUnionTypeMembers`: the call signatures, the construct signatures and the index
    /// signatures of the union `ty` are resolved together, by the first request for any of them.
    /// For `meanwhile`, see `shape_memo_or`.
    fn resolve_union_type_members(
        &mut self,
        ty: TypeId,
        meanwhile: impl FnOnce(&mut Self) -> Shape<'s>,
    ) -> Members<'p> {
        let built = self.shape_memo_or(
            ty,
            |c| {
                // `t.Types()` are in the order of `CompareTypes`.
                let parts = c.parts(ty);
                Shape {
                    call: vec_from_iter_in(c.signatures_of_union(parts, false), c.arena),
                    construct: vec_from_iter_in(c.signatures_of_union(parts, true), c.arena),
                    index: vec_from_iter_in(c.union_index_infos(parts), c.arena),
                    ..Shape::new_in(c.arena)
                }
            },
            meanwhile,
        );
        Members {
            resolved: built.resolved,
            mapper: MapperId::IDENTITY,
        }
    }

    /// The members that `resolveUnionTypeMembers` has set for the union `ty`
    /// (`ObjectFlagsMembersResolved`). Resolves nothing.
    pub(super) fn resolved_union_type_members(&self, ty: TypeId) -> Option<Members<'p>> {
        let resolved = self.p.shapes.get_ref(&self.task, &ty)?;
        Some(Members {
            resolved,
            mapper: MapperId::IDENTITY,
        })
    }

    fn signatures_uncached(&mut self, ty: TypeId, construct: bool) -> Vec<SigId, &'s Arena> {
        // `getReducedApparentType`: an intersection that reduces to `never` has no signatures.
        let ty = self.reduced_apparent_type(ty);
        // `resolveUnionTypeMembers`: cached per union. Combining the signatures of many members is
        // quadratic in them.
        if self.is_union(ty) {
            let resolved = self.resolve_union_type_members(ty, |c| Shape::new_in(c.arena));
            return if construct {
                resolved.resolved.shape.construct.to_vec_in(self.arena)
            } else {
                resolved.resolved.shape.call.to_vec_in(self.arena)
            };
        }
        let Some(members) = self.structured_members(ty) else {
            return Vec::new_in(self.arena);
        };
        let sigs = if construct {
            members.construct_signatures()
        } else {
            members.call_signatures()
        };
        let mut instantiated = Vec::with_capacity_in(sigs.len(), self.arena);
        instantiated.extend(
            sigs.iter()
                .map(|&s| self.instantiate_sig(s, members.mapper)),
        );
        instantiated
    }

    /// `getUnionSignatures`, over the signatures of each of `parts`.
    fn signatures_of_union(&mut self, parts: &[TypeId], construct: bool) -> Vec<SigId> {
        let mut lists = Vec::with_capacity(parts.len());
        for &part in parts.iter() {
            // `unknownSignature`: `Function` itself is callable without arguments, and returns
            // the error type.
            let sigs = if !construct
                && self
                    .is_global_ref(part, known::Function, 0)
                    .is_some_and(|args| args.is_empty())
            {
                vec![self.types().intern_sig(SigData::Synth {
                    type_params: ArenaBox::empty(),
                    params: ArenaBox::empty(),
                    ret: TypeId::ERROR,
                    this: None,
                    of: ArenaBox::empty(),
                    is_union: true,
                })]
            } else {
                self.signatures(part, construct).into_vec()
            };
            if sigs.is_empty() {
                return Vec::new();
            }
            lists.push(sigs);
        }
        let sigs = self.union_signatures(&lists);
        if sigs.is_empty() && !construct {
            self.array_member_call_signatures(parts)
        } else {
            sigs
        }
    }

    /// `getArrayMemberCallSignatures`: a method of `A[] | B[]` whose signatures can't be unified is
    /// called as the method of `(A | B)[]`. `parts` are the members of the method's union type.
    fn array_member_call_signatures(&mut self, parts: &[TypeId]) -> Vec<SigId> {
        let mut method = None;
        let mut elements = Vec::with_capacity(parts.len());
        let mut readonly = false;
        for &part in parts {
            // An instantiation of a member of the global `Array` or `ReadonlyArray`, the same in all.
            let TypeData::Fns { decls, mapper } = self.data(part) else {
                return Vec::new();
            };
            let Some(&(file, func)) = decls.first() else {
                return Vec::new();
            };
            let (hir, bound) = (self.hir(file), self.bound(file));
            let FnOwner::Member(member) = bound.fns[func.idx()].owner else {
                return Vec::new();
            };
            // `isArrayOrTupleSymbol(t.symbol.Parent)`, `isReadonlyArraySymbol(t.symbol.Parent)`
            let Some(owner) = self.symbol_of_member_owner(file, member) else {
                return Vec::new();
            };
            let is_readonly = Some(owner) == self.global_type_of_arity(known::ReadonlyArray, 1);
            if !is_readonly && Some(owner) != self.global_type_of_arity(known::Array, 1) {
                return Vec::new();
            }
            let name = self.declared_member_name(file, hir[member].key);
            if name.is_none() || *method.get_or_insert(name) != name {
                return Vec::new();
            }
            // The type argument for the type parameter of the array in that member.
            let [param] = self.local_type_params_of_symbol(owner)[..] else {
                return Vec::new();
            };
            match self.types().map(*mapper, param) {
                Some(element) if element != param => elements.push(element),
                _ => return Vec::new(),
            }
            readonly |= is_readonly;
        }
        let Some(Some(name)) = method else {
            return Vec::new();
        };
        let element = self.union(&elements);
        let array = self.array_as(element, readonly, FirstRequest::NONE);
        match self.type_of_property(array, name) {
            Some(method) => self.signatures(method, false).into_vec(),
            None => Vec::new(),
        }
    }

    /// `getUnionSignatures`: the signatures of a union type, from the signature lists of its
    /// members.
    pub(super) fn union_signatures(&mut self, lists: &[Vec<SigId>]) -> Vec<SigId> {
        // If all lists are equal each signature is used as is, except one whose parameters match
        // those of an earlier one.
        if lists.iter().all(|l| *l == lists[0]) {
            let mut result: Vec<SigId> = Vec::with_capacity(lists[0].len());
            for &sig in &lists[0] {
                let earlier = self.find_matching_signature(
                    &result,
                    sig,
                    PartialMatch::No,
                    IgnoreReturnTypes::Yes,
                );
                if earlier.is_none() {
                    result.push(sig);
                }
            }
            return result;
        }
        let mut result: Vec<SigId> = Vec::new();
        let mut index_with_overloads = 0;
        let mut count_with_overloads = 0;
        for (i, list) in lists.iter().enumerate() {
            if list.len() > 1 {
                index_with_overloads = i;
                count_with_overloads += 1;
            }
            for &sig in list {
                // Only signatures whose parameters don't match a result yet.
                let earlier = self.find_matching_signature(
                    &result,
                    sig,
                    PartialMatch::No,
                    IgnoreReturnTypes::Yes,
                );
                if earlier.is_some() {
                    continue;
                }
                let Some(matching) = self.find_matching_signatures(lists, sig, i) else {
                    continue;
                };
                if let [_] = matching[..] {
                    result.push(sig);
                    continue;
                }
                // `this` must satisfy the `this` type of every one of them.
                let mut required_this_types = Vec::new();
                for &m in &matching {
                    required_this_types.extend(self.sig_this_type(m));
                }
                let this = if required_this_types.is_empty() {
                    None
                } else {
                    Some(self.intersection(&required_this_types))
                };
                let params = self.sig_params(sig);
                // `createUnionSignature`: a clone of `sig`, which comes first.
                let mut of = vec![sig];
                of.extend(matching.iter().copied().filter(|&m| m != sig));
                result.push(self.types().intern_sig(SigData::Synth {
                    type_params: ArenaBox::empty(),
                    params: self.list(&params),
                    ret: TypeId::UNRESOLVED,
                    this,
                    of: self.list(&of),
                    is_union: true,
                }));
            }
        }
        if !result.is_empty() || count_with_overloads > 1 {
            return result;
        }
        // No signature matches in all members. If at most one member has overloads, each overload
        // is combined with the signatures of the others.
        let mut results = lists[index_with_overloads].clone();
        for (i, list) in lists.iter().enumerate() {
            if i == index_with_overloads {
                continue;
            }
            let sig = list[0];
            let type_params = self.sig_type_params(sig);
            if !type_params.is_empty() {
                let sig_outer_mapper = self.outer_mapper_of_sig(sig);
                for &r in &results {
                    let others = self.sig_type_params(r);
                    if others.is_empty() {
                        continue;
                    }
                    let other_outer_mapper = self.outer_mapper_of_sig(r);
                    if !self.type_parameters_identical_with_outer_mappers(
                        &type_params,
                        sig_outer_mapper,
                        &others,
                        other_outer_mapper,
                    ) {
                        return Vec::new();
                    }
                }
            }
            for r in &mut results {
                *r = self.combine_member_signatures(*r, sig, true);
            }
        }
        results
    }

    /// `findMatchingSignatures`
    fn find_matching_signatures(
        &mut self,
        lists: &[Vec<SigId>],
        sig: SigId,
        list_index: usize,
    ) -> Option<Vec<SigId>> {
        if !self.sig_type_params(sig).is_empty() {
            // For a generic signature only an identical one matches, and it is taken from the first
            // list.
            if list_index > 0 {
                return None;
            }
            for list in &lists[1..] {
                self.find_matching_signature(list, sig, PartialMatch::No, IgnoreReturnTypes::No)?;
            }
            return Some(vec![sig]);
        }
        let mut result = Vec::with_capacity(lists.len());
        for (i, list) in lists.iter().enumerate() {
            let matching = if i == list_index {
                sig
            } else {
                let ignore_return_types = IgnoreReturnTypes::Yes;
                let exact =
                    self.find_matching_signature(list, sig, PartialMatch::No, ignore_return_types);
                match exact {
                    Some(exact) => exact,
                    // Failing that, one with fewer parameters matches.
                    None => self.find_matching_signature(
                        list,
                        sig,
                        PartialMatch::Yes,
                        ignore_return_types,
                    )?,
                }
            };
            if !result.contains(&matching) {
                result.push(matching);
            }
        }
        Some(result)
    }

    /// `findMatchingSignature`
    fn find_matching_signature(
        &mut self,
        list: &[SigId],
        sig: SigId,
        partial_match: PartialMatch,
        ignore_return_types: IgnoreReturnTypes,
    ) -> Option<SigId> {
        let mut compare_types: fn(&mut Self, TypeId, TypeId) -> Ternary = match partial_match {
            PartialMatch::Yes => Self::compare_types_subtype_of,
            PartialMatch::No => Self::compare_types_identical,
        };
        list.iter().copied().find(|&s| {
            self.compare_signatures_identical(
                s,
                sig,
                partial_match,
                IgnoreThisTypes::No,
                ignore_return_types,
                &mut compare_types,
            )
            .holds()
        })
    }

    /// `compareTypesIdentical`
    pub(super) fn compare_types_identical(&mut self, s: TypeId, t: TypeId) -> Ternary {
        Ternary::of(self.is_identical(s, t))
    }

    /// `compareTypesSubtypeOf`
    fn compare_types_subtype_of(&mut self, s: TypeId, t: TypeId) -> Ternary {
        Ternary::of(self.is_subtype(s, t))
    }

    /// `compareSignaturesIdentical`
    pub(super) fn compare_signatures_identical(
        &mut self,
        mut source: SigId,
        target: SigId,
        partial_match: PartialMatch,
        ignore_this_types: IgnoreThisTypes,
        ignore_return_types: IgnoreReturnTypes,
        compare_types: &mut dyn FnMut(&mut Self, TypeId, TypeId) -> Ternary,
    ) -> Ternary {
        if source == target {
            return Ternary::TRUE;
        }
        let (sp, tp) = (self.sig_params(source), self.sig_params(target));
        // `isMatchingSignature`
        let (source_least, target_least) =
            (self.min_argument_count(&sp), self.min_argument_count(&tp));
        let same_shape = self.parameter_count(&sp) == self.parameter_count(&tp)
            && source_least == target_least
            && self.has_effective_rest_parameter(&sp) == self.has_effective_rest_parameter(&tp);
        if !same_shape && !(partial_match == PartialMatch::Yes && source_least <= target_least) {
            return Ternary::FALSE;
        }
        let (source_type_params, target_type_params) =
            (self.sig_type_params(source), self.sig_type_params(target));
        if source_type_params.len() != target_type_params.len() {
            return Ternary::FALSE;
        }
        let (source_outer_mapper, target_outer_mapper) = if target_type_params.is_empty() {
            (MapperId::IDENTITY, MapperId::IDENTITY)
        } else {
            (
                self.outer_mapper_of_sig(source),
                self.outer_mapper_of_sig(target),
            )
        };
        if source_type_params != target_type_params || source_outer_mapper != target_outer_mapper {
            // The constraint and the default of a declared type parameter are instantiated in the
            // same step in which it is renamed.
            let renaming = self.mapper_from(&source_type_params, &target_type_params);
            let mut pairs = self.types().mapping(source_outer_mapper).to_vec();
            pairs.extend(
                source_type_params
                    .iter()
                    .copied()
                    .zip(target_type_params.iter().copied()),
            );
            let renaming_as_declared = self.types().mapper(pairs);
            for (&s, &t) in source_type_params.iter().zip(&target_type_params) {
                if s == t && source_outer_mapper == target_outer_mapper {
                    continue;
                }
                let source_mapper = if self.is_declared_type_param(s) {
                    renaming_as_declared
                } else {
                    renaming
                };
                let target_mapper = if self.is_declared_type_param(t) {
                    target_outer_mapper
                } else {
                    MapperId::IDENTITY
                };
                let a = self.constraint_or_unknown_from_type_param(s);
                let a = self.instantiate(a, source_mapper);
                let b = self.constraint_or_unknown_from_type_param(t);
                let b = self.instantiate(b, target_mapper);
                if !compare_types(self, a, b).holds() {
                    return Ternary::FALSE;
                }
                // `getDefaultOrUnknownFromTypeParameter`
                let a = self.default_of_type_param(s).unwrap_or(TypeId::UNKNOWN);
                let a = self.instantiate(a, source_mapper);
                let b = self.default_of_type_param(t).unwrap_or(TypeId::UNKNOWN);
                let b = self.instantiate(b, target_mapper);
                if !compare_types(self, a, b).holds() {
                    return Ternary::FALSE;
                }
            }
            if source_type_params != target_type_params {
                source =
                    self.with_own_type_params(source, &source_type_params, &target_type_params);
            }
        }
        let mut result = Ternary::TRUE;
        if ignore_this_types == IgnoreThisTypes::No
            && let (Some(s), Some(t)) = (self.sig_this_type(source), self.sig_this_type(target))
        {
            result &= compare_types(self, s, t);
        }
        let (mut sp, mut tp) = (self.sig_params(source), tp);
        let is_open = [&sp, &tp].map(|params| matches!(params, List::Own(_)));
        for i in 0..self.parameter_count(&tp) {
            // `getTypeAtPosition` pushes the type resolution of the parameter, the source's first.
            // Whatever `sig_params` couldn't store, it computed behind its barrier (`eager`).
            if result.holds() && is_open[0] {
                sp = self.sig_params_up_to(source, i + 1);
            }
            if result.holds() && is_open[1] {
                tp = self.sig_params_up_to(target, i + 1);
            }
            let s = self.param_type_at(&sp, i).unwrap_or(TypeId::ANY);
            let t = self.param_type_at(&tp, i).unwrap_or(TypeId::ANY);
            if !result.holds() {
                return result;
            }
            result &= compare_types(self, t, s);
        }
        if ignore_return_types == IgnoreReturnTypes::Yes || !result.holds() {
            return result;
        }
        match (self.sig_predicate(source), self.sig_predicate(target)) {
            (None, None) => {
                let (s, t) = (self.sig_return(source), self.sig_return(target));
                result & compare_types(self, s, t)
            }
            // `compareTypePredicatesIdentical`
            (Some(s), Some(t)) if s.param == t.param && s.asserts == t.asserts => {
                match (s.ty, t.ty) {
                    (Some(a), Some(b)) => result & compare_types(self, a, b),
                    (None, None) => result,
                    _ => Ternary::FALSE,
                }
            }
            _ => Ternary::FALSE,
        }
    }

    /// `getConstraintOrUnknownFromTypeParameter`: a circular constraint is used as written.
    fn constraint_or_unknown_from_type_param(&mut self, param: TypeId) -> TypeId {
        self.constraint_of_type_param(param)
            .or_else(|| self.constraint_from_type_param(param))
            .unwrap_or(TypeId::UNKNOWN)
    }

    /// The mapper for the outer type parameters of `sig` at the type where it was found. The type
    /// parameters of a method are already instantiated with it (`cloneTypeParameter`). A class's
    /// type parameters, which are also those of its construct signatures, aren't recreated, so
    /// their constraints and defaults are read through this mapper.
    pub(super) fn outer_mapper_of_sig(&mut self, sig: SigId) -> MapperId {
        match *self.types().sig(sig) {
            SigData::Decl { mapper, .. }
            | SigData::Construct { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. } => mapper,
            SigData::WithReturn { sig: inner, .. } => self.outer_mapper_of_sig(inner),
            // The type parameters of a union signature are those of the first constituent signature
            // that has any.
            SigData::Synth { ref of, .. } => {
                for &part in of.iter() {
                    if !self.sig_type_params(part).is_empty() {
                        return self.outer_mapper_of_sig(part);
                    }
                }
                MapperId::IDENTITY
            }
        }
    }

    /// True if `param` is a declared type parameter, not a clone created for the type where its
    /// signature was found.
    fn is_declared_type_param(&self, param: TypeId) -> bool {
        matches!(
            *self.data(param),
            TypeData::TypeParam(_, _, MapperId::IDENTITY)
        )
    }

    /// `compareTypeParametersIdentical`
    pub(super) fn type_parameters_identical(
        &mut self,
        source: &[TypeId],
        target: &[TypeId],
    ) -> bool {
        self.type_parameters_identical_with_outer_mappers(
            source,
            MapperId::IDENTITY,
            target,
            MapperId::IDENTITY,
        )
    }

    /// The same for the type parameters of signatures whose outer type parameters are mapped by
    /// `source_outer_mapper` and `target_outer_mapper`.
    fn type_parameters_identical_with_outer_mappers(
        &mut self,
        source: &[TypeId],
        source_outer_mapper: MapperId,
        target: &[TypeId],
        target_outer_mapper: MapperId,
    ) -> bool {
        if source.len() != target.len() {
            return false;
        }
        // The constraint of a declared type parameter is instantiated in the same step in which it
        // is renamed.
        let renaming = self.mapper_from(target, source);
        let mut pairs = self.types().mapping(target_outer_mapper).to_vec();
        pairs.extend(target.iter().copied().zip(source.iter().copied()));
        let renaming_as_declared = self.types().mapper(pairs);
        for (&s, &t) in source.iter().zip(target) {
            if s == t && source_outer_mapper == target_outer_mapper {
                continue;
            }
            let sc = self.constraint_or_unknown_from_type_param(s);
            let sc = if self.is_declared_type_param(s) {
                self.instantiate(sc, source_outer_mapper)
            } else {
                sc
            };
            let tc = self.constraint_or_unknown_from_type_param(t);
            let tc = self.instantiate(
                tc,
                if self.is_declared_type_param(t) {
                    renaming_as_declared
                } else {
                    renaming
                },
            );
            if !self.is_identical(sc, tc) {
                return false;
            }
        }
        true
    }

    /// `combineUnionOrIntersectionParameters`. Each parameter is a new symbol with a name and no declaration.
    fn combine_union_or_intersection_parameters(
        &mut self,
        left: &[SigParam],
        right: &[SigParam],
        is_union: bool,
    ) -> Vec<SigParam> {
        let (left_count, right_count) = (self.parameter_count(left), self.parameter_count(right));
        let (longest_count, longest, shorter) = if left_count >= right_count {
            (left_count, left, right)
        } else {
            (right_count, right, left)
        };
        let either_has_rest =
            self.has_effective_rest_parameter(left) || self.has_effective_rest_parameter(right);
        let needs_extra_rest = either_has_rest && !self.has_effective_rest_parameter(longest);
        // `minArgumentCount`: the greater of the two as declared, where a rest parameter counts as
        // zero, tuple or not. Here the optionality of the parameters determines the minimum
        // argument count.
        let least = Self::min_args(left).max(Self::min_args(right));
        let mut params = Vec::with_capacity(longest_count + 1);
        for i in 0..longest_count {
            // `tryGetTypeAtPosition`: a missing parameter counts as `unknown`.
            let a = self.param_type_at(longest, i).unwrap_or(TypeId::UNKNOWN);
            let b = self.param_type_at(shorter, i).unwrap_or(TypeId::UNKNOWN);
            let combined = if is_union {
                self.intersection(&[a, b])
            } else {
                self.union(&[a, b])
            };
            let is_rest = either_has_rest && !needs_extra_rest && i == longest_count - 1;
            let left_name = if i < left_count {
                self.parameter_name_at_position(left, i)
            } else {
                known::empty
            };
            let right_name = if i < right_count {
                self.parameter_name_at_position(right, i)
            } else {
                known::empty
            };
            let name = if left_name == right_name || right_name == known::empty {
                left_name
            } else if left_name == known::empty {
                right_name
            } else {
                known::empty
            };
            let name = if name == known::empty {
                self.atoms().intern(format!("arg{i}").as_bytes())
            } else {
                name
            };
            params.push(SigParam {
                name,
                ty: if is_rest {
                    self.array_of(combined)
                } else {
                    combined
                },
                optional: !is_rest && i >= least,
                is_required_rest: is_rest && i < least,
                rest: is_rest,
                declaration: None,
            });
        }
        if needs_extra_rest {
            let element = self
                .param_type_at(shorter, longest_count)
                .unwrap_or(TypeId::ANY);
            params.push(SigParam {
                name: known::args,
                ty: self.array_of(element),
                optional: false,
                is_required_rest: false,
                rest: true,
                declaration: None,
            });
        }
        params
    }

    /// `combineUnionOrIntersectionMemberSignatures`: for a union, parameters are intersected and
    /// return types are unioned. For an intersection it's the reverse.
    pub(super) fn combine_member_signatures(
        &mut self,
        left: SigId,
        right: SigId,
        is_union: bool,
    ) -> SigId {
        let (left_type_params, right_type_params) =
            (self.sig_type_params(left), self.sig_type_params(right));
        // `composite.signatures` has `right` unchanged, because `sig_return` applies `paramMapper`.
        let composite_member = right;
        let right = if !left_type_params.is_empty()
            && !right_type_params.is_empty()
            && left_type_params != right_type_params
        {
            self.with_own_type_params(right, &right_type_params, &left_type_params)
        } else {
            right
        };
        let type_params = if left_type_params.is_empty() {
            right_type_params
        } else {
            left_type_params
        };
        let (mut lp, mut rp) = (self.sig_params(left), self.sig_params(right));
        // `tryGetTypeAtPosition` pushes the type resolution of every parameter. Whatever
        // `sig_params` couldn't store, it computed behind its barrier (`eager`).
        if matches!(lp, List::Own(_)) {
            lp = self.sig_params_up_to(left, usize::MAX);
        }
        if matches!(rp, List::Own(_)) {
            rp = self.sig_params_up_to(right, usize::MAX);
        }
        let params = self.combine_union_or_intersection_parameters(&lp, &rp, is_union);
        // `combineUnionOrIntersectionThisParam`: like a parameter.
        let this = match (self.sig_this_type(left), self.sig_this_type(right)) {
            (Some(l), Some(r)) => Some(if is_union {
                self.intersection(&[l, r])
            } else {
                self.union(&[l, r])
            }),
            (l, r) => l.or(r),
        };
        // `left.composite != nil && left.composite.isUnion`, regardless of `is_union`.
        let mut of: Vec<SigId> = match self.types().sig(left) {
            SigData::Synth {
                of: members,
                is_union: true,
                ..
            } if members.len() > 1 => members.to_vec(),
            _ => vec![left],
        };
        of.push(composite_member);
        self.types().intern_sig(SigData::Synth {
            type_params: self.list(&type_params),
            params: self.list(&params),
            ret: TypeId::UNRESOLVED,
            this,
            of: self.list(&of),
            is_union,
        })
    }
}

/// `GetContainerFlags(node)&ContainerFlagsIsContainer != 0` for a node of that kind.
fn is_container(kind: Kind) -> bool {
    kind.is_function_like()
        || kind.is_class_like()
        || matches!(
            kind,
            Kind::EnumDeclaration
                | Kind::ObjectLiteralExpression
                | Kind::TypeLiteral
                | Kind::JsxAttributes
                | Kind::InterfaceDeclaration
                | Kind::ModuleDeclaration
                | Kind::TypeAliasDeclaration
                | Kind::JSTypeAliasDeclaration
                | Kind::MappedType
                | Kind::SourceFile
                | Kind::ClassStaticBlockDeclaration
        )
}

/// `declaration` as an assignment or `Object.defineProperty` call, with its file. `None` if it's
/// neither.
pub(super) fn assignment_declaration(
    (file, declaration): (FileId, Decl),
) -> Option<(FileId, ExprId)> {
    match declaration {
        Decl::Expando(e)
        | Decl::ThisProperty(e)
        | Decl::ModuleExports(e)
        | Decl::ExportsProperty(e) => Some((file, e)),
        _ => None,
    }
}

/// `assignment_declaration`, if it's in `file`.
fn assignment_declaration_in(file: FileId, declaration: (FileId, Decl)) -> Option<ExprId> {
    match assignment_declaration(declaration)? {
        (of, e) if of == file => Some(e),
        _ => None,
    }
}

/// The `declarations` that are members of classes, interfaces and type literals.
pub(super) fn members_among(declarations: &[(FileId, Decl)]) -> SmallVec<[(FileId, MemberId); 2]> {
    let member = |&(file, decl): &(FileId, Decl)| match decl {
        Decl::Member(m) => Some((file, m)),
        _ => None,
    };
    declarations.iter().filter_map(member).collect()
}

/// The facts `createUnionOrIntersectionProperty` gathers about the symbols it combines.
struct Combined {
    /// The types of the distinct symbols, in member order. Empty if there's only one symbol.
    types: SmallVec<[TypeId; 4]>,
    /// The flags that at least one symbol has.
    some: PropFlags,
    /// The flags that all symbols have.
    every: PropFlags,
    is_non_uniform: bool,
    has_literal: bool,
    /// `build_intersection_shape` ignores one of the symbols when it decides whether the property is optional.
    has_non_member_symbol: bool,
}

/// The result of `Checker::may_have_never_reduced_property`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum NeverReduced {
    No,
    Yes,
    /// Only the intersection's shape can tell, because a property is private in a member, or isn't a member symbol.
    NeedsShape,
}

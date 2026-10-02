//! What is in an object type: properties, signatures, index signatures.

use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, SymbolId};
use crate::table::Handle;
use crate::util::group_by_key;
use smallvec::{SmallVec, smallvec};

/// Where the properties of a list are, by name. It is for more than `FEW` of them: fewer are gone through one by one.
#[derive(Default)]
struct Names {
    /// 0, or the position of a property plus one. There are a power of two of them, at least twice as many as properties.
    places: Box<[u32]>,
}

impl Names {
    const FEW: usize = 8;

    /// With nothing in it, and room for `count` properties.
    fn with_room_for(count: usize) -> Names {
        Names {
            places: vec![0; (count * 2).next_power_of_two()].into_boxed_slice(),
        }
    }

    fn of(props: &[Prop]) -> Names {
        if props.len() <= Self::FEW {
            return Names::default();
        }
        let mut names = Names::with_room_for(props.len());
        names.add_all(props);
        names
    }

    #[inline]
    fn first_place(&self, name: Atom) -> usize {
        (u64::from(name.0).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 32) as usize
            & (self.places.len() - 1)
    }

    /// The position of the first of `props` called `name`. All of `props` have been added.
    #[inline]
    fn find(&self, props: &[Prop], name: Atom) -> Option<usize> {
        let mut place = self.first_place(name);
        loop {
            let at = (self.places[place] as usize).checked_sub(1)?;
            if props[at].name == name {
                return Some(at);
            }
            place = (place + 1) & (self.places.len() - 1);
        }
    }

    /// Adds `props[at]`, unless one of its name is there.
    fn add(&mut self, props: &[Prop], at: usize) {
        let name = props[at].name;
        let mut place = self.first_place(name);
        while let Some(other) = (self.places[place] as usize).checked_sub(1) {
            if props[other].name == name {
                return;
            }
            place = (place + 1) & (self.places.len() - 1);
        }
        self.places[place] = at as u32 + 1;
    }

    fn add_all(&mut self, props: &[Prop]) {
        for at in 0..props.len() {
            self.add(props, at);
        }
    }
}

pub struct Resolved {
    pub shape: Shape,
    names: Names,
}

impl Resolved {
    fn new(shape: Shape) -> Resolved {
        Resolved {
            names: Names::of(&shape.props),
            shape,
        }
    }

    #[inline]
    pub(super) fn bytes(&self) -> usize {
        size_of::<Resolved>()
            + self.shape.props.capacity() * size_of::<Prop>()
            + (self.shape.call.capacity() + self.shape.construct.capacity()) * 4
            + self.shape.index.capacity() * size_of::<IndexInfo>()
            + self.names.places.len() * 4
            + self
                .shape
                .props
                .iter()
                .map(|p| match &p.source {
                    PropSource::Members(MemberList::Many(m)) => 16 + m.len() * 8,
                    PropSource::Assigned(_, e) => 16 + e.len() * 4,
                    PropSource::Intersected(_, props) => 16 + props.len() * size_of::<Prop>(),
                    _ => 0,
                })
                .sum::<usize>()
    }

    #[inline]
    pub fn prop(&self, name: Atom) -> Option<&Prop> {
        let props = &self.shape.props;
        if props.len() > Names::FEW {
            return self.names.find(props, name).map(|at| &props[at]);
        }
        props.iter().find(|p| p.name == name)
    }
}

/// The contents of a type: a shape that instantiations share, and what this one puts for the type parameters.
#[derive(Copy, Clone)]
pub struct Members<'p> {
    pub resolved: &'p Resolved,
    pub mapper: MapperId,
}

impl<'p> Members<'p> {
    #[inline]
    pub fn shape(&self) -> &'p Shape {
        &self.resolved.shape
    }
}

pub(super) const RECENT_MEMBERS: usize = 512;
pub(super) const RECENT_SIGNATURES: usize = 256;
pub(super) const RECENT_PROPS: usize = 256;

/// A type, and what `Program::members` has for it.
#[derive(Copy, Clone)]
pub(super) struct RecentMembers<'p> {
    resolved: Option<&'p Resolved>,
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

/// `Members` the way it is kept for a type: where the shape is, and the mapper.
#[derive(Copy, Clone)]
pub(super) struct KeptMembers {
    shape: Handle,
    mapper: MapperId,
}

impl crate::local::MaybeLocal for KeptMembers {
    #[inline]
    fn is_local(&self) -> bool {
        self.shape.is_local() || self.mapper.is_local()
    }
}

impl crate::table::Packed for KeptMembers {
    type Cell = std::sync::atomic::AtomicU64;
    #[inline]
    fn pack(self) -> u64 {
        (u64::from(self.shape.0) + 1) << 32 | u64::from(self.mapper.0)
    }
    #[inline]
    fn unpack(raw: u64) -> Self {
        KeptMembers {
            shape: Handle((raw >> 32) as u32 - 1),
            mapper: MapperId(raw as u32),
        }
    }
}

/// A shape, and where it is kept if it holds for good.
#[derive(Copy, Clone)]
struct Built<'p> {
    resolved: &'p Resolved,
    kept: Option<Handle>,
}

/// What answers when a type is asked for a name.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Found {
    Property,
    /// A property that is private or protected.
    Restricted,
    /// There is no such property: an index signature stands in for it.
    ByIndex,
}

/// What is done with the property a type is asked for (`getAssignmentTargetKind`, `accessKind`).
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Access {
    Read,
    /// It is the target of an assignment, but not written to and nothing else: `a.b ||= c`, `[...a.b] = c`.
    Assigned,
    /// `IsWriteOnlyAccess`
    Written,
}

/// Whether it is an object type that a property access looks into as it stands: any but a mapped type.
#[inline]
fn is_plain_object(data: &TypeData) -> bool {
    match data {
        TypeData::Ref { .. }
        | TypeData::Tuple { .. }
        | TypeData::Fns { .. }
        | TypeData::Synth(_)
        | TypeData::ReverseMapped { .. } => true,
        TypeData::Anon { origin, .. } => !matches!(origin, Origin::Mapped(..)),
        _ => false,
    }
}

/// Collects properties by name, in the order they are first seen.
#[derive(Default)]
struct Builder {
    shape: Shape,
    /// Where each property is, while there are more than `Names::FEW`. Nothing is in it otherwise.
    names: Names,
    /// The keys of the index signatures that computed names implied.
    implied: Vec<TypeId>,
}

impl Builder {
    /// Where the property `name` is.
    #[inline]
    fn position(&self, name: Atom) -> Option<usize> {
        if self.shape.props.len() <= Names::FEW {
            return self.shape.props.iter().position(|p| p.name == name);
        }
        self.names.find(&self.shape.props, name)
    }
    #[inline]
    fn has(&self, name: Atom) -> bool {
        self.position(name).is_some()
    }
    /// Makes room for `more` properties.
    fn reserve(&mut self, more: usize) {
        self.shape.props.reserve_exact(more);
        let all = self.shape.props.len() + more;
        if all > Names::FEW && all * 2 > self.names.places.len() {
            self.make_room_for_names(all);
        }
    }
    /// `names` anew, with room for `count` properties.
    fn make_room_for_names(&mut self, count: usize) {
        self.names = Names::with_room_for(count);
        if self.shape.props.len() > Names::FEW {
            self.names.add_all(&self.shape.props);
        }
    }
    fn add(&mut self, prop: Prop) {
        match self.position(prop.name) {
            Some(i) => self.shape.props[i] = prop,
            None => self.add_new(prop),
        }
    }
    /// Adds a property whose name is not there yet.
    fn add_new(&mut self, prop: Prop) {
        self.shape.props.push(prop);
        let count = self.shape.props.len();
        if count <= Names::FEW {
            return;
        }
        if count * 2 > self.names.places.len() {
            self.make_room_for_names(count * 2);
        } else if count == Names::FEW + 1 {
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
        // What came after it has moved.
        if self.shape.props.len() >= Names::FEW {
            self.names.places.fill(0);
            if self.shape.props.len() > Names::FEW {
                self.names.add_all(&self.shape.props);
            }
        }
    }
}

impl<'p> Checker<'p> {
    /// `ty` if it is not a reference to an alias that was still being worked out when it was made. A deferred type reference has
    /// its type arguments afterwards, unless they are being resolved.
    #[inline]
    pub fn force(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::LazyAlias { .. } => self.force_reference(ty),
            TypeData::Deferred(_) => self.force_deferred_reference(ty),
            TypeData::Union(_) | TypeData::Intersection(_)
                if self.p.types.flags(ty).contains(TypeFlags::HAS_LAZY_MEMBER) =>
            {
                self.force_members(ty)
            }
            _ => ty,
        }
    }

    /// `force`, of a union or an intersection with such references among its members. tsgo resolves the type arguments of a
    /// deferred type reference before it makes anything of them (`getTypeArguments`), so the members of a union that an alias
    /// stands for are members of the union it is put in. A reference to an array, a tuple, an instance or an indexed access
    /// stays: these do not say which alias they are the body of, and the reference is what they are named by.
    #[inline(never)]
    fn force_members(&mut self, ty: TypeId) -> TypeId {
        let (parts, is_union) = match self.data(ty) {
            TypeData::Union(parts) => (parts, true),
            TypeData::Intersection(parts) => (parts, false),
            _ => return ty,
        };
        let mut forced: SmallVec<[TypeId; 8]> = SmallVec::from_slice(&parts[..]);
        for part in &mut forced {
            let resolved = self.force(*part);
            if self.is_known(resolved)
                && !matches!(
                    self.data(resolved),
                    TypeData::Ref { .. } | TypeData::Tuple { .. } | TypeData::IndexedAccess { .. }
                )
            {
                *part = resolved;
            }
        }
        if forced[..] == parts[..] {
            return ty;
        }
        if is_union {
            self.union(&forced)
        } else {
            self.intersection(&forced)
        }
    }

    /// `force`, of a reference to an alias.
    fn force_reference(&mut self, ty: TypeId) -> TypeId {
        self.guard("force");
        match self.data(ty) {
            TypeData::LazyAlias { sym, args } => {
                if self.stack.contains(&Query::Declared(*sym)) {
                    return ty;
                }
                // `instantiate` marks the object of an indexed access that waits on an alias.
                self.note_depth(Deep::Instantiation(ty, MapperId::IDENTITY), None);
                let alias = self
                    .stored_alias(ty)
                    .map(|(alias, type_arguments)| (*alias, &type_arguments[..]));
                self.type_reference_type(*sym, args, alias)
            }
            _ => ty,
        }
    }

    /// `force`, of a deferred type reference without type arguments. Whoever only hands it on does not need them: where they are
    /// being resolved no circle is closed, and what is made of it holds for now only.
    #[cold]
    #[inline(never)]
    fn force_deferred_reference(&mut self, ty: TypeId) -> TypeId {
        let from = self.resolution_start;
        let under_way = self.stack[from..]
            .iter()
            .rposition(|q| *q == Query::TypeArguments(ty));
        match under_way {
            Some(i) => {
                self.mark_tainted_from(from + i + 1);
                self.cycles += 1;
            }
            None => self.resolve_type_arguments(ty),
        }
        ty
    }

    /// `getTypeArguments`, of a deferred type reference that has none. It is left without if they are being resolved further
    /// down, which is a circle, or if there is no time or room.
    #[cold]
    #[inline(never)]
    pub(super) fn resolve_type_arguments(&mut self, ty: TypeId) {
        self.resolve_type_arguments_worker(ty);
        self.settle_deferred_references();
    }

    fn resolve_type_arguments_worker(&mut self, ty: TypeId) {
        let Some(reference) = self.p.types.deferred(ty) else {
            return;
        };
        let (file, node, mapper, target) = (
            reference.file,
            reference.node,
            reference.mapper,
            reference.target,
        );
        if reference.is_resolved() || !self.enter(Query::TypeArguments(ty)) {
            return;
        }
        let declared = self.type_reference_from_node(file, node, target);
        let holds = self.leave();
        if self.left_a_circle {
            // `popTypeResolution` fails: `errorType` for all of `n.TypeParameters()`, those around the declaration too.
            let errors = |count: usize| vec![TypeId::ERROR; count].into_boxed_slice();
            let resolved = match self.data(declared).clone() {
                TypeData::Ref { target, args } => TypeData::Ref {
                    target,
                    args: errors(args.len()),
                },
                TypeData::Tuple {
                    elems,
                    flags,
                    readonly,
                } => TypeData::Tuple {
                    elems: errors(elems.len()),
                    flags,
                    readonly,
                },
                _ => return,
            };
            self.p.types.resolve_deferred(ty, resolved);
            return;
        }
        if !holds {
            return;
        }
        // `c.instantiateTypes(typeArguments, d.mapper)`
        let before = self.what_only_holds_for_now();
        // The query is left, as in `getTypeArguments`, but the node is still under way for `resolve_type_arguments_ahead`.
        self.instantiating_type_arguments_of.push((file, node));
        let resolved = match self.data(declared) {
            TypeData::Ref { target, args } => Some(TypeData::Ref {
                target: *target,
                args: self.instantiate_all(args, mapper).into(),
            }),
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => {
                let elems = self.instantiate_all(elems, mapper);
                let instantiated = self.tuple(&elems, flags, *readonly);
                Some(self.data(instantiated).clone())
            }
            _ => None,
        };
        self.instantiating_type_arguments_of.pop();
        let Some(resolved) = resolved else {
            return;
        };
        let now = self.what_only_holds_for_now();
        // A limit that is run into ahead of need is run into again by whoever needs them, and reported there.
        if now.0 != before.0 || self.deferring_type_arguments > 0 && now.1 != before.1 {
            return;
        }
        self.p.types.resolve_deferred(ty, resolved);
    }

    /// `resolve_type_arguments` before anybody needs them, so that whoever looks at `ty` finds a reference like any other. It is a
    /// question of its own: what is under way does not show, so it closes no circle that need would not close. Where the node is
    /// being resolved already the type goes on for ever (`type R<T> = Box<R<T[]>>`), and `ty` is left for whoever needs it.
    pub(super) fn resolve_type_arguments_ahead(&mut self, ty: TypeId) {
        let Some(reference) = self.p.types.deferred(ty) else {
            return;
        };
        if reference.is_resolved() {
            return;
        }
        let at = (reference.file, reference.node);
        let types = &self.p.types;
        if self.instantiating_type_arguments_of.contains(&at)
            || self.stack.iter().any(|q| {
                matches!(*q, Query::TypeArguments(other)
                if types.deferred(other).is_some_and(|other| (other.file, other.node) == at))
            })
        {
            return;
        }
        let resolution_start = std::mem::replace(&mut self.resolution_start, self.stack.len());
        let instantiation_depth = std::mem::replace(&mut self.instantiation_depth, 0);
        let (events, unreported) = (self.deep_events, self.unreported_event);
        self.deferring_type_arguments += 1;
        // What it leaves unsettled is for whoever drains the list: a chain of aliases is gone through one after the other, not one
        // inside the other.
        self.resolve_type_arguments_worker(ty);
        self.deferring_type_arguments -= 1;
        // The memo entries around do not depend on the limit.
        (self.deep_events, self.unreported_event) = (events, unreported);
        self.instantiation_depth = instantiation_depth;
        self.resolution_start = resolution_start;
    }

    /// `ty` for whoever is not inferring: `NoInfer<T>`, on its own or in a union, is `T`.
    pub(super) fn without_no_infer(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        self.map_type(ty, |c, m| {
            let forced = c.force(m);
            match *c.data(forced) {
                TypeData::Substitution {
                    base,
                    constraint: TypeId::UNKNOWN,
                } => c.force(base),
                _ => m,
            }
        })
    }

    /// `isNoInferType`
    #[inline]
    pub(super) fn is_no_infer(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Substitution { constraint, .. } => *constraint == TypeId::UNKNOWN,
            TypeData::LazyAlias { sym, .. } => self.intrinsic_alias(*sym) == Some(Err(())),
            _ => false,
        }
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
        let is_substitution =
            |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Substitution { .. });
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
            TypeData::LazyAlias { .. } => !self.is_no_infer(ty),
            &TypeData::Substitution { base, constraint } => {
                constraint != TypeId::UNKNOWN && self.is_no_infer_target_type(base)
            }
            _ => {
                self.is_object_type(ty) && !self.is_empty_anonymous_object_type(ty)
                    || self.is_instantiable(ty) && !self.is_pattern_literal(ty)
            }
        }
    }

    fn shape_memo(&mut self, key: TypeId, build: impl FnOnce(&mut Self) -> Shape) -> Built<'p> {
        self.shape_memo_or(key, build, |_| Shape::default())
    }

    /// A shape that does not hold for good. It is there until `release_shapes_for_now`.
    fn shape_for_now(&mut self, shape: Shape) -> Built<'p> {
        let resolved = Box::new(Resolved::new(shape));
        // SAFETY: a box does not move what it holds, and it is dropped by `release_shapes_for_now`, which is only called where no
        // `Members` is around: between files.
        let for_now: &'p Resolved = unsafe { &*std::ptr::from_ref(&*resolved) };
        self.shapes_for_now.push(resolved);
        Built {
            resolved: for_now,
            kept: None,
        }
    }

    /// Nothing that `members` has handed out may be around.
    pub(super) fn release_shapes_for_now(&mut self) {
        debug_assert!(self.stack.is_empty());
        self.shapes_for_now.clear();
    }

    /// `meanwhile`: the answer for whoever asks while `build` is at it.
    fn shape_memo_or(
        &mut self,
        key: TypeId,
        build: impl FnOnce(&mut Self) -> Shape,
        meanwhile: impl FnOnce(&mut Self) -> Shape,
    ) -> Built<'p> {
        if let Some(kept) = self.p.shapes.handle(&key) {
            return Built {
                resolved: self.p.shapes.at(kept),
                kept: Some(kept),
            };
        }
        if !self.enter(Query::Shape(key)) {
            // `enter` also refuses for want of time or room.
            let is_under_way = !self.timed_out
                && !self.is_stack_low()
                && self.stack[self.resolution_start..].contains(&Query::Shape(key));
            let shape = if is_under_way {
                meanwhile(self)
            } else {
                Shape::default()
            };
            return self.shape_for_now(shape);
        }
        let mut shape = build(self);
        if self.leave() {
            if !key.is_local() {
                shape.props.shrink_to_fit();
                shape.call.shrink_to_fit();
                shape.construct.shrink_to_fit();
                shape.index.shrink_to_fit();
            }
            let (kept, resolved) = self.p.shapes.insert_ref(key, Resolved::new(shape));
            return Built {
                resolved,
                kept: Some(kept),
            };
        }
        self.shape_for_now(shape)
    }

    /// The contents of an object type or an intersection of them. `None` for anything else.
    #[inline]
    pub fn members(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let recent = self.recent_members[ty.0 as usize % RECENT_MEMBERS];
        if recent.ty == ty {
            return recent.resolved.map(|resolved| Members {
                resolved,
                mapper: recent.mapper,
            });
        }
        self.members_not_recent(ty)
    }

    /// `members`, of a type that was not asked about lately.
    fn members_not_recent(&mut self, ty: TypeId) -> Option<Members<'p>> {
        if let Some(known) = self.p.members.get(&ty) {
            let resolved = self.p.shapes.at(known.shape);
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
        self.members_to_keep(ty)
    }

    /// `members`, of a type nothing is kept for yet.
    fn members_to_keep(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let (built, mapper) = self.members_uncached(ty)?;
        if let Some(shape) = built.kept {
            self.p.members.insert(ty, KeptMembers { shape, mapper });
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
        self.guard("members");
        match self.data(ty) {
            &TypeData::Substitution { base, constraint } => {
                let both = self.substitution_intersection(base, constraint);
                self.members(both).map(|members| {
                    (
                        Built {
                            resolved: members.resolved,
                            kept: None,
                        },
                        members.mapper,
                    )
                })
            }
            TypeData::Ref { target, args } => {
                let target = *target;
                let declared = self.declared_type(target);
                let TypeData::Ref { args: params, .. } = self.data(declared) else {
                    return None;
                };
                // `resolveTypeReferenceMembers`: the arguments go with the type parameters around the declaration, then its own,
                // then `this`. Where nothing is given for `this` it is the type the member is looked up in.
                let this = args.get(params.len()).copied().unwrap_or(ty);
                let given = if declared == ty {
                    0
                } else {
                    params.len().min(args.len())
                };
                let mut pairs: Vec<(TypeId, TypeId)> = Vec::with_capacity(given + 1);
                pairs.extend(params.iter().copied().zip(args.iter().copied()).take(given));
                pairs.push((self.intern(TypeData::ThisParam(target)), this));
                let mapper = self.p.types.mapper(pairs);
                // All instantiations share what the declared type has, unless what they inherit goes by the type arguments.
                let (key, under) = if declared != ty && self.inherits_from_type_arguments(target) {
                    (ty, mapper)
                } else {
                    (declared, MapperId::IDENTITY)
                };
                // `getResolvedMembersOrExportsOfSymbol`: while the names that have to be worked out are, there is what has its name
                // written out.
                let resolved = self.shape_memo_or(
                    key,
                    |c| c.build_declared_shape(target, under, false),
                    |c| c.build_declared_shape(target, under, true),
                );
                Some((resolved, mapper))
            }
            TypeData::Anon { origin, mapper } => {
                let (origin, mapper) = (*origin, *mapper);
                if let Origin::Mapped(file, node) = origin {
                    let resolved =
                        self.shape_memo(ty, |c| c.build_mapped_shape(file, node, mapper));
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
                let resolved = self.shape_memo(key, |c| c.build_origin_shape(origin));
                Some((
                    resolved,
                    if identity == mapper {
                        MapperId::IDENTITY
                    } else {
                        mapper
                    },
                ))
            }
            TypeData::Fns { decls, mapper } => {
                let mapper = *mapper;
                let identity = self.identity_of(mapper);
                let key = if identity == mapper {
                    ty
                } else {
                    self.intern(TypeData::Fns {
                        decls: decls.clone(),
                        mapper: identity,
                    })
                };
                let resolved = self.shape_memo(key, |c| {
                    let mut shape = Shape::default();
                    for &(file, func) in decls.iter() {
                        let sig = c.sig_of_declaration(file, func);
                        if c.hir(file)[func].kind == FnKind::ConstructorType {
                            shape.construct.push(sig);
                        } else {
                            shape.call.push(sig);
                        }
                    }
                    if let [(file, func)] = decls[..] {
                        shape = c.with_expandos(shape, file, c.bound(file).fn_symbol[func.idx()]);
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
                let resolved = self.shape_memo(ty, |_| (**shape).clone());
                Some((resolved, MapperId::IDENTITY))
            }
            TypeData::ReverseMapped { source, mapped, of } => {
                let (source, mapped, of) = (*source, *mapped, *of);
                let resolved =
                    self.shape_memo(ty, |c| c.build_reverse_mapped_shape(source, mapped, of));
                Some((resolved, MapperId::IDENTITY))
            }
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => {
                let readonly = *readonly;
                let resolved =
                    self.shape_memo(ty, |c| c.build_tuple_shape(ty, elems, flags, readonly));
                Some((resolved, MapperId::IDENTITY))
            }
            TypeData::Intersection(parts) => {
                let resolved = self.shape_memo(ty, |c| c.build_intersection_shape(ty, parts));
                Some((resolved, MapperId::IDENTITY))
            }
            // `resolveTypeReferenceMembers`
            TypeData::Deferred(_) => {
                self.resolve_type_arguments(ty);
                if matches!(self.data(ty), TypeData::Deferred(_)) {
                    return None;
                }
                self.members_uncached(ty)
            }
            _ => None,
        }
    }

    /// The mapper about the same parameters that changes nothing.
    fn identity_of(&mut self, mapper: MapperId) -> MapperId {
        let mapping = self.p.types.mapping(mapper);
        if mapping.iter().all(|p| p.0 == p.1) {
            return mapper;
        }
        self.p
            .types
            .mapper(mapping.iter().map(|p| (p.0, p.0)).collect())
    }

    // ───────────────────────────── building ─────────────────────────────

    fn member_flags(member: &Member) -> PropFlags {
        let mut flags = PropFlags::empty();
        if member.flags.contains(Flags::OPTIONAL) {
            flags |= PropFlags::OPTIONAL;
        }
        if member.flags.contains(Flags::READONLY) {
            flags |= PropFlags::READONLY;
        }
        if member.flags.contains(Flags::PRIVATE) {
            flags |= PropFlags::PRIVATE;
        }
        if member.flags.contains(Flags::PROTECTED) {
            flags |= PropFlags::PROTECTED;
        }
        match member.kind {
            MemberKind::Method => flags |= PropFlags::METHOD,
            MemberKind::Getter | MemberKind::Setter => flags |= PropFlags::ACCESSOR,
            // `bindPropertyWorker`: an `accessor` field is a getter and a setter.
            MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                flags |= PropFlags::ACCESSOR
            }
            _ => {}
        }
        flags
    }

    /// The name of a member, if it has one that is known without running anything. A computed one goes by the type of the
    /// expression alone, as in an object literal or a pattern (`checkComputedPropertyName`, `isTypeUsableAsPropertyName`).
    pub fn member_name(&mut self, file: FileId, key: PropKey) -> Option<Atom> {
        match key {
            PropKey::Name(name) | PropKey::Private(name) => Some(name),
            PropKey::Computed(e) => {
                // `[Symbol.iterator]`, unless `Symbol` is somebody's own: what the global `Symbol` has by that name, without going
                // into the expression. The libraries are full of it.
                let hir = self.hir(file);
                if let ExprKind::Dot { obj, name, .. } = hir[e].kind
                    && matches!(hir[obj].kind, ExprKind::Ident(known::Symbol))
                    && self.bound(file).expr_symbol[obj.idx()].is_none()
                    && let Some(global) = self.files().global(known::Symbol, SymFlags::VALUE)
                {
                    let constructor = self.type_of_symbol(global);
                    if let Some(ty) = self.type_of_property(constructor, name)
                        && let Some(found) = self.property_name_of_type(ty)
                    {
                        return Some(found);
                    }
                }
                let ty = self.type_of_expr(file, e);
                self.property_name_of_type(ty)
            }
            PropKey::None => None,
        }
    }

    /// Whether the computed name `[e]` of a member of a class, an interface or a type literal can name anything: it is a literal,
    /// which the binder goes by (`IsDynamicName`), or written as a name (`isLateBindableAST`).
    pub(super) fn can_name_a_member(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        !is_dynamic_name(hir, e) || is_entity_name_expression(hir, e)
    }

    /// `e.Name()`, of a component of an index signature, and the file it is written in.
    pub(super) fn name_of_index_component(&self, component: IndexComponent) -> (FileId, PropKey) {
        match component {
            IndexComponent::Property(file, p) => (file, self.hir(file)[p].key),
            IndexComponent::Member(file, m) => (file, self.hir(file)[m].key),
        }
    }

    /// The name of a member of a class, an interface or a type literal (`isLateBindableName`).
    pub fn declared_member_name(&mut self, file: FileId, key: PropKey) -> Option<Atom> {
        if let PropKey::Computed(e) = key
            && !self.can_name_a_member(file, e)
        {
            return None;
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
                let mut text = self.files().atoms.bytes(name).to_vec();
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
                Some(self.files().atoms.symbol_name(&text))
            }
            _ => None,
        }
    }

    pub fn number_name(&self, n: f64) -> Atom {
        let text = crate::atom::number_to_string(n);
        self.files().atoms.intern_str(&text)
    }

    /// Adds the members `members` declares (the static ones or the others) to `b`. `early`: only those the binder can name, without
    /// looking at any expression.
    fn add_members(
        &mut self,
        b: &mut Builder,
        file: FileId,
        members: Span<MemberId>,
        want_static: bool,
        mapper: MapperId,
        early: bool,
    ) {
        let hir = self.hir(file);
        // Only a class has a static side (`declareClassMember`): elsewhere the word is an error and changes nothing.
        let has_static_side = !members
            .iter()
            .next()
            .is_some_and(|m| self.is_declared_outside_classes(file, m));
        // Declarations of one name are one property.
        let mut groups: Vec<(Atom, SmallVec<[MemberId; 4]>)> = Vec::new();
        // Those whose name is worked out and could be any string, number or symbol.
        let mut computed: Vec<MemberId> = Vec::new();
        for m in members.iter() {
            let member = &hir[m];
            if (has_static_side && member.flags.contains(Flags::STATIC)) != want_static {
                continue;
            }
            if early && matches!(member.key, PropKey::Computed(_)) {
                continue;
            }
            // `getDeclarationName`: a private name outside every class is `InternalSymbolNameMissing`, and `declareSymbolEx` adds
            // no such symbol to the member table.
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
                        computed.push(m);
                        continue;
                    };
                    match groups.iter_mut().find(|g| g.0 == name) {
                        Some(group) => group.1.push(m),
                        None => groups.push((name, smallvec![m])),
                    }
                }
                MemberKind::CallSignature => {
                    let sig = self.sig_of_fn(file, member.func);
                    b.shape.call.push(self.instantiate_sig(sig, mapper));
                }
                MemberKind::ConstructSignature => {
                    let sig = self.sig_of_fn(file, member.func);
                    b.shape.construct.push(self.instantiate_sig(sig, mapper));
                }
                MemberKind::IndexSignature => {
                    // `getIndexInfosOfIndexSymbol`: one parameter, with a type. Only what can be a key counts, as it is written.
                    let f = &hir[member.func];
                    if f.params.len() != 1 || hir[f.params.at(0)].ty.is_none() {
                        continue;
                    }
                    let keys = self.type_from_node(file, hir[f.params.at(0)].ty);
                    let keys = self.force(keys);
                    let value = if member.ty.is_some() {
                        self.type_from_node(file, member.ty)
                    } else {
                        TypeId::ANY
                    };
                    let value = self.instantiate(value, mapper);
                    for &key in self.parts(keys) {
                        // What is not known is let through.
                        let is_known = self.is_known(key)
                            && !matches!(self.data(key), TypeData::LazyAlias { .. });
                        if is_known && !self.is_valid_index_key_type(key) {
                            continue;
                        }
                        let info = IndexInfo {
                            key,
                            value,
                            readonly: member.flags.contains(Flags::READONLY),
                            declaration: Some((file, m)),
                            components: ComponentsId::NONE,
                        };
                        match b.shape.index.iter().position(|i| i.key == key) {
                            None => b.shape.index.push(info),
                            // The first to speak for a key stays, unless computed names implied it: what is written comes first.
                            Some(at) => {
                                if let Some(implied) = b.implied.iter().position(|&k| k == key) {
                                    b.implied.swap_remove(implied);
                                    b.shape.index[at] = info;
                                }
                            }
                        }
                    }
                }
                MemberKind::Constructor => {
                    if want_static {
                        continue;
                    }
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
                            flags |= PropFlags::OPTIONAL;
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
                        b.add(Prop {
                            name,
                            flags,
                            source: PropSource::Parameter(file, p),
                            mapper,
                        });
                    }
                }
                MemberKind::StaticBlock => {}
            }
        }
        if !computed.is_empty() {
            // `getMembersOfSymbol`: the table of what instances have holds the type parameters, the constructor and the signatures
            // too.
            let has_type_params = match self.bound(file).member_owner[computed[0].idx()] {
                MemberOwner::Class(c) => !hir[c].type_params.is_empty(),
                MemberOwner::Interface(i) => !hir[i].type_params.is_empty(),
                _ => false,
            };
            let has_nameless = |m: MemberId| {
                matches!(
                    hir[m].kind,
                    MemberKind::Constructor
                        | MemberKind::CallSignature
                        | MemberKind::ConstructSignature
                )
            };
            let holds_more = !want_static && (has_type_params || members.iter().any(has_nameless));
            self.add_index_signatures_of_computed_names(
                b, file, &computed, &groups, holds_more, mapper,
            );
        }
        b.reserve(groups.len());
        for (name, group) in groups {
            let mut list: Vec<(FileId, MemberId)> = group.iter().map(|&m| (file, m)).collect();
            let Some(i) = b.position(name) else {
                let flags = self.flags_of_declarations(&list);
                b.add_new(Prop {
                    name,
                    flags,
                    source: PropSource::Members(list.into()),
                    mapper,
                });
                continue;
            };
            // Overloads of a merged interface stay in the order declared; calls reorder them (`reorder_candidates`).
            if let PropSource::Members(existing) = &b.shape.props[i].source
                && b.shape.props[i].mapper == mapper
            {
                list.splice(0..0, existing.iter().copied());
                let flags = self.flags_of_declarations(&list);
                b.add(Prop {
                    name,
                    flags,
                    source: PropSource::Members(list.into()),
                    mapper,
                });
                continue;
            }
            let mut flags = self.flags_of_declarations(&list);
            let earlier = b.shape.props[i].clone();
            if matches!(earlier.source, PropSource::Parameter(..)) {
                b.add(Prop {
                    name,
                    flags,
                    source: PropSource::Members(list.into()),
                    mapper,
                });
                continue;
            }
            // The declarations name their type parameters each for itself, so they cannot be listed together as they are written.
            // The first says what the property is (`SetValueDeclaration`), but for whether it may be left out.
            flags = earlier.flags | flags & PropFlags::OPTIONAL;
            if list
                .iter()
                .all(|&(f, m)| self.hir(f)[m].kind == MemberKind::Method)
            {
                // Of overloads: their signatures, in terms of the parameters of the first.
                let so_far = self.type_of_prop(&earlier, MapperId::IDENTITY);
                let so_far = if earlier.flags.contains(PropFlags::OPTIONAL) {
                    self.without_undefined(so_far)
                } else {
                    so_far
                };
                let later = Prop {
                    name,
                    flags: PropFlags::METHOD,
                    source: PropSource::Members(list.into()),
                    mapper,
                };
                let later_type = self.type_of_prop(&later, MapperId::IDENTITY);
                let mut call = self.signatures(so_far, false).into_vec();
                if !call.is_empty() {
                    call.extend(self.signatures(later_type, false));
                    let ty = self.synth(Shape {
                        call,
                        ..Shape::default()
                    });
                    let ty = if flags.contains(PropFlags::OPTIONAL) {
                        self.optional_property(ty)
                    } else {
                        ty
                    };
                    // One symbol, with the declarations of both.
                    let mut declarations = match Self::value_declaration(&earlier) {
                        Some(PropSource::Members(list)) => list.to_vec(),
                        _ => Vec::new(),
                    };
                    if let PropSource::Members(list) = &later.source {
                        declarations.extend(list.iter().copied());
                    }
                    let declared = Prop {
                        source: PropSource::Members(declarations.into()),
                        ..later
                    };
                    b.add(Prop {
                        name,
                        flags,
                        source: Self::copy_of(ty, &[&declared], true),
                        mapper: MapperId::IDENTITY,
                    });
                    continue;
                }
            }
            b.shape.props[i].flags = flags;
        }
    }

    /// Whether `m` is a member of an interface or of a type literal.
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

    /// What the declarations `list` of one property, in the order they are written, say of it.
    fn flags_of_declarations(&self, list: &[(FileId, MemberId)]) -> PropFlags {
        let kind = |&(f, m): &(FileId, MemberId)| self.hir(f)[m].kind;
        // `getDeclarationModifierFlagsFromSymbol`: the first speaks for all, but of a setter and a getter, the getter.
        let (file, says) = match kind(&list[0]) {
            MemberKind::Setter => list
                .iter()
                .copied()
                .find(|d| kind(d) == MemberKind::Getter)
                .unwrap_or(list[0]),
            _ => list[0],
        };
        let mut flags = Self::member_flags(&self.hir(file)[says]);
        // Only in a class is anything private or protected: elsewhere the word is an error and changes nothing.
        if self.is_declared_outside_classes(file, says) {
            flags.remove(PropFlags::PRIVATE | PropFlags::PROTECTED);
        }
        // `addDeclarationToSymbol`: each declaration adds its flags to the one symbol, so one `?` makes it optional.
        if list
            .iter()
            .any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::OPTIONAL))
        {
            flags |= PropFlags::OPTIONAL;
        }
        if list.iter().all(|d| kind(d) == MemberKind::Setter) {
            flags |= PropFlags::WRITE_ONLY;
        }
        if list.iter().any(|d| kind(d) == MemberKind::Getter)
            && !list.iter().any(|d| kind(d) == MemberKind::Setter)
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

    /// `getTypeOfSymbol(e.Symbol())`, of a component of an index signature.
    pub(super) fn type_of_index_component(&mut self, component: IndexComponent) -> TypeId {
        match component {
            IndexComponent::Property(file, p) => self.type_of_literal_prop(file, p),
            IndexComponent::Member(file, m) => {
                let ty = self.type_of_member_declaration(file, m);
                // What may be left out may be undefined.
                if self.hir(file)[m].flags.contains(Flags::OPTIONAL) {
                    self.optional_property(ty)
                } else {
                    ty
                }
            }
        }
    }

    /// `getIndexInfosOfIndexSymbol`: `[k] = v` with a `k` that is some string, number or symbol says what is found under any of them,
    /// together with the members next to it that go by such a name. `holds_more`: next to it is also something that is no property.
    fn add_index_signatures_of_computed_names(
        &mut self,
        b: &mut Builder,
        file: FileId,
        computed: &[MemberId],
        named: &[(Atom, SmallVec<[MemberId; 4]>)],
        holds_more: bool,
        mapper: MapperId,
    ) {
        let hir = self.hir(file);
        // For strings, numbers and symbols: the values, and whether all that say so can only be read.
        let mut found: [(TypeId, Vec<TypeId>, bool, bool); 3] = [
            (TypeId::STRING, Vec::new(), true, false),
            (TypeId::NUMBER, Vec::new(), true, false),
            (TypeId::SYMBOL, Vec::new(), true, false),
        ];
        // `components`, for each of the three.
        let mut components: [Vec<IndexComponent>; 3] = Default::default();
        for &m in computed {
            let PropKey::Computed(e) = hir[m].key else {
                continue;
            };
            // `isLateBindableIndexSignature`
            if !self.can_name_a_member(file, e) {
                continue;
            }
            let key = self.type_of_expr(file, e);
            if !self.is_known(key) || b.shape.index.iter().any(|i| i.key == key) {
                continue;
            }
            // A key that is neither a number nor a symbol for sure counts as a string.
            let kind = if self.is_assignable(key, TypeId::NUMBER) {
                1
            } else if self.is_assignable(key, TypeId::SYMBOL) {
                2
            } else {
                let any_key = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                if !self.is_assignable(key, any_key) {
                    continue;
                }
                0
            };
            found[kind].3 = true;
            found[kind].2 &= hir[m].flags.contains(Flags::READONLY);
            let value = self.type_of_index_component(IndexComponent::Member(file, m));
            // `getObjectLiteralIndexInfo`: under a string is all that does not go by a symbol (`isSymbolWithSymbolName`), what goes
            // by a number too. An `any` can be a number and a symbol.
            if kind == 1 {
                found[1].1.push(value);
                components[1].push(IndexComponent::Member(file, m));
            }
            let is_symbol = kind == 2 || kind == 1 && self.is_assignable(key, TypeId::SYMBOL);
            found[if is_symbol { 2 } else { 0 }].1.push(value);
            components[if is_symbol { 2 } else { 0 }].push(IndexComponent::Member(file, m));
        }
        if !found.iter().any(|f| f.3) {
            return;
        }
        // `getTypeOfSymbol` of a type parameter, a constructor or a signature is the error type. None goes by a number or a symbol.
        if holds_more {
            found[0].1.push(TypeId::ERROR);
        }
        for (name, group) in named {
            let is_symbol = self.files().atoms.is_symbol_name(*name);
            let is_numeric = self.is_numeric_name(*name);
            if !(found[0].3 && !is_symbol || found[1].3 && is_numeric || found[2].3 && is_symbol) {
                continue;
            }
            let list: Vec<(FileId, MemberId)> = group.iter().map(|&m| (file, m)).collect();
            let prop = Prop {
                name: *name,
                flags: Self::member_flags(&hir[group[0]]),
                source: PropSource::Members(list.into()),
                mapper: MapperId::IDENTITY,
            };
            let value = self.type_of_prop(&prop, MapperId::IDENTITY);
            // `isSymbolWithComputedName`. `["a"]` is kept as a plain name.
            let name_start = super::errors_x_properties_jsx::start_of_member_name(hir, group[0]);
            let has_computed_name = matches!(hir[group[0]].key, PropKey::Computed(_))
                || hir.text.get(name_start as usize) == Some(&b'[');
            let component = has_computed_name.then_some(IndexComponent::Member(file, group[0]));
            if is_symbol {
                found[2].1.push(value);
                components[2].extend(component);
            } else {
                found[0].1.push(value);
                components[0].extend(component);
                if is_numeric {
                    found[1].1.push(value);
                    components[1].extend(component);
                }
            }
        }
        for (kind, (key, values, readonly, is_there)) in found.into_iter().enumerate() {
            if !is_there || b.shape.index.iter().any(|i| i.key == key) {
                continue;
            }
            let value = if values.is_empty() {
                TypeId::UNDEFINED
            } else {
                self.union_reduced(&values)
            };
            let value = self.instantiate(value, mapper);
            b.shape.index.push(IndexInfo {
                key,
                value,
                readonly,
                declaration: None,
                components: self.p.types.intern_components(&components[kind]),
            });
            b.implied.push(key);
        }
    }

    /// `#x`: as renamed for the class that declares it (`#x@<file>.<class>`), or as written where no class around declares it.
    pub(super) fn is_private_name(&self, name: Atom) -> bool {
        self.files().atoms.bytes(name).first() == Some(&b'#')
    }

    /// `SymbolName`: the `#x` of a private name; any other name as it is.
    pub(super) fn written_name(&self, name: Atom) -> &'p [u8] {
        let text = self.files().atoms.bytes(name);
        if text.first() == Some(&b'#') {
            &text[..text.iter().position(|&c| c == b'@').unwrap_or(text.len())]
        } else {
            text
        }
    }

    /// `isStaticPrivateIdentifierProperty`
    pub(super) fn is_static_private_name(&self, prop: &Prop) -> bool {
        matches!(&prop.source, PropSource::Members(list) if list.first().is_some_and(|&(file, m)| {
            let member = &self.hir(file)[m];
            matches!(member.key, PropKey::Private(_)) && member.flags.contains(Flags::STATIC)
        }))
    }

    /// `isSpreadableProperty`: own properties are taken to be what is no method, no accessor and no `#x`, and whatever is not
    /// written in a class.
    pub(super) fn is_spreadable_property(&self, prop: &Prop) -> bool {
        // Whether some declaration is written in a class, and whether some is named `#x`.
        fn written(
            c: &Checker<'_>,
            source: &PropSource,
            in_class: &mut bool,
            is_private: &mut bool,
        ) {
            match source {
                PropSource::Members(list) => {
                    for &(file, m) in list.iter() {
                        *in_class |= matches!(
                            c.bound(file).member_owner[m.idx()],
                            crate::bind::MemberOwner::Class(_)
                        );
                        *is_private |= matches!(c.hir(file)[m].key, PropKey::Private(_));
                    }
                }
                PropSource::Intersected(_, parts) => parts
                    .iter()
                    .for_each(|part| written(c, &part.source, in_class, is_private)),
                _ => {}
            }
        }
        let (mut in_class, mut is_private) = (false, false);
        written(self, &prop.source, &mut in_class, &mut is_private);
        // `createUnionOrIntersectionProperty`: what several members of an intersection have is never a method.
        let kinds = match prop.source {
            PropSource::Intersected(..) => PropFlags::ACCESSOR,
            _ => PropFlags::METHOD | PropFlags::ACCESSOR,
        };
        !in_class || !is_private && !prop.flags.intersects(kinds)
    }

    /// `getTypeWithThisArgument`: `ty` with `this_argument` for `this` in its members. It goes after the type arguments of a
    /// reference, where `members` finds it. An intersection takes it member by member.
    pub(super) fn type_with_this_argument(&mut self, ty: TypeId, this_argument: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Ref { target, args } => {
                let declared = self.declared_type(*target);
                if !matches!(self.data(declared), TypeData::Ref { args: params, .. } if params.len() == args.len())
                {
                    return ty;
                }
                let with_this: Box<[TypeId]> =
                    args.iter().copied().chain([this_argument]).collect();
                self.intern(TypeData::Ref {
                    target: *target,
                    args: with_this,
                })
            }
            TypeData::Intersection(parts) => {
                let with_this: Vec<TypeId> = parts
                    .iter()
                    .map(|&part| self.type_with_this_argument(part, this_argument))
                    .collect();
                if with_this[..] == parts[..] {
                    ty
                } else {
                    self.intersection(&with_this)
                }
            }
            // It has no place to keep the argument (`tuple_members_with_this`). Made anew, it goes by no alias.
            TypeData::Tuple { .. } => self.without_alias_of_reference(ty),
            _ => ty,
        }
    }

    /// `getTypeWithThisArgument` of a tuple, which is a reference like any other but has no place to keep the argument: what it
    /// has, with `this_argument` for `this`. `None`: `ty` is no tuple.
    fn tuple_members_with_this(
        &mut self,
        ty: TypeId,
        this_argument: TypeId,
    ) -> Option<Members<'p>> {
        let TypeData::Tuple {
            elems,
            flags,
            readonly,
        } = self.data(ty)
        else {
            return None;
        };
        if this_argument == ty {
            return self.members(ty);
        }
        let shape = self.build_tuple_shape(this_argument, elems, flags, *readonly);
        Some(Members {
            resolved: self.shape_for_now(shape).resolved,
            mapper: MapperId::IDENTITY,
        })
    }

    /// What `resolveObjectTypeMembers` takes from one base type.
    fn inherit(&mut self, b: &mut Builder, base: TypeId, this: Option<(Sym, TypeId)>) {
        // `anyBaseTypeIndexInfo`
        if base == TypeId::ANY {
            if !b.shape.index.iter().any(|i| i.key == TypeId::STRING) {
                b.shape
                    .index
                    .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
            }
            return;
        }
        // `getPropertiesOfType`, `getSignaturesOfType`, `getIndexInfosOfType`: of `getReducedApparentType`. Of a union, what all
        // its members have.
        let base = self.reduced(base);
        let base = self.apparent_type(base);
        let base = self.reduced(base);
        let base = if self.is_union(base) {
            self.union_as_object(base)
        } else {
            base
        };
        // `this` in an inherited member is the heir.
        let members = match this {
            Some((_, this_param)) => match self.tuple_members_with_this(base, this_param) {
                Some(of_tuple) => Some(of_tuple),
                None => {
                    let base = self.type_with_this_argument(base, this_param);
                    self.members(base)
                }
            },
            None => self.members(base),
        };
        let Some(members) = members else { return };
        let mapper = members.mapper;
        b.reserve(members.shape().props.len());
        // The mapper of the last property that had one of its own, and that followed by `mapper`.
        let mut composed = (MapperId::IDENTITY, mapper);
        for prop in &members.shape().props {
            if b.has(prop.name) {
                continue;
            }
            let mut prop = prop.clone();
            match &mut prop.source {
                PropSource::Type(t) | PropSource::Copy(t, ..) => *t = self.instantiate(*t, mapper),
                _ => {
                    if prop.mapper != composed.0 {
                        composed = (prop.mapper, self.compose(prop.mapper, mapper));
                    }
                    prop.mapper = composed.1;
                }
            }
            b.add_new(prop);
        }
        for &sig in &members.shape().call {
            let sig = self.instantiate_sig(sig, mapper);
            b.shape.call.push(sig);
        }
        for &sig in &members.shape().construct {
            let sig = self.instantiate_sig(sig, mapper);
            b.shape.construct.push(sig);
        }
        for info in &members.shape().index {
            if b.shape.index.iter().any(|i| i.key == info.key) {
                continue;
            }
            let value = self.instantiate(info.value, mapper);
            b.shape.index.push(IndexInfo { value, ..*info });
        }
    }

    /// Whether "the members of a base type, instantiated" are not "the members of the instantiated base type" for the class or
    /// interface `sym`: a base type is a type parameter (`isValidBaseType`), or an instantiation of such a class or interface with
    /// something generic.
    fn inherits_from_type_arguments(&mut self, sym: Sym) -> bool {
        for &base in self.base_types(sym).iter() {
            let parts: &[TypeId] = match self.data(base) {
                TypeData::Intersection(parts) => &parts[..],
                _ => std::slice::from_ref(&base),
            };
            for &part in parts {
                let goes_by_arguments = match *self.data(part) {
                    TypeData::TypeParam(..) => true,
                    TypeData::Ref { target, .. } => {
                        target != sym
                            && self.has_type_variables(part)
                            && self.inherits_from_type_arguments(target)
                    }
                    _ => false,
                };
                if goes_by_arguments {
                    return true;
                }
            }
        }
        false
    }

    /// The instances of a class or an interface, in terms of its own type parameters. `under`: what those stand for in the base types.
    /// `early`: as far as the binder can name its members.
    fn build_declared_shape(&mut self, sym: Sym, under: MapperId, early: bool) -> Shape {
        let mut b = Builder::default();
        for (file, decl) in self.files().decls(sym) {
            let hir = self.hir(file);
            let (members, params) = match decl {
                Decl::Class(c) => (hir[c].members, hir[c].type_params),
                Decl::Interface(i) => (hir[i].members, hir[i].type_params),
                _ => continue,
            };
            if !self.is_declaration_of_symbol(sym, file, decl) {
                continue;
            }
            let mapper = self.decl_params_mapper(sym, file, params);
            self.add_members(&mut b, file, members, false, mapper, early);
            if let Decl::Class(c) = decl {
                self.add_this_properties(&mut b, file, c, false);
            }
        }
        let this = self.intern(TypeData::ThisParam(sym));
        let bases = self.base_types(sym);
        let own = b.shape.props.len();
        for base in bases.iter().copied() {
            let base = self.instantiate(base, under);
            self.inherit(&mut b, base, Some((sym, this)));
        }
        // `getNamedMembers`: what is declared here, then what is inherited, each in the order of `compareSymbols`.
        let ranges = if own < b.shape.props.len() {
            self.ranges_of_declarations(sym)
        } else {
            Vec::new()
        };
        self.get_named_members(&mut b.shape.props, |i| i < own, &ranges);
        b.shape
    }

    /// `getNamedMembers`: `props` in the order TypeScript keeps the properties of a resolved type in. What the declarations of a class or
    /// an interface contain comes first, then the rest, each in the order of `compareSymbols`: by where the first declaration is, what
    /// has none last, by name. `is_contained`: whether the property at a position is known to be contained. Of the others
    /// `isDeclarationContainedBy` is asked, with `ranges`. For what is no class or interface everything is.
    pub(super) fn get_named_members(
        &mut self,
        props: &mut Vec<Prop>,
        is_contained: impl Fn(usize) -> bool,
        ranges: &[(u32, u32)],
    ) {
        if props.len() < 2 {
            return;
        }
        let atoms = &self.files().atoms;
        let mut keyed = Vec::with_capacity(props.len());
        for (i, prop) in std::mem::take(props).into_iter().enumerate() {
            let is_outside =
                !is_contained(i) && !self.is_within_ranges_of_declarations(&prop, ranges);
            let (nowhere, file, pos) = self.order_of_property(&prop);
            let place = self.place_in_program_order(file, pos);
            keyed.push(((is_outside, nowhere, place, atoms.bytes(prop.name)), prop));
        }
        keyed.sort_by(|x, y| x.0.cmp(&y.0));
        props.extend(keyed.into_iter().map(|entry| entry.1));
    }

    /// `Loc` of each declaration of the class or interface `sym`.
    fn ranges_of_declarations(&self, sym: Sym) -> Vec<(u32, u32)> {
        let mut ranges = Vec::new();
        for (file, decl) in self.files().decls(sym) {
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

    /// `isDeclarationContainedBy`: whether `symbol.ValueDeclaration` of `prop` lies within one of `ranges`. Only positions are
    /// compared, whatever files they are in.
    fn is_within_ranges_of_declarations(&self, prop: &Prop, ranges: &[(u32, u32)]) -> bool {
        let is_near = |pos: u32| ranges.iter().any(|&(from, to)| from <= pos && pos < to);
        let (start, end) = match Self::value_declaration(prop) {
            Some(PropSource::Parameter(file, parameter)) => {
                let pos = self.hir(*file)[*parameter].pos;
                if !is_near(pos) {
                    return false;
                }
                (
                    self.hir(*file)[*parameter].loc.pos,
                    self.end_of_param(*file, *parameter),
                )
            }
            Some(PropSource::Members(list)) => {
                let Some(&(file, member)) = list.first() else {
                    return false;
                };
                if !is_near(self.hir(file)[member].pos) {
                    return false;
                }
                let loc = self.hir(file)[member].loc;
                (loc.pos, loc.end)
            }
            _ => return false,
        };
        ranges.iter().any(|&(from, to)| from <= start && end <= to)
    }

    /// `declareSymbolEx`: a class or an interface that is refused the name is listed with what has it, and is a symbol of its own.
    fn is_declaration_of_symbol(&self, sym: Sym, file: FileId, decl: Decl) -> bool {
        let bound = self.bound(file);
        let own = match decl {
            Decl::Class(c) => bound.class_symbol[c.idx()],
            Decl::Interface(i) => bound.interface_symbol[i.idx()],
            _ => return true,
        };
        let whole = self.files().canonical(sym);
        own.is_none() || self.files().parts(whole).contains(&Sym { file, id: own })
    }

    /// The declaration of class `sym` that says what it extends.
    fn extending_declaration(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        self.files()
            .decls(sym)
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

    /// `getBaseConstructorTypeOfClass`: the type of the expression that class `class` extends. `undefined` if it extends nothing, the
    /// error type if the expression depends on the class (2506) or is of a type that cannot be constructed (2507).
    pub(super) fn base_constructor_type_of_class(&mut self, class: Sym) -> TypeId {
        if let Some(known) = self.p.base_constructor_types.get(&class) {
            return known;
        }
        let Some((file, c)) = self.extending_declaration(class) else {
            return self
                .p
                .base_constructor_types
                .insert(class, TypeId::UNDEFINED);
        };
        if !self.enter(Query::BaseConstructor(class)) {
            return if self.came_full_circle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
        }
        let uncertain = self.uncertain;
        let constructor = self.type_of_expr(file, self.hir(file)[c].extends);
        let constructor = self.force(constructor);
        // `resolveStructuredTypeMembers`: the members of a class take its base constructor type, so a circle shows now.
        let _ = self.members(constructor);
        self.uncertain = uncertain;
        let holds = self.leave();
        if self.left_a_circle {
            // `GetErrorRangeForNode`: the name, or the first token of a class expression without one.
            let declaration = &self.hir(file)[c];
            let start = if declaration.name.is_some() {
                declaration.name_pos
            } else {
                declaration.pos
            };
            let at = (file, start, self.end_of_token_at(file, start));
            let err = self.new_diagnostic(at, 2506, &[Arg::Sym(class)]);
            self.commit(err);
            return self.p.base_constructor_types.insert(class, TypeId::ERROR);
        }
        // `nullWideningType`, which is `nullType` under `strictNullChecks`.
        let ty = if constructor == TypeId::NULL
            || constructor.is_null() && self.p.files.options.strict_null_checks
        {
            TypeId::NULL
        } else if !self.is_known(constructor)
            || self.has_any_flag(constructor)
            || self.is_constructor_type(constructor)
        {
            constructor
        } else {
            if holds && let Some(at) = self.place_to_report_base_at(file, c) {
                // Printing the type may ask for the base constructor type.
                self.p.base_constructor_types.insert(class, TypeId::ERROR);
                let mut err = self.new_diagnostic(at, 2507, &[Arg::Type(constructor)]);
                if let TypeData::TypeParam(of, tp, _) = *self.data(constructor) {
                    let constraint = self.constraint_of_type_param(constructor);
                    let first = constraint.and_then(|t| self.signatures(t, true).first().copied());
                    let returned = first.map_or(TypeId::UNKNOWN, |sig| self.sig_return(sig));
                    let at = self.place_of_type_parameter_declaration(of, tp);
                    let args = [Arg::Atom(self.hir(of)[tp].name), Arg::Type(returned)];
                    let related = self.new_diagnostic(at, 2735, &args);
                    err.add_related_info(related);
                }
                self.commit(err);
            }
            TypeId::ERROR
        };
        // What was settled meanwhile stands.
        if holds {
            return self.p.base_constructor_types.insert(class, ty);
        }
        self.p.base_constructor_types.get(&class).unwrap_or(ty)
    }

    /// `classDeclarationExtendsNull`
    pub(super) fn class_declaration_extends_null(&mut self, class: Sym) -> bool {
        self.base_constructor_type_of_class(class) == TypeId::NULL
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

    /// `resolveAnonymousTypeMembers`: whether the base constructor type of class `sym` is `any` itself.
    fn extends_any(&mut self, sym: Sym) -> bool {
        let Some((file, c)) = self.extending_declaration(sym) else {
            return false;
        };
        self.base_constructor_type_of_class(sym) == TypeId::ANY
            && !self.is_uncertain(file, self.hir(file)[c].extends)
    }

    fn sigs_of_function_declarations(&mut self, sym: Sym) -> Vec<SigId> {
        let decls: Vec<(FileId, FnId)> = self
            .files()
            .decls(sym)
            .into_iter()
            .filter_map(|(file, d)| match d {
                Decl::Fn(f) => Some((file, f)),
                _ => None,
            })
            .collect();
        let mut sigs = Vec::with_capacity(decls.len());
        for (i, &(file, f)) in decls.iter().enumerate() {
            // `getSignaturesOfSymbol`: one with a body right after another declaration of the function implements those before it.
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

    /// `getSignaturesOfSymbol`, of two methods of one name or two constructors: whether `m` is "the implementation of an overloaded
    /// function", which is no signature itself. It "has a body and the previous node is of the same kind and immediately precedes"
    /// it: "has the same parent and ends where the implementation starts", or is made of an `@overload` tag.
    fn is_implementation_after(&self, file: FileId, previous: MemberId, m: MemberId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        has_body(&hir[hir[m].func])
            && bound.member_owner[previous.idx()] == bound.member_owner[m.idx()]
            && (hir[m].loc.pos == hir[previous].loc.end
                || hir[previous].flags.contains(Flags::REPARSED))
    }

    /// The same of two declarations of a function, but for the body.
    fn is_next_statement(&self, file: FileId, previous: FnId, f: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (FnOwner::Stmt(before), FnOwner::Stmt(s)) =
            (bound.fns[previous.idx()].owner, bound.fns[f.idx()].owner)
        else {
            return false;
        };
        bound.stmt_parent[before.idx()] == bound.stmt_parent[s.idx()]
            && (hir[s].loc.pos == hir[before].loc.end
                || hir[previous].flags.contains(Flags::REPARSED))
    }

    /// Whether `ty` is an instantiation of `sym`, whichever, or extends one: `class C<T> extends C<T[]>` extends nothing.
    pub(super) fn has_base(&mut self, ty: TypeId, sym: Sym, depth: u32) -> bool {
        match self.data(ty).clone() {
            TypeData::Ref { target, .. } => {
                target == sym
                    || depth < 32
                        && self
                            .base_types(target)
                            .to_vec()
                            .into_iter()
                            .any(|b| self.has_base(b, sym, depth + 1))
            }
            TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.has_base(p, sym, depth + 1))
            }
            _ => false,
        }
    }

    /// `getBaseTypes`: what a class or an interface extends, in terms of its own type parameters.
    pub fn base_types(&mut self, sym: Sym) -> Arc<[TypeId]> {
        if let Some(known) = self.p.base_types.get(&sym) {
            return known;
        }
        if !self.enter(Query::Bases(sym)) {
            return Arc::from([]);
        }
        let mut bases = Vec::new();
        // `resolveBaseTypesOfClass`: what the class extends comes first, wherever it is written.
        if let Some((file, c)) = self.extending_declaration(sym) {
            let mapper = self.decl_params_mapper(sym, file, self.hir(file)[c].type_params);
            let base = self.base_instance_type(sym, file, c);
            let base = self.instantiate(base, mapper);
            let extending = (file, Decl::Class(c));
            let valid = self.as_base_type(base, extending, |checker, reduced, unreduced| {
                let Some(at) = checker.place_to_report_base_at(file, c) else {
                    return;
                };
                let chain = checker.elaborate_never_intersection(None, at, unreduced);
                let args = [Arg::Type(reduced)];
                let diagnostic = checker.new_diagnostic_chain(chain, at, 2509, &args);
                checker.add_diagnostic(diagnostic);
            });
            if let Some(base) = valid {
                if !self.has_base(base, sym, 0) {
                    bases.push(base);
                } else if let Some(err) = self.circular_base_type(sym, file, Decl::Class(c)) {
                    self.add_diagnostic(err);
                }
            }
        }
        // `resolveBaseTypesOfInterface`
        for (file, decl) in self.files().decls(sym) {
            let Decl::Interface(i) = decl else { continue };
            let hir = self.hir(file);
            let interface = &hir[i];
            let mapper = self.decl_params_mapper(sym, file, interface.type_params);
            for node in hir.ids(interface.extends) {
                // A base that is no `A.B<C>` has the error type (2499), which is skipped.
                if matches!(
                    hir[node].kind,
                    TypeNodeKind::Error | TypeNodeKind::Heritage(_)
                ) {
                    continue;
                }
                let base = self.type_from_node(file, node);
                let base = self.instantiate(base, mapper);
                let valid = self.as_base_type(base, (file, decl), |checker, _, _| {
                    let at = (file, hir[node].pos, checker.end_of_type_node(file, node));
                    checker.error(at, 2312, &[]);
                });
                let Some(base) = valid else { continue };
                if !self.has_base(base, sym, 0) {
                    if !bases.contains(&base) {
                        bases.push(base);
                    }
                } else if let Some(err) = self.circular_base_type(sym, file, decl) {
                    self.add_diagnostic(err);
                }
            }
        }
        let bases: Arc<[TypeId]> = bases.into();
        let holds = self.leave();
        let in_a_circle = self.left_a_circle;
        let bases = if holds {
            self.p.base_types.insert(sym, bases)
        } else {
            bases
        };
        // `popTypeResolution`: they were asked for again while they were worked out. Every class declaration and every interface of
        // the name is told, whichever of them extends what.
        if in_a_circle {
            for (file, decl) in self.files().decls(sym) {
                let is_declaration = match decl {
                    Decl::Class(c) => matches!(
                        self.bound(file).class_owner[c.idx()],
                        crate::bind::ClassOwner::Stmt(_)
                    ),
                    _ => true,
                };
                if is_declaration && let Some(err) = self.circular_base_type(sym, file, decl) {
                    self.commit(err);
                }
            }
        }
        bases
    }

    /// What `reportCircularBaseType` reports at the class or interface `declaration` of `sym`.
    fn circular_base_type(
        &mut self,
        sym: Sym,
        file: FileId,
        declaration: Decl,
    ) -> Option<Reported> {
        let hir = self.hir(file);
        // `GetErrorRangeForNode`
        let start = match declaration {
            Decl::Class(c) if hir[c].name.is_some() => hir[c].name_pos,
            Decl::Class(c) => hir[c].pos,
            Decl::Interface(i) => hir[i].name_pos,
            _ => return None,
        };
        let at = (file, start, self.end_of_token_at(file, start));
        let ty = self.declared_type(sym);
        Some(self.new_diagnostic(at, 2310, &[Arg::Type(ty)]))
    }

    /// `getReducedType`, `isErrorType`, `isValidBaseType`: `base` as a base type of the class or interface whose base types are being
    /// worked out, if it can be one. `extending`: the declaration that says it extends it. `report`: told one that cannot, reduced
    /// and as it was.
    fn as_base_type(
        &mut self,
        base: TypeId,
        extending: (FileId, Decl),
        report: impl FnOnce(&mut Self, TypeId, TypeId),
    ) -> Option<TypeId> {
        let base = self.force(base);
        let unreduced = base;
        // `isGenericMappedType`: what a mapped type ranges over has to be known, and `keyof Y` takes the members of `Y`, which
        // take its base types. `getResolvedBaseConstraint`: a circle that comes of it goes through the key.
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
                let was_in_a_circle = self.is_innermost_in_a_circle();
                self.mapped_constraint(file, node, mapper);
                if !was_in_a_circle && self.is_innermost_in_a_circle() {
                    self.report_circular_mapped_key(file, node, extending);
                }
            }
        }
        let base = self.reduced(base);
        // `is_valid_base_type` lets pass what could not be worked out. Only an object type with such a part is listed.
        let is_worked_out = self.is_known(base)
            || self.is_object_type(base)
            || matches!(self.data(base), TypeData::Intersection(_));
        if !is_worked_out || self.is_error_type(base) {
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

    /// `baseTypeNode.Expression()` of class `c`. `None`: nothing is to be said of it, `checkSourceFile` never comes there or its
    /// type is a guess.
    fn place_to_report_base_at(&self, file: FileId, c: ClassId) -> Option<(FileId, u32, u32)> {
        let extends = self.hir(file)[c].extends;
        if self.bound(file).is_unchecked(extends.idx()) || self.is_uncertain(file, extends) {
            return None;
        }
        Some((
            file,
            self.start_of(file, extends),
            self.end_of_expr(file, extends),
        ))
    }

    /// `baseType` of `resolveBaseTypesOfClass`: the type of the instances of what class `sym` extends. `c`: its
    /// `extending_declaration`.
    fn base_instance_type(&mut self, sym: Sym, file: FileId, c: ClassId) -> TypeId {
        let hir = self.hir(file);
        let class = &hir[c];
        let args = self.types_from_nodes(file, class.extends_args);
        let constructor = self.base_constructor_type_of_class(sym);
        // `baseType = baseConstructorType`
        if self.has_any_flag(constructor) {
            return if self.is_uncertain(file, class.extends) {
                TypeId::UNRESOLVED
            } else {
                constructor
            };
        }
        // `areAllOuterTypeParametersApplied`, asked of the declared type: a class declared inside something generic is gone
        // through by its construct signatures.
        if let TypeData::Anon {
            origin: Origin::ClassStatic(base),
            ..
        } = *self.data(constructor)
            && self.outer_type_params_of_symbol(base).is_empty()
        {
            let (least, most) = self.type_argument_arity(base);
            // `getTypeFromClassOrInterfaceReference`: for a generic class referenced from a JavaScript file, a wrong type argument
            // count does not give the error type, and `fillMissingTypeArguments` supplies the missing arguments.
            if hir.is_js && most > 0 {
                let params = self.type_params_of_symbol(base);
                let filled = self.fill_type_args_as(&params, &args, true);
                return self.type_reference(base, &filled);
            }
            // Otherwise a wrong type argument count gives the error type, and the class has no base type.
            if args.len() < least || args.len() > most {
                return TypeId::ERROR;
            }
            return self.type_reference(base, &args);
        }
        let sigs = self.signatures(constructor, true);
        match self
            .constructors_taking(&sigs, &args, hir.is_js, false)
            .first()
        {
            Some(&sig) => self.sig_return(sig),
            None => {
                let apparent = self.apparent_type(constructor);
                if (self.is_object_type(apparent) || self.is_intersection(apparent))
                    && self.is_known(apparent)
                    && args.iter().all(|&arg| self.is_known(arg))
                    && let Some(at) = self.place_to_report_base_at(file, c)
                {
                    self.error(at, 2508, &[]);
                }
                TypeId::UNRESOLVED
            }
        }
    }

    /// `getInstantiatedConstructorsForTypeArguments`: the signatures in `sigs` that accept `args.len()` type arguments,
    /// instantiated with `args`. `is_js`: the `extends` clause is in a JavaScript file, so `fillMissingTypeArguments` fills with
    /// `any`. `any_arity`: skip the type argument count check, as `getDefaultConstructSignatures` does for a JavaScript class.
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

    /// Whether the base constructor type of `class` has any construct signature, and its construct signatures instantiated with
    /// the type arguments of the `extends` clause. `for_default_constructor` selects them as `getDefaultConstructSignatures`
    /// does. Otherwise they are selected as `getInstantiatedConstructorsForTypeArguments` does.
    fn base_constructors(
        &mut self,
        class: Sym,
        for_default_constructor: bool,
    ) -> (bool, Vec<SigId>) {
        let Some((file, c)) = self.extending_declaration(class) else {
            return (false, Vec::new());
        };
        let hir = self.hir(file);
        let args = self.types_from_nodes(file, hir[c].extends_args);
        let constructor = self.base_constructor_type_of_class(class);
        let sigs = self.signatures(constructor, true);
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

    /// `getRegularTypeOfObjectLiteral`
    pub(super) fn regular_type_of_object_literal(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            &TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, is_js_literal, of_declaration, true),
                mapper,
            } => self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, is_js_literal, of_declaration, false),
                mapper,
            }),
            TypeData::Synth(shape) if shape.literal.is_of_expression() && !shape.is_regular => {
                let mut shape = Shape::clone(shape);
                shape.is_regular = true;
                for prop in &mut shape.props {
                    prop.flags |= PropFlags::REGULAR;
                }
                self.synth(shape)
            }
            _ => ty,
        }
    }

    fn build_origin_shape(&mut self, origin: Origin) -> Shape {
        let mut b = Builder::default();
        // What `get_named_members` is told. Only the static side of a class has a container.
        let mut contained = [0..usize::MAX, 0..0];
        let mut ranges = Vec::new();
        match origin {
            Origin::TypeLiteral(file, node) => {
                if let TypeNodeKind::Object(members) = self.hir(file)[node].kind {
                    self.add_members(&mut b, file, members, false, MapperId::IDENTITY, false);
                }
            }
            Origin::ObjectLiteral(file, expr, .., is_fresh) => {
                let mut shape = self.build_object_literal_shape(file, expr);
                if !is_fresh {
                    for prop in &mut shape.props {
                        prop.flags |= PropFlags::REGULAR;
                    }
                }
                return shape;
            }
            Origin::WidenedLiteral(file, expr, ..) => {
                let mut shape = self.build_object_literal_shape(file, expr);
                // `getWidenedProperty`: methods and accessors stay as they are.
                for prop in &mut shape.props {
                    if !prop
                        .flags
                        .intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
                    {
                        prop.flags |= PropFlags::WIDEN;
                    }
                }
                // `getWidenedTypeOfObjectLiteral`: what an index signature gives is widened like a property.
                for info in &mut shape.index {
                    info.value = self.regular_object(info.value);
                }
                return shape;
            }
            Origin::ClassStatic(sym) => {
                let mut has_constructor = false;
                let mut is_abstract = false;
                let mut outer = MapperId::IDENTITY;
                for (file, decl) in self.files().decls(sym) {
                    let Decl::Class(c) = decl else { continue };
                    if !self.is_declaration_of_symbol(sym, file, decl) {
                        continue;
                    }
                    let hir = self.hir(file);
                    is_abstract |= hir[c].flags.contains(Flags::ABSTRACT);
                    // `resolveAnonymousTypeMembers` instantiates the signatures with what the type parameters around the class stand
                    // for too, and `instantiate_sig` only carries on what the mapper of a signature is about.
                    let scope = self.bound(file).class_scope[c.idx()];
                    if scope.is_some() {
                        let parent = self.bound(file).scopes[scope.idx()].parent;
                        outer = self.identity_mapper(file, parent);
                    }
                    let members = hir[c].members;
                    self.add_members(&mut b, file, members, true, MapperId::IDENTITY, false);
                    self.add_this_properties(&mut b, file, c, true);
                    if hir.is_js && file == sym.file {
                        self.add_expandos(&mut b, file, sym.id);
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
                let _ = is_abstract;
                let own = b.shape.props.len();
                // `declare function C(): T` next to `declare class C`.
                b.shape.call = self.sigs_of_function_declarations(sym);
                if !has_constructor {
                    // `getDefaultConstructSignatures`: one for each way to make what it extends that takes the type arguments given
                    // there, which may be none; one of its own if what it extends cannot be made at all. It goes by the base
                    // constructor alone, whatever the base types are.
                    let (can_be_made, fitting) = self.base_constructors(sym, true);
                    let bases = if can_be_made {
                        fitting.into_iter().map(Some).collect()
                    } else {
                        vec![None]
                    };
                    for base in bases {
                        b.shape.construct.push(self.p.types.intern_sig(
                            SigData::DefaultConstruct {
                                class: sym,
                                base,
                                mapper: outer,
                            },
                        ));
                    }
                }
                // `getTypeOfPrototypeProperty`: `any` for each type parameter, those of what is around the class too.
                // It can be assigned to (`isReadonlySymbol`).
                let declared = self.declared_type(sym);
                let instance = match self.data(declared) {
                    TypeData::Ref { target, args } if !args.is_empty() => {
                        self.intern(TypeData::Ref {
                            target: *target,
                            args: vec![TypeId::ANY; args.len()].into(),
                        })
                    }
                    _ => declared,
                };
                b.add(Prop {
                    name: known::prototype,
                    flags: PropFlags::empty(),
                    source: PropSource::Type(instance),
                    mapper: MapperId::IDENTITY,
                });
                let exports_from = b.shape.props.len();
                self.add_namespace_exports(&mut b, sym);
                // The static members, and what a merged namespace exports. Nothing declares `prototype`.
                contained = [0..own, exports_from..b.shape.props.len()];
                ranges = self.ranges_of_declarations(sym);
                // Static members are inherited too.
                let base = self.base_constructor_type_of_class(sym);
                // `getPropertiesOfType`: a type variable answers with what it extends.
                let base = if self.is_type_variable(base) {
                    self.apparent_type(base)
                } else {
                    base
                };
                if let Some(members) = self.members(base) {
                    // `addInheritedMembers`
                    for prop in &members.shape().props {
                        if !b.has(prop.name) && !self.is_static_private_name(prop) {
                            let mut prop = prop.clone();
                            prop.mapper = self.compose(prop.mapper, members.mapper);
                            b.add(prop);
                        }
                    }
                }
                // `getIndexInfosOfIndexSymbol`: on this side, what stands next to a computed name is the whole member table.
                if !b.implied.is_empty() {
                    // TypeScript has the members in place by now, so nothing asked here comes back to this type.
                    self.eager.push(self.stack.len());
                    let mut others: Vec<(Atom, TypeId)> = Vec::new();
                    for prop in b.shape.props[own..].to_vec() {
                        let ty = self.type_of_prop(&prop, MapperId::IDENTITY);
                        others.push((prop.name, ty));
                    }
                    self.eager.pop();
                    // A type that a merged namespace exports is in the table too, and `getTypeOfSymbol` of it is the error type.
                    if self.files().flags(sym).intersects(SymFlags::MODULE) {
                        for (name, _) in self.exports_in_order(sym) {
                            if !b.has(name) {
                                others.push((name, TypeId::ERROR));
                            }
                        }
                    }
                    for i in 0..b.shape.index.len() {
                        let key = b.shape.index[i].key;
                        if !b.implied.contains(&key) {
                            continue;
                        }
                        let mut values = vec![b.shape.index[i].value];
                        for &(name, ty) in &others {
                            let is_symbol = self.files().atoms.is_symbol_name(name);
                            if key == TypeId::STRING && !is_symbol
                                || key == TypeId::NUMBER && self.is_numeric_name(name)
                                || key == TypeId::SYMBOL && is_symbol
                            {
                                values.push(ty);
                            }
                        }
                        b.shape.index[i].value = self.union_reduced(&values);
                    }
                }
                // `anyBaseTypeIndexInfo`, where the class has no static index signature at all.
                if b.shape.index.is_empty() && self.extends_any(sym) {
                    b.shape
                        .index
                        .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
                }
            }
            Origin::Function(sym) => {
                b.shape.call = self.sigs_of_function_declarations(sym);
                self.add_namespace_exports(&mut b, sym);
                // What is assigned to a name declares it only if nothing else does. `mergeSymbolTable`: every part brings its own.
                for part in self.files().parts(sym) {
                    self.add_expandos(&mut b, part.file, part.id);
                }
            }
            Origin::EnumObject(sym) => {
                // A number gives back the name of the member that has it.
                let mut has_numbers = false;
                let mut has_members = false;
                for (name, member) in self.exports_in_order(sym) {
                    // The values a namespace merged with it exports are properties as well.
                    if !self.symbol_is_value(member) {
                        continue;
                    }
                    b.add(Prop {
                        name,
                        flags: self.export_flags(member),
                        source: PropSource::Symbol(member),
                        mapper: MapperId::IDENTITY,
                    });
                    let is_member = self.files().flags(member).contains(SymFlags::ENUM_MEMBER);
                    has_members |= is_member;
                    if !has_numbers {
                        let ty = if is_member {
                            self.enum_member_type(member)
                        } else {
                            // TypeScript has the members in place by now, so nothing asked here comes back to this type.
                            self.eager.push(self.stack.len());
                            let ty = self.type_of_symbol(member);
                            self.eager.pop();
                            ty
                        };
                        has_numbers = self.is_number_like(ty);
                    }
                }
                // `resolveAnonymousTypeMembers`: some property is a number, or the enum has no members.
                if has_numbers || !has_members {
                    b.shape
                        .index
                        .push(IndexInfo::new(TypeId::NUMBER, TypeId::STRING, true));
                }
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
                    });
                }
            }
            // `cloneTypeAsModuleType` over `getTypeWithSyntheticDefaultImportType`: the properties, never the signatures.
            Origin::Namespace {
                module,
                with_default,
                ..
            } => {
                let ty = self.type_of_symbol(module);
                if let Some(members) = self.members(ty) {
                    for prop in &members.shape().props {
                        let mut prop = prop.clone();
                        if with_default {
                            // `getSpreadType(ty, { default })`: what can be spread, and the made-up `default` wins.
                            if prop.name == known::default || !self.is_spreadable_property(&prop) {
                                continue;
                            }
                            // `getSpreadSymbol`: a copy can be written to, and of what can only be written to there is nothing to copy.
                            if prop.flags.contains(PropFlags::WRITE_ONLY) {
                                prop = Prop {
                                    name: prop.name,
                                    flags: prop.flags & PropFlags::OPTIONAL,
                                    source: Self::copy_of(TypeId::UNDEFINED, &[&prop], false),
                                    mapper: MapperId::IDENTITY,
                                };
                            } else if prop.flags.contains(PropFlags::READONLY) {
                                // What can only be read, an `export const`, is made anew too: its declarations, no parent.
                                let ty = self.type_of_prop(&prop, MapperId::IDENTITY);
                                prop.source = Self::copy_of(ty, &[&prop], false);
                                prop.mapper = MapperId::IDENTITY;
                            }
                            prop.flags.remove(PropFlags::READONLY);
                        }
                        prop.mapper = self.compose(prop.mapper, members.mapper);
                        b.add(prop);
                    }
                    // `getUnionIndexInfos`: `{ default }` has no index signature, so what is spread with it has none.
                    if !with_default {
                        for info in &members.shape().index {
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
                    });
                }
            }
            // What `var` and `function` declare globally. `let`, `const` and `class` do not become properties.
            Origin::GlobalThis => {
                let globals = self.files().globals.to_vec();
                let global_this = self.files().global_this_symbol;
                for (name, sym) in globals {
                    // Whether it is a value is asked of what it stands for; how it is scoped, of the name itself.
                    if self.symbol_is_value(sym)
                        && !self.files().flags(sym).intersects(
                            SymFlags::BLOCK_SCOPED_VARIABLE | SymFlags::CLASS | SymFlags::ENUM,
                        )
                    {
                        // `globalThisSymbol` is made with `CheckFlagsReadonly`.
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

    /// `symbolIsValue`: a value itself, or an alias with a value on the way to what it stands for and no step before that value
    /// that is only about types (`getSymbolFlagsEx`, `excludeTypeOnlyMeanings`). An alias that stands for nothing is in error, and
    /// what is in error can be anything, a value too.
    fn symbol_is_value(&self, sym: Sym) -> bool {
        self.files()
            .symbol_flags_ex(sym, true, false)
            .intersects(SymFlags::VALUE)
    }

    /// `isReadonlySymbol`, of what a module, a namespace or an enum exports: constants and enum members. What an alias stands
    /// for does not count.
    fn export_flags(&self, export: Sym) -> PropFlags {
        let own = self.files().flags(export);
        if own.intersects(SymFlags::VARIABLE) && own.contains(SymFlags::CONST)
            || own.contains(SymFlags::ENUM_MEMBER)
        {
            PropFlags::READONLY
        } else {
            PropFlags::empty()
        }
    }

    pub(super) fn exports_in_order(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        let mut all = self.files().exports(sym);
        all.sort_by_key(|e| e.1);
        all
    }

    /// `getExportsOfSymbol`, of what `bindDeferredExpandoAssignment` declares among the exports of `owner`: (name, declaration),
    /// those of one name together. `lateBindMember`: `f[key] = value` declares the property that the type of `key` names, together
    /// with the `f.name = value` of that name. A key whose type names nothing declares nothing. `checkObjectLiteral` takes the
    /// exports as the binder left them.
    pub(super) fn expandos_of(&mut self, file: FileId, owner: SymbolId) -> Vec<(Atom, ExprId)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let of = &bound.symbols[owner.idx()];
        let mut all = Vec::new();
        let mut is_grouped = true;
        for &(name, symbol) in bound.table(of.exports) {
            for &decl in &bound.symbols[symbol.idx()].decls {
                let Decl::Expando(e) = decl else {
                    continue;
                };
                if name != known::assignment_declaration {
                    all.push((name, e));
                } else if !of.flags.contains(SymFlags::OBJECT_LITERAL)
                    && let ExprKind::Assign { target, .. } = hir[e].kind
                    && let ExprKind::Index { index, .. } = hir[target].kind
                    && let Some(name) = self.member_name(file, PropKey::Computed(index))
                {
                    all.push((name, e));
                    is_grouped = false;
                }
            }
        }
        if !is_grouped {
            all.sort_unstable_by_key(|assignment| assignment.1);
            group_by_key(&mut all, |assignment| assignment.0);
        }
        all
    }

    /// The properties that assignments declare for `owner`, where nothing else declares them.
    fn add_expandos(&mut self, b: &mut Builder, file: FileId, owner: SymbolId) {
        for of_name in self.expandos_of(file, owner).chunk_by(|a, b| a.0 == b.0) {
            let name = of_name[0].0;
            if !b.has(name) {
                b.add(Prop {
                    name,
                    flags: PropFlags::empty(),
                    source: PropSource::Assigned(file, of_name.iter().map(|x| x.1).collect()),
                    mapper: MapperId::IDENTITY,
                });
            }
        }
    }

    /// `shape`, which has no properties, with those that assignments declare for `owner`, in the order of `getNamedMembers`.
    /// `NONE`: there are none.
    pub(super) fn with_expandos(&mut self, shape: Shape, file: FileId, owner: SymbolId) -> Shape {
        if owner.is_none() {
            return shape;
        }
        let mut b = Builder {
            shape,
            ..Default::default()
        };
        let before = b.shape.props.len();
        self.add_expandos(&mut b, file, owner);
        if b.shape.props.len() > before {
            self.get_named_members(&mut b.shape.props, |_| true, &[]);
        }
        b.shape
    }

    /// The properties `this.name = value` declares in JavaScript, where nothing else declares them.
    fn add_this_properties(
        &mut self,
        b: &mut Builder,
        file: FileId,
        class: ClassId,
        is_static: bool,
    ) {
        let list = self.bound(file).this_properties_of(class, is_static);
        let mut i = 0;
        while i < list.len() {
            let name = list[i].2;
            let end = i + list[i..].iter().take_while(|x| x.2 == name).count();
            if !b.has(name) {
                let assignments: Box<[ExprId]> = list[i..end].iter().map(|x| x.3).collect();
                // `getDeclarationModifierFlagsFromSymbol`: the modifiers of `symbol.ValueDeclaration`.
                let modifiers = self.hir(file).jsdoc_modifiers_of(assignments[0]);
                let mut flags = PropFlags::empty();
                flags.set(PropFlags::READONLY, modifiers.contains(Flags::READONLY));
                flags.set(PropFlags::PRIVATE, modifiers.contains(Flags::PRIVATE));
                flags.set(PropFlags::PROTECTED, modifiers.contains(Flags::PROTECTED));
                b.add(Prop {
                    name,
                    flags,
                    source: PropSource::Assigned(file, assignments),
                    mapper: MapperId::IDENTITY,
                });
            }
            i = end;
        }
    }

    /// The values a namespace merged with a function, a class or an enum exports.
    fn add_namespace_exports(&mut self, b: &mut Builder, sym: Sym) {
        for (name, export) in self.exports_in_order(sym) {
            // What assignments alone declare is left to `add_expandos`.
            let is_expando = |d: &(FileId, Decl)| matches!(d.1, Decl::Expando(_));
            if self.symbol_is_value(export)
                && !b.has(name)
                && !self.files().decls_of(export).iter().all(is_expando)
            {
                b.add(Prop {
                    name,
                    flags: self.export_flags(export),
                    source: PropSource::Symbol(export),
                    mapper: MapperId::IDENTITY,
                });
            }
        }
    }

    /// `createTupleTargetType`, and what `resolveObjectTypeMembers` takes from `Array`, in which `this` is the tuple, or whatever
    /// stands for it.
    fn build_tuple_shape(
        &mut self,
        this: TypeId,
        elems: &[TypeId],
        flags: &[ElemFlags],
        readonly: bool,
    ) -> Shape {
        let mut b = Builder::default();
        let fixed = flags
            .iter()
            .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
            .unwrap_or(flags.len());
        for i in 0..fixed {
            let optional = flags[i].contains(ElemFlags::OPTIONAL);
            let ty = if optional {
                self.optional_property(elems[i])
            } else {
                elems[i]
            };
            b.add(Prop {
                name: self.number_name(i as f64),
                // `getLiteralTypeFromProperty`: made up without a declaration or a `nameType`, it goes by the string "0".
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
            });
        }
        let length = if fixed == flags.len() {
            // `createTupleTargetType`: at least as many as may not be left out, wherever they stand.
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
        });
        let array = self.tuple_base_type(elems, flags, readonly);
        let heir = match *self.data(array) {
            TypeData::Ref { target, .. } => Some((target, this)),
            _ => None,
        };
        self.inherit(&mut b, array, heir);
        b.shape
    }

    /// `getTupleBaseType`
    fn tuple_base_type(&mut self, elems: &[TypeId], flags: &[ElemFlags], readonly: bool) -> TypeId {
        let element = self.tuple_element_union(elems, flags);
        if readonly {
            self.readonly_array_of(element)
        } else {
            self.array_of(element)
        }
    }

    /// `createNormalizedTupleType`, beginning with its first step: `[A, ...(X | Y)]` is `[A, ...X] | [A, ...Y]`.
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
        let mut one = elems.to_vec();
        let mut all = Vec::new();
        for &part in self.parts(elems[i]) {
            one[i] = part;
            all.push(self.distributed_tuple(&one, flags, readonly));
        }
        self.union(&all)
    }

    /// What any element of the tuple may be.
    pub fn tuple_element_union(&mut self, elems: &[TypeId], flags: &[ElemFlags]) -> TypeId {
        let mut all: SmallVec<[TypeId; 8]> = SmallVec::new();
        for (&e, f) in elems.iter().zip(flags) {
            if f.contains(ElemFlags::VARIADIC) {
                all.push(self.indexed_access(e, TypeId::NUMBER));
            } else {
                all.push(e);
            }
        }
        self.union(&all)
    }

    fn signatures_identical(&mut self, a: SigId, b: SigId) -> bool {
        self.compare_signatures_identical(a, b, false, false, false)
    }

    /// `isMixinConstructorType`, of a type whose construct signatures are `sigs`: one signature, without type parameters, that
    /// takes `...args: any[]` and nothing else.
    fn is_mixin_constructor_type(&mut self, sigs: &[SigId]) -> bool {
        let &[sig] = sigs else { return false };
        // How many parameters are written is known without asking what they are.
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
        param.rest
            && (self.is_any(param.ty)
                || self
                    .array_element(param.ty)
                    .is_some_and(|ty| self.has_any_flag(ty)))
    }

    /// `findMixins`: the construct signatures of each member of an intersection, and which members are mixin constructors that
    /// give theirs up.
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
        // Where nothing but mixin constructors can be constructed, the first goes on being a constructor.
        if constructor_types > 0
            && constructor_types == mixins
            && let Some(first) = is_mixin.iter().position(|&mixin| mixin)
        {
            is_mixin[first] = false;
        }
        (constructors, is_mixin)
    }

    /// `resolveIntersectionTypeMembers`, and `createUnionOrIntersectionProperty` for each name.
    fn build_intersection_shape(&mut self, whole: TypeId, parts: &[TypeId]) -> Shape {
        let mut b = Builder::default();
        // What a property is is only looked into when it is asked for: with `this` for the whole, that can take knowing
        // other properties of the whole. For each name that several members have: the properties, the one in `b` first.
        let mut lists: Vec<Vec<Prop>> = Vec::new();
        let (constructors, is_mixin) = self.find_mixins(parts);
        let has_mixins = is_mixin.contains(&true);
        for (at, &written) in parts.iter().enumerate() {
            let part = self.apparent_type(written);
            // `getTypeWithThisArgument`: `this` in a member of a part is the whole, unless the part says what it is. In what a
            // type parameter extends it is the type parameter (`getApparentType`).
            let stands_for = if self.is_deferred(written) {
                written
            } else {
                whole
            };
            let members = match self.tuple_members_with_this(part, stands_for) {
                Some(of_tuple) => Some(of_tuple),
                None => self.members(part),
            };
            let Some(mut members) = members else { continue };
            if let TypeData::Ref { target, .. } = self.data(part) {
                let this = self.intern(TypeData::ThisParam(*target));
                let mut pairs = self.p.types.mapping(members.mapper).to_vec();
                for pair in &mut pairs {
                    if pair.0 == this && pair.1 == part {
                        pair.1 = stands_for;
                    }
                }
                members.mapper = self.p.types.mapper(pairs);
            }
            b.reserve(members.shape().props.len());
            for prop in &members.shape().props {
                let mut own = prop.clone();
                self.instantiate_prop(&mut own, members.mapper);
                match b.position(prop.name) {
                    // The very same property, come by in two ways, is there once.
                    Some(i) => {
                        if lists[i].is_empty() {
                            if b.shape.props[i] != own {
                                lists[i] = vec![b.shape.props[i].clone(), own];
                            }
                        } else if !lists[i].contains(&own) {
                            lists[i].push(own);
                        }
                    }
                    None => {
                        b.add_new(own);
                        lists.push(Vec::new());
                    }
                }
            }
            // A signature that says the same as one that is there adds nothing.
            for &sig in &members.shape().call {
                let sig = self.instantiate_sig(sig, members.mapper);
                if !b
                    .shape
                    .call
                    .iter()
                    .any(|&s| self.signatures_identical(s, sig))
                {
                    b.shape.call.push(sig);
                }
            }
            // A mixin constructor is no way to make anything: what it makes is part of what the other members make.
            if !is_mixin[at] {
                for &sig in &members.shape().construct {
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
                        sig = self.p.types.intern_sig(SigData::WithReturn { sig, ret });
                    }
                    if !b
                        .shape
                        .construct
                        .iter()
                        .any(|&s| self.signatures_identical(s, sig))
                    {
                        b.shape.construct.push(sig);
                    }
                }
            }
            // `appendIndexInfo`
            for info in &members.shape().index {
                let value = self.instantiate(info.value, members.mapper);
                match b.shape.index.iter_mut().find(|i| i.key == info.key) {
                    Some(existing) => {
                        let value = self.intersection(&[existing.value, value]);
                        let readonly = existing.readonly && info.readonly;
                        *existing = IndexInfo::new(info.key, value, readonly);
                    }
                    None => b.shape.index.push(IndexInfo { value, ..*info }),
                }
            }
        }
        for (prop, list) in b.shape.props.iter_mut().zip(lists) {
            if list.len() > 1 {
                let every = |flag: PropFlags| list.iter().all(|p| p.flags.contains(flag));
                // Optional if every property, method or accessor among them is: a variable of a module or of `globalThis` has no say.
                let optional = list
                    .iter()
                    .filter(|p| !matches!(p.source, PropSource::Symbol(_)))
                    .all(|p| p.flags.contains(PropFlags::OPTIONAL));
                prop.flags.set(PropFlags::OPTIONAL, optional);
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
                // An accessor only if all are, and all can be got, set or both alike.
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
                prop.source = PropSource::Intersected(whole, list.into());
                prop.mapper = MapperId::IDENTITY;
            }
        }
        b.shape
    }

    fn has_no_members(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::EMPTY_OBJECT || ty == TypeId::OBJECT {
            return true;
        }
        if !self.is_object_type(ty) || self.is_generic(ty) {
            return false;
        }
        match self.members(ty) {
            Some(m) => {
                let s = m.shape();
                s.props.is_empty()
                    && s.call.is_empty()
                    && s.construct.is_empty()
                    && s.index.is_empty()
            }
            None => false,
        }
    }

    /// `tryMergeUnionOfObjectTypeAndEmptyObject`: `{ a: T } | {}`, which is what `cond ? { a } : {}` and `cond && { a }` are,
    /// spreads like `{ a?: T }`.
    pub fn merge_object_or_nothing(&mut self, ty: TypeId) -> TypeId {
        let ty = self.force(ty);
        if !self.is_union(ty) {
            return ty;
        }
        let mut object = None;
        let mut empty = None;
        for &part in self.parts(ty) {
            if self.has_no_members(part) {
                empty.get_or_insert(part);
            } else if (self.is_primitive(part)
                && part != TypeId::VOID
                && !self.is_symbol_like(part))
                || matches!(self.data(part), TypeData::Keyof(_))
            {
            } else if object.replace(part).is_some() {
                return ty;
            }
        }
        let Some(object) = object else {
            return empty.unwrap_or(TypeId::EMPTY_OBJECT);
        };
        // `getPropertiesOfType`, `getIndexInfosOfType`: whatever the one member is, a type parameter too, it answers with what it
        // looks like (`getReducedApparentType`); a union with what all its members have.
        let owner = self.reduced(object);
        let owner = self.apparent_type(owner);
        let owner = self.reduced(owner);
        if owner == TypeId::UNRESOLVED {
            return ty;
        }
        let owner = if self.is_union(owner) {
            self.union_as_object(owner)
        } else {
            owner
        };
        let mut shape = Shape::default();
        // What is no object has nothing to copy.
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
                    source: Self::copy_of(ty, &[prop], false),
                    mapper: MapperId::IDENTITY,
                });
            }
            for info in &members.shape().index {
                let value = self.instantiate(info.value, members.mapper);
                shape.index.push(IndexInfo { value, ..*info });
            }
        }
        shape.literal = Literalness::Literal;
        self.synth(shape)
    }

    /// `getLiteralTypeFromProperty` of a copy of `prop`, which `owner` has: `STRING_NAME` if its name reads as a number and is a
    /// string all the same. `anew`: the copy is a symbol of its own (`getSpreadSymbol`), with the `nameType` of the original but
    /// without its declaration, so that what is written `1` goes by "1".
    pub(super) fn name_flag_of_copy(
        &mut self,
        owner: TypeId,
        prop: &Prop,
        anew: bool,
    ) -> PropFlags {
        if prop.flags.contains(PropFlags::STRING_NAME) {
            return PropFlags::STRING_NAME;
        }
        if !self.is_numeric_name(prop.name) {
            return PropFlags::empty();
        }
        // A `nameType` is kept of a name that is worked out (`lateBindMember`), and in an object literal of any name in brackets
        // (`checkObjectLiteral`).
        let is_written_out = match &prop.source {
            PropSource::Members(list) => {
                matches!(self.hir(list[0].0)[list[0].1].key, PropKey::Name(_))
            }
            PropSource::Literal(file, written) => {
                let hir = self.hir(*file);
                matches!(hir[*written].key, PropKey::Name(_))
                    && hir.text.get(hir[*written].pos as usize) != Some(&b'[')
            }
            _ => false,
        };
        if anew && is_written_out
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
        self.is_object_type(ty)
            && !(matches!(
                self.data(ty),
                TypeData::Anon {
                    origin: Origin::Mapped(..),
                    ..
                }
            ) && self.is_generic(ty))
    }

    /// Whether the symbol of `prop` has `SymbolFlagsFunction`: a function that a module or a namespace exports.
    fn is_function_symbol_property(&self, prop: &Prop) -> bool {
        matches!(prop.source, PropSource::Symbol(symbol) if self.files().flags(symbol).contains(SymFlags::FUNCTION))
    }

    /// `getSpreadType`: `{ ...left, ...right }`
    pub fn spread(&mut self, left: TypeId, right: TypeId) -> TypeId {
        let (left, right) = (self.force(left), self.force(right));
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
        // `checkCrossProductUnion`: a union too big to write out is an error.
        let is_too_complex = |c: &Self, left: TypeId, right: TypeId| {
            c.parts(left).len().saturating_mul(c.parts(right).len()) >= 100_000
        };
        let left = self.merge_object_or_nothing(left);
        if self.is_union(left) {
            if is_too_complex(self, left, right) {
                return TypeId::ERROR;
            }
            // `mapType`: in the order of `CompareTypes`. What is made here is ordered by when it was made.
            let spread: Vec<TypeId> = self
                .parts(left)
                .iter()
                .copied()
                .map(|p| self.spread(p, right))
                .collect();
            return self.union(&spread);
        }
        let right = self.merge_object_or_nothing(right);
        if self.is_union(right) {
            if is_too_complex(self, left, right) {
                return TypeId::ERROR;
            }
            let spread: Vec<TypeId> = self
                .parts(right)
                .iter()
                .copied()
                .map(|p| self.spread(left, p))
                .collect();
            return self.union(&spread);
        }
        // Booleans, numbers, bigints, strings, enums, `object` and `keyof T` add nothing: the result is `left` itself.
        let is_nullish_or_symbol = self.is_nullish(right) || self.is_symbol_like(right);
        if self.is_primitive(right) && !is_nullish_or_symbol
            || right == TypeId::OBJECT
            || matches!(self.data(right), TypeData::Keyof(_))
        {
            return left;
        }
        if self.is_generic_object_type(left) || self.is_generic_object_type(right) {
            if left == TypeId::EMPTY_OBJECT || self.has_no_members(left) {
                return right;
            }
            // `T & { a: string }` and `{ b: string }` make `T & { a: string, b: string }`.
            if let TypeData::Intersection(parts) = self.data(left)
                && let Some((&last, others)) = parts.split_last()
                && self.is_non_generic_object_type(last)
                && self.is_non_generic_object_type(right)
            {
                let mut parts = others.to_vec();
                parts.push(self.spread(last, right));
                return self.intersection(&parts);
            }
            return self.intersection(&[left, right]);
        }
        // `getPropertiesOfType`, `getIndexInfosOfType`: `null`, `undefined` and `void` have no members, so spreading one of them
        // copies the other side without its index signatures.
        let members_of = |c: &mut Self, ty: TypeId| {
            c.members(if c.is_nullish(ty) {
                TypeId::EMPTY_OBJECT
            } else {
                ty
            })
        };
        let (Some(l), Some(r)) = (members_of(self, left), members_of(self, right)) else {
            return TypeId::UNRESOLVED;
        };
        let mut b = Builder::default();
        b.reserve(l.shape().props.len() + r.shape().props.len());
        // What comes of spreading into the attributes of an element is still that (`objectFlags`).
        let is_jsx = |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        let (left_is_jsx, right_is_jsx) = (is_jsx(self, left), is_jsx(self, right));
        // What is written in the literal itself goes on being that (`shouldCheckAsExcessProperty`): on the left in what has been
        // put together so far, on the right in a run of properties between spreads.
        let left_is_so_far = left_is_jsx
            || matches!(self.data(left), TypeData::Synth(shape) if shape.literal == Literalness::WithSpread);
        let right_is_written = right_is_jsx
            || matches!(self.data(right), TypeData::Synth(shape) if shape.literal == Literalness::Written);
        // `getSpreadSymbol` returns the same symbol, so the synthesized JSX children property keeps the declaration that makes it
        // count as written in the element.
        let is_written = |prop: &Prop| {
            matches!(prop.source, PropSource::Literal(..))
                || prop
                    .flags
                    .intersects(PropFlags::JSX_CHILDREN | PropFlags::WRITTEN)
        };
        for prop in &l.shape().props {
            if !self.is_spreadable_property(prop) {
                continue;
            }
            if left_is_so_far && is_written(prop) {
                b.add(prop.clone());
                continue;
            }
            // `getSpreadSymbol`: what can only be written reads as `undefined`. That, and what can only be read, is made anew.
            let ty = if prop.flags.contains(PropFlags::WRITE_ONLY) {
                TypeId::UNDEFINED
            } else {
                self.type_of_prop(prop, l.mapper)
            };
            let anew = prop
                .flags
                .intersects(PropFlags::WRITE_ONLY | PropFlags::READONLY);
            // What is not made anew is the symbol itself: a method is still one.
            let kept = if anew {
                PropFlags::OPTIONAL
            } else {
                PropFlags::OPTIONAL | PropFlags::METHOD
            };
            let mut flags = prop.flags & kept | self.name_flag_of_copy(left, prop, anew);
            if !anew && self.is_function_symbol_property(prop) {
                flags |= PropFlags::METHOD;
            }
            b.add(Prop {
                name: prop.name,
                flags,
                source: Self::copy_of(ty, &[prop], !anew),
                mapper: MapperId::IDENTITY,
            });
        }
        // A copy can be written to, whatever it is a copy of.
        for info in &l.shape().index {
            let value = self.instantiate(info.value, l.mapper);
            b.shape.index.push(IndexInfo {
                value,
                readonly: false,
                ..*info
            });
        }
        for prop in &r.shape().props {
            // `skippedPrivateMembers`: it hides what was there by the name, and is not copied itself.
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
            if right_is_written && !is_write_only && is_written(prop) {
                b.remove(prop.name);
                b.add_new(prop.clone());
                continue;
            }
            let mut ty = if is_write_only {
                TypeId::UNDEFINED
            } else {
                self.type_of_prop(prop, r.mapper)
            };
            let (flags, source);
            if prop.flags.contains(PropFlags::OPTIONAL)
                && let Some(i) = b.position(prop.name)
            {
                let existing = &b.shape.props[i];
                let left_ty = self.type_of_prop(existing, MapperId::IDENTITY);
                // It is made anew, and named as the one on the left is.
                let named = match l.resolved.prop(prop.name) {
                    Some(original) => self.name_flag_of_copy(left, original, true),
                    None => existing.flags & PropFlags::STRING_NAME,
                };
                flags = existing.flags & PropFlags::OPTIONAL | named;
                // `getSpreadType`: what is on the left, or what is on the right when that is there.
                let present = self.remove_missing_or_undefined_type(ty);
                let same = self.remove_missing_or_undefined_type(left_ty) == present;
                ty = if same {
                    left_ty
                } else {
                    self.union_reduced(&[left_ty, present])
                };
                source = Self::copy_of(ty, &[&b.shape.props[i], prop], false);
            } else {
                let anew = is_write_only || prop.flags.contains(PropFlags::READONLY);
                let kept = if anew {
                    PropFlags::OPTIONAL
                } else {
                    PropFlags::OPTIONAL | PropFlags::METHOD
                };
                let function_flag = if !anew && self.is_function_symbol_property(prop) {
                    PropFlags::METHOD
                } else {
                    PropFlags::empty()
                };
                flags =
                    prop.flags & kept | self.name_flag_of_copy(right, prop, anew) | function_flag;
                source = Self::copy_of(ty, &[prop], !anew);
            }
            let copy = Prop {
                name: prop.name,
                flags,
                source,
                mapper: MapperId::IDENTITY,
            };
            match b.position(prop.name) {
                Some(i) if prop.flags.contains(PropFlags::OPTIONAL) => b.shape.props[i] = copy,
                // What comes later goes last.
                _ => {
                    b.remove(prop.name);
                    b.add_new(copy);
                }
            }
        }
        self.get_named_members(&mut b.shape.props, |_| true, &[]);
        // An index signature holds for the result if it holds for both. (Nothing at all on the left does not count.)
        let left_is_nothing = left == TypeId::EMPTY_OBJECT;
        let mut index = Vec::new();
        for info in &r.shape().index {
            let value = self.instantiate(info.value, r.mapper);
            match b.shape.index.iter().find(|i| i.key == info.key) {
                // `getUnionIndexInfos`
                Some(existing) => {
                    let value = self.union(&[existing.value, value]);
                    index.push(IndexInfo::new(info.key, value, false));
                }
                None if left_is_nothing => index.push(IndexInfo {
                    value,
                    readonly: false,
                    ..*info
                }),
                None => {}
            }
        }
        b.shape.index = index;
        b.shape.literal = if left_is_jsx || right_is_jsx {
            Literalness::JsxAttributes
        } else {
            Literalness::WithSpread
        };
        b.shape.spread_of = Some((left, right));
        self.synth(b.shape)
    }

    // ───────────────────────────── reading ─────────────────────────────

    /// The type of `prop`, which was found in something whose mapper is `outer`.
    pub fn type_of_prop(&mut self, prop: &Prop, outer: MapperId) -> TypeId {
        let mut adds_undefined = false;
        let mut own_mapper = prop.mapper;
        let base = match &prop.source {
            PropSource::Type(t) | PropSource::Copy(t, ..) => *t,
            // `getTypeOfMappedSymbol` instantiates the template with `prop.mapper` before it adjusts for optionality.
            PropSource::Mapped(of, strips_optional, _) => {
                own_mapper = MapperId::IDENTITY;
                self.type_of_mapped_prop(*of, prop, *strips_optional)
            }
            PropSource::Members(members) => {
                // A method may be undefined if any of its declarations may be left out (`getTypeOfFuncClassEnumModule`), a
                // property if the declaration that says what it is may (`getTypeForVariableLikeDeclaration`).
                let (file, first) = members[0];
                adds_undefined = prop.flags.contains(PropFlags::OPTIONAL)
                    && (prop.flags.contains(PropFlags::METHOD)
                        || self.hir(file)[first].flags.contains(Flags::OPTIONAL));
                self.type_of_members(members)
            }
            PropSource::Parameter(file, p) => self.type_of_param(*file, *p),
            PropSource::Literal(file, p) => self.type_of_literal_prop(*file, *p),
            PropSource::Symbol(sym) => self.type_of_symbol(*sym),
            PropSource::Intersected(whole, parts) => {
                let key = (*whole, prop.name);
                let at = whole.0.wrapping_add(prop.name.0.wrapping_mul(31)) as usize % RECENT_PROPS;
                let recent = self.recent_intersected_props[at];
                if recent.0 == key {
                    recent.1
                } else if let Some(known) = self.p.intersected_props.get(&key) {
                    self.recent_intersected_props[at] = (key, known);
                    known
                } else {
                    let cycles_before = self.cycles;
                    let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                    for part in parts.iter() {
                        types.push(self.type_of_prop(part, MapperId::IDENTITY));
                    }
                    let all = self.intersection(&types);
                    if self.cycles == cycles_before {
                        self.p.intersected_props.insert(key, all);
                    }
                    all
                }
            }
            PropSource::Assigned(file, assignments) => {
                self.type_of_assigned_prop(*file, prop.name, assignments)
            }
        };
        let ty = if self.has_type_variables(base) {
            let ty = if own_mapper == MapperId::IDENTITY {
                base
            } else {
                self.instantiate(base, own_mapper)
            };
            if outer == MapperId::IDENTITY {
                ty
            } else {
                self.instantiate(ty, outer)
            }
        } else {
            base
        };
        let ty = self.force(ty);
        let ty = if prop.flags.contains(PropFlags::WIDEN) {
            self.regular_object(ty)
        } else if prop.flags.contains(PropFlags::REGULAR) {
            self.regular_type_of_object_literal(ty)
        } else {
            ty
        };
        if adds_undefined {
            self.optional_property_kept(ty)
        } else {
            ty
        }
    }

    /// `optional_property`, worked out once for a type.
    pub(super) fn optional_property_kept(&mut self, ty: TypeId) -> TypeId {
        if let Some(known) = self.p.optional_properties.get(&ty) {
            return known;
        }
        let optional = self.optional_property(ty);
        // About these `union` has questions to ask, each time.
        let asks = self.parts(ty).iter().any(|&member| {
            matches!(
                self.data(member),
                TypeData::Intersection(_)
                    | TypeData::Template { .. }
                    | TypeData::StringMapping { .. }
            )
        });
        if !asks {
            self.p.optional_properties.insert(ty, optional);
        }
        optional
    }

    /// `getTypeOfVariableOrParameterOrPropertyWorker`, `case KindBinaryExpression, KindCallExpression`: the type of the property
    /// `name` declared by `assignments` (`f.name = value`, `this.name = value`, `Object.defineProperty(f, "name", descriptor)`).
    /// It is a type resolution, identified by the first declaration (`symbol.ValueDeclaration`).
    pub(super) fn type_of_assigned_prop(
        &mut self,
        file: FileId,
        name: Atom,
        assignments: &[ExprId],
    ) -> TypeId {
        let key = (file, assignments[0]);
        if let Some(cached) = self.p.assigned_prop_types.get(&key) {
            return cached;
        }
        // `checkCallExpression` checks the descriptor of `Object.defineProperty(f, "name", descriptor)` before anything asks for the
        // type of `name`: what `reportNonexistentProperty` prints for an access in the descriptor starts the resolution.
        let in_report = !self.reporting_nonexistent.is_empty()
            && matches!(self.hir(file)[assignments[0]].kind, ExprKind::Call(_));
        // What `reportCircularityError` returns for `symbol.ValueDeclaration`.
        let annotation = self
            .hir(file)
            .jsdoc_type(JsDocTypeOwner::Assign(assignments[0]));
        let in_a_circle = super::symbols::circularity_error_type(annotation);
        if in_report
            && self.stack[self.resolution_start..].contains(&Query::Assigned(file, assignments[0]))
        {
            return in_a_circle;
        }
        if !self.enter(Query::Assigned(file, assignments[0])) {
            return if self.came_full_circle {
                in_a_circle
            } else {
                TypeId::UNRESOLVED
            };
        }
        // `checkExpressionCached` has no guard against re-entry: the descriptor is checked again from the start.
        let resolution_start = self.resolution_start;
        if in_report {
            self.resolution_start = self.stack.len() - 1;
        }
        let ty = self.widened_type_of_assignments(file, name, assignments);
        self.resolution_start = resolution_start;
        // The last step of `getWidenedTypeForAssignmentDeclaration`: in a JavaScript file an all-nullable type is an implicit `any`.
        let ty = if self.hir(file).is_js && self.is_all_null_or_undefined(ty) {
            TypeId::ANY
        } else {
            ty
        };
        let is_cacheable = self.leave();
        // `reportCircularityError`
        if self.left_a_circle {
            let kept = self.p.assigned_prop_types.insert(key, in_a_circle);
            let hir = self.hir(file);
            let declaration = assignments[0];
            let at = (
                file,
                self.start_inside_parentheses(file, declaration),
                self.end_inside_parentheses(file, declaration),
            );
            // `GetNonAssignedNameOfDeclaration`: of `f["a"] = e` and `Object.defineProperty(f, "a", d)` the `"a"`, as it is written.
            let named = match hir[declaration].kind {
                ExprKind::Assign { target, .. } => match hir[target].kind {
                    ExprKind::Index { index, .. } => Some(index),
                    _ => None,
                },
                ExprKind::Call(call) => hir.ids(hir[call].args).nth(1),
                _ => None,
            };
            if let Some(named) = named {
                let written = self.source_text(
                    file,
                    self.start_inside_parentheses(file, named),
                    self.end_inside_parentheses(file, named),
                );
                self.report_circularity_error(at, Arg::Text(&written), in_a_circle, false);
            } else {
                self.report_circularity_error(at, Arg::Atom(name), in_a_circle, false);
            }
            return kept;
        }
        if is_cacheable {
            self.p.assigned_prop_types.insert(key, ty);
        }
        ty
    }

    /// `filterType(ty, flags &^ TypeFlagsNullable != 0) == neverType`: `ty` is `never`, or a union of `null` and `undefined` only.
    /// `void` is not nullable, and `any` is kept by the filter.
    pub(super) fn is_all_null_or_undefined(&self, ty: TypeId) -> bool {
        ty.is_never() || self.every_type(ty, |_, member| member.is_undefined() || member.is_null())
    }

    /// `getWidenedTypeForAssignmentDeclaration` without its last step, which replaces an all-nullable type by `any` in a
    /// JavaScript file and reports 7008.
    pub(super) fn widened_type_of_assignments(
        &mut self,
        file: FileId,
        name: Atom,
        assignments: &[ExprId],
    ) -> TypeId {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let hir = self.hir(file);
        let is_this_property =
            |e: ExprId| assignment_declaration_kind(hir, e) == JsDeclarationKind::ThisProperty;
        let mut resolved = None;
        // `thisAssignmentDeclarationMethod`
        let mut is_method_only = false;
        // `isConstructorDeclaredThisProperty`
        let all_this = !assignments.is_empty() && assignments.iter().all(|&e| is_this_property(e));
        // `thisAssignmentDeclarationTyped`: the last annotation counts.
        let annotation = if all_this {
            assignments
                .iter()
                .rev()
                .map(|&e| hir.jsdoc_type(JsDocTypeOwner::Assign(e)))
                .find(|node| node.is_some())
        } else {
            None
        };
        if let Some(annotation) = annotation {
            resolved = Some(self.type_from_node(file, annotation));
        } else if all_this {
            let inherited = match self.class_of_this_property(file, assignments[0]) {
                Some(class) => self.type_of_property_in_base_class(file, class, name),
                None => None,
            };
            // `getDeclaringConstructor`
            let constructor =
                assignments
                    .iter()
                    .find_map(|&e| match self.this_container(file, e) {
                        Some(Ok(func)) if hir[func].kind == FnKind::Constructor => Some(func),
                        _ => None,
                    });
            match constructor {
                Some(func) => {
                    // `getFlowTypeOfProperty`: the walk starts from the inherited type, or from `undefinedType`.
                    let initial = inherited.unwrap_or(self.undefined_as_declared());
                    resolved = self.flow_type_in_constructor_from(file, func, name, initial);
                }
                None => (resolved, is_method_only) = (inherited, true),
            }
        }
        let ty = match resolved {
            Some(ty) => ty,
            None => {
                let mut types = Vec::with_capacity(assignments.len());
                let mut declared = None;
                for &e in assignments {
                    // `declaration.Type()`: the first declaration that says what it is decides.
                    let annotation = hir.jsdoc_type(JsDocTypeOwner::Assign(e));
                    if annotation.is_some() {
                        declared = Some(self.type_from_node(file, annotation));
                        break;
                    }
                    // `getAssignmentDeclarationInitializerType`
                    let assigned = match hir[e].kind {
                        ExprKind::Assign { target, value, .. } => {
                            if is_this_property(e)
                                && self.contains_same_named_this_property(file, name, target, value)
                            {
                                continue;
                            }
                            self.type_of_assignment_declaration(file, target, value)
                        }
                        ExprKind::Call(call) => match hir.ids(hir[call].args).nth(2) {
                            Some(descriptor) => {
                                self.type_from_property_descriptor(file, descriptor)
                            }
                            None => continue,
                        },
                        _ => continue,
                    };
                    if !types.contains(&assigned) {
                        types.push(assigned);
                    }
                }
                if let Some(declared) = declared {
                    declared
                } else if types.is_empty() {
                    TypeId::ANY
                } else {
                    let all = self.union(&types);
                    // A property assigned in methods only also holds `undefinedOrMissingType` under strictNullChecks.
                    if is_method_only {
                        self.optional_property(all)
                    } else {
                        all
                    }
                }
            }
        };
        self.widened(ty)
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

    /// `getTypeOfPropertyInBaseClass`: the type of the property `name` in the first base type of `class`. `getDeclaringClass` is
    /// the instance type, for a static property too.
    fn type_of_property_in_base_class(
        &mut self,
        file: FileId,
        class: ClassId,
        name: Atom,
    ) -> Option<TypeId> {
        let base = *self.base_types(self.class_sym(file, class)).first()?;
        self.type_of_declared_property(base, name)
    }

    /// `getTypeOfPropertyOfType`: unlike in a property access, no index signature stands in for a missing property, and `any` has
    /// no properties.
    fn type_of_declared_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        if self.has_any_flag(ty) {
            return None;
        }
        match self.find_property(ty, name, Access::Read)? {
            (_, Found::ByIndex) => None,
            (found, _) => Some(found),
        }
    }

    /// `containsSameNamedThisProperty`: whether `value`, the right side of `target = value`, mentions `this.name` outside of
    /// nested function-like nodes.
    fn contains_same_named_this_property(
        &self,
        file: FileId,
        name: Atom,
        target: ExprId,
        value: ExprId,
    ) -> bool {
        use crate::bind::ClassOwner;
        if value.is_none() {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let class_expr = |class: ClassId| match bound.class_owner[class.idx()] {
            ClassOwner::Expr(e) => e,
            ClassOwner::Stmt(_) => ExprId::NONE,
        };
        // Lowering numbers expressions in post-order and lowers `target` before `value`, so this range is the subtree of `value`.
        (target.0 + 1..=value.0).map(ExprId).any(|e| {
            // `isMatchingReference`
            let is_match = match hir[e].kind {
                ExprKind::Dot {
                    obj,
                    name: accessed,
                    ..
                } => accessed == name && matches!(hir[obj].kind, ExprKind::This),
                ExprKind::Index { obj, index, .. } => {
                    matches!(hir[obj].kind, ExprKind::This)
                        && matches!(hir[index].kind, ExprKind::String(key) if key == name)
                }
                _ => false,
            };
            if !is_match {
                return false;
            }
            // Walk up to `value`. A class is not function-like: its heritage clause and its property initializers are visited.
            let mut at = e;
            while at != value {
                at = match bound.expr_parent[at.idx()] {
                    Parent::Expr(parent) => parent,
                    Parent::Prop(p) => bound.prop_owner[p.idx()],
                    Parent::PropKey(literal, _) => literal,
                    Parent::PatKey(_) => ExprId::NONE,
                    Parent::ClassExtends(class) => class_expr(class),
                    Parent::MemberInit(member) => match bound.member_owner[member.idx()] {
                        MemberOwner::Class(class) => class_expr(class),
                        _ => ExprId::NONE,
                    },
                    _ => ExprId::NONE,
                };
                if at.is_none() {
                    return false;
                }
            }
            true
        })
    }

    /// `getTypeFromPropertyDescriptor`
    fn type_from_property_descriptor(&mut self, file: FileId, descriptor: ExprId) -> TypeId {
        let ty = self.type_of_expr(file, descriptor);
        if let Some(value) = self.type_of_declared_property(ty, known::value) {
            return value;
        }
        if let Some(getter) = self.type_of_declared_property(ty, known::get)
            && let Some(sig) = self.single_call_signature(getter, false)
        {
            return self.sig_return(sig);
        }
        if let Some(setter) = self.type_of_declared_property(ty, known::set)
            && let Some(sig) = self.single_call_signature(setter, false)
        {
            return self.type_of_first_parameter(sig);
        }
        TypeId::ANY
    }

    /// `isReadonlyAssignmentDeclaration`: whether `e` is `Object.defineProperty(f, "name", descriptor)` with a descriptor that has a
    /// `value` and is not `writable`, or has neither a `value` nor a `set`.
    pub(super) fn is_readonly_assignment_declaration(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let Some(descriptor) = hir.ids(hir[call].args).nth(2) else {
            return false;
        };
        let ty = self.type_of_expr(file, descriptor);
        if self.type_of_declared_property(ty, known::value).is_none() {
            return self.type_of_declared_property(ty, known::set).is_none();
        }
        let apparent = self.apparent_type(ty);
        let apparent = self.reduced(apparent);
        let Some((writable, mapper)) = self.prop_ref(apparent, known::writable) else {
            return true;
        };
        // The property is a `boolean`. What it is given tells `false` from `true`.
        let writable = match writable.source {
            PropSource::Literal(of, p) if self.hir(of)[p].kind == PropKind::Init => {
                self.type_of_expr(of, self.hir(of)[p].value)
            }
            _ => self.type_of_prop(writable, mapper),
        };
        matches!(writable, TypeId::FALSE | TypeId::FRESH_FALSE)
    }

    /// `isReadonlySymbol`: whether a declaration of `prop` is a read-only assignment declaration.
    pub(super) fn has_readonly_assignment_declaration(&mut self, prop: &Prop) -> bool {
        let PropSource::Assigned(file, declarations) = &prop.source else {
            return false;
        };
        declarations
            .iter()
            .any(|&e| self.is_readonly_assignment_declaration(*file, e))
    }

    /// `getAssignmentDeclarationInitializerType` for the assignment `target = value`, which declares the property `target`.
    fn type_of_assignment_declaration(
        &mut self,
        file: FileId,
        target: ExprId,
        value: ExprId,
    ) -> TypeId {
        let hir = self.hir(file);
        let ty = self.type_of_expr(file, value);
        // `checkExpressionForMutableLocation` does not go through `checkExpressionCached`: an object literal is a type of its own.
        let ty = match *self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(of, literal, is_js_literal, false, is_fresh),
                mapper,
            } if (of, literal) == (file, value) => self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(of, literal, is_js_literal, true, is_fresh),
                mapper,
            }),
            _ => ty,
        };
        // `isEmptyArrayLiteralType` tests the type of `value`. The type of `a = []` is the type of `[]`.
        let mut rightmost = value;
        while let ExprKind::Assign {
            op: None,
            value: next,
            ..
        } = hir[rightmost].kind
        {
            rightmost = next;
        }
        let is_empty_array = matches!(hir[rightmost].kind, ExprKind::Array(items) if items.is_empty())
            || self.hands_on_empty_array_literal(file, rightmost, 0)
                && ty == self.array_of(TypeId::NEVER);
        // The property is `any[]`, unless its owner initializes a variable that has a type annotation.
        if is_empty_array && !self.is_property_of_annotated_variable(file, target) {
            return self.array_of(TypeId::ANY);
        }
        // `checkExpressionForMutableLocation`: what is asserted is what it is said to be, and a literal stays one where a literal
        // is expected.
        if matches!(hir[value].kind, ExprKind::As { .. } | ExprKind::AsConst(_)) {
            return ty;
        }
        let expected = self.contextual_type(file, value);
        self.widen_literal_for_context(ty, expected)
    }

    /// Whether the type of `e` is that of an `[]` written elsewhere. There is no `implicitNeverType`, so this follows the syntax that
    /// hands such a type on as it is. A variable or a parameter that does not say what it is has the type of its initializer.
    fn hands_on_empty_array_literal(&self, file: FileId, e: ExprId, depth: u32) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[e].kind {
            ExprKind::Array(items) => items.is_empty(),
            ExprKind::Assign {
                op: None, value, ..
            } => self.hands_on_empty_array_literal(file, value, depth),
            ExprKind::NonNull(inner) => self.hands_on_empty_array_literal(file, inner, depth),
            ExprKind::Cond { yes, no, .. } => {
                self.hands_on_empty_array_literal(file, yes, depth)
                    && self.hands_on_empty_array_literal(file, no, depth)
            }
            ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => {
                self.hands_on_empty_array_literal(file, left, depth)
                    && self.hands_on_empty_array_literal(file, right, depth)
            }
            ExprKind::Ident(_) if depth < 8 => {
                let symbol = bound.expr_symbol[e.idx()];
                if symbol.is_none() {
                    return false;
                }
                let initializer = match bound.symbols[symbol.idx()].decls.as_slice() {
                    [Decl::Var(pat)] => match bound.pat_parent[pat.idx()] {
                        crate::bind::PatParent::Var(v) if hir[v].ty.is_none() => hir[v].init,
                        _ => return false,
                    },
                    [Decl::Param(pat)] => match bound.pat_parent[pat.idx()] {
                        crate::bind::PatParent::Param(p) if hir[p].ty.is_none() => hir[p].default,
                        _ => return false,
                    },
                    _ => return false,
                };
                initializer.is_some()
                    && self.hands_on_empty_array_literal(file, initializer, depth + 1)
            }
            _ => false,
        }
    }

    /// `hasParentWithTypeAnnotation`: whether `target` is `f.name` or `f[key]` of a variable `f` that says what it is.
    pub(super) fn is_property_of_annotated_variable(&self, file: FileId, target: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[target].kind else {
            return false;
        };
        let symbol = bound.expr_symbol[obj.idx()];
        matches!(hir[obj].kind, ExprKind::Ident(_))
            && symbol.is_some()
            && bound.symbols[symbol.idx()].decls.iter().any(|&d| match d {
                Decl::Var(pat) => matches!(bound.pat_parent[pat.idx()], crate::bind::PatParent::Var(v) if hir[v].ty.is_some()),
                _ => false,
            })
    }

    /// `getWriteTypeOfSymbol`: what may be assigned to `prop`, which was found in something whose mapper is `outer`.
    pub fn write_type_of_prop(&mut self, prop: &Prop, outer: MapperId) -> TypeId {
        // Of an intersection: what all the members that have it take.
        if let PropSource::Intersected(_, parts) = &prop.source
            && parts.iter().any(|p| {
                p.flags.contains(PropFlags::ACCESSOR)
                    || matches!(p.source, PropSource::Intersected(..))
            })
        {
            let mut types = Vec::with_capacity(parts.len());
            for part in parts.iter() {
                types.push(self.write_type_of_prop(part, MapperId::IDENTITY));
            }
            let all = self.intersection(&types);
            let all = self.instantiate(all, prop.mapper);
            return self.instantiate(all, outer);
        }
        if !prop.flags.contains(PropFlags::ACCESSOR) {
            // `removeMissingType`: that it may be left out is nothing to write to it.
            let ty = self.type_of_prop(prop, outer);
            return self.remove_missing_type(ty, prop.flags.contains(PropFlags::OPTIONAL));
        }
        // `getWriteTypeOfAccessors`: what the setter says it takes. If it does not say, what is read.
        let setter: Option<(FileId, FnId)> = match &prop.source {
            PropSource::Members(members) => members
                .iter()
                .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Setter)
                .map(|&(f, m)| (f, self.hir(f)[m].func)),
            // The shape keeps the getter: the setter is the one of that name in the same literal.
            PropSource::Literal(file, p) => {
                let (file, hir) = (*file, self.hir(*file));
                let owner = self.bound(file).prop_owner[p.idx()];
                let mut found = None;
                if owner.is_some()
                    && let ExprKind::Object(props) = hir[owner].kind
                {
                    for q in props.iter() {
                        if hir[q].kind == PropKind::Setter
                            && self.member_name(file, hir[q].key) == Some(prop.name)
                            && let ExprKind::Fn(func) = hir[hir[q].value].kind
                        {
                            found = Some((file, func));
                            break;
                        }
                    }
                }
                found
            }
            _ => None,
        };
        if let Some((file, func)) = setter
            && let Some(param) = self.hir(file)[func].params.iter().next()
            && self.hir(file)[param].ty.is_some()
        {
            let ty = self.type_from_node(file, self.hir(file)[param].ty);
            let ty = self.instantiate(ty, prop.mapper);
            let ty = self.instantiate(ty, outer);
            return self.force(ty);
        }
        self.type_of_prop(prop, outer)
    }

    /// `getTypeOfSymbol(member.Symbol)`, as far as this file declares it, if `member` is the first declaration of its symbol: that
    /// is what `member_types` keeps a type by. Of a later declaration, what that alone says.
    pub(super) fn type_of_member_declaration(&mut self, file: FileId, member: MemberId) -> TypeId {
        use crate::bind::MemberDeclaration;
        let declaration = MemberDeclaration::Member(member);
        let all = self.bound(file).declarations_of_member(&declaration);
        if all.len() > 1 && all[0] == declaration {
            let members: SmallVec<[(FileId, MemberId); 4]> = all
                .iter()
                .filter_map(|of_symbol| match *of_symbol {
                    MemberDeclaration::Member(m) => Some((file, m)),
                    _ => None,
                })
                .collect();
            return self.type_of_members(&members);
        }
        self.type_of_members(&[(file, member)])
    }

    pub(super) fn type_of_member_declarations(&mut self, members: &[(FileId, MemberId)]) -> TypeId {
        self.type_of_members(members)
    }

    /// The type the declarations `members` of one property give it.
    #[inline]
    fn type_of_members(&mut self, members: &[(FileId, MemberId)]) -> TypeId {
        if let Some(known) = self.p.member_types.get(&members[0]) {
            return known;
        }
        self.resolve_type_of_members(members)
    }

    /// `type_of_members`, where nothing is kept yet.
    fn resolve_type_of_members(&mut self, members: &[(FileId, MemberId)]) -> TypeId {
        let (file, first) = members[0];
        let member = &self.hir(file)[first];
        let is_accessor =
            self.has_get_or_set_accessor(members) || member.flags.contains(Flags::ACCESSOR);
        if !self.enter(Query::Member(file, first)) {
            return if !self.came_full_circle {
                TypeId::UNRESOLVED
            } else if is_accessor {
                // `getTypeOfAccessors`
                TypeId::ERROR
            } else {
                super::symbols::circularity_error_type(member.ty)
            };
        }
        let ty = self.type_of_members_uncached(members);
        let holds = self.leave();
        if self.left_a_circle {
            self.p.circular_members.insert((file, first), ());
            let ty = if is_accessor {
                TypeId::ANY
            } else {
                super::symbols::circularity_error_type(member.ty)
            };
            let kept = self.p.member_types.insert((file, first), ty);
            if is_accessor {
                self.report_circular_accessors(members);
            } else {
                let end = self.end_of_member_name(file, first);
                let name = self.source_text(file, member.pos, end);
                self.report_circularity_error((file, member.pos, end), Arg::Text(&name), ty, false);
            }
            return kept;
        }
        if holds {
            self.p.member_types.insert((file, first), ty);
        }
        ty
    }

    /// `symbol.Flags&(SymbolFlagsGetAccessor|SymbolFlagsSetAccessor) != 0`
    fn has_get_or_set_accessor(&self, members: &[(FileId, MemberId)]) -> bool {
        members
            .iter()
            .any(|&(f, m)| matches!(self.hir(f)[m].kind, MemberKind::Getter | MemberKind::Setter))
    }

    fn type_of_members_uncached(&mut self, members: &[(FileId, MemberId)]) -> TypeId {
        let (file, first) = members[0];
        let hir = self.hir(file);
        let member = &hir[first];
        match member.kind {
            // `getTypeOfSymbol` asks for an accessor first, and `PropertyExcludes` lets a property be one symbol with the accessors
            // of its name.
            MemberKind::Property if !self.has_get_or_set_accessor(members) => {
                let owner = self.bound(file).member_owner[first.idx()];
                // `isValidESSymbolDeclaration`: `readonly` in an interface or a type literal, `static readonly` in a class. To any
                // other property a `unique symbol` is a `symbol`.
                let unique_symbol_name = match member.key.name() {
                    Some(name)
                        if member.flags.contains(Flags::READONLY)
                            && (member.flags.contains(Flags::STATIC)
                                || !matches!(owner, MemberOwner::Class(_))) =>
                    {
                        Some(name)
                    }
                    _ => None,
                };
                if member.ty.is_some() {
                    let says_unique = matches!(hir[member.ty].kind, TypeNodeKind::UniqueSymbol);
                    if let Some(name) = unique_symbol_name {
                        // `isGlobalSymbolConstructor`: by symbol, so that `declare global { interface SymbolConstructor }` counts and
                        // an interface of that name in a module or a namespace does not.
                        let in_symbol_constructor = match owner {
                            MemberOwner::Interface(i)
                                if self.files().atoms.bytes(hir[i].name)
                                    == b"SymbolConstructor" =>
                            {
                                let own = self.bound(file).interface_symbol[i.idx()];
                                own.is_some()
                                    && self.global_type_symbol(hir[i].name)
                                        == Some(self.files().sym(file, own))
                            }
                            _ => false,
                        };
                        if in_symbol_constructor {
                            // `widenTypeForVariableLikeDeclaration`: there `symbol` says as much as `unique symbol`, unless the
                            // property may be undefined as well.
                            let may_be_undefined = member.flags.contains(Flags::OPTIONAL)
                                && self.p.files.options.strict_null_checks;
                            if says_unique
                                || !may_be_undefined
                                    && self.type_from_node(file, member.ty) == TypeId::SYMBOL
                            {
                                // `Symbol.iterator` and the like go by their name alone, so that `known::sym_iterator` is what they name.
                                return self.intern(TypeData::UniqueSymbol {
                                    symbol: UniqueSymbolDeclaration::SymbolConstructor,
                                    name,
                                });
                            }
                        } else if says_unique {
                            let symbol = self.unique_symbol_declaration(file, first, name);
                            return self.intern(TypeData::UniqueSymbol { symbol, name });
                        }
                    }
                    return self.type_from_node(file, member.ty);
                }
                if member.init.is_some() {
                    // `checkCallExpression`: `Symbol()` makes a symbol of its own for the declaration it starts out as.
                    if let Some(name) = unique_symbol_name
                        && self.is_symbol_or_symbol_for_call(file, member.init)
                    {
                        return self.intern(TypeData::UniqueSymbol {
                            symbol: UniqueSymbolDeclaration::Member(file, first),
                            name,
                        });
                    }
                    // `widenTypeInferredFromInitializer`: in a JavaScript file an empty array literal gives `any[]`.
                    if hir.is_js
                        && matches!(hir[member.init].kind, ExprKind::Array(items) if items.is_empty())
                    {
                        return self.array_of(TypeId::ANY);
                    }
                    let ty = self.type_of_declaration_initializer(file, member.init);
                    // `widenTypeForVariableLikeDeclaration`: a `unique symbol` belongs to the declaration it was made for. To any
                    // other it is a `symbol`.
                    let ty = if matches!(self.data(ty), TypeData::UniqueSymbol { .. }) {
                        TypeId::SYMBOL
                    } else {
                        ty
                    };
                    if member.flags.contains(Flags::READONLY) {
                        return self.regular_object(ty);
                    }
                    return self.widened(ty);
                }
                // `getTypeForVariableLikeDeclaration`: where an implicit `any` is an error, what is assigned to it is looked at first.
                if self.p.files.options.no_implicit_any
                    && let crate::bind::MemberOwner::Class(c) =
                        self.bound(file).member_owner[first.idx()]
                    && let Some(name) = self.declared_member_name(file, member.key)
                {
                    // `getTypeOfPropertyInBaseClass`, for a property that has a `declare` modifier of its own.
                    let inherited = if member.flags.contains(Flags::AMBIENT)
                        && !hir[c].flags.contains(Flags::AMBIENT)
                    {
                        self.type_of_property_in_base_class(file, c, name)
                    } else {
                        None
                    };
                    // `getFlowTypeOfProperty`: the walk starts from the inherited type, or from `undefinedType`.
                    let initial = inherited.unwrap_or(self.undefined_as_declared());
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
                            ) {
                                return ty;
                            }
                        }
                    } else {
                        // `getFlowTypeInStaticBlocks`: the first static block that leaves more than null or undefined in it.
                        for block in hir[c].members.iter().filter(|&m| {
                            hir[m].kind == MemberKind::StaticBlock && hir[m].func.is_some()
                        }) {
                            has_flow_container = true;
                            if let Some(ty) = self.flow_type_in_constructor_from(
                                file,
                                hir[block].func,
                                name,
                                initial,
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
                TypeId::ANY
            }
            MemberKind::Method => {
                let members: Vec<(FileId, MemberId)> = members
                    .iter()
                    .copied()
                    .filter(|&(f, m)| self.hir(f)[m].kind == MemberKind::Method)
                    .collect();
                let decls: Vec<(FileId, FnId)> = members
                    .iter()
                    .enumerate()
                    .filter(|&(i, &(f, m))| {
                        !(i > 0
                            && members[i - 1].0 == f
                            && self.is_implementation_after(f, members[i - 1].1, m))
                    })
                    .map(|(_, &(f, m))| (f, self.hir(f)[m].func))
                    .collect();
                let scope = self.bound(file).fns[member.func.idx()].scope;
                let parent = self.bound(file).scopes[scope.idx()].parent;
                // `getObjectTypeInstantiation` asks `isTypeParameterPossiblyReferenced` of every declaration of the symbol, the
                // implementation of overloads included.
                let declarations: Vec<(FileId, FnId)> = members
                    .iter()
                    .map(|&(f, m)| (f, self.hir(f)[m].func))
                    .collect();
                let mapper = self.identity_mapper_for_fns(file, parent, &declarations);
                self.intern(TypeData::Fns {
                    decls: decls.into(),
                    mapper,
                })
            }
            MemberKind::Property | MemberKind::Getter | MemberKind::Setter => {
                if let Some(&(f, getter)) = members
                    .iter()
                    .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Getter)
                {
                    let func = self.hir(f)[getter].func;
                    // `getTypeOfAccessors`: what is written is read where it is written, without asking the function.
                    if self.hir(f)[func].ret.is_some() {
                        return self.type_from_node(f, self.hir(f)[func].ret);
                    }
                    // A getter without an annotation next to a setter with one has the setter's type.
                    if self.hir(f)[func].ret.is_none()
                        && let Some(&(sf, setter)) = members
                            .iter()
                            .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Setter)
                        && let Some(p) =
                            self.hir(sf)[self.hir(sf)[setter].func].params.iter().next()
                        && self.hir(sf)[p].ty.is_some()
                    {
                        return self.type_from_node(sf, self.hir(sf)[p].ty);
                    }
                    // `getTypeOfAccessors` calls `getReturnTypeFromBody` directly. The return type of the getter's signature is a
                    // separate resolution (`getReturnTypeOfSignature`), so a cycle through the property does not mark it.
                    let ty = self.return_type_of_fn_uncached(f, func);
                    return self.force(ty);
                }
                // What the parameter of a setter starts out as says nothing about the property.
                let setter = members
                    .iter()
                    .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Setter);
                let Some(&(f, setter)) = setter else {
                    return TypeId::ANY;
                };
                let hir = self.hir(f);
                match hir[hir[setter].func].params.iter().next() {
                    Some(p) if hir[p].ty.is_some() => self.type_from_node(f, hir[p].ty),
                    _ => TypeId::ANY,
                }
            }
            _ => TypeId::UNRESOLVED,
        }
    }

    /// `getESSymbolLikeTypeForNode` keeps one `unique symbol` for a symbol: of the declarations of the property `name` in the class
    /// or the interface that the member `m` is written in, the first to say `unique symbol` stands for all.
    fn unique_symbol_declaration(
        &self,
        file: FileId,
        m: MemberId,
        name: Atom,
    ) -> UniqueSymbolDeclaration {
        let (member, bound) = (&self.hir(file)[m], self.bound(file));
        let own = UniqueSymbolDeclaration::Member(file, m);
        let symbol = match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => bound.class_symbol[c.idx()],
            MemberOwner::Interface(i) => bound.interface_symbol[i.idx()],
            _ => return own,
        };
        if symbol.is_none() {
            return own;
        }
        for (f, decl) in self.files().decls(self.files().sym(file, symbol)) {
            let hir = self.hir(f);
            let members = match decl {
                Decl::Class(c) => hir[c].members,
                Decl::Interface(i) => hir[i].members,
                _ => continue,
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

    /// `links.uniqueESSymbolType` of the `const` that `pat` declares by the name `name`.
    pub(super) fn unique_symbol_of_variable(
        &mut self,
        file: FileId,
        pat: PatId,
        name: Atom,
    ) -> TypeId {
        let variable = self
            .files()
            .sym(file, self.bound(file).pat_symbol[pat.idx()]);
        self.intern(TypeData::UniqueSymbol {
            symbol: UniqueSymbolDeclaration::Variable(variable),
            name,
        })
    }

    /// `getESSymbolLikeTypeForNode` of the declaration `call` initializes: its unique symbol if `isValidESSymbolDeclaration`,
    /// otherwise `symbol`.
    pub(super) fn get_es_symbol_like_type_for_node(
        &mut self,
        file: FileId,
        call: ExprId,
    ) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[call.idx()] {
            Parent::VarInit(d) => {
                let decl = &hir[d];
                let stmt = bound.var_stmt[d.idx()];
                let PatKind::Ident(name) = hir[decl.pat].kind else {
                    return TypeId::SYMBOL;
                };
                if decl.kind != VarKind::Const
                    || stmt.is_none()
                    || !matches!(hir[stmt].kind, StmtKind::Var(_))
                    || matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(parent) if parent.is_some() && matches!(hir[parent].kind, StmtKind::For { init, .. } if init == stmt))
                {
                    return TypeId::SYMBOL;
                }
                self.unique_symbol_of_variable(file, decl.pat, name)
            }
            Parent::MemberInit(m) if hir[m].init == call => {
                let member = &hir[m];
                let Some(name) = member.key.name() else {
                    return TypeId::SYMBOL;
                };
                if member.kind != MemberKind::Property
                    || !member.flags.contains(Flags::READONLY)
                    || !member.flags.contains(Flags::STATIC)
                        && matches!(bound.member_owner[m.idx()], MemberOwner::Class(_))
                {
                    return TypeId::SYMBOL;
                }
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

    /// `isSymbolOrSymbolForCall`: `Symbol()` or `Symbol.for()`, of the global value of that name.
    pub(super) fn is_symbol_or_symbol_for_call(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let callee = match hir[hir[call].callee].kind {
            ExprKind::Dot { obj, name, .. } if self.files().atoms.bytes(name) == b"for" => obj,
            _ => hir[call].callee,
        };
        matches!(hir[callee].kind, ExprKind::Ident(known::Symbol))
            && self.bound(file).expr_symbol[callee.idx()].is_none()
            && self
                .files()
                .global(known::Symbol, SymFlags::VALUE)
                .is_some()
    }

    /// What `ty` looks like to a property access: the wrapper of a primitive, the constraint of a type parameter.
    #[inline]
    pub fn apparent_type(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Union(_) if !self.is_boolean(ty) => ty,
            data if is_plain_object(data) => ty,
            _ => self.apparent_type_of_other(ty),
        }
    }

    /// `apparent_type`, of what may look like something else.
    fn apparent_type_of_other(&mut self, ty: TypeId) -> TypeId {
        self.guard("apparent_type");
        let ty = self.force(ty);
        // What extends nothing extends `unknown`.
        let ty = if self.is_deferred(ty) {
            self.base_constraint(ty)
        } else {
            ty
        };
        let wrapper = match self.data(ty) {
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => return self.apparent_type_of_mapped(ty),
            // `getApparentTypeOfIntersectionType`: the intersection of what its members look like, so `T & {}` of a
            // `T extends A | undefined` is `A`. Where every member looks like an object the intersection stays as it is: its shape
            // is put together from what they look like, which is where `this` is seen to.
            TypeData::Intersection(parts) => {
                if parts.iter().any(|&p| self.is_deferred(p)) {
                    let mut distributes = false;
                    let mut looks: SmallVec<[TypeId; 8]> = SmallVec::new();
                    for &p in parts.iter() {
                        let look = if self.is_deferred(p) {
                            self.apparent_type(p)
                        } else {
                            p
                        };
                        distributes |= look != p
                            && !self.is_object_type(look)
                            && !matches!(self.data(look), TypeData::Intersection(_));
                        looks.push(look);
                    }
                    if distributes {
                        let whole = self.intersection(&looks);
                        if whole != ty {
                            return self.apparent_type(whole);
                        }
                    }
                }
                return ty;
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
            // `unknown` has nothing, not even what every object has, unless `null` and `undefined` are not told apart.
            _ if ty == TypeId::UNKNOWN && !self.p.files.options.strict_null_checks => {
                return TypeId::EMPTY_OBJECT;
            }
            _ => return ty,
        };
        self.wrapper_type(wrapper)
    }

    /// `global_ref(name, &[])`, kept.
    fn wrapper_type(&mut self, name: Atom) -> TypeId {
        if let Some(known) = self.p.wrapper_types.get(&name) {
            return known;
        }
        let ty = self.global_ref(name, &[]);
        self.p.wrapper_types.insert(name, ty)
    }

    /// `getResolvedBaseConstraint`: the widest type `ty` can be, with no type parameter left at the top. `unknown`: there is none.
    pub fn base_constraint(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        // Asked from outside, it starts a stack of its own.
        let around = std::mem::take(&mut self.constraint_stack);
        let result = self.next_base_constraint(ty);
        self.constraint_stack = around;
        result
    }

    /// `getNextBaseConstraint`: the same, for the sake of the constraint that is being worked out.
    pub(super) fn next_base_constraint(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        // `getBaseConstraintOfType`: the kinds that have one.
        let may_have_one = match self.data(ty) {
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
        if !may_have_one {
            return ty;
        }
        if let Some(known) = self.p.constraints.get(&ty) {
            return known;
        }
        if !self.enter(Query::Constraint(ty)) {
            // `pushTypeResolution` marks every entry from the start of the cycle to the top of the stack, whatever the kind of
            // type. Callers read `circular_constraints` while these entries are still on the stack.
            let from = self.resolution_start;
            if let Some(i) = self.stack[from..]
                .iter()
                .rposition(|q| *q == Query::Constraint(ty))
                .map(|i| i + from)
                && !self.eager.iter().any(|&eager| eager > i)
            {
                for j in i..self.stack.len() {
                    if let Query::Constraint(t) = self.stack[j] {
                        self.p.circular_constraints.insert(t, ());
                    }
                }
            }
            return TypeId::UNKNOWN;
        }
        // `computeBaseConstraint(getSimplifiedType(t, false))`: `{ [P in K]: E }[X]` is `E` with `X` for `P` before anything
        // gives way to what it extends.
        // At least 10 levels are gone into, and at most 50, and from 10 on none that is an instance of what one before it is.
        let identity = self.recursion_identity(ty);
        let depth = self.constraint_stack.len();
        let goes_on = depth < 10 || depth < 50 && !self.constraint_stack.contains(&identity);
        self.constraint_stack.push(identity);
        let t = if goes_on {
            self.simplified(ty, false)
        } else {
            TypeId::UNKNOWN
        };
        let result = match self.data(t) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) => {
                match self.constraint_of_type_param(t) {
                    Some(c) => self.next_base_constraint(c),
                    None => TypeId::UNKNOWN,
                }
            }
            TypeData::Union(members) => {
                let constraints: Vec<TypeId> = members
                    .iter()
                    .map(|&m| self.next_base_constraint(m))
                    .collect();
                if constraints[..] == members[..] {
                    t
                } else if constraints.contains(&TypeId::UNKNOWN) {
                    // `len(baseTypes) == len(types)`: `any` next to it would make `any` of the union.
                    TypeId::UNKNOWN
                } else {
                    self.union(&constraints)
                }
            }
            TypeData::Intersection(members) => {
                let constraints: Vec<TypeId> = members
                    .iter()
                    .map(|&m| self.next_base_constraint(m))
                    .collect();
                if constraints[..] == members[..] {
                    t
                } else {
                    self.intersection(&constraints)
                }
            }
            TypeData::IndexedAccess {
                obj,
                index,
                undefined,
            } => {
                let (obj, index, undefined) = (*obj, *index, *undefined);
                match self.substitute_indexed_mapped(obj, index) {
                    Some(template) => self.next_base_constraint(template),
                    None => {
                        let (obj, index) = (
                            self.next_base_constraint(obj),
                            self.next_base_constraint(index),
                        );
                        if obj == TypeId::UNKNOWN || index == TypeId::UNKNOWN {
                            TypeId::UNKNOWN
                        } else if let Some(simplified) =
                            self.simplified_access_to_intersection(obj, index)
                        {
                            self.next_base_constraint(simplified)
                        } else {
                            // `t.accessFlags`: read under noUncheckedIndexedAccess, what an index signature gives may be missing.
                            let found = self
                                .indexed_access_flagged(obj, index, undefined, None)
                                .unwrap_or(TypeId::UNKNOWN);
                            // `getNextBaseConstraint`: what is found there is looked into in its turn. Only `ty` is being resolved: a
                            // `t` that `getSimplifiedType` made of it has a constraint of its own.
                            let found = if found != t || t != ty {
                                self.next_base_constraint(found)
                            } else {
                                found
                            };
                            if self.is_deferred(found) {
                                TypeId::UNKNOWN
                            } else {
                                found
                            }
                        }
                    }
                }
            }
            TypeData::Keyof(of) => {
                // The keys of a generic mapped type that renames them, and is not written over `keyof`, are the names it gives.
                let renaming = match *self.data(*of) {
                    TypeData::Anon {
                        origin: Origin::Mapped(file, node),
                        mapper,
                    } => {
                        let mapped = self.mapped_decl(file, node);
                        let over = self.hir(file)[mapped.param].constraint;
                        let renames = mapped.name_ty.is_some()
                            && !matches!(self.hir(file)[over].kind, TypeNodeKind::Keyof(_));
                        renames.then_some((file, node, mapper))
                    }
                    _ => None,
                };
                match renaming {
                    // `getIndexTypeForMappedType`
                    Some((file, node, mapper)) => {
                        let mapped = self.mapped_decl(file, node);
                        let param = self.type_param(file, mapped.param);
                        let name = self.type_from_node(file, mapped.name_ty);
                        let keys = self.mapped_constraint(file, node, mapper);
                        let keys = self.force(keys);
                        let mut names = Vec::new();
                        for &key in self.parts(keys) {
                            let mut pairs = self.p.types.mapping(mapper).to_vec();
                            pairs.push((param, key));
                            let with_key = self.p.types.mapper(pairs);
                            let name = self.instantiate(name, with_key);
                            names.push(name);
                            // What is under any string is under any number.
                            if name == TypeId::STRING {
                                names.push(TypeId::NUMBER);
                            }
                        }
                        let names = self.union(&names);
                        self.next_base_constraint(names)
                    }
                    None => self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]),
                }
            }
            TypeData::Cond { file, node, mapper } => {
                self.constraint_of_conditional(*file, *node, *mapper)
            }
            // `base_constraint_of` has the two cases of `computeBaseConstraint` for these, and asks here about what is in them.
            TypeData::Template { .. } | TypeData::StringMapping { .. } => {
                self.base_constraint_of_as(t, true).unwrap_or(t)
            }
            &TypeData::Substitution { base, constraint } => {
                let both = self.substitution_intersection(base, constraint);
                self.next_base_constraint(both)
            }
            // A variadic element gives way to what it extends only if that is arrays and tuples with no variadic element of their own.
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) => {
                let mut new_elems = Vec::with_capacity(elems.len());
                for (&elem, flag) in elems.iter().zip(flags.iter()) {
                    let mut new_elem = elem;
                    if flag.contains(ElemFlags::VARIADIC)
                        && matches!(self.data(elem), TypeData::TypeParam(..))
                    {
                        let constraint = self.next_base_constraint(elem);
                        let fits = self.every_type(constraint, |c, n| {
                            c.is_array_or_tuple(n)
                                && !matches!(c.data(n), TypeData::Tuple { flags, .. } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)))
                        });
                        if constraint != elem && fits {
                            new_elem = constraint;
                        }
                    }
                    new_elems.push(new_elem);
                }
                self.distributed_tuple(&new_elems, flags, *readonly)
            }
            _ => t,
        };
        self.constraint_stack.pop();
        let is_cacheable = self.leave();
        // `!popTypeResolution()`: any resolution can close the cycle, and `resolvedBaseConstraint` is then cached as
        // `circularConstraintType`.
        if self.left_a_circle || self.p.circular_constraints.get(&ty).is_some() {
            self.p.circular_constraints.insert(ty, ());
            self.p.constraints.insert(ty, TypeId::UNKNOWN);
            return TypeId::UNKNOWN;
        }
        if is_cacheable {
            self.p.constraints.insert(ty, result);
        }
        result
    }

    /// The property `name` of an object type, an intersection, or what stands for a primitive.
    pub fn prop_of(&mut self, ty: TypeId, name: Atom) -> Option<(Prop, MapperId)> {
        self.prop_ref(ty, name)
            .map(|(prop, mapper)| (prop.clone(), mapper))
    }

    /// The same, where it is kept.
    pub fn prop_ref(&mut self, ty: TypeId, name: Atom) -> Option<(&'p Prop, MapperId)> {
        let members = self.members(ty)?;
        let prop = members.resolved.prop(name)?;
        if self.is_type_only_member(ty, name) {
            return None;
        }
        Some((prop, members.mapper))
    }

    /// `getPropertyOfTypeEx`: whether `ty` is the object of a module that has `name` only through `export type *`. It is listed
    /// among the properties, but it is not there for the asking, and nothing stands in for it.
    #[inline]
    pub(super) fn is_type_only_member(&self, ty: TypeId, name: Atom) -> bool {
        matches!(*self.data(ty), TypeData::Anon { origin: Origin::Module(module) | Origin::Namespace { module, .. }, .. } if self.files().is_type_only_star_export(module, name))
    }

    /// `ValueDeclaration`: what says where `prop` is declared. `None`: it is made up, or it stands for properties of the members of
    /// an intersection that are declared in several places (`createUnionOrIntersectionProperty`), those that are made up aside.
    pub(super) fn value_declaration(prop: &Prop) -> Option<&PropSource> {
        match &prop.source {
            // `addMemberForKeyTypeWorker` links `Declarations` to a mapped property, never a `ValueDeclaration`.
            PropSource::Type(_) | PropSource::Mapped(..) | PropSource::Copy(_, _, false) => None,
            PropSource::Copy(_, of, true) => of.iter().find_map(Self::value_declaration),
            PropSource::Intersected(_, parts) => {
                let mut declared = parts.iter().filter_map(Self::value_declaration);
                let first = declared.next()?;
                declared.all(|other| other == first).then_some(first)
            }
            source => Some(source),
        }
    }

    /// The source of a property of type `ty` that has the `Declarations` of the properties `of`, one after the other.
    /// `keeps_value_declaration`: and the `ValueDeclaration` and the `Parent` of the first (`createSymbolWithType`, and where
    /// `getSpreadSymbol` answers with the symbol itself), not only those (what `getSpreadSymbol` and `getSpreadType` make anew).
    pub(super) fn copy_of(ty: TypeId, of: &[&Prop], keeps_value_declaration: bool) -> PropSource {
        let declared = Self::declared_properties(of);
        if declared.is_empty() {
            return PropSource::Type(ty);
        }
        let has_value_declaration =
            keeps_value_declaration && Self::value_declaration(of[0]).is_some();
        PropSource::Copy(ty, declared.into(), has_value_declaration)
    }

    /// The symbols whose `Declarations` the properties `of` have, one after the other. None of them is made up, a copy,
    /// `Intersected` or `Mapped`.
    pub(super) fn declared_properties(of: &[&Prop]) -> Vec<Prop> {
        fn add_declared(prop: &Prop, declared: &mut Vec<Prop>) {
            match &prop.source {
                PropSource::Type(_) => {}
                PropSource::Copy(_, parts, _) | PropSource::Intersected(_, parts) => {
                    parts.iter().for_each(|part| add_declared(part, declared));
                }
                PropSource::Mapped(..) => {
                    declared.extend_from_slice(prop.declared_by_modifiers_property());
                }
                _ => declared.push(Prop {
                    mapper: MapperId::IDENTITY,
                    ..prop.clone()
                }),
            }
        }
        let mut declared = Vec::new();
        of.iter().for_each(|prop| add_declared(prop, &mut declared));
        declared
    }

    /// The member `written` of an object literal, or attribute of a JSX element, as it is when checked otherwise than
    /// `type_of_literal_prop` does: its symbol, with the type `ty`.
    pub(super) fn literal_member_of_type(
        file: FileId,
        written: PropId,
        name: Atom,
        ty: TypeId,
    ) -> Prop {
        let mut prop = Prop {
            name,
            flags: PropFlags::empty(),
            source: PropSource::Literal(file, written),
            mapper: MapperId::IDENTITY,
        };
        prop.source = Self::copy_of(ty, &[&prop], true);
        prop
    }

    /// Whether `ty` is an intersection nothing can be.
    #[inline]
    pub fn is_never_intersection(&mut self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Intersection(_)) && self.is_empty_intersection(ty)
    }

    /// `is_never_intersection`, of an intersection.
    fn is_empty_intersection(&mut self, ty: TypeId) -> bool {
        if self.has_type_variables(ty) && self.is_generic(ty) {
            return false;
        }
        if let Some(known) = self.p.never_intersections.get(&ty) {
            return known;
        }
        // Finding out takes looking at its properties, which can come back to asking. It is something until it turns out not to be.
        if self.never_in_progress.contains(&ty) {
            return false;
        }
        self.never_in_progress.push(ty);
        let cycles_before = self.cycles;
        let mut is_never = false;
        if let Some(members) = self.members(ty) {
            for prop in &members.shape().props {
                let PropSource::Intersected(_, parts) = &prop.source else {
                    continue;
                };
                // `isConflictingPrivateProperty`: private in some member, and declared in several places.
                if prop.flags.contains(PropFlags::PRIVATE)
                    && Self::value_declaration(prop).is_none()
                {
                    is_never = true;
                    break;
                }
                // `isDiscriminantWithNeverType`: `{ ok: true } & { ok: false }`. What may be left out tells nothing apart.
                if prop.flags.contains(PropFlags::OPTIONAL)
                    || !self.type_of_prop(prop, members.mapper).is_never()
                {
                    continue;
                }
                let mut list = Vec::with_capacity(parts.len());
                for part in parts.iter() {
                    list.push(self.type_of_prop(part, MapperId::IDENTITY));
                }
                if !list.iter().any(|t| t.is_never())
                    && list.iter().any(|&t| t != list[0])
                    && list.iter().any(|&t| {
                        self.is_boolean(t)
                            || self.is_pattern_literal(t)
                            || self.every_type(t, |c, m| c.is_unit(m))
                    })
                {
                    is_never = true;
                    break;
                }
            }
        }
        self.never_in_progress.pop();
        if self.cycles == cycles_before {
            self.p.never_intersections.insert(ty, is_never);
        }
        is_never
    }

    /// `ty` without the intersections nothing can be.
    #[inline]
    pub fn reduced(&mut self, ty: TypeId) -> TypeId {
        if self.p.types.flags(ty).contains(TypeFlags::MAY_BE_REDUCED) {
            self.reduced_members(ty)
        } else {
            ty
        }
    }

    /// `reduced`, of an intersection or a union with one among its members.
    fn reduced_members(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Intersection(_) if self.is_empty_intersection(ty) => TypeId::NEVER,
            TypeData::Union(_) => self.filter(ty, |c, m| !c.is_never_intersection(m)),
            _ => ty,
        }
    }

    /// The type of `ty.name`. `None`: there is no such property.
    pub fn type_of_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        self.property_type(ty, name, Access::Read)
            .map(|found| found.0)
    }

    /// The type of `ty.name` where it is only written to: the target of `=`, of a destructuring assignment, of `for..of`.
    pub fn write_type_of_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        self.property_type(ty, name, Access::Written)
            .map(|found| found.0)
    }

    /// The type of `ty.name` where it is the target of an assignment without being only written to: a property is what is read
    /// from it, and an index signature takes what it says.
    pub(super) fn type_of_property_for_write(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        self.property_type(ty, name, Access::Assigned)
            .map(|found| found.0)
    }

    /// `prop` or `indexInfo` of `checkPropertyAccessExpressionOrQualifiedName`: the type, and which of the two it is the type of.
    pub(super) fn property_type(
        &mut self,
        ty: TypeId,
        name: Atom,
        access: Access,
    ) -> Option<(TypeId, Found)> {
        let (found, how) = self.find_property(ty, name, access)?;
        // `noUncheckedIndexedAccess`: what is read through an index signature may not be there.
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

    /// `checkPropertyAccessExpressionOrQualifiedName`: the type of the property `name` of `ty`, or failing that of the index
    /// signature that stands in for it, and which of the two it is.
    fn find_property(&mut self, ty: TypeId, name: Atom, access: Access) -> Option<(TypeId, Found)> {
        if is_plain_object(self.data(ty)) {
            return self.find_property_in(ty, ty, name, access);
        }
        self.guard("type_of_property");
        let ty = self.force(ty);
        if self.is_any(ty) {
            return Some((ty, Found::Property));
        }
        let ty = self.reduced(ty);
        if let TypeData::Union(parts) = self.data(ty) {
            // `createUnionOrIntersectionProperty`: some member has it, and the others have something to stand in for it.
            let is_symbol = self.files().atoms.is_symbol_name(name);
            let mut types: SmallVec<[TypeId; 8]> = SmallVec::new();
            // `indexTypes`
            let mut stand_ins: SmallVec<[TypeId; 4]> = SmallVec::new();
            let (mut is_property, mut is_restricted, mut is_partial) = (false, false, false);
            // `writeTypes`: whether some member takes something else than it gives.
            let mut takes_another = false;
            for &part in parts.iter() {
                match self.find_property(part, name, access) {
                    Some((found, Found::ByIndex)) => {
                        // No index signature stands in for what goes by a symbol.
                        is_partial |= is_symbol;
                        // Past the fixed elements of a tuple there is what the rest of it holds, and nothing where it ends.
                        stand_ins.push(self.beyond_fixed_elements(part).unwrap_or(found));
                    }
                    Some((found, how)) => {
                        is_property = true;
                        is_restricted |= how == Found::Restricted;
                        takes_another |= access == Access::Written
                            && self
                                .find_property(part, name, Access::Assigned)
                                .is_some_and(|read| read.0 != found);
                        types.push(found);
                    }
                    // An object literal that does not mention it does not have it.
                    None if self.is_closed_object_literal_type(part) => {
                        stand_ins.push(TypeId::UNDEFINED)
                    }
                    // What nothing can be has no say.
                    None if self.apparent_type(part).is_never() => {}
                    None => return None,
                }
            }
            if is_property {
                if is_partial || is_restricted && self.is_hidden_in_union(parts, name) {
                    return None;
                }
                // What is written is then what the members that have the property take, and that is all.
                if !takes_another {
                    types.extend_from_slice(&stand_ins);
                }
                return Some((
                    self.union(&types),
                    if is_restricted {
                        Found::Restricted
                    } else {
                        Found::Property
                    },
                ));
            }
            // No member has it: what is left is the index signatures that all of them have.
            let index = self.union_index_infos(parts);
            if index.is_empty() {
                return None;
            }
            let whole = self.synth(Shape {
                index,
                ..Shape::default()
            });
            let members = self.members(whole)?;
            let value = self.applicable_index_type_for_name(&members, name)?;
            return Some((self.force(value), Found::ByIndex));
        }
        // `getReducedApparentType`: with what a type parameter extends in its place, an intersection may be one that nothing can be.
        let apparent = self.apparent_type(ty);
        let apparent = if apparent == ty {
            apparent
        } else {
            self.reduced(apparent)
        };
        self.find_property_in(ty, apparent, name, access)
    }

    /// `find_property`, of a `ty` that is no union and looks like `apparent`.
    fn find_property_in(
        &mut self,
        ty: TypeId,
        apparent: TypeId,
        name: Atom,
        access: Access,
    ) -> Option<(TypeId, Found)> {
        // Nothing is written through an index signature of what a type parameter extends.
        let is_closed = access != Access::Read
            && !matches!(self.data(ty), TypeData::ThisParam(_))
            && self.is_generic_object_type(ty);
        if apparent != ty && (self.is_union(apparent) || self.is_any(apparent)) {
            return self
                .find_property(apparent, name, access)
                .filter(|found| !(is_closed && found.1 == Found::ByIndex));
        }
        let members = self.members(apparent)?;
        if self.is_type_only_member(apparent, name) {
            return None;
        }
        if let Some(mut prop) = members.resolved.prop(name) {
            let mut mapper = members.mapper;
            let is_through_constraint = apparent != ty && self.is_deferred(ty);
            // In a member found through what a type parameter extends, `this` is the type parameter.
            if is_through_constraint && let TypeData::Ref { target, .. } = self.data(apparent) {
                let this = self.intern(TypeData::ThisParam(*target));
                let mut pairs = self.p.types.mapping(mapper).to_vec();
                for pair in &mut pairs {
                    if pair.0 == this {
                        pair.1 = ty;
                    }
                }
                mapper = self.p.types.mapper(pairs);
            }
            // A tuple is a reference too: what it has from `Array` is found there, with the type parameter for `this`.
            if is_through_constraint
                && name != known::length
                && !self.is_numeric_name(name)
                && let TypeData::Tuple {
                    elems,
                    flags,
                    readonly,
                } = self.data(apparent)
            {
                let array = self.tuple_base_type(elems, flags, *readonly);
                let array = self.type_with_this_argument(array, ty);
                if let Some(of_array) = self.prop_ref(array, name) {
                    (prop, mapper) = of_array;
                }
            }
            let how = if prop
                .flags
                .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
            {
                Found::Restricted
            } else {
                Found::Property
            };
            let found = if access == Access::Written {
                self.write_type_of_prop(prop, mapper)
            } else {
                self.type_of_prop(prop, mapper)
            };
            return Some((found, how));
        }
        // `getPropertyOfTypeEx`: what every function and every object has comes before any index signature. It is not looked
        // for in a `const enum`.
        if !self.is_const_enum_object(apparent)
            && let Some((prop, mapper)) = self.property_in(&members, name)
        {
            return Some((self.type_of_prop(prop, mapper), Found::Property));
        }
        if is_closed {
            return None;
        }
        let value = self.applicable_index_type_for_name(&members, name)?;
        Some((self.force(value), Found::ByIndex))
    }

    /// `getRestTypeOfTupleType` of what `ty` looks like, if that is a tuple: what its elements from the first that is not fixed on
    /// hold, `undefined` if all are fixed.
    fn beyond_fixed_elements(&mut self, ty: TypeId) -> Option<TypeId> {
        let apparent = self.apparent_type(ty);
        let TypeData::Tuple { elems, flags, .. } = self.data(apparent) else {
            return None;
        };
        let fixed = flags
            .iter()
            .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
            .unwrap_or(flags.len());
        Some(if fixed < flags.len() {
            self.tuple_element_union(&elems[fixed..], &flags[fixed..])
        } else {
            TypeId::UNDEFINED
        })
    }

    /// `isConstEnumObjectType`
    pub(super) fn is_const_enum_object(&self, ty: TypeId) -> bool {
        matches!(*self.data(ty), TypeData::Anon { origin: Origin::EnumObject(sym), .. }
            if self.files().decls(sym).iter().any(|&(f, d)| matches!(d, Decl::Enum(id) if self.hir(f)[id].flags.contains(Flags::CONST))))
    }

    /// `createUnionOrIntersectionProperty`: what is private or protected in one member of a union, and missing from another or
    /// declared elsewhere there, is not a property of the union.
    pub(super) fn is_hidden_in_union(&mut self, parts: &[TypeId], name: Atom) -> bool {
        // (file, id, whether it is a parameter)
        fn declarations(prop: &Prop, out: &mut Vec<(FileId, u32, bool)>) {
            match &prop.source {
                PropSource::Members(list) => {
                    out.extend(list.iter().map(|&(file, member)| (file, member.0, false)))
                }
                PropSource::Parameter(file, param) => out.push((*file, param.0, true)),
                PropSource::Intersected(_, props) => {
                    props.iter().for_each(|p| declarations(p, out))
                }
                _ => {}
            }
        }
        let (mut is_restricted, mut is_partial) = (false, false);
        let mut found: SmallVec<[(&'p Prop, MapperId); 8]> = SmallVec::new();
        for &part in parts {
            let part = self.apparent_type(part);
            if part.is_never() || !self.is_known(part) {
                continue;
            }
            // What a type parameter that extends a union has is not looked into.
            if self.is_union(part) {
                return false;
            }
            match self.prop_ref(part, name) {
                Some(prop) => {
                    is_restricted |= prop
                        .0
                        .flags
                        .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED);
                    found.push(prop);
                }
                None => is_partial = true,
            }
        }
        let Some(((first, first_mapper), rest)) = found.split_first() else {
            return false;
        };
        if !is_restricted {
            return false;
        }
        // Instantiations of one property that come to one type are one property, which is there unless some member lacks it.
        let first_type = self.type_of_prop(first, *first_mapper);
        let mut is_one = true;
        for (prop, mapper) in rest {
            if prop.source != first.source || self.type_of_prop(prop, *mapper) != first_type {
                is_one = false;
                break;
            }
        }
        if is_one {
            return is_partial;
        }
        // `hasCommonDeclaration`
        let mut common = Vec::new();
        declarations(first, &mut common);
        let mut other = Vec::new();
        for (prop, _) in rest {
            other.clear();
            declarations(prop, &mut other);
            common.retain(|d| other.contains(d));
        }
        common.is_empty()
    }

    /// `getApplicableIndexInfoForName`: a name that stands for a symbol is a symbol to an index signature.
    pub(super) fn applicable_index_type_for_name(
        &mut self,
        members: &Members,
        name: Atom,
    ) -> Option<TypeId> {
        if self.files().atoms.is_symbol_name(name) {
            return self.applicable_index_info(members, TypeId::SYMBOL, None);
        }
        // No index signature stands in for the `#x` of a class (`checkPropertyAccessExpressionOrQualifiedName`). A string that
        // starts with `#` is a string like another: it is the renaming that tells.
        if self.is_private_name(name)
            && self.written_name(name).len() < self.files().atoms.bytes(name).len()
        {
            return None;
        }
        self.applicable_index_info(members, TypeId::STRING, Some(name))
    }

    /// The value type of the index signature that covers keys of type `key` (the property `name`, if it is one).
    pub fn applicable_index_info(
        &mut self,
        members: &Members,
        key: TypeId,
        name: Option<Atom>,
    ) -> Option<TypeId> {
        self.applicable_index(members, key, name)
            .map(|info| info.value)
    }

    /// `findApplicableIndexInfo`: the index signature that covers keys of type `key` (the property `name`, if it is one), with its
    /// value type instantiated for `members`.
    pub fn applicable_index(
        &mut self,
        members: &Members,
        key: TypeId,
        name: Option<Atom>,
    ) -> Option<IndexInfo> {
        // `string & {}` is a string, to a signature for strings.
        let plain = match self.data(key) {
            TypeData::Intersection(parts) => parts
                .iter()
                .copied()
                .find(|&p| self.is_primitive(p))
                .unwrap_or(key),
            _ => key,
        };
        // The signature for strings counts only where no other applies.
        let mut by_string = None;
        let mut found: Option<IndexInfo> = None;
        // The value types, if more than one applies.
        let mut several = Vec::new();
        for info in &members.shape().index {
            // `isApplicableIndexType`. What can be anything, and what nothing can be, is a key of every kind.
            let applies = if self.is_any(key) || key.is_never() {
                true
            } else if info.key == TypeId::STRING {
                self.is_string_like(plain) || self.is_number_like(plain)
            } else if info.key == TypeId::NUMBER {
                self.is_number_like(plain)
                    || self.is_numeric_string_type(key)
                    || name.is_some_and(|n| self.is_numeric_name(n))
            } else if info.key == TypeId::SYMBOL {
                self.is_symbol_like(plain)
            } else {
                match name {
                    // The name of a number or of a symbol is no string to a pattern.
                    Some(n) if self.is_string_like(plain) => {
                        let literal = self.string_literal(n, false);
                        self.is_assignable(literal, info.key)
                    }
                    _ => self.is_assignable(key, info.key),
                }
            };
            if !applies {
                continue;
            }
            let info = IndexInfo {
                value: self.instantiate(info.value, members.mapper),
                ..*info
            };
            if info.key == TypeId::STRING {
                by_string = Some(info);
                continue;
            }
            found = Some(match found {
                None => info,
                // Together they are one that is declared nowhere. It can only be read if none of them can be written to.
                Some(first) => {
                    if several.is_empty() {
                        several.push(first.value);
                    }
                    several.push(info.value);
                    IndexInfo::new(
                        TypeId::UNKNOWN,
                        first.value,
                        first.readonly && info.readonly,
                    )
                }
            });
        }
        match found {
            None => by_string,
            Some(found) if !several.is_empty() => Some(IndexInfo {
                value: self.intersection(&several),
                ..found
            }),
            found => found,
        }
    }

    /// `numericStringType`: `${number}`
    pub fn is_numeric_string_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Template { texts, types } if types[..] == [TypeId::NUMBER] && texts.iter().all(|&t| t == known::empty))
    }

    /// `isNumericLiteralName`: as a number and then as a string again, the name is what it was.
    pub fn is_numeric_name(&self, name: Atom) -> bool {
        let text = self.files().atoms.bytes(name);
        // What a number is written as begins with a digit or a `-`, or it is one of two words.
        match text.first().copied() {
            Some(b'0'..=b'9') => {
                // An integer that a number holds exactly is written as its digits.
                if text.len() <= 15 && text.iter().all(u8::is_ascii_digit) {
                    return text[0] != b'0' || text.len() == 1;
                }
            }
            Some(b'-') => {}
            Some(b'I') => return text == b"Infinity",
            Some(b'N') => return text == b"NaN",
            _ => return false,
        }
        std::str::from_utf8(text)
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .is_some_and(|n| crate::atom::number_to_string(n).as_bytes() == text)
    }

    /// The call or construct signatures of `ty`.
    pub fn signatures(&mut self, ty: TypeId, construct: bool) -> List<'p, SigId> {
        // Call signatures at the even places, construct signatures at the odd ones.
        let at = (ty.0 as usize * 2 + usize::from(construct)) % RECENT_SIGNATURES;
        let recent = self.recent_signatures[at];
        if recent.0 == ty {
            return List::Kept(recent.1);
        }
        let p = self.p;
        let kept = if construct {
            &p.construct_signatures
        } else {
            &p.call_signatures
        };
        if let Some(known) = kept.get_ref(&ty) {
            let known: &'p [SigId] = known;
            self.recent_signatures[at] = (ty, known);
            return List::Kept(known);
        }
        let before = self.what_only_holds_for_now();
        let signatures = self.signatures_uncached(ty, construct);
        if self.what_only_holds_for_now() == before {
            let known: &'p [SigId] = kept.insert_ref(ty, signatures.into()).1;
            self.recent_signatures[at] = (ty, known);
            return List::Kept(known);
        }
        List::Own(signatures)
    }

    fn signatures_uncached(&mut self, ty: TypeId, construct: bool) -> Vec<SigId> {
        self.guard("signatures");
        // `getReducedApparentType`: an intersection nothing can be has no signatures.
        let ty = self.reduced(ty);
        let ty = self.apparent_type(ty);
        let ty = self.reduced(ty);
        // `resolveUnionTypeMembers`: once for a union. Putting the signatures of many members together is quadratic in them.
        if self.is_union(ty) {
            let resolved = self.shape_memo(ty, |c| {
                // `t.Types()` are in the order of `CompareTypes`.
                let parts = c.parts(ty);
                Shape {
                    call: c.signatures_of_union(parts, false),
                    construct: c.signatures_of_union(parts, true),
                    ..Shape::default()
                }
            });
            return if construct {
                resolved.resolved.shape.construct.clone()
            } else {
                resolved.resolved.shape.call.clone()
            };
        }
        let Some(members) = self.members(ty) else {
            return Vec::new();
        };
        let sigs = if construct {
            &members.shape().construct
        } else {
            &members.shape().call
        };
        sigs.iter()
            .map(|&s| self.instantiate_sig(s, members.mapper))
            .collect()
    }

    /// `getUnionSignatures`, over the signatures of each of `parts`.
    fn signatures_of_union(&mut self, parts: &[TypeId], construct: bool) -> Vec<SigId> {
        {
            let mut lists = Vec::with_capacity(parts.len());
            for &part in parts.iter() {
                // `unknownSignature`: `Function` itself can be called with nothing, and returns the error type.
                let sigs = if !construct
                    && self
                        .is_global_ref(part, known::Function)
                        .is_some_and(|args| args.is_empty())
                {
                    vec![self.p.types.intern_sig(SigData::Synth {
                        type_params: Box::new([]),
                        params: Box::new([]),
                        ret: TypeId::ERROR,
                        this: None,
                        of: Box::new([]),
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
    }

    /// `getArrayMemberCallSignatures`: a method of `A[] | B[]` whose signatures do not come together is called as that of
    /// `(A | B)[]`. `parts`: the members of the union that the method is.
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
            let MemberOwner::Interface(i) = bound.member_owner[member.idx()] else {
                return Vec::new();
            };
            if bound.interface_symbol[i.idx()].is_none() || hir[i].type_params.len() != 1 {
                return Vec::new();
            }
            let owner = Some(self.files().sym(file, bound.interface_symbol[i.idx()]));
            let is_readonly = owner == self.global_type_symbol(known::ReadonlyArray);
            if !is_readonly && owner != self.global_type_symbol(known::Array) {
                return Vec::new();
            }
            let name = self.declared_member_name(file, hir[member].key);
            if name.is_none() || *method.get_or_insert(name) != name {
                return Vec::new();
            }
            // What the type parameter of the array stands for there.
            let param = self.type_param(file, hir[i].type_params.at(0));
            match self.p.types.map(*mapper, param) {
                Some(element) if element != param => elements.push(element),
                _ => return Vec::new(),
            }
            readonly |= is_readonly;
        }
        let Some(Some(name)) = method else {
            return Vec::new();
        };
        let element = self.union(&elements);
        let array = if readonly {
            self.readonly_array_of(element)
        } else {
            self.array_of(element)
        };
        match self.type_of_property(array, name) {
            Some(method) => self.signatures(method, false).into_vec(),
            None => Vec::new(),
        }
    }

    /// `getUnionSignatures`: the ways to call something that is one of several things, each with its own ways.
    pub(super) fn union_signatures(&mut self, lists: &[Vec<SigId>]) -> Vec<SigId> {
        // Where all have the same ways each stands for itself, but for one whose parameters are those of one before it.
        if lists.iter().all(|l| *l == lists[0]) {
            let mut result: Vec<SigId> = Vec::with_capacity(lists[0].len());
            for &sig in &lists[0] {
                if self
                    .find_matching_signature(&result, sig, false, true)
                    .is_none()
                {
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
                // Only those whose parameters are not among the results yet.
                if self
                    .find_matching_signature(&result, sig, false, true)
                    .is_some()
                {
                    continue;
                }
                let Some(matching) = self.find_matching_signatures(lists, sig, i) else {
                    continue;
                };
                if let [_] = matching[..] {
                    result.push(sig);
                    continue;
                }
                // What comes back is what any of them gives back, and `this` has to be all that any of them asks for.
                let mut returns = Vec::with_capacity(matching.len());
                let mut these = Vec::new();
                for &m in &matching {
                    returns.push(self.sig_return(m));
                    these.extend(self.sig_this_type(m));
                }
                let ret = self.union_reduced(&returns);
                let this = if these.is_empty() {
                    None
                } else {
                    Some(self.intersection(&these))
                };
                let params = self.sig_params(sig);
                // `createUnionSignature`: a clone of `sig`, which comes first.
                let mut of = vec![sig];
                of.extend(matching.iter().copied().filter(|&m| m != sig));
                result.push(self.p.types.intern_sig(SigData::Synth {
                    type_params: Box::new([]),
                    params: params.into(),
                    ret,
                    this,
                    of: of.into(),
                }));
            }
        }
        if !result.is_empty() || count_with_overloads > 1 {
            return result;
        }
        // None does for all. With overloads in one member at most, each of them is combined with what the others have.
        let mut results = lists[index_with_overloads].clone();
        for (i, list) in lists.iter().enumerate() {
            if i == index_with_overloads {
                continue;
            }
            let sig = list[0];
            let type_params = self.sig_type_params(sig);
            if !type_params.is_empty() {
                let around = self.mapper_around_sig(sig);
                for &r in &results {
                    let others = self.sig_type_params(r);
                    if others.is_empty() {
                        continue;
                    }
                    let around_other = self.mapper_around_sig(r);
                    if !self.type_parameters_identical_around(
                        &type_params,
                        around,
                        &others,
                        around_other,
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
            // Of a generic one only the very same will do, and it is taken from the first list.
            if list_index > 0 {
                return None;
            }
            for list in &lists[1..] {
                self.find_matching_signature(list, sig, false, false)?;
            }
            return Some(vec![sig]);
        }
        let mut result = Vec::with_capacity(lists.len());
        for (i, list) in lists.iter().enumerate() {
            let matching = if i == list_index {
                sig
            } else {
                match self.find_matching_signature(list, sig, false, true) {
                    Some(exact) => exact,
                    // One that takes less will do, failing that.
                    None => self.find_matching_signature(list, sig, true, true)?,
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
        partial_match: bool,
        ignore_return_types: bool,
    ) -> Option<SigId> {
        list.iter().copied().find(|&s| {
            self.compare_signatures_identical(s, sig, partial_match, false, ignore_return_types)
        })
    }

    /// `compareSignaturesIdentical`, comparing types for identity, or with `partial_match` for being subtypes.
    pub(super) fn compare_signatures_identical(
        &mut self,
        source: SigId,
        target: SigId,
        partial_match: bool,
        ignore_this_types: bool,
        ignore_return_types: bool,
    ) -> bool {
        if source == target {
            return true;
        }
        let (sp, tp) = (self.sig_params(source), self.sig_params(target));
        // `isMatchingSignature`
        let (source_least, target_least) =
            (self.min_argument_count(&sp), self.min_argument_count(&tp));
        let same_shape = self.parameter_count(&sp) == self.parameter_count(&tp)
            && source_least == target_least
            && self.has_effective_rest_parameter(&sp) == self.has_effective_rest_parameter(&tp);
        if !same_shape && !(partial_match && source_least <= target_least) {
            return false;
        }
        let compare = |c: &mut Self, s: TypeId, t: TypeId| {
            if partial_match {
                c.is_subtype(s, t)
            } else {
                c.is_identical(s, t)
            }
        };
        let (source_type_params, target_type_params) =
            (self.sig_type_params(source), self.sig_type_params(target));
        if source_type_params.len() != target_type_params.len() {
            return false;
        }
        let mut source = source;
        let (source_around, target_around) = if target_type_params.is_empty() {
            (MapperId::IDENTITY, MapperId::IDENTITY)
        } else {
            (
                self.mapper_around_sig(source),
                self.mapper_around_sig(target),
            )
        };
        if source_type_params != target_type_params || source_around != target_around {
            // What a declared type parameter extends and defaults to is filled in in the one step in which it is renamed.
            let renaming = self.mapper_from(&source_type_params, &target_type_params);
            let mut pairs = self.p.types.mapping(source_around).to_vec();
            pairs.extend(
                source_type_params
                    .iter()
                    .copied()
                    .zip(target_type_params.iter().copied()),
            );
            let renaming_as_declared = self.p.types.mapper(pairs);
            for (&s, &t) in source_type_params.iter().zip(&target_type_params) {
                if s == t && source_around == target_around {
                    continue;
                }
                let source_mapper = if self.is_declared_type_param(s) {
                    renaming_as_declared
                } else {
                    renaming
                };
                let target_mapper = if self.is_declared_type_param(t) {
                    target_around
                } else {
                    MapperId::IDENTITY
                };
                let bounds = [
                    (
                        self.constraint_of_type_param(s),
                        self.constraint_of_type_param(t),
                    ),
                    (self.default_of_type_param(s), self.default_of_type_param(t)),
                ];
                for (a, b) in bounds {
                    let a = self.instantiate(a.unwrap_or(TypeId::UNKNOWN), source_mapper);
                    let b = self.instantiate(b.unwrap_or(TypeId::UNKNOWN), target_mapper);
                    // What is not known makes no difference.
                    if self.is_known(a) && self.is_known(b) && !compare(self, a, b) {
                        return false;
                    }
                }
            }
            if source_type_params != target_type_params {
                source =
                    self.with_own_type_params(source, &source_type_params, &target_type_params);
            }
        }
        if !ignore_this_types
            && let (Some(s), Some(t)) = (self.sig_this_type(source), self.sig_this_type(target))
            && !compare(self, s, t)
        {
            return false;
        }
        let sp = self.sig_params(source);
        for i in 0..self.parameter_count(&tp) {
            let s = self.param_type_at(&sp, i).unwrap_or(TypeId::ANY);
            let t = self.param_type_at(&tp, i).unwrap_or(TypeId::ANY);
            if !compare(self, t, s) {
                return false;
            }
        }
        if ignore_return_types {
            return true;
        }
        match (self.sig_predicate(source), self.sig_predicate(target)) {
            (None, None) => {
                let (s, t) = (self.sig_return(source), self.sig_return(target));
                compare(self, s, t)
            }
            (Some(s), Some(t)) => {
                s.param == t.param
                    && s.asserts == t.asserts
                    && match (s.ty, t.ty) {
                        (Some(a), Some(b)) => compare(self, a, b),
                        (None, None) => true,
                        _ => false,
                    }
            }
            _ => false,
        }
    }

    /// What stands for the type parameters around `sig` where it was found. The type parameters of a method come with that filled
    /// in (`cloneTypeParameter`). Those of a class, which are those of its construct signatures, are not made anew: what they
    /// extend and default to is seen through this.
    fn mapper_around_sig(&mut self, sig: SigId) -> MapperId {
        match *self.p.types.sig(sig) {
            SigData::Decl { mapper, .. }
            | SigData::Construct { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. } => mapper,
            SigData::WithReturn { sig: inner, .. } => self.mapper_around_sig(inner),
            // The type parameters of the signature of a union are those of the first it stands for that has any.
            SigData::Synth { ref of, .. } => {
                for &part in of.iter() {
                    if !self.sig_type_params(part).is_empty() {
                        return self.mapper_around_sig(part);
                    }
                }
                MapperId::IDENTITY
            }
        }
    }

    /// Whether `param` is a type parameter as declared, not one made anew for where its signature was found.
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
        self.type_parameters_identical_around(
            source,
            MapperId::IDENTITY,
            target,
            MapperId::IDENTITY,
        )
    }

    /// The same, of the type parameters of signatures found where `source_around` and `target_around` say what stands for the type
    /// parameters around them.
    fn type_parameters_identical_around(
        &mut self,
        source: &[TypeId],
        source_around: MapperId,
        target: &[TypeId],
        target_around: MapperId,
    ) -> bool {
        if source.len() != target.len() {
            return false;
        }
        // What a declared type parameter extends is filled in in the one step in which it is renamed.
        let renaming = self.mapper_from(target, source);
        let mut pairs = self.p.types.mapping(target_around).to_vec();
        pairs.extend(target.iter().copied().zip(source.iter().copied()));
        let renaming_as_declared = self.p.types.mapper(pairs);
        for (&s, &t) in source.iter().zip(target) {
            if s == t && source_around == target_around {
                continue;
            }
            let sc = self.constraint_of_type_param(s).unwrap_or(TypeId::UNKNOWN);
            let sc = if self.is_declared_type_param(s) {
                self.instantiate(sc, source_around)
            } else {
                sc
            };
            let tc = self.constraint_of_type_param(t).unwrap_or(TypeId::UNKNOWN);
            let tc = self.instantiate(
                tc,
                if self.is_declared_type_param(t) {
                    renaming_as_declared
                } else {
                    renaming
                },
            );
            // What is not known makes no difference.
            if self.is_known(sc) && self.is_known(tc) && !self.is_identical(sc, tc) {
                return false;
            }
        }
        true
    }

    /// `combineUnionOrIntersectionParameters`. Each parameter is a new symbol: it has a name and no declaration.
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
        // `minArgumentCount`: the greater of the two as declared, where a rest parameter counts for nothing, tuple or not. Here it
        // is what may be left out that says how many arguments it takes.
        let least = Self::min_args(left).max(Self::min_args(right));
        let mut params = Vec::with_capacity(longest_count + 1);
        for i in 0..longest_count {
            // `tryGetTypeAtPosition`: where one of them takes nothing, that counts as `unknown`.
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
                String::new()
            };
            let right_name = if i < right_count {
                self.parameter_name_at_position(right, i)
            } else {
                String::new()
            };
            let name = if left_name == right_name || right_name.is_empty() {
                left_name
            } else if left_name.is_empty() {
                right_name
            } else {
                String::new()
            };
            let name = if name.is_empty() {
                format!("arg{i}")
            } else {
                name
            };
            params.push(SigParam {
                name: self.files().atoms.intern(name.as_bytes()),
                ty: if is_rest {
                    self.array_of(combined)
                } else {
                    combined
                },
                optional: !is_rest && i >= least,
                rest: is_rest,
                has_declaration: false,
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
                rest: true,
                has_declaration: false,
            });
        }
        params
    }

    /// `combineUnionOrIntersectionMemberSignatures`: of a union, parameters intersect and results unite; of an intersection the
    /// other way round.
    pub(super) fn combine_member_signatures(
        &mut self,
        left: SigId,
        right: SigId,
        is_union: bool,
    ) -> SigId {
        let (left_type_params, right_type_params) =
            (self.sig_type_params(left), self.sig_type_params(right));
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
        let (lp, rp) = (self.sig_params(left), self.sig_params(right));
        let params = self.combine_union_or_intersection_parameters(&lp, &rp, is_union);
        // `getReturnTypeOfSignature`, of a composite
        let (a, b) = (self.sig_return(left), self.sig_return(right));
        let ret = if is_union {
            self.union_reduced(&[a, b])
        } else {
            self.intersection(&[a, b])
        };
        // `combineUnionOrIntersectionThisParam`: like a parameter.
        let this = match (self.sig_this_type(left), self.sig_this_type(right)) {
            (Some(l), Some(r)) => Some(if is_union {
                self.intersection(&[l, r])
            } else {
                self.union(&[l, r])
            }),
            (l, r) => l.or(r),
        };
        // `Signature.composite`. `of` has no `isUnion`: whoever reads it takes it for the members of a union.
        let mut of: Vec<SigId> = Vec::new();
        if is_union {
            match self.p.types.sig(left) {
                SigData::Synth { of: members, .. } if !members.is_empty() => {
                    of.extend_from_slice(members);
                }
                _ => of.push(left),
            }
            of.push(right);
        }
        self.p.types.intern_sig(SigData::Synth {
            type_params: type_params.into(),
            params: params.into(),
            ret,
            this,
            of: of.into(),
        })
    }
}

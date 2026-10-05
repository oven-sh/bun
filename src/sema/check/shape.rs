//! The members of an object type: properties, signatures, index signatures.

use super::relate::Ternary;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, SymbolId};
use crate::table::Handle;
use smallvec::{SmallVec, smallvec};

/// `thisAssignmentDeclarationKind`, with its location.
#[derive(Copy, Clone)]
pub(super) enum ThisAssignmentDeclaration {
    None,
    Typed(TypeNodeId),
    Constructor(FnId),
    Method,
}

/// A declaration of a property that does not say what the property is.
#[derive(Copy, Clone)]
pub(super) enum UntypedProperty {
    Member(MemberId),
    /// `f.name = value`, `this.name = value`, or `Object.defineProperty(f, "name", descriptor)`.
    Assignment(ExprId),
}

/// Hash index from name to position in a property list. Used for more than `FEW` properties:
/// shorter lists are scanned linearly. `P`: in the arena for the index that is stored with a shape,
/// a box for that of a `Builder`.
#[derive(Default)]
struct Names<P> {
    /// 0, or the position of a property plus one. The length is a power of two, at least twice the
    /// number of properties.
    places: P,
}

const FEW: usize = 8;

impl<'s> Names<ArenaBox<'s, [u32]>> {
    fn of(props: &ArenaVec<'s, Prop<'s>>) -> Self {
        if props.len() <= FEW {
            return Names::default();
        }
        let places = std::iter::repeat_n(0, (props.len() * 2).next_power_of_two());
        let mut names = Self {
            places: ArenaBox::from_iter_in(places, props.allocator()),
        };
        names.add_all(props);
        names
    }
}

impl Names<Box<[u32]>> {
    /// Empty, with capacity for `count` properties.
    fn with_capacity(count: usize) -> Self {
        Names {
            places: vec![0; (count * 2).next_power_of_two()].into_boxed_slice(),
        }
    }
}

impl<P: std::ops::DerefMut<Target = [u32]>> Names<P> {
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

    /// Adds `props[at]`, unless a property with its name exists.
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

pub struct Resolved<'s> {
    pub shape: Shape<'s>,
    names: Names<ArenaBox<'s, [u32]>>,
}

/// Every field is named, so that a new one is a compile error. `names` is derived from `shape`, so it is not shown.
impl crate::types::Follow for Resolved<'_> {
    fn visit<V: crate::types::Visitor>(&self, visitor: &mut V) {
        let Resolved { shape, names: _ } = self;
        shape.visit(visitor);
    }
    fn follow(&mut self, link: &crate::types::Link) {
        let Resolved { shape, names } = self;
        let has_own_names = shape.props.iter().any(|prop| prop.name.is_own());
        shape.follow(link);
        // The slots are indexed by a hash of the atom ids, which have changed.
        if has_own_names && shape.props.len() > FEW {
            names.places.fill(0);
            names.add_all(&shape.props);
        }
    }
}

impl<'s> Resolved<'s> {
    fn new(shape: Shape<'s>) -> Resolved<'s> {
        Resolved {
            names: Names::of(&shape.props),
            shape,
        }
    }

    #[inline]
    pub fn prop(&self, name: Atom) -> Option<&Prop<'s>> {
        let props = &self.shape.props;
        if props.len() > FEW {
            return self.names.find(props, name).map(|at| &props[at]);
        }
        props.iter().find(|p| p.name == name)
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
    pub fn shape(&self) -> &'p Shape<'p> {
        &self.resolved.shape
    }
}

pub(super) const RECENT_MEMBERS: usize = 512;
pub(super) const RECENT_SIGNATURES: usize = 256;
pub(super) const RECENT_PROPS: usize = 256;

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

/// `Members` as cached for a type: the handle of the shape, and the mapper.
#[derive(Copy, Clone)]
pub(super) struct CachedMembers {
    /// Of `Program::shapes`.
    shape: Handle,
    mapper: MapperId,
}

crate::types::follow_struct!(CachedMembers { shape, mapper });

impl CachedMembers {
    /// Used when publishing, which replaces it with the handle of the published shape.
    pub(super) fn shape_mut(&mut self) -> &mut Handle {
        &mut self.shape
    }
}

/// A shape, and its handle in the store if it is final.
#[derive(Copy, Clone)]
struct Built<'p> {
    resolved: &'p Resolved<'p>,
    kept: Option<Handle>,
}

/// The kind of result of a property lookup by name.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Found {
    Property,
    /// A property that is private or protected.
    Restricted,
    /// There is no such property: an index signature applies instead.
    ByIndex,
}

/// How the looked-up property is used (`getAssignmentTargetKind`, `accessKind`).
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Access {
    Read,
    /// `IsWriteOnlyAccess`
    Written,
}

/// Which of the members of a declaration: only a class has a static side (`declareClassMember`).
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ClassSide {
    Instance,
    Static,
}

/// How far `getResolvedMembersOrExportsOfSymbol` has got with the members of a declaration.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum MemberBinding {
    /// `earlySymbols`: only the members the binder can name, without checking any expression.
    Early,
    /// Also the members with late-bound names.
    Late,
}

/// Whether the shape of a class or an interface has the members of its base types
/// (`resolveObjectTypeMembers`), or only those it declares (`resolveDeclaredMembers`).
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

/// What `get_spread_symbol` is told besides the property.
#[derive(Copy, Clone)]
pub(super) struct SpreadSymbolOptions {
    /// `has_type_variables` of the type that has the property.
    pub(super) owner_is_generic: bool,
    /// `readonly` of `getSpreadSymbol`.
    pub(super) readonly: bool,
    /// The caller calls `getTypeOfSymbol` for the result.
    pub(super) resolves: bool,
}

/// Whether it is an object type that a property access reads directly: any but a mapped type.
#[inline]
fn is_plain_object(data: &TypeData) -> bool {
    let is_mapped = matches!(
        data,
        TypeData::Anon {
            origin: Origin::Mapped(..),
            ..
        }
    );
    super::relate::is_object_kind(data) && !is_mapped
}

/// Collects properties by name, in the order they are first seen.
struct Builder<'s> {
    shape: Shape<'s>,
    /// Position of each property, while there are more than `FEW`. Empty otherwise.
    names: Names<Box<[u32]>>,
    /// The keys of the index signatures that computed names implied.
    implied: Vec<TypeId>,
    /// The static members with computed names and those with other names, by name: the arguments
    /// of `add_index_signatures_of_computed_names`, which the static side of a class calls once all
    /// its members are in place.
    static_names: Option<StaticNames>,
}

type StaticNames = (FileId, Vec<MemberId>, Vec<(Atom, SmallVec<[MemberId; 4]>)>);

impl<'s> Builder<'s> {
    fn new_in(arena: &'s Arena) -> Builder<'s> {
        Builder {
            shape: Shape::new_in(arena),
            names: Names::default(),
            implied: Vec::new(),
            static_names: None,
        }
    }
    /// Position of the property `name`.
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
    /// Reserves capacity for `more` properties.
    fn reserve(&mut self, more: usize) {
        self.shape.props.reserve_exact(more);
        let all = self.shape.props.len() + more;
        if all > FEW && all * 2 > self.names.places.len() {
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
    /// Adds a property whose name is not present yet.
    fn add_new(&mut self, prop: Prop<'s>) {
        self.shape.props.push(prop);
        let count = self.shape.props.len();
        if count <= FEW {
            return;
        }
        if count * 2 > self.names.places.len() {
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
            self.names.places.fill(0);
            if self.shape.props.len() > FEW {
                self.names.add_all(&self.shape.props);
            }
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `getTypeArguments` for a reference to a class or an interface, an array type or a tuple
    /// type.
    #[inline]
    pub fn type_arguments(&mut self, ty: TypeId) -> &'p [TypeId] {
        match self.resolved_type_arguments(ty) {
            Some(resolved) => resolved,
            None if self.types().deferred(ty).is_some() => self.resolve_type_arguments(ty),
            None => &[],
        }
    }

    /// `d.resolvedTypeArguments` of a reference or a tuple type, if they are resolved.
    #[inline]
    fn resolved_type_arguments(&mut self, ty: TypeId) -> Option<&'p [TypeId]> {
        let p = self.p;
        match self.data(ty) {
            TypeData::Ref { args, .. } | TypeData::Tuple { elems: args, .. } => match args.actual()
            {
                Some(actual) => Some(actual),
                None => (p.resolved_type_arguments.get_ref(&self.task, &ty)).map(|it| &it[..]),
            },
            _ => None,
        }
    }

    /// `getTypeArguments` for a deferred type reference whose arguments are not resolved yet.
    #[cold]
    #[inline(never)]
    fn resolve_type_arguments(&mut self, ty: TypeId) -> &'p [TypeId] {
        let Some(deferred) = self.types().deferred(ty) else {
            return &[];
        };
        let (file, node, mapper) = (deferred.file, deferred.node, deferred.mapper);
        // Encloses the resolution frame: the arguments are instantiated after `popTypeResolution`,
        // and the result depends on that too.
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
                        // The declared type failed too: the native stack is exhausted. Callers
                        // index by the length: an array type has an element type.
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
        let holds = self.leave(Query::TypeArguments(ty)).is_ok();
        if self.left_a_cycle {
            // `popTypeResolution` fails.
            let errors = self.list_of(std::iter::repeat_n(TypeId::ERROR, declared.len()));
            let stored = (self.end_scope_as(scope, false)).unwrap_or_else(|_| self.cycle_result());
            let p = self.p;
            let resolved: &'p [TypeId] = (p
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
        // `d.resolvedTypeArguments = ..`, whatever members were in place: a default type argument
        // can need a member of the reference itself. See `members_in_place_hits`.
        let in_place = self.members_in_place_hits - in_place;
        let is_final = self.non_cacheable_mark() == (before.0 + in_place, before.1);
        let is_open = !(holds && is_outermost && is_final);
        match self.end_scope_as(scope, is_open) {
            Ok(stored) => {
                let p = self.p;
                (p.resolved_type_arguments
                    .insert_ref(&self.task, ty, instantiated, stored))
                .1
            }
            Err(_) => self.provisional_type_arguments(ty, &instantiated),
        }
    }

    /// `arguments`, for a result about `ty` that is not cacheable: stored as the arguments of
    /// `createTypeReference(ty.Target(), arguments)`.
    fn provisional_type_arguments(&mut self, ty: TypeId, arguments: &[TypeId]) -> &'p [TypeId] {
        let reference = self.create_type_reference(ty, arguments);
        self.resolved_type_arguments(reference).unwrap_or(&[])
    }

    /// `createTypeReference(ty.Target(), arguments)`. A type that is not a reference is returned
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

    /// `ty` for callers outside inference: `NoInfer<T>`, on its own or in a union, is `T`.
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

    /// A shape that is not final. It lives until `release_provisional_shapes`.
    fn provisional_shape(&mut self, shape: Shape<'s>) -> Built<'p> {
        let resolved = Box::new(Resolved::new(shape));
        // SAFETY: a box does not move its contents, and it is dropped by
        // `release_provisional_shapes`, which is only called where no `Members` is live: between
        // files.
        let provisional: &'p Resolved<'p> = unsafe { &*std::ptr::from_ref(&*resolved) };
        self.provisional_shapes.push(resolved);
        Built {
            resolved: provisional,
            kept: None,
        }
    }

    /// No value returned by `members` may be live.
    pub(super) fn release_provisional_shapes(&mut self) {
        debug_assert!(self.stack.is_empty());
        self.provisional_shapes.clear();
    }

    /// `meanwhile`: the result for callers that re-enter while `build` is running.
    fn shape_memo_or(
        &mut self,
        key: TypeId,
        build: impl FnOnce(&mut Self) -> Shape<'s>,
        meanwhile: impl FnOnce(&mut Self) -> Shape<'s>,
    ) -> Built<'p> {
        if let Some(kept) = self.p.shapes.handle(&self.task, &key) {
            return Built {
                resolved: self.p.shapes.at(&self.task, kept),
                kept: Some(kept),
            };
        }
        // `resolveDeclaredMembers` has the members in place before it requests the index
        // signatures. Resolving them again in the meantime is not a circular resolution: nothing is
        // pushed, and the result returned is provisional.
        if (self.declared_index_infos_in_progress.iter())
            .any(|it| self.stack.get(it.0 - 1) == Some(&Query::Shape(key)))
        {
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
        if let Some(raw) = self.provisional(Query::Shape(key)) {
            // SAFETY: a pointer returned by `provisional_shape`. `check_file` clears `provisional` before it calls `release_provisional_shapes`.
            let resolved = unsafe { &*(raw as usize as *const Resolved) };
            return Built {
                resolved,
                kept: None,
            };
        }
        if !self.enter(Query::Shape(key)) {
            // `enter` also fails for lack of stack space.
            let is_in_progress = !self.is_stack_low()
                && self.stack[self.resolution_start..].contains(&Query::Shape(key));
            let shape = if is_in_progress {
                meanwhile(self)
            } else {
                Shape::new_in(self.arena)
            };
            return self.provisional_shape(shape);
        }
        let mut shape = build(self);
        match self.leave(Query::Shape(key)) {
            Ok(stored) => {
                shape.props.shrink_to_fit();
                shape.call.shrink_to_fit();
                shape.construct.shrink_to_fit();
                shape.index.shrink_to_fit();
                let resolved = Resolved::new(shape);
                let (kept, resolved) =
                    (self.p.shapes).insert_ref(&self.task, key, resolved, stored);
                Built {
                    resolved,
                    kept: Some(kept),
                }
            }
            Err(open) => {
                let built = self.provisional_shape(shape);
                let raw = std::ptr::from_ref(built.resolved) as usize as u64;
                self.cache_provisionally(Query::Shape(key), raw, open);
                built
            }
        }
    }

    /// The members of an object type or an intersection of them. `None` for anything else.
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

    /// `members` for a type that was not queried recently.
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

    /// `resolveStructuredTypeMembers` of a type reference that has `ObjectFlagsUnresolvedMembers`:
    /// the members that its class or interface declares. `mapper`: of the members of `ty`.
    /// `None`: `ty` is no such type reference. See `unresolved_members`.
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
        // What follows from this answer is valid until that `compose` returns.
        self.lowest_unresolved_members_hit = self.lowest_unresolved_members_hit.min(at as u32);
        self.unresolved_members_hits += 1;
        self.mark_tainted_by_pattern_from(self.unresolved_members[at].1 as usize);
        self.note_members_in_place();
        let shape = self.build_declared_shape(
            target,
            MapperId::IDENTITY,
            MemberBinding::Late,
            BaseMembers::Omitted,
        );
        Some(Members {
            resolved: self.provisional_shape(shape).resolved,
            mapper,
        })
    }

    /// `members` for a type with no cached entry.
    fn members_on_cache_miss(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let scope = self.begin_scope();
        let built = self.members_uncached(ty);
        // The entry is cached exactly when the shape is.
        let is_open = !built.is_some_and(|(built, _)| built.kept.is_some());
        let ended = self.end_scope_as(scope, is_open);
        let (built, mapper) = built?;
        if let (Some(shape), Ok(stored)) = (built.kept, ended) {
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
                            kept: None,
                        },
                        members.mapper,
                    )
                })
            }
            TypeData::Ref { target, .. } => {
                let target = *target;
                let declared = self.declared_type(target);
                if !matches!(self.data(declared), TypeData::Ref { .. }) {
                    return None;
                }
                let (params, args) = (self.type_arguments(declared), self.type_arguments(ty));
                // By value: `args` can be provisional while the final arguments are stored.
                let are_provisional = self.resolved_type_arguments(ty) != Some(args);
                // `resolveTypeReferenceMembers`: the arguments correspond to the outer type
                // parameters of the declaration, then its own, then `this`. Without an argument for
                // `this` it is the type the member is looked up in.
                let this = args.get(params.len()).copied().unwrap_or(ty);
                let actual = if declared == ty {
                    0
                } else {
                    params.len().min(args.len())
                };
                let mut pairs: Vec<(TypeId, TypeId)> = Vec::with_capacity(actual + 1);
                pairs.extend(
                    params
                        .iter()
                        .copied()
                        .zip(args.iter().copied())
                        .take(actual),
                );
                pairs.push((self.intern(TypeData::ThisParam(target)), this));
                let mapper = self.types().mapper(pairs);
                // All instantiations share the shape of the declared type, unless their base types
                // depend on the type arguments.
                let (key, under) = if declared != ty && self.inherits_from_type_arguments(target) {
                    (ty, mapper)
                } else {
                    (declared, MapperId::IDENTITY)
                };
                // `getResolvedMembersOrExportsOfSymbol`: while the late-bound names are being
                // resolved, the members with literal names are available.
                let mut resolved = self.shape_memo_or(
                    key,
                    |c| {
                        if are_provisional && key == ty {
                            c.mark_tainted_from(c.frames.len() - 1);
                        }
                        let binding = MemberBinding::Late;
                        c.build_declared_shape(target, under, binding, BaseMembers::Inherited)
                    },
                    |c| {
                        let binding = MemberBinding::Early;
                        c.build_declared_shape(target, under, binding, BaseMembers::Inherited)
                    },
                );
                // `mapper` is built from them.
                if are_provisional {
                    resolved.kept = None;
                }
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
                let resolved = self.shape_memo_or(
                    key,
                    |c| c.build_origin_shape(origin, MemberBinding::Late),
                    |c| c.origin_shape_in_the_meantime(origin),
                );
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
                    self.intern_key(TypeKey::Fns {
                        decls,
                        mapper: identity,
                    })
                };
                let resolved = self.shape_memo(key, |c| {
                    let mut shape = Shape::new_in(self.arena);
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
                let resolved = self.shape_memo(ty, |_| (**shape).clone_in(self.arena));
                Some((resolved, MapperId::IDENTITY))
            }
            TypeData::ReverseMapped { source, mapped, of } => {
                let (source, mapped, of) = (*source, *mapped, *of);
                let resolved =
                    self.shape_memo(ty, |c| c.build_reverse_mapped_shape(ty, source, mapped, of));
                Some((resolved, MapperId::IDENTITY))
            }
            TypeData::Tuple { .. } => self.tuple_members(ty, ty),
            TypeData::Intersection(parts) => {
                let resolved = self.shape_memo(ty, |c| c.build_intersection_shape(ty, parts));
                Some((resolved, MapperId::IDENTITY))
            }
            _ => None,
        }
    }

    /// The identity mapper over the same type parameters.
    fn identity_of(&mut self, mapper: MapperId) -> MapperId {
        let mapping = self.types().mapping(mapper);
        if mapping.iter().all(|p| p.0 == p.1) {
            return mapper;
        }
        self.types()
            .mapper(mapping.iter().map(|p| (p.0, p.0)).collect())
    }

    // ───────────────────────────── building ─────────────────────────────

    fn member_flags(member: &Member) -> PropFlags {
        let mut flags = PropFlags::empty();
        if member.flags.contains(Flags::OPTIONAL) {
            flags |= PropFlags::OPTIONAL;
        }
        // `isReadonlySymbol`: the modifier counts on a `SymbolFlagsProperty` only.
        if member.flags.contains(Flags::READONLY)
            && member.kind == MemberKind::Property
            && !member.flags.contains(Flags::ACCESSOR)
        {
            flags |= PropFlags::READONLY;
        }
        if member.flags.contains(Flags::PRIVATE) {
            flags |= PropFlags::PRIVATE;
        }
        if member.flags.contains(Flags::PROTECTED) {
            flags |= PropFlags::PROTECTED;
        }
        if member.flags.contains(Flags::ABSTRACT) {
            flags |= PropFlags::ABSTRACT;
        }
        match member.kind {
            MemberKind::Method => flags |= PropFlags::METHOD,
            MemberKind::Getter | MemberKind::Setter => flags |= PropFlags::ACCESSOR,
            // `bindPropertyWorker`: an `accessor` field is a getter and a setter.
            MemberKind::Property if member.flags.contains(Flags::ACCESSOR) => {
                flags |= PropFlags::ACCESSOR;
                // `getTypeOfAccessors`
                if member.flags.contains(Flags::OPTIONAL) {
                    flags |= PropFlags::WITHOUT_OPTIONALITY;
                }
            }
            _ => {}
        }
        flags
    }

    /// The name of a member, if it is statically known. A computed name is determined by the type
    /// of the expression alone, as in an object literal or a binding pattern
    /// (`checkComputedPropertyName`, `isTypeUsableAsPropertyName`).
    pub fn member_name(&mut self, file: FileId, key: PropKey) -> Option<Atom> {
        match key {
            PropKey::Name(name) | PropKey::Private(name) => Some(name),
            PropKey::Computed(e) => {
                // `[Symbol.iterator]`, unless `Symbol` is shadowed: the property of that name of
                // the global `Symbol`, without checking the expression. Very common in the default
                // libraries.
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

    /// Whether the computed name `[e]` of a member of a class, an interface or a type literal can
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
        let text = crate::atom::number_to_string(n);
        self.atoms().intern(&text)
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
        // Only a class has a static side (`declareClassMember`): elsewhere the modifier is an error
        // and has no effect.
        let has_static_side = !members
            .iter()
            .next()
            .is_some_and(|m| self.is_declared_outside_classes(file, m));
        // Declarations with one name form one property.
        let mut groups: Vec<(Atom, SmallVec<[MemberId; 4]>)> = Vec::new();
        // Members whose computed name resolves to any string, number or symbol.
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
                    b.shape.call.push(self.sig_of_fn(file, member.func));
                }
                MemberKind::ConstructSignature => {
                    b.shape.construct.push(self.sig_of_fn(file, member.func));
                }
                MemberKind::IndexSignature => {
                    // `getIndexInfosOfIndexSymbol`: one parameter, with a type. Only what can be a key counts, as it is written.
                    let f = &hir[member.func];
                    if f.params.len() != 1 || hir[f.params.at(0)].ty.is_none() {
                        continue;
                    }
                    // `resolveDeclaredMembers`: a caller that resolves the members while their index
                    // signatures are being resolved gets the members without index signatures.
                    let is_static = member.flags.contains(Flags::STATIC);
                    if (self.declared_index_infos_in_progress.iter()).any(|it| {
                        it.1 == file
                            && members.range().contains(&it.2.idx())
                            && hir[it.2].kind == MemberKind::IndexSignature
                            && hir[it.2].flags.contains(Flags::STATIC) == is_static
                    }) {
                        continue;
                    }
                    // With `early` the innermost query is not the one for these members.
                    if !early {
                        self.declared_index_infos_in_progress
                            .push((self.stack.len(), file, m));
                    }
                    let keys = self.type_from_node(file, hir[f.params.at(0)].ty);
                    let value = if member.ty.is_some() {
                        self.type_from_node(file, member.ty)
                    } else {
                        TypeId::ANY
                    };
                    if !early {
                        self.declared_index_infos_in_progress.pop();
                    }
                    for &key in self.parts(keys) {
                        if !self.is_valid_index_key_type(key) {
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
                            // The first index signature for a key type wins, unless it was implied
                            // by computed names: a declared one takes precedence.
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
                        });
                    }
                }
                MemberKind::StaticBlock => {}
            }
        }
        // A caller that resolves the members while their index signatures are being resolved gets
        // the members without index signatures.
        if !computed.is_empty()
            && !(self.declared_index_infos_in_progress.iter())
                .any(|it| (it.1, it.2) == (file, computed[0]))
        {
            // `getMembersOfSymbol`: the instance member table also holds the type parameters, the
            // constructor and the signatures.
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
            if want_static {
                b.static_names = Some((file, computed, groups.clone()));
            } else {
                let holds_more = has_type_params || members.iter().any(has_nameless);
                self.declared_index_infos_in_progress
                    .push((self.stack.len(), file, computed[0]));
                self.add_index_signatures_of_computed_names(
                    b,
                    file,
                    &computed,
                    &groups,
                    holds_more,
                    &[],
                );
                self.declared_index_infos_in_progress.pop();
            }
        }
        b.reserve(groups.len());
        // Whether a name is late bound among the instance members, and among the static ones.
        // Computed once for all of them.
        let mut is_late_bound = [None; 2];
        for (name, group) in groups {
            let sym = self.symbol_of_member(file, group[0]);
            let is_static = self.hir(file)[group[0]].flags.contains(Flags::STATIC);
            let is_late_bound = !early
                && match is_late_bound[is_static as usize] {
                    Some(known) => known,
                    None => {
                        let bound = self.bound(file);
                        let own = bound.symbol_of_declaration(Decl::Member(group[0]));
                        let parent = bound.symbols[own.idx()].parent;
                        let known = parent.is_some()
                            && (self.late_bound_members(self.files().sym(file, parent), is_static))
                                .is_some();
                        is_late_bound[is_static as usize] = Some(known);
                        known
                    }
                };
            // All its declarations, across all declarations of the class or the interface.
            // Overloads of a merged interface stay in declaration order; call resolution reorders
            // them (`reorder_candidates`).
            let list = if is_late_bound {
                self.members_of_symbol(sym)
            } else {
                members_among(&self.files().decls_of(sym))
            };
            let prop = Prop {
                name,
                flags: self.flags_of_declarations(&list),
                source: PropSource::Symbol(sym),
                mapper: MapperId::IDENTITY,
            };
            match b.position(name) {
                None => b.add_new(prop),
                // The same symbol again, in another declaration of the class or the interface, or a
                // symbol that `declareSymbolEx` or `mergeSymbol` rejected: the first declaration
                // determines the property, except for its optionality.
                Some(i) => {
                    let there = &mut b.shape.props[i];
                    let mut other = prop.flags;
                    // A parameter property and a member of one name are one symbol.
                    // `symbol.ValueDeclaration` determines it.
                    if there.source == prop.source
                        && matches!(
                            self.files().value_declaration(sym),
                            Some((_, Decl::Member(_)))
                        )
                    {
                        other = std::mem::replace(&mut there.flags, other);
                    }
                    if other.contains(PropFlags::OPTIONAL)
                        && !there.flags.contains(PropFlags::OPTIONAL)
                    {
                        let is_method = there.flags.contains(PropFlags::METHOD);
                        there.flags |= PropFlags::OPTIONAL;
                        (there.flags).set(PropFlags::WITHOUT_OPTIONALITY, !is_method);
                    }
                }
            }
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

    /// The flags of one property, computed from its declarations `list`, which are in source order.
    fn flags_of_declarations(&self, list: &[(FileId, MemberId)]) -> PropFlags {
        let kind = |&(f, m): &(FileId, MemberId)| self.hir(f)[m].kind;
        // `getDeclarationModifierFlagsFromSymbol`: the first declaration determines them, except
        // that a getter takes precedence over a setter.
        let (file, says) = match kind(&list[0]) {
            MemberKind::Setter => list
                .iter()
                .copied()
                .find(|d| kind(d) == MemberKind::Getter)
                .unwrap_or(list[0]),
            _ => list[0],
        };
        let mut flags = Self::member_flags(&self.hir(file)[says]);
        // Only in a class is anything private or protected: elsewhere the modifier is an error and
        // has no effect.
        if self.is_declared_outside_classes(file, says) {
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
            // type is (`getTypeForVariableLikeDeclaration`). `getTypeOfAccessors` adds none.
            let (f, first) = list[0];
            if !flags.contains(PropFlags::METHOD)
                && (!self.hir(f)[first].flags.contains(Flags::OPTIONAL)
                    || self.has_get_or_set_accessor(list)
                    || (list.iter()).any(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ACCESSOR)))
            {
                flags |= PropFlags::WITHOUT_OPTIONALITY;
            }
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

    /// `getIndexInfosOfIndexSymbol`: `[k] = v` with a `k` of type string, number or symbol implies
    /// an index signature for that key type, together with the sibling members whose names match
    /// that key type. `holds_more`: the siblings also include something that is not a property.
    /// `others`: the siblings that are not among `named`, with their types.
    fn add_index_signatures_of_computed_names(
        &mut self,
        b: &mut Builder<'s>,
        file: FileId,
        computed: &[MemberId],
        named: &[(Atom, SmallVec<[MemberId; 4]>)],
        holds_more: bool,
        others: &[(Atom, TypeId)],
    ) {
        let hir = self.hir(file);
        // For string, number and symbol keys: the value types, and whether all contributing members
        // are readonly.
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
            if b.shape.index.iter().any(|i| i.key == key) {
                continue;
            }
            // A key that is not definitely a number or a symbol counts as a string.
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
            // `getObjectLiteralIndexInfo`: the string index signature covers every member that is
            // not named by a symbol (`isSymbolWithSymbolName`), including those named by a number.
            // An `any` key can be a number and a symbol.
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
        // `getTypeOfSymbol` of a type parameter, a constructor or a signature is the error type.
        // None of them is named by a number or a symbol.
        if holds_more {
            found[0].1.push(TypeId::ERROR);
        }
        for (name, group) in named {
            let is_symbol = self.atoms().is_symbol_name(*name);
            let is_numeric = self.is_numeric_name(*name);
            if !(found[0].3 && !is_symbol || found[1].3 && is_numeric || found[2].3 && is_symbol) {
                continue;
            }
            let prop = Prop {
                name: *name,
                flags: Self::member_flags(&hir[group[0]]),
                source: PropSource::Symbol(self.symbol_of_member(file, group[0])),
                mapper: MapperId::IDENTITY,
            };
            let value = self.type_of_prop(&prop, MapperId::IDENTITY);
            // `isSymbolWithComputedName`. `["a"]` is stored as a plain name.
            let name_start = hir[group[0]].name_pos;
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
        for &(name, value) in others {
            if self.atoms().is_symbol_name(name) {
                found[2].1.push(value);
            } else {
                found[0].1.push(value);
                if self.is_numeric_name(name) {
                    found[1].1.push(value);
                }
            }
        }
        for (kind, (key, values, readonly, exists)) in found.into_iter().enumerate() {
            if !exists || b.shape.index.iter().any(|i| i.key == key) {
                continue;
            }
            let value = if values.is_empty() {
                TypeId::UNDEFINED
            } else {
                self.union_reduced(&values)
            };
            b.shape.index.push(IndexInfo {
                key,
                value,
                readonly,
                declaration: None,
                components: self.types().intern_components(&components[kind]),
            });
            b.implied.push(key);
        }
    }

    /// `#x`: mangled for the class that declares it (`#x@<file>.<class>`), or unmangled where no
    /// enclosing class declares it.
    pub(super) fn is_private_name(&self, name: Atom) -> bool {
        self.atoms().bytes(name).first() == Some(&b'#')
    }

    /// `IsPrivateIdentifierSymbol`: identified by the mangling. A string that starts with `#` is an
    /// ordinary string.
    pub(super) fn is_private_identifier_symbol(&self, name: Atom) -> bool {
        self.is_private_name(name) && self.written_name(name).len() < self.atoms().bytes(name).len()
    }

    /// `SymbolName`: the `#x` of a private name; any other name unchanged.
    pub(super) fn written_name(&self, name: Atom) -> &'p [u8] {
        let text = self.atoms().bytes(name);
        if text.first() == Some(&b'#') {
            &text[..bun_core::strings::index_of_char_usize(text, b'@').unwrap_or(text.len())]
        } else {
            text
        }
    }

    /// `isStaticPrivateIdentifierProperty`
    pub(super) fn is_static_private_name(&self, prop: &Prop) -> bool {
        matches!(self.value_declaration_of_prop(prop), Some((file, Decl::Member(m))) if {
            let member = &self.hir(file)[m];
            matches!(member.key, PropKey::Private(_)) && member.flags.contains(Flags::STATIC)
        })
    }

    /// `isSpreadableProperty`: a property counts as an own property if it is not a method, an
    /// accessor or a `#x`, or if it is not declared in a class.
    pub(super) fn is_spreadable_property(&self, prop: &Prop) -> bool {
        // Whether some declaration is in a class, and whether some is named `#x`.
        fn written(
            c: &Checker<'_, '_>,
            source: &PropSource,
            in_class: &mut bool,
            is_private: &mut bool,
        ) {
            match source {
                PropSource::Symbol(sym) => {
                    for &(file, decl) in c.files().decls_of(*sym).iter() {
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
                    .for_each(|part| written(c, &part.source, in_class, is_private)),
                _ => {}
            }
        }
        let (mut in_class, mut is_private) = (false, false);
        written(self, &prop.source, &mut in_class, &mut is_private);
        // `createUnionOrIntersectionProperty`: a property that several members of an intersection
        // have is never a method.
        let kinds = match prop.source {
            PropSource::Intersected(..) => PropFlags::ACCESSOR,
            _ => PropFlags::METHOD | PropFlags::ACCESSOR,
        };
        !in_class || !is_private && !prop.flags.intersects(kinds)
    }

    /// `getTypeWithThisArgument`: `ty` with `this_argument` substituted for `this` in its members.
    /// It is appended to the type arguments of a reference, where `members` finds it. An
    /// intersection is mapped member by member.
    pub(super) fn type_with_this_argument(&mut self, ty: TypeId, this_argument: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Ref { target, .. } => {
                let declared = self.declared_type(*target);
                let args = self.type_arguments(ty);
                if !matches!(self.data(declared), TypeData::Ref { .. })
                    || self.type_arguments(declared).len() != args.len()
                {
                    return ty;
                }
                let with_this: SmallVec<[TypeId; 8]> =
                    args.iter().copied().chain([this_argument]).collect();
                self.intern_key(TypeKey::Ref {
                    target: *target,
                    args: &with_this,
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
            // It has no slot for the argument (`tuple_members_with_this`). Recreated, it has no
            // alias.
            TypeData::Tuple { .. } => self.without_alias_of_reference(ty),
            _ => ty,
        }
    }

    /// `resolveTypeReferenceMembers` for a tuple: the shape `createTupleTargetType` builds, cached
    /// per element flags, and the mapper for its type parameters and for `this`. `None`: `ty` is
    /// not a tuple.
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
        let mut pairs: Vec<(TypeId, TypeId)> = Vec::with_capacity(flags.len() + 1);
        let arguments = self.type_arguments(ty);
        for (i, &argument) in (0..).zip(arguments) {
            let parameter = self.intern(TypeData::Marker(Marker::TupleElement(i)));
            pairs.push((parameter, argument));
        }
        let parameters: Vec<TypeId> = pairs.iter().map(|pair| pair.0).collect();
        let this = self.intern(TypeData::Marker(Marker::TupleThis));
        let target = self.intern_key(TypeKey::Tuple {
            elems: &parameters,
            flags,
            readonly: *readonly,
        });
        let mut resolved = self.shape_memo(target, |c| {
            c.build_tuple_shape(this, &parameters, flags, *readonly)
        });
        // The mapper is built from `arguments`. They are provisional unless they are the stored
        // ones.
        if self.resolved_type_arguments(ty) != Some(arguments) {
            resolved.kept = None;
        }
        pairs.push((this, this_argument));
        Some((resolved, self.types().mapper(pairs)))
    }

    /// `resolveStructuredTypeMembers(getTypeWithThisArgument(ty, this_argument))`
    fn members_with_this(&mut self, ty: TypeId, this_argument: TypeId) -> Option<Members<'p>> {
        if let Some((built, mapper)) = self.tuple_members(ty, this_argument) {
            return Some(Members {
                resolved: built.resolved,
                mapper,
            });
        }
        let ty = self.type_with_this_argument(ty, this_argument);
        self.members(ty)
    }

    /// The members `resolveObjectTypeMembers` inherits from one base type.
    fn inherit(&mut self, b: &mut Builder<'s>, base: TypeId, this: Option<(Sym, TypeId)>) {
        // `anyBaseTypeIndexInfo`
        if base == TypeId::ANY {
            if !b.shape.index.iter().any(|i| i.key == TypeId::STRING) {
                b.shape
                    .index
                    .push(IndexInfo::new(TypeId::STRING, TypeId::ANY, false));
            }
            return;
        }
        // `getPropertiesOfType`, `getSignaturesOfType`, `getIndexInfosOfType`: applied to
        // `getReducedApparentType`. For a union, the members common to all its constituents.
        let base = self.reduced_apparent_type(base);
        let base = if self.is_union(base) {
            self.union_as_object(base)
        } else {
            base
        };
        // `this` in an inherited member is the derived type.
        let members = match this {
            Some((_, this_param)) => self.members_with_this(base, this_param),
            None => self.members(base),
        };
        let Some(members) = members else { return };
        let mapper = members.mapper;
        b.reserve(members.shape().props.len());
        // The mapper of the most recent property that had its own, and its composition with
        // `mapper`.
        let mut composed = (MapperId::IDENTITY, mapper);
        for prop in &members.shape().props {
            if b.has(prop.name) {
                continue;
            }
            let mut prop = prop.clone_in(self.arena);
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

    /// Whether "the members of a base type, instantiated" are not "the members of the instantiated
    /// base type" for the class or interface `sym`: a base type is a type parameter
    /// (`isValidBaseType`), or an instantiation of such a class or interface with a generic type
    /// argument.
    fn inherits_from_type_arguments(&mut self, sym: Sym) -> bool {
        for &base in self.base_types(sym).iter() {
            let parts: &[TypeId] = match self.data(base) {
                TypeData::Intersection(parts) => &parts[..],
                _ => std::slice::from_ref(&base),
            };
            for &part in parts {
                let is_keyed_by_arguments = match *self.data(part) {
                    TypeData::TypeParam(..) => true,
                    TypeData::Ref { target, .. } => {
                        target != sym
                            && self.has_type_variables(part)
                            && self.inherits_from_type_arguments(target)
                    }
                    _ => false,
                };
                if is_keyed_by_arguments {
                    return true;
                }
            }
        }
        false
    }

    /// The instance shape of a class or an interface, in terms of its own type parameters. `under`:
    /// the mapper applied to them in the base types.
    fn build_declared_shape(
        &mut self,
        sym: Sym,
        under: MapperId,
        binding: MemberBinding,
        base_members: BaseMembers,
    ) -> Shape<'s> {
        let mut b = Builder::new_in(self.arena);
        for (file, decl) in self.files().decls(sym) {
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
        let this = self.intern(TypeData::ThisParam(sym));
        let bases = self.base_types(sym);
        let own = b.shape.props.len();
        let inherits = base_members == BaseMembers::Inherited;
        for base in bases.iter().copied().filter(|_| inherits) {
            let base = self.instantiate(base, under);
            self.inherit(&mut b, base, Some((sym, this)));
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

    /// `getNamedMembers`: `props` in the order TypeScript stores the properties of a resolved type.
    /// Properties contained in the declarations of the class or interface come first, then the
    /// rest, each in the order of `compareSymbols`: by position of the first declaration, those
    /// without a declaration last, by name. `is_contained`: whether the property at an index is
    /// known to be contained. The others are tested with `isDeclarationContainedBy` and `ranges`.
    /// For a type that is not a class or interface every property is contained.
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
            let (nowhere, place) = self.order_of_property(&prop);
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

    /// `declareSymbolEx`: a class or an interface whose name conflicts is listed with the symbol
    /// that owns the name, but is a separate symbol.
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

    /// The declaration of class `sym` that has the `extends` clause.
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

    /// `getBaseConstructorTypeOfClass`: the type of the expression in the `extends` clause of class
    /// `class`. `undefined` if it has no `extends` clause, the error type if the expression depends
    /// on the class (2506) or its type is not a constructor type (2507).
    pub(super) fn base_constructor_type_of_class(&mut self, class: Sym) -> TypeId {
        if let Some(known) = self.p.base_constructor_types.get(&self.task, &class) {
            return known;
        }
        // Encloses the resolution frame: `isConstructorType` is evaluated after
        // `popTypeResolution`, and the result depends on it too.
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
            let refused = if self.found_cycle {
                TypeId::ERROR
            } else {
                TypeId::UNRESOLVED
            };
            let _ = self.end_scope(scope);
            return refused;
        }
        let constructor = self.type_of_expr(file, self.hir(file)[c].extends);
        // `resolveStructuredTypeMembers`: the members of a class need its base constructor type, so
        // a cycle is detected here.
        let _ = self.members(constructor);
        let holds = self.leave(Query::BaseConstructor(class)).is_ok();
        if self.left_a_cycle {
            let stored = (self.end_scope_as(scope, false)).unwrap_or_else(|_| self.cycle_result());
            // `GetErrorRangeForNode`: the name, or the first token of a class expression without one.
            let declaration = &self.hir(file)[c];
            let start = declaration.name_pos;
            let at = (file, start, self.end_of_token_at(file, start));
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
            if let Some(at) = self.place_to_report_base_at(file, c) {
                // `TypeToString` comes before `data.resolvedBaseConstructorType` is assigned. If it
                // leads back here the type is resolved and printed again, which closes a cycle
                // through what the first printing is resolving:
                // `const a = f(class extends (() => a) {})` is 7022 and 7024 too.
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
                if holds {
                    self.add_diagnostic_of(Some(Query::BaseConstructor(class)), err);
                }
            }
            TypeId::ERROR
        };
        // `if data.resolvedBaseConstructorType == nil`. It is stored exactly when the frame was
        // cacheable.
        match self.end_scope_as(scope, !holds) {
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

    /// `resolveAnonymousTypeMembers`: whether the base constructor type of class `sym` is `any` itself.
    fn extends_any(&mut self, sym: Sym) -> bool {
        self.extending_declaration(sym).is_some()
            && self.base_constructor_type_of_class(sym) == TypeId::ANY
    }

    fn sigs_of_function_declarations(&mut self, sym: Sym) -> ArenaVec<'s, SigId> {
        let decls: Vec<(FileId, FnId)> = self
            .files()
            .decls(sym)
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

    /// `getSignaturesOfSymbol` for two methods of one name or two constructors: whether `m` is "the
    /// implementation of an overloaded function", which is not a signature itself. It "has a body
    /// and the previous node is of the same kind and immediately precedes" it: "has the same parent
    /// and ends where the implementation starts", or is synthesized from an `@overload` tag.
    fn is_implementation_after(&self, file: FileId, previous: MemberId, m: MemberId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        has_body(&hir[hir[m].func])
            && bound.member_owner[previous.idx()] == bound.member_owner[m.idx()]
            && (hir[m].loc.pos == hir[previous].loc.end
                || hir[previous].flags.contains(Flags::REPARSED))
    }

    /// The same for two declarations of a function, except for the body.
    pub(super) fn is_next_statement(&self, file: FileId, previous: FnId, f: FnId) -> bool {
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

    /// Whether `ty` is any instantiation of `sym`, or has one as a base type: `class C<T> extends
    /// C<T[]>` has no base type.
    pub(super) fn has_base(&mut self, ty: TypeId, sym: Sym, depth: u32) -> bool {
        match *self.data(ty) {
            TypeData::Ref { target, .. } => {
                target == sym
                    || depth < 32
                        && self
                            .base_types(target)
                            .to_vec()
                            .into_iter()
                            .any(|b| self.has_base(b, sym, depth + 1))
            }
            TypeData::Intersection(ref parts) => {
                parts.iter().any(|&p| self.has_base(p, sym, depth + 1))
            }
            _ => false,
        }
    }

    /// `getBaseTypes`: the base types of a class or an interface, in terms of its own type
    /// parameters.
    pub fn base_types(&mut self, sym: Sym) -> List<'p, TypeId> {
        let p = self.p;
        if let Some(known) = p.base_types.get_ref(&self.task, &sym) {
            return List::Kept(known);
        }
        if !self.enter(Query::Bases(sym)) {
            return self.base_types_in_progress(sym);
        }
        let mut bases = Vec::new();
        // `resolveBaseTypesOfClass`: the base class comes first, whichever declaration has the
        // `extends` clause.
        if let Some((file, c)) = self.extending_declaration(sym) {
            let base = self.base_instance_type(sym, file, c);
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
            for node in hir.ids(interface.extends) {
                // A base that is not of the form `A.B<C>` has the error type (2499), which is
                // skipped.
                if matches!(
                    hir[node].kind,
                    TypeNodeKind::Error | TypeNodeKind::Heritage(_)
                ) {
                    continue;
                }
                let base = self.type_from_node(file, node);
                let valid = self.as_base_type(base, (file, decl), |checker, _, _| {
                    let at = (file, hir[node].pos, checker.end_of_type_node(file, node));
                    checker.error_at(at, 2312, &[]);
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
        let left = self.leave(Query::Bases(sym));
        let in_cycle = self.left_a_cycle;
        let bases = match left {
            Ok(stored) => {
                let bases = self.list(&bases);
                List::Kept(p.base_types.insert_ref(&self.task, sym, bases, stored))
            }
            // See `base_types_in_progress`.
            Err(_) => match p.base_types.get_ref(&self.task, &sym) {
                Some(known) => List::Kept(known),
                None => List::Own(bases),
            },
        };
        // `popTypeResolution`: they were requested again while being resolved. The error is
        // reported at every class declaration and every interface declaration of the name,
        // regardless of which one has which base type.
        if in_cycle {
            for (file, decl) in self.files().decls(sym) {
                let is_declaration = match decl {
                    Decl::Class(c) => matches!(
                        self.bound(file).class_owner[c.idx()],
                        crate::bind::ClassOwner::Stmt(_)
                    ),
                    _ => true,
                };
                if is_declaration && let Some(err) = self.circular_base_type(sym, file, decl) {
                    self.add_diagnostic_of(Some(Query::Bases(sym)), err);
                }
            }
        }
        bases
    }

    /// `getBaseTypes(sym)` where `pushTypeResolution` fails. `hasBaseType` rejects the base type that
    /// closes the cycle, so the base types of every member depend on which member is resolved first.
    /// With one checker that is the first one requested in program order. A task does not know what
    /// the files before its own request, but `checkSourceFile` requests the base types of every
    /// class and interface that it visits. So the member that those files declare first is resolved
    /// first, above a `resolution_start` barrier. The frames of the cycle below the barrier are
    /// tainted, except for `sym`, and `base_types` returns the stored value for them.
    #[cold]
    fn base_types_in_progress(&mut self, sym: Sym) -> List<'p, TypeId> {
        // A checker of `checkerPool` has visited those of the earlier files that are its own.
        let own = self
            .task
            .file
            .filter(|_| self.found_cycle && self.task.checker_count == 0);
        let from = self.resolution_start.min(self.stack.len());
        let head = self.stack[from..]
            .iter()
            .rposition(|&q| q == Query::Bases(sym));
        let (Some(own), Some(head)) = (own, head) else {
            return List::default();
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
                let p = self.p;
                let known = p.base_types.get_ref(&self.task, &sym);
                known.map_or_else(List::default, |known| List::Kept(known))
            }
            _ => List::default(),
        }
    }

    /// Where in check order the first class or interface declaration of `sym` is, among the files
    /// that `checkSourceFile` visits before the file with the rank `before`.
    fn first_declaration_checked_before(&self, sym: Sym, before: u32) -> Option<(u32, u32)> {
        let declarations = self.files().decls(sym).into_iter();
        let places = declarations.filter_map(|(file, declaration)| {
            let start = declaration.name_pos_of_class_or_interface(self.hir(file))?;
            let rank = self.files().rank_of_file(file);
            (rank < before && self.reports_semantic_errors(file)).then_some((rank, start))
        });
        places.min()
    }

    /// What `reportCircularBaseType` reports at the class or interface `declaration` of `sym`.
    fn circular_base_type(
        &mut self,
        sym: Sym,
        file: FileId,
        declaration: Decl,
    ) -> Option<Reported> {
        // `GetErrorRangeForNode`
        let start = declaration.name_pos_of_class_or_interface(self.hir(file))?;
        let at = (file, start, self.end_of_token_at(file, start));
        let ty = self.declared_type(sym);
        Some(self.new_diagnostic(at, 2310, &[Arg::Type(ty)]))
    }

    /// `getReducedType`, `isErrorType`, `isValidBaseType`: `base` as a base type of the class or
    /// interface whose base types are being resolved, if it is valid. `extending`: the declaration
    /// with the heritage clause. `report`: called with an invalid base type, both reduced and
    /// unreduced.
    fn as_base_type(
        &mut self,
        base: TypeId,
        extending: (FileId, Decl),
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
                let was_in_cycle = self.is_innermost_in_cycle();
                self.mapped_constraint(file, node, mapper);
                if !was_in_cycle && self.is_innermost_in_cycle() {
                    self.report_circular_mapped_key(file, node, extending);
                }
            }
        }
        let base = self.reduced(base);
        // `is_valid_base_type` accepts a type that could not be resolved. Only an object type with
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

    /// `baseTypeNode.Expression()` of class `c`. `None`: nothing is reported for it, because
    /// `checkSourceFile` never visits it or its type is a guess.
    pub(super) fn place_to_report_base_at(
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

    /// `baseType` of `resolveBaseTypesOfClass`: the instance type of the base class of `sym`. `c`:
    /// its `extending_declaration`.
    fn base_instance_type(&mut self, sym: Sym, file: FileId, c: ClassId) -> TypeId {
        let hir = self.hir(file);
        let class = &hir[c];
        let args = self.types_from_nodes(file, class.extends_args);
        let constructor = self.base_constructor_type_of_class(sym);
        // `baseType = baseConstructorType`
        if self.has_any_flag(constructor) {
            return constructor;
        }
        // "if baseConstructorType.flags&(TypeFlagsObject|TypeFlagsIntersection|TypeFlagsAny) == 0":
        // a union of constructor types gives no base type and no error.
        let apparent = self.apparent_type(constructor);
        if !self.is_object_type(apparent) && !self.is_intersection(apparent) {
            return TypeId::ERROR;
        }
        // `areAllOuterTypeParametersApplied`, applied to the declared type: a class declared inside
        // a generic declaration is resolved through its construct signatures.
        if let TypeData::Anon {
            origin: Origin::ClassStatic(base),
            ..
        } = *self.data(constructor)
            && self.outer_type_params_of_symbol(base).is_empty()
        {
            // With the error type the class has no base type.
            let Some(most) = self.check_type_argument_count(base, args.len(), file, Err(c)) else {
                return TypeId::ERROR;
            };
            // `fillMissingTypeArguments`
            if hir.is_js && most > 0 {
                let params = self.type_params_of_symbol(base);
                let filled = self.fill_type_args_as(&params, &args, true);
                return self.type_reference(base, &filled);
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
                if let Some(at) = self.place_to_report_base_at(file, c) {
                    self.error_at(at, 2508, &[]);
                }
                TypeId::ERROR
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

    /// `getWidenedProperty` (`is_widening`) and `transformTypeOfMembers` call `getTypeOfSymbol` for
    /// the properties of the object literal type `ty`. Here a property is widened or made regular
    /// when it is read (`PropFlags::WIDEN`, `PropFlags::REGULAR`). `checkObjectLiteral` has resolved
    /// the type of a member of the literal by then, so this resolves the symbols that
    /// `get_spread_symbol` has left unresolved. A cycle through one of them is found here.
    /// Returns the property types that contain the type of a literal, where both go on.
    fn resolve_spread_symbols(&mut self, ty: TypeId, is_widening: bool) -> SmallVec<[TypeId; 4]> {
        let mut nested = SmallVec::new();
        let mut add = |c: &Self, member: TypeId| {
            let flags = c.types().object_flags(member);
            if flags.contains(ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL) {
                nested.push(member);
            }
        };
        match self.data(ty) {
            &TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } => {
                let hir = self.hir(file);
                if let ExprKind::Object(props) = hir[e].kind {
                    for p in props.iter() {
                        if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) {
                            let member = self.type_of_literal_prop(file, p);
                            add(self, member);
                        }
                    }
                }
            }
            TypeData::Synth(shape) => {
                for prop in &shape.props {
                    match prop.source {
                        PropSource::Type(member) | PropSource::Copy(member, ..) => {
                            add(self, member);
                        }
                        PropSource::Literal(file, p)
                            if matches!(
                                self.hir(file)[p].kind,
                                PropKind::Init | PropKind::Shorthand
                            ) =>
                        {
                            let member = self.type_of_literal_prop(file, p);
                            add(self, member);
                        }
                        // `prop.Flags&ast.SymbolFlagsProperty == 0`
                        PropSource::Symbol(symbol)
                            if !is_widening
                                || self.files().flags(symbol).contains(SymFlags::PROPERTY) =>
                        {
                            self.type_of_prop(prop, MapperId::IDENTITY);
                        }
                        PropSource::Mapped(..) => {
                            self.type_of_prop(prop, MapperId::IDENTITY);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        nested
    }

    /// The loop over the properties in `getWidenedTypeOfObjectLiteral`, see `resolve_spread_symbols`.
    pub(super) fn resolve_spread_symbols_of_widened_literal(&mut self, ty: TypeId) {
        for member in self.resolve_spread_symbols(ty, true) {
            self.get_widened_type(member);
        }
    }

    /// `transformTypeOfMembers(t, c.getRegularTypeOfObjectLiteral)`, see `resolve_spread_symbols`.
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
            for member in self.resolve_spread_symbols(ty, false) {
                self.resolve_spread_symbols_of_regular_literal(member);
            }
        }
    }

    /// `getRegularTypeOfObjectLiteral`
    pub(super) fn regular_type_of_object_literal(&mut self, ty: TypeId) -> TypeId {
        self.resolve_spread_symbols_of_regular_literal(ty);
        self.regular_type_of_resolved_object_literal(ty)
    }

    /// `getRegularTypeOfObjectLiteral` for the type of a property of a type that
    /// `regular_type_of_object_literal` has returned.
    fn regular_type_of_resolved_object_literal(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            &TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(file, e, is_js_literal, of_declaration, object_flags, true),
                mapper,
            } => self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(
                    file,
                    e,
                    is_js_literal,
                    of_declaration,
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

    /// What a caller gets that asks for the members of `origin` while `build_origin_shape` is
    /// resolving them. `resolveAnonymousTypeMembers` has no guard. For a class it begins with
    /// `getExportsOfSymbol`, which assigns the early-bound symbols to `links.resolvedExports`
    /// before it checks the computed names, so a second visit from a name resolves everything from
    /// those: `f(class { static [a] = 1 })` has its construct signature there. After that the
    /// members are in place (`has_members_in_place`).
    fn origin_shape_in_the_meantime(&mut self, origin: Origin) -> Shape<'s> {
        match origin {
            Origin::ClassStatic(sym) if self.late_binding_exports.contains(&sym) => {
                self.build_origin_shape(origin, MemberBinding::Early)
            }
            _ => Shape::new_in(self.arena),
        }
    }

    /// `binding`: of the static side of a class.
    fn build_origin_shape(&mut self, origin: Origin, binding: MemberBinding) -> Shape<'s> {
        let early = binding == MemberBinding::Early;
        let mut b = Builder::new_in(self.arena);
        // Argument for `get_named_members`. Only the static side of a class has a container.
        let mut contained = [0..usize::MAX, 0..0];
        let mut ranges = Vec::new();
        match origin {
            Origin::TypeLiteral(file, node) => {
                if let TypeNodeKind::Object(members) = self.hir(file)[node].kind {
                    let side = ClassSide::Instance;
                    self.add_members(&mut b, file, members, side, MemberBinding::Late);
                }
            }
            Origin::ObjectLiteral(file, expr, .., is_fresh) => {
                let mut shape = self.build_object_literal_shape(file, expr, false);
                if !is_fresh {
                    for prop in &mut shape.props {
                        prop.flags |= PropFlags::REGULAR;
                    }
                }
                return shape;
            }
            Origin::WidenedLiteral(file, expr, ..) => {
                let mut shape = self.build_object_literal_shape(file, expr, false);
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
                let mut is_abstract = false;
                let mut outer = MapperId::IDENTITY;
                for (file, decl) in self.files().decls(sym) {
                    let Decl::Class(c) = decl else { continue };
                    if !self.is_declaration_of_symbol(sym, file, decl) {
                        continue;
                    }
                    let hir = self.hir(file);
                    is_abstract |= hir[c].flags.contains(Flags::ABSTRACT);
                    // `resolveAnonymousTypeMembers` also instantiates the signatures with the
                    // mappings of the outer type parameters of the class, and `instantiate_sig`
                    // only propagates the type parameters that the mapper of a signature covers.
                    let scope = self.bound(file).class_scope[c.idx()];
                    if scope.is_some() {
                        let parent = self.bound(file).scopes[scope.idx()].parent;
                        outer = self.identity_mapper(file, parent);
                    }
                    let members = hir[c].members;
                    if !early {
                        self.late_binding_exports.push(sym);
                    }
                    self.add_members(&mut b, file, members, ClassSide::Static, binding);
                    if !early {
                        self.late_binding_exports.pop();
                    }
                    self.add_this_properties(&mut b, file, c, true);
                    if hir.is_js {
                        self.add_late_bound_expandos(&mut b, sym);
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
                    // `getDefaultConstructSignatures`: one for each construct signature of the base
                    // constructor that accepts the type arguments of the `extends` clause, which
                    // may be none; a single default one if the base constructor has no construct
                    // signatures at all. Only the base constructor type is used, regardless of the
                    // base types.
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
                // `getTypeOfPrototypeProperty`: `any` for each type parameter, including the outer
                // type parameters of the class.
                // It can be assigned to (`isReadonlySymbol`).
                let declared = self.declared_type(sym);
                let count = self.type_arguments(declared).len();
                let instance = match self.data(declared) {
                    TypeData::Ref { target, .. } if count != 0 => self.intern_key(TypeKey::Ref {
                        target: *target,
                        args: &vec![TypeId::ANY; count],
                    }),
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
                // The static members, and the exports of a merged namespace. `prototype` has no
                // declaration.
                contained = [0..own, exports_from..b.shape.props.len()];
                ranges = self.ranges_of_declarations(sym);
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
                            prop.mapper = self.compose(prop.mapper, members.mapper);
                            b.add(prop);
                        }
                    }
                }
                // `getIndexInfosOfIndexSymbol`: on this side, the siblings of a computed name are
                // the whole member table.
                if let Some((file, computed, named)) = b.static_names.take() {
                    // The members are in place by now, and the signatures are not: that is what a
                    // query made here finds if it re-enters this type (`shape_memo_or`).
                    self.declared_index_infos_in_progress.push((
                        self.stack.len(),
                        file,
                        computed[0],
                    ));
                    let mut others: Vec<(Atom, TypeId)> = Vec::new();
                    for prop in &b.shape.props[own..] {
                        let ty = self.type_of_prop(prop, MapperId::IDENTITY);
                        others.push((prop.name, ty));
                    }
                    // A type exported by a merged namespace is in the table too, and
                    // `getTypeOfSymbol` of it is the error type.
                    if self.files().flags(sym).intersects(SymFlags::MODULE) {
                        for (name, _) in self.exports_in_order(sym) {
                            if !b.has(name) {
                                others.push((name, TypeId::ERROR));
                            }
                        }
                    }
                    self.add_index_signatures_of_computed_names(
                        &mut b, file, &computed, &named, false, &others,
                    );
                    self.declared_index_infos_in_progress.pop();
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
                self.add_late_bound_expandos(&mut b, sym);
            }
            Origin::EnumObject(sym) => {
                // Reverse mapping: a numeric value maps back to the name of its member.
                let mut has_numbers = false;
                let mut has_members = false;
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
                    });
                    let is_member = self.files().flags(member).contains(SymFlags::ENUM_MEMBER);
                    has_members |= is_member;
                    if !has_numbers {
                        let ty = if is_member {
                            self.enum_member_type(member)
                        } else {
                            // TypeScript has the members in place by now, so no query made here
                            // re-enters this type.
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
                        let mut prop = prop.clone_in(self.arena);
                        if with_default {
                            // `getSpreadType(ty, { default })`: the spreadable properties, and the
                            // synthesized `default` wins.
                            if prop.name == known::default || !self.is_spreadable_property(&prop) {
                                continue;
                            }
                            // `getSpreadSymbol`: a copy is writable, and a write-only property is
                            // not copied.
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
                                };
                            } else if prop.flags.contains(PropFlags::READONLY) {
                                // A readonly property, an `export const`, is recreated too: with
                                // its declarations, without a parent.
                                let ty = self.type_of_prop(&prop, MapperId::IDENTITY);
                                prop.source = Self::copy_of(ty, &[&prop], false, self.arena);
                                prop.mapper = MapperId::IDENTITY;
                            }
                            prop.flags.remove(PropFlags::READONLY);
                        }
                        prop.mapper = self.compose(prop.mapper, members.mapper);
                        b.add(prop);
                    }
                    // `getUnionIndexInfos`: `{ default }` has no index signature, so the result of
                    // spreading with it has none.
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
                    // Whether it is a value is determined by the alias target; its scoping, by the
                    // symbol itself.
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
    /// type-only step before it (`getSymbolFlagsEx`, `excludeTypeOnlyMeanings`). An alias that does
    /// not resolve is an error, and an error symbol has every meaning, including value.
    pub(super) fn symbol_is_value(&self, sym: Sym) -> bool {
        self.files()
            .symbol_flags_ex(sym, true, false)
            .intersects(SymFlags::VALUE)
    }

    /// `PropFlags` of an export of a module, namespace or enum. Constants and enum members are read-only (`isReadonlySymbol`); the
    /// target of an alias is not considered. An expando assignment (`f.name = value`) takes its modifiers from JSDoc
    /// (`getDeclarationModifierFlagsFromSymbol`).
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
        all.sort_by_key(|e| e.1);
        all
    }

    /// `lateBindMember` for `f[key] = value`: it declares the property named by the type of `key`,
    /// together with the `f.name = value` declarations of that name. A key whose type is not usable
    /// as a property name declares nothing. `this[key] = value` in a class declares a static
    /// property, in an instance member too: `getResolvedMembersOrExportsOfSymbol` only binds these
    /// declarations for the exports.
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
                });
            }
        }
    }

    /// `shape`, which has no properties, extended with `getExportsOfSymbol(owner)`, which are
    /// declared by assignments, in the order of `getNamedMembers`.
    pub(super) fn with_expandos(
        &mut self,
        shape: Shape<'s>,
        file: FileId,
        owner: SymbolId,
    ) -> Shape<'s> {
        // Every function expression and every object literal reaches this point.
        if owner.is_none() || self.bound(file).symbols[owner.idx()].exports.is_none() {
            return shape;
        }
        let mut b = Builder {
            shape,
            ..Builder::new_in(self.arena)
        };
        let before = b.shape.props.len();
        let owner = self.files().sym(file, owner);
        self.add_namespace_exports(&mut b, owner);
        self.add_late_bound_expandos(&mut b, owner);
        if b.shape.props.len() > before {
            self.get_named_members(&mut b.shape.props, |_| true, &[]);
        }
        b.shape
    }

    /// The properties declared by `this.name = value` in JavaScript, where they have no other
    /// declaration.
    fn add_this_properties(
        &mut self,
        b: &mut Builder<'s>,
        file: FileId,
        class: ClassId,
        is_static: bool,
    ) {
        // Every class reaches this point.
        if !self.hir(file).is_js {
            return;
        }
        let (bound, files) = (self.bound(file), self.files());
        let of = &bound.symbols[bound.class_symbol[class.idx()].idx()];
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
                });
            }
        }
    }

    /// The values exported by a namespace merged with a function, a class or an enum.
    fn add_namespace_exports(&mut self, b: &mut Builder<'s>, sym: Sym) {
        for (name, export) in self.exports_in_order(sym) {
            // The static members are left to `add_members`, their assignments to `this` to
            // `add_this_properties`.
            let is_member =
                |d: &(FileId, Decl)| matches!(d.1, Decl::Member(_) | Decl::ThisProperty(_));
            if self.symbol_is_value(export)
                && !b.has(name)
                && !self.files().decls_of(export).iter().all(is_member)
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
        for i in 0..fixed {
            let optional = flags[i].contains(ElemFlags::OPTIONAL);
            let ty = if optional {
                self.optional_property(elems[i])
            } else {
                elems[i]
            };
            b.add(Prop {
                name: self.number_name(i as f64),
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
            });
        }
        let length = if fixed == flags.len() {
            // `createTupleTargetType`: the minimum length is the number of required elements,
            // whatever their positions.
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
        param.rest
            && (self.is_any(param.ty)
                || self
                    .array_element(param.ty)
                    .is_some_and(|ty| self.has_any_flag(ty)))
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

    /// `resolveIntersectionTypeMembers`, and `createUnionOrIntersectionProperty` for each name.
    fn build_intersection_shape(&mut self, whole: TypeId, parts: &[TypeId]) -> Shape<'s> {
        let mut b = Builder::new_in(self.arena);
        // The type of a property is resolved lazily: with `this` bound to the whole intersection,
        // it can depend on other properties of the whole. For each name that several members have:
        // the properties, the one in `b` first.
        let mut lists: Vec<Vec<Prop<'s>, &'s Arena>> = Vec::new();
        let (constructors, is_mixin) = self.find_mixins(parts);
        let has_mixins = is_mixin.contains(&true);
        for (at, &written) in parts.iter().enumerate() {
            let part = self.apparent_type(written);
            // `getTypeWithThisArgument`: `this` in a member of a constituent is the whole
            // intersection, unless the constituent specifies its own. In the constraint of a type
            // parameter it is the type parameter (`getApparentType`).
            let stands_for = if self.is_deferred(written) {
                written
            } else {
                whole
            };
            // `getPropertiesOfType`, `getIndexInfosOfType`, `getSignaturesOfType`: for a union, the
            // members common to all its constituents.
            let union = self.is_union(part).then_some(part);
            let part = union.map_or(part, |union| self.union_as_object(union));
            let Some(members) = self.members_with_this(part, stands_for) else {
                continue;
            };
            let (call, construct) = match union {
                Some(union) => (self.signatures(union, false), self.signatures(union, true)),
                None => (
                    List::Kept(&members.shape().call[..]),
                    List::Kept(&members.shape().construct[..]),
                ),
            };
            b.reserve(members.shape().props.len());
            for prop in &members.shape().props {
                let mut own = prop.clone_in(self.arena);
                self.instantiate_prop(&mut own, members.mapper);
                match b.position(prop.name) {
                    // The same property reached through two paths is added once.
                    Some(i) => {
                        if lists[i].is_empty() {
                            if b.shape.props[i] != own {
                                lists[i].reserve_exact(2);
                                lists[i].push(b.shape.props[i].clone_in(self.arena));
                                lists[i].push(own);
                            }
                        } else if !lists[i].contains(&own) {
                            lists[i].push(own);
                        }
                    }
                    None => {
                        b.add_new(own);
                        lists.push(Vec::new_in(self.arena));
                    }
                }
            }
            // A signature identical to an existing one is not added.
            for &sig in call.iter() {
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
            // A mixin constructor contributes no construct signature: its return type is part of
            // the return types of the other members' signatures.
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
                // Optional if every property, method or accessor among them is: a variable of a
                // module or of `globalThis` is not considered.
                let optional = list
                    .iter()
                    .filter(|p| !matches!(p.source, PropSource::Symbol(sym) if !self.is_member_symbol(sym)))
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
                prop.source = PropSource::Intersected(whole, list.into());
                prop.mapper = MapperId::IDENTITY;
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
                || matches!(self.data(part), TypeData::Keyof(_))
            {
            } else if object.replace(part).is_some() {
                return ty;
            }
        }
        let Some(object) = object else {
            return empty.unwrap_or(TypeId::EMPTY_OBJECT);
        };
        // `getPropertiesOfType`, `getIndexInfosOfType`: whatever the single member is, even a type
        // parameter, its `getReducedApparentType` is used; for a union, the members common to all
        // its constituents.
        let owner = self.reduced_apparent_type(object);
        if owner == TypeId::UNRESOLVED {
            return ty;
        }
        let owner = if self.is_union(owner) {
            self.union_as_object(owner)
        } else {
            owner
        };
        let mut shape = Shape::new_in(self.arena);
        // A type that is not an object type has nothing to copy.
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

    /// `getLiteralTypeFromProperty` of a copy of `prop`, a property of `owner`: `STRING_NAME` if
    /// its name is numeric in form but is a string anyway. `anew`: the copy is a new symbol
    /// (`getSpreadSymbol`), with the `nameType` of the original but without its declaration, so
    /// that a name declared as `1` is keyed by "1".
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
        // A `nameType` is stored for a late-bound name (`lateBindMember`), and in an object literal
        // for any computed name (`checkObjectLiteral`).
        let is_explicit = match &prop.source {
            PropSource::Symbol(sym) => {
                matches!(self.files().value_declaration(*sym), Some((file, Decl::Member(m)))
                    if matches!(self.hir(file)[m].key, PropKey::Name(_)))
            }
            PropSource::Literal(file, written) => {
                let hir = self.hir(*file);
                matches!(hir[*written].key, PropKey::Name(_))
                    && hir.text.get(hir[*written].pos as usize) != Some(&b'[')
            }
            _ => false,
        };
        if anew && is_explicit
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
        self.get_spread_type(left, right, false)
    }

    /// `readonly`: in a const context. The caller marks the properties of the result.
    pub(super) fn get_spread_type(
        &mut self,
        left: TypeId,
        right: TypeId,
        readonly: bool,
    ) -> TypeId {
        self.spread_ranked(left, right, readonly, &mut 0)
    }

    /// `getSpreadSymbol(prop, readonly)`: the source and the mapper of the symbol it returns for
    /// `prop`, a property of a type whose members have the mapper `mapper`, and the flags that
    /// `type_of_prop` needs with that source.
    /// Where it returns `prop` itself, the type of a declared symbol or a mapped symbol is left
    /// unresolved, since it may be the one that is being resolved:
    /// `class C { x = f({ ...new C() }) }`. `get_widened_type` and `regular_type_of_object_literal`
    /// resolve it, where tsgo calls `getTypeOfSymbol` for every property.
    pub(super) fn get_spread_symbol(
        &mut self,
        prop: &Prop,
        mapper: MapperId,
        options: SpreadSymbolOptions,
    ) -> (PropSource<'s>, MapperId, PropFlags) {
        let SpreadSymbolOptions {
            owner_is_generic,
            readonly,
            resolves,
        } = options;
        let copy = |ty, has_value_declaration| {
            let source = Self::copy_of(ty, &[prop], has_value_declaration, self.arena);
            (source, MapperId::IDENTITY, PropFlags::empty())
        };
        if prop.flags.contains(PropFlags::WRITE_ONLY) {
            return copy(TypeId::UNDEFINED, false);
        }
        let is_readonly = self.is_readonly_symbol(prop);
        if !resolves
            && is_readonly == readonly
            && matches!(prop.source, PropSource::Symbol(_) | PropSource::Mapped(..))
        {
            let composed = self.compose(prop.mapper, mapper);
            // `Types::object_flags` finds the type variables of such a property in its mapper. The
            // members of a type literal in a generic declaration have none.
            let mapping = self.types().mapping(composed);
            if !owner_is_generic || mapping.iter().any(|it| self.has_type_variables(it.1)) {
                let read_with =
                    PropFlags::WITHOUT_OPTIONALITY | PropFlags::WIDEN | PropFlags::REGULAR;
                return (
                    prop.source.clone_in(self.arena),
                    composed,
                    prop.flags & read_with,
                );
            }
        }
        let ty = self.type_of_prop(prop, mapper);
        copy(ty, is_readonly == readonly)
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

    /// `rank`: see `Shape::spread_rank`.
    fn spread_ranked(
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
                .map(|p| self.spread_ranked(p, right, readonly, rank))
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
                .map(|p| self.spread_ranked(left, p, readonly, rank))
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
                parts.push(self.spread_ranked(last, right, readonly, rank));
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
        let mut b = Builder::new_in(self.arena);
        b.reserve(l.shape().props.len() + r.shape().props.len());
        // The result of spreading into a JSX attributes type is still a JSX attributes type
        // (`objectFlags`).
        let is_jsx = |c: &Self, t: TypeId| matches!(c.data(t), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        let (left_is_jsx, right_is_jsx) = (is_jsx(self, left), is_jsx(self, right));
        // Properties declared in the literal itself remain marked as such
        // (`shouldCheckAsExcessProperty`): on the left in the accumulated spread result, on the
        // right in a run of properties between spreads.
        let left_is_so_far = left_is_jsx
            || matches!(self.data(left), TypeData::Synth(shape) if shape.literal == Literalness::WithSpread);
        let right_is_written = right_is_jsx
            || matches!(self.data(right), TypeData::Synth(shape) if shape.literal == Literalness::Written);
        // `getSpreadSymbol` returns the same symbol, so the synthesized JSX children property keeps
        // the declaration that makes it count as declared in the element.
        let is_written = |prop: &Prop| {
            matches!(prop.source, PropSource::Literal(..))
                || prop
                    .flags
                    .intersects(PropFlags::JSX_CHILDREN | PropFlags::WRITTEN)
        };
        let left_is_generic = self.has_type_variables(left);
        let right_is_generic = self.has_type_variables(right);
        for prop in &l.shape().props {
            if !self.is_spreadable_property(prop) {
                continue;
            }
            // `skippedPrivateMembers`, and `members[leftProp.Name] != nil` where the property on the
            // right is not optional: `getSpreadSymbol` is not called for the one on the left.
            if let Some(later) = r.resolved.prop(prop.name)
                && (later
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                    || !later.flags.contains(PropFlags::OPTIONAL)
                        && self.is_spreadable_property(later))
            {
                continue;
            }
            if left_is_so_far && is_written(prop) {
                b.add(prop.clone_in(self.arena));
                continue;
            }
            // `getSpreadSymbol`: a write-only property reads as `undefined`. It is recreated, and so
            // is a property that is readonly where the result is not, or the reverse.
            let anew = prop.flags.contains(PropFlags::WRITE_ONLY)
                || prop.flags.contains(PropFlags::READONLY) != readonly;
            // A property that is not recreated is the same symbol: a method remains a method.
            let kept = if anew {
                PropFlags::OPTIONAL
            } else {
                PropFlags::OPTIONAL | PropFlags::METHOD
            };
            let mut flags = prop.flags & kept | self.name_flag_of_copy(left, prop, anew);
            if !anew && self.is_function_symbol_property(prop) {
                flags |= PropFlags::METHOD;
            }
            let options = SpreadSymbolOptions {
                owner_is_generic: left_is_generic,
                readonly,
                resolves: false,
            };
            let (source, mapper, read_with) = self.get_spread_symbol(prop, l.mapper, options);
            b.add(Prop {
                name: prop.name,
                flags: flags | read_with,
                source,
                mapper,
            });
        }
        // A copy is writable, whatever it is a copy of.
        for info in &l.shape().index {
            let value = self.instantiate(info.value, l.mapper);
            b.shape.index.push(IndexInfo {
                value,
                readonly: false,
                ..*info
            });
        }
        for prop in &r.shape().props {
            // `skippedPrivateMembers`: it hides the existing property of that name, and is not
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
            if right_is_written && !is_write_only && is_written(prop) {
                b.remove(prop.name);
                b.add_new(prop.clone_in(self.arena));
                continue;
            }
            let (flags, source);
            let mut mapper = MapperId::IDENTITY;
            if prop.flags.contains(PropFlags::OPTIONAL)
                && let Some(i) = b.position(prop.name)
            {
                let mut ty = if is_write_only {
                    TypeId::UNDEFINED
                } else {
                    self.type_of_prop(prop, r.mapper)
                };
                let existing = &b.shape.props[i];
                let left_ty = self.type_of_prop(existing, MapperId::IDENTITY);
                // It is recreated, and named like the one on the left.
                let named = match l.resolved.prop(prop.name) {
                    Some(original) => self.name_flag_of_copy(left, original, true),
                    None => existing.flags & PropFlags::STRING_NAME,
                };
                flags = existing.flags & PropFlags::OPTIONAL | named;
                // `getSpreadType`: the type on the left, or the type on the right when that
                // property is present.
                let present = self.remove_missing_or_undefined_type(ty);
                let same = self.remove_missing_or_undefined_type(left_ty) == present;
                ty = if same {
                    left_ty
                } else {
                    self.union_reduced(&[left_ty, present])
                };
                source = Self::copy_of(ty, &[&b.shape.props[i], prop], false, self.arena);
            } else {
                let anew = is_write_only || prop.flags.contains(PropFlags::READONLY) != readonly;
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
                // `rightType := c.getTypeOfSymbol(rightProp)`, for a property that the left has too.
                let replaces = (l.resolved.prop(prop.name))
                    .is_some_and(|earlier| self.is_spreadable_property(earlier));
                let options = SpreadSymbolOptions {
                    owner_is_generic: right_is_generic,
                    readonly,
                    resolves: replaces,
                };
                let read_with;
                (source, mapper, read_with) = self.get_spread_symbol(prop, r.mapper, options);
                flags = prop.flags & kept
                    | self.name_flag_of_copy(right, prop, anew)
                    | function_flag
                    | read_with;
            }
            let copy = Prop {
                name: prop.name,
                flags,
                source,
                mapper,
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
        // An index signature applies to the result if it applies to both sides. (An empty left side
        // does not count.)
        let left_is_nothing = left == TypeId::EMPTY_OBJECT;
        let mut index = ArenaVec::new_in(self.arena);
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
        b.shape.spread_rank = *rank;
        *rank += 1;
        self.synth(b.shape)
    }

    // ───────────────────────────── reading ─────────────────────────────

    /// The type of `prop`, which was found in a type whose mapper is `outer`.
    pub fn type_of_prop(&mut self, prop: &Prop, outer: MapperId) -> TypeId {
        let mut adds_undefined = false;
        let mut own_mapper = prop.mapper;
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
                self.type_of_symbol(*sym)
            }
            PropSource::Intersected(whole, parts) => {
                let key = (*whole, prop.name);
                let at = whole.0.wrapping_add(prop.name.0.wrapping_mul(31)) as usize % RECENT_PROPS;
                let recent = self.recent_intersected_props[at];
                if recent.0 == key {
                    recent.1
                } else if let Some(known) = self.p.intersected_props.get(&self.task, &key) {
                    self.recent_intersected_props[at] = (key, known);
                    known
                } else {
                    let scope = self.begin_scope();
                    let mut types: SmallVec<[TypeId; 4]> = SmallVec::new();
                    for part in parts.iter() {
                        types.push(self.type_of_prop(part, MapperId::IDENTITY));
                    }
                    let all = if self.is_union(*whole) {
                        self.union(&types)
                    } else {
                        self.intersection(&types)
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
        let ty = if self.has_type_variables(base) {
            // `getTypeOfInstantiatedSymbol`: for an inherited member, the mapper of the base type
            // that `resolveObjectTypeMembers` has instantiated.
            let mapper = self.compose(own_mapper, outer);
            self.instantiate(base, mapper)
        } else {
            base
        };
        let ty = if prop.flags.contains(PropFlags::WIDEN) {
            self.get_widened_type(ty)
        } else if prop.flags.contains(PropFlags::REGULAR) {
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

    /// `optional_property`, cached per type.
    pub(super) fn cached_optional_property(&mut self, ty: TypeId) -> TypeId {
        if let Some(known) = self.p.optional_properties.get(&self.task, &ty) {
            return known;
        }
        let scope = self.begin_scope();
        let optional = self.optional_property(ty);
        // Whether it is stored is decided below.
        let ended = self.end_scope_as(scope, false);
        // `union` runs further queries for members of these kinds on every call, so the result is not
        // cached.
        let asks = self.parts(ty).iter().any(|&member| {
            matches!(
                self.data(member),
                TypeData::Intersection(_)
                    | TypeData::Template { .. }
                    | TypeData::StringMapping { .. }
            )
        });
        if !asks && let Ok(stored) = ended {
            self.p
                .optional_properties
                .insert(&self.task, ty, optional, stored);
        }
        optional
    }

    /// `GetErrorRangeForNode` of `declaration`: for a property declaration or signature, its name.
    pub(super) fn place_of_untyped_property(
        &self,
        file: FileId,
        declaration: UntypedProperty,
    ) -> (FileId, u32, u32) {
        match declaration {
            UntypedProperty::Member(member) => (
                file,
                self.hir(file)[member].name_pos,
                self.end_of_member_name(file, member),
            ),
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
        let at = self.place_of_untyped_property(file, declaration);
        // `DeclarationNameToString(GetNameOfDeclaration(declaration))`
        let name = match declaration {
            UntypedProperty::Member(_) => self.source_text(file, at.1, at.2),
            UntypedProperty::Assignment(e) => self
                .name_of_assignment_declaration(file, e)
                .unwrap_or_else(|| b"(Missing)".to_vec()),
        };
        let diagnostic = self.new_diagnostic(at, code, &[Arg::Bytes(&name), Arg::Type(ty)]);
        self.add_error_or_suggestion(no_implicit_any, diagnostic);
    }

    /// `filterType(ty, flags &^ TypeFlagsNullable != 0) == neverType`: `ty` is `never`, or a union of `null` and `undefined` only.
    /// `void` is not nullable, and `any` is kept by the filter.
    pub(super) fn is_all_null_or_undefined(&self, ty: TypeId) -> bool {
        ty.is_never() || self.every_type(ty, |_, member| member.is_undefined() || member.is_null())
    }

    /// `isConstructorDeclaredThisProperty` for the symbol whose `Declarations` are `assignments`.
    pub(super) fn is_constructor_declared_this_property(
        &self,
        file: FileId,
        assignments: &[ExprId],
    ) -> ThisAssignmentDeclaration {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let hir = self.hir(file);
        let is_this_property =
            |&e: &ExprId| assignment_declaration_kind(hir, e) == JsDeclarationKind::ThisProperty;
        if assignments.is_empty() || !assignments.iter().all(is_this_property) {
            return ThisAssignmentDeclaration::None;
        }
        // The last annotation wins.
        let annotations = assignments.iter().rev();
        let mut annotations = annotations.map(|&e| hir.jsdoc_type(JsDocTypeOwner::Assign(e)));
        if let Some(annotation) = annotations.find(|node| node.is_some()) {
            return ThisAssignmentDeclaration::Typed(annotation);
        }
        // `getDeclaringConstructor`
        let constructor = assignments
            .iter()
            .find_map(|&e| match self.this_container(file, e) {
                Some(Ok(func)) if hir[func].kind == FnKind::Constructor => Some(func),
                _ => None,
            });
        constructor.map_or(
            ThisAssignmentDeclaration::Method,
            ThisAssignmentDeclaration::Constructor,
        )
    }

    /// `getWidenedTypeForAssignmentDeclaration` for the symbol `name` whose `Declarations` are
    /// `assignments`.
    pub(super) fn get_widened_type_for_assignment_declaration(
        &mut self,
        file: FileId,
        name: Atom,
        assignments: &[ExprId],
        value_declaration: ExprId,
    ) -> TypeId {
        use crate::bind::{JsDeclarationKind, assignment_declaration_kind};
        let hir = self.hir(file);
        let kind = self.is_constructor_declared_this_property(file, assignments);
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
                let mut types = Vec::with_capacity(assignments.len());
                let mut declared = None;
                for (i, &e) in assignments.iter().enumerate() {
                    // `declaration.Type()`: the first annotated declaration decides.
                    let annotation = hir.jsdoc_type(JsDocTypeOwner::Assign(e));
                    if annotation.is_some() {
                        declared = Some(self.type_from_node(file, annotation));
                        break;
                    }
                    // `getAssignmentDeclarationInitializerType`
                    let assigned = match hir[e].kind {
                        ExprKind::Assign { target, value, .. } => {
                            if assignment_declaration_kind(hir, e)
                                == JsDeclarationKind::ThisProperty
                                && self.contains_same_named_this_property(file, target, value)
                            {
                                continue;
                            }
                            self.type_of_assignment_declaration(file, e, target, value)
                        }
                        ExprKind::Call(call) => match hir.ids(hir[call].args).nth(2) {
                            Some(descriptor) => {
                                self.type_from_property_descriptor(file, descriptor)
                            }
                            None => continue,
                        },
                        _ => continue,
                    };
                    // "We ignore initial assignments of undefined to CommonJS exports when there are multiple assignment declarations"
                    let is_ignored = i == 0
                        && assignments.len() > 1
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
                    // A property assigned in methods only also holds `undefinedOrMissingType` under strictNullChecks.
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
        if hir.is_js && self.is_all_null_or_undefined(ty) {
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

    /// `getTypeOfPropertyInBaseClass`: the type of the property `name` in the first base type of `class`. `getDeclaringClass` is
    /// the instance type, for a static property too.
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

    /// `getTypeOfPropertyOrIndexSignatureOfType`, and which of the two it is: a property that only
    /// an index signature provides may be missing.
    fn type_of_property_or_index_signature(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<(TypeId, Found)> {
        if self.has_any_flag(ty) {
            return None;
        }
        Some(match self.find_property(ty, name, Access::Read)? {
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

    /// `containsSameNamedThisProperty`: whether `value`, the right side of `target = value`, mentions `target` outside of
    /// nested function-like nodes.
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
        let Some(reference) = self.reference_of(file, target) else {
            return false;
        };
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

    /// `isReadonlySymbol`. `PropFlags::READONLY` has all of it but the last line.
    pub(super) fn is_readonly_symbol(&mut self, prop: &Prop) -> bool {
        prop.flags.contains(PropFlags::READONLY) || self.has_readonly_assignment_declaration(prop)
    }

    /// `isReadonlySymbol`: `core.Some(symbol.Declarations, c.isReadonlyAssignmentDeclaration)`. A
    /// symbol that is derived from others has their declarations, as in `declared_properties`.
    pub(super) fn has_readonly_assignment_declaration(&mut self, prop: &Prop) -> bool {
        let declared = match &prop.source {
            &PropSource::Symbol(sym) => {
                let flags = self.files().flags(sym);
                if flags.contains(SymFlags::ASSIGNMENT) {
                    return (self.assignments_of_symbol(sym).iter())
                        .any(|&e| self.is_readonly_assignment_declaration(sym.file, e));
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

    /// `getAssignmentDeclarationInitializerType` for `declaration`, the assignment `target = value`, which declares the property
    /// `target`.
    fn type_of_assignment_declaration(
        &mut self,
        file: FileId,
        declaration: ExprId,
        target: ExprId,
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
        let ty = self.type_of_expr(file, rightmost);
        let ty = match *self.data(ty) {
            _ if is_export => self.regular(ty),
            // `checkExpressionForMutableLocation` does not go through `checkExpressionCached`: an
            // object literal gets a separate type.
            TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(of, literal, is_js_literal, false, object_flags, is_fresh),
                mapper,
            } if (of, literal) == (file, value) => self.intern(TypeData::Anon {
                origin: Origin::ObjectLiteral(
                    of,
                    literal,
                    is_js_literal,
                    true,
                    object_flags,
                    is_fresh,
                ),
                mapper,
            }),
            _ => ty,
        };
        // The property is `any[]`, unless its owner initializes a variable that has a type annotation.
        if self.is_empty_array_literal_type(ty)
            && !self.is_property_of_annotated_variable(file, target)
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

    /// `hasParentWithTypeAnnotation`: whether `target` is `f.name` or `f[key]` of a variable `f`
    /// that has a type annotation.
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

    /// `getWriteTypeOfSymbol`: the type that may be assigned to `prop`, which was found in a type
    /// whose mapper is `outer`.
    pub fn write_type_of_prop(&mut self, prop: &Prop, outer: MapperId) -> TypeId {
        // For an intersection: the type accepted by all the members that have the property.
        if let PropSource::Intersected(whole, parts) = &prop.source
            && parts.iter().any(|p| {
                p.flags.contains(PropFlags::ACCESSOR)
                    || matches!(p.source, PropSource::Intersected(..))
            })
        {
            let mut types = Vec::with_capacity(parts.len());
            // `writeTypes` has no `indexTypes`.
            for part in parts
                .iter()
                .filter(|part| !part.flags.contains(PropFlags::WRITE_PARTIAL))
            {
                types.push(self.write_type_of_prop(part, MapperId::IDENTITY));
            }
            let all = if self.is_union(*whole) {
                self.union(&types)
            } else {
                self.intersection(&types)
            };
            let mapper = self.compose(prop.mapper, outer);
            return self.instantiate(all, mapper);
        }
        if !prop.flags.contains(PropFlags::ACCESSOR) {
            // `removeMissingType`: the missing type of an optional property cannot be assigned to
            // it.
            let ty = self.type_of_prop(prop, outer);
            return self.remove_missing_type(ty, prop.flags.contains(PropFlags::OPTIONAL));
        }
        // `getWriteTypeOfAccessors`: the annotated parameter type of the setter. Without an
        // annotation, the read type.
        let setter: Option<(FileId, FnId)> = match &prop.source {
            PropSource::Symbol(sym) => self
                .members_of_symbol(*sym)
                .iter()
                .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Setter)
                .map(|&(f, m)| (f, self.hir(f)[m].func)),
            // The shape stores the getter: the setter is the one of that name in the same literal.
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
            let mapper = self.compose(prop.mapper, outer);
            return self.instantiate(ty, mapper);
        }
        self.type_of_prop(prop, outer)
    }

    /// `getTypeOfSymbol(member.Symbol)`, if `member` is `symbol.ValueDeclaration`. For a later
    /// declaration, the type of that declaration alone: `getWidenedTypeForVariableLikeDeclaration`,
    /// which is not cached.
    pub(super) fn type_of_member_declaration(&mut self, file: FileId, member: MemberId) -> TypeId {
        if self.bound(file).member_symbol[member.idx()].is_some() {
            let sym = self.symbol_of_member(file, member);
            if self.files().value_declaration(sym) == Some((file, Decl::Member(member))) {
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
                // `reportErrors`: set when the caller is `getTypeOfSymbol`. For a later declaration
                // alone the call is `getWidenedTypeForVariableLikeDeclaration(node, false)`.
                let value_declaration = (file, crate::bind::Decl::Member(first));
                let reports_errors = members.len() > 1
                    || self
                        .files()
                        .decls_of(self.files().sym(
                            file,
                            self.bound(file).symbol_of_declaration(value_declaration.1),
                        ))
                        .first()
                        .is_none_or(|&it| it == value_declaration);
                let value_declaration = UntypedProperty::Member(first);
                // `getTypeOfAccessors`: `core.Find(symbol.Declarations,
                // ast.IsAutoAccessorPropertyDeclaration)` determines the type.
                let (file, first) = members
                    .iter()
                    .copied()
                    .find(|&(f, m)| self.hir(f)[m].flags.contains(Flags::ACCESSOR))
                    .unwrap_or((file, first));
                let hir = self.hir(file);
                let member = &hir[first];
                let owner = self.bound(file).member_owner[first.idx()];
                // `isValidESSymbolDeclaration`: `readonly` in an interface or a type literal,
                // `static readonly` in a class. For any other property a `unique symbol` is a
                // `symbol`.
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
                    let has_unique_keyword =
                        matches!(hir[member.ty].kind, TypeNodeKind::UniqueSymbol);
                    if let Some(name) = unique_symbol_name {
                        // `isGlobalSymbolConstructor`: by symbol, so that `declare global { interface SymbolConstructor }` counts and
                        // an interface of that name in a module or a namespace does not.
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
                                // `Symbol.iterator` and the like are keyed by their name alone, so
                                // that they name `known::sym_iterator`.
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
                        return self.intern(TypeData::UniqueSymbol {
                            symbol: UniqueSymbolDeclaration::Member(file, first),
                            name,
                        });
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
                // `getTypeForVariableLikeDeclaration`: where an implicit `any` is an error, the
                // assignments to it are inspected first.
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
                if let Some(&(f, getter)) = members
                    .iter()
                    .find(|&&(f, m)| self.hir(f)[m].kind == MemberKind::Getter)
                {
                    let func = self.hir(f)[getter].func;
                    // `getTypeOfAccessors`: an annotation is resolved from its type node, without
                    // resolving the function.
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
                    let ty = self.return_type_of_fn_uncached(f, func, CheckMode::empty());
                    return ty;
                }
                // The initializer of a setter's parameter does not determine the type of the
                // property.
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

    /// `getESSymbolLikeTypeForNode` caches one `unique symbol` per symbol: among the declarations
    /// of the property `name` in the class or the interface that contains the member `m`, the first
    /// one annotated `unique symbol` represents all.
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

    /// `isSymbolOrSymbolForCall`: `Symbol()` or `Symbol.for()`, resolved to the global value of
    /// that name.
    pub(super) fn is_symbol_or_symbol_for_call(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return false;
        };
        let callee = match hir[hir[call].callee].kind {
            ExprKind::Dot { obj, name, .. } if self.atoms().bytes(name) == b"for" => obj,
            _ => hir[call].callee,
        };
        matches!(hir[callee].kind, ExprKind::Ident(known::Symbol))
            && self.bound(file).expr_symbol[callee.idx()].is_none()
            && self
                .files()
                .global(known::Symbol, SymFlags::VALUE)
                .is_some()
    }

    /// The apparent type of `ty` for a property access: the wrapper of a primitive, the constraint
    /// of a type parameter.
    #[inline]
    pub fn apparent_type(&mut self, ty: TypeId) -> TypeId {
        match self.data(ty) {
            TypeData::Union(_) if !self.is_boolean(ty) => ty,
            data if is_plain_object(data) => ty,
            _ => self.apparent_type_of_other(ty),
        }
    }

    /// `apparent_type` for a type whose apparent type may differ from it.
    fn apparent_type_of_other(&mut self, ty: TypeId) -> TypeId {
        // An unconstrained type parameter has the base constraint `unknown`. The original type is passed as the `this` argument
        // (`getTypeWithThisArgument`, `getApparentTypeOfIntersectionType`): in inherited members `this` is `ty` itself.
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
            // `getApparentTypeOfIntersectionType`: the intersection of the apparent types of its
            // members, so `T & {}` of a `T extends A | undefined` is `A`. Where every member has an
            // object apparent type the intersection is left unchanged: its shape is built from
            // those apparent types, which is where `this` is handled.
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
            // `unknown` has no properties, not even those every object has, except without
            // strictNullChecks.
            _ if ty == TypeId::UNKNOWN && !self.p.files.options.strict_null_checks => {
                return TypeId::EMPTY_OBJECT;
            }
            _ => return ty,
        };
        self.plain_global_ref(wrapper)
    }

    /// `getResolvedBaseConstraint`: the widest type `ty` can be, with no type parameter at the top
    /// level. `unknown`: no constraint.
    pub fn base_constraint(&mut self, ty: TypeId) -> TypeId {
        if !self.has_type_variables(ty) {
            return ty;
        }
        // A call from outside starts a new stack.
        let around = std::mem::take(&mut self.constraint_stack);
        let result = self.next_base_constraint(ty);
        self.constraint_stack = around;
        result
    }

    /// Whether `getBaseConstraintOfType(ty)` is `unknown`. `base_constraint` is `unknown` also for a
    /// type that has no constraint.
    pub(super) fn has_unknown_base_constraint(&mut self, ty: TypeId, depth: u32) -> bool {
        if ty == TypeId::UNKNOWN {
            return true;
        }
        if depth == 10 || self.base_constraint(ty) != TypeId::UNKNOWN {
            return false;
        }
        match self.data(ty) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => self
                .constraint_of_type_param(ty)
                .is_some_and(|it| self.has_unknown_base_constraint(it, depth + 1)),
            TypeData::Union(members) => members
                .iter()
                .any(|&it| self.has_unknown_base_constraint(it, depth + 1)),
            TypeData::Cond { .. } => {
                let constraint = self.get_constraint_of_conditional_type(ty);
                self.has_unknown_base_constraint(constraint, depth + 1)
            }
            _ => false,
        }
    }

    /// `getNextBaseConstraint`: the same, as part of the constraint computation in progress.
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
        if let Some((known, _)) = self.p.constraints.get(&self.task, &ty) {
            return known;
        }
        if let Some(raw) = self.provisional(Query::Constraint(ty)) {
            return TypeId(raw as u32);
        }
        if !self.enter(Query::Constraint(ty)) {
            // `pushTypeResolution` marks every entry from the start of the cycle to the top of the
            // stack, whatever the kind of type. Callers call `has_non_circular_base_constraint`
            // while these entries are still on the stack.
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
            return TypeId::UNKNOWN;
        }
        // `computeBaseConstraint(getSimplifiedType(t, false))`: `{ [P in K]: E }[X]` is `E` with
        // `X` substituted for `P` before anything is replaced by its constraint.
        // The recursion goes at least 10 levels deep and at most 50, and from level 10 on it stops
        // at an instantiation of the same declaration as an earlier level.
        let identity = self.recursion_identity(ty);
        let depth = self.constraint_stack.len();
        let continues = depth < 10 || depth < 50 && !self.constraint_stack.contains(&identity);
        self.constraint_stack.push(identity);
        let t = if continues {
            self.simplified(ty, false)
        } else {
            // The cutoff depends on the enclosing chain, and `resolvedBaseConstraint` caches the
            // result anyway.
            TypeId::UNKNOWN
        };
        let result = match self.data(t) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
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
                    // `len(baseTypes) == len(types)`: an `any` member would turn the union into
                    // `any`.
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
                            // `t.accessFlags`: read under noUncheckedIndexedAccess, a value from an
                            // index signature may be missing.
                            let found = self
                                .indexed_access_flagged(obj, index, undefined, None)
                                .unwrap_or(TypeId::UNKNOWN);
                            // `getNextBaseConstraint`: the result is resolved in turn. Only `ty` is
                            // being resolved: a `t` that `getSimplifiedType` produced from it has
                            // its own constraint.
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
                // The keys of a generic mapped type with an `as` clause whose constraint is not
                // declared with `keyof` are its name type.
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
                        let mut names = Vec::new();
                        for &key in self.parts(keys) {
                            let mut pairs = self.types().mapping(mapper).to_vec();
                            pairs.push((param, key));
                            let with_key = self.types().mapper(pairs);
                            let name = self.instantiate(name, with_key);
                            names.push(name);
                            // A string key also covers number keys.
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
            TypeData::Cond { .. } => self.constraint_of_conditional(t),
            // `base_constraint_of` has the two cases of `computeBaseConstraint` for these, and
            // calls back here for their constituents.
            TypeData::Template { .. } | TypeData::StringMapping { .. } => {
                self.base_constraint_of_as(t, true).unwrap_or(t)
            }
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
        let left = self.leave(Query::Constraint(ty));
        // `!popTypeResolution()`: any resolution can close the cycle, and `resolvedBaseConstraint`
        // is then cached as `circularConstraintType`.
        // Marked when `enter` fails, in which case the frame itself is not marked.
        let marked = self
            .constraints_marked_circular
            .iter()
            .position(|&t| t == ty);
        if self.left_a_cycle || marked.is_some() {
            // Another frame of `ty` can be in progress below a `resolution_start` barrier. Its
            // first read was a miss, so it learns of the cycle at its own `leave`: the mark is for
            // that frame too.
            let is_in_flight = self.stack.contains(&Query::Constraint(ty));
            match marked {
                Some(marked) if !is_in_flight => {
                    self.constraints_marked_circular.swap_remove(marked);
                }
                None if is_in_flight => self.constraints_marked_circular.push(ty),
                _ => {}
            }
            // The value of an inner evaluation above a `resolution_start` barrier stays, if one was stored. It gets the flag.
            let known = self.p.constraints.get(&self.task, &ty);
            let known = known.map_or(TypeId::UNKNOWN, |(known, _)| known);
            self.p
                .constraints
                .rewrite(&self.task, ty, (known, true), Stored::new());
            return TypeId::UNKNOWN;
        }
        match left {
            Ok(stored) => {
                self.p
                    .constraints
                    .insert(&self.task, ty, (result, false), stored);
            }
            Err(open) => self.cache_provisionally(Query::Constraint(ty), u64::from(result.0), open),
        }
        result
    }

    /// The property `name` of an object type, an intersection, or the wrapper type of a primitive.
    pub fn prop_ref(&mut self, ty: TypeId, name: Atom) -> Option<(&'p Prop<'p>, MapperId)> {
        let members = self.members(ty)?;
        let prop = members.resolved.prop(name)?;
        if self.is_type_only_member(ty, name) {
            return None;
        }
        Some((prop, members.mapper))
    }

    /// `getPropertyOfTypeEx`: whether `ty` is the object type of a module that has `name` only
    /// through `export type *`. It is listed among the properties, but a lookup does not find it,
    /// and nothing substitutes for it.
    #[inline]
    pub(super) fn is_type_only_member(&self, ty: TypeId, name: Atom) -> bool {
        matches!(*self.data(ty), TypeData::Anon { origin: Origin::Module(module) | Origin::Namespace { module, .. }, .. } if self.files().is_type_only_star_export(module, name))
    }

    /// `getSymbolOfDeclaration(member)`. A late bound symbol is identified by the symbol the binder
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

    /// Whether `sym` is a member of a class, an interface or a type literal, or a parameter
    /// property: not an export of a module, a namespace or an enum.
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

    /// `symbol.Declarations` of the symbol of a property.
    pub(super) fn declarations_of_property(&mut self, sym: Sym) -> List<'p, (FileId, Decl)> {
        match self.files().decls_of(sym).first() {
            Some(&(file, first)) => self.declarations_of_member(file, first),
            None => List::default(),
        }
    }

    /// Whether `symbol.ValueDeclaration` is an assignment. A property declared after `this.name =
    /// value` shares one symbol with it, and determines its type.
    pub(super) fn is_declared_by_assignment(&self, sym: Sym) -> bool {
        matches!(
            self.files().value_declaration(sym),
            Some((_, Decl::Expando(_) | Decl::ThisProperty(_)))
        )
    }

    /// Those of them that are assignments, in the file of the symbol.
    pub(super) fn assignments_of_symbol(&mut self, sym: Sym) -> SmallVec<[ExprId; 2]> {
        let assignment = |&(file, decl): &(FileId, Decl)| match decl {
            Decl::Expando(e) | Decl::ThisProperty(e) if file == sym.file => Some(e),
            _ => None,
        };
        (self.declarations_of_property(sym).iter())
            .filter_map(assignment)
            .collect()
    }

    /// Those of them that are members of classes, interfaces and type literals.
    pub(super) fn members_of_symbol(&mut self, sym: Sym) -> SmallVec<[(FileId, MemberId); 2]> {
        members_among(&self.declarations_of_property(sym))
    }

    /// `symbol.Flags` of the symbol of a property. `lateBindMember`: each declaration adds the
    /// flags of its own symbol.
    pub(super) fn flags_of_property(&mut self, sym: Sym) -> SymFlags {
        let flags = self.files().flags(sym);
        if self.files().symbol(sym).name != known::computed {
            return flags;
        }
        let declarations = self.declarations_of_property(sym);
        declarations.iter().fold(flags, |flags, &(file, decl)| {
            let own = self.bound(file).symbol_of_declaration(decl);
            flags | self.bound(file).symbols[own.idx()].flags
        })
    }

    /// `prop.ValueDeclaration`
    pub(super) fn value_declaration_of_prop(&self, prop: &Prop) -> Option<(FileId, Decl)> {
        match *Self::value_declaration(prop)? {
            PropSource::Symbol(sym) => self.files().value_declaration(sym),
            PropSource::Literal(file, p) => Some((file, Decl::Property(p))),
            _ => None,
        }
    }

    /// `ValueDeclaration`: the source that locates the declaration of `prop`. `None`: it is
    /// synthesized, or it represents properties of the members of an intersection that are declared
    /// in several places (`createUnionOrIntersectionProperty`), not counting synthesized ones.
    pub(super) fn value_declaration<'a>(prop: &'a Prop<'a>) -> Option<&'a PropSource<'a>> {
        match &prop.source {
            // `addMemberForKeyTypeWorker` links `Declarations` to a mapped property, never a `ValueDeclaration`.
            PropSource::Type(_)
            | PropSource::Mapped(..)
            | PropSource::Copy(_, _, false)
            | PropSource::ReverseMapped(..) => None,
            PropSource::Copy(_, of, true) => of.iter().find_map(Self::value_declaration),
            PropSource::Intersected(_, parts) => {
                let mut declared = parts.iter().filter_map(Self::value_declaration);
                let first = declared.next()?;
                declared.all(|other| other == first).then_some(first)
            }
            source => Some(source),
        }
    }

    /// The source of a property of type `ty` that has the `Declarations` of the properties `of`,
    /// concatenated.
    /// `preserves_value_declaration`: also the `ValueDeclaration` and the `Parent` of the first
    /// (`createSymbolWithType`, and where `getSpreadSymbol` returns the symbol itself), not only
    /// the `Declarations` (the symbols `getSpreadSymbol` and `getSpreadType` recreate).
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

    /// The member `written` of an object literal, or attribute of a JSX element, when it is checked
    /// differently than `type_of_literal_prop` checks it: its symbol, with the type `ty`.
    pub(super) fn literal_member_of_type(
        file: FileId,
        written: PropId,
        name: Atom,
        ty: TypeId,
        arena: &'s Arena,
    ) -> Prop<'s> {
        let mut prop = Prop {
            name,
            flags: PropFlags::empty(),
            source: PropSource::Literal(file, written),
            mapper: MapperId::IDENTITY,
        };
        prop.source = Self::copy_of(ty, &[&prop], true, arena);
        prop
    }

    /// Whether `ty` is an intersection that reduces to `never`.
    #[inline]
    pub fn is_never_intersection(&mut self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Intersection(_)) && self.is_empty_intersection(ty)
    }

    /// `is_never_intersection` for an intersection.
    fn is_empty_intersection(&mut self, ty: TypeId) -> bool {
        if let Some(known) = self.p.never_intersections.get(&self.task, &ty) {
            return known;
        }
        // `ObjectFlagsIsNeverIntersectionComputed` is set before the properties are examined, so a recursive query gets `false`.
        if self.never_in_progress.contains(&ty) {
            return false;
        }
        let scope = self.begin_scope();
        self.never_in_progress.push(ty);
        self.never_in_progress_from.push(self.stack.len());
        // `isNeverReducedProperty`
        let is_never = self.has_property_in_several_members(ty)
            && self.may_have_never_reduced_property(ty, false)
            && self.why_never_intersection(ty).is_some();
        self.never_in_progress.pop();
        self.never_in_progress_from.pop();
        match self.end_scope_by_counters(scope) {
            Ok(stored) => self
                .p
                .never_intersections
                .insert(&self.task, ty, is_never, stored),
            Err(_) => is_never,
        }
    }

    /// `getReducedType(getApparentType(ty))` for an intersection `ty` whose properties
    /// `getReducedType(ty)` is examining. `getApparentTypeOfIntersectionType` gives `ty` to its
    /// classes, interfaces and tuples as the `this` argument and takes the apparent type of the
    /// other members. If that changes a member the result is another intersection, with an
    /// `ObjectFlagsIsNeverIntersectionComputed` of its own: its properties are created, which asks
    /// for the types of those that several members have once more. In any other state they all
    /// have their types by then, so there is one type here for both.
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
        self.never_in_progress.push(ty);
        if self.has_property_in_several_members(ty) {
            self.may_have_never_reduced_property(ty, true);
        }
        self.never_in_progress.pop();
    }

    /// `getPropertiesOfUnionOrIntersectionType(ty)` for an intersection `ty` whose properties
    /// `getReducedType(ty)` is examining. `resolvedProperties` is not set yet and the property that
    /// is being created is not in `propertyCache`, so `createUnionOrIntersectionProperty` asks for
    /// the types of the symbols that it combines once more.
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

    /// FOR SPEED: whether two members of the intersection `ty` may have a property with the same
    /// name. If not, every property of `ty` comes from one member (`singleProp` of
    /// `createUnionOrIntersectionProperty`), and `isNeverReducedProperty` is false for all of them.
    /// This is decided without building the shape of `ty` or, in `T & {}`, the base constraint of
    /// `T`: most intersections with a type parameter never need them, and every task would compute
    /// them separately.
    fn has_property_in_several_members(&mut self, ty: TypeId) -> bool {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return false;
        };
        // `keyof T & keyof U & string`: the apparent type of each is `String`, `Number`, `Symbol`
        // .. or a union of them (`getApparentType`). Two kinds of primitive reduce to `never` when
        // the intersection is created, so the remaining members share a wrapper, whose property is
        // among those on the other side: together they are not `never`.
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
        // Those that have properties. FOR SPEED: no set of all the names, each has an index.
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
                } else if let Some(members) = self.members(part)
                    && !members.shape().props.is_empty()
                {
                    let count = members.shape().props.len();
                    let shares_a_name = seen.iter().any(|earlier| {
                        let (few, many) = match count < earlier.shape().props.len() {
                            true => (&members, earlier),
                            false => (earlier, &members),
                        };
                        let mut few = few.shape().props.iter();
                        few.any(|prop| many.resolved.prop(prop.name).is_some())
                    });
                    if shares_a_name {
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

    /// FOR SPEED: whether `isNeverReducedProperty` may hold for a property of the intersection
    /// `ty`. Decided from the properties that two members share, taken as
    /// `build_intersection_shape` takes them, without building the shape: most intersections are
    /// asked nothing else, and a shape has a copy of every property of every member.
    ///
    /// `isDiscriminantWithNeverType` needs a property that some member X has without `?`, with
    /// `CheckFlagsNonUniformAndLiteral`. If for every other member with that property its type and
    /// that of X are the same, or neither is a literal type, then no type is a literal type, or
    /// that of X is one and all are the same. `isConflictingPrivateProperty` needs a property that
    /// is private in some member.
    ///
    /// `getReducedType` creates every property of `ty` first, and
    /// `createUnionOrIntersectionProperty` resolves the types of all the symbols that it combines,
    /// in `compareProperties` or in its last loop. One of them may be in resolution:
    /// ``class C { x? = `${this}` as const }``. So no pair is left out, and the first pair that
    /// decides does not end the search. Not even where nothing is in progress: the result is stored,
    /// and a member whose resolution starts later and needs this reduction would read it, where
    /// tsgo has started that resolution from here and closes the cycle in the reduction of the
    /// apparent type. `f(null! as C & { x?: 1 }); class C { x? = { a: f(null! as C & { x?: 1 }) } }`
    ///
    /// `is_apparent`: for `getApparentType(ty)`, in whose classes `this` is `ty`. In those of `ty`
    /// itself it is the class (`resolveTypeReferenceMembers`), so `p?: this["z"]` of `C` asks for
    /// `C["z"]` first and for `ty["z"]` in the reduction of the apparent type.
    fn may_have_never_reduced_property(&mut self, ty: TypeId, is_apparent: bool) -> bool {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return false;
        };
        let mut all: SmallVec<[Members<'p>; 4]> = SmallVec::new();
        for &written in parts.iter() {
            let part = self.apparent_type(written);
            let part = if self.is_union(part) {
                self.union_as_object(part)
            } else {
                part
            };
            let members = if self.is_deferred(written) {
                self.members_with_this(part, written)
            } else if is_apparent {
                let this_argument = ty;
                self.members_with_this(part, this_argument)
            } else {
                self.members(part)
            };
            if let Some(members) = members {
                all.push(members);
            }
        }
        // `isLiteralType`, `isPatternLiteralType`
        let is_literal = |c: &Self, t: TypeId| {
            c.is_boolean(t) || c.is_pattern_literal(t) || c.every_type(t, |c, m| c.is_unit(m))
        };
        let mut may = false;
        for (at, &later) in all.iter().enumerate().skip(1) {
            for prop in &later.shape().props {
                for &earlier in &all[..at] {
                    let Some(other) = earlier.resolved.prop(prop.name) else {
                        continue;
                    };
                    let (mut first, mut second) =
                        (other.clone_in(self.arena), prop.clone_in(self.arena));
                    self.instantiate_prop(&mut first, earlier.mapper);
                    self.instantiate_prop(&mut second, later.mapper);
                    // The same property reached through two paths.
                    if first == second {
                        continue;
                    }
                    let first = self.type_of_prop(&first, MapperId::IDENTITY);
                    let second = self.type_of_prop(&second, MapperId::IDENTITY);
                    may |= (prop.flags | other.flags).contains(PropFlags::PRIVATE)
                        || !(prop.flags & other.flags).contains(PropFlags::OPTIONAL)
                            && first != second
                            && (is_literal(self, first) || is_literal(self, second));
                }
            }
        }
        may
    }

    /// An intersection, or `ObjectFlagsContainsIntersections`.
    #[inline]
    pub(super) fn may_be_reduced(&self, ty: TypeId) -> bool {
        let flags = self.types().object_flags(ty);
        flags.contains(ObjectFlags::MAY_BE_REDUCED)
    }

    /// `ty` without the intersections that reduce to `never`.
    #[inline]
    pub fn reduced(&mut self, ty: TypeId) -> TypeId {
        if self.may_be_reduced(ty) {
            self.reduced_members(ty)
        } else {
            ty
        }
    }

    /// `reduced` for an intersection or a union with one among its members.
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

    /// The type of `ty.name` where it is only assigned: the target of `=`, of a destructuring
    /// assignment, of `for..of`.
    pub fn write_type_of_property(&mut self, ty: TypeId, name: Atom) -> Option<TypeId> {
        self.property_type(ty, name, Access::Written)
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

    /// `checkPropertyAccessExpressionOrQualifiedName`: the type of the property `name` of `ty`, or
    /// failing that of the applicable index signature, and which of the two it is.
    fn find_property(&mut self, ty: TypeId, name: Atom, access: Access) -> Option<(TypeId, Found)> {
        if self.is_any(ty) {
            return Some((ty, Found::Property));
        }
        let is_const_enum = self.is_const_enum_object(ty);
        if let Some((prop, mapper)) = self.get_property_of_type_ex(ty, name, is_const_enum) {
            let found = if access == Access::Written {
                self.write_type_of_prop(prop, mapper)
            } else {
                self.type_of_prop(prop, mapper)
            };
            let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
            return Some((
                found,
                if prop.flags.intersects(access) {
                    Found::Restricted
                } else {
                    Found::Property
                },
            ));
        }
        let apparent = self.reduced_apparent_type(ty);
        if self.is_any(apparent) {
            return Some((apparent, Found::Property));
        }
        // Nothing is written through an index signature of the constraint of a type parameter.
        if access != Access::Read
            && !matches!(self.data(ty), TypeData::ThisParam(_))
            && self.is_generic_object_type(ty)
        {
            return None;
        }
        let members = self.members_for_index_infos(apparent)?;
        let info = self.applicable_index_info_for_name(&members, name)?;
        Some((info.value, Found::ByIndex))
    }

    /// `getRestTypeOfTupleType` of the apparent type of `ty`, if that is a tuple: the type of its
    /// elements from the first non-fixed one on, `undefined` if all are fixed.
    fn beyond_fixed_elements(&mut self, ty: TypeId) -> Option<TypeId> {
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
    pub(super) fn is_const_enum_object(&self, ty: TypeId) -> bool {
        matches!(*self.data(ty), TypeData::Anon { origin: Origin::EnumObject(sym), .. }
            if self.files().decls(sym).iter().any(|&(f, d)| matches!(d, Decl::Enum(id) if self.hir(f)[id].flags.contains(Flags::CONST))))
    }

    /// `getPropertyOfType`
    pub(super) fn get_property_of_type(
        &mut self,
        ty: TypeId,
        name: Atom,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        self.get_property_of_type_ex(ty, name, false)
    }

    /// `getPropertyOfTypeEx`
    pub(super) fn get_property_of_type_ex(
        &mut self,
        ty: TypeId,
        name: Atom,
        skip_object_function_property_augment: bool,
    ) -> Option<(&'p Prop<'p>, MapperId)> {
        let apparent = self.reduced_apparent_type(ty);
        if self.is_union(apparent) {
            // `propertyCacheWithoutFunctionPropertyAugment`: a member that only has it as a
            // property of every object does not count as having it.
            if skip_object_function_property_augment
                && !(self.parts(apparent).iter())
                    .all(|&t| self.get_property_of_type_ex(t, name, true).is_some())
            {
                return None;
            }
            // `getPropertyOfUnionOrIntersectionType`: "We need to filter out partial properties in union types"
            let prop = self.union_property(apparent, name)?;
            return (!prop.flags.contains(PropFlags::READ_PARTIAL))
                .then_some((prop, MapperId::IDENTITY));
        }
        // `getApparentType`: in a member found through the constraint of a type parameter, `this`
        // is the type parameter.
        let members = if apparent != ty && self.is_deferred(ty) {
            let this_argument = ty;
            self.members_with_this(apparent, this_argument)?
        } else {
            self.members(apparent)?
        };
        if self.is_type_only_member(apparent, name) {
            return None;
        }
        if skip_object_function_property_augment {
            return Some((members.resolved.prop(name)?, members.mapper));
        }
        self.property_in_type(apparent, &members, name)
    }

    /// `getUnionOrIntersectionProperty` for a union.
    pub(super) fn union_property(&mut self, union: TypeId, name: Atom) -> Option<&'p Prop<'p>> {
        let holder = match self.p.union_properties.get(&self.task, &(union, name)) {
            Some(kept) => kept,
            None => {
                let scope = self.begin_scope();
                let holder = self.create_union_property(union, name).map(|prop| {
                    self.synth(Shape {
                        props: vec_from_iter_in([prop], self.arena),
                        ..Shape::new_in(self.arena)
                    })
                });
                if let Ok(stored) = self.end_scope_by_counters(scope) {
                    self.p
                        .union_properties
                        .insert(&self.task, (union, name), holder, stored);
                }
                holder
            }
        };
        match self.data(holder?) {
            TypeData::Synth(shape) => shape.props.first(),
            _ => None,
        }
    }

    /// `createUnionOrIntersectionProperty`, where `isUnion`. `build_intersection_shape` has the other half.
    fn create_union_property(&mut self, containing_type: TypeId, name: Atom) -> Option<Prop<'s>> {
        let access = PropFlags::PRIVATE | PropFlags::PROTECTED;
        let accessor = PropFlags::ACCESSOR | PropFlags::WRITE_ONLY;
        let is_late_bound = self.atoms().is_symbol_name(name);
        // `singleProp` is the first.
        let mut prop_set: SmallVec<[Prop<'s>; 4]> = SmallVec::new();
        let mut index_types: SmallVec<[TypeId; 4]> = SmallVec::new();
        let (mut flags, mut is_public, mut first_owner) =
            (PropFlags::empty(), false, containing_type);
        for &current in self.parts(containing_type) {
            let t = self.apparent_type(current);
            if self.is_error_type(t) || t.is_never() {
                continue;
            }
            if let Some((prop, mapper)) = self.get_property_of_type(current, name) {
                let mut prop = prop.clone_in(self.arena);
                self.instantiate_prop(&mut prop, mapper);
                // `prop.Flags&SymbolFlagsClassMember`: a variable of a module or of `globalThis` is
                // not considered.
                if !matches!(prop.source, PropSource::Symbol(sym) if !self.is_member_symbol(sym)) {
                    flags |= prop.flags & PropFlags::OPTIONAL;
                }
                flags |= prop.flags & (PropFlags::READONLY | access);
                is_public |= !prop.flags.intersects(access);
                match prop_set.first() {
                    None => {
                        first_owner = t;
                        flags |= prop.flags & accessor;
                        prop_set.push(prop);
                    }
                    Some(single) => {
                        // `prop.Flags&SymbolFlagsAccessor`: a getter alone is read-only.
                        let accessors = |p: &Prop| match p.flags.contains(PropFlags::ACCESSOR) {
                            true => p.flags & (accessor | PropFlags::READONLY),
                            false => PropFlags::empty(),
                        };
                        if accessors(&prop) != accessors(single) {
                            flags.remove(accessor);
                        }
                        // `isInstantiation`: instantiations of one property that have the same type are one property.
                        let is_same = *single == prop
                            || single.source == prop.source
                                && self.type_of_prop(single, MapperId::IDENTITY)
                                    == self.type_of_prop(&prop, MapperId::IDENTITY);
                        if !is_same && !prop_set.contains(&prop) {
                            prop_set.push(prop);
                        }
                    }
                }
                continue;
            }
            let index_info = match self.members_for_index_infos(t) {
                Some(members) if !is_late_bound => {
                    self.applicable_index_info_for_name(&members, name)
                }
                _ => None,
            };
            if let Some(info) = index_info {
                flags.remove(accessor);
                flags |= PropFlags::WRITE_PARTIAL;
                flags.set(
                    PropFlags::READONLY,
                    flags.contains(PropFlags::READONLY) || info.readonly,
                );
                index_types.push(self.beyond_fixed_elements(t).unwrap_or(info.value));
            } else if self.is_closed_object_literal_type(t) {
                flags |= PropFlags::WRITE_PARTIAL;
                index_types.push(TypeId::UNDEFINED);
            } else {
                flags |= PropFlags::READ_PARTIAL;
            }
        }
        let is_partial = flags.intersects(PropFlags::READ_PARTIAL | PropFlags::WRITE_PARTIAL);
        // "No property was found, or, in a union, a property has a private or protected declaration in one constituent, but is missing
        // or has a different declaration in another constituent."
        if prop_set.is_empty()
            || (prop_set.len() > 1 || is_partial)
                && flags.intersects(access)
                && !(prop_set.len() > 1 && Self::has_common_declaration(&prop_set, self.arena))
        {
            return None;
        }
        if prop_set.len() == 1 && !is_partial {
            return prop_set.pop();
        }
        let first_type = self.type_of_prop(&prop_set[0], MapperId::IDENTITY);
        for prop in &prop_set {
            let t = self.type_of_prop(prop, MapperId::IDENTITY);
            if t != first_type {
                flags |= PropFlags::HAS_NON_UNIFORM_TYPE;
            }
            // `isLiteralType`, `isPatternLiteralType`
            if self.is_boolean(t)
                || !t.is_never() && self.every_type(t, |c, m| c.is_unit(m))
                || self.is_pattern_literal(t)
            {
                flags |= PropFlags::HAS_LITERAL_TYPE;
            }
        }
        // `links.nameType`
        if self.is_numeric_name(name)
            && self
                .key_type_of_props(first_owner, &prop_set)
                .is_some_and(|key| self.is_string_like(key))
        {
            flags |= PropFlags::STRING_NAME;
        }
        // `getDeclarationModifierFlagsFromSymbol`: private if one is, else public if one is, else protected.
        if flags.contains(PropFlags::PRIVATE) || is_public {
            flags.remove(PropFlags::PROTECTED);
        }
        prop_set.extend(index_types.iter().map(|&t| Prop {
            name,
            flags: PropFlags::WRITE_PARTIAL,
            source: PropSource::Type(t),
            mapper: MapperId::IDENTITY,
        }));
        Some(Prop {
            name,
            flags,
            source: PropSource::Intersected(containing_type, self.list_of(prop_set)),
            mapper: MapperId::IDENTITY,
        })
    }

    /// `hasCommonDeclaration`
    fn has_common_declaration(props: &[Prop], arena: &'s Arena) -> bool {
        let mut common = Self::declared_properties(&[&props[0]], arena);
        for prop in &props[1..] {
            let other = Self::declared_properties(&[prop], arena);
            common.retain(|declared| other.iter().any(|it| it.source == declared.source));
        }
        !common.is_empty()
    }

    /// The members with the index signatures `getIndexInfosOfType(ty)` returns: for a union, those
    /// common to all its members.
    pub(super) fn members_for_index_infos(&mut self, ty: TypeId) -> Option<Members<'p>> {
        let ty = self.reduced_apparent_type(ty);
        let TypeData::Union(parts) = self.data(ty) else {
            return self.members(ty);
        };
        let index = self.union_index_infos(parts);
        let whole = self.synth(Shape {
            index: vec_from_iter_in(index, self.arena),
            ..Shape::new_in(self.arena)
        });
        self.members(whole)
    }

    /// `getApplicableIndexInfoForName`
    pub(super) fn applicable_index_info_for_name(
        &mut self,
        members: &Members,
        name: Atom,
    ) -> Option<IndexInfo> {
        // No index signature substitutes for the `#x` of a class
        // (`checkPropertyAccessExpressionOrQualifiedName`).
        if members.shape().index.is_empty() || self.is_private_identifier_symbol(name) {
            return None;
        }
        let key_type = if self.atoms().is_symbol_name(name) {
            TypeId::SYMBOL
        } else {
            self.string_literal(name, false)
        };
        self.applicable_index_info(members, key_type)
    }

    /// `findApplicableIndexInfo`, with the value type instantiated for `members`.
    pub fn applicable_index_info(
        &mut self,
        members: &Members,
        key_type: TypeId,
    ) -> Option<IndexInfo> {
        // The string index signature applies only where no other does.
        let mut string_index_info = None;
        let mut applicable: SmallVec<[&IndexInfo; 4]> = SmallVec::new();
        for info in &members.shape().index {
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
        let text = self.atoms().bytes(name);
        // The string form of a number begins with a digit or a `-`, or is one of two words.
        match text.first().copied() {
            Some(b'0'..=b'9') => {
                // An integer that a number represents exactly prints as its digits.
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
            .is_some_and(|n| crate::atom::number_to_string(n) == text)
    }

    /// The call or construct signatures of `ty`.
    pub fn signatures(&mut self, ty: TypeId, construct: bool) -> List<'p, SigId> {
        // Call signatures at the even indexes, construct signatures at the odd ones.
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
        if let Some(known) = kept.get_ref(&self.task, &ty) {
            let known: &'p [SigId] = known;
            self.recent_signatures[at] = (ty, known);
            return List::Kept(known);
        }
        let scope = self.begin_scope();
        let signatures = self.signatures_uncached(ty, construct);
        let ended = self.end_scope_by_counters(scope);
        // A type whose members are in place does not have its signatures yet (`shape_memo_or`).
        if self.declared_index_infos_in_progress.is_empty()
            && let Ok(stored) = ended
        {
            let signatures = signatures.into();
            let known: &'p [SigId] = kept.insert_ref(&self.task, ty, signatures, stored).1;
            self.recent_signatures[at] = (ty, known);
            return List::Kept(known);
        }
        List::Own(signatures.to_vec())
    }

    fn signatures_uncached(&mut self, ty: TypeId, construct: bool) -> Vec<SigId, &'s Arena> {
        // `getReducedApparentType`: an intersection that reduces to `never` has no signatures.
        let ty = self.reduced_apparent_type(ty);
        // `resolveUnionTypeMembers`: cached per union. Combining the signatures of many members is
        // quadratic in them.
        if self.is_union(ty) {
            let resolved = self.shape_memo(ty, |c| {
                // `t.Types()` are in the order of `CompareTypes`.
                let parts = c.parts(ty);
                Shape {
                    call: vec_from_iter_in(c.signatures_of_union(parts, false), c.arena),
                    construct: vec_from_iter_in(c.signatures_of_union(parts, true), c.arena),
                    ..Shape::new_in(c.arena)
                }
            });
            return if construct {
                resolved.resolved.shape.construct.to_vec_in(self.arena)
            } else {
                resolved.resolved.shape.call.to_vec_in(self.arena)
            };
        }
        let Some(members) = self.members(ty) else {
            return Vec::new_in(self.arena);
        };
        let sigs = if construct {
            &members.shape().construct
        } else {
            &members.shape().call
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
        {
            let mut lists = Vec::with_capacity(parts.len());
            for &part in parts.iter() {
                // `unknownSignature`: `Function` itself is callable without arguments, and returns
                // the error type.
                let sigs = if !construct
                    && self
                        .is_global_ref(part, known::Function)
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
    }

    /// `getArrayMemberCallSignatures`: a method of `A[] | B[]` whose signatures cannot be unified
    /// is called as that of `(A | B)[]`. `parts`: the members of the union type of the method.
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
            // The type argument for the type parameter of the array in that member.
            let param = self.type_param(file, hir[i].type_params.at(0));
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
                // Only signatures whose parameters do not match a result yet.
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
                let mut these = Vec::new();
                for &m in &matching {
                    these.extend(self.sig_this_type(m));
                }
                let this = if these.is_empty() {
                    None
                } else {
                    Some(self.intersection(&these))
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
        source: SigId,
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
            // The constraint and the default of a declared type parameter are instantiated in the
            // same step in which it is renamed.
            let renaming = self.mapper_from(&source_type_params, &target_type_params);
            let mut pairs = self.types().mapping(source_around).to_vec();
            pairs.extend(
                source_type_params
                    .iter()
                    .copied()
                    .zip(target_type_params.iter().copied()),
            );
            let renaming_as_declared = self.types().mapper(pairs);
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
                    if !compare_types(self, a, b).holds() {
                        return Ternary::FALSE;
                    }
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
        let sp = self.sig_params(source);
        for i in 0..self.parameter_count(&tp) {
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

    /// The mapper for the outer type parameters of `sig` at the type where it was found. The type
    /// parameters of a method are already instantiated with it (`cloneTypeParameter`). Those of a
    /// class, which are those of its construct signatures, are not recreated: their constraints and
    /// defaults are read through this mapper.
    fn mapper_around_sig(&mut self, sig: SigId) -> MapperId {
        match *self.types().sig(sig) {
            SigData::Decl { mapper, .. }
            | SigData::Construct { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. } => mapper,
            SigData::WithReturn { sig: inner, .. } => self.mapper_around_sig(inner),
            // The type parameters of a union signature are those of the first constituent signature
            // that has any.
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

    /// Whether `param` is a declared type parameter, not a clone created for the type where its
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
        self.type_parameters_identical_around(
            source,
            MapperId::IDENTITY,
            target,
            MapperId::IDENTITY,
        )
    }

    /// The same for the type parameters of signatures whose outer type parameters are mapped by
    /// `source_around` and `target_around`.
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
        // The constraint of a declared type parameter is instantiated in the same step in which it
        // is renamed.
        let renaming = self.mapper_from(target, source);
        let mut pairs = self.types().mapping(target_around).to_vec();
        pairs.extend(target.iter().copied().zip(source.iter().copied()));
        let renaming_as_declared = self.types().mapper(pairs);
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
            if !self.is_identical(sc, tc) {
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
        // `minArgumentCount`: the greater of the two as declared, where a rest parameter counts as
        // zero, tuple or not. Here the optionality of the parameters determines the minimum
        // argument count.
        let least = Self::min_args(left).max(Self::min_args(right));
        let mut params = Vec::with_capacity(longest_count + 1);
        for i in 0..longest_count {
            // `tryGetTypeAtPosition`: where one of them has no parameter, that counts as `unknown`.
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
                is_required_rest: false,
                rest: true,
                has_declaration: false,
            });
        }
        params
    }

    /// `combineUnionOrIntersectionMemberSignatures`: for a union, parameters are intersected and
    /// return types are unioned; for an intersection the reverse.
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
        // `combineUnionOrIntersectionThisParam`: like a parameter.
        let this = match (self.sig_this_type(left), self.sig_this_type(right)) {
            (Some(l), Some(r)) => Some(if is_union {
                self.intersection(&[l, r])
            } else {
                self.union(&[l, r])
            }),
            (l, r) => l.or(r),
        };
        // `left.composite != nil && left.composite.isUnion`, whatever `is_union` is.
        let mut of: Vec<SigId> = match self.types().sig(left) {
            SigData::Synth {
                of: members,
                is_union: true,
                ..
            } if members.len() > 1 => members.to_vec(),
            _ => vec![left],
        };
        of.push(right);
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

/// Those of `declarations` that are members of classes, interfaces and type literals.
pub(super) fn members_among(declarations: &[(FileId, Decl)]) -> SmallVec<[(FileId, MemberId); 2]> {
    let member = |&(file, decl): &(FileId, Decl)| match decl {
        Decl::Member(m) => Some((file, m)),
        _ => None,
    };
    declarations.iter().filter_map(member).collect()
}

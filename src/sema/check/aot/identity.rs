//! What a type is called by what outlives the task that made it, and how a type itself outlives its task.
//!
//! A `TypeId` with `LOCAL` dies with its task, and two tasks that make the same type give it different ids. The content hash of the merge
//! step (`types.rs`) tells that they are the same, but only within a step: it takes a published id for its number, so a type hashes
//! differently once one of its parts has been published. An identity goes all the way down: to the texts, the files, the nodes and the
//! symbols that the type comes from. Those are numbered when the program is loaded, before the first task. So it is the same in every
//! task of every step of a run.
//!
//! It is a name and nothing else: no order of anything may follow from it, and nothing can be asked of it. Whoever has to ask about the
//! type once its task has ended keeps the type: `keep_type`.

use crate::atom::{Atom, Atoms};
use crate::check::Checker;
use crate::check::task::Stored;
use crate::program::{FileId, Sym};
use crate::bind::{ScopeKind, SymFlags};
use crate::hir::{Keyword, TypeNodeId, TypeNodeKind};
use crate::local::MaybeLocal;
use crate::types::{ComponentsId, Follow, Lanes, Literalness, MapperId, Origin, Prop, PropFlags, PropSource, Provenance, Shape, SigId, TypeData, TypeId, Types, UnionOrigin, Visitor, tf};
use crate::util::FxHashMap;
use crate::util::memory::Cells;
use std::hash::Hash;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

/// 128 bits. Two types with one identity are taken for the same type.
pub type Identity = [u64; 2];

/// The identities found so far. The keys are ids, so it is good for one task.
#[derive(Default)]
pub(super) struct State {
    types: FxHashMap<TypeId, Identity>,
    sigs: FxHashMap<SigId, Identity>,
    mappers: FxHashMap<MapperId, Identity>,
    components: FxHashMap<ComponentsId, Identity>,
    /// `Checker::type_parameters_named_within`
    named_within: FxHashMap<(FileId, TypeNodeId), Option<Vec<Sym>>>,
}

#[derive(Default)]
struct Identities(Cells<AtomicU64>);

impl Identities {
    #[inline]
    fn get(&self, number: u32) -> Option<Identity> {
        let first = self.0.cell(2 * number).load(Ordering::Acquire);
        (first != 0).then(|| [first, self.0.cell(2 * number + 1).load(Ordering::Relaxed)])
    }

    fn put(&self, number: u32, identity: Identity) -> bool {
        self.0.cell(2 * number + 1).store(identity[1], Ordering::Relaxed);
        self.0.cell(2 * number).store(identity[0], Ordering::Release);
        identity[0] != 0
    }
}

#[derive(Default)]
pub(super) struct Shared {
    types: Identities,
    sigs: Identities,
    mappers: Identities,
    components: Identities,
    names_of_files: OnceLock<Vec<Identity>>,
}

impl Shared {
    fn name_of_file(&self, file: FileId) -> Identity {
        match self.names_of_files.get().and_then(|names| names.get(file.idx())) {
            Some(&name) => name,
            None => [u64::from(file.0), 0],
        }
    }
}

fn rest_within<'a>(name: &'a [u8], directory: &[u8], is_case_sensitive: bool) -> Option<&'a [u8]> {
    let directory = directory.strip_suffix(b"/").unwrap_or(directory);
    if directory.is_empty() || name.len() <= directory.len() || name[directory.len()] != b'/' {
        return None;
    }
    let (start, rest) = name.split_at(directory.len());
    let is_same = if is_case_sensitive { start == directory } else { start.eq_ignore_ascii_case(directory) };
    is_same.then_some(&rest[1..])
}

/// What takes the checker to say: how a record would look to every task.
trait Normalizer {
    /// `Checker::members_of_intersection_once_resolved`
    fn members_of_intersection(&mut self, members: &[TypeId]) -> Vec<TypeId>;

    /// `Checker::pairs_of_named_type_parameters`
    fn pairs_that_matter(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)>;

    fn structure_of_literal(&mut self, ty: TypeId) -> Option<Vec<(Atom, u8, TypeId)>>;
}

/// What a walk has at hand besides the records.
struct Known<'a> {
    state: &'a mut State,
    checker: &'a mut dyn Normalizer,
    shared: &'a Shared,
    times_checker_was_asked: u32,
}

/// Which kind of record is hashed: no two kinds share an identity.
#[derive(Copy, Clone)]
enum Of {
    Type = 1,
    Sig,
    Mapper,
    Components,
}

/// Everything a task sees.
#[derive(Copy, Clone)]
struct Records<'p, 's> {
    types: Types<'p, 's>,
    atoms: Atoms<'p, 's>,
}

/// A visitor of a whole record, which is told more than `Follow::visit` tells.
trait Walker: Visitor {
    /// As a set: two tasks may have the items in different orders, and one task may hold for two what another holds for one.
    fn unordered<T: Follow>(&mut self, items: &[T]);

    /// In their order, each once.
    fn distinct<T: Follow>(&mut self, items: &[T]);

    /// The members of an intersection.
    fn intersected(&mut self, members: &[TypeId]);

    /// The mapper of an instantiation of what the type node declares.
    fn applied(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId);

    /// What comes next is that field of the provenance.
    fn field(&mut self, _name: &'static str) {}
}

/// Computes the identity of one record. An id is hashed as the identity of its record, published or not.
struct Identify<'a, 'k, 'p, 's> {
    lanes: Lanes,
    records: Records<'p, 's>,
    known: &'a mut Known<'k>,
}

impl<'a, 'k, 'p, 's> Identify<'a, 'k, 'p, 's> {
    fn new(records: Records<'p, 's>, known: &'a mut Known<'k>, of: Of) -> Self {
        let mut lanes = Lanes::START;
        lanes.add(of as u64);
        Identify { lanes, records, known }
    }

    fn add(&mut self, identity: Identity) {
        self.lanes.add(identity[0]);
        self.lanes.add(identity[1]);
    }
}

impl Identify<'_, '_, '_, '_> {
    /// What each of the items is hashed to by itself.
    fn each<T: Follow>(&mut self, items: &[T]) -> Vec<Identity> {
        let mut each = Vec::with_capacity(items.len());
        for item in items {
            let mut one = Identify { lanes: Lanes::START, records: self.records, known: &mut *self.known };
            item.visit(&mut one);
            each.push(one.lanes.0);
        }
        each
    }
}

impl Walker for Identify<'_, '_, '_, '_> {
    fn unordered<T: Follow>(&mut self, items: &[T]) {
        let mut each = self.each(items);
        each.sort_unstable();
        each.dedup();
        self.lanes.add(each.len() as u64);
        for one in each {
            self.add(one);
        }
    }

    fn distinct<T: Follow>(&mut self, items: &[T]) {
        let each = self.each(items);
        let is_first = |at: usize| !each[..at].contains(&each[at]);
        self.lanes.add((0..each.len()).filter(|&at| is_first(at)).count() as u64);
        for at in (0..each.len()).filter(|&at| is_first(at)) {
            self.add(each[at]);
        }
    }

    fn intersected(&mut self, members: &[TypeId]) {
        self.known.times_checker_was_asked += 1;
        let members = self.known.checker.members_of_intersection(members);
        self.distinct(&members);
    }

    fn applied(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) {
        let pairs = self.known.checker.pairs_that_matter(mapper, file, node);
        self.unordered(&pairs);
    }
}

impl Visitor for Identify<'_, '_, '_, '_> {
    /// By its text: the number of an atom differs from run to run, and an atom of a task gets another one when it is published.
    fn atom(&mut self, atom: Atom) {
        self.plain(&atom.is_some());
        if atom.is_some() {
            self.records.atoms.bytes(atom).hash(&mut self.lanes);
        }
    }

    fn components(&mut self, id: ComponentsId) {
        let identity = self.records.of_components(self.known, id);
        self.add(identity);
    }

    fn mapper(&mut self, id: MapperId) {
        let identity = self.records.of_mapper(self.known, id);
        self.add(identity);
    }

    fn sig(&mut self, id: SigId) {
        let identity = self.records.of_sig(self.known, id);
        self.add(identity);
    }

    fn ty(&mut self, id: TypeId) {
        let identity = self.records.of_type(self.known, id);
        self.add(identity);
    }

    fn file(&mut self, file: FileId) {
        let name = self.known.shared.name_of_file(file);
        self.add(name);
    }

    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.lanes);
    }
}

/// The records a record references are older than it, so each of these ends.
impl Records<'_, '_> {
    /// What `content_of_type` hashes, in that order. A union is hashed as a set, and so is an origin that is a union: the order of the
    /// members may be that of their ids.
    ///
    /// The checker leaves out a member of a union or an intersection that is there already, which it tells by the id. Two types of a task that
    /// become one when they are published have two ids until then. So the task has `A & A & B` where a later task makes `A & B` of the
    /// published parts. A member counts once here. And it leaves `{}` out of an intersection, which it does not always know for what it is:
    /// see `Checker::members_of_intersection_once_resolved`.
    ///
    /// The mapper of an instantiation has pairs for type parameters that what is instantiated does not depend on: see
    /// `Checker::pairs_of_named_type_parameters`.
    fn walk_type<W: Walker>(self, ty: TypeId, it: &mut W) {
        match self.types.get(ty) {
            data @ TypeData::Union(members) => {
                it.plain(&std::mem::discriminant(data));
                it.unordered(members);
            }
            data @ TypeData::Intersection(members) => {
                it.plain(&std::mem::discriminant(data));
                it.intersected(members);
            }
            data @ &TypeData::Anon { origin: origin @ (Origin::Mapped(file, node) | Origin::TypeLiteral(file, node)), mapper } => {
                it.plain(&std::mem::discriminant(data));
                origin.visit(it);
                it.applied(mapper, file, node);
            }
            data @ TypeData::Synth(shape) => {
                it.plain(&std::mem::discriminant(data));
                self.walk_shape(shape, it);
            }
            data => data.visit(it),
        }
        let provenance = self.types.provenance(ty);
        it.field("provenance");
        it.plain(&provenance.is_some());
        if let Some(Provenance { alias, origin, is_enum, stored_under, is_array_literal, is_array_pattern, has_other_instantiation }) = provenance {
            it.field("alias");
            alias.visit(it);
            it.field("origin");
            match origin {
                UnionOrigin::Union(types) => {
                    it.plain(&std::mem::discriminant(origin));
                    it.unordered(types);
                }
                UnionOrigin::Intersection(types) => {
                    it.plain(&std::mem::discriminant(origin));
                    it.intersected(types);
                }
                origin => origin.visit(it),
            }
            it.field("is_enum");
            is_enum.visit(it);
            it.field("stored_under");
            stored_under.visit(it);
            it.field("is_array_literal");
            is_array_literal.visit(it);
            it.field("is_array_pattern");
            is_array_pattern.visit(it);
            it.field("has_other_instantiation");
            has_other_instantiation.visit(it);
        }
    }

    /// A property of a union has the properties of the parts that it is made of in the order of the parts.
    ///
    /// `Checker::get_undefined_property` makes one property for each name, out of the first by the name that the task comes by: what declares
    /// it and whether it is read-only are that one's.
    fn walk_shape<W: Walker>(self, shape: &Shape<'_>, it: &mut W) {
        let Shape {
            symbol_declared_at,
            symbol,
            props,
            call,
            construct,
            index,
            literal,
            is_regular,
            contains_widening_type,
            is_js_literal,
            is_object_rest_type,
            instantiation_expression,
            instantiation_target,
            default_of,
            created_from,
            spread_rank,
            properties_of,
            single_signature_arguments,
            has_no_instantiable_symbol,
            pattern_at,
            mapper,
        } = shape;
        symbol_declared_at.visit(it);
        symbol.visit(it);
        it.plain(&props.len());
        for Prop { name, flags, source, mapper, name_type } in props.iter() {
            name.visit(it);
            name_type.visit(it);
            if let PropSource::Copy(ty, ..) = source
                && (*ty == TypeId::UNDEFINED || *ty == TypeId::MISSING)
                && flags.contains(PropFlags::OPTIONAL)
            {
                it.plain(&std::mem::discriminant(source));
                ty.visit(it);
                continue;
            }
            flags.visit(it);
            match source {
                PropSource::Intersected(of, constituents) if matches!(self.types.get(*of), TypeData::Union(_)) => {
                    it.plain(&std::mem::discriminant(source));
                    of.visit(it);
                    it.unordered(constituents);
                }
                source => source.visit(it),
            }
            mapper.visit(it);
        }
        call.visit(it);
        construct.visit(it);
        index.visit(it);
        literal.visit(it);
        is_regular.visit(it);
        contains_widening_type.visit(it);
        is_js_literal.visit(it);
        is_object_rest_type.visit(it);
        instantiation_expression.visit(it);
        instantiation_target.visit(it);
        default_of.visit(it);
        created_from.visit(it);
        spread_rank.visit(it);
        properties_of.visit(it);
        single_signature_arguments.visit(it);
        has_no_instantiable_symbol.visit(it);
        pattern_at.visit(it);
        mapper.visit(it);
    }

    fn of_type(self, known: &mut Known<'_>, ty: TypeId) -> Identity {
        if !ty.is_local()
            && let Some(identity) = known.shared.types.get(ty.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.types.get(&ty) {
            known.times_checker_was_asked += 1;
            return identity;
        }
        let asked_before = known.times_checker_was_asked;
        known.times_checker_was_asked += u32::from(matches!(self.types.get(ty), TypeData::Intersection(_) | TypeData::Anon { origin: Origin::ObjectLiteral(..), .. }));
        // `A & A` is `A` to whoever sees that they are one.
        let members = match self.types.get(ty) {
            TypeData::Union(members) => members.to_vec(),
            TypeData::Intersection(members) => known.checker.members_of_intersection(members),
            _ => Vec::new(),
        };
        if let Some((&first, rest)) = members.split_first() {
            let only = self.of_type(known, first);
            if rest.iter().all(|&member| self.of_type(known, member) == only) {
                if ty.is_local() || known.times_checker_was_asked != asked_before || !known.shared.types.put(ty.0, only) {
                    known.state.types.insert(ty, only);
                }
                return only;
            }
        }
        let structure = known.checker.structure_of_literal(ty);
        let mut it = Identify::new(self, known, Of::Type);
        match structure {
            Some(fields) => {
                it.plain("a literal, by its structure");
                it.plain(&fields.len());
                for (name, flags, of_field) in fields {
                    it.atom(name);
                    it.plain(&flags);
                    it.ty(of_field);
                }
            }
            None => self.walk_type(ty, &mut it),
        }
        let identity = it.lanes.0;
        if ty.is_local() || known.times_checker_was_asked != asked_before || !known.shared.types.put(ty.0, identity) {
            known.state.types.insert(ty, identity);
        }
        identity
    }

    fn of_sig(self, known: &mut Known<'_>, sig: SigId) -> Identity {
        if !sig.is_local()
            && let Some(identity) = known.shared.sigs.get(sig.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.sigs.get(&sig) {
            known.times_checker_was_asked += 1;
            return identity;
        }
        let asked_before = known.times_checker_was_asked;
        let mut it = Identify::new(self, known, Of::Sig);
        self.types.sig(sig).visit(&mut it);
        let identity = it.lanes.0;
        if sig.is_local() || known.times_checker_was_asked != asked_before || !known.shared.sigs.put(sig.0, identity) {
            known.state.sigs.insert(sig, identity);
        }
        identity
    }

    /// The pairs are in the order of the ids of the type parameters.
    fn of_mapper(self, known: &mut Known<'_>, mapper: MapperId) -> Identity {
        if mapper == MapperId::IDENTITY {
            return [Of::Mapper as u64, 0];
        }
        if !mapper.is_local()
            && let Some(identity) = known.shared.mappers.get(mapper.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.mappers.get(&mapper) {
            known.times_checker_was_asked += 1;
            return identity;
        }
        let asked_before = known.times_checker_was_asked;
        let mut it = Identify::new(self, known, Of::Mapper);
        it.unordered(self.types.mapping(mapper));
        let identity = it.lanes.0;
        if mapper.is_local() || known.times_checker_was_asked != asked_before || !known.shared.mappers.put(mapper.0, identity) {
            known.state.mappers.insert(mapper, identity);
        }
        identity
    }

    fn of_components(self, known: &mut Known<'_>, components: ComponentsId) -> Identity {
        if components == ComponentsId::NONE {
            return [Of::Components as u64, 0];
        }
        if !components.is_local()
            && let Some(identity) = known.shared.components.get(components.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.components.get(&components) {
            known.times_checker_was_asked += 1;
            return identity;
        }
        let asked_before = known.times_checker_was_asked;
        let mut it = Identify::new(self, known, Of::Components);
        self.types.components(components).visit(&mut it);
        let identity = it.lanes.0;
        if components.is_local() || known.times_checker_was_asked != asked_before || !known.shared.components.put(components.0, identity) {
            known.state.components.insert(components, identity);
        }
        identity
    }
}

impl Checker<'_, '_> {
    /// What the type is called by what outlives the task.
    pub fn identity_of_type(&mut self, ty: TypeId) -> Identity {
        if !ty.is_local()
            && let Some(identity) = self.p.aot.identity.types.get(ty.0)
        {
            return identity;
        }
        match self.aot.identity.types.get(&ty) {
            Some(&identity) => identity,
            None => self.with_known(|records, known| records.of_type(known, ty)),
        }
    }

    fn with_known<T>(&mut self, walk: impl FnOnce(Records<'_, '_>, &mut Known<'_>) -> T) -> T {
        let records = Records { types: self.types(), atoms: self.atoms() };
        // The checker keeps what it looks up itself.
        let mut state = std::mem::take(&mut self.aot.identity);
        self.aot.identity.named_within = std::mem::take(&mut state.named_within);
        let program = self.p;
        program.aot.identity.names_of_files.get_or_init(|| {
            let files = &program.files;
            let directories = [&files.options.current_directory[..], &files.options.lib_dir[..]];
            (0..files.modules.len() as u32)
                .map(|number| {
                    let name = files.module(FileId(number)).file_name();
                    let within = (0..directories.len()).find_map(|which| Some((which, rest_within(name, directories[which], files.is_case_sensitive)?)));
                    let (which, shown) = within.unwrap_or((directories.len(), name));
                    let mut lanes = Lanes::START;
                    lanes.add(which as u64);
                    shown.hash(&mut lanes);
                    lanes.0
                })
                .collect()
        });
        let result = walk(records, &mut Known { state: &mut state, checker: self, shared: &program.aot.identity, times_checker_was_asked: 0 });
        state.named_within = std::mem::take(&mut self.aot.identity.named_within);
        self.aot.identity = state;
        result
    }

    /// The members of an intersection as a task has them that finds the members of each of them resolved.
    ///
    /// The checker leaves `{}` out next to a type that cannot be null or undefined, and of several it keeps the first. An object type that is
    /// created without its members counts as `{}` only once something has resolved them: `is_empty_anonymous_object_type`, which does as
    /// `tsgo` does. The task of a file finds that done or not, depending on what the files before it have looked at. So one task has
    /// `A & B & E` where a later one has `A & B`.
    fn members_of_intersection_once_resolved(&mut self, members: &[TypeId]) -> Vec<TypeId> {
        let is_empty: Vec<bool> = members.iter().map(|&member| self.is_empty_anonymous_object_type_once_resolved(member)).collect();
        let Some(first) = is_empty.iter().position(|&is_empty| is_empty) else { return members.to_vec() };
        let is_non_nullable = (0..members.len()).any(|at| !is_empty[at] && self.flags(members[at]) & tf::DEFINITELY_NON_NULLABLE != 0);
        (0..members.len()).filter(|&at| !is_empty[at] || at == first && !is_non_nullable).map(|at| members[at]).collect()
    }

    /// The pairs of the mapper of an instantiation of what the type node declares, less those for type parameters that the declared type cannot
    /// depend on.
    ///
    /// The checker gives a declared type a pair for every type parameter that it possibly refers to, as `tsgo` does: those it names, all that are
    /// declared beyond a block, and those that a function around it has adopted from its contextual signature
    /// (`identity_mapper_of_mentioned_in_scope`, `adopted_type_params_in_scope`). What the others are mapped to depends on who has
    /// instantiated the type first, which differs from task to task, and makes no difference to the type.
    fn pairs_of_named_type_parameters(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)> {
        let pairs = self.types().mapping(mapper);
        if pairs.is_empty() {
            return Vec::new();
        }
        let Some(named) = self.type_parameters_named_within(file, node) else { return pairs.to_vec() };
        let matters = |source: TypeId| match *self.data(source) {
            TypeData::TypeParam(of, param, _) => named.contains(&self.files().sym(of, self.bound(of).type_param_symbol[param.idx()])),
            _ => true,
        };
        pairs.iter().copied().filter(|pair| matters(pair.0)).collect()
    }

    /// The type parameters that the type node names, if the type it declares depends on no other. `None`: it may. It queries a value or `this`, or
    /// refers to a type that is declared within a function, a class or another type, which may depend on what is in scope there
    /// without the node saying so.
    fn type_parameters_named_within(&mut self, file: FileId, node: TypeNodeId) -> Option<Vec<Sym>> {
        if let Some(known) = self.aot.identity.named_within.get(&(file, node)) {
            return known.clone();
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (start, end) = (hir[node].pos, hir[node].end);
        // What is within a node is told by the text. A node that the parser has made up has none, and JSDoc is not where it applies.
        let mut named = (start < end && !hir.is_js).then(Vec::new);
        for (index, inner) in hir.types.iter().enumerate().filter(|(_, inner)| start <= inner.pos && inner.end <= end) {
            let Some(so_far) = &mut named else { break };
            match inner.kind {
                TypeNodeKind::Ref { name, .. } => {
                    let meaning = if name.len() == 1 { SymFlags::TYPE } else { SymFlags::NAMESPACE };
                    let Some(first) = hir.texts(name).next() else { continue };
                    let Some(found) = self.files().resolve_name(file, bound.type_scope[index], first, meaning) else { continue };
                    if self.files().flags(found).contains(SymFlags::TYPE_PARAMETER) {
                        if !so_far.contains(&found) {
                            so_far.push(found);
                        }
                        continue;
                    }
                    let is_at_top_level = self.files().decls(found).into_iter().all(|(of, decl)| {
                        let scopes = &self.bound(of).scopes;
                        let mut scope = self.bound(of).scope_of_declaration(self.hir(of), decl);
                        while scope.is_some() && matches!(scopes[scope.idx()].kind, ScopeKind::File | ScopeKind::Module(_)) {
                            scope = scopes[scope.idx()].parent;
                        }
                        scope.is_none()
                    });
                    if !is_at_top_level {
                        named = None;
                    }
                }
                TypeNodeKind::Typeof { .. } | TypeNodeKind::Keyword(Keyword::This) | TypeNodeKind::Heritage { .. } | TypeNodeKind::JSDoc { .. } | TypeNodeKind::Error => named = None,
                _ => {}
            }
        }
        self.aot.identity.named_within.insert((file, node), named.clone());
        named
    }

    fn is_empty_anonymous_object_type_once_resolved(&mut self, ty: TypeId) -> bool {
        if matches!(ty, TypeId::EMPTY_OBJECT | TypeId::EMPTY_TYPE_LITERAL) {
            return true;
        }
        match self.data(ty) {
            TypeData::Synth(shape) if shape.literal == Literalness::SyntheticDefault => true,
            TypeData::Anon { origin: Origin::Mapped(..), .. } => false,
            TypeData::Synth(_) | TypeData::Anon { .. } | TypeData::ReverseMapped { .. } => {
                !self.is_any_function_type(ty)
                    && self.members(ty).is_some_and(|members| {
                        let shape = members.shape();
                        shape.props.is_empty() && shape.call.is_empty() && shape.construct.is_empty() && shape.index.is_empty()
                    })
            }
            _ => false,
        }
    }

    /// The type outlives the task, if that is a task of the plan and is found valid: it is published with everything it is made of, and
    /// is among `kept_types` from the barrier on. What a task outside the plan keeps is dropped with it, like all it writes. So is a
    /// type that is bound to a file that nothing imports.
    pub fn keep_type(&mut self, ty: TypeId) {
        self.p.kept_types.insert(&self.task, ty, (), Stored::new());
    }

    /// The published types that tasks have kept, in the order of their ids, which is a function of the program. A type can be kept
    /// long after it was published.
    pub fn kept_types(&self) -> Vec<TypeId> {
        let published = (0..self.p.types.number_of_types()).map(TypeId);
        published.filter(|ty| self.p.kept_types.get(&self.task, ty).is_some()).collect()
    }
}

impl Normalizer for Checker<'_, '_> {
    fn members_of_intersection(&mut self, members: &[TypeId]) -> Vec<TypeId> {
        self.members_of_intersection_once_resolved(members)
    }

    fn pairs_that_matter(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)> {
        self.pairs_of_named_type_parameters(mapper, file, node)
    }

    fn structure_of_literal(&mut self, ty: TypeId) -> Option<Vec<(Atom, u8, TypeId)>> {
        self.structure_of_plain_literal(ty)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atom::Interner;
    use crate::hir::TypeParamId;
    use crate::local::MaybeLocal;
    use crate::session::Session;
    use crate::types::{Link, Marks, Origin, OwnStore, TypeStore};

    const FILE: FileId = FileId(3);

    /// Takes every record as it is.
    struct AsItIs<'p, 's>(Types<'p, 's>);

    impl Normalizer for AsItIs<'_, '_> {
        fn members_of_intersection(&mut self, members: &[TypeId]) -> Vec<TypeId> {
            members.to_vec()
        }

        fn pairs_that_matter(&mut self, mapper: MapperId, _: FileId, _: TypeNodeId) -> Vec<(TypeId, TypeId)> {
            self.0.mapping(mapper).to_vec()
        }

        fn structure_of_literal(&mut self, _: TypeId) -> Option<Vec<(Atom, u8, TypeId)>> {
            None
        }
    }

    fn with<T>(records: Records<'_, '_>, state: &mut State, walk: impl FnOnce(&mut Known<'_>) -> T) -> T {
        walk(&mut Known { state, checker: &mut AsItIs(records.types), shared: &super::Shared::default(), times_checker_was_asked: 0 })
    }

    fn forwards(count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }

    struct Shared<'s> {
        atoms: Interner<'s>,
        types: TypeStore<'s>,
    }

    impl<'s> Shared<'s> {
        fn records<'p>(&'p self, own: &OwnStore<'s>) -> Records<'p, 's> {
            Records { types: Types::new(&self.types, own), atoms: Atoms::new(&self.atoms, own) }
        }

        /// The barrier after a step with one task, which publishes `root` and what it is made of.
        fn publish(&self, own: &mut OwnStore<'s>, root: TypeId) -> Link {
            let mut marks = Marks::new(own);
            root.mark(&mut marks);
            let records = own.finish(marks);
            let (mut links, _) = self.types.link(&self.atoms, vec![records], &forwards, &|_| {});
            links.pop().unwrap()
        }
    }

    /// `{ .. }` at a node of `FILE`, where `T` is `keyof "first text" | keyof "second text"` and `U` is `"second text"`. `is_reversed`: the
    /// parts are made, and so numbered, the other way around, and the members of the union are in that order.
    fn make(records: Records<'_, '_>, is_reversed: bool) -> TypeId {
        let Records { types, atoms } = records;
        let texts: [&[u8]; 2] = [b"first text", b"second text"];
        let order = if is_reversed { [1, 0] } else { [0, 1] };
        let (mut params, mut literals, mut keys) = ([TypeId::ANY; 2], [TypeId::ANY; 2], Vec::new());
        for index in order {
            params[index] = types.intern(TypeData::TypeParam(FILE, TypeParamId(index as u32), MapperId::IDENTITY));
        }
        for index in order {
            literals[index] = types.intern(TypeData::StringLit { value: atoms.intern(texts[index]), fresh: false });
            keys.push(types.intern(TypeData::Keyof(literals[index])));
        }
        let union = types.intern(TypeData::Union(types.list(&keys)));
        let mapper = types.mapper(vec![(params[0], union), (params[1], literals[1])]);
        types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FILE, TypeNodeId(5)), mapper })
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn two_tasks_of_a_step_agree() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let (one, other) = (OwnStore::new_in(session.arena()), OwnStore::new_in(session.arena()));
        let (a, b) = (make(shared.records(&one), false), make(shared.records(&other), true));
        assert!(a.is_local() && b.is_local());
        let of_a = with(shared.records(&one), &mut State::default(), |known| shared.records(&one).of_type(known, a));
        let of_b = with(shared.records(&other), &mut State::default(), |known| shared.records(&other).of_type(known, b));
        assert_eq!(of_a, of_b);
        // Another node, another type.
        let types = shared.records(&one).types;
        let elsewhere = types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FILE, TypeNodeId(6)), mapper: MapperId::IDENTITY });
        assert_ne!(with(shared.records(&one), &mut State::default(), |known| shared.records(&one).of_type(known, elsewhere)), of_a);
    }

    /// `{ .. }` at the node of `FILE`.
    fn literal_at(records: Records<'_, '_>, node: u32) -> TypeId {
        records.types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FILE, TypeNodeId(node)), mapper: MapperId::IDENTITY })
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn number_of_a_file_does_not_matter() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let own = OwnStore::new_in(session.arena());
        let records = shared.records(&own);
        let literal_in = |file: u32| records.types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FileId(file), TypeNodeId(5)), mapper: MapperId::IDENTITY });
        let of = |names: Vec<Identity>, ty: TypeId| {
            let named = super::Shared::default();
            named.names_of_files.set(names).unwrap();
            records.of_type(&mut Known { state: &mut State::default(), checker: &mut AsItIs(records.types), shared: &named, times_checker_was_asked: 0 }, ty)
        };
        let (name, other) = ([7, 8], [9, 10]);
        assert_eq!(of(vec![name, other], literal_in(0)), of(vec![other, name], literal_in(1)));
        assert_ne!(of(vec![name, other], literal_in(0)), of(vec![name, other], literal_in(1)));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn a_member_counts_once() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let own = OwnStore::new_in(session.arena());
        let records = shared.records(&own);
        let types = records.types;
        let (a, b, c) = (literal_at(records, 1), literal_at(records, 2), literal_at(records, 3));
        // Two records, one identity.
        let (one, twin) = (types.intern(TypeData::Union(types.list(&[a, b]))), types.intern(TypeData::Union(types.list(&[b, a]))));
        assert_ne!(one, twin);
        let mut known = State::default();
        let mut of = |members: &[TypeId]| with(records, &mut known, |known| records.of_type(known, types.intern(TypeData::Intersection(types.list(members)))));
        assert_eq!(of(&[one, c]), of(&[one, twin, c]));
        assert_eq!(of(&[one, c]), of(&[twin, c, one]));
        // The fields of `A & B` are in another order than those of `B & A`.
        assert_ne!(of(&[one, c]), of(&[c, one]));
        assert_ne!(of(&[one, c]), of(&[one, a, c]));
        let alone = of(&[one, twin]);
        assert_eq!(alone, with(records, &mut known, |known| records.of_type(known, one)));
        let mut of_union = |members: &[TypeId]| with(records, &mut known, |known| records.of_type(known, types.intern(TypeData::Union(types.list(members)))));
        assert_eq!(of_union(&[one, c]), of_union(&[c, twin, one]));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn published_type_keeps_its_identity() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let mut first = OwnStore::new_in(session.arena());
        let made = make(shared.records(&first), false);
        let around = shared.records(&first).types.intern(TypeData::Keyof(made));
        let before = with(shared.records(&first), &mut State::default(), |known| shared.records(&first).of_type(known, made));
        let around_before = with(shared.records(&first), &mut State::default(), |known| shared.records(&first).of_type(known, around));
        let link = shared.publish(&mut first, made);
        let mut published = made;
        published.follow(&link);
        assert!(!published.is_local());

        // A task of the next step finds the published type, and makes a type of its own around that.
        let later = OwnStore::new_in(session.arena());
        assert_eq!(make(shared.records(&later), false), published);
        let mut known = State::default();
        assert_eq!(with(shared.records(&later), &mut known, |known| shared.records(&later).of_type(known, published)), before);
        let around = shared.records(&later).types.intern(TypeData::Keyof(published));
        assert!(around.is_local());
        assert_eq!(with(shared.records(&later), &mut known, |known| shared.records(&later).of_type(known, around)), around_before);
    }
}

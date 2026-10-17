use crate::atom::{Atom, Atoms};
use crate::check::Checker;
use crate::check::task::Stored;
use crate::program::{FileId, Sym};
use crate::bind::{ScopeKind, SymFlags};
use crate::hir::{Keyword, TypeNodeId, TypeNodeKind};
use crate::local::MaybeLocal;
use crate::types::{ComponentsId, Follow, Lanes, Literalness, MapperId, Origin, Prop, PropFlags, PropSource, Provenance, Shape, SigId, TypeData, TypeId, Types, UnionOrigin, Visitor, tf};
use crate::util::{FxHashMap, InParallel, for_each_mut};
use crate::util::memory::Cells;
use std::hash::Hash;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

pub type Identity = [u64; 2];

#[derive(Default)]
pub(super) struct State {
    types: FxHashMap<TypeId, Identity>,
    sigs: FxHashMap<SigId, Identity>,
    mappers: FxHashMap<MapperId, Identity>,
    components: FxHashMap<ComponentsId, Identity>,
    referenced_type_parameters: FxHashMap<(FileId, TypeNodeId), Option<Vec<Sym>>>,
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
    file_identities: OnceLock<Vec<Identity>>,
}

impl Shared {
    fn file_identity(&self, file: FileId) -> Identity {
        match self.file_identities.get().and_then(|names| names.get(file.idx())) {
            Some(&name) => name,
            None => [u64::from(file.0), 0],
        }
    }
}

fn strip_directory_prefix<'a>(name: &'a [u8], directory: &[u8], is_case_sensitive: bool) -> Option<&'a [u8]> {
    let directory = directory.strip_suffix(b"/").unwrap_or(directory);
    if directory.is_empty() || name.len() <= directory.len() || name[directory.len()] != b'/' {
        return None;
    }
    let (start, rest) = name.split_at(directory.len());
    let is_same = if is_case_sensitive { start == directory } else { start.eq_ignore_ascii_case(directory) };
    is_same.then_some(&rest[1..])
}

trait Normalizer {
    fn intersection_members(&mut self, members: &[TypeId]) -> Vec<TypeId>;

    fn relevant_mapper_pairs(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)>;

    fn literal_structure(&mut self, ty: TypeId) -> Option<Vec<(Atom, u8, TypeId)>>;
}

struct Known<'a> {
    state: &'a mut State,
    checker: &'a mut dyn Normalizer,
    shared: &'a Shared,
    checker_query_count: u32,
}

#[derive(Copy, Clone)]
enum IdentityKind {
    Type = 1,
    Sig,
    Mapper,
    Components,
}

#[derive(Copy, Clone)]
struct Records<'p, 's> {
    types: Types<'p, 's>,
    atoms: Atoms<'p, 's>,
}

trait Walker: Visitor {
    fn unordered<T: Follow>(&mut self, items: &[T]);

    fn distinct<T: Follow>(&mut self, items: &[T]);

    fn intersected(&mut self, members: &[TypeId]);

    fn applied(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId);

    fn field(&mut self, _name: &'static str) {}
}

struct Identify<'a, 'k, 'p, 's> {
    lanes: Lanes,
    records: Records<'p, 's>,
    known: &'a mut Known<'k>,
}

impl<'a, 'k, 'p, 's> Identify<'a, 'k, 'p, 's> {
    fn new(records: Records<'p, 's>, known: &'a mut Known<'k>, of: IdentityKind) -> Self {
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
        self.known.checker_query_count += 1;
        let members = self.known.checker.intersection_members(members);
        self.distinct(&members);
    }

    fn applied(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) {
        let pairs = self.known.checker.relevant_mapper_pairs(mapper, file, node);
        self.unordered(&pairs);
    }
}

impl Visitor for Identify<'_, '_, '_, '_> {
    fn atom(&mut self, atom: Atom) {
        self.plain(&atom.is_some());
        if atom.is_some() {
            self.records.atoms.bytes(atom).hash(&mut self.lanes);
        }
    }

    fn components(&mut self, id: ComponentsId) {
        let identity = self.records.components_identity(self.known, id);
        self.add(identity);
    }

    fn mapper(&mut self, id: MapperId) {
        let identity = self.records.mapper_identity(self.known, id);
        self.add(identity);
    }

    fn sig(&mut self, id: SigId) {
        let identity = self.records.sig_identity(self.known, id);
        self.add(identity);
    }

    fn ty(&mut self, id: TypeId) {
        let identity = self.records.of_type(self.known, id);
        self.add(identity);
    }

    fn file(&mut self, file: FileId) {
        let name = self.known.shared.file_identity(file);
        self.add(name);
    }

    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.lanes);
    }
}

impl Records<'_, '_> {
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
            known.checker_query_count += 1;
            return identity;
        }
        let asked_before = known.checker_query_count;
        known.checker_query_count += u32::from(matches!(self.types.get(ty), TypeData::Intersection(_) | TypeData::Anon { origin: Origin::ObjectLiteral(..), .. }));
        let members = match self.types.get(ty) {
            TypeData::Union(members) => members.to_vec(),
            TypeData::Intersection(members) => known.checker.intersection_members(members),
            _ => Vec::new(),
        };
        if let Some((&first, rest)) = members.split_first() {
            let only = self.of_type(known, first);
            if rest.iter().all(|&member| self.of_type(known, member) == only) {
                if ty.is_local() || known.checker_query_count != asked_before || !known.shared.types.put(ty.0, only) {
                    known.state.types.insert(ty, only);
                }
                return only;
            }
        }
        let structure = known.checker.literal_structure(ty);
        let mut it = Identify::new(self, known, IdentityKind::Type);
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
        if ty.is_local() || known.checker_query_count != asked_before || !known.shared.types.put(ty.0, identity) {
            known.state.types.insert(ty, identity);
        }
        identity
    }

    fn sig_identity(self, known: &mut Known<'_>, sig: SigId) -> Identity {
        if !sig.is_local()
            && let Some(identity) = known.shared.sigs.get(sig.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.sigs.get(&sig) {
            known.checker_query_count += 1;
            return identity;
        }
        let asked_before = known.checker_query_count;
        let mut it = Identify::new(self, known, IdentityKind::Sig);
        self.types.sig(sig).visit(&mut it);
        let identity = it.lanes.0;
        if sig.is_local() || known.checker_query_count != asked_before || !known.shared.sigs.put(sig.0, identity) {
            known.state.sigs.insert(sig, identity);
        }
        identity
    }

    fn mapper_identity(self, known: &mut Known<'_>, mapper: MapperId) -> Identity {
        if mapper == MapperId::IDENTITY {
            return [IdentityKind::Mapper as u64, 0];
        }
        if !mapper.is_local()
            && let Some(identity) = known.shared.mappers.get(mapper.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.mappers.get(&mapper) {
            known.checker_query_count += 1;
            return identity;
        }
        let asked_before = known.checker_query_count;
        let mut it = Identify::new(self, known, IdentityKind::Mapper);
        it.unordered(self.types.mapping(mapper));
        let identity = it.lanes.0;
        if mapper.is_local() || known.checker_query_count != asked_before || !known.shared.mappers.put(mapper.0, identity) {
            known.state.mappers.insert(mapper, identity);
        }
        identity
    }

    fn components_identity(self, known: &mut Known<'_>, components: ComponentsId) -> Identity {
        if components == ComponentsId::NONE {
            return [IdentityKind::Components as u64, 0];
        }
        if !components.is_local()
            && let Some(identity) = known.shared.components.get(components.0)
        {
            return identity;
        }
        if let Some(&identity) = known.state.components.get(&components) {
            known.checker_query_count += 1;
            return identity;
        }
        let asked_before = known.checker_query_count;
        let mut it = Identify::new(self, known, IdentityKind::Components);
        self.types.components(components).visit(&mut it);
        let identity = it.lanes.0;
        if components.is_local() || known.checker_query_count != asked_before || !known.shared.components.put(components.0, identity) {
            known.state.components.insert(components, identity);
        }
        identity
    }
}

impl Checker<'_, '_> {
    pub fn type_identity(&mut self, ty: TypeId) -> Identity {
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
        let mut state = std::mem::take(&mut self.aot.identity);
        self.aot.identity.referenced_type_parameters = std::mem::take(&mut state.referenced_type_parameters);
        let program = self.p;
        program.aot.identity.file_identities.get_or_init(|| {
            let files = &program.files;
            let directories = [&files.options.current_directory[..], &files.options.lib_dir[..]];
            (0..files.modules.len() as u32)
                .map(|number| {
                    let name = files.module(FileId(number)).file_name();
                    let within = (0..directories.len()).find_map(|which| Some((which, strip_directory_prefix(name, directories[which], files.is_case_sensitive)?)));
                    let (which, shown) = within.unwrap_or((directories.len(), name));
                    let mut lanes = Lanes::START;
                    lanes.add(which as u64);
                    shown.hash(&mut lanes);
                    lanes.0
                })
                .collect()
        });
        let result = walk(records, &mut Known { state: &mut state, checker: self, shared: &program.aot.identity, checker_query_count: 0 });
        state.referenced_type_parameters = std::mem::take(&mut self.aot.identity.referenced_type_parameters);
        self.aot.identity = state;
        result
    }

    fn resolved_intersection_members(&mut self, members: &[TypeId]) -> Vec<TypeId> {
        let is_empty: Vec<bool> = members.iter().map(|&member| self.is_resolved_empty_object_type(member)).collect();
        let Some(first) = is_empty.iter().position(|&is_empty| is_empty) else { return members.to_vec() };
        let is_non_nullable = (0..members.len()).any(|at| !is_empty[at] && self.flags(members[at]) & tf::DEFINITELY_NON_NULLABLE != 0);
        (0..members.len()).filter(|&at| !is_empty[at] || at == first && !is_non_nullable).map(|at| members[at]).collect()
    }

    fn referenced_type_parameter_pairs(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)> {
        let pairs = self.types().mapping(mapper);
        if pairs.is_empty() {
            return Vec::new();
        }
        let Some(named) = self.type_parameters_referenced_in(file, node) else { return pairs.to_vec() };
        let matters = |source: TypeId| match *self.data(source) {
            TypeData::TypeParam(of, param, _) => named.contains(&self.files().sym(of, self.bound(of).type_param_symbol[param.idx()])),
            _ => true,
        };
        pairs.iter().copied().filter(|pair| matters(pair.0)).collect()
    }

    fn type_parameters_referenced_in(&mut self, file: FileId, node: TypeNodeId) -> Option<Vec<Sym>> {
        if let Some(known) = self.aot.identity.referenced_type_parameters.get(&(file, node)) {
            return known.clone();
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (start, end) = (hir[node].pos, hir[node].end);
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
        self.aot.identity.referenced_type_parameters.insert((file, node), named.clone());
        named
    }

    fn is_resolved_empty_object_type(&mut self, ty: TypeId) -> bool {
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

    pub fn keep_type(&mut self, ty: TypeId) {
        self.p.kept_types.insert(&self.task, ty, (), Stored::new());
    }

    pub fn kept_types(&self) -> Vec<TypeId> {
        let published = (0..self.p.types.type_count()).map(TypeId);
        published.filter(|ty| self.p.kept_types.get(&self.task, ty).is_some()).collect()
    }

    pub fn kept_types_on_pool(&self, in_parallel: InParallel<'_>) -> Vec<TypeId> {
        const TYPES_PER_CHUNK: u32 = 1 << 16;
        let count = self.p.types.type_count();
        let mut chunks: Vec<(u32, Vec<TypeId>)> = (0..count).step_by(TYPES_PER_CHUNK as usize).map(|first| (first, Vec::new())).collect();
        let program = self.p;
        for_each_mut(&mut chunks, in_parallel, &|(first, retained)| {
            let c = program.checker();
            retained.extend((*first..count.min(*first + TYPES_PER_CHUNK)).map(TypeId).filter(|ty| program.kept_types.get(&c.task, ty).is_some()));
        });
        chunks.into_iter().flat_map(|chunk| chunk.1).collect()
    }
}

impl Normalizer for Checker<'_, '_> {
    fn intersection_members(&mut self, members: &[TypeId]) -> Vec<TypeId> {
        self.resolved_intersection_members(members)
    }

    fn relevant_mapper_pairs(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)> {
        self.referenced_type_parameter_pairs(mapper, file, node)
    }

    fn literal_structure(&mut self, ty: TypeId) -> Option<Vec<(Atom, u8, TypeId)>> {
        self.plain_literal_structure(ty)
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

    struct Verbatim<'p, 's>(Types<'p, 's>);

    impl Normalizer for Verbatim<'_, '_> {
        fn intersection_members(&mut self, members: &[TypeId]) -> Vec<TypeId> {
            members.to_vec()
        }

        fn relevant_mapper_pairs(&mut self, mapper: MapperId, _: FileId, _: TypeNodeId) -> Vec<(TypeId, TypeId)> {
            self.0.mapping(mapper).to_vec()
        }

        fn literal_structure(&mut self, _: TypeId) -> Option<Vec<(Atom, u8, TypeId)>> {
            None
        }
    }

    fn with<T>(records: Records<'_, '_>, state: &mut State, walk: impl FnOnce(&mut Known<'_>) -> T) -> T {
        walk(&mut Known { state, checker: &mut Verbatim(records.types), shared: &super::Shared::default(), checker_query_count: 0 })
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

        fn publish(&self, own: &mut OwnStore<'s>, root: TypeId) -> Link {
            let mut marks = Marks::new(own);
            root.mark(&mut marks);
            let records = own.finish(marks);
            let (mut links, _) = self.types.link(&self.atoms, vec![records], &forwards, &|_| {});
            links.pop().unwrap()
        }
    }

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
        let types = shared.records(&one).types;
        let elsewhere = types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FILE, TypeNodeId(6)), mapper: MapperId::IDENTITY });
        assert_ne!(with(shared.records(&one), &mut State::default(), |known| shared.records(&one).of_type(known, elsewhere)), of_a);
    }

    fn literal_at(records: Records<'_, '_>, node: u32) -> TypeId {
        records.types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FILE, TypeNodeId(node)), mapper: MapperId::IDENTITY })
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn file_number_is_irrelevant() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let own = OwnStore::new_in(session.arena());
        let records = shared.records(&own);
        let literal_in = |file: u32| records.types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FileId(file), TypeNodeId(5)), mapper: MapperId::IDENTITY });
        let of = |names: Vec<Identity>, ty: TypeId| {
            let named = super::Shared::default();
            named.file_identities.set(names).unwrap();
            records.of_type(&mut Known { state: &mut State::default(), checker: &mut Verbatim(records.types), shared: &named, checker_query_count: 0 }, ty)
        };
        let (name, other) = ([7, 8], [9, 10]);
        assert_eq!(of(vec![name, other], literal_in(0)), of(vec![other, name], literal_in(1)));
        assert_ne!(of(vec![name, other], literal_in(0)), of(vec![name, other], literal_in(1)));
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn duplicate_members_count_once() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let own = OwnStore::new_in(session.arena());
        let records = shared.records(&own);
        let types = records.types;
        let (a, b, c) = (literal_at(records, 1), literal_at(records, 2), literal_at(records, 3));
        let (one, twin) = (types.intern(TypeData::Union(types.list(&[a, b]))), types.intern(TypeData::Union(types.list(&[b, a]))));
        assert_ne!(one, twin);
        let mut known = State::default();
        let mut of = |members: &[TypeId]| with(records, &mut known, |known| records.of_type(known, types.intern(TypeData::Intersection(types.list(members)))));
        assert_eq!(of(&[one, c]), of(&[one, twin, c]));
        assert_eq!(of(&[one, c]), of(&[twin, c, one]));
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
        let created = make(shared.records(&first), false);
        let around = shared.records(&first).types.intern(TypeData::Keyof(created));
        let before = with(shared.records(&first), &mut State::default(), |known| shared.records(&first).of_type(known, created));
        let around_before = with(shared.records(&first), &mut State::default(), |known| shared.records(&first).of_type(known, around));
        let link = shared.publish(&mut first, created);
        let mut published = created;
        published.follow(&link);
        assert!(!published.is_local());

        let later = OwnStore::new_in(session.arena());
        assert_eq!(make(shared.records(&later), false), published);
        let mut known = State::default();
        assert_eq!(with(shared.records(&later), &mut known, |known| shared.records(&later).of_type(known, published)), before);
        let around = shared.records(&later).types.intern(TypeData::Keyof(published));
        assert!(around.is_local());
        assert_eq!(with(shared.records(&later), &mut known, |known| shared.records(&later).of_type(known, around)), around_before);
    }
}

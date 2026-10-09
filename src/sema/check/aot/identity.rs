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
use crate::types::{ComponentsId, Follow, Lanes, Literalness, MapperId, Origin, Prop, PropFlags, PropSource, Provenance, Shape, SigId, TypeData, TypeId, Types, UnionOrigin, Visitor, tf};
use crate::util::FxHashMap;
use std::hash::{Hash, Hasher};

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

/// What takes the checker to say: how a record would look to every task.
trait Normalizer {
    /// `Checker::members_of_intersection_once_resolved`
    fn members_of_intersection(&mut self, members: &[TypeId]) -> Vec<TypeId>;

    /// `Checker::pairs_of_named_type_parameters`
    fn pairs_that_matter(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) -> Vec<(TypeId, TypeId)>;
}

/// What a walk has at hand besides the records.
struct Known<'a> {
    state: &'a mut State,
    checker: &'a mut dyn Normalizer,
    /// The types with the mappers that `add_divergence` has gone into from them, here and kept.
    mappers_entered: Vec<[(TypeId, MapperId); 2]>,
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
        self.lanes.add(u64::from(file.0));
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
            spread_of,
            spread_rank,
            single_signature_arguments,
            has_no_instantiable_symbol,
            pattern_at,
            mapper,
        } = shape;
        symbol_declared_at.visit(it);
        symbol.visit(it);
        it.plain(&props.len());
        for Prop { name, flags, source, mapper } in props.iter() {
            name.visit(it);
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
        spread_of.visit(it);
        spread_rank.visit(it);
        single_signature_arguments.visit(it);
        has_no_instantiable_symbol.visit(it);
        pattern_at.visit(it);
        mapper.visit(it);
    }

    fn of_type(self, known: &mut Known<'_>, ty: TypeId) -> Identity {
        if let Some(&identity) = known.state.types.get(&ty) {
            return identity;
        }
        // `A & A` is `A` to whoever sees that they are one.
        let members = match self.types.get(ty) {
            TypeData::Union(members) => members.to_vec(),
            TypeData::Intersection(members) => known.checker.members_of_intersection(members),
            _ => Vec::new(),
        };
        if let Some((&first, rest)) = members.split_first() {
            let only = self.of_type(known, first);
            if rest.iter().all(|&member| self.of_type(known, member) == only) {
                known.state.types.insert(ty, only);
                return only;
            }
        }
        let mut it = Identify::new(self, known, Of::Type);
        self.walk_type(ty, &mut it);
        let identity = it.lanes.0;
        known.state.types.insert(ty, identity);
        identity
    }

    fn of_sig(self, known: &mut Known<'_>, sig: SigId) -> Identity {
        if let Some(&identity) = known.state.sigs.get(&sig) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Sig);
        self.types.sig(sig).visit(&mut it);
        let identity = it.lanes.0;
        known.state.sigs.insert(sig, identity);
        identity
    }

    /// The pairs are in the order of the ids of the type parameters.
    fn of_mapper(self, known: &mut Known<'_>, mapper: MapperId) -> Identity {
        if mapper == MapperId::IDENTITY {
            return [Of::Mapper as u64, 0];
        }
        if let Some(&identity) = known.state.mappers.get(&mapper) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Mapper);
        it.unordered(self.types.mapping(mapper));
        let identity = it.lanes.0;
        known.state.mappers.insert(mapper, identity);
        identity
    }

    fn of_components(self, known: &mut Known<'_>, components: ComponentsId) -> Identity {
        if components == ComponentsId::NONE {
            return [Of::Components as u64, 0];
        }
        if let Some(&identity) = known.state.components.get(&components) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Components);
        self.types.components(components).visit(&mut it);
        let identity = it.lanes.0;
        known.state.components.insert(components, identity);
        identity
    }
}

// ───────────────────────────── why two identities differ ─────────────────────────────

/// What a `Walker` is told, call by call.
enum Item {
    Atom(Atom),
    Components(ComponentsId),
    Mapper(MapperId),
    Sig(SigId),
    Type(TypeId),
    File(FileId),
    /// The Rust type of the value, and the bytes it is hashed as.
    Plain(&'static str, Vec<u8>),
    /// Each member with what it is hashed to by itself.
    Set(Vec<(Identity, Vec<Labelled>)>),
}

/// With the field of the provenance it belongs to. Empty: it is of the data of the record.
type Labelled = (&'static str, Item);

impl Item {
    fn kind(&self) -> &'static str {
        match self {
            Item::Atom(_) => "an atom",
            Item::Components(_) => "index components",
            Item::Mapper(_) => "a mapper",
            Item::Sig(_) => "a signature",
            Item::Type(_) => "a type",
            Item::File(_) => "a file",
            Item::Plain(..) => "plain data",
            Item::Set(_) => "a set",
        }
    }
}

/// The bytes a value is hashed as.
#[derive(Default)]
struct Bytes(Vec<u8>);

impl Hasher for Bytes {
    fn finish(&self) -> u64 {
        0
    }

    fn write(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);
    }
}

/// Lists what `Identify` hashes.
struct List<'a, 'k, 'p, 's> {
    items: Vec<Labelled>,
    field: &'static str,
    records: Records<'p, 's>,
    known: &'a mut Known<'k>,
}

impl Visitor for List<'_, '_, '_, '_> {
    fn atom(&mut self, atom: Atom) {
        self.items.push((self.field, Item::Atom(atom)));
    }

    fn components(&mut self, id: ComponentsId) {
        self.items.push((self.field, Item::Components(id)));
    }

    fn mapper(&mut self, id: MapperId) {
        self.items.push((self.field, Item::Mapper(id)));
    }

    fn sig(&mut self, id: SigId) {
        self.items.push((self.field, Item::Sig(id)));
    }

    fn ty(&mut self, id: TypeId) {
        self.items.push((self.field, Item::Type(id)));
    }

    fn file(&mut self, file: FileId) {
        self.items.push((self.field, Item::File(file)));
    }

    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        let mut bytes = Bytes::default();
        value.hash(&mut bytes);
        self.items.push((self.field, Item::Plain(std::any::type_name::<T>(), bytes.0)));
    }
}

impl List<'_, '_, '_, '_> {
    /// Each of the items that is not hashed like one before it, with what it is hashed to by itself.
    fn each_once<T: Follow>(&mut self, items: &[T]) -> Vec<(Identity, Vec<Labelled>)> {
        let mut each: Vec<(Identity, Vec<Labelled>)> = Vec::with_capacity(items.len());
        for item in items {
            let mut one = Identify { lanes: Lanes::START, records: self.records, known: &mut *self.known };
            item.visit(&mut one);
            let hashed = one.lanes.0;
            if each.iter().any(|other| other.0 == hashed) {
                continue;
            }
            let mut list = List { items: Vec::new(), field: self.field, records: self.records, known: &mut *self.known };
            item.visit(&mut list);
            each.push((hashed, list.items));
        }
        each
    }
}

impl Walker for List<'_, '_, '_, '_> {
    fn unordered<T: Follow>(&mut self, items: &[T]) {
        let set = self.each_once(items);
        self.items.push((self.field, Item::Set(set)));
    }

    fn distinct<T: Follow>(&mut self, items: &[T]) {
        let each = self.each_once(items);
        self.plain(&each.len());
        self.items.extend(each.into_iter().flat_map(|one| one.1));
    }

    fn intersected(&mut self, members: &[TypeId]) {
        let members = self.known.checker.members_of_intersection(members);
        self.distinct(&members);
    }

    fn applied(&mut self, mapper: MapperId, file: FileId, node: TypeNodeId) {
        let pairs = self.known.checker.pairs_that_matter(mapper, file, node);
        self.unordered(&pairs);
    }

    fn field(&mut self, name: &'static str) {
        self.field = name;
    }
}

fn hexadecimal(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// `core::mem::Discriminant<bun_sema::types::TypeData<'_>>` as `Discriminant<TypeData<'_>>`.
fn without_paths(name: &str) -> String {
    let mut pieces: Vec<&str> = name.split("::").collect();
    let last = pieces.pop().unwrap_or_default();
    let kept = pieces.into_iter().map(|piece| piece.rfind(['<', ' ', '(', ',', '&']).map_or("", |at| &piece[..=at]));
    kept.chain([last]).collect()
}

/// `Records::add_lists`
const MOST_ITEMS_LISTED: usize = 48;

impl Records<'_, '_> {
    fn list(self, known: &mut Known<'_>, walk: impl FnOnce(&mut List<'_, '_, '_, '_>)) -> Vec<Labelled> {
        let mut list = List { items: Vec::new(), field: "", records: self, known };
        walk(&mut list);
        list.items
    }

    /// In a word that says nothing of the program. Where `Checker::kind_of_view` has a word, it is that one.
    fn kind_of_type(self, ty: TypeId) -> &'static str {
        match self.types.get(ty) {
            TypeData::Intrinsic(_) => "intrinsic",
            TypeData::UnresolvedName { .. } => "an unresolved name",
            TypeData::StringLit { .. } | TypeData::NumberLit { .. } | TypeData::BigIntLit { .. } | TypeData::BoolLit { .. } | TypeData::EnumLit { .. } => "a literal",
            TypeData::Enum { .. } => "an enum",
            TypeData::EvolvingArray(_) => "an evolving array",
            TypeData::UniqueSymbol { .. } => "a unique symbol",
            TypeData::TypeParam(..) => "a type parameter",
            TypeData::ThisParam(_) => "a `this` type",
            TypeData::Marker(_) => "a marker",
            TypeData::Union(_) => "a union",
            TypeData::Intersection(_) => "an intersection",
            TypeData::Ref { .. } => "a reference",
            TypeData::Tuple { .. } => "a tuple",
            TypeData::Anon { origin: Origin::TypeLiteral(..), .. } => "a type literal",
            TypeData::Anon { origin: Origin::Mapped(..), .. } => "mapped",
            TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. } => "an object literal",
            TypeData::Anon { .. } => "of a declaration",
            TypeData::Fns { .. } => "of functions",
            TypeData::Synth(_) => "synthesized",
            TypeData::ReverseMapped { .. } => "reverse mapped",
            TypeData::Cond { .. } => "conditional",
            TypeData::IndexedAccess { .. } => "an indexed access",
            TypeData::Keyof(_) => "a `keyof`",
            TypeData::Substitution { .. } => "a substitution",
            TypeData::Template { .. } => "a template",
            TypeData::StringMapping { .. } => "a string mapping",
        }
    }

    /// `Known::mappers_entered`
    fn note_mappers(self, known: &mut Known<'_>, here: TypeId, kept: TypeId) {
        let mapper_of = |ty: TypeId| match *self.types.get(ty) {
            TypeData::Anon { mapper, .. } | TypeData::Cond { mapper, .. } | TypeData::Fns { mapper, .. } | TypeData::TypeParam(_, _, mapper) => Some(mapper),
            _ => None,
        };
        if let (Some(mapper_here), Some(mapper_kept)) = (mapper_of(here), mapper_of(kept))
            && self.of_mapper(known, mapper_here) != self.of_mapper(known, mapper_kept)
        {
            known.mappers_entered.push([(here, mapper_here), (kept, mapper_kept)]);
        }
    }

    /// Appends the way from two lists that are hashed differently down to the first thing that is in one and not in the other.
    /// `compares_neighbors`: see `add_lists`.
    fn add_divergence(self, known: &mut Known<'_>, here: &[Labelled], kept: &[Labelled], compares_neighbors: bool, way: &mut Vec<String>) {
        for (index, ((field, a), (_, b))) in here.iter().zip(kept).enumerate() {
            let at = if field.is_empty() { format!("item {index}") } else { format!("item {index}, of `{field}`") };
            let (next_here, next_kept) = match (a, b) {
                (&Item::Type(a), &Item::Type(b)) => {
                    if self.of_type(known, a) == self.of_type(known, b) {
                        continue;
                    }
                    way.push(format!("{at}: a type, here {}, kept {}", self.kind_of_type(a), self.kind_of_type(b)));
                    let lists = (self.list(known, |list| self.walk_type(a, list)), self.list(known, |list| self.walk_type(b, list)));
                    if compares_neighbors {
                        self.note_mappers(known, a, b);
                    }
                    lists
                }
                (&Item::Sig(a), &Item::Sig(b)) => {
                    if self.of_sig(known, a) == self.of_sig(known, b) {
                        continue;
                    }
                    way.push(format!("{at}: a signature"));
                    (self.list(known, |list| self.types.sig(a).visit(list)), self.list(known, |list| self.types.sig(b).visit(list)))
                }
                (&Item::Mapper(a), &Item::Mapper(b)) => {
                    if self.of_mapper(known, a) == self.of_mapper(known, b) {
                        continue;
                    }
                    let is_identity = |mapper: MapperId| if mapper == MapperId::IDENTITY { "the identity" } else { "not the identity" };
                    way.push(format!("{at}: a mapper, here {}, kept {}", is_identity(a), is_identity(b)));
                    if a == MapperId::IDENTITY || b == MapperId::IDENTITY {
                        return self.add_lists(known, here, kept, compares_neighbors, way);
                    }
                    (self.list(known, |list| list.unordered(self.types.mapping(a))), self.list(known, |list| list.unordered(self.types.mapping(b))))
                }
                (&Item::Components(a), &Item::Components(b)) => {
                    if self.of_components(known, a) == self.of_components(known, b) {
                        continue;
                    }
                    way.push(format!("{at}: index components"));
                    if a == ComponentsId::NONE || b == ComponentsId::NONE {
                        way.push("one side has none".to_owned());
                        return self.add_lists(known, here, kept, compares_neighbors, way);
                    }
                    (self.list(known, |list| self.types.components(a).visit(list)), self.list(known, |list| self.types.components(b).visit(list)))
                }
                (&Item::Atom(a), &Item::Atom(b)) => {
                    let text = |atom: Atom| atom.is_some().then(|| self.atoms.bytes(atom));
                    if text(a) == text(b) {
                        continue;
                    }
                    let length = |atom: Atom| text(atom).map_or_else(|| "none".to_owned(), |text| format!("of {} bytes", text.len()));
                    way.push(format!("{at}: an atom, here {}, kept {}", length(a), length(b)));
                    return self.add_lists(known, here, kept, compares_neighbors, way);
                }
                (&Item::File(a), &Item::File(b)) => {
                    if a == b {
                        continue;
                    }
                    way.push(format!("{at}: a file, here {}, kept {}", a.0, b.0));
                    return self.add_lists(known, here, kept, compares_neighbors, way);
                }
                (Item::Plain(type_here, a), Item::Plain(type_kept, b)) => {
                    if type_here == type_kept && a == b {
                        continue;
                    }
                    way.push(format!("{at}: plain data, here `{}` {}, kept `{}` {}", without_paths(type_here), hexadecimal(a), without_paths(type_kept), hexadecimal(b)));
                    return self.add_lists(known, here, kept, compares_neighbors, way);
                }
                (Item::Set(a), Item::Set(b)) => {
                    // Each member of one side that the other side has is taken off once.
                    let mut only_kept: Vec<&(Identity, Vec<Labelled>)> = b.iter().collect();
                    let mut only_here: Vec<&(Identity, Vec<Labelled>)> = Vec::new();
                    for member in a {
                        match only_kept.iter().position(|other| other.0 == member.0) {
                            Some(found) => {
                                only_kept.remove(found);
                            }
                            None => only_here.push(member),
                        }
                    }
                    if only_here.is_empty() && only_kept.is_empty() {
                        continue;
                    }
                    way.push(format!("{at}: a set, of {} here, of {} kept; only here {}, only kept {}", a.len(), b.len(), only_here.len(), only_kept.len()));
                    if let (Some(first_here), Some(first_kept)) = (only_here.first(), only_kept.first()) {
                        way.push("the first of each".to_owned());
                        self.add_divergence(known, &first_here.1, &first_kept.1, compares_neighbors, way);
                    }
                    return;
                }
                (a, b) => {
                    way.push(format!("{at}: here {}, kept {}", a.kind(), b.kind()));
                    return self.add_lists(known, here, kept, compares_neighbors, way);
                }
            };
            return self.add_divergence(known, &next_here, &next_kept, compares_neighbors, way);
        }
        if here.len() != kept.len() {
            way.push(format!("{} items here, {} kept", here.len(), kept.len()));
            self.add_lists(known, here, kept, compares_neighbors, way);
        }
    }

    /// Where the way ends: all that is hashed on either side, each record with its own identity. `compares_neighbors`: and for a type that only one
    /// side has, what tells it from each type of its kind next to it, one of which the other side may have taken it for.
    fn add_lists(self, known: &mut Known<'_>, here: &[Labelled], kept: &[Labelled], compares_neighbors: bool, way: &mut Vec<String>) {
        let mut text_of = |items: &[Labelled]| -> String {
            let name = |identity: Identity| format!("{:016x}{:016x}", identity[0], identity[1]);
            let mut texts: Vec<String> = (items.iter().take(MOST_ITEMS_LISTED))
                .map(|(_, item)| match item {
                    &Item::Type(ty) => format!("{} {}", self.kind_of_type(ty), name(self.of_type(known, ty))),
                    &Item::Sig(sig) => format!("a signature {}", name(self.of_sig(known, sig))),
                    &Item::Mapper(mapper) => format!("a mapper {}", name(self.of_mapper(known, mapper))),
                    &Item::Components(components) => format!("index components {}", name(self.of_components(known, components))),
                    &Item::Atom(atom) if atom.is_none() => "no atom".to_owned(),
                    &Item::Atom(atom) => format!("an atom of {} bytes", self.atoms.bytes(atom).len()),
                    &Item::File(file) => format!("file {}", file.0),
                    Item::Plain(ty, bytes) => format!("`{}` {}", without_paths(ty), hexadecimal(bytes)),
                    Item::Set(members) => format!("a set of {}", members.len()),
                })
                .collect();
            if items.len() > MOST_ITEMS_LISTED {
                texts.push(format!("and {} more", items.len() - MOST_ITEMS_LISTED));
            }
            texts.join(", ")
        };
        let texts = (text_of(here), text_of(kept));
        way.push(format!("all of it: here [{}]; kept [{}]", texts.0, texts.1));
        if !compares_neighbors {
            return;
        }
        let types_of = |items: &[Labelled]| -> Vec<TypeId> { items.iter().filter_map(|(_, item)| if let &Item::Type(ty) = item { Some(ty) } else { None }).collect() };
        for (side, own, other) in [("here", types_of(here), types_of(kept)), ("kept", types_of(kept), types_of(here))] {
            for &extra in &own {
                let identity = self.of_type(known, extra);
                if other.iter().any(|&ty| self.of_type(known, ty) == identity) {
                    continue;
                }
                for &neighbor in own.iter().filter(|&&neighbor| neighbor != extra && self.kind_of_type(neighbor) == self.kind_of_type(extra)) {
                    let lists = (self.list(known, |list| self.walk_type(extra, list)), self.list(known, |list| self.walk_type(neighbor, list)));
                    let mut apart = Vec::new();
                    self.add_divergence(known, &lists.0, &lists.1, false, &mut apart);
                    let names = (self.of_type(known, extra), self.of_type(known, neighbor));
                    way.push(format!("only {side}: {:016x}{:016x}, told from {:016x}{:016x} next to it (as here and kept) by ({})", names.0[0], names.0[1], names.1[0], names.1[1], apart.join(" > ")));
                }
            }
        }
    }
}

impl Checker<'_, '_> {
    /// Why two types that were expected to be one are called differently: what each of them is, and the way down to the first thing that is
    /// hashed for one and not for the other. Kinds and numbers only: nothing of the text of the program.
    pub fn explain_identities(&mut self, here: TypeId, kept: TypeId) -> String {
        let mut about = |ty: TypeId| {
            let properties = self.members(ty).map_or_else(|| "no members".to_owned(), |members| format!("{} properties", members.shape().props.len()));
            let alias = |alias: Option<usize>| alias.map_or_else(|| "none".to_owned(), |arguments| format!("with {arguments} type arguments"));
            let stored = self.types().provenance(ty).and_then(|provenance| provenance.alias.as_ref().map(|alias| alias.1.len()));
            let records = Records { types: self.types(), atoms: self.atoms() };
            let made = match self.data(ty) {
                TypeData::Synth(shape) => {
                    let sources: Vec<&str> = (shape.props.iter())
                        .map(|prop| match prop.source {
                            PropSource::Type(_) => "Type",
                            PropSource::Literal(..) => "Literal",
                            PropSource::Symbol(_) => "Symbol",
                            PropSource::Intersected(..) => "Intersected",
                            PropSource::Mapped(..) => "Mapped",
                            _ => "another",
                        })
                        .collect();
                    format!(", made as {:?}, with a mapper: {}, sources of the properties [{}]", shape.literal, shape.mapper != MapperId::IDENTITY, sources.join(" "))
                }
                _ => String::new(),
            };
            format!(
                "{}, flags {:?}, {properties}, alias {}, stored alias {}{made}",
                records.kind_of_type(ty),
                self.types().object_flags(ty),
                alias(self.alias_of_type(ty).map(|alias| alias.1.len())),
                alias(stored),
            )
        };
        let (about_here, about_kept) = (about(here), about(kept));
        let mut way = Vec::new();
        let mappers_entered = self.with_known(|records, known| {
            let lists = (records.list(known, |list| records.walk_type(here, list)), records.list(known, |list| records.walk_type(kept, list)));
            records.note_mappers(known, here, kept);
            records.add_divergence(known, &lists.0, &lists.1, true, &mut way);
            std::mem::take(&mut known.mappers_entered)
        });
        for [here, kept] in mappers_entered {
            let about = self.about_mappers(here, kept);
            way.push(about);
        }
        if way.is_empty() {
            way.push("nowhere".to_owned());
        }
        format!("the types: here {about_here}; kept {about_kept}; they diverge at {}", way.join(" > "))
    }

    /// Two mappers that differ, of two types that are otherwise alike: where what they are applied to is declared, and each pair with the type
    /// parameter it is for.
    fn about_mappers(&mut self, here: (TypeId, MapperId), kept: (TypeId, MapperId)) -> String {
        let declared = match *self.data(here.0) {
            TypeData::Anon { origin: Origin::Mapped(file, node) | Origin::TypeLiteral(file, node), .. } | TypeData::Cond { file, node, .. } => Some((file, node)),
            _ => None,
        };
        let about_declaration = match declared {
            Some((file, node)) => {
                let bound = self.bound(file);
                let (mut scope, mut around) = (bound.type_scope[node.idx()], Vec::new());
                while scope.is_some() && around.len() < 16 {
                    around.push(format!("{:?}", bound.scopes[scope.idx()].kind));
                    scope = bound.scopes[scope.idx()].parent;
                }
                format!("declared in file {} at type node {}, in the scopes [{}]", file.0, node.0, around.join(", "))
            }
            None => "declared by no type node".to_owned(),
        };
        let name = |identity: Identity| format!("{:016x}{:016x}", identity[0], identity[1]);
        let pairs_kept: Vec<(TypeId, TypeId)> = self.types().mapping(kept.1).to_vec();
        let sources_kept: Vec<Identity> = pairs_kept.iter().map(|pair| self.identity_of_type(pair.0)).collect();
        let mut pairs = Vec::new();
        for (source, target) in self.types().mapping(here.1).to_vec() {
            let about_source = match *self.data(source) {
                TypeData::TypeParam(file, param, mapper) => {
                    let (hir, bound) = (self.hir(file), self.bound(file));
                    let symbol = self.files().sym(file, bound.type_param_symbol[param.idx()]);
                    let is_named = declared.is_some_and(|(of, node)| {
                        let (tree, scopes) = (self.hir(of), &self.bound(of).type_scope);
                        let (start, end) = (tree[node].pos, tree[node].end);
                        tree.types.iter().enumerate().any(|(index, inner)| {
                            let TypeNodeKind::Ref { name, .. } = inner.kind else { return false };
                            start <= inner.pos && inner.end <= end && name.len() == 1 && tree.texts(name).next() == Some(hir[param].name) && self.files().resolve_name(of, scopes[index], hir[param].name, SymFlags::TYPE) == Some(symbol)
                        })
                    });
                    let scope = bound.type_param_scope[param.idx()];
                    let owner = if scope.is_some() { format!("{:?}", bound.scopes[scope.idx()].kind) } else { "none".to_owned() };
                    format!("type parameter {} of file {}, of the scope {owner}, a clone: {}, named within the declaration: {is_named}", param.0, file.0, mapper != MapperId::IDENTITY)
                }
                TypeData::ThisParam(owner) => format!("the `this` type of symbol {} of file {}", owner.id.0, owner.file.0),
                _ => "no type parameter".to_owned(),
            };
            let records = Records { types: self.types(), atoms: self.atoms() };
            let identity = self.identity_of_type(source);
            let about_targets = match sources_kept.iter().position(|&other| other == identity) {
                Some(at) => {
                    let names = (self.identity_of_type(target), self.identity_of_type(pairs_kept[at].1));
                    format!("to, here {} {}, kept {} {}, the same: {}", records.kind_of_type(target), name(names.0), records.kind_of_type(pairs_kept[at].1), name(names.1), names.0 == names.1)
                }
                None => "which the kept mapper has no pair for".to_owned(),
            };
            pairs.push(format!("({about_source}; {about_targets})"));
        }
        let records = Records { types: self.types(), atoms: self.atoms() };
        format!("the mappers of what is {}, {about_declaration}: {} pairs here, {} kept: {}", records.kind_of_type(here.0), pairs.len(), pairs_kept.len(), pairs.join(", "))
    }

    /// What the type is called by what outlives the task.
    pub fn identity_of_type(&mut self, ty: TypeId) -> Identity {
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
        let result = walk(records, &mut Known { state: &mut state, checker: self, mappers_entered: Vec::new() });
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
    }

    fn with<T>(records: Records<'_, '_>, state: &mut State, walk: impl FnOnce(&mut Known<'_>) -> T) -> T {
        walk(&mut Known { state, checker: &mut AsItIs(records.types), mappers_entered: Vec::new() })
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
    fn the_way_to_the_first_difference_is_found() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let own = OwnStore::new_in(session.arena());
        let records = shared.records(&own);
        let types = records.types;
        let (a, b, c) = (literal_at(records, 1), literal_at(records, 2), literal_at(records, 3));
        let around = |members: &[TypeId]| types.intern(TypeData::Keyof(types.intern(TypeData::Intersection(types.list(members)))));
        let mut known = State::default();
        let mut way_between = |here: TypeId, kept: TypeId| {
            with(records, &mut known, |known| {
                let lists = (records.list(known, |list| records.walk_type(here, list)), records.list(known, |list| records.walk_type(kept, list)));
                let mut way = Vec::new();
                records.add_divergence(known, &lists.0, &lists.1, true, &mut way);
                way
            })
        };
        assert!(way_between(around(&[a, b]), around(&[a, b])).is_empty());
        let way = way_between(around(&[a, b]), around(&[a, b, c]));
        assert!(way[0].ends_with("a type, here an intersection, kept an intersection"), "{way:?}");
        assert!(way[1].contains("plain data, here `usize` 0200000000000000, kept `usize` 0300000000000000"), "{way:?}");
        assert!(way[2].starts_with("all of it: here ["), "{way:?}");
        // `c` is told from `a` and from `b`.
        assert_eq!(way.iter().filter(|step| step.starts_with("only kept: ")).count(), 2, "{way:?}");
        assert!(way.iter().all(|step| !step.starts_with("only here: ")), "{way:?}");
        let way = way_between(around(&[a, b]), around(&[a, c]));
        assert!(way[1].ends_with("a type, here a type literal, kept a type literal"), "{way:?}");
        assert!(way[2].contains("plain data, here `TypeNodeId` 02000000, kept `TypeNodeId` 03000000"), "{way:?}");
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn a_type_keeps_its_identity_when_it_is_published() {
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

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
use crate::program::FileId;
use crate::types::{ComponentsId, Follow, Lanes, MapperId, Provenance, SigId, TypeData, TypeId, Types, UnionOrigin, Visitor};
use crate::util::FxHashMap;
use std::hash::Hash;

/// 128 bits. Two types with one identity are taken for the same type.
pub type Identity = [u64; 2];

/// The identities found so far. The keys are ids, so it is good for one task.
#[derive(Default)]
pub(super) struct State {
    types: FxHashMap<TypeId, Identity>,
    sigs: FxHashMap<SigId, Identity>,
    mappers: FxHashMap<MapperId, Identity>,
    components: FxHashMap<ComponentsId, Identity>,
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

/// Computes the identity of one record. An id is hashed as the identity of its record, published or not.
struct Identify<'a, 'p, 's> {
    lanes: Lanes,
    records: Records<'p, 's>,
    known: &'a mut State,
}

impl<'a, 'p, 's> Identify<'a, 'p, 's> {
    fn new(records: Records<'p, 's>, known: &'a mut State, of: Of) -> Self {
        let mut lanes = Lanes::START;
        lanes.add(of as u64);
        Identify { lanes, records, known }
    }

    fn add(&mut self, identity: Identity) {
        self.lanes.add(identity[0]);
        self.lanes.add(identity[1]);
    }

    /// As a set: two tasks may have the items in different orders.
    fn unordered<T: Follow>(&mut self, items: &[T]) {
        let mut sum = [0u64; 2];
        for item in items {
            let mut one = Identify { lanes: Lanes::START, records: self.records, known: &mut *self.known };
            item.visit(&mut one);
            sum[0] = sum[0].wrapping_add(one.lanes.0[0]);
            sum[1] = sum[1].wrapping_add(one.lanes.0[1]);
        }
        self.lanes.add(items.len() as u64);
        self.add(sum);
    }
}

impl Visitor for Identify<'_, '_, '_> {
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
    fn of_type(self, known: &mut State, ty: TypeId) -> Identity {
        if let Some(&identity) = known.types.get(&ty) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Type);
        match self.types.get(ty) {
            data @ TypeData::Union(members) => {
                it.plain(&std::mem::discriminant(data));
                it.unordered(members);
            }
            data => data.visit(&mut it),
        }
        let provenance = self.types.provenance(ty);
        it.plain(&provenance.is_some());
        if let Some(Provenance { alias, origin, is_enum, stored_under, is_array_literal }) = provenance {
            alias.visit(&mut it);
            match origin {
                UnionOrigin::Union(types) => {
                    it.plain(&std::mem::discriminant(origin));
                    it.unordered(types);
                }
                origin => origin.visit(&mut it),
            }
            is_enum.visit(&mut it);
            stored_under.visit(&mut it);
            is_array_literal.visit(&mut it);
        }
        let identity = it.lanes.0;
        known.types.insert(ty, identity);
        identity
    }

    fn of_sig(self, known: &mut State, sig: SigId) -> Identity {
        if let Some(&identity) = known.sigs.get(&sig) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Sig);
        self.types.sig(sig).visit(&mut it);
        let identity = it.lanes.0;
        known.sigs.insert(sig, identity);
        identity
    }

    /// The pairs are in the order of the ids of the type parameters.
    fn of_mapper(self, known: &mut State, mapper: MapperId) -> Identity {
        if mapper == MapperId::IDENTITY {
            return [Of::Mapper as u64, 0];
        }
        if let Some(&identity) = known.mappers.get(&mapper) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Mapper);
        it.unordered(self.types.mapping(mapper));
        let identity = it.lanes.0;
        known.mappers.insert(mapper, identity);
        identity
    }

    fn of_components(self, known: &mut State, components: ComponentsId) -> Identity {
        if components == ComponentsId::NONE {
            return [Of::Components as u64, 0];
        }
        if let Some(&identity) = known.components.get(&components) {
            return identity;
        }
        let mut it = Identify::new(self, known, Of::Components);
        self.types.components(components).visit(&mut it);
        let identity = it.lanes.0;
        known.components.insert(components, identity);
        identity
    }
}

impl Checker<'_, '_> {
    /// What the type is called by what outlives the task.
    pub fn identity_of_type(&mut self, ty: TypeId) -> Identity {
        let records = Records { types: self.types(), atoms: self.atoms() };
        records.of_type(&mut self.aot.identity, ty)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atom::Interner;
    use crate::hir::{TypeNodeId, TypeParamId};
    use crate::local::MaybeLocal;
    use crate::session::Session;
    use crate::types::{Link, Marks, Origin, OwnStore, TypeStore};

    const FILE: FileId = FileId(3);

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
        let of_a = shared.records(&one).of_type(&mut State::default(), a);
        let of_b = shared.records(&other).of_type(&mut State::default(), b);
        assert_eq!(of_a, of_b);
        // Another node, another type.
        let types = shared.records(&one).types;
        let elsewhere = types.intern(TypeData::Anon { origin: Origin::TypeLiteral(FILE, TypeNodeId(6)), mapper: MapperId::IDENTITY });
        assert_ne!(shared.records(&one).of_type(&mut State::default(), elsewhere), of_a);
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn a_type_keeps_its_identity_when_it_is_published() {
        let session = Session::new();
        let shared = Shared { atoms: Interner::new_in(&session), types: TypeStore::new_in(&session) };
        let mut first = OwnStore::new_in(session.arena());
        let made = make(shared.records(&first), false);
        let around = shared.records(&first).types.intern(TypeData::Keyof(made));
        let before = shared.records(&first).of_type(&mut State::default(), made);
        let around_before = shared.records(&first).of_type(&mut State::default(), around);
        let link = shared.publish(&mut first, made);
        let mut published = made;
        published.follow(&link);
        assert!(!published.is_local());

        // A task of the next step finds the published type, and makes a type of its own around that.
        let later = OwnStore::new_in(session.arena());
        assert_eq!(make(shared.records(&later), false), published);
        let mut known = State::default();
        assert_eq!(shared.records(&later).of_type(&mut known, published), before);
        let around = shared.records(&later).types.intern(TypeData::Keyof(published));
        assert!(around.is_local());
        assert_eq!(shared.records(&later).of_type(&mut known, around), around_before);
    }
}

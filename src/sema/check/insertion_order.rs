//! A type's property order as TypeScript 6 has it without `stableTypeOrdering`: the order in which the properties were
//! inserted into its symbol tables. TypeScript 7 sorts them by declaration position, and so does the checker. This view
//! is for code that reads that order through `getPropertiesOfType` and `typeToString` under TypeScript 6, and changes
//! nothing else.
//!
//! - A class or an interface: what `symbol.members` holds (declarations merged in program file order, then module
//!   augmentations), then its late-bound members, then what each base type adds, in heritage clause order
//!   (`resolveObjectTypeMembers`, `addInheritedMembers`).
//! - A union or an intersection: each constituent's properties in turn, where a name's first occurrence counts
//!   (`getPropertiesOfUnionOrIntersectionType`). A union's constituents stay in `CompareTypes` order, where TypeScript
//!   6 has type creation order.
//! - A spread: the right operand's properties, then the left's that it lacks (`getSpreadType`). A rest: the
//!   destructured type's (`getRestType`).
//! - A mapped type over `keyof T`: in the order of `T`'s properties. A reverse mapped type: in the order of its
//!   source's properties (`resolveReverseMappedTypeMembers`).
//! - A class constructor, module or namespace as a value: its export order (`prototype` first, a namespace's functions
//!   before its other declarations), then what it re-exports or inherits.
//! - Any other type: the checker's order, which for an object literal or a type literal is source order.

use super::*;
use crate::bind::{Decl, MemberOwner};

/// A step in [`Checker::names_in_insertion_order`]'s walk.
enum Step {
    /// Collect the type's names: first those of the types it's built from.
    Enter(TypeId),
    /// The names of its parts, the types it's built from, are known: combine them.
    Exit(TypeId, Vec<TypeId>),
}

impl<'p, 's> Checker<'p, 's> {
    /// TypeScript 6's default order of `props`, the properties of the object type `ty`, as indices into `props`. `ty`
    /// may be a union or an intersection, whose `props` are those of `reduced_apparent_type_as_object`.
    pub(crate) fn insertion_order_of_props(&mut self, ty: TypeId, props: &[Prop]) -> Vec<usize> {
        let rank = rank_of(&self.names_in_insertion_order(ty));
        let mut order: Vec<usize> = (0..props.len()).collect();
        order.sort_by_key(|&i| rank.get(&props[i].name).copied().unwrap_or(usize::MAX));
        order
    }

    /// The names of `ty`'s properties in TypeScript 6's order, each once. Each type it's built from is ordered once,
    /// however many bases share it, and without recursion, however deep the bases or spreads go. A type reached again
    /// while its own names are being collected, through a circular base, adds no names there.
    fn names_in_insertion_order(&mut self, ty: TypeId) -> Vec<Atom> {
        let root = self.reduced_apparent_type(ty);
        let mut done: FxHashMap<TypeId, Vec<Atom>> = FxHashMap::default();
        let mut entered: crate::util::FxHashSet<TypeId> = Default::default();
        let mut steps = vec![Step::Enter(root)];
        while let Some(step) = steps.pop() {
            match step {
                Step::Enter(ty) => {
                    if !entered.insert(ty) {
                        continue;
                    }
                    let parts = self.parts_in_insertion_order(ty);
                    let enter = parts.iter().rev().map(|&part| Step::Enter(part));
                    let enter: Vec<Step> = enter.collect();
                    steps.push(Step::Exit(ty, parts));
                    steps.extend(enter);
                }
                Step::Exit(ty, parts) => {
                    let names = {
                        let part_names: Vec<&[Atom]> = (parts.iter())
                            .map(|part| done.get(part).map_or(&[][..], Vec::as_slice))
                            .collect();
                        self.names_with_parts(ty, &part_names)
                    };
                    let mut seen: crate::util::FxHashSet<Atom> = Default::default();
                    let names = names.into_iter().filter(|it| seen.insert(*it)).collect();
                    done.insert(ty, names);
                }
            }
        }
        done.remove(&root).unwrap_or_default()
    }

    /// The types whose names contribute to `ty`'s, in the order they contribute, as [`Checker::names_with_parts`] takes
    /// them.
    fn parts_in_insertion_order(&mut self, ty: TypeId) -> Vec<TypeId> {
        let parts = match *self.data(ty) {
            TypeData::Union(ref parts) | TypeData::Intersection(ref parts) => parts.to_vec(),
            TypeData::Ref { target, .. } => match self.members(ty) {
                Some(_) => self.base_types(target).into_vec(),
                None => Vec::new(),
            },
            TypeData::Synth(ref shape) => match shape.created_from {
                Some((left, right)) if right == TypeId::NEVER => vec![left],
                Some((left, right)) => vec![right, left],
                None => Vec::new(),
            },
            TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } => match self.mapped_modifiers_source(file, node) {
                Some((source, true)) => vec![self.instantiate(source, mapper)],
                _ => Vec::new(),
            },
            TypeData::Anon {
                origin: Origin::Namespace { module, .. },
                ..
            } => vec![self.type_of_symbol(module)],
            TypeData::ReverseMapped { source, .. } => vec![source],
            TypeData::Tuple { readonly, .. } => vec![match readonly {
                true => self.readonly_array_of(TypeId::ANY),
                false => self.array_of(TypeId::ANY),
            }],
            _ => Vec::new(),
        };
        (parts.into_iter())
            .map(|part| self.reduced_apparent_type(part))
            .collect()
    }

    /// The names of `ty`'s properties in TypeScript 6's order, given its parts' names. A name may appear more than
    /// once, and the first occurrence counts.
    fn names_with_parts(&mut self, ty: TypeId, parts: &[&[Atom]]) -> Vec<Atom> {
        let all_of_parts = || parts.iter().flat_map(|it| it.iter().copied());
        match *self.data(ty) {
            TypeData::Union(_) | TypeData::Intersection(_) => all_of_parts().collect(),
            TypeData::Ref { target, .. } => {
                let mut names = self.own_names_of_class_or_interface(ty, target);
                names.extend(all_of_parts());
                names
            }
            TypeData::Synth(ref shape) => match shape.created_from {
                Some(_) => all_of_parts().collect(),
                None => self.names_as_resolved(ty),
            },
            TypeData::Anon {
                origin: Origin::Mapped(file, node),
                ..
            } => match parts.first() {
                Some(order) => self.names_of_mapped_type(ty, file, node, order),
                None => self.names_as_resolved(ty),
            },
            // `getSpreadType(moduleType, { default })`: `default` comes first.
            TypeData::Anon {
                origin: Origin::Namespace { with_default, .. },
                ..
            } => {
                let default = with_default.then_some(known::default);
                default.into_iter().chain(all_of_parts()).collect()
            }
            TypeData::Anon {
                origin: Origin::ClassStatic(symbol) | Origin::Module(symbol),
                ..
            } => {
                let exports = self.files().exports(symbol);
                self.names_ranked_by(ty, exports.iter().map(|it| it.0))
            }
            TypeData::ReverseMapped { .. } => {
                let source = parts.first().copied().unwrap_or_default();
                self.names_ranked_by(ty, source.iter().copied())
            }
            // `getResolvedMembersOrExportsOfSymbol`: the late-bound members follow the others.
            TypeData::Anon {
                origin: Origin::TypeLiteral(..),
                ..
            } => match self.members(ty) {
                Some(members) => {
                    let props = &members.shape().props;
                    let (late, early): (Vec<&Prop>, Vec<&Prop>) =
                        props.iter().partition(|prop| self.has_computed_name(prop));
                    early
                        .into_iter()
                        .chain(late)
                        .map(|prop| prop.name)
                        .collect()
                }
                None => Vec::new(),
            },
            // `createTupleTargetType`: the elements and `length`, then what `Array` adds.
            TypeData::Tuple { .. } => {
                let inherited = parts.first().copied().unwrap_or_default();
                let mut names: Vec<Atom> = (self.names_as_resolved(ty).into_iter())
                    .filter(|name| !inherited.contains(name))
                    .collect();
                names.extend(inherited.iter().copied());
                names
            }
            _ => self.names_as_resolved(ty),
        }
    }

    /// The names of `ty`'s properties: the ones in `order`, in that order, then the others in member order.
    fn names_ranked_by(&mut self, ty: TypeId, order: impl Iterator<Item = Atom>) -> Vec<Atom> {
        let order: Vec<Atom> = order.collect();
        let rank = rank_of(&order);
        let mut names = self.names_as_resolved(ty);
        names.sort_by_key(|name| rank.get(name).copied().unwrap_or(usize::MAX));
        names
    }

    /// The names of `ty`'s properties in member order.
    fn names_as_resolved(&mut self, ty: TypeId) -> Vec<Atom> {
        match self.members(ty) {
            Some(members) => members.shape().props.iter().map(|p| p.name).collect(),
            None => Vec::new(),
        }
    }

    /// The names that the class or interface `target`, which `ty` references, declares. [`Checker::names_with_parts`]
    /// adds its bases' names.
    fn own_names_of_class_or_interface(&mut self, ty: TypeId, target: Sym) -> Vec<Atom> {
        let Some(members) = self.members(ty) else {
            return Vec::new();
        };
        let table = self.files().members_in_table(target);
        let mut place: FxHashMap<Atom, usize> = FxHashMap::default();
        for (i, &(name, _)) in table.iter().enumerate() {
            place.entry(name).or_insert(i);
        }
        // `getResolvedMembersOrExportsOfSymbol`: the late-bound members follow the others.
        let mut own: Vec<(usize, Atom)> = Vec::new();
        for prop in members.shape().props.iter() {
            match place.get(&prop.name) {
                Some(&at) => own.push((at, prop.name)),
                None if self.is_member_of(prop, target) => own.push((usize::MAX, prop.name)),
                None => {}
            }
        }
        own.sort_by_key(|it| it.0);
        own.into_iter().map(|it| it.1).collect()
    }

    /// True if `prop` is a member with a computed name the binder couldn't resolve.
    fn has_computed_name(&self, prop: &Prop) -> bool {
        matches!(prop.source, PropSource::Symbol(symbol)
            if self.files().symbol(symbol).name == known::computed)
    }

    /// True if a declaration of `prop` is a member of a declaration of the class or interface `owner`.
    fn is_member_of(&self, prop: &Prop, owner: Sym) -> bool {
        let PropSource::Symbol(symbol) = prop.source else {
            return false;
        };
        let files = self.files();
        files.decls_of(symbol).iter().any(|&(file, decl)| {
            let Decl::Member(member) = decl else {
                return false;
            };
            let bound = self.bound(file);
            let declaring = match bound.member_owner[member.idx()] {
                MemberOwner::Class(c) => bound.class_symbol[c.idx()],
                MemberOwner::Interface(i) => bound.interface_symbol[i.idx()],
                _ => return false,
            };
            declaring.is_some() && files.sym(file, declaring) == owner
        })
    }

    /// `resolveMappedTypeMembers`: over `keyof T` it adds a property for each of `T`'s properties in turn, whose names
    /// are `order`. Over anything else it distributes over a union.
    fn names_of_mapped_type(
        &mut self,
        ty: TypeId,
        file: FileId,
        node: TypeNodeId,
        order: &[Atom],
    ) -> Vec<Atom> {
        let rank = rank_of(order);
        let Some(members) = self.members(ty) else {
            return Vec::new();
        };
        let mapped = self.mapped_decl(file, node);
        let renames = mapped.name_ty.is_some();
        let param = self.type_param(file, mapped.param);
        let mut keyed: Vec<(usize, Atom)> = Vec::with_capacity(members.shape().props.len());
        for prop in members.shape().props.iter() {
            // With an `as` clause the name comes from the key: the property of `T` it was added for is the key's, or
            // the first of several keys with one name.
            let at = if renames {
                let key = self.types().map(prop.mapper, param);
                let keys = key.map(|key| self.parts(key).to_vec()).unwrap_or_default();
                let names = keys
                    .into_iter()
                    .filter_map(|k| self.property_name_of_type(k));
                names.filter_map(|name| rank.get(&name).copied()).min()
            } else {
                rank.get(&prop.name).copied()
            };
            keyed.push((at.unwrap_or(usize::MAX), prop.name));
        }
        keyed.sort_by_key(|it| it.0);
        keyed.into_iter().map(|it| it.1).collect()
    }
}

/// Each name's index in `names`, at its first occurrence.
fn rank_of(names: &[Atom]) -> FxHashMap<Atom, usize> {
    let mut rank: FxHashMap<Atom, usize> = FxHashMap::default();
    for (i, &name) in names.iter().enumerate() {
        rank.entry(name).or_insert(i);
    }
    rank
}

//! Which fields of an object nobody ever sees absent: `field_flags::NEVER_SEEN_ABSENT`.
//!
//! A FACT. The engine keeps such a field without a marker for "absent" and reads it without a test: an int32 is four raw bytes. So
//! what is not shown to hold is not answered.
//!
//! An object comes to have a layout `L` in one of four ways.
//!
//! * AN OBJECT LITERAL, A COPY OF PLAIN DATA. It has every required field from the start.
//! * A CLASS. Every field is defined while the object is constructed, but for `field_flags::ABSENT_AT_BIRTH`, which is optional. Whether one
//!   is seen before it is initialized is in its type (`Checker::field_starts_undefined`).
//! * A CONSTRUCTOR FUNCTION, `function Node(this: Node, kind: SyntaxKind) { this.kind = kind; .. }`. `new callee(..)` allocates the object, in
//!   compiled code or in the run time, and hands it to whatever `callee` is. A callee that is no function of the program with a declared
//!   `this` never gets it. One that is tests it on entry against the subtypes of the type of its `this`. The FIRST STORES of `F` are the
//!   statements `this.name = value` that its body starts with: see `first_stores_of`. Nothing else runs while they do, so nobody sees
//!   the object before the last. AND THE ENGINE HANDS `F` A FRESH `L` ONLY IF `F` STORES FIRST ALL THAT IS NEVER SEEN ABSENT IN `L`: any other `F` makes
//!   its own object, of the layout of its `this`. So which `F` are gone by is a choice, and no answer hangs on it: those that are meant to
//!   get an `L`. The run time makes for `F` what `F` declares `this` to be. A `new` that makes an `L` expects one function
//!   (`Checker::function_produced_by`), or nobody in particular: then every `F` with `L` among the subtypes of `this`. What all of them store
//!   first is never seen absent. (`SourceFile` is a subtype of `SourceMapSource`; no `new` that makes one expects `function SourceMapSource`.)
//! * A SHAPE TRANSITION from a layout `B`, at a cast. The run time makes transitions at casts that no source has, so none is looked at: a
//!   field that `L` has and `B` lacks may be seen absent.
//!
//! A layout and what it may become keep one slot for a field that both have: it is never seen absent in both or in neither. Not so where the engine takes the transition
//! out: an object that is made without the discriminant of a family never becomes one of the family (`{ text } as Identifier`).
//!
//! The run time counts a property among the keys of an object when a store finds the marker, which such a field has not. So the engine
//! is told which stores are the first: the front end emits them as one operation, `Initialize`, which counts them all at once.

use super::flows::Reach;
use super::subtypes::{Facts, IS_INSTANCE};
use crate::atom::Atom;
use crate::bind::{Decl, SymFlags};
use crate::check::Checker;
use crate::hir::{Chain, ExprId, ExprKind, Flags, FnBody, FnId, PatKind, StmtId, StmtKind};
use crate::program::FileId;
use crate::types::TypeId;
use crate::util::FxHashMap;

/// What has been noted of constructor functions. `T`: what a type is called by. The types are `laid_out_as`.
pub(crate) struct Constructions<T = TypeId> {
    /// For each constructor function, and each layout in the type of its `this`: its first stores, and `has_mutable_prototype`.
    constructors: Vec<(T, (FileId, FnId), Vec<Atom>, bool)>,
    /// For each `new callee(..)` that makes the object itself: its layout, and the one function that `callee` is expected to be.
    created_by_new: Vec<(T, Option<(FileId, FnId)>)>,
    /// The layouts that an allocation makes with a discriminant: `Checker::discriminant_of_new`, `discriminant_of_object_literal`.
    created_with_discriminant: Vec<T>,
    /// One has been left out, so nothing is known.
    is_incomplete: bool,
}

impl<T> Default for Constructions<T> {
    fn default() -> Constructions<T> {
        Constructions { constructors: Vec::new(), created_by_new: Vec::new(), created_with_discriminant: Vec::new(), is_incomplete: false }
    }
}

impl<T: Copy> Constructions<T> {
    pub(super) fn absorb(&mut self, other: Constructions<T>) {
        self.constructors.extend(other.constructors);
        self.created_by_new.extend(other.created_by_new);
        self.created_with_discriminant.extend(other.created_with_discriminant);
        self.is_incomplete |= other.is_incomplete;
    }

    pub(super) fn renamed<U: Copy>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Constructions<U> {
        let mut renamed = Constructions { is_incomplete: self.is_incomplete, ..Constructions::default() };
        for (view, function, stores, has_mutable_prototype) in self.constructors {
            match rename(view) {
                Some(view) => renamed.constructors.push((view, function, stores, has_mutable_prototype)),
                None => renamed.is_incomplete = true,
            }
        }
        for (layout, expected) in self.created_by_new {
            match rename(layout) {
                Some(layout) => renamed.created_by_new.push((layout, expected)),
                None => renamed.is_incomplete = true,
            }
        }
        renamed.created_with_discriminant = self.created_with_discriminant.into_iter().filter_map(rename).collect();
        renamed
    }
}

impl Constructions<TypeId> {
    pub(super) fn by_view(&self, index_of: &FxHashMap<TypeId, u32>) -> ConstructionsByView {
        let constructors: Vec<(u32, (FileId, FnId), Vec<Atom>, bool)> =
            (self.constructors.iter()).filter_map(|(view, function, stores, has_mutable_prototype)| Some((*index_of.get(view)?, *function, stores.clone(), *has_mutable_prototype))).collect();
        let created_by_new: Vec<(u32, Option<(FileId, FnId)>)> = self.created_by_new.iter().filter_map(|(layout, expected)| Some((*index_of.get(layout)?, *expected))).collect();
        let is_incomplete = self.is_incomplete || constructors.len() < self.constructors.len() || created_by_new.len() < self.created_by_new.len();
        let created_with_discriminant = self.created_with_discriminant.iter().filter_map(|layout| index_of.get(layout).copied()).collect();
        ConstructionsByView { constructors, created_by_new, created_with_discriminant, is_incomplete }
    }
}

/// `Constructions`, with the index of a view in the place of its type.
pub(crate) struct ConstructionsByView {
    constructors: Vec<(u32, (FileId, FnId), Vec<Atom>, bool)>,
    created_by_new: Vec<(u32, Option<(FileId, FnId)>)>,
    created_with_discriminant: Vec<u32>,
    is_incomplete: bool,
}

impl ConstructionsByView {
    pub(super) fn is_incomplete(&self) -> bool {
        self.is_incomplete
    }

    /// Fills in `Reach::never_seen_absent`. All by view. `becomes`: what a cast may turn a layout into.
    ///
    /// Whatever the order of what has been noted, it comes out the same: an intersection does not depend on it.
    pub(super) fn apply(self, views: &mut [Reach], facts: &[Facts], becomes: &[Vec<u32>]) {
        // By layout: what every function stores first that it is meant to be handed to. `None`: it is handed to none.
        let mut stored_first: Vec<Option<Vec<Atom>>> = vec![None; views.len()];
        let mut expected_by_new: Vec<Vec<Option<(FileId, FnId)>>> = vec![Vec::new(); views.len()];
        for &(layout, expected) in &self.created_by_new {
            expected_by_new[layout as usize].push(expected);
        }
        let is_instance = |layout: u32| facts[layout as usize].flags & IS_INSTANCE != 0;
        // The records that may inherit from anything: `class_flags::MAY_HAVE_OTHER_PROTOTYPE`, as the link gives it to them. The run time does
        // not guard the `prototype` object of a function that initializes one.
        let mut may_inherit: Vec<bool> = vec![false; views.len()];
        for (view, ..) in self.constructors.iter().filter(|constructor| constructor.3) {
            for &layout in views[*view as usize].members.iter().chain([view]).filter(|&&layout| !is_instance(layout)) {
                may_inherit[layout as usize] = true;
            }
        }
        for (view, function, stores, _) in &self.constructors {
            let this = &views[*view as usize];
            let is_had_by_all = |name: &&Atom| this.members.iter().all(|&layout| facts[layout as usize].declared.binary_search(&name.0).is_ok());
            let is_general = this.members.iter().any(|&layout| may_inherit[layout as usize]);
            let stores = if is_general { &[][..] } else { &stores[..stores.iter().take_while(is_had_by_all).count()] };
            let is_meant_to_get = |layout: &&u32| *layout == view || expected_by_new[**layout as usize].iter().any(|expected| expected.is_none_or(|expected| expected == *function));
            for &layout in this.members.iter().chain([view]).filter(is_meant_to_get) {
                match &mut stored_first[layout as usize] {
                    Some(by_all) => by_all.retain(|name| stores.contains(name)),
                    none => *none = Some(stores.to_vec()),
                }
            }
        }
        // By allocated layout: the names of the required fields that are never seen absent, ascending. An optional field has no flag, so
        // it counts as one that may be: what a layout and what it may become share is flagged in both or in neither.
        let mut present: Vec<Vec<u32>> = (views.iter().zip(facts).zip(&stored_first))
            .map(|((reach, facts), stored_first)| match stored_first {
                _ if !reach.is_allocated => Vec::new(),
                _ if facts.flags & IS_INSTANCE != 0 => facts.required.to_vec(),
                _ if self.is_incomplete => Vec::new(),
                Some(by_all) => facts.required.iter().copied().filter(|&name| by_all.contains(&Atom(name))).collect(),
                None => facts.required.to_vec(),
            })
            .collect();
        // What is made with a discriminant, and all that it may become. One that is left out costs flags, and no answer.
        let mut is_in_family = vec![false; views.len()];
        let mut reached = self.created_with_discriminant;
        while let Some(layout) = reached.pop() {
            if !std::mem::replace(&mut is_in_family[layout as usize], true) {
                reached.extend(&becomes[layout as usize]);
            }
        }
        loop {
            let mut is_changed = false;
            for from in 0..views.len() {
                for &to in becomes[from].iter().filter(|&&to| is_in_family[from] || !is_in_family[to as usize]) {
                    // A method is required of an object of a class and is no field of it: the names say nothing across the two kinds.
                    let is_of_one_kind = is_instance(from as u32) == is_instance(to);
                    let both: Vec<u32> = present[from].iter().copied().filter(|name| is_of_one_kind && present[to as usize].binary_search(name).is_ok()).collect();
                    for layout in [from, to as usize] {
                        if present[layout].len() != both.len() {
                            present[layout].clone_from(&both);
                            is_changed = true;
                        }
                    }
                }
            }
            if !is_changed {
                break;
            }
        }
        for (reach, names) in views.iter_mut().zip(present) {
            reach.never_seen_absent = names.into_iter().map(Atom).collect();
        }
    }
}

/// What `Object.prototype` has, to which nothing can be added.
const ON_OBJECT_PROTOTYPE: [&[u8]; 12] = [
    b"constructor",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
    b"__proto__",
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
];

/// `this.name = value;`
#[derive(Copy, Clone)]
pub struct FirstStore {
    pub stmt: StmtId,
    pub this: ExprId,
    /// `this.name`
    pub target: ExprId,
    pub name: Atom,
    pub value: ExprId,
}

impl<'p, 's> Checker<'p, 's> {
    /// The function declares its `this` and can be constructed with. `views`: the layouts in the type of `this`, as the IR has it. `stores`:
    /// those of `first_stores_of` that are translated as first stores, all or none.
    pub fn note_constructor_function(&mut self, views: &[TypeId], file: FileId, func: FnId, stores: &[FirstStore]) {
        let stores: Vec<Atom> = stores.iter().map(|store| store.name).collect();
        let has_mutable_prototype = self.has_mutable_prototype(file, func);
        for &view in views {
            let view = self.laid_out_as(view);
            self.noted_constructions().constructors.push((view, (file, func), stores.clone(), has_mutable_prototype));
        }
    }

    /// An allocation makes an object of the layout of the type with a discriminant.
    pub fn note_object_created_with_discriminant(&mut self, made: TypeId) {
        let made = self.laid_out_as(made);
        self.noted_constructions().created_with_discriminant.push(made);
    }

    /// An object of the layout of the type `made` is made with none of its fields, and whoever can get at it may before they are stored
    /// to: that of a namespace.
    pub fn note_object_allocated_empty(&mut self, made: TypeId, file: FileId) {
        let made = self.laid_out_as(made);
        self.noted_constructions().constructors.push((made, (file, FnId::NONE), Vec::new(), false));
    }

    /// `new callee(..)` makes the object itself, of the layout of the type `made`, and hands it to what `callee` turns out to be. `None`: of a layout that no type stands for.
    pub fn note_object_created_by_new(&mut self, made: Option<TypeId>, file: FileId, callee: ExprId) {
        let Some(made) = made else {
            self.noted_constructions().is_incomplete = true;
            return;
        };
        let (made, expected) = (self.laid_out_as(made), self.function_produced_by(file, callee));
        self.noted_constructions().created_by_new.push((made, expected));
    }

    /// The statements `this.name = value` that the body of the function starts with, up to one that repeats a name.
    ///
    /// Between the allocation and the last of them nothing runs but these stores. The parameters are plain names: a default, a pattern
    /// or a rest parameter runs before the body. A value is a parameter, a primitive constant, a member of an enum, `undefined!` or `null!`, a plain nil:
    /// it does not mention `this`, calls nothing and does not throw. What a store itself may throw for, a value that does not fit the
    /// field, leaves an object that nobody holds.
    ///
    /// No store finds a setter in its way. A name that some file defines on a `prototype` object, or that `Object.prototype` has, ends the
    /// list, and a function whose `prototype` object the program may replace or get hold of has none. The run time refuses the rest:
    /// `prototype_property_names_in`, `has_mutable_prototype`.
    ///
    /// `(this as any).name = value` is one of them where the layout has a field for the name: `undeclared_fields.rs`.
    pub fn first_stores_of(&mut self, file: FileId, func: FnId) -> Vec<FirstStore> {
        let mut stores = self.first_stores_written_in(file, func);
        let mut count = self.count_first_stores_to_fields(file, func, &stores);
        while count > 0 && count < stores.len() && stores[count].stmt == stores[count - 1].stmt {
            count -= 1;
        }
        stores.truncate(count);
        stores
    }

    pub(super) fn explain_first_stores_ended_by_listed_names(&mut self) -> (usize, usize) {
        let listed = self.prototype_property_names();
        let all = self.constructor_functions();
        let mut ended = 0;
        for &(file, func) in &all {
            let hir = self.hir(file);
            let FnBody::Block(body) = hir[func].body else { continue };
            if self.has_mutable_prototype(file, func) {
                continue;
            }
            let last = self.first_stores_written_in(file, func).last().map(|store| store.stmt);
            let next = hir.ids(body).skip_while(|&stmt| last.is_some_and(|last| stmt != last)).nth(last.is_some() as usize);
            let Some(StmtKind::Expr(mut e)) = next.map(|stmt| hir[stmt].kind) else { continue };
            while let ExprKind::Assign { op: None, target, value } = hir[e].kind {
                if matches!(hir[target].kind, ExprKind::Dot { name, .. } if listed.contains(&name)) {
                    ended += 1;
                    break;
                }
                e = value;
            }
        }
        (ended, all.len())
    }

    /// Whether or not there is a field for what is stored through `any`.
    pub(super) fn first_stores_written_in(&mut self, file: FileId, func: FnId) -> Vec<FirstStore> {
        let hir = self.hir(file);
        let mut stores: Vec<FirstStore> = Vec::new();
        let has_plain_parameters = hir[func].params.iter().all(|p| hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST) && matches!(hir[hir[p].pat].kind, PatKind::Ident(_)));
        let FnBody::Block(body) = hir[func].body else { return stores };
        if !has_plain_parameters || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) || self.has_mutable_prototype(file, func) {
            return stores;
        }
        let on_prototypes = self.prototype_property_names();
        let keeps_them_off = self.has_no_field_names_on_prototype(file, func);
        for stmt in hir.ids(body) {
            let StmtKind::Expr(e) = hir[stmt].kind else { break };
            // A directive.
            if stores.is_empty() && matches!(hir[e].kind, ExprKind::String(_)) {
                continue;
            }
            let mut targets: Vec<ExprId> = Vec::new();
            let mut value = e;
            while let ExprKind::Assign { op: None, target, value: assigned } = hir[value].kind {
                targets.push(target);
                value = assigned;
            }
            let has_no_operand = matches!(hir[value].kind, ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::Ident(_));
            let evaluates_to_primitive = (targets.len() == 1 || has_no_operand) && self.evaluates_to_primitive(file, value);
            if targets.is_empty() || !(self.names_parameter_of(file, func, value) || self.is_plain_nullish(file, value) || self.is_enum_constant(file, value) || evaluates_to_primitive) {
                break;
            }
            let before = stores.len();
            for &target in targets.iter().rev() {
                let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[target].kind else { break };
                let this = self.this_cast_to_any(file, obj).unwrap_or(obj);
                let is_inherited = (!keeps_them_off && on_prototypes.contains(&name)) || ON_OBJECT_PROTOTYPE.contains(&self.atoms().bytes(name));
                if !matches!(hir[this].kind, ExprKind::This) || is_inherited || stores.iter().any(|store| store.name == name) {
                    break;
                }
                stores.push(FirstStore { stmt, this, target, name, value });
            }
            if stores.len() != before + targets.len() {
                stores.truncate(before);
                break;
            }
        }
        stores
    }

    /// `E.member`, where the checker has computed what the member stands for: `NodeFlags.None`, `BlockScoped = Let | Const`. It is translated as
    /// that constant, and the object of the enum is not read.
    fn is_enum_constant(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[e].kind else { return false };
        let ExprKind::Ident(written) = hir[obj].kind else { return false };
        let Some(declared) = self.symbol_named_by(file, obj, written).filter(|&declared| self.files().flags(declared).intersects(SymFlags::ENUM)) else { return false };
        let Some(member) = self.files().export(declared, name) else { return false };
        matches!(self.files().value_declaration(member), Some((of, Decl::EnumMember(member))) if self.enum_member_value(of, member).is_some() && !self.is_enum_member_read_from_object(file, of, member))
    }

    /// `undefined!`, `null!`: of type `never`, which nothing is held to.
    pub fn is_plain_nullish(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::NonNull(operand) = hir[e].kind else { return false };
        match hir[operand].kind {
            ExprKind::Null => true,
            ExprKind::Ident(name) => self.bound(file).expr_symbol[operand.idx()].is_none() && self.atoms().bytes(name) == b"undefined",
            _ => false,
        }
    }

    pub fn is_nullish_by_its_text(&self, file: FileId, mut e: ExprId) -> bool {
        let hir = self.hir(file);
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[e].kind {
            e = expr;
        }
        match hir[e].kind {
            ExprKind::Null => true,
            ExprKind::Unary { op: crate::hir::UnOp::Void, .. } => true,
            ExprKind::Ident(name) => self.bound(file).expr_symbol[e.idx()].is_none() && self.atoms().bytes(name) == b"undefined",
            _ => false,
        }
    }

    fn names_parameter_of(&self, file: FileId, func: FnId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = bound.expr_symbol[e.idx()];
        matches!(hir[e].kind, ExprKind::Ident(_)) && symbol.is_some() && hir[func].params.iter().any(|p| bound.pat_symbol[hir[p].pat.idx()] == symbol)
    }
}

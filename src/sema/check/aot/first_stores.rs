use super::FieldKey;
use super::flows::LayoutUsage;
use super::subtypes::{Facts, IS_INSTANCE};
use crate::atom::Atom;
use crate::bind::{Decl, Parent, SymFlags};
use crate::check::Checker;
use crate::hir::{Chain, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId, PatKind, StmtId, StmtKind};
use crate::program::FileId;
use crate::types::TypeId;
use crate::util::FxHashMap;

const HAS_MUTABLE_PROTOTYPE: u8 = 1;
const ALLOCATES_FOR_UNKNOWN_CALLERS: u8 = 2;

pub(crate) struct Constructions<T = TypeId> {
    constructors: Vec<(T, (FileId, FnId), Vec<Atom>, u8)>,
    created_by_new: Vec<(T, Option<(FileId, FnId)>)>,
    created_with_discriminant: Vec<T>,
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
    pub(super) fn by_layout_index(&self, index_of: &FxHashMap<TypeId, u32>) -> IndexedConstructions {
        let constructors: Vec<(u32, (FileId, FnId), Vec<Atom>, u8)> =
            (self.constructors.iter()).filter_map(|(view, function, stores, has_mutable_prototype)| Some((*index_of.get(view)?, *function, stores.clone(), *has_mutable_prototype))).collect();
        let created_by_new: Vec<(u32, Option<(FileId, FnId)>)> = self.created_by_new.iter().filter_map(|(layout, expected)| Some((*index_of.get(layout)?, *expected))).collect();
        let is_incomplete = self.is_incomplete || constructors.len() < self.constructors.len() || created_by_new.len() < self.created_by_new.len();
        let created_with_discriminant = self.created_with_discriminant.iter().filter_map(|layout| index_of.get(layout).copied()).collect();
        IndexedConstructions { constructors, created_by_new, created_with_discriminant, is_incomplete }
    }
}

pub(crate) struct IndexedConstructions {
    constructors: Vec<(u32, (FileId, FnId), Vec<Atom>, u8)>,
    created_by_new: Vec<(u32, Option<(FileId, FnId)>)>,
    created_with_discriminant: Vec<u32>,
    is_incomplete: bool,
}

impl IndexedConstructions {
    pub(super) fn is_incomplete(&self) -> bool {
        self.is_incomplete
    }

    pub(super) fn apply(self, views: &mut [LayoutUsage], facts: &[Facts], becomes: &[Vec<u32>]) {
        let mut stored_first: Vec<Option<Vec<Atom>>> = vec![None; views.len()];
        let mut expected_by_new: Vec<Vec<Option<(FileId, FnId)>>> = vec![Vec::new(); views.len()];
        for &(layout, expected) in &self.created_by_new {
            expected_by_new[layout as usize].push(expected);
        }
        let is_instance = |layout: u32| facts[layout as usize].flags & IS_INSTANCE != 0;
        let mut may_inherit: Vec<bool> = vec![false; views.len()];
        let receives = |view: u32, function: (FileId, FnId), traits: u8, layout: u32| {
            (layout == view && traits & ALLOCATES_FOR_UNKNOWN_CALLERS != 0) || expected_by_new[layout as usize].iter().any(|expected| expected.is_none_or(|expected| expected == function))
        };
        for (view, function, _, traits) in self.constructors.iter().filter(|constructor| constructor.3 & HAS_MUTABLE_PROTOTYPE != 0) {
            if !views[*view as usize].members.iter().chain([view]).any(|&layout| receives(*view, *function, *traits, layout)) {
                continue;
            }
            for &layout in views[*view as usize].members.iter().chain([view]).filter(|&&layout| !is_instance(layout)) {
                may_inherit[layout as usize] = true;
            }
        }
        for (view, function, stores, traits) in &self.constructors {
            let this = &views[*view as usize];
            let is_on_every_instance = |name: &&Atom| this.members.iter().all(|&layout| facts[layout as usize].declared.binary_search(&name.0).is_ok());
            let is_general = this.members.iter().any(|&layout| may_inherit[layout as usize]);
            let stores = if is_general { &[][..] } else { &stores[..stores.iter().take_while(is_on_every_instance).count()] };
            let is_expected_to_receive = |layout: &&u32| receives(*view, *function, *traits, **layout);
            for &layout in this.members.iter().chain([view]).filter(is_expected_to_receive) {
                match &mut stored_first[layout as usize] {
                    Some(by_all) => by_all.retain(|name| stores.contains(name)),
                    none => *none = Some(stores.to_vec()),
                }
            }
        }
        let mut present: Vec<Vec<u32>> = (views.iter().zip(facts).zip(&stored_first))
            .map(|((reach, facts), stored_first)| match stored_first {
                _ if !reach.is_allocated => Vec::new(),
                _ if facts.flags & IS_INSTANCE != 0 => facts.required.to_vec(),
                _ if self.is_incomplete => Vec::new(),
                Some(by_all) => facts.required.iter().copied().filter(|&name| by_all.contains(&Atom(name))).collect(),
                None => facts.required.to_vec(),
            })
            .collect();
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
                    let has_single_kind = is_instance(from as u32) == is_instance(to);
                    let both: Vec<u32> = present[from].iter().copied().filter(|name| has_single_kind && present[to as usize].binary_search(name).is_ok()).collect();
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
            reach.never_observed_absent = names.into_iter().map(Atom).collect();
        }
    }
}

const OBJECT_PROTOTYPE_KEYS: [&[u8]; 12] = [
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

#[derive(Copy, Clone)]
pub struct FirstStore {
    pub stmt: StmtId,
    pub this: ExprId,
    pub target: ExprId,
    pub name: Atom,
    pub value: ExprId,
}

impl<'p, 's> Checker<'p, 's> {
    pub fn record_constructor_function(&mut self, views: &[TypeId], file: FileId, func: FnId, stores: &[FirstStore]) {
        let stores: Vec<Atom> = stores.iter().map(|store| store.name).collect();
        let traits = if self.has_mutable_prototype(file, func) { HAS_MUTABLE_PROTOTYPE } else { 0 } | if self.allocates_for_unknown_callers(file, func) { ALLOCATES_FOR_UNKNOWN_CALLERS } else { 0 };
        for &view in views {
            let view = self.layout_defining_type(view);
            self.recorded_constructions().constructors.push((view, (file, func), stores.clone(), traits));
        }
    }

    pub fn record_object_created_with_discriminant(&mut self, created: TypeId) {
        let created = self.layout_defining_type(created);
        self.recorded_constructions().created_with_discriminant.push(created);
    }

    pub fn record_object_allocated_empty(&mut self, created: TypeId, file: FileId) {
        let created = self.layout_defining_type(created);
        self.recorded_constructions().constructors.push((created, (file, FnId::NONE), Vec::new(), ALLOCATES_FOR_UNKNOWN_CALLERS));
    }

    pub fn record_object_created_by_new(&mut self, created: Option<TypeId>, file: FileId, callee: ExprId) {
        let Some(created) = created else {
            self.recorded_constructions().is_incomplete = true;
            return;
        };
        let (created, expected) = (self.layout_defining_type(created), self.function_for_value_expr(file, callee));
        self.recorded_constructions().created_by_new.push((created, expected));
    }

    pub fn first_stores_for(&mut self, file: FileId, func: FnId) -> Vec<FirstStore> {
        let mut stores = self.syntactic_first_stores(file, func);
        let mut count = self.count_first_stores_to_fields(file, func, &stores);
        while count > 0 && count < stores.len() && stores[count].stmt == stores[count - 1].stmt {
            count -= 1;
        }
        stores.truncate(count);
        stores
    }

    pub(super) fn explain_first_stores_cut_by_prototype_names(&mut self) -> (usize, usize) {
        let listed = self.prototype_property_names();
        let all = self.constructor_functions();
        let mut ended = 0;
        for &(file, func) in &all {
            let hir = self.hir(file);
            let FnBody::Block(body) = hir[func].body else { continue };
            if self.has_mutable_prototype(file, func) {
                continue;
            }
            let last = self.syntactic_first_stores(file, func).last().map(|store| store.stmt);
            let next = hir.ids(body).skip_while(|&stmt| last.is_some_and(|last| stmt != last)).nth(last.is_some() as usize);
            let Some(StmtKind::Expr(mut e)) = next.map(|stmt| hir[stmt].kind) else { continue };
            while let ExprKind::Assign { op: None, target, value } = hir[e].kind {
                if matches!(hir[target].kind, ExprKind::Dot { name, .. } if listed.contains(&FieldKey::Name(name))) {
                    ended += 1;
                    break;
                }
                e = value;
            }
        }
        (ended, all.len())
    }

    pub(super) fn syntactic_first_stores(&mut self, file: FileId, func: FnId) -> Vec<FirstStore> {
        let hir = self.hir(file);
        let mut stores: Vec<FirstStore> = Vec::new();
        let has_plain_parameters = hir[func].params.iter().all(|p| hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST) && matches!(hir[hir[p].pat].kind, PatKind::Ident(_)));
        let FnBody::Block(body) = hir[func].body else { return stores };
        if !self.allocates_for_unknown_callers(file, func) {
            return stores;
        }
        if !has_plain_parameters || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) || self.has_mutable_prototype(file, func) {
            return stores;
        }
        let on_prototypes = self.prototype_property_names();
        let blocks_first_stores = self.has_no_field_names_on_prototype(file, func);
        for stmt in hir.ids(body) {
            let StmtKind::Expr(e) = hir[stmt].kind else { break };
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
            if targets.is_empty() || !(self.is_parameter_ref_of(file, func, value) || self.is_plain_nullish(file, value) || self.is_enum_constant(file, value) || evaluates_to_primitive) {
                break;
            }
            let before = stores.len();
            for &target in targets.iter().rev() {
                let (obj, name) = match hir[target].kind {
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } => (obj, name),
                    ExprKind::Index { obj, index, chain: Chain::No } => match self.property_named_by_constant_symbol(file, index) {
                        Some(name) => (obj, name),
                        None => break,
                    },
                    _ => break,
                };
                let this = self.this_cast_to_any(file, obj).unwrap_or(obj);
                let is_inherited = (!blocks_first_stores && on_prototypes.contains(&self.field_key_of_property(name))) || OBJECT_PROTOTYPE_KEYS.contains(&self.atoms().bytes(name));
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

    pub fn allocates_for_unknown_callers(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnBody::Block(body) = hir[func].body else { return false };
        let first = hir.ids(body).find(|&stmt| !matches!(hir[stmt].kind, StmtKind::Expr(e) if matches!(hir[e].kind, ExprKind::String(_))));
        let Some(StmtKind::Expr(first)) = first.map(|stmt| hir[stmt].kind) else { return false };
        let ExprKind::Assign { op: None, target, .. } = hir[first].kind else { return false };
        let ExprKind::Dot { obj, chain: Chain::No, .. } = hir[target].kind else { return false };
        if !matches!(hir[self.this_cast_to_any(file, obj).unwrap_or(obj)].kind, ExprKind::This) {
            return false;
        }
        !self.file_exprs_by_kind(file).of(ExprTag::Fn).iter().any(|&e| {
            matches!(hir[e].kind, ExprKind::Fn(written) if written == func)
                && match bound.expr_parent[e.idx()] {
                    Parent::Prop(_) => true,
                    Parent::Expr(parent) => matches!(hir[parent].kind, ExprKind::Assign { op: None, target, value } if value == e && matches!(hir[target].kind, ExprKind::Dot { .. } | ExprKind::Index { .. })),
                    _ => false,
                }
        })
    }

    fn is_enum_constant(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[e].kind else { return false };
        let ExprKind::Ident(written) = hir[obj].kind else { return false };
        let Some(declared) = self.resolved_symbol_for(file, obj, written).filter(|&declared| self.files().flags(declared).intersects(SymFlags::ENUM)) else { return false };
        let Some(member) = self.files().export(declared, name) else { return false };
        matches!(self.files().value_declaration(member), Some((of, Decl::EnumMember(member))) if self.enum_member_value(of, member).is_some() && !self.is_enum_member_read_from_object(file, of, member))
    }

    pub fn is_plain_nullish(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::NonNull(operand) = hir[e].kind else { return false };
        match hir[operand].kind {
            ExprKind::Null => true,
            ExprKind::Ident(name) => self.bound(file).expr_symbol[operand.idx()].is_none() && self.atoms().bytes(name) == b"undefined",
            _ => false,
        }
    }

    pub fn is_syntactically_nullish(&self, file: FileId, mut e: ExprId) -> bool {
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

    fn is_parameter_ref_of(&self, file: FileId, func: FnId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = bound.expr_symbol[e.idx()];
        matches!(hir[e].kind, ExprKind::Ident(_)) && symbol.is_some() && hir[func].params.iter().any(|p| bound.pat_symbol[hir[p].pat.idx()] == symbol)
    }
}

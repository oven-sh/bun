//! Which fields an object gets right after its allocation.
//!
//! A prediction, for field placement: it decides whether a field is kept inline or out of line, never what the program does.
//!
//! An expression is FRESH if it yields an object that was allocated while it was evaluated and that nothing else refers to: `new C(..)`, an
//! object literal, a call of a factory, any of them under `as`, `!` or `satisfies`. A FACTORY is a function all of whose `return`s yield a
//! fresh expression or a local that is never reassigned and initialized by one. `a[i] || (a[i] = new C())` is not fresh: a getter is no
//! factory.
//!
//! A fresh object is followed from its allocation: through the constructor, through the statements after `const v = <fresh>` or
//! `v = <fresh>` in the same block, and out of a factory into its callers. It is followed as long as it is in a local. Where that ends is a
//! CREATION POINT of every static type that the object has had on the way. A field is set at creation if `this.f = e` or `v.f = e` is
//! on the way, on every path if it is under no condition, loop or `try`. A fresh object that is stored to a field on every path,
//! `v.g = <fresh>`, is followed with its holder: `v.g.f = e`.
//!
//! Where no creation point of a layout is seen, `new (C as any)()`, its constructor alone stands in for them.

use super::flows::Reach;
use crate::atom::Atom;
use crate::bind::{Decl, Parent, PatParent, SymbolId};
use crate::check::Checker;
use crate::hir::{Chain, ClassId, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, FnKind, MemberKind, PatKind, PropKey, PropKind, StmtId, StmtKind, VarDeclId};
use crate::program::FileId;
use crate::types::TypeId;
use crate::util::{FxHashMap, FxHashSet};
use std::hash::Hash;
use std::rc::Rc;

/// What has been noted of creation points. `T`: what a type is called by. The types are `laid_out_as`.
pub(crate) struct Creations<T = TypeId> {
    /// By layout, and whether it is the constructor that stands in: the number of creation points.
    points: FxHashMap<(T, bool), u32>,
    /// By field of such a layout: at how many of them it is set on every path. An entry with 0: at some, on some path.
    set: FxHashMap<(T, bool, Atom), u32>,
}

impl<T> Default for Creations<T> {
    fn default() -> Creations<T> {
        Creations { points: FxHashMap::default(), set: FxHashMap::default() }
    }
}

impl<T: Copy + Eq + Hash> Creations<T> {
    pub(super) fn absorb(&mut self, other: Creations<T>) {
        for (layout, count) in other.points {
            *self.points.entry(layout).or_default() += count;
        }
        for (field, count) in other.set {
            *self.set.entry(field).or_default() += count;
        }
    }

    /// What `rename` has no name for is left out.
    pub(super) fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Creations<U> {
        let mut renamed = Creations::default();
        for ((layout, by_constructor), count) in self.points {
            if let Some(layout) = rename(layout) {
                *renamed.points.entry((layout, by_constructor)).or_default() += count;
            }
        }
        for ((layout, by_constructor, name), count) in self.set {
            if let Some(layout) = rename(layout) {
                *renamed.set.entry((layout, by_constructor, name)).or_default() += count;
            }
        }
        renamed
    }
}

impl Creations<TypeId> {
    /// In no order: `CreationsByView::apply` sorts.
    pub(super) fn by_view(&self, index_of: &FxHashMap<TypeId, u32>) -> CreationsByView {
        CreationsByView {
            points: self.points.iter().filter_map(|(&(layout, by_constructor), &count)| Some((*index_of.get(&layout)?, by_constructor, count))).collect(),
            set: self.set.iter().filter_map(|(&(layout, by_constructor, name), &count)| Some((*index_of.get(&layout)?, by_constructor, name, count))).collect(),
        }
    }
}

/// `Creations`, with the index of a view in the place of its type.
pub(crate) struct CreationsByView {
    points: Vec<(u32, bool, u32)>,
    set: Vec<(u32, bool, Atom, u32)>,
}

impl CreationsByView {
    /// `views`: a row for each view. A type that is frozen and no view is numbered after them. It has no layout, so nothing is kept of it.
    pub(super) fn apply(self, views: &mut [Reach]) {
        let number_of_views = views.len() as u32;
        let mut points = vec![[0u32; 2]; views.len()];
        for (view, by_constructor, count) in self.points.into_iter().filter(|of| of.0 < number_of_views) {
            points[view as usize][usize::from(by_constructor)] = count;
        }
        for (view, by_constructor, name, on_every_path) in self.set.into_iter().filter(|of| of.0 < number_of_views) {
            let of_view = points[view as usize];
            if by_constructor == (of_view[0] == 0) {
                views[view as usize].set_at_creation.push((name, on_every_path == of_view[usize::from(by_constructor)]));
            }
        }
        for reach in views.iter_mut() {
            reach.set_at_creation.sort_unstable_by_key(|field| field.0.0);
        }
    }
}

/// An object since its allocation.
#[derive(Clone, Default)]
struct Fresh {
    /// `laid_out_as` of the static types it has had.
    types: Vec<TypeId>,
    /// The fields that are set on every path, and those that are set on some path only.
    always: Vec<Atom>,
    sometimes: Vec<Atom>,
    /// By field: the fresh object that is stored there on every path.
    parts: Vec<(Atom, Fresh)>,
}

impl Fresh {
    fn set(&mut self, name: Atom, is_on_every_path: bool) {
        if self.always.contains(&name) {
            return;
        }
        if is_on_every_path {
            self.sometimes.retain(|&other| other != name);
            self.always.push(name);
        } else if !self.sometimes.contains(&name) {
            self.sometimes.push(name);
        }
    }

    /// Adds what the constructor `other` does to the same object.
    fn extend(&mut self, other: &Fresh) {
        for &name in &other.always {
            self.set(name, true);
        }
        for &name in &other.sometimes {
            self.set(name, false);
        }
        for part in &other.parts {
            self.parts.retain(|own| own.0 != part.0);
            self.parts.push(part.clone());
        }
    }

    /// What holds whichever of the two the object is.
    fn either(self, mut other: Fresh) -> Fresh {
        let mut both = Fresh { types: self.types, ..Fresh::default() };
        for ty in other.types {
            if !both.types.contains(&ty) {
                both.types.push(ty);
            }
        }
        for &name in &self.always {
            both.set(name, other.always.contains(&name));
        }
        for &name in other.always.iter().chain(&self.sometimes).chain(&other.sometimes) {
            both.set(name, false);
        }
        for (name, part) in self.parts {
            if let Some(at) = other.parts.iter().position(|of_other| of_other.0 == name) {
                both.parts.push((name, part.either(other.parts.swap_remove(at).1)));
            }
        }
        both
    }
}

/// The object that stores are looked for.
#[derive(Copy, Clone)]
enum Root {
    This,
    Local(SymbolId),
}

/// A creation point that a function contributes.
struct Point {
    ty: TypeId,
    by_constructor: bool,
    always: Vec<Atom>,
    sometimes: Vec<Atom>,
}

#[derive(Default)]
pub(super) struct State {
    /// By function: what it returns, if it is a factory.
    returned: FxHashMap<(FileId, FnId), Option<Rc<Fresh>>>,
    /// By constructor or constructor function: what it does to `this`.
    stored_to_this: FxHashMap<(FileId, FnId), Rc<Fresh>>,
    /// By class: what `new` does to the object, with the field initializers and the classes it extends.
    constructed: FxHashMap<(FileId, ClassId), Rc<Fresh>>,
    functions_in_progress: Vec<(FileId, FnId)>,
    classes_in_progress: Vec<(FileId, ClassId)>,
    /// By file: the notes of its functions, sorted by function. `NONE`: the top level.
    notes: FxHashMap<FileId, Rc<Vec<(FnId, Point)>>>,
}

/// The expression without `as`, `!` and `satisfies` around it.
fn unwrapped(hir: &File, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } = hir[e].kind {
        e = expr;
    }
    e
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what is noted ─────────────────────────────

    /// Notes the creation points and the allocation sites in the body of the function, nested functions aside. `NONE`: in the top level
    /// of the file.
    pub fn note_creations_in(&mut self, file: FileId, func: FnId) {
        let notes = self.creation_notes_of(file);
        let from = notes.partition_point(|note| note.0.0 < func.0);
        for (_, note) in notes[from..].iter().take_while(|note| note.0 == func) {
            self.add_creation_note(note);
        }
    }

    /// Notes what the constructor of the class does, declared or not, for a layout without creation points.
    pub fn note_construction_of(&mut self, file: FileId, class: ClassId) {
        let mut fresh = (*self.constructed_by_class(file, class)).clone();
        let instances = self.type_of_instances(file, class);
        fresh.types.push(instances);
        let mut notes = Vec::new();
        add_points(&fresh, true, FnId::NONE, &mut notes);
        for (_, note) in &notes {
            self.add_creation_note(note);
        }
    }

    fn add_creation_note(&mut self, point: &Point) {
        let noted = self.noted_creations();
        *noted.points.entry((point.ty, point.by_constructor)).or_default() += 1;
        for &name in &point.always {
            *noted.set.entry((point.ty, point.by_constructor, name)).or_default() += 1;
        }
        for &name in &point.sometimes {
            noted.set.entry((point.ty, point.by_constructor, name)).or_default();
        }
    }

    fn creation_notes_of(&mut self, file: FileId) -> Rc<Vec<(FnId, Point)>> {
        if let Some(known) = self.aot.creation.notes.get(&file) {
            return known.clone();
        }
        let mut notes = self.find_creation_notes_of(file);
        notes.sort_by_key(|note| note.0.0);
        let notes = Rc::new(notes);
        self.aot.creation.notes.insert(file, notes.clone());
        notes
    }

    fn find_creation_notes_of(&mut self, file: FileId) -> Vec<(FnId, Point)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut notes = Vec::new();
        if self.is_untyped_file(file) || matches!(hir.kind, FileKind::Declaration | FileKind::Json) {
            return notes;
        }
        let index = self.exprs_by_kind_of(file);
        // The allocations and factory calls that are followed from somewhere else.
        let mut followed: FxHashSet<ExprId> = FxHashSet::default();
        for (func, f) in hir.fns.iter().enumerate() {
            let func = FnId(func as u32);
            let has_this = matches!(f.kind, FnKind::Decl | FnKind::Expr) && f.this_ty(hir).is_some();
            let FnBody::Block(body) = f.body else { continue };
            if !has_this && f.kind != FnKind::Constructor {
                continue;
            }
            let body: Vec<StmtId> = hir.ids(body).collect();
            let mut fresh = Fresh::default();
            self.follow(file, &body, Root::This, true, &mut fresh, &mut followed);
            if has_this {
                let this = self.type_of_this_parameter(file, func);
                self.add_static_type(&mut fresh, this);
                add_points(&fresh, true, func, &mut notes);
            }
        }
        for (d, declaration) in hir.var_decls.iter().enumerate() {
            let d = VarDeclId(d as u32);
            if declaration.init.is_none() || !matches!(hir[unwrapped(hir, declaration.init)].kind, ExprKind::New(_) | ExprKind::Object(_) | ExprKind::Call(_)) {
                continue;
            }
            let Some(fresh) = self.fresh_in_local(file, d, &mut followed) else { continue };
            let func = self.enclosing_fn(file, Parent::VarInit(d)).unwrap_or(FnId::NONE);
            let symbol = bound.pat_symbol[declaration.pat.idx()];
            if func.is_none() || !self.is_returned_by_factory(file, func, symbol) {
                add_points(&fresh, false, func, &mut notes);
            }
        }
        for &e in index.of(ExprTag::Assign) {
            let ExprKind::Assign { op: None, target, value } = hir[e].kind else { continue };
            let (ExprKind::Ident(_), Parent::Stmt(stmt)) = (hir[target].kind, bound.expr_parent[e.idx()]) else { continue };
            if stmt.is_none() || !matches!(hir[stmt].kind, StmtKind::Expr(_)) {
                continue;
            }
            let Some(mut fresh) = self.fresh_from(file, value) else { continue };
            followed.insert(unwrapped(hir, value));
            let rest = self.statements_after(file, stmt);
            self.follow(file, &rest, Root::Local(bound.expr_symbol[target.idx()]), true, &mut fresh, &mut followed);
            add_points(&fresh, false, self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE), &mut notes);
        }
        for tag in [ExprTag::New, ExprTag::Object, ExprTag::Call] {
            for &e in index.of(tag) {
                if bound.expr_parent[e.idx()] == Parent::None {
                    continue;
                }
                let func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
                if followed.contains(&e) {
                    continue;
                }
                let mut outer = e;
                while let Parent::Expr(parent) = bound.expr_parent[outer.idx()]
                    && parent.is_some()
                    && matches!(hir[parent].kind, ExprKind::As { .. } | ExprKind::NonNull(_) | ExprKind::Satisfies { .. })
                {
                    outer = parent;
                }
                let goes_on = match bound.expr_parent[outer.idx()] {
                    // It is followed with the literal, with the object of the class.
                    Parent::Prop(prop) => hir[prop].kind == PropKind::Init && bound.prop_owner[prop.idx()].is_some() && matches!(hir[bound.prop_owner[prop.idx()]].kind, ExprKind::Object(_)),
                    Parent::MemberInit(_) => true,
                    Parent::FnBody(_) => func.is_some() && self.returned_by(file, func).is_some(),
                    Parent::Stmt(stmt) => stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Return(_)) && func.is_some() && self.returned_by(file, func).is_some(),
                    _ => false,
                };
                if !goes_on && let Some(fresh) = self.fresh_from(file, outer) {
                    add_points(&fresh, false, func, &mut notes);
                }
            }
        }
        notes
    }

    // ───────────────────────────── fresh expressions ─────────────────────────────

    /// `laid_out_as` of the type, if it says which properties its objects have.
    pub(super) fn layout_type_of(&mut self, ty: TypeId) -> Option<TypeId> {
        let ty = self.non_nullable(ty);
        if self.says_nothing(ty) || self.is_union(ty) || !self.says_properties(ty) {
            return None;
        }
        Some(self.laid_out_as(ty))
    }

    fn add_static_type(&mut self, fresh: &mut Fresh, ty: TypeId) {
        if let Some(ty) = self.layout_type_of(ty)
            && !fresh.types.contains(&ty)
        {
            fresh.types.push(ty);
        }
    }

    /// The object that the expression yields, if it is fresh.
    fn fresh_from(&mut self, file: FileId, e: ExprId) -> Option<Fresh> {
        if self.is_half_of_stack_in_use() {
            return None;
        }
        let hir = self.hir(file);
        let mut fresh = match hir[e].kind {
            ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } => return self.fresh_from(file, expr),
            ExprKind::As { expr, .. } => self.fresh_from(file, expr)?,
            ExprKind::Object(props) => {
                let mut fresh = Fresh::default();
                for p in props.iter() {
                    let PropKey::Name(name) = hir[p].key else { continue };
                    if hir[p].kind == PropKind::Spread {
                        continue;
                    }
                    fresh.set(name, true);
                    if hir[p].kind == PropKind::Init
                        && let Some(part) = self.fresh_from(file, hir[p].value)
                    {
                        fresh.parts.push((name, part));
                    }
                }
                fresh
            }
            ExprKind::New(_) => self.constructed_by(file, e),
            ExprKind::Call(call) if hir[call].chain == Chain::No => {
                let sig = self.resolved_signature(file, e).sig?;
                let (of, func, _) = self.sig_decl(sig)?;
                (*self.returned_by(of, func)?).clone()
            }
            _ => return None,
        };
        let ty = self.type_of_expr(file, e);
        self.add_static_type(&mut fresh, ty);
        Some(fresh)
    }

    /// What `new` has done to the object when the expression `e` yields it.
    fn constructed_by(&mut self, file: FileId, e: ExprId) -> Fresh {
        let made = self.type_of_expr(file, e);
        let made = self.non_nullable(made);
        if let Some((of, class)) = self.class_of_type(made, false) {
            return (*self.constructed_by_class(of, class)).clone();
        }
        if self.says_nothing(made) {
            return Fresh::default();
        }
        // Which function is called is not known. It declares a `this` that the object is of.
        let mut found: Option<Fresh> = None;
        for (of, func) in self.constructor_functions() {
            if !self.may_construct((of, func), made) {
                continue;
            }
            let stored = (*self.stored_to_this_by(of, func)).clone();
            found = Some(match found {
                Some(so_far) => so_far.either(stored),
                None => stored,
            });
        }
        found.unwrap_or_default()
    }

    fn constructed_by_class(&mut self, file: FileId, class: ClassId) -> Rc<Fresh> {
        if let Some(known) = self.aot.creation.constructed.get(&(file, class)) {
            return known.clone();
        }
        // A class that constructs itself while it is constructed.
        if self.aot.creation.classes_in_progress.contains(&(file, class)) {
            return Rc::default();
        }
        self.aot.creation.classes_in_progress.push((file, class));
        let hir = self.hir(file);
        let mut fresh = Fresh::default();
        if hir[class].extends.is_some() {
            let extended = self.type_of_expr(file, hir[class].extends);
            if let Some((of, extended)) = self.class_of_type(extended, true) {
                fresh = (*self.constructed_by_class(of, extended)).clone();
            }
        }
        for m in hir[class].members.iter() {
            let member = &hir[m];
            let PropKey::Name(name) = member.key else { continue };
            if member.kind != MemberKind::Property || member.flags.contains(Flags::STATIC) || member.init.is_none() {
                continue;
            }
            fresh.set(name, true);
            fresh.parts.retain(|part| part.0 != name);
            if let Some(part) = self.fresh_from(file, member.init) {
                fresh.parts.push((name, part));
            }
        }
        if let Some(constructor) = self.constructor_of_class(file, class) {
            for p in hir[constructor].params.iter() {
                if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                    && let PatKind::Ident(name) = hir[hir[p].pat].kind
                {
                    fresh.set(name, true);
                }
            }
            let stored = self.stored_to_this_by(file, constructor);
            fresh.extend(&stored);
        }
        self.aot.creation.classes_in_progress.pop();
        let fresh = Rc::new(fresh);
        self.aot.creation.constructed.insert((file, class), fresh.clone());
        fresh
    }

    /// What the body of a constructor or a constructor function does to `this`.
    fn stored_to_this_by(&mut self, file: FileId, func: FnId) -> Rc<Fresh> {
        if let Some(known) = self.aot.creation.stored_to_this.get(&(file, func)) {
            return known.clone();
        }
        if self.aot.creation.functions_in_progress.contains(&(file, func)) {
            return Rc::default();
        }
        self.aot.creation.functions_in_progress.push((file, func));
        let hir = self.hir(file);
        let mut fresh = Fresh::default();
        if let FnBody::Block(body) = hir[func].body {
            let body: Vec<StmtId> = hir.ids(body).collect();
            self.follow(file, &body, Root::This, true, &mut fresh, &mut FxHashSet::default());
        }
        self.aot.creation.functions_in_progress.pop();
        let fresh = Rc::new(fresh);
        self.aot.creation.stored_to_this.insert((file, func), fresh.clone());
        fresh
    }

    // ───────────────────────────── factories ─────────────────────────────

    /// What a call of the function yields, if it is a factory. A function that returns what it yields itself is none.
    fn returned_by(&mut self, file: FileId, func: FnId) -> Option<Rc<Fresh>> {
        if let Some(known) = self.aot.creation.returned.get(&(file, func)) {
            return known.clone();
        }
        if self.aot.creation.functions_in_progress.contains(&(file, func)) {
            return None;
        }
        self.aot.creation.functions_in_progress.push((file, func));
        let found = self.find_returned_by(file, func).map(Rc::new);
        self.aot.creation.functions_in_progress.pop();
        self.aot.creation.returned.insert((file, func), found.clone());
        found
    }

    /// The values of the `return`s. `NONE` for one without a value.
    fn values_returned_by(&self, file: FileId, func: FnId) -> Vec<ExprId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[func].body {
            FnBody::None => Vec::new(),
            FnBody::Expr(value) => vec![value],
            FnBody::Block(_) => (bound.ids(bound.fns[func.idx()].returns))
                .map(|stmt| match hir[stmt].kind {
                    StmtKind::Return(value) => value,
                    _ => ExprId::NONE,
                })
                .collect(),
        }
    }

    fn find_returned_by(&mut self, file: FileId, func: FnId) -> Option<Fresh> {
        let hir = self.hir(file);
        if self.is_untyped_file(file) || hir.kind == FileKind::Declaration || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return None;
        }
        let mut found: Option<Fresh> = None;
        for value in self.values_returned_by(file, func) {
            if value.is_none() {
                return None;
            }
            let fresh = self.fresh_returned(file, func, value)?;
            found = Some(match found {
                Some(so_far) => so_far.either(fresh),
                None => fresh,
            });
        }
        found
    }

    fn fresh_returned(&mut self, file: FileId, func: FnId, value: ExprId) -> Option<Fresh> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[value].kind {
            ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. } => self.fresh_returned(file, func, expr),
            ExprKind::As { expr, .. } => {
                let mut fresh = self.fresh_returned(file, func, expr)?;
                let ty = self.type_of_expr(file, value);
                self.add_static_type(&mut fresh, ty);
                Some(fresh)
            }
            ExprKind::Ident(_) => {
                let symbol = bound.expr_symbol[value.idx()];
                let &Decl::Var(pat) = bound.symbols.get(symbol.idx())?.decls.iter().next()? else { return None };
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
                let is_never_reassigned = bound.assignments_to(symbol).is_empty() && !self.is_stored_through_casts(file, symbol);
                if !is_never_reassigned || self.enclosing_fn(file, Parent::VarInit(d)) != Some(func) {
                    return None;
                }
                self.fresh_in_local(file, d, &mut FxHashSet::default())
            }
            _ => self.fresh_from(file, value),
        }
    }

    /// Whether the function is a factory and the local is what one of its `return`s yields: the object is followed in the callers.
    fn is_returned_by_factory(&mut self, file: FileId, func: FnId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_returned = self.values_returned_by(file, func).into_iter().any(|value| {
            let value = if value.is_some() { unwrapped(hir, value) } else { value };
            value.is_some() && matches!(hir[value].kind, ExprKind::Ident(_)) && bound.expr_symbol[value.idx()] == symbol
        });
        is_returned && self.returned_by(file, func).is_some()
    }

    // ───────────────────────────── following an object ─────────────────────────────

    /// `const v = <fresh>`: the object at the end of the block. `None`: the initializer is not fresh, or a pattern takes it apart.
    fn fresh_in_local(&mut self, file: FileId, d: VarDeclId, followed: &mut FxHashSet<ExprId>) -> Option<Fresh> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let declaration = &hir[d];
        if declaration.init.is_none() || !matches!(hir[declaration.pat].kind, PatKind::Ident(_)) {
            return None;
        }
        let mut fresh = self.fresh_from(file, declaration.init)?;
        followed.insert(unwrapped(hir, declaration.init));
        let symbol = bound.pat_symbol[declaration.pat.idx()];
        let declared = self.type_of_symbol(self.files().sym(file, symbol));
        self.add_static_type(&mut fresh, declared);
        let stmt = bound.var_stmt[d.idx()];
        if stmt.is_some() {
            let rest = self.statements_after(file, stmt);
            self.follow(file, &rest, Root::Local(symbol), true, &mut fresh, followed);
        }
        Some(fresh)
    }

    /// The statements that come after the statement in its block.
    fn statements_after(&self, file: FileId, stmt: StmtId) -> Vec<StmtId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let block = match bound.stmt_parent[stmt.idx()] {
            Parent::FnBody(func) => match hir[func].body {
                FnBody::Block(block) => block,
                _ => return Vec::new(),
            },
            Parent::Stmt(parent) if parent.is_some() => match hir[parent].kind {
                StmtKind::Block(block) => block,
                _ => return Vec::new(),
            },
            Parent::File => hir.body,
            _ => return Vec::new(),
        };
        hir.ids(block).skip_while(|&other| other != stmt).skip(1).collect()
    }

    /// Adds what the statements store to the object. Nested functions are not entered. `false`: the object is not followed any further,
    /// the local is reassigned or control leaves.
    fn follow(&mut self, file: FileId, stmts: &[StmtId], root: Root, is_on_every_path: bool, fresh: &mut Fresh, followed: &mut FxHashSet<ExprId>) -> bool {
        let hir = self.hir(file);
        for &stmt in stmts {
            let nested: [StmtId; 3] = match hir[stmt].kind {
                StmtKind::Expr(e) => {
                    if !self.follow_store(file, e, root, is_on_every_path, fresh, followed) {
                        return false;
                    }
                    continue;
                }
                StmtKind::Block(block) => {
                    let block: Vec<StmtId> = hir.ids(block).collect();
                    if !self.follow(file, &block, root, is_on_every_path, fresh, followed) {
                        return false;
                    }
                    continue;
                }
                StmtKind::Return(_) | StmtKind::Throw(_) if is_on_every_path => return false,
                StmtKind::If { yes, no, .. } => [yes, no, StmtId::NONE],
                StmtKind::For { body, .. } | StmtKind::ForIn { body, .. } | StmtKind::ForOf { body, .. } | StmtKind::While { body, .. } | StmtKind::DoWhile { body, .. } | StmtKind::Labeled { body, .. } => {
                    [body, StmtId::NONE, StmtId::NONE]
                }
                StmtKind::Try { block, handler, finalizer, .. } => [block, handler, finalizer],
                _ => continue,
            };
            for part in nested.into_iter().filter(|part| part.is_some()) {
                if !self.follow(file, &[part], root, false, fresh, followed) {
                    return false;
                }
            }
        }
        true
    }

    fn is_root(&self, file: FileId, e: ExprId, root: Root) -> bool {
        match (self.hir(file)[e].kind, root) {
            (ExprKind::This, Root::This) => true,
            (ExprKind::Ident(_), Root::Local(symbol)) => self.bound(file).expr_symbol[e.idx()] == symbol,
            _ => false,
        }
    }

    /// An expression statement. `false`: it reassigns the local.
    fn follow_store(&mut self, file: FileId, e: ExprId, root: Root, is_on_every_path: bool, fresh: &mut Fresh, followed: &mut FxHashSet<ExprId>) -> bool {
        let hir = self.hir(file);
        let ExprKind::Assign { op, target, value } = hir[e].kind else { return true };
        let target = unwrapped(hir, target);
        if matches!(hir[target].kind, ExprKind::Ident(_)) {
            return !self.is_root(file, target, root);
        }
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[target].kind else { return true };
        let obj = unwrapped(hir, obj);
        if self.is_root(file, obj, root) {
            fresh.set(name, is_on_every_path);
            fresh.parts.retain(|part| part.0 != name);
            if op.is_none()
                && is_on_every_path
                && let Some(part) = self.fresh_from(file, value)
            {
                followed.insert(unwrapped(hir, value));
                fresh.parts.push((name, part));
            }
        } else if let ExprKind::Dot { obj: holder, name: held_in, chain: Chain::No, .. } = hir[obj].kind
            && self.is_root(file, unwrapped(hir, holder), root)
            && let Some(part) = fresh.parts.iter_mut().find(|part| part.0 == held_in)
        {
            part.1.set(name, is_on_every_path);
        }
        true
    }
}

/// A creation point of every static type that the object has had, and of the fresh objects in its fields.
fn add_points(fresh: &Fresh, by_constructor: bool, func: FnId, notes: &mut Vec<(FnId, Point)>) {
    for &ty in &fresh.types {
        notes.push((func, Point { ty, by_constructor, always: fresh.always.clone(), sometimes: fresh.sometimes.clone() }));
    }
    for (_, part) in &fresh.parts {
        add_points(part, by_constructor, func, notes);
    }
}

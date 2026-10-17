//! Fields of a layout for properties that its type does not declare.
//!
//! ```ts
//! function Symbol(this: Symbol, flags: SymbolFlags, name: __String) {
//!     this.flags = flags;
//!     this.escapedName = name;
//!     ..
//!     (this as any).links = undefined; // used by TransientSymbol
//! }
//! ```
//!
//! Every object that the function constructs has the property. `Symbol` does not declare it. `TransientSymbol extends Symbol` does. Without a
//! field for it the store makes each `Symbol` something else than it was allocated as.
//!
//! So where a constructor function stores to `(this as any).name` among its first stores (`first_stores_for`), and an interface that is
//! declared to extend the type of `this` declares `name`, the type of `this` and every type that is declared to extend it have a field for
//! the name, of the type that the interface declares, optional. The store is one of the first stores.
//!
//! It goes by the text of the program alone, of all its files that are compiled: the functions and the declarations. So every file is
//! translated with the same layouts.

use super::first_stores::FirstStore;
use super::subtypes::Facts;
use crate::atom::Atom;
use crate::check::Checker;
use crate::hir::{ExprId, ExprKind, ExprTag, FnId, FnKind, MemberKind};
use crate::program::{FileId, Sym};
use crate::types::{TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use std::rc::Rc;
use std::sync::OnceLock;

/// The type of `this`, the interface that declares the name, the name. The types are `layout_defining_type`.
type Store = (TypeId, TypeId, Atom);

#[derive(Default)]
pub(super) struct Shared {
    /// The functions with a store to `(this as ..).name`, of all the files, in their order, and in the order of the text. Syntax only.
    storing_through_assertions: OnceLock<Vec<(FileId, FnId)>>,
    typed_files: OnceLock<Vec<FileId>>,
}

#[derive(Default)]
pub(super) struct State {
    /// Of all the files, in their order, and in the order of the text.
    stores: Option<Rc<Vec<Store>>>,
    /// `Checker::undeclared_fields_for`
    fields: FxHashMap<TypeId, Rc<Vec<(Atom, TypeId)>>>,
}

impl<'p, 's> Checker<'p, 's> {
    /// The properties that the layout of the type has a field for besides those of the type, each with the interface that declares it.
    /// They are optional there, whatever they are in the interface. In the order of the names. `ty`: `layout_defining_type`.
    pub fn undeclared_fields_for(&mut self, ty: TypeId) -> Rc<Vec<(Atom, TypeId)>> {
        if let Some(known) = self.aot.undeclared_fields.fields.get(&ty) {
            return known.clone();
        }
        let stores = self.constructor_stores_through_any();
        let mut found: Vec<(Atom, TypeId)> = Vec::new();
        if !stores.is_empty() && !self.is_instance_type(ty) {
            let mut extended = FxHashSet::default();
            self.add_base_types(ty, &mut extended);
            let own: FxHashSet<Atom> = self.members(ty).map_or_else(Default::default, |members| members.shape().props.iter().map(|prop| prop.name).collect());
            for &(constructed, declaring, name) in stores.iter() {
                if extended.contains(&constructed) && !own.contains(&name) && found.iter().all(|field| field.0 != name) {
                    found.push((name, declaring));
                }
            }
            found.sort_by(|a, b| self.atoms().bytes(a.0).cmp(self.atoms().bytes(b.0)));
        }
        let found = Rc::new(found);
        self.aot.undeclared_fields.fields.insert(ty, found.clone());
        found
    }

    /// What is compared of the type before the relation is asked goes by the layout. `stored`: see `begin_subtypes`.
    pub(super) fn add_undeclared_fields_to(&mut self, facts: &mut Facts, ty: TypeId, stored: &FxHashSet<Atom>) {
        let fields = self.undeclared_fields_for(ty);
        if fields.is_empty() {
            return;
        }
        let with = |names: &[u32], more: &mut dyn Iterator<Item = u32>| -> Box<[u32]> {
            let mut all: Vec<u32> = names.iter().copied().chain(more).collect();
            all.sort_unstable();
            all.dedup();
            all.into_boxed_slice()
        };
        facts.declared = with(&facts.declared, &mut fields.iter().map(|field| field.0.0));
        facts.live = with(&facts.live, &mut fields.iter().filter(|field| stored.contains(&field.0)).map(|field| field.0.0));
    }

    /// `(this as any)`: the `this`.
    pub(super) fn this_cast_to_any(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::As { expr, .. } = hir[e].kind else { return None };
        (matches!(hir[expr].kind, ExprKind::This) && self.type_of_expr(file, e) == TypeId::ANY).then_some(expr)
    }

    /// How many of the stores, which are `syntactic_first_stores` the function, go to a field: up to the first through `any` that does not.
    pub(super) fn count_first_stores_to_fields(&mut self, file: FileId, func: FnId, stores: &[FirstStore]) -> usize {
        let hir = self.hir(file);
        let is_through_any = |store: &FirstStore| matches!(hir[store.target].kind, ExprKind::Dot { obj, .. } if obj != store.this);
        if !stores.iter().any(is_through_any) {
            return stores.len();
        }
        let fields = match self.constructor_function_this_type(file, func) {
            Some(constructed) => self.undeclared_fields_for(constructed),
            None => Default::default(),
        };
        stores.iter().position(|store| is_through_any(store) && fields.iter().all(|field| field.0 != store.name)).unwrap_or(stores.len())
    }

    /// `function F(this: T, ..)`: `T`, `layout_defining_type`.
    fn constructor_function_this_type(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let hir = self.hir(file);
        if !matches!(hir[func].kind, FnKind::Decl | FnKind::Expr) || hir[func].this_param.is_none() {
            return None;
        }
        let this = self.this_type_in_fn(file, func)?;
        self.layout_type_of(this)
    }

    /// The type and what it is declared to extend, all the way up. All `layout_defining_type`.
    fn add_base_types(&mut self, ty: TypeId, out: &mut FxHashSet<TypeId>) {
        let layout_types_cache = self.layout_defining_type(ty);
        if !out.insert(layout_types_cache) {
            return;
        }
        let extended: Vec<TypeId> = match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_created_by_program(ty) => match self.members(ty) {
                Some(members) => self.base_types(target).into_vec().into_iter().map(|base| self.instantiate(base, members.mapper)).collect(),
                None => Vec::new(),
            },
            TypeData::Intersection(ref parts) => parts.to_vec(),
            _ => Vec::new(),
        };
        for supertype in extended {
            if self.declares_properties(supertype) {
                self.add_base_types(supertype, out);
            }
        }
    }

    fn constructor_stores_through_any(&mut self) -> Rc<Vec<Store>> {
        if let Some(known) = &self.aot.undeclared_fields.stores {
            return known.clone();
        }
        let files: &'p [FileId] = self.p.aot.undeclared_fields.typed_files.get_or_init(|| self.files_declaring_classes().into_iter().filter(|&file| self.is_compiled(file) && !self.hir(file).is_js).collect());
        let mut stores: Vec<Store> = Vec::new();
        for &(file, func) in self.functions_storing_through_assertions(files) {
            let Some(constructed) = self.constructor_function_this_type(file, func) else { continue };
            let hir = self.hir(file);
            for store in self.syntactic_first_stores(file, func) {
                if matches!(hir[store.target].kind, ExprKind::Dot { obj, .. } if obj == store.this) {
                    continue;
                }
                // What comes after a store that is none of the first is none either.
                let Some(declaring) = self.declaring_interface(files, constructed, store.name) else { break };
                stores.push((constructed, declaring, store.name));
            }
        }
        let stores = Rc::new(stores);
        self.aot.undeclared_fields.stores = Some(stores.clone());
        stores
    }

    fn functions_storing_through_assertions(&mut self, files: &[FileId]) -> &'p [(FileId, FnId)] {
        let shared = &self.p.aot.undeclared_fields.storing_through_assertions;
        shared.get_or_init(|| {
            let mut functions: Vec<(FileId, FnId)> = Vec::new();
            for &file in files {
                let hir = self.hir(file);
                for &e in self.file_exprs_by_kind(file).of(ExprTag::Assign) {
                    let ExprKind::Assign { op: None, target, .. } = hir[e].kind else { continue };
                    let ExprKind::Dot { obj, .. } = hir[target].kind else { continue };
                    if matches!(hir[obj].kind, ExprKind::As { expr, .. } if matches!(hir[expr].kind, ExprKind::This))
                        && let Some(func) = self.enclosing_fn_of_expr(file, e)
                        && !functions.contains(&(file, func))
                    {
                        functions.push((file, func));
                    }
                }
            }
            functions
        })
    }

    /// The first interface without type parameters that is declared to extend `extended` and declares the property itself. None if
    /// `extended` has the property, or if two such interfaces give it different types.
    fn declaring_interface(&mut self, files: &[FileId], extended: TypeId, name: Atom) -> Option<TypeId> {
        if self.type_of_property(extended, name).is_some() {
            return None;
        }
        let mut found: Option<(TypeId, TypeId)> = None;
        for &file in files {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for (index, interface) in hir.interfaces.iter().enumerate() {
                let declares = interface.type_params.is_empty() && interface.members.iter().any(|member| hir[member].kind == MemberKind::Property && hir[member].key.name() == Some(name));
                if !declares {
                    continue;
                }
                let declared = self.declared_type(Sym { file, id: bound.interface_symbol[index] });
                let Some(declaring) = self.layout_type_of(declared) else { continue };
                let mut supertypes = FxHashSet::default();
                self.add_base_types(declaring, &mut supertypes);
                if declaring == extended || !supertypes.contains(&extended) {
                    continue;
                }
                let Some(ty) = self.type_of_property(declaring, name) else { continue };
                match found {
                    Some((_, other)) if other != ty => return None,
                    Some(_) => {}
                    None => found = Some((declaring, ty)),
                }
            }
        }
        found.map(|(declaring, _)| declaring)
    }
}

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

type Store = (TypeId, TypeId, Atom);

#[derive(Default)]
pub(super) struct Shared {
    storing_through_assertions: OnceLock<Vec<(FileId, FnId)>>,
    typed_files: OnceLock<Vec<FileId>>,
}

#[derive(Default)]
pub(super) struct State {
    stores: Option<Rc<Vec<Store>>>,
    fields: FxHashMap<TypeId, Rc<Vec<(Atom, TypeId)>>>,
}

impl<'p, 's> Checker<'p, 's> {
    pub fn undeclared_fields_for(&mut self, ty: TypeId) -> Rc<Vec<(Atom, TypeId)>> {
        if let Some(known) = self.aot.undeclared_fields.fields.get(&ty) {
            return known.clone();
        }
        let stores = self.constructor_stores_through_any();
        let mut found: Vec<(Atom, TypeId)> = Vec::new();
        if !stores.is_empty() && !self.is_instance_type(ty) {
            let mut extended = FxHashSet::default();
            self.add_base_types(ty, &mut extended);
            let own: FxHashSet<Atom> = self.members(ty).map_or_else(Default::default, |members| {
                members.shape().props.iter().map(|prop| prop.name).collect()
            });
            for &(constructed, declaring, name) in stores.iter() {
                if extended.contains(&constructed)
                    && !own.contains(&name)
                    && found.iter().all(|field| field.0 != name)
                {
                    found.push((name, declaring));
                }
            }
            found.sort_by(|a, b| self.atoms().bytes(a.0).cmp(self.atoms().bytes(b.0)));
        }
        let found = Rc::new(found);
        self.aot.undeclared_fields.fields.insert(ty, found.clone());
        found
    }

    pub(super) fn add_undeclared_fields_to(
        &mut self,
        facts: &mut Facts,
        ty: TypeId,
        stored: &FxHashSet<Atom>,
    ) {
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
        facts.live = with(
            &facts.live,
            &mut fields
                .iter()
                .filter(|field| stored.contains(&field.0))
                .map(|field| field.0.0),
        );
    }

    pub(super) fn this_cast_to_any(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::As { expr, .. } = hir[e].kind else {
            return None;
        };
        (matches!(hir[expr].kind, ExprKind::This) && self.type_of_expr(file, e) == TypeId::ANY)
            .then_some(expr)
    }

    pub(super) fn count_first_stores_to_fields(
        &mut self,
        file: FileId,
        func: FnId,
        stores: &[FirstStore],
    ) -> usize {
        let hir = self.hir(file);
        let is_through_any = |store: &FirstStore| matches!(hir[store.target].kind, ExprKind::Dot { obj, .. } if obj != store.this);
        if !stores.iter().any(is_through_any) {
            return stores.len();
        }
        let fields = match self.constructor_function_this_type(file, func) {
            Some(constructed) => self.undeclared_fields_for(constructed),
            None => Default::default(),
        };
        stores
            .iter()
            .position(|store| {
                is_through_any(store) && fields.iter().all(|field| field.0 != store.name)
            })
            .unwrap_or(stores.len())
    }

    fn constructor_function_this_type(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let hir = self.hir(file);
        if !matches!(hir[func].kind, FnKind::Decl | FnKind::Expr) || hir[func].this_param.is_none()
        {
            return None;
        }
        let this = self.this_type_in_fn(file, func)?;
        self.layout_type_of(this)
    }

    fn add_base_types(&mut self, ty: TypeId, out: &mut FxHashSet<TypeId>) {
        let layout_types_cache = self.layout_defining_type(ty);
        if !out.insert(layout_types_cache) {
            return;
        }
        let extended: Vec<TypeId> = match *self.data(ty) {
            TypeData::Ref { target, .. } if self.is_created_by_program(ty) => {
                match self.members(ty) {
                    Some(members) => self
                        .base_types(target)
                        .into_vec()
                        .into_iter()
                        .map(|base| self.instantiate(base, members.mapper))
                        .collect(),
                    None => Vec::new(),
                }
            }
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
        let files: &'p [FileId] = self.p.aot.undeclared_fields.typed_files.get_or_init(|| {
            self.files_declaring_classes()
                .into_iter()
                .filter(|&file| self.is_compiled(file) && !self.hir(file).is_js)
                .collect()
        });
        let mut stores: Vec<Store> = Vec::new();
        for &(file, func) in self.functions_storing_through_assertions(files) {
            let Some(constructed) = self.constructor_function_this_type(file, func) else {
                continue;
            };
            let hir = self.hir(file);
            for store in self.syntactic_first_stores(file, func) {
                if matches!(hir[store.target].kind, ExprKind::Dot { obj, .. } if obj == store.this)
                {
                    continue;
                }
                let Some(declaring) = self.declaring_interface(files, constructed, store.name)
                else {
                    break;
                };
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

    fn declaring_interface(
        &mut self,
        files: &[FileId],
        extended: TypeId,
        name: Atom,
    ) -> Option<TypeId> {
        if self.type_of_property(extended, name).is_some() {
            return None;
        }
        let mut found: Option<(TypeId, TypeId)> = None;
        for &file in files {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for (index, interface) in hir.interfaces.iter().enumerate() {
                let declares = interface.type_params.is_empty()
                    && interface.members.iter().any(|member| {
                        hir[member].kind == MemberKind::Property
                            && hir[member].key.name() == Some(name)
                    });
                if !declares {
                    continue;
                }
                let declared = self.declared_type(Sym {
                    file,
                    id: bound.interface_symbol[index],
                });
                let Some(declaring) = self.layout_type_of(declared) else {
                    continue;
                };
                let mut supertypes = FxHashSet::default();
                self.add_base_types(declaring, &mut supertypes);
                if declaring == extended || !supertypes.contains(&extended) {
                    continue;
                }
                let Some(ty) = self.type_of_property(declaring, name) else {
                    continue;
                };
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

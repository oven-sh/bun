use super::first_stores::FirstStore;
use super::subtypes::Facts;
use crate::atom::Atom;
use crate::bind::{Decl, PatParent};
use crate::check::Checker;
use crate::hir::{Chain, ClassId, ExprId, ExprKind, ExprTag, Flags, FnId, FnKind, Keyword, MemberKind, PropKey, TypeNodeId, TypeNodeKind};
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
    targets_written_as_any: OnceLock<Vec<(FileId, ExprId)>>,
    classes_by_member_name: OnceLock<FxHashMap<Atom, Vec<(FileId, ClassId)>>>,
}

#[derive(Default)]
pub(super) struct State {
    stores: Option<Rc<Vec<Store>>>,
    fields: FxHashMap<TypeId, Rc<Vec<(Atom, TypeId)>>>,
    stored_through_any: Option<Rc<FxHashMap<(FileId, ClassId), Vec<Atom>>>>,
}

impl<'p, 's> Checker<'p, 's> {
    pub fn undeclared_fields_for(&mut self, ty: TypeId) -> Rc<Vec<(Atom, TypeId)>> {
        if let Some(known) = self.aot.undeclared_fields.fields.get(&ty) {
            return Rc::clone(known);
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
        self.aot.undeclared_fields.fields.insert(ty, Rc::clone(&found));
        found
    }

    pub fn properties_stored_through_any(&mut self, file: FileId, class: ClassId) -> Vec<Atom> {
        if self.aot.undeclared_fields.stored_through_any.is_none() {
            let found = self.find_properties_stored_through_any();
            self.aot.undeclared_fields.stored_through_any = Some(Rc::new(found));
        }
        self.aot.undeclared_fields.stored_through_any.as_ref().and_then(|all| all.get(&(file, class)).cloned()).unwrap_or_default()
    }

    fn find_properties_stored_through_any(&mut self) -> FxHashMap<(FileId, ClassId), Vec<Atom>> {
        let mut found: FxHashMap<(FileId, ClassId), Vec<Atom>> = FxHashMap::default();
        let declaring = self.classes_by_member_name();
        for &(file, target) in self.targets_written_as_any() {
            let ExprKind::Dot { obj, name, .. } = self.hir(file)[target].kind else { continue };
            if self.type_of_expr(file, obj) != TypeId::ANY {
                continue;
            }
            let Some(predicted) = self.predicted_expr_type(file, obj) else { continue };
            let predicted = self.non_nullable(predicted);
            let Some(class) = self.class_for_type(predicted, false) else { continue };
            let c = &self.hir(class.0)[class.1];
            if self.is_untyped_file(class.0)
                || !self.is_compiled(class.0)
                || c.flags.contains(Flags::AMBIENT)
                || c.members.iter().any(|member| matches!(self.hir(class.0)[member].key, PropKey::Computed(_)))
                || self.type_of_property(predicted, name).is_some()
                || !self.is_undeclared_in_known_hierarchy(class, declaring.get(&name).map_or(&[][..], |classes| &classes[..]))
            {
                continue;
            }
            let names = found.entry(class).or_default();
            if !names.contains(&name) {
                names.push(name);
            }
        }
        for names in found.values_mut() {
            names.sort_by(|a, b| self.atoms().bytes(*a).cmp(self.atoms().bytes(*b)));
        }
        found
    }

    fn classes_by_member_name(&self) -> &'p FxHashMap<Atom, Vec<(FileId, ClassId)>> {
        self.p.aot.undeclared_fields.classes_by_member_name.get_or_init(|| {
            let mut declaring: FxHashMap<Atom, Vec<(FileId, ClassId)>> = FxHashMap::default();
            for file in self.files_declaring_classes() {
                let hir = self.hir(file);
                for (index, class) in hir.classes.iter().enumerate() {
                    for name in class.members.iter().filter_map(|member| hir[member].key.name()) {
                        let classes = declaring.entry(name).or_default();
                        if classes.last() != Some(&(file, ClassId(index as u32))) {
                            classes.push((file, ClassId(index as u32)));
                        }
                    }
                }
            }
            declaring
        })
    }

    fn targets_written_as_any(&self) -> &'p [(FileId, ExprId)] {
        self.p.aot.undeclared_fields.targets_written_as_any.get_or_init(|| {
            let mut targets = Vec::new();
            for file in (0..self.p.files.modules.len() as u32).map(FileId) {
                if self.is_untyped_file(file) || !self.is_compiled(file) {
                    continue;
                }
                let (hir, bound) = (self.hir(file), self.bound(file));
                let is_any = |ty: TypeNodeId| ty.is_some() && matches!(hir[ty].kind, TypeNodeKind::Keyword(Keyword::Any));
                for &e in self.file_exprs_by_kind(file).of(ExprTag::Assign) {
                    let ExprKind::Assign { op: None, target, .. } = hir[e].kind else { continue };
                    let ExprKind::Dot { obj, chain: Chain::No, .. } = hir[target].kind else { continue };
                    let is_written_as_any = match hir[obj].kind {
                        ExprKind::As { ty, .. } => is_any(ty),
                        ExprKind::Ident(_) => bound.expr_symbol[obj.idx()].some().and_then(|id| bound.symbols[id.idx()].decls.first()).is_some_and(|decl| match *decl {
                            Decl::Param(pat) | Decl::Var(pat) => match bound.pat_parent[pat.idx()] {
                                PatParent::Var(declaration) => is_any(hir[declaration].ty),
                                PatParent::Param(param) => is_any(hir[param].ty),
                                _ => false,
                            },
                            _ => false,
                        }),
                        _ => false,
                    };
                    if is_written_as_any {
                        targets.push((file, target));
                    }
                }
            }
            targets
        })
    }

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

    pub(super) fn this_cast_to_any(&mut self, file: FileId, e: ExprId) -> Option<ExprId> {
        let hir = self.hir(file);
        let ExprKind::As { expr, .. } = hir[e].kind else { return None };
        (matches!(hir[expr].kind, ExprKind::This) && self.type_of_expr(file, e) == TypeId::ANY).then_some(expr)
    }

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

    fn constructor_function_this_type(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let hir = self.hir(file);
        if !matches!(hir[func].kind, FnKind::Decl | FnKind::Expr) || hir[func].this_param.is_none() {
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
            return Rc::clone(known);
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
                let Some(declaring) = self.declaring_interface(files, constructed, store.name) else { break };
                stores.push((constructed, declaring, store.name));
            }
        }
        let stores = Rc::new(stores);
        self.aot.undeclared_fields.stores = Some(Rc::clone(&stores));
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

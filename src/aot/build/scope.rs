use super::coerce::{Signature, Ty};
use super::{FileBuild, Fx, ImportSource, Place, Problem, Role, UsingArguments};
use crate::declared::{Declared, prim};
use crate::fragment::GlobalKey;
use crate::id::{FuncId, GlobalId, LayoutId, StrId, TyId, V};
use crate::ir::{self, CoerceReason, Field, LayoutKind, Op, Operation, func_flags};
use bun_sema::atom::Atom;
use bun_sema::bind::{ClassOwner, Decl, Parent, PatParent, SymFlags};
use bun_sema::check::{Activation, Capture, CapturedVariable, DeclaredClosure, Receiver};
use bun_sema::hir::{self, ExprId, Flags, FnId, IdList, PatId, PatKind, StmtId, StmtKind, VarKind};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::TypeId;

const MAX_CAPTURES: usize = 255;

#[derive(Copy, Clone)]
pub(super) enum CachedIdent {
    Unknown,
    OwnSymbol,
    ValueSymbol(Sym),
    PlainVariable(Sym),
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn default_export_binding(&mut self, file: FileId, e: hir::ExprId) -> Option<Sym> {
        self.default_export_binding_inner(file, e, &mut Vec::new())
    }

    pub(crate) fn default_export_binding_inner(
        &mut self,
        file: FileId,
        e: hir::ExprId,
        seen: &mut Vec<Sym>,
    ) -> Option<Sym> {
        let hir::ExprKind::Ident(name) = self.hir(file)[e].kind else {
            return None;
        };
        let named = self.ident_binding(file, e, name)?;
        let sym = self.value_symbol_inner(named, seen);
        let is_assigned_later = self.c.is_hoisted(sym)
            && !self.c.is_constant(sym)
            && !self.is_var_initialized_once_before(sym, file, self.hir(file)[e].pos);
        (!self.is_ambient(sym) && !self.is_assigned(sym) && !is_assigned_later).then_some(sym)
    }

    fn is_var_initialized_once_before(&self, sym: Sym, file: FileId, pos: u32) -> bool {
        let Some((of, Decl::Var(pat))) = self.value_declaration(sym) else {
            return false;
        };
        if of != file {
            return false;
        }
        let (hir, bound) = (self.hir(of), self.c.bound(of));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
            return false;
        };
        let stmt = bound.var_stmt[d.idx()];
        let is_declared_once = bound
            .symbols
            .get(bound.pat_symbol[pat.idx()].idx())
            .is_some_and(|symbol| symbol.decls.len() == 1);
        is_declared_once
            && hir[d].init.is_some()
            && stmt.is_some()
            && matches!(hir[stmt].kind, StmtKind::Var(_))
            && matches!(bound.stmt_parent[stmt.idx()], Parent::File)
            && hir[stmt].start < pos
    }

    pub(crate) fn is_function_expression_name(&self, sym: Sym) -> bool {
        matches!(self.value_declaration(sym), Some((file, Decl::Fn(func))) if matches!(self.c.bound(file).fns[func.idx()].owner, bun_sema::bind::FnOwner::Expr(_)))
    }

    pub(crate) fn is_binding_independent_of_use(
        &self,
        file: FileId,
        local: bun_sema::bind::SymbolId,
        binding: Sym,
    ) -> bool {
        local.is_some() && {
            let own = self.files.sym(file, local);
            binding == own
                && (self.files.flags(own).intersects(SymFlags::VALUE)
                    || self.files.means(own, SymFlags::VALUE))
        }
    }

    pub(crate) fn ident_binding(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        if file != self.file {
            return self.c.identifier_binding(file, e, name);
        }
        let local = self.c.bound(file).expr_symbol[e.idx()];
        if !matches!(
            self.ident_cache.get(local.idx()),
            None | Some(CachedIdent::Unknown)
        ) {
            return Some(self.files.sym(file, local));
        }
        let binding = self.c.identifier_binding(file, e, name)?;
        if self.is_binding_independent_of_use(file, local, binding) {
            if self.ident_cache.is_empty() {
                self.ident_cache
                    .resize(self.c.bound(file).symbols.len(), CachedIdent::Unknown);
            }
            self.ident_cache[local.idx()] = CachedIdent::OwnSymbol;
        }
        Some(binding)
    }

    pub(crate) fn ident_symbol(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let local = if file == self.file {
            self.c.bound(file).expr_symbol[e.idx()]
        } else {
            bun_sema::bind::SymbolId::NONE
        };
        if let Some(&(CachedIdent::ValueSymbol(known) | CachedIdent::PlainVariable(known))) =
            self.ident_cache.get(local.idx())
        {
            return Some(known);
        }
        let binding = self.ident_binding(file, e, name)?;
        let sym = self.value_symbol(binding);
        if let Some(cached @ CachedIdent::OwnSymbol) = self.ident_cache.get_mut(local.idx()) {
            *cached = CachedIdent::ValueSymbol(sym);
        }
        Some(sym)
    }

    pub(crate) fn cached_plain_variable(&self, file: FileId, e: ExprId) -> Option<Sym> {
        if file != self.file {
            return None;
        }
        match self
            .ident_cache
            .get(self.c.bound(file).expr_symbol[e.idx()].idx())
        {
            Some(&CachedIdent::PlainVariable(sym)) => Some(sym),
            _ => None,
        }
    }

    pub(crate) fn cache_plain_variable(&mut self, file: FileId, e: ExprId) {
        if file == self.file
            && let Some(cached) = self
                .ident_cache
                .get_mut(self.c.bound(file).expr_symbol[e.idx()].idx())
            && let CachedIdent::ValueSymbol(sym) = *cached
        {
            *cached = CachedIdent::PlainVariable(sym);
        }
    }

    pub(crate) fn is_assigned(&self, sym: Sym) -> bool {
        if self.is_function_expression_name(sym) {
            return false;
        }
        if self.files.flags(sym).contains(SymFlags::ASSIGNED) {
            return true;
        }
        self.has_local_flags(sym, SymFlags::ASSIGNED) || self.c.is_assigned_through_cast(sym)
    }

    pub(crate) fn function_symbol(&self, file: FileId, func: FnId) -> Sym {
        let id = self.c.bound(file).symbol_of_declaration(Decl::Fn(func));
        self.files
            .export_symbol_of_value_symbol_if_exported(self.files.sym(file, id))
    }

    pub(crate) fn is_asset_import(&self, file: FileId, stmt: StmtId) -> bool {
        let hir = self.hir(file);
        let (start, end) = (hir[stmt].start, hir[stmt].loc.end);
        hir.import_attributes.iter().any(|&(pos, attributes)| {
            let hir::ExprKind::Object(props) = hir[attributes].kind else {
                return false;
            };
            start <= pos
                && pos < end
                && props.iter().any(|p| {
                    let hir::PropKey::Name(key) = hir[p].key else {
                        return false;
                    };
                    let hir::ExprKind::String(value) = hir[hir[p].value].kind else {
                        return false;
                    };
                    self.c.atoms().bytes(key) == b"type"
                        && !matches!(
                            self.c.atoms().bytes(value),
                            b"json" | b"js" | b"ts" | b"jsx" | b"tsx"
                        )
                })
        })
    }

    pub(crate) fn type_attribute(&self, file: FileId, stmt: StmtId) -> Option<Atom> {
        let hir = self.hir(file);
        let (start, end) = (hir[stmt].start, hir[stmt].loc.end);
        hir.import_attributes.iter().find_map(|&(pos, attributes)| {
            let hir::ExprKind::Object(props) = hir[attributes].kind else {
                return None;
            };
            if pos < start || end <= pos {
                return None;
            }
            props.iter().find_map(|p| {
                let hir::PropKey::Name(key) = hir[p].key else {
                    return None;
                };
                let hir::ExprKind::String(value) = hir[hir[p].value].kind else {
                    return None;
                };
                (self.c.atoms().bytes(key) == b"type").then_some(value)
            })
        })
    }

    pub(crate) fn value_declaration(&self, sym: Sym) -> Option<(FileId, Decl)> {
        self.files.value_declaration(sym).or_else(|| {
            self.files
                .decls_of(sym)
                .iter()
                .copied()
                .find_map(|(file, decl)| match decl {
                    Decl::Require(pat) => Some((file, Decl::Var(pat))),
                    Decl::ExportExpr(_) => Some((file, decl)),
                    _ => None,
                })
        })
    }

    pub(crate) fn is_declared_by_import(&self, sym: Sym) -> bool {
        if matches!(
            self.files.value_declaration(sym),
            Some((_, Decl::Fn(_) | Decl::Var(_) | Decl::Class(_)))
        ) {
            return false;
        }
        self.files.decls_of(sym).iter().copied().any(|(_, decl)| {
            matches!(
                decl,
                Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ExportSpec(_)
                    | Decl::ExportStarAs(_)
                    | Decl::ImportEquals(_)
            )
        })
    }

    pub(crate) fn is_ambient(&self, sym: Sym) -> bool {
        if let Some(&known) = self.ambient.borrow().get(&sym) {
            return known;
        }
        let found = self.compute_is_ambient(sym);
        self.ambient.borrow_mut().insert(sym, found);
        found
    }

    fn compute_is_ambient(&self, sym: Sym) -> bool {
        if self.files.flags(sym).contains(SymFlags::ALIAS) && self.is_declared_by_import(sym) {
            return true;
        }
        if self.files.flags(sym).intersects(SymFlags::ENUM)
            && !self.enum_declarations(sym).is_empty()
        {
            return false;
        }
        let Some((file, decl)) = self.value_declaration(sym) else {
            return true;
        };
        !self.shared.is_compiled(file)
            || self
                .c
                .bound(file)
                .modifier_flags(self.hir(file), decl)
                .contains(Flags::AMBIENT)
    }

    pub(crate) fn declaring_function(&self, sym: Sym) -> Option<FnId> {
        let (file, decl) = self.value_declaration(sym)?;
        let bound = self.c.bound(file);
        match decl {
            Decl::Param(pat) | Decl::Var(pat) => {
                let mut pat = pat;
                loop {
                    match bound.pat_parent[pat.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                        PatParent::Var(d) => {
                            let stmt = bound.var_stmt[d.idx()];
                            if stmt.is_none() {
                                return None;
                            }
                            return Some(
                                self.c
                                    .enclosing_fn(file, bound.stmt_parent[stmt.idx()])
                                    .unwrap_or(FnId::NONE),
                            );
                        }
                        PatParent::Param(p) => return Some(bound.param_fn[p.idx()]),
                        PatParent::None => return None,
                    }
                }
            }
            Decl::Fn(func) => Some(bound.fns[func.idx()].enclosing),
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                owner @ ClassOwner::Stmt(_) => Some(
                    self.c
                        .enclosing_fn(file, owner.to_parent())
                        .unwrap_or(FnId::NONE),
                ),
                ClassOwner::Expr(_) => None,
            },
            _ => None,
        }
    }

    pub(crate) fn enclosing_function(&self, file: FileId, e: ExprId) -> FnId {
        self.c.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE)
    }

    pub(crate) fn is_in_instance_field_initializer(&self, file: FileId, e: ExprId) -> bool {
        let mut parent = self.c.expr_parent_link(file, e);
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => self.c.expr_parent_link(file, e),
                Parent::Stmt(s) if s.is_some() => self.c.stmt_parent_link(file, s),
                Parent::MemberInit(member) => {
                    return !self.hir(file)[member].flags.contains(Flags::STATIC);
                }
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::None | Parent::File => {
                    return false;
                }
                _ => self.c.parent_of_node(file, parent),
            };
        }
    }

    pub(crate) fn add_global(
        &mut self,
        name: StrId,
        file: FileId,
        declared: Ty,
        key: GlobalKey,
    ) -> GlobalId {
        let id = GlobalId::new(self.out.globals.len());
        let module = self.module_of(file);
        self.out.globals.push(ir::Global {
            name,
            module,
            declared: declared.id,
            initialization: ir::Initialization::Uninitialized,
            single_function: FuncId::NONE,
            single_function_flags: 0,
        });
        self.global_keys.push(key);
        if declared.checked != TypeId::UNRESOLVED {
            self.checked_globals.insert(id, declared.checked);
        }
        id
    }

    pub(crate) fn symbol_global(&mut self, sym: Sym) -> GlobalId {
        if let Some(Place::Global(g)) = self.places.get(&sym) {
            return *g;
        }
        let name = self.str(self.files.symbol(sym).name);
        let mut declared = self.symbol_ty(sym);
        let is_var = self
            .files
            .flags(sym)
            .contains(SymFlags::FUNCTION_SCOPED_VARIABLE)
            || self.has_local_flags(sym, SymFlags::FUNCTION_SCOPED_VARIABLE)
            || self.c.is_hoisted(sym);
        if is_var && declared.id.is_some() {
            declared.id = self.or_undefined(declared.id);
        }
        let is_lazy = !is_var && self.is_lazy(sym);
        if is_lazy && declared.id.is_some() {
            let or_nullish = self
                .out
                .tys
                .get(declared.id)
                .or(&Declared::prims(prim::NULLISH));
            declared.id = self.out.tys.intern(or_nullish);
        }
        let g = self.add_global(
            name,
            sym.file,
            declared,
            GlobalKey::Symbol(sym.file, sym.id),
        );
        let was = self.places.insert(sym, Place::Global(g));
        if let Some(undo) = &mut self.undo {
            undo.places.push((sym, was));
        }
        if is_lazy {
            self.lazy_globals.insert(g, sym);
        }
        if let Some((file, func)) = self.hoisted_function_for(sym) {
            let name = [
                self.c.atoms().bytes(self.files.symbol(sym).name),
                b" is bound",
            ]
            .concat();
            let name = self.out.strs.intern(&name);
            let is_bound = self.add_global(
                name,
                sym.file,
                Ty::NONE,
                GlobalKey::LazyVariableState(sym.file, sym.id),
            );
            self.out.globals[is_bound.idx()].initialization = ir::Initialization::Undefined;
            self.hoisted_functions.insert(g, (is_bound, file, func));
        }
        if is_var || is_lazy {
            self.out.globals[g.idx()].initialization = if is_lazy {
                ir::Initialization::Lazy
            } else {
                ir::Initialization::Undefined
            };
        } else if self.c.is_never_read_uninitialized(sym) {
            let is_stored_once = self.c.is_constant(sym) && !self.is_lazily_evaluated(sym.file);
            self.out.globals[g.idx()].initialization = if is_stored_once {
                ir::Initialization::NeverReadUninitializedStoredOnce
            } else {
                ir::Initialization::NeverReadUninitialized
            };
        }
        let (single_function, single_function_flags) = self.symbol_single_function(sym);
        self.out.globals[g.idx()].single_function = single_function;
        self.out.globals[g.idx()].single_function_flags =
            if is_lazy && single_function_flags & ir::single_function_flags::IS_PROVEN != 0 {
                ir::single_function_flags::OR_NULLISH
            } else {
                single_function_flags
            };
        g
    }

    fn hoisted_function_for(&self, sym: Sym) -> Option<(FileId, FnId)> {
        let with_body = |&(file, decl): &(FileId, Decl)| matches!(decl, Decl::Fn(func) if !matches!(self.hir(file)[func].body, hir::FnBody::None));
        let Some((file, Decl::Fn(func))) =
            self.files.decls_of(sym).iter().copied().rfind(with_body)
        else {
            return None;
        };
        let hir = self.hir(file);
        let is_at_top_level = hir
            .ids(hir.body)
            .any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(declared) if declared == func));
        (is_at_top_level && !self.is_commonjs(file)).then_some((file, func))
    }

    pub(crate) fn try_bind_hoisted_function(&mut self, fx: &mut Fx, sym: Sym, func: FnId) -> bool {
        let Some(&Place::Global(global)) = self.places.get(&sym) else {
            return false;
        };
        let Some(&(is_bound, file, hoisted)) = self.hoisted_functions.get(&global) else {
            return false;
        };
        if hoisted != func {
            let hir = self.hir(file);
            return file == fx.file
                && hir.ids(hir.body).any(
                    |stmt| matches!(hir[stmt].kind, StmtKind::Fn(declared) if declared == func),
                );
        }
        self.bind_hoisted_function(fx, global, is_bound, file, hoisted);
        true
    }

    fn symbol_single_function(&mut self, sym: Sym) -> (FuncId, u8) {
        if let Some((file, class)) = self.c.class_for_variable(sym) {
            return (
                self.forward_declare_constructor(file, class),
                ir::single_function_flags::IS_PROVEN,
            );
        }
        if let Some((file, class)) = self.c.variable_single_class(sym) {
            return (
                self.forward_declare_constructor(file, class),
                ir::single_function_flags::OR_NULLISH,
            );
        }
        match self.c.variable_single_function(sym) {
            Some(only) if only.is_predicted => {
                (self.forward_declare_function(only.file, only.func), 0)
            }
            Some(only) => (
                self.forward_declare_function(only.file, only.func),
                if only.may_be_nullish {
                    ir::single_function_flags::OR_NULLISH
                } else {
                    ir::single_function_flags::IS_PROVEN
                },
            ),
            None => (FuncId::NONE, 0),
        }
    }

    fn has_local_flags(&self, sym: Sym, flags: SymFlags) -> bool {
        self.files
            .decls_of(sym)
            .iter()
            .copied()
            .any(|(file, decl)| {
                let bound = self.c.bound(file);
                let local = bound.symbol_of_declaration(decl);
                local.is_some() && bound.symbols[local.idx()].flags.contains(flags)
            })
    }

    pub(crate) fn declare(&mut self, fx: &mut Fx, syms: &[Sym]) {
        let captured = self.captured(fx.file);
        for &sym in syms {
            if matches!(self.places.get(&sym), Some(Place::Global(_)))
                || self.namespace_with_property(sym).is_some()
            {
                continue;
            }
            if captured.contains(&sym) && self.is_bound_once(sym) {
                self.symbol_global(sym);
                continue;
            }
            if let Some(CapturedVariable::InEnvironment(activation, _)) =
                self.c.captured_variable(sym)
            {
                self.activation_layout(activation);
                let is_var = matches!(self.value_declaration(sym), Some((_, Decl::Var(_))));
                if is_var
                    && !self.c.has_tdz(sym)
                    && self
                        .files
                        .flags(sym)
                        .contains(SymFlags::FUNCTION_SCOPED_VARIABLE)
                {
                    self.initialize_sym_without_value(fx, sym, 0);
                }
                continue;
            }
            if !fx.locals.contains_key(&sym) {
                let declared = self.symbol_ty(sym);
                let var = self.new_var(fx, declared);
                self.predict_variable(fx, var, sym);
                fx.locals.insert(sym, var);
            }
            if self.c.is_referenced_in_tdz(sym) {
                self.enter_tdz(fx, sym);
            }
        }
    }

    pub(crate) fn activation_layout(&mut self, activation: Activation) -> LayoutId {
        if let Some(&layout) = self.activation_layouts.get(&activation) {
            return layout;
        }
        if let Activation::Class(class) = activation {
            let info = self.define_class(self.file, class);
            return self.out.layouts[info.layout.idx()].environment;
        }
        let key = self.next_environment_key();
        let layout = self.add_layout(LayoutKind::Environment, StrId::NONE, key);
        let was = self.activation_layouts.insert(activation, layout);
        self.index_activation_layout(activation);
        if let Some(undo) = &mut self.undo {
            undo.activation_layouts.push((activation, was));
        }
        self.activations.insert(layout, activation);
        let mut fields = Vec::new();
        for (index, &sym) in self
            .c
            .environment_of(self.file, activation)
            .iter()
            .enumerate()
        {
            let index = index as u32;
            let name = self.str(self.files.symbol(sym).name);
            if let Some((file, func)) = self.function_declaration_for(sym)
                && self.c.declared_closure(file, func)
                    == Some(DeclaredClosure::KeptInEnvironment(activation, index))
            {
                let declared = self.or_undefined(self.known.function);
                let single_function = self.forward_declare_function(file, func);
                fields.push(Field {
                    single_function,
                    single_function_flags: ir::single_function_flags::OR_NULLISH,
                    ..Field::new(name, declared, 0)
                });
                self.cached_closures.insert((layout, index));
                continue;
            }
            let declared = self.symbol_ty(sym);
            let mut flags = 0;
            if self.c.is_never_read_uninitialized(sym) {
                flags = ir::field_flags::NEVER_READ_UNINITIALIZED
                    | if self.c.is_constant(sym) {
                        ir::field_flags::STORED_ONCE
                    } else {
                        0
                    };
            }
            let (single_function, single_function_flags) = self.symbol_single_function(sym);
            fields.push(Field {
                single_function,
                single_function_flags,
                ..Field::new(name, declared.id, flags)
            });
            self.checked_fields
                .insert((layout, index), declared.checked);
            let was = self.places.insert(sym, Place::Env(layout, index));
            if let Some(undo) = &mut self.undo {
                undo.places.push((sym, was));
            }
        }
        for func in self.c.cached_function_expressions_in(self.file, activation) {
            let declared = self.or_undefined(self.known.function);
            let single_function = self.forward_declare_function(self.file, func);
            self.cached_closures.insert((layout, fields.len() as u32));
            fields.push(Field {
                single_function,
                single_function_flags: ir::single_function_flags::OR_NULLISH,
                ..Field::new(StrId::NONE, declared, 0)
            });
        }
        let entered = self.c.environment_activation(self.file, activation);
        if let Activation::Call(func) = entered {
            for (sym, start, end) in self.c.redeclared_parameters(self.file, func) {
                if matches!(self.places.get(&sym), Some(&Place::Env(kept_in, _)) if kept_in == layout)
                {
                    let (name, declared, index) = (
                        self.str(self.files.symbol(sym).name),
                        self.symbol_ty(sym),
                        fields.len() as u32,
                    );
                    fields.push(Field::new(name, declared.id, 0));
                    self.checked_fields
                        .insert((layout, index), declared.checked);
                    let was = self
                        .parameter_slots
                        .insert(sym, (Place::Env(layout, index), start, end));
                    if let Some(undo) = &mut self.undo {
                        undo.parameter_slots.push((sym, was));
                    }
                }
            }
        }
        self.out.layouts[layout.idx()].fields = fields;
        if matches!(entered, Activation::Call(_)) {
            self.out.layouts[layout.idx()].class_flags |= ir::class_flags::MAY_BE_REUSED;
        }
        layout
    }

    pub(crate) fn open_activation(&mut self, fx: &mut Fx, activation: Activation) -> bool {
        let environments = self.c.activation_environments(fx.file, activation);
        let Some(&last) = environments.last() else {
            return false;
        };
        let layout = self.activation_layout(last);
        if fx.envs.last().is_some_and(|scope| scope.layout == layout) {
            return false;
        }
        for (index, &environment) in environments.iter().enumerate() {
            let layout = self.activation_layout(environment);
            let env = self.new_environment(fx, layout);
            self.push_env(fx, layout, env);
            fx.envs.last_mut().unwrap().shares_activation_with_previous = index > 0;
        }
        true
    }

    pub(crate) fn new_environment(&mut self, fx: &mut Fx, layout: LayoutId) -> V {
        let env = self.emit(fx, Op::New(layout));
        for field in 0..self.out.layouts[layout.idx()].fields.len() as u32 {
            if self.cached_closures.contains(&(layout, field)) {
                let value = self.emit(fx, Op::Undefined);
                self.emit(
                    fx,
                    Op::FieldSet {
                        obj: env,
                        layout,
                        field,
                        value,
                    },
                );
            }
        }
        env
    }

    pub(crate) fn close_env(&mut self, fx: &mut Fx) {
        while fx
            .envs
            .pop()
            .is_some_and(|scope| scope.shares_activation_with_previous)
        {}
    }

    fn imported(&self, fx: &Fx, capture: Capture) -> Option<(LayoutId, u32)> {
        fx.envs.iter().rev().find_map(|scope| {
            let index = self
                .imports
                .get(&scope.layout)?
                .iter()
                .position(|&held| held == capture)?;
            Some((scope.layout, index as u32))
        })
    }

    pub(crate) fn can_reach_env(&self, fx: &Fx, layout: LayoutId) -> bool {
        layout.is_none()
            || fx.envs.iter().any(|scope| scope.layout == layout)
            || self.activations.get(&layout).is_some_and(|&activation| {
                self.imported(fx, Capture::Environment(activation))
                    .is_some()
            })
    }

    pub(crate) fn env_for_layout(&mut self, fx: &mut Fx, layout: LayoutId) -> V {
        if let Some(scope) = fx.envs.iter().rev().find(|scope| scope.layout == layout) {
            let var = scope.var;
            return self.read(fx, var);
        }
        match self
            .activations
            .get(&layout)
            .copied()
            .and_then(|activation| self.imported(fx, Capture::Environment(activation)))
        {
            Some((holder, field)) => {
                let obj = self.env_for_layout(fx, holder);
                self.emit(
                    fx,
                    Op::FieldGet {
                        obj,
                        layout: holder,
                        field,
                    },
                )
            }
            None => self.unsupported(
                fx,
                0,
                "a variable of a function that does not enclose this one",
            ),
        }
    }

    fn is_own_receiver(&self, fx: &Fx, receiver: Receiver) -> bool {
        match receiver {
            Receiver::Function(func) => fx.func == func,
            Receiver::Instance(class) => {
                fx.class == Some((fx.file, class))
                    && self.out.funcs[fx.id.idx()].kind == ir::FuncKind::Constructor
            }
            Receiver::None | Receiver::Static(_) => false,
        }
    }

    fn has_own_capture(&self, fx: &Fx, capture: Capture) -> bool {
        match capture {
            Capture::Environment(activation) => self
                .activation_layouts
                .get(&activation)
                .is_some_and(|&layout| fx.envs.iter().any(|scope| scope.layout == layout)),
            Capture::Variable(sym) => fx.locals.contains_key(&sym),
            Capture::This(receiver) => {
                fx.receivers.contains_key(&receiver) || self.is_own_receiver(fx, receiver)
            }
            Capture::Arguments(func) => {
                fx.captured_arguments.contains_key(&func)
                    || fx.func == func && fx.arguments.is_some()
            }
            Capture::NewTarget(func) => {
                fx.captured_new_targets.contains_key(&func)
                    || fx.func == func && fx.new_target.is_some()
            }
            Capture::HomeObject(func) => fx.home_objects.contains_key(&func),
        }
    }

    pub(crate) fn has_capture_available(&self, fx: &Fx, capture: Capture) -> bool {
        self.has_own_capture(fx, capture) || self.imported(fx, capture).is_some()
    }

    pub(crate) fn has_captures_available(&self, fx: &Fx, func: FuncId) -> bool {
        self.captures.get(&func).is_none_or(|captures| {
            captures
                .iter()
                .all(|&capture| self.has_capture_available(fx, capture))
        })
    }

    pub(crate) fn capture_value(&mut self, fx: &mut Fx, capture: Capture, pos: u32) -> V {
        if !matches!(capture, Capture::Environment(_) | Capture::Variable(_))
            && !self.has_own_capture(fx, capture)
            && let Some((layout, field)) = self.imported(fx, capture)
        {
            let env = self.env_for_layout(fx, layout);
            return self.emit(
                fx,
                Op::FieldGet {
                    obj: env,
                    layout,
                    field,
                },
            );
        }
        match capture {
            Capture::Environment(activation) => {
                let layout = self.activation_layout(activation);
                self.env_for_layout(fx, layout)
            }
            Capture::Variable(sym) if self.es_module_for_symbol(sym).is_some() => {
                match fx.locals.get(&sym) {
                    Some(&var) => self.read(fx, var),
                    None => self.read_from_storage(fx, sym, ExprId::NONE, pos),
                }
            }
            Capture::Variable(sym) => self.read_sym(fx, sym, pos),
            Capture::This(receiver) => match (fx.receivers.get(&receiver), fx.this_binding) {
                (Some(&this), _) => this,
                (None, Some((_, binding))) if self.this_binding_layout(receiver).is_some() => {
                    binding
                }
                (None, _) => self.this(fx, pos),
            },
            Capture::Arguments(func) => match fx.captured_arguments.get(&func) {
                Some(&arguments) => arguments,
                None => fx.arguments,
            },
            Capture::NewTarget(func) => match fx.captured_new_targets.get(&func) {
                Some(&new_target) => new_target,
                None => fx.new_target,
            },
            Capture::HomeObject(func) => match fx.home_objects.get(&func) {
                Some(&home) => home,
                None => self.unsupported(
                    fx,
                    pos,
                    "`super` in a method of an object literal that is created elsewhere",
                ),
            },
        }
    }

    pub(crate) fn capture_values(&mut self, fx: &mut Fx, func: FuncId, pos: u32) -> ir::Args {
        let captures = self.captures.get(&func).cloned().unwrap_or_default();
        let capture_tys = self.out.funcs[func.idx()].captures.clone();
        let anything = self.out.tys.anything;
        (captures.into_iter().zip(capture_tys))
            .map(|(capture, to)| {
                let value = self.capture_value(fx, capture, pos);
                if matches!(capture, Capture::Variable(_))
                    && to != anything
                    && self.ty(fx, value) == anything
                {
                    self.emit_throwing(
                        fx,
                        Op::Coerce {
                            value,
                            to,
                            why: CoerceReason::Claim,
                        },
                    )
                } else {
                    value
                }
            })
            .collect()
    }

    pub(crate) fn capture_ty(&mut self, capture: Capture) -> Ty {
        match capture {
            Capture::Environment(activation) => {
                let layout = self.activation_layout(activation);
                Ty::from_id(self.layout_ty(layout))
            }
            Capture::Variable(sym) => self.symbol_ty(sym),
            Capture::This(receiver) => match self.this_binding_layout(receiver) {
                Some(layout) => Ty::from_id(self.layout_ty(layout)),
                None => self.receiver_ty(receiver),
            },
            Capture::Arguments(_) | Capture::NewTarget(_) | Capture::HomeObject(_) => Ty::NONE,
        }
    }

    pub(crate) fn this_binding_layout(&mut self, receiver: Receiver) -> Option<LayoutId> {
        let Receiver::Function(func) = receiver else {
            return None;
        };
        if !self.c.this_may_be_uninitialized(self.file, func) {
            return None;
        }
        if let Some(&layout) = self.this_bindings.get(&func) {
            return Some(layout);
        }
        let key = self.next_environment_key();
        let layout = self.add_layout(LayoutKind::Environment, StrId::NONE, key);
        let names = [
            self.out.strs.intern(b"this"),
            self.out.strs.intern(b"new.target"),
        ];
        self.out.layouts[layout.idx()].fields = names
            .into_iter()
            .map(|name| Field::new(name, TyId::NONE, 0))
            .collect();
        let was = self.this_bindings.insert(func, layout);
        if let Some(undo) = &mut self.undo {
            undo.this_bindings.push((func, was));
        }
        Some(layout)
    }

    pub(crate) fn receiver_ty(&mut self, receiver: Receiver) -> Ty {
        let id = match receiver {
            Receiver::Function(func) => self.funcs.get(&(self.file, func)).copied(),
            Receiver::Instance(class) => {
                self.classes.get(&(self.file, class)).map(|info| info.ctor)
            }
            Receiver::None | Receiver::Static(_) => None,
        };
        match id {
            Some(id) if id.is_some() => Ty {
                id: self.out.funcs[id.idx()].declared_this_type,
                checked: self
                    .signatures
                    .get(&id)
                    .and_then(|signature| signature.this)
                    .unwrap_or(TypeId::UNRESOLVED),
            },
            _ => Ty::NONE,
        }
    }

    pub(crate) fn set_captures(&mut self, id: FuncId, captures: &[Capture]) {
        if captures.is_empty() {
            return;
        }
        let mut types = Vec::with_capacity(captures.len());
        for &capture in captures {
            let ty = self.capture_ty(capture).id;
            types.push(self.or_anything(ty));
        }
        if captures.len() > MAX_CAPTURES {
            let (file, pos) = (self.file, self.out.funcs[id.idx()].pos);
            self.problems.push(Problem {
                file,
                pos,
                what: format!(
                    "this function captures {} variables; a closure can hold {MAX_CAPTURES}",
                    captures.len()
                )
                .into(),
            });
        }
        self.out.funcs[id.idx()].captures = types;
        self.captures.insert(id, captures.to_vec());
    }

    pub(crate) fn add_captures(&mut self, fx: &mut Fx) {
        let is_arrow = fx.func.is_some() && self.hir(fx.file)[fx.func].kind == hir::FnKind::Arrow;
        let seen = if is_arrow {
            self.c.arrow_receiver(fx.file, fx.func)
        } else {
            Receiver::None
        };
        let declared = self.out.funcs[fx.id.idx()].captures.clone();
        for (capture, declared) in self
            .captures
            .get(&fx.id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .zip(declared)
        {
            let mut ty = self.capture_ty(capture);
            if matches!(capture, Capture::Variable(_))
                && declared != self.out.tys.anything
                && self.or_anything(ty.id) == self.out.tys.anything
            {
                ty.id = declared;
            }
            let value = self.add_entry_param(fx, ty);
            match capture {
                Capture::Environment(activation) => {
                    let layout = self.activation_layout(activation);
                    self.push_env(fx, layout, value);
                }
                Capture::Variable(sym) => {
                    let var = self.new_var(fx, ty);
                    self.predict_variable(fx, var, sym);
                    fx.b.write(var, value);
                    fx.locals.insert(sym, var);
                }
                Capture::This(receiver) => {
                    fx.receivers.insert(receiver, value);
                    match self.this_binding_layout(receiver) {
                        Some(layout) if receiver == seen => {
                            fx.this_binding = Some((layout, value));
                            fx.new_target = self.emit(
                                fx,
                                Op::FieldGet {
                                    obj: value,
                                    layout,
                                    field: 1,
                                },
                            );
                        }
                        None if receiver == seen => fx.this = value,
                        _ => {}
                    }
                }
                Capture::Arguments(func) => {
                    fx.captured_arguments.insert(func, value);
                    if seen == Receiver::Function(func) {
                        fx.arguments = value;
                    }
                }
                Capture::NewTarget(func) => {
                    fx.captured_new_targets.insert(func, value);
                    if seen == Receiver::Function(func) {
                        fx.new_target = value;
                    }
                }
                Capture::HomeObject(func) => {
                    fx.home_objects.insert(func, value);
                }
            }
        }
    }

    pub(crate) fn read_sym(&mut self, fx: &mut Fx, sym: Sym, pos: u32) -> V {
        self.read_sym_at(fx, sym, ExprId::NONE, pos)
    }

    pub(crate) fn read_reference(&mut self, fx: &mut Fx, sym: Sym, e: ExprId) -> V {
        let pos = self.hir(fx.file)[e].pos;
        self.read_sym_at(fx, sym, e, pos)
    }

    pub(crate) fn emit_default_export_tdz_check(&mut self, fx: &mut Fx, e: ExprId) {
        if e.is_none() || self.last_default_export_check == Some((fx.id, e)) {
            return;
        }
        self.last_default_export_check = Some((fx.id, e));
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else {
            return;
        };
        let Some(named) = self.ident_binding(fx.file, e, name) else {
            return;
        };
        if !self.is_import(named) {
            return;
        }
        let mut passed = Vec::new();
        self.value_symbol_inner(named, &mut passed);
        for exported in passed {
            if self.has_own_tdz(exported) {
                let global = self.symbol_global(exported);
                self.emit_throwing(fx, Op::GlobalGet(global));
            } else {
                self.check_entity_alias_initialized(fx, exported, e);
            }
        }
    }

    fn has_own_tdz(&mut self, exported: Sym) -> bool {
        for &(file, decl) in self.files.decls_of(exported).iter() {
            let Decl::ExportExpr(stmt) = decl else {
                continue;
            };
            let hir::StmtKind::ExportDefault(e) = self.hir(file)[stmt].kind else {
                continue;
            };
            return self
                .default_export_binding(file, e)
                .is_some_and(|sym| !self.c.is_default_export_equivalent_to_binding(file, e, sym));
        }
        false
    }

    fn read_sym_at(&mut self, fx: &mut Fx, sym: Sym, e: ExprId, pos: u32) -> V {
        if e.is_some()
            && self.files.flags(sym).contains(SymFlags::CLASS)
            && let Some((file, Decl::Class(class))) = self.value_declaration(sym)
            && file == fx.file
            && self.c.is_inside_class(file, e, class)
            && !self.c.is_in_class_heritage_or_computed_key(file, e, class)
            && self.is_within_class_environment(fx, file, class)
        {
            return self.class_as_value(fx, file, class);
        }
        self.emit_default_export_tdz_check(fx, e);
        if let Some(module) = self.es_module_for_symbol(sym) {
            self.mark_holder_initialized(fx, sym, e);
            return self.read_sym(fx, self.files.file_symbol(module), pos);
        }
        if matches!(self.places.get(&sym), Some(Place::Global(_)))
            && let Some(exported) = self.copied_export(sym)
            && let Some(value) = self.c.const_value(exported)
        {
            self.mark_holder_initialized(fx, sym, e);
            let constant = self.primitive_constant(value);
            return self.emit_constant(fx, &constant);
        }
        if let Some(namespace) = self.namespace_with_property(sym) {
            return self.read_namespace_property(fx, namespace, sym);
        }
        if let Some((owner, index)) = self.c.mapped_parameter(sym) {
            let arguments = self.capture_value(fx, Capture::Arguments(owner), pos);
            let index = self.emit(fx, Op::Int(index as i64));
            return self.operation(fx, Operation::GetMappedParameter, &[arguments, index]);
        }
        if let Some(&var) = fx.locals.get(&sym) {
            self.emit_local_tdz_check(fx, sym, e);
            return self.read(fx, var);
        }
        if let Some(value) = self.c.const_value(sym) {
            if self.is_lazy(sym) {
                self.emit_lazy_tdz_check(fx, sym, e);
            } else if self.may_be_in_tdz(fx, sym, e) {
                self.read_from_storage(fx, sym, e, pos);
            }
            let constant = self.primitive_constant(value);
            return self.emit_constant(fx, &constant);
        }
        self.read_from_storage(fx, sym, e, pos)
    }

    pub(crate) fn mark_holder_initialized(&mut self, fx: &mut Fx, sym: Sym, e: ExprId) {
        if fx.locals.contains_key(&sym) {
            self.emit_local_tdz_check(fx, sym, e);
        } else if self.may_be_in_tdz(fx, sym, e) {
            let pos = if e.is_some() {
                self.hir(fx.file)[e].pos
            } else {
                fx.b.pos
            };
            self.read_from_storage(fx, sym, e, pos);
        }
    }

    fn slot_at(&self, sym: Sym, pos: u32) -> Option<Place> {
        match self.parameter_slots.get(&sym) {
            Some(&(place, start, end)) if (start..end).contains(&pos) => Some(place),
            _ => self.places.get(&sym).copied(),
        }
    }

    pub(crate) fn copy_parameters_to_body_variables(&mut self, fx: &mut Fx) {
        for (sym, ..) in self.c.redeclared_parameters(fx.file, fx.func) {
            if let Some(&(Place::Env(layout, field), ..)) = self.parameter_slots.get(&sym) {
                let env = self.env_for_layout(fx, layout);
                let value = self.emit(
                    fx,
                    Op::FieldGet {
                        obj: env,
                        layout,
                        field,
                    },
                );
                self.write_sym(fx, sym, value, 0);
            }
        }
    }

    fn read_from_storage(&mut self, fx: &mut Fx, sym: Sym, e: ExprId, pos: u32) -> V {
        if let Some((layout, field)) = self.imported(fx, Capture::Variable(sym)) {
            let env = self.env_for_layout(fx, layout);
            return self.emit(
                fx,
                Op::FieldGet {
                    obj: env,
                    layout,
                    field,
                },
            );
        }
        if matches!(self.places.get(&sym), Some(Place::Env(..)))
            && let Some((file, Decl::Class(class))) = self.value_declaration(sym)
            && self.is_within_class_environment(fx, file, class)
        {
            return self.class_as_value(fx, file, class);
        }
        match self.slot_at(sym, pos) {
            Some(Place::Global(g)) => return self.read_slot(fx, sym, Op::GlobalGet(g), e),
            Some(Place::Env(layout, field)) => {
                let env = self.env_for_layout(fx, layout);
                return self.read_slot(
                    fx,
                    sym,
                    Op::FieldGet {
                        obj: env,
                        layout,
                        field,
                    },
                    e,
                );
            }
            None => {}
        }
        match self.value_declaration(sym) {
            Some((file, Decl::Fn(func))) => {
                if file != self.file
                    && self.is_assigned(sym)
                    && self.function_values(file).contains(&sym)
                {
                    let g = self.symbol_global(sym);
                    return self.read_slot(fx, sym, Op::GlobalGet(g), e);
                }
                if let Some((file, func)) = self.function_declaration_for(sym)
                    && let Some(id) = self.function_of_declaration(fx, file, func)
                {
                    return self.declaration_closure(fx, sym, id, pos);
                }
                self.function_value(fx, file, func, pos)
            }
            Some((_, Decl::Var(_))) if self.declaring_function(sym) == Some(FnId::NONE) => {
                let g = self.symbol_global(sym);
                self.read_slot(fx, sym, Op::GlobalGet(g), e)
            }
            Some((_, Decl::ExportExpr(_))) => {
                let g = self.symbol_global(sym);
                self.read_slot(fx, sym, Op::GlobalGet(g), e)
            }
            Some((file, Decl::Class(class))) => {
                self.emit_class_tdz_check(fx, file, class, e);
                self.class_as_value(fx, file, class)
            }
            Some((_, Decl::Enum(_))) => {
                let maker = self.enum_object_getter(sym);
                self.emit_throwing(
                    fx,
                    Op::CallDirect {
                        func: maker,
                        args: ir::Args::new(),
                    },
                )
            }
            Some((file, Decl::EnumMember(member))) => {
                match self.c.enum_member_value(file, member) {
                    Some(bun_sema::types::EnumValue::Number(bits)) => {
                        self.number(fx, f64::from_bits(bits))
                    }
                    Some(bun_sema::types::EnumValue::String(text)) => {
                        let text = self.str(text);
                        self.emit(fx, Op::Str(text))
                    }
                    None => match self.files.parent_of_symbol(sym) {
                        Some(owner) => {
                            let maker = self.enum_object_getter(owner);
                            let obj = self.emit_throwing(
                                fx,
                                Op::CallDirect {
                                    func: maker,
                                    args: ir::Args::new(),
                                },
                            );
                            let name = self.str(self.files.symbol(sym).name);
                            self.emit_throwing(fx, Op::PropGet { obj, name })
                        }
                        None => self.unsupported(
                            fx,
                            pos,
                            "an enum member whose value is computed at run time",
                        ),
                    },
                }
            }
            Some((_, Decl::Module(_))) if self.c.is_reified_namespace(sym) => {
                self.namespace_object(fx, sym)
            }
            Some((_, Decl::Module(_) | Decl::File)) => {
                let getter = self.namespace_object_getter(sym);
                self.emit_throwing(
                    fx,
                    Op::CallDirect {
                        func: getter,
                        args: ir::Args::new(),
                    },
                )
            }
            _ => self.unsupported(fx, pos, "a reference to this kind of declaration"),
        }
    }

    fn read_slot(&mut self, fx: &mut Fx, sym: Sym, read: Op, e: ExprId) -> V {
        if let Op::GlobalGet(global) = read
            && self.lazy_globals.contains_key(&global)
        {
            let may_be_early = self.may_be_in_tdz(fx, sym, e);
            return self.read_lazy_variable(fx, global, sym, may_be_early);
        }
        if self.may_be_in_tdz(fx, sym, e) {
            return self.emit_throwing(fx, read);
        }
        let found = self.emit(fx, read);
        let is_known_initialized = matches!(fx.b.func.op(found), Some(Op::GlobalGet(_)));
        fx.b.func.values[found.idx()].set_is_known_initialized(is_known_initialized);
        found
    }

    pub(crate) fn may_be_in_tdz(&mut self, fx: &Fx, sym: Sym, e: ExprId) -> bool {
        (!fx.locals.contains_key(&sym) || fx.initialized.contains_key(&sym))
            && self.c.may_be_in_tdz(sym, fx.file, e)
    }

    fn enter_tdz(&mut self, fx: &mut Fx, sym: Sym) {
        let boolean = self.known.boolean;
        let flag = *fx
            .initialized
            .entry(sym)
            .or_insert_with(|| fx.b.new_var(boolean));
        if fx.false_value.is_none() {
            fx.false_value = fx.b.entry_constant(Op::Bool(false), self.known.no);
        }
        self.write(fx, flag, fx.false_value);
    }

    fn leave_tdz(&mut self, fx: &mut Fx, sym: Sym) {
        if let Some(&flag) = fx.initialized.get(&sym) {
            if fx.true_value.is_none() {
                fx.true_value = fx.b.entry_constant(Op::Bool(true), self.known.yes);
            }
            self.write(fx, flag, fx.true_value);
        }
    }

    fn emit_local_tdz_check(&mut self, fx: &mut Fx, sym: Sym, e: ExprId) {
        let Some(&flag) = fx.initialized.get(&sym) else {
            return;
        };
        if !self.c.may_be_in_tdz(sym, fx.file, e) {
            return;
        }
        let is_initialized = self.read(fx, flag);
        if is_initialized == fx.true_value {
            return;
        }
        let (fine, throw) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_initialized, fine, throw);
        fx.b.seal(fine);
        fx.b.seal(throw);
        fx.b.switch_to(throw);
        self.throw_error(
            fx,
            b"ReferenceError",
            b"Cannot access a variable before its initialization",
        );
        fx.b.switch_to(fine);
    }

    pub(crate) fn initialize_sym(&mut self, fx: &mut Fx, sym: Sym, value: V, pos: u32) {
        self.leave_tdz(fx, sym);
        self.write_sym(fx, sym, value, pos);
    }

    pub(crate) fn initialize_sym_without_value(&mut self, fx: &mut Fx, sym: Sym, pos: u32) {
        if self.namespace_with_property(sym).is_some() {
            return;
        }
        let ty = match (fx.locals.get(&sym), self.places.get(&sym)) {
            (Some(&var), _) => fx.b.var_type(var),
            (None, Some(&Place::Global(g))) => self.out.globals[g.idx()].declared,
            (None, Some(&Place::Env(layout, field))) => {
                self.out.layouts[layout.idx()].fields[field as usize].declared
            }
            (None, None) => TyId::NONE,
        };
        let blank = self.emit_default_value(fx, ty);
        fx.is_storing_default = true;
        self.initialize_sym(fx, sym, blank, pos);
        fx.is_storing_default = false;
    }

    pub(crate) fn assign_sym(&mut self, fx: &mut Fx, sym: Sym, value: V, e: ExprId) {
        let pos = self.hir(fx.file)[e].pos;
        if self.namespace_with_property(sym).is_some() {
            return self.write_sym(fx, sym, value, pos);
        }
        if fx.locals.contains_key(&sym) {
            self.emit_local_tdz_check(fx, sym, e);
        } else if self.c.has_tdz(sym) && self.may_be_in_tdz(fx, sym, e) {
            self.read_sym_at(fx, sym, e, pos);
        }
        if self.is_function_expression_name(sym)
            && fx.func.is_some()
            && self.c.is_sloppy_function(fx.file, fx.func)
        {
            return;
        }
        let references_enclosing_class = matches!(self.value_declaration(sym), Some((file, Decl::Class(class))) if file == fx.file && self.c.is_inside_class(file, e, class));
        if self.c.is_constant(sym)
            || self.is_function_expression_name(sym)
            || references_enclosing_class
        {
            self.throw_error(
                fx,
                b"TypeError",
                b"Attempted to assign to readonly property.",
            );
            let after = fx.b.new_block();
            fx.b.seal(after);
            fx.b.switch_to(after);
            return;
        }
        self.write_sym(fx, sym, value, pos);
    }

    fn coerce_to_variable_type(
        &mut self,
        fx: &mut Fx,
        sym: Sym,
        value: V,
        place: TyId,
        why: CoerceReason,
    ) -> V {
        if fx.is_storing_default {
            return value;
        }
        let held = self.symbol_store_ty(sym);
        if held.id == place {
            value
        } else {
            self.coerce_to(fx, value, held, why)
        }
    }

    pub(crate) fn write_sym(&mut self, fx: &mut Fx, sym: Sym, value: V, pos: u32) {
        if let Some(namespace) = self.namespace_with_property(sym) {
            let obj = self.namespace_object(fx, namespace);
            let name = self.str(self.files.symbol(sym).name);
            self.emit_throwing(fx, Op::PropSet { obj, name, value });
            return;
        }
        if let Some((owner, index)) = self.c.mapped_parameter(sym) {
            let arguments = self.capture_value(fx, Capture::Arguments(owner), pos);
            let index = self.emit(fx, Op::Int(index as i64));
            self.operation(
                fx,
                Operation::PutMappedParameter,
                &[arguments, index, value],
            );
            return;
        }
        let why = if self.c.is_annotated(sym) {
            CoerceReason::Cast
        } else {
            CoerceReason::Store
        };
        if let Some(&var) = fx.locals.get(&sym) {
            let value = self.coerce_to_variable_type(fx, sym, value, fx.b.var_type(var), why);
            self.write_as(fx, var, value, why);
            return;
        }
        let place = match self.slot_at(sym, pos) {
            None if matches!(self.value_declaration(sym), Some((_, Decl::Var(_))))
                && self.declaring_function(sym) == Some(FnId::NONE) =>
            {
                Some(Place::Global(self.symbol_global(sym)))
            }
            place => place,
        };
        match place {
            Some(Place::Global(g)) => {
                let want = Ty {
                    id: self.out.globals[g.idx()].declared,
                    checked: self
                        .checked_globals
                        .get(&g)
                        .copied()
                        .unwrap_or(TypeId::UNRESOLVED),
                };
                let value = self.coerce_to_variable_type(fx, sym, value, want.id, why);
                let value = self.coerce_to(fx, value, want, why);
                self.emit(fx, Op::GlobalSet(g, value));
            }
            Some(Place::Env(layout, field)) => {
                let want = self.field_type(layout, field);
                let value = self.coerce_to_variable_type(fx, sym, value, want.id, why);
                let value = self.coerce_to(fx, value, want, why);
                let env = self.env_for_layout(fx, layout);
                self.emit(
                    fx,
                    Op::FieldSet {
                        obj: env,
                        layout,
                        field,
                        value,
                    },
                );
            }
            None => match self.value_declaration(sym) {
                Some((file, Decl::Class(class)))
                    if self.class_info(file, class).facts.is_evaluated_once =>
                {
                    let own = self.class_as_value(fx, file, class);
                    let is_same = self.emit(fx, Op::StrictEq { a: value, b: own });
                    let (same, other) = (fx.b.new_block(), fx.b.new_block());
                    self.branch(fx, is_same, same, other);
                    fx.b.seal(same);
                    fx.b.seal(other);
                    fx.b.switch_to(other);
                    self.throw_error(fx, b"TypeError", b"Cannot reassign the name of a class declaration: in a compiled program the name always refers to the class");
                    fx.b.switch_to(same);
                }
                _ => {
                    self.unsupported(fx, pos, "an assignment to this kind of declaration");
                }
            },
        }
    }

    fn declared_name_pos(&self, sym: Sym) -> u32 {
        let named = self
            .files
            .decls_of(sym)
            .iter()
            .copied()
            .filter(|declared| declared.0 == sym.file)
            .find_map(|(file, decl)| match decl {
                Decl::Enum(declaration) => Some(self.hir(file)[declaration].name_pos),
                Decl::Module(declaration) => Some(self.hir(file)[declaration].name_pos),
                _ => None,
            });
        named.unwrap_or(0)
    }

    fn enum_object_getter(&mut self, sym: Sym) -> FuncId {
        if let Some(&known) = self.enum_objects.get(&sym) {
            return known;
        }
        let name = self.str(self.files.symbol(sym).name);
        let module = self.module_of(sym.file);
        let pos = self.declared_name_pos(sym);
        let maker = self.add_func(
            name,
            module,
            pos,
            ir::FuncKind::Plain,
            super::Source::EnumObject(sym),
        );
        self.enum_objects.insert(sym, maker);
        maker
    }

    pub(crate) fn enum_global(&mut self, sym: Sym) -> GlobalId {
        if let Some(&known) = self.enum_globals.get(&sym) {
            return known;
        }
        let name = self.str(self.files.symbol(sym).name);
        let global = self.add_global(name, sym.file, Ty::NONE, GlobalKey::Enum(sym.file, sym.id));
        let is_in_file = self.files.decls_of(sym).iter().copied().any(|(file, decl)| {
            let hir = self.hir(file);
            matches!(decl, Decl::Enum(declaration) if matches!(self.c.bound(file).stmt_parent[hir[declaration].stmt.idx()], Parent::File))
        });
        if is_in_file {
            self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        }
        self.enum_globals.insert(sym, global);
        global
    }

    pub(crate) fn emit_enum_object_getter(&mut self, fx: &mut Fx, sym: Sym) {
        let global = self.enum_global(sym);
        let known = self.emit(fx, Op::GlobalGet(global));
        let declarations = self.enum_declarations(sym);
        let is_already_created = self.is_enum_created_at_declaration(sym, &declarations);
        let ([(file, declaration)], false) = (&declarations[..], is_already_created) else {
            self.terminate_with_return(fx, known);
            return;
        };
        let (file, declaration) = (*file, *declaration);
        let is_nullish = self.emit(fx, Op::IsNullish(known));
        let (nullish, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_nullish, nullish, done);
        fx.b.seal(nullish);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, known);
        fx.b.switch_to(nullish);
        let null = self.emit(fx, Op::Null);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: null });
        let (make, not_evaluated) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, make, not_evaluated);
        fx.b.seal(make);
        fx.b.seal(not_evaluated);
        fx.b.switch_to(not_evaluated);
        let undefined = self.emit(fx, Op::Undefined);
        self.terminate_with_return(fx, undefined);
        fx.b.switch_to(make);
        let obj = self.emit(fx, Op::NewObject);
        self.emit_enum_members(fx, obj, file, declaration);
        self.emit(fx, Op::GlobalSet(global, obj));
        self.terminate_with_return(fx, obj);
    }

    pub(crate) fn enum_declarations(&self, sym: Sym) -> Vec<(FileId, bun_sema::hir::EnumId)> {
        let runs = |&(file, decl): &(FileId, Decl)| match decl {
            Decl::Enum(declaration)
                if self.shared.is_compiled(file)
                    && !self.hir(file)[declaration].flags.contains(Flags::AMBIENT) =>
            {
                Some((file, declaration))
            }
            _ => None,
        };
        self.files.decls_of(sym).iter().filter_map(runs).collect()
    }

    pub(crate) fn is_enum_created_at_declaration(
        &mut self,
        sym: Sym,
        declarations: &[(FileId, bun_sema::hir::EnumId)],
    ) -> bool {
        declarations.len() != 1
            || self.files.flags(sym).contains(SymFlags::VALUE_MODULE)
            || declarations.iter().any(|&(file, declaration)| {
                let hir = self.hir(file);
                hir[declaration]
                    .members
                    .iter()
                    .any(|member| self.c.enum_member_value(file, member).is_none())
            })
    }

    pub(crate) fn emit_enum_members(
        &mut self,
        fx: &mut Fx,
        obj: V,
        file: FileId,
        declaration: bun_sema::hir::EnumId,
    ) {
        let hir = self.hir(file);
        for member in hir[declaration].members.iter() {
            let m = &hir[member];
            let member_name = self.str(m.name);
            let Some(value) = self.c.enum_member_value(file, member) else {
                if m.init.is_none() || file != fx.file {
                    self.problem(
                        file,
                        m.pos,
                        "an enum member whose value is computed at run time",
                    );
                    continue;
                }
                let value = self.expr(fx, m.init);
                self.emit_throwing(
                    fx,
                    Op::PropSet {
                        obj,
                        name: member_name,
                        value,
                    },
                );
                let text = self.emit(fx, Op::Str(member_name));
                self.emit_throwing(
                    fx,
                    Op::ElemSet {
                        obj,
                        key: value,
                        value: text,
                    },
                );
                continue;
            };
            match value {
                bun_sema::types::EnumValue::Number(bits) => {
                    let value = self.number(fx, f64::from_bits(bits));
                    self.emit_throwing(
                        fx,
                        Op::PropSet {
                            obj,
                            name: member_name,
                            value,
                        },
                    );
                    let text = self.emit(fx, Op::Str(member_name));
                    self.emit_throwing(
                        fx,
                        Op::ElemSet {
                            obj,
                            key: value,
                            value: text,
                        },
                    );
                }
                bun_sema::types::EnumValue::String(text) => {
                    let text = self.str(text);
                    let value = self.emit(fx, Op::Str(text));
                    self.emit_throwing(
                        fx,
                        Op::PropSet {
                            obj,
                            name: member_name,
                            value,
                        },
                    );
                }
            }
        }
    }

    pub(crate) fn exporting_reified_namespace(&self, sym: Sym) -> Option<Sym> {
        if !self.c.has_reified_namespaces() {
            return None;
        }
        self.files
            .parent_of_symbol(sym)
            .filter(|&namespace| self.c.is_reified_namespace(namespace))
    }

    pub(crate) fn is_exported_by_namespace(&self, sym: Sym) -> bool {
        self.files.parent_of_symbol(sym).is_some_and(|parent| {
            let decls = self.files.decls_of(parent);
            decls
                .iter()
                .any(|(_, decl)| matches!(decl, Decl::Module(_)))
                && !decls.iter().any(|(_, decl)| matches!(decl, Decl::File))
        })
    }

    pub(crate) fn namespace_with_property(&self, sym: Sym) -> Option<Sym> {
        let namespace = self.exporting_reified_namespace(sym)?;
        matches!(self.value_declaration(sym), Some((_, Decl::Var(_)))).then_some(namespace)
    }

    pub(crate) fn namespace_for_outside_ref(
        &mut self,
        fx: &Fx,
        e: ExprId,
        sym: Sym,
    ) -> Option<Sym> {
        let namespace = self.exporting_reified_namespace(sym)?;
        let is_bound_by_block = matches!(
            self.value_declaration(sym),
            Some((
                _,
                Decl::Fn(_) | Decl::Class(_) | Decl::Enum(_) | Decl::Module(_)
            ))
        );
        (is_bound_by_block && !self.c.is_within_declaring_block(fx.file, e, sym))
            .then_some(namespace)
    }

    pub(crate) fn namespace_layout(&mut self, namespace: Sym) -> Option<LayoutId> {
        if self.is_merged_namespace(namespace) {
            return None;
        }
        let checked = self.c.type_of_symbol(namespace);
        if self.is_record_type(checked) {
            self.record_layout(checked)
        } else {
            None
        }
    }

    pub(crate) fn namespace_global(&mut self, namespace: Sym) -> GlobalId {
        if let Some(&known) = self.namespace_globals.get(&namespace) {
            return known;
        }
        let checked = self.c.type_of_symbol(namespace);
        let described = self.ty_of(checked);
        let declared = Ty {
            id: self.or_undefined(described),
            checked,
        };
        let name = self.str(self.files.symbol(namespace).name);
        let global = self.add_global(
            name,
            namespace.file,
            declared,
            GlobalKey::Namespace(namespace.file, namespace.id),
        );
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        self.namespace_globals.insert(namespace, global);
        global
    }

    fn is_merged_namespace(&self, namespace: Sym) -> bool {
        self.files
            .flags(namespace)
            .intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM)
    }

    pub(crate) fn namespace_object(&mut self, fx: &mut Fx, namespace: Sym) -> V {
        if self.is_merged_namespace(namespace) {
            let pos = fx.b.pos;
            return self.read_sym(fx, namespace, pos);
        }
        let global = self.namespace_global(namespace);
        self.emit(fx, Op::GlobalGet(global))
    }

    pub(crate) fn read_namespace_property(
        &mut self,
        fx: &mut Fx,
        namespace: Sym,
        member: Sym,
    ) -> V {
        let obj = self.namespace_object(fx, namespace);
        let name = self.str(self.files.symbol(member).name);
        self.emit_throwing(fx, Op::PropGet { obj, name })
    }

    pub(crate) fn ensure_enum_object(&mut self, fx: &mut Fx, sym: Sym) {
        let global = self.enum_global(sym);
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(
            fx,
            Op::StrictEq {
                a: known,
                b: undefined,
            },
        );
        let (make, created) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, make, created);
        fx.b.seal(make);
        fx.b.switch_to(make);
        let fresh = self.emit(fx, Op::NewObject);
        self.emit(fx, Op::GlobalSet(global, fresh));
        fx.b.jump(created);
        fx.b.seal(created);
        fx.b.switch_to(created);
    }

    pub(crate) fn enter_namespace_block(&mut self, fx: &mut Fx, namespace: Sym) {
        if self.is_merged_namespace(namespace) {
            return;
        }
        let global = self.namespace_global(namespace);
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(
            fx,
            Op::StrictEq {
                a: known,
                b: undefined,
            },
        );
        let (make, created) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, make, created);
        fx.b.seal(make);
        fx.b.switch_to(make);
        let obj = match self.namespace_layout(namespace) {
            Some(layout) => {
                self.record_allocation(layout);
                self.c
                    .record_object_allocated_empty(self.layout_types[&layout], namespace.file);
                self.emit(fx, Op::New(layout))
            }
            None => {
                let checked = self.c.type_of_symbol(namespace);
                self.c.record_object_without_layout(checked);
                self.emit(fx, Op::NewObject)
            }
        };
        self.emit(fx, Op::GlobalSet(global, obj));
        if let Some(outer) = self.exporting_reified_namespace(namespace) {
            let outer = self.namespace_object(fx, outer);
            let name = self.str(self.files.symbol(namespace).name);
            self.emit_throwing(
                fx,
                Op::PropSet {
                    obj: outer,
                    name,
                    value: obj,
                },
            );
        }
        fx.b.jump(created);
        fx.b.seal(created);
        fx.b.switch_to(created);
    }

    pub(crate) fn record_exported_variable_callee(&mut self, fx: &Fx, pat: PatId, init: ExprId) {
        let PatKind::Ident(name) = self.hir(fx.file)[pat].kind else {
            return;
        };
        let Some(id) = self.c.bound(fx.file).pat_symbol[pat.idx()].some() else {
            return;
        };
        let sym = self
            .files
            .export_symbol_of_value_symbol_if_exported(self.files.sym(fx.file, id));
        if let Some(layout) = self
            .namespace_with_property(sym)
            .and_then(|namespace| self.namespace_layout(namespace))
        {
            self.record_stored_callee(fx, layout, name, init, false);
        }
    }

    pub(crate) fn export_from_namespace(&mut self, fx: &mut Fx, sym: Sym, pos: u32) {
        let Some(namespace) = self.exporting_reified_namespace(sym) else {
            return;
        };
        let member = self.files.symbol(sym).name;
        let declared = self.value_symbol(sym);
        if !self
            .files
            .symbol_flags(declared)
            .intersects(SymFlags::VALUE)
        {
            return;
        }
        if let Some((file, func)) = self.function_declaration_for(declared)
            && let Some(holder) = self
                .namespace_layout(namespace)
                .and_then(|layout| self.layout_types.get(&layout).copied())
        {
            self.c.record_declared_callee(holder, member, file, func);
        }
        let value = match self
            .exporting_reified_namespace(declared)
            .filter(|_| declared != sym)
        {
            Some(other) => self.read_namespace_property(fx, other, declared),
            None => self.read_sym(fx, declared, pos),
        };
        let obj = self.namespace_object(fx, namespace);
        let name = self.str(member);
        self.emit_throwing(fx, Op::PropSet { obj, name, value });
    }

    fn namespace_object_getter(&mut self, sym: Sym) -> FuncId {
        if let Some(&known) = self.namespace_objects.get(&sym) {
            return known;
        }
        let name = self.out.strs.intern(b"namespace");
        let module = self.module_of(sym.file);
        let pos = self.declared_name_pos(sym);
        let getter = self.add_func(
            name,
            module,
            pos,
            ir::FuncKind::Plain,
            super::Source::NamespaceObject(sym),
        );
        self.namespace_objects.insert(sym, getter);
        getter
    }

    pub(crate) fn emit_namespace_object_getter(&mut self, fx: &mut Fx, sym: Sym) {
        let name = self.out.strs.intern(b"namespace");
        let global = self.add_global(
            name,
            sym.file,
            Ty::NONE,
            GlobalKey::Namespace(sym.file, sym.id),
        );
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(
            fx,
            Op::StrictEq {
                a: known,
                b: undefined,
            },
        );
        let (create, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, create, done);
        fx.b.seal(create);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, known);
        fx.b.switch_to(create);
        if matches!(self.value_declaration(sym), Some((_, Decl::File))) {
            let obj = self.make_module_namespace(fx, sym.file, false);
            self.emit(fx, Op::GlobalSet(global, obj));
            self.emit_marker_if_required(fx, sym.file, obj);
            return self.terminate_with_return(fx, obj);
        }
        let members = self.namespace_members(sym);
        let obj = self.emit(fx, Op::NewObject);
        self.emit(fx, Op::GlobalSet(global, obj));
        for (name, source) in members {
            let value = self.read_namespace_member(fx, source);
            let name = self.str(name);
            let key = self.emit(fx, Op::Str(name));
            self.operation(fx, Operation::DefineField, &[obj, key, value]);
        }
        self.terminate_with_return(fx, obj);
    }

    fn module_namespace_reader(&mut self, file: FileId) -> FuncId {
        let source = super::Source::ModuleNamespaceReader(file);
        if let Some(&known) = self.deferred_module_functions.get(&source.key()) {
            return known;
        }
        let name = self.name_with_file("exports of", file);
        let module = self.module_of(file);
        let read = self.add_func(name, module, 0, ir::FuncKind::Plain, source);
        self.out.funcs[read.idx()].params = vec![TyId::NONE];
        self.out.funcs[read.idx()].length = 1;
        self.deferred_module_functions.insert(source.key(), read);
        read
    }

    fn make_module_namespace(&mut self, fx: &mut Fx, file: FileId, is_deferred: bool) -> V {
        let members = self.namespace_members(self.files.file_symbol(file));
        let read = self.module_namespace_reader(file);
        let mut arguments = vec![self.emit(fx, Op::FuncRef(read))];
        for &(name, _) in &members {
            let name = self.str(name);
            arguments.push(self.emit(fx, Op::Str(name)));
        }
        if let Some((importer, object)) = self.single_object_behind_stars(file) {
            arguments.push(self.exported_object_namespace(fx, importer, object));
        } else if let Some(assigned) = self
            .files
            .export(
                self.files.file_symbol(file),
                bun_sema::atom::known::export_equals,
            )
            .filter(|_| !is_deferred)
        {
            let assigned = self.read_namespace_member(fx, ImportSource::Declaration(assigned));
            let is_node_mode = self.emit(fx, Op::Bool(true));
            arguments.push(self.operation(fx, Operation::ToESM, &[assigned, is_node_mode]));
        }
        if self.shared.constants.source_path_to_url.is_some() {
            arguments.push(self.emit(fx, Op::Bool(true)));
        }
        if is_deferred {
            arguments.push(self.emit(fx, Op::Null));
        }
        self.operation(fx, Operation::MakeModuleNamespace, &arguments)
    }

    pub(crate) fn deferred_namespace_object(&mut self, fx: &mut Fx, file: FileId) -> V {
        let name = self.out.strs.intern(b"deferred namespace");
        let global = self.add_global(
            name,
            file,
            Ty::NONE,
            GlobalKey::ModuleInternal(file, "deferred namespace"),
        );
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(
            fx,
            Op::StrictEq {
                a: known,
                b: undefined,
            },
        );
        let (create, join) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        self.write(fx, result, known);
        self.branch(fx, is_missing, create, join);
        fx.b.seal(create);
        fx.b.switch_to(create);
        let created = self.make_module_namespace(fx, file, true);
        self.emit(fx, Op::GlobalSet(global, created));
        self.write(fx, result, created);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    pub(crate) fn namespace_members(&mut self, sym: Sym) -> Vec<(Atom, ImportSource)> {
        let exports: Vec<(Atom, ImportSource)> =
            if matches!(self.value_declaration(sym), Some((_, Decl::File))) {
                self.file_exports(sym.file)
            } else {
                self.files
                    .exports(sym)
                    .into_iter()
                    .map(|(name, member)| {
                        (
                            name,
                            if self.entity_alias_declaration(member).is_some() {
                                ImportSource::Entity(member)
                            } else {
                                ImportSource::Declaration(member)
                            },
                        )
                    })
                    .collect()
            };
        let is_assigned_whole = self
            .files
            .export(sym, bun_sema::atom::known::export_equals)
            .is_some();
        let mut members = Vec::with_capacity(exports.len());
        for (name, source) in exports {
            if is_assigned_whole && self.c.atoms().bytes(name) == b"module.exports" {
                continue;
            }
            let is_value = match source {
                ImportSource::Declaration(member) => {
                    let member = self.export_value_symbol(member);
                    let is_expression = self
                        .files
                        .decls_of(member)
                        .iter()
                        .copied()
                        .any(|(_, decl)| matches!(decl, Decl::ExportExpr(_)));
                    let flags = if is_expression {
                        self.files.symbol_flags(member)
                    } else {
                        self.files.flags(member)
                    };
                    flags.intersects(SymFlags::VALUE) && !self.is_ambient(member)
                }
                ImportSource::Entity(alias) => !matches!(
                    self.entity_alias_kind(alias),
                    super::imports::EntityAlias::TypeOnly
                ),
                ImportSource::Unknown => false,
                ImportSource::ExportedObject {
                    file: object,
                    name: Some(_),
                    ..
                } => {
                    !matches!(self.single_object_behind_stars_member(sym.file, name), ImportSource::ExportedObject { file, .. } if file == object)
                }
                _ => true,
            };
            if is_value {
                members.push((name, source));
            }
        }
        members.sort_by_cached_key(|member| {
            bstr::BStr::new(self.c.atoms().bytes(member.0))
                .to_string()
                .encode_utf16()
                .collect::<Vec<u16>>()
        });
        members
    }

    pub(crate) fn read_namespace_member(&mut self, fx: &mut Fx, source: ImportSource) -> V {
        match source {
            ImportSource::Declaration(member) => {
                let member = self.export_value_symbol(member);
                self.read_sym(fx, member, 0)
            }
            ImportSource::Namespace(file) => self.read_sym(fx, self.files.file_symbol(file), 0),
            ImportSource::Entity(alias) => {
                self.check_entity_alias_initialized(fx, alias, ExprId::NONE);
                let name = self.files.symbol(alias).name;
                self.read_binding(fx, Some(alias), name, None, 0, false)
            }
            source => self.read_import(fx, source, 0),
        }
    }

    pub(crate) fn emit_module_namespace_reader(&mut self, fx: &mut Fx, file: FileId) {
        let number = self.add_entry_param(fx, Ty::NONE);
        let number = self.emit_throwing(
            fx,
            Op::Coerce {
                value: number,
                to: self.known.int32,
                why: CoerceReason::Claim,
            },
        );
        if self.shared.modules_deferred.contains(&file) {
            self.emit_module_evaluation(fx, file);
        }
        let members = self.namespace_members(self.files.file_symbol(file));
        let arms: Vec<crate::id::BlockId> = members.iter().map(|_| fx.b.new_block()).collect();
        let none = fx.b.new_block();
        let cases = arms
            .iter()
            .enumerate()
            .map(|(number, &arm)| (number as i64, ir::Target::new(arm)))
            .collect();
        fx.b.terminate(ir::Term::Switch {
            value: number,
            cases,
            default: ir::Target::new(none),
        });
        for (&arm, (_, source)) in arms.iter().zip(members) {
            fx.b.seal(arm);
            fx.b.switch_to(arm);
            let value = self.read_namespace_member(fx, source);
            self.terminate_with_return(fx, value);
        }
        fx.b.seal(none);
        fx.b.switch_to(none);
        let undefined = self.emit(fx, Op::Undefined);
        self.terminate_with_return(fx, undefined);
    }

    pub(crate) fn declare_function(
        &mut self,
        file: FileId,
        func: FnId,
        class: Option<(FileId, hir::ClassId)>,
    ) -> FuncId {
        if let Some(&id) = self.funcs.get(&(file, func)) {
            return id;
        }
        if file == self.file {
            return self.redeclare_function(file, func, class);
        }
        self.declare_imported_function(file, func, class)
    }

    pub(super) fn redeclare_function(
        &mut self,
        file: FileId,
        func: FnId,
        class: Option<(FileId, hir::ClassId)>,
    ) -> FuncId {
        if self.is_in_untyped_clone(file, func) {
            return self.declare_function_as(file, func, class, Role::Second);
        }
        if !self.builds_untyped_clone(file, func) {
            if class.is_none() && self.destructures_parameters_at_entry(file, func) {
                let entry = self.declare_function_as(file, func, class, Role::Entry);
                let typed = self.declare_function_as(file, func, class, Role::Typed);
                self.typed_bodies.insert(entry, typed);
                return entry;
            }
            let whole = self.declare_function_as(file, func, class, Role::Whole);
            if (class.is_none() || self.hir(file)[func].kind == hir::FnKind::Arrow)
                && self.query(|c| c.has_logging_untyped_clone(file, func))
                && self.has_annotated_parameter(file, func)
            {
                let entry = self.declare_function_as(file, func, class, Role::Beside);
                if file == self.file {
                    let second = self.declare_function_as(file, func, class, Role::Second);
                    self.typed_bodies.insert(entry, whole);
                    self.untyped_clones.insert(entry, second);
                }
                self.generic_entrypoints.insert(whole, entry);
                self.generic_entrypoint_ids.insert(entry);
            }
            return whole;
        }
        let entry = self.declare_function_as(file, func, class, Role::Entry);
        let typed = self.declare_function_as(file, func, class, Role::Typed);
        self.typed_bodies.insert(entry, typed);
        if file == self.file {
            let second = self.declare_function_as(file, func, class, Role::Second);
            self.untyped_clones.insert(entry, second);
        }
        entry
    }

    fn destructures_parameters_at_entry(&mut self, file: FileId, func: FnId) -> bool {
        self.hir(file)[func]
            .params
            .iter()
            .any(|p| self.destructured_names(file, p).is_some())
            && self.query(|c| c.is_exported_to_unseen_files(file, func))
            && self.has_annotated_parameter(file, func)
    }

    pub(crate) fn destructured_names(&self, file: FileId, p: hir::ParamId) -> Option<Vec<Atom>> {
        let hir = self.hir(file);
        let PatKind::Object(properties) = hir[hir[p].pat].kind else {
            return None;
        };
        if hir[p].default.is_some() || hir[p].flags.contains(Flags::REST) {
            return None;
        }
        let mut names = Vec::new();
        for property in properties.iter().map(|property| &hir[property]) {
            let hir::PropKey::Name(name) = property.key else {
                return None;
            };
            let is_bound_to_a_name = matches!(hir[property.value].kind, PatKind::Ident(_));
            let has_only_literal_default = property.default.is_none()
                || matches!(
                    hir[property.default].kind,
                    hir::ExprKind::Null
                        | hir::ExprKind::True
                        | hir::ExprKind::False
                        | hir::ExprKind::Number(_)
                        | hir::ExprKind::String(_)
                        | hir::ExprKind::BigInt(_)
                );
            if property.is_rest
                || !is_bound_to_a_name
                || !has_only_literal_default
                || names.contains(&name)
            {
                return None;
            }
            names.push(name);
        }
        (!names.is_empty()).then_some(names)
    }

    fn builds_untyped_clone(&mut self, file: FileId, func: FnId) -> bool {
        if !self.query(|c| c.has_untyped_clone(file, func)) {
            return false;
        }
        self.has_annotated_parameter(file, func)
    }

    fn has_annotated_parameter(&mut self, file: FileId, func: FnId) -> bool {
        let using = self.using_arguments(file);
        if using.functions.contains(&func)
            || using.arrows.contains(&func)
            || self
                .shared
                .builtin_functions
                .for_declaration(file, func)
                .is_some()
        {
            return false;
        }
        self.hir(file)[func].params.iter().any(|p| {
            let target_ty = self.param_ty(file, p).id;
            target_ty.is_some()
                && target_ty != self.out.tys.anything
                && self.param_cast_reason(file, p) == CoerceReason::Cast
        })
    }

    pub(crate) fn declare_function_as(
        &mut self,
        file: FileId,
        func: FnId,
        class: Option<(FileId, hir::ClassId)>,
        role: Role,
    ) -> FuncId {
        let is_untyped_clone_root = role == Role::Second && !self.is_in_untyped_clone(file, func);
        let is_uninformative = matches!(role, Role::Entry | Role::Beside | Role::Second);
        let hir = self.hir(file);
        let f = &hir[func];
        let builtin = self
            .shared
            .builtin_functions
            .for_declaration(file, func)
            .copied();
        if f.name.is_none() && f.kind == hir::FnKind::Decl && f.flags.contains(Flags::DEFAULT) {
            let name = self.out.strs.intern(b"default");
            self.inferred_function_names
                .entry((file, func))
                .or_insert(name);
        }
        let name = match self.inferred_function_names.get(&(file, func)) {
            _ if builtin.is_some_and(|builtin| builtin.name.is_some() || builtin.is_getter) => {
                let prefix: &[u8] = if builtin.is_some_and(|builtin| builtin.is_getter) {
                    b"get "
                } else {
                    b""
                };
                let name = [
                    prefix,
                    self.c
                        .atoms()
                        .bytes(builtin.and_then(|builtin| builtin.name).unwrap_or(f.name)),
                ]
                .concat();
                self.out.strs.intern(&name)
            }
            _ if f.name.is_some()
                && matches!(f.kind, hir::FnKind::Getter | hir::FnKind::Setter) =>
            {
                let prefix: &[u8] = if f.kind == hir::FnKind::Getter {
                    b"get "
                } else {
                    b"set "
                };
                let name = [prefix, self.c.atoms().bytes(f.name)].concat();
                self.out.strs.intern(&name)
            }
            _ if f.name.is_some() => self.str(f.name),
            Some(&given) => given,
            None => self.out.strs.intern(b""),
        };
        let kind = match f.kind {
            _ if builtin.is_some_and(|builtin| !builtin.is_constructor) => ir::FuncKind::Method,
            hir::FnKind::Arrow => ir::FuncKind::Arrow,
            hir::FnKind::Method | hir::FnKind::Getter | hir::FnKind::Setter => ir::FuncKind::Method,
            hir::FnKind::Constructor => ir::FuncKind::Constructor,
            _ => ir::FuncKind::Plain,
        };
        let module = self.module_of(file);
        let untyped_clone_root = match role {
            Role::Second if is_untyped_clone_root => func,
            Role::Second => self.untyped_clone_root.unwrap_or(func),
            _ => FnId::NONE,
        };
        let source = super::Source::Function {
            file,
            func,
            class,
            role,
            untyped_clone_root,
        };
        let id = if is_untyped_clone_root {
            let id = self.add_header(name, module, f.start, kind, source);
            self.untyped_clone_worklist.push_back(id);
            id
        } else {
            self.add_func(name, module, f.start, kind, source)
        };
        if !matches!(role, Role::Typed | Role::Beside) && !is_untyped_clone_root {
            let was = self.funcs.insert((file, func), id);
            if let Some(undo) = &mut self.undo {
                undo.funcs.push(((file, func), was));
            }
        }
        let uses_arguments = self.uses_arguments(file, func);
        let is_sloppy = self.query(|c| c.is_sloppy_function(file, func));
        let mut signature = Signature::default();
        let (mut params, mut annotated) = (Vec::new(), Vec::new());
        for p in f.params.iter() {
            let param = if is_uninformative {
                Ty::NONE
            } else {
                self.param_ty(file, p)
            };
            params.push(param.id);
            annotated
                .push(param.id.is_some() && self.param_cast_reason(file, p) == CoerceReason::Cast);
            signature.params.push(param.checked);
        }
        let has_this = match kind {
            ir::FuncKind::Arrow => false,
            ir::FuncKind::Plain => self.query(|c| c.inspects_this(file, func)),
            _ => true,
        };
        let mut flags = if has_this { func_flags::HAS_THIS } else { 0 };
        if builtin.is_none()
            && f.name.is_none()
            && self.inferred_function_names.contains_key(&(file, func))
        {
            flags |= func_flags::HAS_EXPLICIT_NAME;
        }
        if matches!(role, Role::Entry | Role::Beside)
            || self.shared.validation_helpers() == Some(file)
        {
            flags |= func_flags::IS_HIDDEN_IN_STACK_TRACES;
        }
        if role == Role::Beside {
            flags |= func_flags::IS_GENERIC_ENTRYPOINT;
        }
        if f.flags.contains(Flags::ASYNC) && role != Role::Beside {
            flags |= func_flags::ASYNC;
        }
        if f.flags.contains(Flags::GENERATOR) {
            flags |= func_flags::GENERATOR;
            if f.params.iter().any(|p| {
                hir[p].default.is_some() || !matches!(hir[hir[p].pat].kind, hir::PatKind::Ident(_))
            }) {
                flags |= func_flags::STARTS_EAGERLY;
            }
        }
        if f.params
            .iter()
            .next_back()
            .is_some_and(|p| hir[p].flags.contains(Flags::REST))
        {
            flags |= func_flags::HAS_REST;
        }
        if uses_arguments {
            signature.params.clear();
            params = vec![TyId::NONE];
            annotated.clear();
            flags |= func_flags::HAS_REST;
        }
        if kind == ir::FuncKind::Plain
            && flags & (func_flags::ASYNC | func_flags::GENERATOR) == 0
            && self.query(|c| c.mentions_new_target(file, func))
        {
            flags |= func_flags::HAS_NEW_TARGET;
        }
        if kind == ir::FuncKind::Plain
            && self.query(|c| c.has_no_field_names_on_prototype(file, func))
        {
            flags |= func_flags::HAS_NO_FIELD_NAMES_ON_PROTOTYPE;
        }
        let declared_this_type = if has_this && !self.is_untyped_file(file) && !is_uninformative {
            match self.query(|c| c.fn_this_type(file, func)) {
                Some(this) => {
                    signature.this = Some(this);
                    self.declared(this)
                }
                None => TyId::NONE,
            }
        } else {
            TyId::NONE
        };
        let result = if is_uninformative
            || matches!(
                f.kind,
                hir::FnKind::Constructor | hir::FnKind::Setter | hir::FnKind::StaticBlock
            ) {
            TyId::NONE
        } else if self.is_untyped_file(file) {
            let kinds = self.query(|c| c.returned_kinds(file, func));
            let described = self.kinds_ty(kinds);
            self.none_if_unranged_number(described)
        } else if self.query(|c| c.never_returns(file, func)) {
            TyId::NONE
        } else if self.query(|c| c.returns_no_value(file, func)) {
            signature.result = Some(TypeId::UNDEFINED);
            self.declared(TypeId::UNDEFINED)
        } else {
            let (result, is_annotated) = self.query(|c| c.fn_result_type(file, func));
            if result.is_never() {
                TyId::NONE
            } else {
                signature.result = Some(result);
                signature.is_result_annotated = is_annotated;
                let described = self.declared(result);
                let described = if described.is_none()
                    && f.flags.contains(Flags::ASYNC)
                    && !f.flags.contains(Flags::GENERATOR)
                {
                    self.out
                        .tys
                        .intern(crate::declared::Declared::any_object().nullable())
                } else {
                    described
                };
                let written = self.query(|c| c.annotated_result_integer_range(file, func));
                self.with_integers(described, written)
            }
        };
        self.set_signature(id, signature);
        let out = &mut self.out.funcs[id.idx()];
        out.params = params;
        out.annotated = annotated;
        out.declared_this_type = declared_this_type;
        out.result = result;
        out.flags = flags | if is_sloppy { func_flags::IS_SLOPPY } else { 0 };
        out.length = f
            .params
            .iter()
            .take_while(|&p| hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST))
            .count() as u16;
        if file == self.file {
            let captures = self.c.fn_captures(file, func);
            self.set_captures(id, &captures);
        }
        id
    }

    pub(crate) fn uses_arguments(&self, file: FileId, func: FnId) -> bool {
        func.is_some() && self.using_arguments(file).functions.contains(&func)
    }

    pub(crate) fn using_arguments(&self, file: FileId) -> &'c UsingArguments {
        self.shared.using_arguments[file.idx()].get_or_init(|| {
            let hir = self.hir(file);
            let bound = self.c.bound(file);
            let mut found = UsingArguments::default();
            for (i, e) in hir.exprs.iter().enumerate() {
                let id = ExprId(i as u32);
                let is_object = matches!(e.kind, hir::ExprKind::Ident(name) if name == bun_sema::atom::known::arguments) && bound.is_arguments_object(id);
                let is_intrinsic = self.is_builtin_file(file) && matches!(e.kind, hir::ExprKind::Ident(name) if matches!(self.c.atoms().bytes(name), b"$argumentCount" | b"$argument"));
                if !is_object && !is_intrinsic {
                    continue;
                }
                let mut at = self.enclosing_function(file, id);
                while at.is_some() && hir[at].kind == hir::FnKind::Arrow {
                    found.arrows.insert(at);
                    at = bound.fns[at.idx()].enclosing;
                }
                found.functions.insert(at);
                if is_object {
                    found.objects.insert(at);
                }
            }
            found
        })
    }

    pub(crate) fn function_of_declaration(
        &mut self,
        fx: &Fx,
        file: FileId,
        func: FnId,
    ) -> Option<FuncId> {
        if let Some(&id) = self.funcs.get(&(file, func)) {
            return Some(id);
        }
        let _ = fx;
        if self.c.bound(file).fns[func.idx()].enclosing.is_none()
            && !matches!(self.hir(file)[func].body, hir::FnBody::None)
        {
            return Some(self.declare_function(file, func, None));
        }
        None
    }

    fn function_value(&mut self, fx: &mut Fx, file: FileId, func: FnId, pos: u32) -> V {
        let Some(id) = self.function_of_declaration(fx, file, func) else {
            return self.unsupported(
                fx,
                pos,
                "a function that is declared later in an inner scope",
            );
        };
        self.make_closure(fx, id)
    }

    pub(crate) fn make_closure(&mut self, fx: &mut Fx, id: FuncId) -> V {
        let captures = self.capture_values(fx, id, 0);
        if captures.is_empty() {
            return self.emit(fx, Op::FuncRef(id));
        }
        self.emit(fx, Op::Closure { func: id, captures })
    }

    pub(crate) fn function_declaration_for(&self, sym: Sym) -> Option<(FileId, FnId)> {
        let decls = self.files.decls_of(sym);
        if decls
            .iter()
            .any(|declared| matches!(declared.1, Decl::Var(_) | Decl::Param(_)))
        {
            return None;
        }
        let with_body = |&(file, decl): &(FileId, Decl)| matches!(decl, Decl::Fn(func) if !matches!(self.hir(file)[func].body, hir::FnBody::None));
        let Some((file, Decl::Fn(func))) = decls.iter().copied().rfind(with_body) else {
            return None;
        };
        (!self.is_ambient(sym) && !self.is_assigned(sym)).then_some((file, func))
    }

    fn declaration_closure(&mut self, fx: &mut Fx, sym: Sym, id: FuncId, pos: u32) -> V {
        let declared = self
            .function_declaration_for(sym)
            .filter(|declared| declared.0 == self.file);
        if let Some((file, func)) = declared
            && self.is_function_expression_name(sym)
            && let Some((activation, field)) = self.function_expression_scope(file, func)
        {
            let layout = self.activation_layout(activation);
            let env = self.env_for_layout(fx, layout);
            let captures = self.capture_values(fx, id, pos);
            return self.emit(
                fx,
                Op::ClosureOnce {
                    func: id,
                    captures,
                    env,
                    field,
                },
            );
        }
        match declared.and_then(|(file, func)| self.c.declared_closure(file, func)) {
            None | Some(DeclaredClosure::Unobserved | DeclaredClosure::CreatedAtEntry) => {
                self.make_closure(fx, id)
            }
            Some(DeclaredClosure::CreatedAtUse) => {
                let captures = self.capture_values(fx, id, pos);
                self.emit(fx, Op::Closure { func: id, captures })
            }
            Some(DeclaredClosure::KeptInEnvironment(activation, field)) => {
                let layout = self.activation_layout(activation);
                let env = self.env_for_layout(fx, layout);
                let captures = self.capture_values(fx, id, pos);
                self.emit(
                    fx,
                    Op::ClosureOnce {
                        func: id,
                        captures,
                        env,
                        field,
                    },
                )
            }
        }
    }

    pub(crate) fn function_expression_scope(
        &mut self,
        file: FileId,
        func: FnId,
    ) -> Option<(Activation, u32)> {
        match self.c.declared_closure(file, func) {
            Some(DeclaredClosure::KeptInEnvironment(
                activation @ Activation::Expression(_),
                field,
            )) => Some((activation, field)),
            _ => self
                .c
                .cached_function_expression(file, func)
                .filter(|retained| matches!(retained.0, Activation::Expression(_))),
        }
    }

    pub(crate) fn current_closure(&mut self, fx: &mut Fx) -> V {
        let (file, func, id) = (fx.file, fx.func, fx.id);
        let pos = self.hir(file)[func].start;
        if let Some((activation, field)) = self.function_expression_scope(file, func) {
            let layout = self.activation_layout(activation);
            let env = self.env_for_layout(fx, layout);
            let captures = self.capture_values(fx, id, pos);
            return self.emit(
                fx,
                Op::ClosureOnce {
                    func: id,
                    captures,
                    env,
                    field,
                },
            );
        }
        if matches!(
            self.c.bound(file).fns[func.idx()].owner,
            bun_sema::bind::FnOwner::Stmt(_)
        ) {
            let sym = self.function_symbol(file, func);
            if self.function_declaration_for(sym) == Some((file, func)) {
                return self.declaration_closure(fx, sym, id, pos);
            }
        }
        self.unsupported(fx, pos, "the `arguments` object of sloppy-mode code, which exposes the function, in a function whose name is assigned to")
    }

    pub(crate) fn pattern_names(&self, file: FileId, pat: PatId, out: &mut Vec<Sym>) {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                let id = self.c.bound(file).pat_symbol[pat.idx()];
                if id.is_some() {
                    out.push(
                        self.files
                            .export_symbol_of_value_symbol_if_exported(self.files.sym(file, id)),
                    );
                }
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    self.pattern_names(file, hir[p].value, out);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.pattern_names(file, hir[e].pat, out);
                }
            }
        }
    }

    pub(crate) fn lexical_names(&self, file: FileId, stmts: IdList<StmtId>, out: &mut Vec<Sym>) {
        let hir = self.hir(file);
        for stmt in hir.ids(stmts) {
            match hir[stmt].kind {
                StmtKind::Var(decls) => {
                    for d in decls.iter() {
                        if hir[d].kind != VarKind::Var && !hir[d].flags.contains(Flags::AMBIENT) {
                            self.pattern_names(file, hir[d].pat, out);
                        }
                    }
                }
                StmtKind::Class(class)
                    if !hir[class].flags.contains(Flags::AMBIENT)
                        && !self.c.is_evaluated_once(file, Parent::Stmt(stmt)) =>
                {
                    out.push(self.class_symbol(file, class));
                }
                _ => {}
            }
        }
    }

    pub(crate) fn class_symbol(&self, file: FileId, class: hir::ClassId) -> Sym {
        let id = self.c.bound(file).symbol_of_declaration(Decl::Class(class));
        self.files
            .export_symbol_of_value_symbol_if_exported(self.files.sym(file, id))
    }

    pub(crate) fn var_names(&self, file: FileId, stmt: StmtId, out: &mut Vec<Sym>) {
        if stmt.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::Var(decls) => {
                for d in decls.iter() {
                    if hir[d].kind == VarKind::Var && !hir[d].flags.contains(Flags::AMBIENT) {
                        self.pattern_names(file, hir[d].pat, out);
                    }
                }
            }
            StmtKind::If { yes, no, .. } => {
                self.var_names(file, yes, out);
                self.var_names(file, no, out);
            }
            StmtKind::For { init, body, .. } => {
                self.var_names(file, init, out);
                self.var_names(file, body, out);
            }
            StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
                self.var_names(file, left, out);
                self.var_names(file, body, out);
            }
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => self.var_names(file, body, out),
            StmtKind::Block(stmts) => {
                for s in hir.ids(stmts) {
                    self.var_names(file, s, out);
                }
            }
            StmtKind::Switch { cases, .. } => {
                for case in cases.iter() {
                    for s in hir.ids(hir[case].body) {
                        self.var_names(file, s, out);
                    }
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.var_names(file, block, out);
                self.var_names(file, handler, out);
                self.var_names(file, finalizer, out);
            }
            _ => {}
        }
    }
}

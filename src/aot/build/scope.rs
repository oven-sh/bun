//! Variables: which are values of the function being built, which live in an environment, which are static.

use super::fit::{Signature, Ty};
use super::{FileBuild, Fx, ImportSource, Place, Problem, Role, UsingArguments};
use crate::declared::{Declared, prim};
use crate::fragment::GlobalKey;
use crate::id::{FuncId, GlobalId, LayoutId, StrId, TyId, V};
use crate::ir::{self, Field, LayoutKind, Op, Why, func_flags};
use bun_sema::types::TypeId;
use bun_sema::atom::Atom;
use bun_sema::bind::{ClassOwner, Decl, Parent, PatParent, SymFlags};
use bun_sema::check::{Activation, Capture, CapturedVariable, DeclaredClosure, Receiver};
use bun_sema::hir::{self, ExprId, Flags, FnId, IdList, PatId, PatKind, StmtId, StmtKind, VarKind};
use bun_sema::program::{FileId, Sym};

/// `Closure::maxNumberOfCaptures` of the engine, which has a byte for the number.
const MAX_CAPTURES: usize = 255;

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    /// `export default e` takes the value of `e` when it is evaluated. Where `e` names a binding of the program that never changes,
    /// the export is as good as that binding, which is returned.
    pub(crate) fn binding_exported_as_default(&mut self, file: FileId, e: hir::ExprId) -> Option<Sym> {
        self.binding_exported_as_default_after(file, e, &mut Vec::new())
    }

    /// `seen`: see `value_symbol_of_export_after`.
    pub(crate) fn binding_exported_as_default_after(&mut self, file: FileId, e: hir::ExprId, seen: &mut Vec<Sym>) -> Option<Sym> {
        let hir::ExprKind::Ident(name) = self.hir(file)[e].kind else { return None };
        let named = self.c.binding_of_identifier(file, e, name)?;
        let sym = self.value_symbol_after(named, seen);
        let is_assigned_later = self.c.is_hoisted(sym) && !self.c.is_constant(sym) && !self.is_var_initialized_once_before(sym, file, self.hir(file)[e].pos);
        (!self.is_ambient(sym) && !self.is_assigned(sym) && !is_assigned_later).then_some(sym)
    }

    /// Whether something assigns to the binding after its declaration.
    /// Whether it is the own name of a function expression, which nothing can be stored to.
    fn is_var_initialized_once_before(&self, sym: Sym, file: FileId, pos: u32) -> bool {
        let Some((of, Decl::Var(pat))) = self.value_declaration(sym) else { return false };
        if of != file {
            return false;
        }
        let (hir, bound) = (self.hir(of), self.c.bound(of));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return false };
        let stmt = bound.var_stmt[d.idx()];
        let is_declared_once = bound.symbols.get(bound.pat_symbol[pat.idx()].idx()).is_some_and(|symbol| symbol.decls.len() == 1);
        is_declared_once && hir[d].init.is_some() && stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Var(_)) && matches!(bound.stmt_parent[stmt.idx()], Parent::File) && hir[stmt].start < pos
    }

    pub(crate) fn names_function_expression(&self, sym: Sym) -> bool {
        matches!(self.value_declaration(sym), Some((file, Decl::Fn(func))) if matches!(self.c.bound(file).fns[func.idx()].owner, bun_sema::bind::FnOwner::Expr(_)))
    }

    pub(crate) fn is_assigned(&self, sym: Sym) -> bool {
        if self.names_function_expression(sym) {
            return false;
        }
        if self.files.flags(sym).contains(SymFlags::ASSIGNED) {
            return true;
        }
        self.has_local_flags(sym, SymFlags::ASSIGNED) || self.c.is_stored_to_through_cast(sym)
    }

    pub(crate) fn function_symbol(&self, file: FileId, func: FnId) -> Sym {
        let id = self.c.bound(file).symbol_of_declaration(Decl::Fn(func));
        self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(file, id))
    }

    /// `import a from "./a.txt" with { type: "text" }`: the bundler provides the value, whatever the file is.
    pub(crate) fn is_import_of_asset(&self, file: FileId, stmt: StmtId) -> bool {
        let hir = self.hir(file);
        let (start, end) = (hir[stmt].start, hir[stmt].loc.end);
        hir.import_attributes.iter().any(|&(pos, attributes)| {
            let hir::ExprKind::Object(props) = hir[attributes].kind else { return false };
            start <= pos
                && pos < end
                && props.iter().any(|p| {
                    let hir::PropKey::Name(key) = hir[p].key else { return false };
                    let hir::ExprKind::String(value) = hir[hir[p].value].kind else { return false };
                    self.c.atoms().bytes(key) == b"type" && !matches!(self.c.atoms().bytes(value), b"json" | b"js" | b"ts" | b"jsx" | b"tsx")
                })
        })
    }

    pub(crate) fn type_attribute(&self, file: FileId, stmt: StmtId) -> Option<Atom> {
        let hir = self.hir(file);
        let (start, end) = (hir[stmt].start, hir[stmt].loc.end);
        hir.import_attributes.iter().find_map(|&(pos, attributes)| {
            let hir::ExprKind::Object(props) = hir[attributes].kind else { return None };
            if pos < start || end <= pos {
                return None;
            }
            props.iter().find_map(|p| {
                let hir::PropKey::Name(key) = hir[p].key else { return None };
                let hir::ExprKind::String(value) = hir[hir[p].value].kind else { return None };
                (self.c.atoms().bytes(key) == b"type").then_some(value)
            })
        })
    }

    /// `symbol.ValueDeclaration`, also of `const a = require("a")` in JavaScript, which the type checker takes for an import.
    pub(crate) fn value_declaration(&self, sym: Sym) -> Option<(FileId, Decl)> {
        self.files.value_declaration(sym).or_else(|| {
            self.files.decls(sym).into_iter().find_map(|(file, decl)| match decl {
                Decl::Require(pat) => Some((file, Decl::Var(pat))),
                // `export default a`, which the type checker takes for an alias of `a`, and which holds the value `a` had.
                Decl::ExportExpr(_) => Some((file, decl)),
                _ => None,
            })
        })
    }

    /// Not `const a = require("a")` in JavaScript, which the type checker takes for an import and which is a variable.
    pub(crate) fn is_declared_by_import(&self, sym: Sym) -> bool {
        // `import { Node }` of a type next to `function Node() {}`: one symbol, whose value is the function.
        if matches!(self.files.value_declaration(sym), Some((_, Decl::Fn(_) | Decl::Var(_) | Decl::Class(_)))) {
            return false;
        }
        self.files.decls(sym).into_iter().any(|(_, decl)| {
            matches!(
                decl,
                Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) | Decl::ExportSpec(_) | Decl::ExportStarAs(_) | Decl::ImportEquals(_)
            )
        })
    }

    /// Whether the symbol is declared and nothing in the program defines it: the declaration has no body, or its file is not compiled with the
    /// program. That is a declaration file, a file that stands in for one, and a file that is only imported for its types. A value of such
    /// a type comes from outside the program if there is any.
    pub(crate) fn is_ambient(&self, sym: Sym) -> bool {
        if let Some(&known) = self.ambient.borrow().get(&sym) {
            return known;
        }
        let found = self.find_is_ambient(sym);
        self.ambient.borrow_mut().insert(sym, found);
        found
    }

    fn find_is_ambient(&self, sym: Sym) -> bool {
        if self.files.flags(sym).contains(SymFlags::ALIAS) && self.is_declared_by_import(sym) {
            return true;
        }
        if self.files.flags(sym).intersects(SymFlags::ENUM) && !self.declarations_of_enum(sym).is_empty() {
            return false;
        }
        let Some((file, decl)) = self.value_declaration(sym) else {
            return true;
        };
        !self.shared.is_compiled(file) || self.c.bound(file).modifier_flags(self.hir(file), decl).contains(Flags::AMBIENT)
    }

    /// The function whose activation holds the variable. `Some(NONE)`: the file. `None`: it is not a variable of the program.
    pub(crate) fn function_declaring(&self, sym: Sym) -> Option<FnId> {
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
                            return Some(self.c.enclosing_fn(file, bound.stmt_parent[stmt.idx()]).unwrap_or(FnId::NONE));
                        }
                        PatParent::Param(p) => return Some(bound.param_fn[p.idx()]),
                        PatParent::None => return None,
                    }
                }
            }
            Decl::Fn(func) => Some(bound.fns[func.idx()].enclosing),
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                owner @ ClassOwner::Stmt(_) => Some(self.c.enclosing_fn(file, owner.to_parent()).unwrap_or(FnId::NONE)),
                ClassOwner::Expr(_) => None,
            },
            _ => None,
        }
    }

    /// The function whose activation evaluates the expression.
    pub(crate) fn function_running(&self, file: FileId, e: ExprId) -> FnId {
        self.c.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE)
    }

    /// An instance field initializer is evaluated by the constructor, not by the function the class is defined in.
    pub(crate) fn is_in_instance_field_initializer(&self, file: FileId, e: ExprId) -> bool {
        let mut parent = self.c.way_up_from_expression(file, e);
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => self.c.way_up_from_expression(file, e),
                Parent::Stmt(s) if s.is_some() => self.c.way_up_from_statement(file, s),
                Parent::MemberInit(member) => return !self.hir(file)[member].flags.contains(Flags::STATIC),
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::None | Parent::File => return false,
                _ => self.c.parent_of_node(file, parent),
            };
        }
    }

    // ───────────────────────────── static variables ─────────────────────────────

    pub(crate) fn add_global(&mut self, name: StrId, file: FileId, declared: Ty, key: GlobalKey) -> GlobalId {
        let id = GlobalId::new(self.out.globals.len());
        let module = self.module_of(file);
        self.out.globals.push(ir::Global { name, module, declared: declared.id, initialization: ir::Initialization::Uninitialized, only_function: FuncId::NONE, only_function_flags: 0 });
        self.global_keys.push(key);
        if declared.checked != TypeId::UNRESOLVED {
            self.checked_globals.insert(id, declared.checked);
        }
        id
    }

    pub(crate) fn global_of(&mut self, sym: Sym) -> GlobalId {
        if let Some(Place::Global(g)) = self.places.get(&sym) {
            return *g;
        }
        let name = self.str(self.files.symbol(sym).name);
        let mut declared = self.ty_of_symbol(sym);
        // A `var` is `undefined` from the time its module is linked, before any code runs, whether or not anybody gets to see that.
        let is_var = self.files.flags(sym).contains(SymFlags::FUNCTION_SCOPED_VARIABLE) || self.has_local_flags(sym, SymFlags::FUNCTION_SCOPED_VARIABLE) || self.c.is_hoisted(sym);
        if is_var && declared.id.is_some() {
            declared.id = self.or_undefined(declared.id);
        }
        let is_lazy = !is_var && self.is_lazy(sym);
        if is_lazy && declared.id.is_some() {
            let or_nullish = self.out.tys.get(declared.id).or(&Declared::prims(prim::NULLISH));
            declared.id = self.out.tys.intern(or_nullish);
        }
        let g = self.add_global(name, sym.file, declared, GlobalKey::Symbol(sym.file, sym.id));
        let was = self.places.insert(sym, Place::Global(g));
        if let Some(undo) = &mut self.undo {
            undo.places.push((sym, was));
        }
        if is_lazy {
            self.lazy_globals.insert(g, sym);
        }
        if let Some((file, func)) = self.hoisted_function_of(sym) {
            let name = [self.c.atoms().bytes(self.files.symbol(sym).name), b" is bound"].concat();
            let name = self.out.strs.intern(&name);
            let is_bound = self.add_global(name, sym.file, Ty::NONE, GlobalKey::StateOfLazyVariable(sym.file, sym.id));
            self.out.globals[is_bound.idx()].initialization = ir::Initialization::Undefined;
            self.hoisted_functions.insert(g, (is_bound, file, func));
        }
        if is_var || is_lazy {
            self.out.globals[g.idx()].initialization = if is_lazy { ir::Initialization::Lazy } else { ir::Initialization::Undefined };
        } else if self.c.is_never_seen_uninitialized(sym) {
            let is_stored_once = self.c.is_constant(sym) && !self.is_evaluated_when_touched(sym.file);
            self.out.globals[g.idx()].initialization = if is_stored_once { ir::Initialization::NeverSeenAndStoredOnce } else { ir::Initialization::NeverSeen };
        }
        let (only_function, only_function_flags) = self.only_function_of(sym);
        self.out.globals[g.idx()].only_function = only_function;
        // The slot of a lazy variable holds nil at first.
        self.out.globals[g.idx()].only_function_flags = if is_lazy && only_function_flags & ir::only_function_flags::IS_FACT != 0 { ir::only_function_flags::OR_NULLISH } else { only_function_flags };
        g
    }

    fn hoisted_function_of(&self, sym: Sym) -> Option<(FileId, FnId)> {
        let with_body = |&(file, decl): &(FileId, Decl)| matches!(decl, Decl::Fn(func) if !matches!(self.hir(file)[func].body, hir::FnBody::None));
        let Some((file, Decl::Fn(func))) = self.files.decls(sym).into_iter().filter(with_body).next_back() else { return None };
        let hir = self.hir(file);
        let is_at_top_level = hir.ids(hir.body).any(|stmt| matches!(hir[stmt].kind, StmtKind::Fn(declared) if declared == func));
        (is_at_top_level && !self.is_commonjs(file)).then_some((file, func))
    }

    pub(crate) fn try_bind_hoisted_function(&mut self, fx: &mut Fx, sym: Sym, func: FnId) -> bool {
        let Some(&Place::Global(global)) = self.places.get(&sym) else { return false };
        let Some(&(is_bound, file, hoisted)) = self.hoisted_functions.get(&global) else { return false };
        if hoisted != func {
            return false;
        }
        self.bind_hoisted_function(fx, global, is_bound, file, hoisted);
        true
    }

    /// `Field::only_function` and `Field::only_function_flags` for a variable. Every store to a variable is seen, so each function that it ever
    /// holds is a closure of that one. It is a fact unless a read may find nil, which is then the only other value.
    fn only_function_of(&mut self, sym: Sym) -> (FuncId, u8) {
        // A class object is a closure of the constructor.
        if let Some((file, class)) = self.c.class_held_by_variable(sym) {
            return (self.name_constructor(file, class), ir::only_function_flags::IS_FACT);
        }
        match self.c.only_function_of_variable(sym) {
            Some(only) if only.is_predicted => (self.name_function(only.file, only.func), 0),
            Some(only) => (self.name_function(only.file, only.func), if only.may_be_nil { ir::only_function_flags::OR_NULLISH } else { ir::only_function_flags::IS_FACT }),
            None => (FuncId::NONE, 0),
        }
    }

    /// The flags are on the symbol the file itself refers to, which is another one if the binding is exported.
    fn has_local_flags(&self, sym: Sym, flags: SymFlags) -> bool {
        self.files.decls(sym).into_iter().any(|(file, decl)| {
            let bound = self.c.bound(file);
            let local = bound.symbol_of_declaration(decl);
            local.is_some() && bound.symbols[local.idx()].flags.contains(flags)
        })
    }

    // ───────────────────────────── captures and environments ─────────────────────────────

    /// Gives each of `syms` its place. What there is one of for as long as the program runs is a module variable. What lives in the environment
    /// of its activation has a field there. Anything else is a value of the function, whether or not inner functions have copies of it.
    pub(crate) fn declare(&mut self, fx: &mut Fx, syms: &[Sym]) {
        let captured = self.captured(fx.file);
        for &sym in syms {
            if matches!(self.places.get(&sym), Some(Place::Global(_))) || self.namespace_with_property(sym).is_some() {
                continue;
            }
            if captured.contains(&sym) && self.is_bound_once(sym) {
                self.global_of(sym);
                continue;
            }
            if let Some(CapturedVariable::InEnvironment(activation, _)) = self.c.captured_variable(sym) {
                self.layout_of_activation(activation);
                // A `var` is there from the start. What is left as it is counts as being in its temporal dead zone. A parameter is bound
                // right away.
                let is_var = matches!(self.value_declaration(sym), Some((_, Decl::Var(_))));
                if is_var && !self.c.has_dead_zone(sym) && self.files.flags(sym).contains(SymFlags::FUNCTION_SCOPED_VARIABLE) {
                    self.initialize_sym_without_value(fx, sym, 0);
                }
                continue;
            }
            if !fx.locals.contains_key(&sym) {
                let declared = self.ty_of_symbol(sym);
                let var = self.new_var(fx, declared);
                self.predict_variable(fx, var, sym);
                fx.locals.insert(sym, var);
            }
            if self.c.is_referred_to_in_dead_zone(sym) {
                self.enter_dead_zone(fx, sym);
            }
        }
    }

    /// The layout of the environment of an activation that has one. It has the variables of the blocks that share it as well.
    pub(crate) fn layout_of_activation(&mut self, activation: Activation) -> LayoutId {
        if let Some(&layout) = self.activation_layouts.get(&activation) {
            return layout;
        }
        if let Activation::Class(class) = activation {
            let info = self.define_class(self.file, class);
            return self.out.layouts[info.layout.idx()].environment;
        }
        let key = self.key_of_next_environment();
        let layout = self.add_layout(LayoutKind::Environment, StrId::NONE, key);
        let was = self.activation_layouts.insert(activation, layout);
        if let Some(undo) = &mut self.undo {
            undo.activation_layouts.push((activation, was));
        }
        self.activations.insert(layout, activation);
        let mut fields = Vec::new();
        for (index, &sym) in self.c.environment_of(self.file, activation).iter().enumerate() {
            let index = index as u32;
            let name = self.str(self.files.symbol(sym).name);
            // What keeps the closure of a function declaration. Only `ClosureOnce` looks at it.
            if let Some((file, func)) = self.function_declared_as(sym)
                && self.c.declared_closure(file, func) == Some(DeclaredClosure::KeptInEnvironment(activation, index))
            {
                let declared = self.or_undefined(self.known.function);
                let only_function = self.name_function(file, func);
                fields.push(Field { only_function, only_function_flags: ir::only_function_flags::OR_NULLISH, ..Field::new(name, declared, 0) });
                self.kept_closures.insert((layout, index));
                continue;
            }
            let declared = self.ty_of_symbol(sym);
            let mut flags = 0;
            if self.c.is_never_seen_uninitialized(sym) {
                flags = ir::field_flags::NEVER_SEEN_UNINITIALIZED | if self.c.is_constant(sym) { ir::field_flags::STORED_ONCE } else { 0 };
            }
            let (only_function, only_function_flags) = self.only_function_of(sym);
            fields.push(Field { only_function, only_function_flags, ..Field::new(name, declared.id, flags) });
            self.checked_fields.insert((layout, index), declared.checked);
            let was = self.places.insert(sym, Place::Env(layout, index));
            if let Some(undo) = &mut self.undo {
                undo.places.push((sym, was));
            }
        }
        for func in self.c.function_expressions_kept_in(self.file, activation) {
            let declared = self.or_undefined(self.known.function);
            let only_function = self.name_function(self.file, func);
            self.kept_closures.insert((layout, fields.len() as u32));
            fields.push(Field { only_function, only_function_flags: ir::only_function_flags::OR_NULLISH, ..Field::new(StrId::NONE, declared, 0) });
        }
        if let Activation::Call(func) = activation {
            for (sym, start, end) in self.c.parameters_redeclared_in_body(self.file, func) {
                if matches!(self.places.get(&sym), Some(&Place::Env(kept_in, _)) if kept_in == layout) {
                    let (name, declared, index) = (self.str(self.files.symbol(sym).name), self.ty_of_symbol(sym), fields.len() as u32);
                    fields.push(Field::new(name, declared.id, 0));
                    self.checked_fields.insert((layout, index), declared.checked);
                    let was = self.parameter_places.insert(sym, (Place::Env(layout, index), start, end));
                    if let Some(undo) = &mut self.undo {
                        undo.parameter_places.push((sym, was));
                    }
                }
            }
        }
        self.out.layouts[layout.idx()].fields = fields;
        if matches!(activation, Activation::Call(_)) {
            self.out.layouts[layout.idx()].class_flags |= ir::class_flags::MAY_BE_REUSED;
        }
        layout
    }

    /// Makes the environment of the activation that is being entered, if it has one. `close_env` then closes it.
    pub(crate) fn open_activation(&mut self, fx: &mut Fx, activation: Activation) -> bool {
        if !self.c.has_environment(fx.file, activation) {
            return false;
        }
        let layout = self.layout_of_activation(activation);
        // The block of a `catch` clause: what the clause binds has opened it.
        if fx.envs.last().is_some_and(|scope| scope.layout == layout) {
            return false;
        }
        let env = self.new_environment(fx, layout);
        self.push_env(fx, layout, env);
        true
    }

    /// No closure has been asked for yet.
    pub(crate) fn new_environment(&mut self, fx: &mut Fx, layout: LayoutId) -> V {
        let env = self.emit(fx, Op::New(layout));
        for field in 0..self.out.layouts[layout.idx()].fields.len() as u32 {
            if self.kept_closures.contains(&(layout, field)) {
                let value = self.emit(fx, Op::Undefined);
                self.emit(fx, Op::FieldSet { obj: env, layout, field, value });
            }
        }
        env
    }

    pub(crate) fn close_env(&mut self, fx: &mut Fx) {
        fx.envs.pop();
    }

    /// Where the environment of a class that is at hand holds the capture for the members of the class.
    fn imported(&self, fx: &Fx, capture: Capture) -> Option<(LayoutId, u32)> {
        fx.envs.iter().rev().find_map(|scope| {
            let index = self.imports.get(&scope.layout)?.iter().position(|&held| held == capture)?;
            Some((scope.layout, index as u32))
        })
    }

    /// Whether the code being built can get at an environment of the layout. `NONE`: there is nothing to get at.
    pub(crate) fn reaches_env(&self, fx: &Fx, layout: LayoutId) -> bool {
        layout.is_none()
            || fx.envs.iter().any(|scope| scope.layout == layout)
            || self.activations.get(&layout).is_some_and(|&activation| self.imported(fx, Capture::Environment(activation)).is_some())
    }

    /// The environment of that layout, as seen from the code being built.
    pub(crate) fn env_of(&mut self, fx: &mut Fx, layout: LayoutId) -> V {
        if let Some(scope) = fx.envs.iter().rev().find(|scope| scope.layout == layout) {
            let var = scope.var;
            return self.read(fx, var);
        }
        match self.activations.get(&layout).copied().and_then(|activation| self.imported(fx, Capture::Environment(activation))) {
            Some((holder, field)) => {
                let obj = self.env_of(fx, holder);
                self.emit(fx, Op::FieldGet { obj, layout: holder, field })
            }
            None => self.unsupported(fx, 0, "a variable of a function that does not enclose this one"),
        }
    }

    /// Whose `this` the code being built has for its own.
    fn is_own_receiver(&self, fx: &Fx, receiver: Receiver) -> bool {
        match receiver {
            Receiver::Function(func) => fx.func == func,
            Receiver::Instance(class) => fx.class == Some((fx.file, class)) && self.out.funcs[fx.id.idx()].kind == ir::FuncKind::Constructor,
            Receiver::None | Receiver::Static(_) => false,
        }
    }

    fn has_own_capture(&self, fx: &Fx, capture: Capture) -> bool {
        match capture {
            Capture::Environment(activation) => self.activation_layouts.get(&activation).is_some_and(|&layout| fx.envs.iter().any(|scope| scope.layout == layout)),
            Capture::Variable(sym) => fx.locals.contains_key(&sym),
            Capture::This(receiver) => fx.receivers.contains_key(&receiver) || self.is_own_receiver(fx, receiver),
            Capture::Arguments(func) => fx.captured_arguments.contains_key(&func) || fx.func == func && fx.arguments.is_some(),
            Capture::NewTarget(func) => fx.captured_new_targets.contains_key(&func) || fx.func == func && fx.new_target.is_some(),
            Capture::HomeObject(func) => fx.home_objects.contains_key(&func),
        }
    }

    pub(crate) fn has_at_hand(&self, fx: &Fx, capture: Capture) -> bool {
        self.has_own_capture(fx, capture) || self.imported(fx, capture).is_some()
    }

    /// Whether the code being built has all that a direct call of the function passes ahead of `this`.
    pub(crate) fn has_captures_at_hand(&self, fx: &Fx, func: FuncId) -> bool {
        self.captures.get(&func).is_none_or(|captures| captures.iter().all(|&capture| self.has_at_hand(fx, capture)))
    }

    pub(crate) fn capture_value(&mut self, fx: &mut Fx, capture: Capture, pos: u32) -> V {
        if !matches!(capture, Capture::Environment(_) | Capture::Variable(_))
            && !self.has_own_capture(fx, capture)
            && let Some((layout, field)) = self.imported(fx, capture)
        {
            let env = self.env_of(fx, layout);
            return self.emit(fx, Op::FieldGet { obj: env, layout, field });
        }
        match capture {
            Capture::Environment(activation) => {
                let layout = self.layout_of_activation(activation);
                self.env_of(fx, layout)
            }
            Capture::Variable(sym) => self.read_sym(fx, sym, pos),
            Capture::This(receiver) => match (fx.receivers.get(&receiver), fx.this_binding) {
                (Some(&this), _) => this,
                (None, Some((_, binding))) if self.layout_of_this_binding(receiver).is_some() => binding,
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
                None => self.unsupported(fx, pos, "`super` in a method of an object literal that is created elsewhere"),
            },
        }
    }

    /// What a closure of the function holds and a direct call passes ahead of `this`, as seen from the code being built.
    pub(crate) fn capture_values(&mut self, fx: &mut Fx, func: FuncId, pos: u32) -> ir::Args {
        let captures = self.captures.get(&func).cloned().unwrap_or_default();
        let held_to = self.out.funcs[func.idx()].captures.clone();
        let anything = self.out.tys.anything;
        (captures.into_iter().zip(held_to))
            .map(|(capture, to)| {
                let value = self.capture_value(fx, capture, pos);
                if matches!(capture, Capture::Variable(_)) && to != anything && self.ty(fx, value) == anything {
                    self.emit_throwing(fx, Op::Coerce { value, to, why: Why::Claim })
                } else {
                    value
                }
            })
            .collect()
    }

    pub(crate) fn ty_of_capture(&mut self, capture: Capture) -> Ty {
        match capture {
            Capture::Environment(activation) => {
                let layout = self.layout_of_activation(activation);
                Ty::of(self.ty_of_layout(layout))
            }
            Capture::Variable(sym) => self.ty_of_symbol(sym),
            Capture::This(receiver) => match self.layout_of_this_binding(receiver) {
                Some(layout) => Ty::of(self.ty_of_layout(layout)),
                None => self.ty_of_receiver(receiver),
            },
            Capture::Arguments(_) | Capture::NewTarget(_) | Capture::HomeObject(_) => Ty::NONE,
        }
    }

    /// Where `this` of the constructor may be uninitialized: what holds it, and `new.target`, for the constructor and the arrow functions in it.
    pub(crate) fn layout_of_this_binding(&mut self, receiver: Receiver) -> Option<LayoutId> {
        let Receiver::Function(func) = receiver else { return None };
        if !self.c.this_may_be_uninitialized(self.file, func) {
            return None;
        }
        if let Some(&layout) = self.this_bindings.get(&func) {
            return Some(layout);
        }
        let key = self.key_of_next_environment();
        let layout = self.add_layout(LayoutKind::Environment, StrId::NONE, key);
        let names = [self.out.strs.intern(b"this"), self.out.strs.intern(b"new.target")];
        self.out.layouts[layout.idx()].fields = names.into_iter().map(|name| Field::new(name, TyId::NONE, 0)).collect();
        let was = self.this_bindings.insert(func, layout);
        if let Some(undo) = &mut self.undo {
            undo.this_bindings.push((func, was));
        }
        Some(layout)
    }

    /// The type of `this` in the function, or in the constructor of the class.
    pub(crate) fn ty_of_receiver(&mut self, receiver: Receiver) -> Ty {
        let id = match receiver {
            Receiver::Function(func) => self.funcs.get(&(self.file, func)).copied(),
            Receiver::Instance(class) => self.classes.get(&(self.file, class)).map(|info| info.ctor),
            Receiver::None | Receiver::Static(_) => None,
        };
        match id {
            Some(id) if id.is_some() => Ty {
                id: self.out.funcs[id.idx()].this_declared,
                checked: self.signatures.get(&id).and_then(|signature| signature.this).unwrap_or(TypeId::UNRESOLVED),
            },
            _ => Ty::NONE,
        }
    }

    /// Says what the function is handed ahead of `this`.
    pub(crate) fn set_captures(&mut self, id: FuncId, captures: &[Capture]) {
        if captures.is_empty() {
            return;
        }
        let mut types = Vec::with_capacity(captures.len());
        for &capture in captures {
            let ty = self.ty_of_capture(capture).id;
            types.push(self.or_anything(ty));
        }
        if captures.len() > MAX_CAPTURES {
            let (file, pos) = (self.file, self.out.funcs[id.idx()].pos);
            self.problems.push(Problem { file, pos, what: format!("this function captures {} variables; a closure can hold {MAX_CAPTURES}", captures.len()).into() });
        }
        self.out.funcs[id.idx()].captures = types;
        self.captures.insert(id, captures.to_vec());
    }

    /// The captures as the function being built is handed them.
    pub(crate) fn add_captures(&mut self, fx: &mut Fx) {
        let is_arrow = fx.func.is_some() && self.hir(fx.file)[fx.func].kind == hir::FnKind::Arrow;
        let seen = if is_arrow { self.c.receiver_of_arrow(fx.file, fx.func) } else { Receiver::None };
        let declared = self.out.funcs[fx.id.idx()].captures.clone();
        for (capture, declared) in self.captures.get(&fx.id).cloned().unwrap_or_default().into_iter().zip(declared) {
            let mut ty = self.ty_of_capture(capture);
            if matches!(capture, Capture::Variable(_)) && declared != self.out.tys.anything && self.or_anything(ty.id) == self.out.tys.anything {
                ty.id = declared;
            }
            let value = self.add_entry_param(fx, ty);
            match capture {
                Capture::Environment(activation) => {
                    let layout = self.layout_of_activation(activation);
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
                    match self.layout_of_this_binding(receiver) {
                        Some(layout) if receiver == seen => {
                            fx.this_binding = Some((layout, value));
                            fx.new_target = self.emit(fx, Op::FieldGet { obj: value, layout, field: 1 });
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

    // ───────────────────────────── reads and writes ─────────────────────────────

    /// What the name stands for, for a reference that is not in the source, or that gets at it through a namespace.
    pub(crate) fn read_sym(&mut self, fx: &mut Fx, sym: Sym, pos: u32) -> V {
        self.read_sym_at(fx, sym, ExprId::NONE, pos)
    }

    /// The same for the identifier `e` of the source.
    pub(crate) fn read_reference(&mut self, fx: &mut Fx, sym: Sym, e: ExprId) -> V {
        let pos = self.hir(fx.file)[e].pos;
        self.read_sym_at(fx, sym, e, pos)
    }

    pub(crate) fn check_default_exports_passed(&mut self, fx: &mut Fx, e: ExprId) {
        if e.is_none() || self.checked_default_exports_of == Some((fx.id, e)) {
            return;
        }
        self.checked_default_exports_of = Some((fx.id, e));
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return };
        let Some(named) = self.c.binding_of_identifier(fx.file, e, name) else { return };
        if !self.is_import(named) {
            return;
        }
        let mut passed = Vec::new();
        self.value_symbol_after(named, &mut passed);
        for exported in passed {
            if self.has_dead_zone_of_its_own(exported) {
                let global = self.global_of(exported);
                self.emit_throwing(fx, Op::GlobalGet(global));
            } else {
                self.check_entity_alias_initialized(fx, exported, e);
            }
        }
    }

    fn has_dead_zone_of_its_own(&mut self, exported: Sym) -> bool {
        for (file, decl) in self.files.decls(exported) {
            let Decl::ExportExpr(stmt) = decl else { continue };
            let hir::StmtKind::ExportDefault(e) = self.hir(file)[stmt].kind else { continue };
            return self.binding_exported_as_default(file, e).is_some_and(|sym| !self.c.is_default_export_equivalent_to_binding(file, e, sym));
        }
        false
    }

    pub(crate) fn override_of(&mut self, sym: Sym) -> Option<GlobalId> {
        let file = sym.file;
        if !self.shared.exports_may_be_overridden || self.is_builtin_file(file) || self.shared.is_prelude(file) || self.is_commonjs(file) || !self.files.module(file).is_module() {
            return None;
        }
        if !self.exported_bindings.contains_key(&file) {
            let exported: Vec<Sym> = (self.exports_of_file(file).into_iter())
                .filter_map(|export| match export.1 {
                    ImportSource::Declaration(member) => Some(member),
                    _ => None,
                })
                .collect();
            let bindings = exported.into_iter().map(|member| self.value_symbol_of_export(member)).collect();
            self.exported_bindings.insert(file, bindings);
        }
        if !self.exported_bindings[&file].contains(&sym) {
            return None;
        }
        let name = self.files.symbol(sym).name;
        Some(self.export_variable(file, name))
    }

    pub(crate) fn unless_overridden(&mut self, fx: &mut Fx, global: GlobalId, e: ExprId, overridden: impl FnOnce(&mut Self, &mut Fx, V) -> V, compiled: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_unset = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (unset, set, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        self.branch(fx, is_unset, unset, set);
        fx.b.seal(unset);
        fx.b.seal(set);
        fx.b.switch_to(set);
        let mut value = overridden(self, fx, known);
        if e.is_some() && fx.is_typed {
            let checked = self.type_of_value(fx, e);
            let want = Ty { id: self.ty_of_expression(fx, e, checked), checked };
            let promised = self.c.awaited(checked);
            if promised != checked {
                let id = self.ty_of(promised);
                self.note_untyped_inflow(Ty { id, checked: promised });
            }
            let mut views = Vec::new();
            self.types_of_layouts_within(want.id, 3, &mut views);
            for view in views {
                self.c.note_foreign(view, TypeId::ANY);
            }
            self.note_produced_types(checked, true);
            fx.checked.insert(value, TypeId::ANY);
            value = self.fit(fx, value, want, Why::Cast);
        }
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.switch_to(unset);
        let value = compiled(self, fx);
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let value = self.read(fx, result);
        if e.is_some() { self.fit_to_expression(fx, value, e) } else { value }
    }

    fn read_sym_at(&mut self, fx: &mut Fx, sym: Sym, e: ExprId, pos: u32) -> V {
        match self.override_of(sym) {
            Some(global) => self.unless_overridden(fx, global, e, |_, _, known| known, |this, fx| this.read_sym_as_compiled(fx, sym, e, pos)),
            None => self.read_sym_as_compiled(fx, sym, e, pos),
        }
    }

    fn read_sym_as_compiled(&mut self, fx: &mut Fx, sym: Sym, e: ExprId, pos: u32) -> V {
        if e.is_some()
            && self.files.flags(sym).contains(SymFlags::CLASS)
            && let Some((file, Decl::Class(class))) = self.value_declaration(sym)
            && file == fx.file
            && self.c.is_written_in_class(file, e, class)
            && !self.c.is_in_heritage_or_computed_key_of(file, e, class)
            && self.is_within_environment_of_class(fx, file, class)
        {
            return self.class_as_value(fx, file, class);
        }
        self.check_default_exports_passed(fx, e);
        if let Some(namespace) = self.namespace_with_property(sym) {
            return self.read_property_of_namespace(fx, namespace, sym);
        }
        if let Some((owner, index)) = self.c.mapped_parameter(sym) {
            let arguments = self.capture_value(fx, Capture::Arguments(owner), pos);
            let index = self.emit(fx, Op::Int(index as i64));
            return self.operation(fx, "GetMappedParameter", &[arguments, index]);
        }
        if let Some(&var) = fx.locals.get(&sym) {
            self.check_dead_zone(fx, sym, e);
            return self.read(fx, var);
        }
        if let Some(value) = self.c.constant_held_by(sym) {
            // What it holds is known. Whether it holds it yet is not always: then the variable is read for the test alone.
            if self.is_lazy(sym) {
                self.check_turn_of_lazy_variable(fx, sym, e);
            } else if self.may_be_in_dead_zone(fx, sym, e) {
                self.read_from_storage(fx, sym, e, pos);
            }
            let constant = self.constant_of(value);
            return self.emit_constant(fx, &constant);
        }
        self.read_from_storage(fx, sym, e, pos)
    }

    fn place_at(&self, sym: Sym, pos: u32) -> Option<Place> {
        match self.parameter_places.get(&sym) {
            Some(&(place, start, end)) if (start..end).contains(&pos) => Some(place),
            _ => self.places.get(&sym).copied(),
        }
    }

    pub(crate) fn copy_parameters_to_variables_of_body(&mut self, fx: &mut Fx) {
        for (sym, ..) in self.c.parameters_redeclared_in_body(fx.file, fx.func) {
            if let Some(&(Place::Env(layout, field), ..)) = self.parameter_places.get(&sym) {
                let env = self.env_of(fx, layout);
                let value = self.emit(fx, Op::FieldGet { obj: env, layout, field });
                self.write_sym(fx, sym, value, 0);
            }
        }
    }

    fn read_from_storage(&mut self, fx: &mut Fx, sym: Sym, e: ExprId, pos: u32) -> V {
        if let Some((layout, field)) = self.imported(fx, Capture::Variable(sym)) {
            let env = self.env_of(fx, layout);
            return self.emit(fx, Op::FieldGet { obj: env, layout, field });
        }
        // Within a class that is not evaluated once, its name stands for what the environment of the class holds.
        if matches!(self.places.get(&sym), Some(Place::Env(..)))
            && let Some((file, Decl::Class(class))) = self.value_declaration(sym)
            && self.is_within_environment_of_class(fx, file, class)
        {
            return self.class_as_value(fx, file, class);
        }
        match self.place_at(sym, pos) {
            Some(Place::Global(g)) => return self.read_place(fx, sym, Op::GlobalGet(g), e),
            Some(Place::Env(layout, field)) => {
                let env = self.env_of(fx, layout);
                return self.read_place(fx, sym, Op::FieldGet { obj: env, layout, field }, e);
            }
            None => {}
        }
        match self.value_declaration(sym) {
            Some((file, Decl::Fn(func))) => {
                // In another module, where it is assigned to: it is a variable of that module, see `block_body`.
                if file != self.file && self.is_assigned(sym) && self.function_values(file).contains(&sym) {
                    let g = self.global_of(sym);
                    return self.read_place(fx, sym, Op::GlobalGet(g), e);
                }
                // Of an overloaded function, the declaration with the body.
                if let Some(id) = self.function_of_symbol(fx, sym) {
                    return self.closure_of_declaration(fx, sym, id, pos);
                }
                self.function_value(fx, file, func, pos)
            }
            Some((_, Decl::Var(_))) if self.function_declaring(sym) == Some(FnId::NONE) => {
                let g = self.global_of(sym);
                self.read_place(fx, sym, Op::GlobalGet(g), e)
            }
            Some((_, Decl::ExportExpr(_))) => {
                let g = self.global_of(sym);
                self.read_place(fx, sym, Op::GlobalGet(g), e)
            }
            // One that is evaluated once, or the name of a class expression within it: no variable holds the class object.
            Some((file, Decl::Class(class))) => {
                self.check_class_is_declared(fx, file, class, e);
                self.class_as_value(fx, file, class)
            }
            Some((_, Decl::Enum(_))) => {
                let maker = self.enum_object_getter(sym);
                self.emit_throwing(fx, Op::CallDirect { func: maker, args: ir::Args::new() })
            }
            Some((file, Decl::EnumMember(member))) => match self.c.enum_member_value(file, member) {
                Some(bun_sema::types::EnumValue::Number(bits)) => self.number(fx, f64::from_bits(bits)),
                Some(bun_sema::types::EnumValue::String(text)) => {
                    let text = self.str(text);
                    self.emit(fx, Op::Str(text))
                }
                None => self.unsupported(fx, pos, "an enum member whose value is computed at run time"),
            },
            Some((_, Decl::Module(_))) if self.c.is_reified_namespace(sym) => self.namespace_object(fx, sym),
            Some((_, Decl::Module(_) | Decl::File)) => {
                let getter = self.namespace_object_getter(sym);
                self.emit_throwing(fx, Op::CallDirect { func: getter, args: ir::Args::new() })
            }
            _ => self.unsupported(fx, pos, "a reference to this kind of declaration"),
        }
    }

    /// The read of a module variable or of a variable in an environment. The engine throws if it holds nothing yet.
    fn read_place(&mut self, fx: &mut Fx, sym: Sym, read: Op, e: ExprId) -> V {
        if let Op::GlobalGet(global) = read
            && self.lazy_globals.contains_key(&global)
        {
            let may_be_early = self.may_be_in_dead_zone(fx, sym, e);
            return self.read_lazy_variable(fx, global, sym, may_be_early);
        }
        if self.may_be_in_dead_zone(fx, sym, e) {
            return self.emit_throwing(fx, read);
        }
        let found = self.emit(fx, read);
        fx.b.func.values[found.idx()].finds_initialized = matches!(fx.b.func.op(found), Some(Op::GlobalGet(_)));
        found
    }

    /// Whether the reference `e` may find what it refers to in its temporal dead zone. `NONE`: a reference that is not in the source.
    pub(crate) fn may_be_in_dead_zone(&mut self, fx: &Fx, sym: Sym, e: ExprId) -> bool {
        (!fx.locals.contains_key(&sym) || fx.initialized.contains_key(&sym)) && self.c.may_be_in_dead_zone(sym, fx.file, e)
    }

    // ───────────────────────────── the temporal dead zone of local variables ─────────────────────────────

    /// The scope of the variable is entered.
    fn enter_dead_zone(&mut self, fx: &mut Fx, sym: Sym) {
        let boolean = self.known.boolean;
        let flag = *fx.initialized.entry(sym).or_insert_with(|| fx.b.new_var(boolean));
        if fx.false_value.is_none() {
            fx.false_value = fx.b.entry_constant(Op::Bool(false), self.known.no);
        }
        self.write(fx, flag, fx.false_value);
    }

    fn leave_dead_zone(&mut self, fx: &mut Fx, sym: Sym) {
        if let Some(&flag) = fx.initialized.get(&sym) {
            if fx.true_value.is_none() {
                fx.true_value = fx.b.entry_constant(Op::Bool(true), self.known.yes);
            }
            self.write(fx, flag, fx.true_value);
        }
    }

    /// The reference `e` to a local variable throws if the variable has not been initialized.
    fn check_dead_zone(&mut self, fx: &mut Fx, sym: Sym, e: ExprId) {
        let Some(&flag) = fx.initialized.get(&sym) else { return };
        if !self.c.may_be_in_dead_zone(sym, fx.file, e) {
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
        self.throw_error(fx, b"ReferenceError", b"Cannot access a variable before its initialization");
        fx.b.switch_to(fine);
    }

    /// The initialization of a binding, as opposed to an assignment to it.
    pub(crate) fn initialize_sym(&mut self, fx: &mut Fx, sym: Sym, value: V, pos: u32) {
        self.leave_dead_zone(fx, sym);
        self.write_sym(fx, sym, value, pos);
    }

    /// `let name;`, and a `var` where its scope is entered.
    pub(crate) fn initialize_sym_without_value(&mut self, fx: &mut Fx, sym: Sym, pos: u32) {
        // `export let name;`: there is no such property until something is stored.
        if self.namespace_with_property(sym).is_some() {
            return;
        }
        let ty = match (fx.locals.get(&sym), self.places.get(&sym)) {
            (Some(&var), _) => fx.b.ty_of_var(var),
            (None, Some(&Place::Global(g))) => self.out.globals[g.idx()].declared,
            (None, Some(&Place::Env(layout, field))) => self.out.layouts[layout.idx()].fields[field as usize].declared,
            (None, None) => TyId::NONE,
        };
        let blank = self.emit_blank(fx, ty);
        fx.is_clearing = true;
        self.initialize_sym(fx, sym, blank, pos);
        fx.is_clearing = false;
    }

    /// `name = value`, where `e` is the name.
    pub(crate) fn assign_sym(&mut self, fx: &mut Fx, sym: Sym, value: V, e: ExprId) {
        let pos = self.hir(fx.file)[e].pos;
        if self.namespace_with_property(sym).is_some() {
            return self.write_sym(fx, sym, value, pos);
        }
        if fx.locals.contains_key(&sym) {
            self.check_dead_zone(fx, sym, e);
        } else if self.c.has_dead_zone(sym) && self.may_be_in_dead_zone(fx, sym, e) {
            // Whether the variable holds anything yet the engine looks at when it is read.
            self.read_sym_at(fx, sym, e, pos);
        }
        // Sloppy code goes on as if nothing had been written.
        if self.names_function_expression(sym) && fx.func.is_some() && self.c.is_sloppy_function(fx.file, fx.func) {
            return;
        }
        if self.c.is_constant(sym) || self.names_function_expression(sym) {
            self.throw_error(fx, b"TypeError", b"Attempted to assign to readonly property.");
            let after = fx.b.new_block();
            fx.b.seal(after);
            fx.b.switch_to(after);
            return;
        }
        self.write_sym(fx, sym, value, pos);
    }

    /// `value` is stored to the variable, which is kept in a place of the type `place`. Where that has room besides the type of the variable,
    /// the value is held to the type first: see `ty_held_by_symbol`.
    fn hold_to_type_of_variable(&mut self, fx: &mut Fx, sym: Sym, value: V, place: TyId, why: Why) -> V {
        if fx.is_clearing {
            return value;
        }
        let held = self.ty_held_by_symbol(sym);
        if held.id == place { value } else { self.fit(fx, value, held, why) }
    }

    /// What enters a variable whose type is written down is held to it as by `as`.
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
            self.operation(fx, "PutMappedParameter", &[arguments, index, value]);
            return;
        }
        let why = if self.c.is_annotated(sym) { Why::Cast } else { Why::Store };
        if let Some(&var) = fx.locals.get(&sym) {
            let value = self.hold_to_type_of_variable(fx, sym, value, fx.b.ty_of_var(var), why);
            self.write_as(fx, var, value, why);
            return;
        }
        let place = match self.place_at(sym, pos) {
            None if matches!(self.value_declaration(sym), Some((_, Decl::Var(_)))) && self.function_declaring(sym) == Some(FnId::NONE) => Some(Place::Global(self.global_of(sym))),
            place => place,
        };
        match place {
            Some(Place::Global(g)) => {
                let want = Ty { id: self.out.globals[g.idx()].declared, checked: self.checked_globals.get(&g).copied().unwrap_or(TypeId::UNRESOLVED) };
                let value = self.hold_to_type_of_variable(fx, sym, value, want.id, why);
                let value = self.fit(fx, value, want, why);
                self.emit(fx, Op::GlobalSet(g, value));
            }
            Some(Place::Env(layout, field)) => {
                let want = self.type_of_field(layout, field);
                let value = self.hold_to_type_of_variable(fx, sym, value, want.id, why);
                let value = self.fit(fx, value, want, why);
                let env = self.env_of(fx, layout);
                self.emit(fx, Op::FieldSet { obj: env, layout, field, value });
            }
            None => match self.value_declaration(sym) {
                Some((file, Decl::Class(class))) if self.class_info(file, class).facts.is_evaluated_once => {
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

    // ───────────────────────────── enums ─────────────────────────────

    /// Where the first declaration of the enum or the namespace in the file of the symbol has its name. 0: a file is what declares it.
    fn pos_of_declared_name(&self, sym: Sym) -> u32 {
        let named = self.files.decls(sym).into_iter().filter(|declared| declared.0 == sym.file).find_map(|(file, decl)| match decl {
            Decl::Enum(declaration) => Some(self.hir(file)[declaration].name_pos),
            Decl::Module(declaration) => Some(self.hir(file)[declaration].name_pos),
            _ => None,
        });
        named.unwrap_or(0)
    }

    /// The function that yields the object an enum is as a value. It makes it when it is first asked for.
    fn enum_object_getter(&mut self, sym: Sym) -> FuncId {
        if let Some(&known) = self.enum_objects.get(&sym) {
            return known;
        }
        let name = self.str(self.files.symbol(sym).name);
        let module = self.module_of(sym.file);
        let pos = self.pos_of_declared_name(sym);
        let maker = self.add_func(name, module, pos, ir::FuncKind::Plain, super::Source::EnumObject(sym));
        self.enum_objects.insert(sym, maker);
        maker
    }

    pub(crate) fn enum_global(&mut self, sym: Sym) -> GlobalId {
        if let Some(&known) = self.enum_globals.get(&sym) {
            return known;
        }
        let name = self.str(self.files.symbol(sym).name);
        let global = self.add_global(name, sym.file, Ty::NONE, GlobalKey::Enum(sym.file, sym.id));
        let stands_in_file = self.files.decls(sym).into_iter().any(|(file, decl)| {
            let hir = self.hir(file);
            matches!(decl, Decl::Enum(declaration) if hir.ids(hir.body).any(|stmt: StmtId| matches!(hir[stmt].kind, StmtKind::Enum(it) if it == declaration)))
        });
        if stands_in_file {
            self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        }
        self.enum_globals.insert(sym, global);
        global
    }

    pub(crate) fn emit_enum_object_getter(&mut self, fx: &mut Fx, sym: Sym) {
        let global = self.enum_global(sym);
        let known = self.emit(fx, Op::GlobalGet(global));
        let declarations = self.declarations_of_enum(sym);
        let [(file, declaration)] = declarations[..] else {
            self.terminate_with_return(fx, known);
            return;
        };
        let null = self.emit(fx, Op::Null);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: null });
        let (make, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, make, done);
        fx.b.seal(make);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, known);
        fx.b.switch_to(make);
        let obj = self.emit(fx, Op::NewObject);
        self.emit_enum_members(fx, obj, file, declaration);
        self.emit(fx, Op::GlobalSet(global, obj));
        self.terminate_with_return(fx, obj);
    }

    pub(crate) fn declarations_of_enum(&self, sym: Sym) -> Vec<(FileId, bun_sema::hir::EnumId)> {
        let runs = |&(file, decl): &(FileId, Decl)| match decl {
            Decl::Enum(declaration) if self.shared.is_compiled(file) && !self.hir(file)[declaration].flags.contains(Flags::AMBIENT) => Some((file, declaration)),
            _ => None,
        };
        self.files.decls(sym).iter().filter_map(runs).collect()
    }

    pub(crate) fn emit_enum_members(&mut self, fx: &mut Fx, obj: V, file: FileId, declaration: bun_sema::hir::EnumId) {
        let hir = self.hir(file);
        for member in hir[declaration].members.iter() {
            let m = &hir[member];
            let Some(value) = self.c.enum_member_value(file, member) else {
                self.problem(file, m.pos, "an enum member whose value is computed at run time");
                continue;
            };
            let member_name = self.str(m.name);
            match value {
                bun_sema::types::EnumValue::Number(bits) => {
                    let value = self.number(fx, f64::from_bits(bits));
                    self.emit_throwing(fx, Op::PropSet { obj, name: member_name, value });
                    let text = self.emit(fx, Op::Str(member_name));
                    self.emit_throwing(fx, Op::ElemSet { obj, key: value, value: text });
                }
                bun_sema::types::EnumValue::String(text) => {
                    let text = self.str(text);
                    let value = self.emit(fx, Op::Str(text));
                    self.emit_throwing(fx, Op::PropSet { obj, name: member_name, value });
                }
            }
        }
    }

    // ───────────────────────────── namespace objects ─────────────────────────────

    /// The namespace that exports what `sym` stands for, if that is reified (`Checker::is_reified_namespace`): it is an object, and what it
    /// exports are its properties.
    pub(crate) fn reified_namespace_exporting(&self, sym: Sym) -> Option<Sym> {
        if !self.c.has_reified_namespaces() {
            return None;
        }
        self.files.parent_of_symbol(sym).filter(|&namespace| self.c.is_reified_namespace(namespace))
    }

    pub(crate) fn is_exported_by_namespace(&self, sym: Sym) -> bool {
        self.files.parent_of_symbol(sym).is_some_and(|parent| self.files.decls(parent).iter().any(|(_, decl)| matches!(decl, Decl::Module(_))))
    }

    /// The same for a variable: the property is all there is of it, within the namespace too.
    pub(crate) fn namespace_with_property(&self, sym: Sym) -> Option<Sym> {
        let namespace = self.reified_namespace_exporting(sym)?;
        matches!(self.value_declaration(sym), Some((_, Decl::Var(_)))).then_some(namespace)
    }

    /// The same for a function, a class, an enum or a namespace that the identifier `e` names from outside the block that declares it.
    /// Within the block the name stands for the binding of the block.
    pub(crate) fn namespace_seen_through(&mut self, fx: &Fx, e: ExprId, sym: Sym) -> Option<Sym> {
        let namespace = self.reified_namespace_exporting(sym)?;
        let is_bound_by_block = matches!(self.value_declaration(sym), Some((_, Decl::Fn(_) | Decl::Class(_) | Decl::Enum(_) | Decl::Module(_))));
        (is_bound_by_block && !self.c.is_within_declaring_block(fx.file, e, sym)).then_some(namespace)
    }

    /// What the objects of the reified namespace are made as. `None`: an ordinary object.
    pub(crate) fn layout_of_namespace(&mut self, namespace: Sym) -> Option<LayoutId> {
        if self.is_merged_with_another_object(namespace) {
            return None;
        }
        let checked = self.c.type_of_symbol(namespace);
        if self.is_object_type_of_program(checked) { self.record_layout(checked) } else { None }
    }

    /// Where the object of a reified namespace is kept. It holds `undefined` until the first block of the namespace is evaluated.
    pub(crate) fn global_of_namespace(&mut self, namespace: Sym) -> GlobalId {
        if let Some(&known) = self.namespace_globals.get(&namespace) {
            return known;
        }
        let checked = self.c.type_of_symbol(namespace);
        let described = self.ty_of(checked);
        let declared = Ty { id: self.or_undefined(described), checked };
        let name = self.str(self.files.symbol(namespace).name);
        let global = self.add_global(name, namespace.file, declared, GlobalKey::Namespace(namespace.file, namespace.id));
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        self.namespace_globals.insert(namespace, global);
        global
    }

    fn is_merged_with_another_object(&self, namespace: Sym) -> bool {
        self.files.flags(namespace).intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM)
    }

    pub(crate) fn namespace_object(&mut self, fx: &mut Fx, namespace: Sym) -> V {
        if self.is_merged_with_another_object(namespace) {
            let pos = fx.b.pos;
            return self.read_sym(fx, namespace, pos);
        }
        let global = self.global_of_namespace(namespace);
        self.emit(fx, Op::GlobalGet(global))
    }

    pub(crate) fn read_property_of_namespace(&mut self, fx: &mut Fx, namespace: Sym, member: Sym) -> V {
        let obj = self.namespace_object(fx, namespace);
        let name = self.str(self.files.symbol(member).name);
        self.emit_throwing(fx, Op::PropGet { obj, name })
    }

    /// A block of the reified namespace is entered: the first one makes the object.
    pub(crate) fn enter_block_of_namespace(&mut self, fx: &mut Fx, namespace: Sym) {
        if self.is_merged_with_another_object(namespace) {
            return;
        }
        let global = self.global_of_namespace(namespace);
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (make, made) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, make, made);
        fx.b.seal(make);
        fx.b.switch_to(make);
        let obj = match self.layout_of_namespace(namespace) {
            Some(layout) => {
                self.note_allocation(layout);
                self.c.note_object_allocated_empty(self.layout_types[&layout], namespace.file);
                self.emit(fx, Op::New(layout))
            }
            None => self.emit(fx, Op::NewObject),
        };
        self.emit(fx, Op::GlobalSet(global, obj));
        if let Some(outer) = self.reified_namespace_exporting(namespace) {
            let outer = self.namespace_object(fx, outer);
            let name = self.str(self.files.symbol(namespace).name);
            self.emit_throwing(fx, Op::PropSet { obj: outer, name, value: obj });
        }
        fx.b.jump(made);
        fx.b.seal(made);
        fx.b.switch_to(made);
    }

    /// `export const name = init` in a reified namespace: what the field by the name is expected to hold.
    pub(crate) fn note_callee_of_exported_variable(&mut self, fx: &Fx, pat: PatId, init: ExprId) {
        let PatKind::Ident(name) = self.hir(fx.file)[pat].kind else { return };
        let Some(id) = self.c.bound(fx.file).pat_symbol[pat.idx()].some() else { return };
        let sym = self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(fx.file, id));
        if let Some(layout) = self.namespace_with_property(sym).and_then(|namespace| self.layout_of_namespace(namespace)) {
            self.note_callee_stored(fx, layout, name, init, false);
        }
    }

    /// The declaration of the function, the class or the enum `sym` has been evaluated. Where a reified namespace exports it: `N.name = name`.
    pub(crate) fn export_from_namespace(&mut self, fx: &mut Fx, sym: Sym, pos: u32) {
        let Some(namespace) = self.reified_namespace_exporting(sym) else { return };
        let member = self.files.symbol(sym).name;
        // `export import a = b.c`
        let declared = self.value_symbol(sym);
        if !self.files.symbol_flags(declared).intersects(SymFlags::VALUE) {
            return;
        }
        if let Some((file, func)) = self.function_declared_as(declared)
            && let Some(holder) = self.layout_of_namespace(namespace).and_then(|layout| self.layout_types.get(&layout).copied())
        {
            self.c.note_callee_declared(holder, member, file, func);
        }
        let value = match self.reified_namespace_exporting(declared).filter(|_| declared != sym) {
            Some(other) => self.read_property_of_namespace(fx, other, declared),
            None => self.read_sym(fx, declared, pos),
        };
        let obj = self.namespace_object(fx, namespace);
        let name = self.str(member);
        self.emit_throwing(fx, Op::PropSet { obj, name, value });
    }

    /// The function that returns the object for `import * as ns` or `namespace N` used as a value. It creates the object on first use.
    fn namespace_object_getter(&mut self, sym: Sym) -> FuncId {
        if let Some(&known) = self.namespace_objects.get(&sym) {
            return known;
        }
        let name = self.out.strs.intern(b"namespace");
        let module = self.module_of(sym.file);
        let pos = self.pos_of_declared_name(sym);
        let getter = self.add_func(name, module, pos, ir::FuncKind::Plain, super::Source::NamespaceObject(sym));
        self.namespace_objects.insert(sym, getter);
        getter
    }

    pub(crate) fn emit_namespace_object_getter(&mut self, fx: &mut Fx, sym: Sym) {
        let name = self.out.strs.intern(b"namespace");
        let global = self.add_global(name, sym.file, Ty::NONE, GlobalKey::Namespace(sym.file, sym.id));
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (create, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, create, done);
        fx.b.seal(create);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, known);
        fx.b.switch_to(create);
        let members = self.members_of_namespace(sym);
        // Of a module: nothing is read now. Each export is read when the property is.
        if matches!(self.value_declaration(sym), Some((_, Decl::File))) {
            let name = self.name_after_file("exports of", sym.file);
            let module = self.module_of(sym.file);
            let read = self.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::ModuleNamespaceReader(sym.file));
            self.out.funcs[read.idx()].params = vec![TyId::NONE];
            self.out.funcs[read.idx()].length = 1;
            let mut arguments = vec![self.emit(fx, Op::FuncRef(read))];
            for &(name, _) in &members {
                let name = self.str(name);
                arguments.push(self.emit(fx, Op::Str(name)));
            }
            if let Some((importer, object)) = self.only_object_behind_stars(sym.file) {
                arguments.push(self.namespace_of_exported_object(fx, importer, object));
            }
            if self.shared.constants.own_paths.is_some() {
                arguments.push(self.emit(fx, Op::Bool(true)));
            }
            let obj = self.operation(fx, "MakeModuleNamespace", &arguments);
            self.emit(fx, Op::GlobalSet(global, obj));
            return self.terminate_with_return(fx, obj);
        }
        let obj = self.emit(fx, Op::NewObject);
        // Before the properties are read: a cycle of namespaces that export each other ends here.
        self.emit(fx, Op::GlobalSet(global, obj));
        for (name, source) in members {
            let value = self.read_member_of_namespace(fx, source);
            let name = self.str(name);
            let key = self.emit(fx, Op::Str(name));
            self.operation(fx, "DefineField", &[obj, key, value]);
        }
        self.terminate_with_return(fx, obj);
    }

    /// What the object for a module or a TypeScript namespace has, in the order of the names.
    pub(crate) fn members_of_namespace(&mut self, sym: Sym) -> Vec<(Atom, ImportSource)> {
        let exports: Vec<(Atom, ImportSource)> = if matches!(self.value_declaration(sym), Some((_, Decl::File))) {
            self.exports_of_file(sym.file)
        } else {
            self.files.exports(sym).into_iter().map(|(name, member)| (name, if self.entity_alias_declaration(member).is_some() { ImportSource::Entity(member) } else { ImportSource::Declaration(member) })).collect()
        };
        let mut members = Vec::with_capacity(exports.len());
        for (name, source) in exports {
            let is_value = match source {
                ImportSource::Declaration(member) => {
                    let member = self.value_symbol_of_export(member);
                    // `export default a.b`, `export default console`: an alias by its own flags, and it holds the value itself.
                    let is_expression = self.files.decls(member).into_iter().any(|(_, decl)| matches!(decl, Decl::ExportExpr(_)));
                    let flags = if is_expression { self.files.symbol_flags(member) } else { self.files.flags(member) };
                    flags.intersects(SymFlags::VALUE) && !self.is_ambient(member)
                }
                ImportSource::Entity(alias) => !matches!(self.entity_alias_kind(alias), super::imports::EntityAlias::TypeOnly),
                ImportSource::Unknown => false,
                _ => true,
            };
            if is_value {
                members.push((name, source));
            }
        }
        // By code unit, as the specification has the keys of a module namespace, and as the engine looks them up.
        members.sort_by_cached_key(|member| String::from_utf8_lossy(self.c.atoms().bytes(member.0)).encode_utf16().collect::<Vec<u16>>());
        members
    }

    pub(crate) fn read_member_of_namespace(&mut self, fx: &mut Fx, source: ImportSource) -> V {
        match source {
            ImportSource::Declaration(member) => {
                let member = self.value_symbol_of_export(member);
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

    /// `(number) => value`: the numbers are the places in `members_of_namespace`.
    pub(crate) fn emit_module_namespace_reader(&mut self, fx: &mut Fx, file: FileId) {
        let number = self.add_entry_param(fx, Ty::NONE);
        let number = self.emit_throwing(fx, Op::Coerce { value: number, to: self.known.int32, why: Why::Claim });
        let members = self.members_of_namespace(self.files.file_symbol(file));
        let arms: Vec<crate::id::BlockId> = members.iter().map(|_| fx.b.new_block()).collect();
        let none = fx.b.new_block();
        let cases = arms.iter().enumerate().map(|(number, &arm)| (number as i64, ir::Target::new(arm))).collect();
        fx.b.terminate(ir::Term::Switch { value: number, cases, default: ir::Target::new(none) });
        for (&arm, (_, source)) in arms.iter().zip(members) {
            fx.b.seal(arm);
            fx.b.switch_to(arm);
            let value = self.read_member_of_namespace(fx, source);
            self.terminate_with_return(fx, value);
        }
        fx.b.seal(none);
        fx.b.switch_to(none);
        let undefined = self.emit(fx, Op::Undefined);
        self.terminate_with_return(fx, undefined);
    }

    // ───────────────────────────── functions ─────────────────────────────

    /// The function of the program for a function of the source.
    pub(crate) fn declare_function(&mut self, file: FileId, func: FnId, class: Option<(FileId, hir::ClassId)>) -> FuncId {
        if let Some(&id) = self.funcs.get(&(file, func)) {
            return id;
        }
        if file == self.file {
            return self.declare_function_anew(file, func, class);
        }
        self.declare_function_of_another_file(file, func, class)
    }

    pub(super) fn declare_function_anew(&mut self, file: FileId, func: FnId, class: Option<(FileId, hir::ClassId)>) -> FuncId {
        if self.is_written_in_second_body(file, func) {
            return self.declare_function_as(file, func, class, Role::Second);
        }
        if !self.has_two_bodies(file, func) {
            let whole = self.declare_function_as(file, func, class, Role::Whole);
            if (class.is_none() || self.hir(file)[func].kind == hir::FnKind::Arrow) && self.ask(|c| c.has_second_body_for_the_log(file, func)) && self.holds_an_annotated_parameter(file, func) {
                let entry = self.declare_function_as(file, func, class, Role::Beside);
                if file == self.file {
                    let second = self.declare_function_as(file, func, class, Role::Second);
                    self.typed_bodies.insert(entry, whole);
                    self.second_bodies.insert(entry, second);
                }
                self.entries_beside.insert(whole, entry);
            }
            return whole;
        }
        let entry = self.declare_function_as(file, func, class, Role::Entry);
        let typed = self.declare_function_as(file, func, class, Role::Typed);
        self.typed_bodies.insert(entry, typed);
        if file == self.file {
            let second = self.declare_function_as(file, func, class, Role::Second);
            self.second_bodies.insert(entry, second);
        }
        entry
    }

    fn has_two_bodies(&mut self, file: FileId, func: FnId) -> bool {
        if !self.ask(|c| c.has_second_body(file, func)) {
            return false;
        }
        self.holds_an_annotated_parameter(file, func)
    }

    fn holds_an_annotated_parameter(&mut self, file: FileId, func: FnId) -> bool {
        let using = self.using_arguments(file);
        if using.functions.contains(&func) || using.arrows.contains(&func) || self.shared.builtin_functions.declared_as(file, func).is_some() {
            return false;
        }
        let parameters: Vec<hir::ParamId> = self.hir(file)[func].params.iter().collect();
        parameters.into_iter().any(|p| {
            let held_to = self.ty_of_param(file, p).id;
            held_to.is_some() && held_to != self.out.tys.anything && self.why_of_param(file, p) == Why::Cast
        })
    }

    pub(crate) fn declare_function_as(&mut self, file: FileId, func: FnId, class: Option<(FileId, hir::ClassId)>, role: Role) -> FuncId {
        let is_root_of_second_body = role == Role::Second && !self.is_written_in_second_body(file, func);
        let says_nothing = matches!(role, Role::Entry | Role::Beside | Role::Second);
        let hir = self.hir(file);
        let f = &hir[func];
        let builtin = self.shared.builtin_functions.declared_as(file, func).copied();
        if f.name.is_none() && f.kind == hir::FnKind::Decl && f.flags.contains(Flags::DEFAULT) {
            let name = self.out.strs.intern(b"default");
            self.given_function_names.entry((file, func)).or_insert(name);
        }
        let name = match self.given_function_names.get(&(file, func)) {
            _ if builtin.is_some_and(|builtin| builtin.name.is_some() || builtin.is_getter) => {
                let prefix: &[u8] = if builtin.is_some_and(|builtin| builtin.is_getter) { b"get " } else { b"" };
                let name = [prefix, self.c.atoms().bytes(builtin.and_then(|builtin| builtin.name).unwrap_or(f.name))].concat();
                self.out.strs.intern(&name)
            }
            _ if f.name.is_some() && matches!(f.kind, hir::FnKind::Getter | hir::FnKind::Setter) => {
                let prefix: &[u8] = if f.kind == hir::FnKind::Getter { b"get " } else { b"set " };
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
        let root_of_second_body = match role {
            Role::Second if is_root_of_second_body => func,
            Role::Second => self.second_root.unwrap_or(func),
            _ => FnId::NONE,
        };
        let source = super::Source::Function { file, func, class, role, root_of_second_body };
        let id = if is_root_of_second_body {
            let id = self.add_header(name, module, f.start, kind, source);
            self.second_work.push_back(id);
            id
        } else {
            self.add_func(name, module, f.start, kind, source)
        };
        if !matches!(role, Role::Typed | Role::Beside) && !is_root_of_second_body {
            let was = self.funcs.insert((file, func), id);
            if let Some(undo) = &mut self.undo {
                undo.funcs.push(((file, func), was));
            }
        }
        let uses_arguments = self.uses_arguments(file, func);
        let is_sloppy = self.ask(|c| c.is_sloppy_function(file, func));
        let mut signature = Signature::default();
        let (mut params, mut annotated) = (Vec::new(), Vec::new());
        for p in f.params.iter() {
            let param = if says_nothing { Ty::NONE } else { self.ty_of_param(file, p) };
            params.push(param.id);
            annotated.push(param.id.is_some() && self.why_of_param(file, p) == Why::Cast);
            signature.params.push(param.checked);
        }
        let has_this = match kind {
            ir::FuncKind::Arrow => false,
            ir::FuncKind::Plain => self.ask(|c| c.inspects_this(file, func)),
            _ => true,
        };
        let mut flags = if has_this { func_flags::HAS_THIS } else { 0 };
        if builtin.is_none() && f.name.is_none() && self.given_function_names.contains_key(&(file, func)) {
            flags |= func_flags::NAME_IS_GIVEN;
        }
        if matches!(role, Role::Entry | Role::Beside) {
            flags |= func_flags::IS_HIDDEN_IN_STACK_TRACES;
        }
        if role == Role::Beside {
            flags |= func_flags::IS_GENERAL_ENTRY;
        }
        if f.flags.contains(Flags::ASYNC) && role != Role::Beside {
            flags |= func_flags::ASYNC;
        }
        if f.flags.contains(Flags::GENERATOR) {
            flags |= func_flags::GENERATOR;
            if f.params.iter().any(|p| hir[p].default.is_some() || !matches!(hir[hir[p].pat].kind, hir::PatKind::Ident(_))) {
                flags |= func_flags::STARTS_EAGERLY;
            }
        }
        if f.params.iter().next_back().is_some_and(|p| hir[p].flags.contains(Flags::REST)) {
            flags |= func_flags::HAS_REST;
        }
        if uses_arguments {
            signature.params.clear();
            params = vec![TyId::NONE];
            annotated.clear();
            flags |= func_flags::HAS_REST;
        }
        if kind == ir::FuncKind::Plain && flags & (func_flags::ASYNC | func_flags::GENERATOR) == 0 && self.ask(|c| c.mentions_new_target(file, func)) {
            flags |= func_flags::HAS_NEW_TARGET;
        }
        if kind == ir::FuncKind::Plain && self.ask(|c| c.has_no_field_names_on_prototype(file, func)) {
            flags |= func_flags::HAS_NO_FIELD_NAMES_ON_PROTOTYPE;
        }
        // For a method, an object of its class. For another function, what it declares `this` to be, or what it is a member of.
        let this_declared = if has_this && !self.is_untyped_file(file) && !says_nothing {
            match self.ask(|c| c.this_taken_by_fn(file, func)) {
                Some(this) => {
                    signature.this = Some(this);
                    self.declared(this)
                }
                None => TyId::NONE,
            }
        } else {
            TyId::NONE
        };
        let result = if says_nothing || matches!(f.kind, hir::FnKind::Constructor | hir::FnKind::Setter | hir::FnKind::StaticBlock) {
            TyId::NONE
        } else if self.is_untyped_file(file) {
            // What its `return`s are shown to yield.
            let kinds = self.ask(|c| c.kinds_returned_by(file, func));
            let described = self.ty_of_kinds(kinds);
            self.unless_plain_number(described)
        } else if self.ask(|c| c.returns_no_value(file, func)) {
            // `void` leaves open what a function yields. The text of this one does not.
            signature.result = Some(TypeId::UNDEFINED);
            self.declared(TypeId::UNDEFINED)
        } else {
            // `never`: it is not expected to come back. If it does, with whatever.
            let (result, is_annotated) = self.ask(|c| c.result_of_fn(file, func));
            if result.is_never() {
                TyId::NONE
            } else {
                signature.result = Some(result);
                signature.is_result_annotated = is_annotated;
                let described = self.declared(result);
                let written = self.ask(|c| c.integers_written_for_result(file, func));
                self.with_integers(described, written)
            }
        };
        self.set_signature(id, signature);
        let out = &mut self.out.funcs[id.idx()];
        out.params = params;
        out.annotated = annotated;
        out.this_declared = this_declared;
        out.result = result;
        out.flags = flags | if is_sloppy { func_flags::IS_SLOPPY } else { 0 };
        out.length = f.params.iter().take_while(|&p| hir[p].default.is_none() && !hir[p].flags.contains(Flags::REST)).count() as u16;
        // What another file declares is at the level of its module.
        if file == self.file {
            let captures = self.c.captures_of_fn(file, func);
            self.set_captures(id, &captures);
        }
        id
    }

    /// Whether the function refers to its `arguments` object.
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
                // An arrow function sees the object of the function around it.
                let mut at = self.function_running(file, id);
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

    /// The function a declaration at the top level of a file, or around the code being built, stands for.
    pub(crate) fn function_of_declaration(&mut self, fx: &Fx, file: FileId, func: FnId) -> Option<FuncId> {
        if let Some(&id) = self.funcs.get(&(file, func)) {
            return Some(id);
        }
        let _ = fx;
        if self.c.bound(file).fns[func.idx()].enclosing.is_none() && !matches!(self.hir(file)[func].body, hir::FnBody::None) {
            return Some(self.declare_function(file, func, None));
        }
        None
    }

    fn function_value(&mut self, fx: &mut Fx, file: FileId, func: FnId, pos: u32) -> V {
        let Some(id) = self.function_of_declaration(fx, file, func) else {
            return self.unsupported(fx, pos, "a function that is declared later in an inner scope");
        };
        self.closure_of(fx, id)
    }

    /// The function as a value, where nothing tells one closure of it from another.
    pub(crate) fn closure_of(&mut self, fx: &mut Fx, id: FuncId) -> V {
        let captures = self.capture_values(fx, id, 0);
        if captures.is_empty() {
            return self.emit(fx, Op::FuncRef(id));
        }
        self.emit(fx, Op::Closure { func: id, captures })
    }

    /// The declaration with a body of a function that nothing is stored to.
    pub(crate) fn function_declared_as(&self, sym: Sym) -> Option<(FileId, FnId)> {
        let decls = self.files.decls(sym);
        if self.is_ambient(sym) || self.is_assigned(sym) || decls.iter().any(|declared| matches!(declared.1, Decl::Var(_) | Decl::Param(_))) {
            return None;
        }
        let with_body = |&(file, decl): &(FileId, Decl)| matches!(decl, Decl::Fn(func) if !matches!(self.hir(file)[func].body, hir::FnBody::None));
        match decls.into_iter().filter(with_body).next_back() {
            Some((file, Decl::Fn(func))) => Some((file, func)),
            _ => None,
        }
    }

    /// The closure of the function declaration `sym`, which is `id`, where the name is used as a value. It is the same object for as long
    /// as the scope of the declaration is not entered anew.
    fn closure_of_declaration(&mut self, fx: &mut Fx, sym: Sym, id: FuncId, pos: u32) -> V {
        let declared = self.function_declared_as(sym).filter(|declared| declared.0 == self.file);
        if let Some((file, func)) = declared
            && self.names_function_expression(sym)
            && let Some((activation, field)) = self.scope_of_function_expression(file, func)
        {
            let layout = self.layout_of_activation(activation);
            let env = self.env_of(fx, layout);
            let captures = self.capture_values(fx, id, pos);
            return self.emit(fx, Op::ClosureOnce { func: id, captures, env, field });
        }
        match declared.and_then(|(file, func)| self.c.declared_closure(file, func)) {
            // `CreatedAtEntry`: a local variable holds it, which is read before it gets here.
            None | Some(DeclaredClosure::Unobserved | DeclaredClosure::CreatedAtEntry) => self.closure_of(fx, id),
            Some(DeclaredClosure::CreatedAtUse) => {
                let captures = self.capture_values(fx, id, pos);
                self.emit(fx, Op::Closure { func: id, captures })
            }
            Some(DeclaredClosure::KeptInEnvironment(activation, field)) => {
                let layout = self.layout_of_activation(activation);
                let env = self.env_of(fx, layout);
                let captures = self.capture_values(fx, id, pos);
                self.emit(fx, Op::ClosureOnce { func: id, captures, env, field })
            }
        }
    }

    /// The scope of its own that an evaluation of the function expression enters, and the field of its environment that keeps the closure: the expression names itself,
    /// or its `arguments` object shows it.
    pub(crate) fn scope_of_function_expression(&mut self, file: FileId, func: FnId) -> Option<(Activation, u32)> {
        match self.c.declared_closure(file, func) {
            Some(DeclaredClosure::KeptInEnvironment(activation @ Activation::Expression(_), field)) => Some((activation, field)),
            _ => self.c.kept_function_expression(file, func).filter(|kept| matches!(kept.0, Activation::Expression(_))),
        }
    }

    /// The closure that runs, for `arguments.callee`: see `Checker::keeps_parameters_in_arguments`.
    pub(crate) fn closure_that_runs(&mut self, fx: &mut Fx) -> V {
        let (file, func, id) = (fx.file, fx.func, fx.id);
        let pos = self.hir(file)[func].start;
        if let Some((activation, field)) = self.scope_of_function_expression(file, func) {
            let layout = self.layout_of_activation(activation);
            let env = self.env_of(fx, layout);
            let captures = self.capture_values(fx, id, pos);
            return self.emit(fx, Op::ClosureOnce { func: id, captures, env, field });
        }
        if matches!(self.c.bound(file).fns[func.idx()].owner, bun_sema::bind::FnOwner::Stmt(_)) {
            let sym = self.function_symbol(file, func);
            if self.function_declared_as(sym) == Some((file, func)) {
                return self.closure_of_declaration(fx, sym, id, pos);
            }
        }
        self.unsupported(fx, pos, "the `arguments` object of sloppy-mode code, which exposes the function, in a function whose name is assigned to")
    }

    // ───────────────────────────── what a scope declares ─────────────────────────────

    pub(crate) fn names_of_pat(&self, file: FileId, pat: PatId, out: &mut Vec<Sym>) {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => {
                let id = self.c.bound(file).pat_symbol[pat.idx()];
                if id.is_some() {
                    out.push(self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(file, id)));
                }
            }
            PatKind::Object(props) => {
                for p in props.iter() {
                    self.names_of_pat(file, hir[p].value, out);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.names_of_pat(file, hir[e].pat, out);
                }
            }
        }
    }

    /// `let`, `const` and classes declared directly by the statements.
    pub(crate) fn lexical_names(&self, file: FileId, stmts: IdList<StmtId>, out: &mut Vec<Sym>) {
        let hir = self.hir(file);
        for stmt in hir.ids(stmts) {
            match hir[stmt].kind {
                StmtKind::Var(decls) => {
                    for d in decls.iter() {
                        if hir[d].kind != VarKind::Var && !hir[d].flags.contains(Flags::AMBIENT) {
                            self.names_of_pat(file, hir[d].pat, out);
                        }
                    }
                }
                // Where there is one class object for as long as the program runs, no variable holds it.
                StmtKind::Class(class) if !hir[class].flags.contains(Flags::AMBIENT) && !self.c.is_evaluated_once(file, Parent::Stmt(stmt)) => {
                    out.push(self.class_symbol(file, class));
                }
                _ => {}
            }
        }
    }

    pub(crate) fn class_symbol(&self, file: FileId, class: hir::ClassId) -> Sym {
        let id = self.c.bound(file).symbol_of_declaration(Decl::Class(class));
        self.files.export_symbol_of_value_symbol_if_exported(self.files.sym(file, id))
    }

    /// `var`s declared anywhere in the statements, inner functions aside.
    pub(crate) fn var_names(&self, file: FileId, stmt: StmtId, out: &mut Vec<Sym>) {
        if stmt.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::Var(decls) => {
                for d in decls.iter() {
                    if hir[d].kind == VarKind::Var && !hir[d].flags.contains(Flags::AMBIENT) {
                        self.names_of_pat(file, hir[d].pat, out);
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
            StmtKind::While { body, .. } | StmtKind::DoWhile { body, .. } | StmtKind::Labeled { body, .. } => self.var_names(file, body, out),
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
            StmtKind::Try { block, handler, finalizer, .. } => {
                self.var_names(file, block, out);
                self.var_names(file, handler, out);
                self.var_names(file, finalizer, out);
            }
            _ => {}
        }
    }
}

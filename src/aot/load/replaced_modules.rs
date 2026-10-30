//! Which modules a file of a test run mocks, which exports it spies on, and whose module objects it hands on. The file is read by itself,
//! so a module is what the file writes for it.
//! A spy on an object that is no module object by its binding counts for nothing: a module object gets there only from a file that hands it on, and that file says so.

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, Decl, Parent, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    ExportSpecId, ExprId, ExprKind, File, Flags, MemberKey, PatId, PatKind, PropKey, StmtKind, UnOp,
};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};

use crate::builtins::{BuiltinId, ResolvedBuiltins, RuntimeModule};

#[derive(Default)]
pub(super) struct ReplacedModules {
    /// Any export of them may be replaced.
    pub whole: Vec<Atom>,
    pub exports: Vec<(Atom, Atom)>,
    /// As `whole`, of a module that the file does not spell.
    pub any: bool,
    /// Their objects go where the file does not follow them. A spy that takes an object from somewhere may get one.
    pub handed_on: Vec<Atom>,
    /// As `handed_on`, of a module that the file does not spell.
    pub hands_on_any: bool,
    pub spies_on_unknown_objects: bool,
}

fn is_spy(builtin: BuiltinId) -> bool {
    matches!(
        builtin,
        BuiltinId::BunTestSpyOn | BuiltinId::BunTestJestSpyOn | BuiltinId::BunTestViSpyOn
    )
}

fn leads_to_spy(builtin: BuiltinId) -> bool {
    is_spy(builtin) || matches!(builtin, BuiltinId::BunTestJest | BuiltinId::BunTestVi)
}

/// Whether a spy may take the object of a module where the file does not say so: `spyOn(object, "name")` with an object that is no module object by
/// its binding and no built-in, `spyOn(ns, name)` with a name that the build does not know, and a `spyOn` that goes somewhere as a value.
/// `is_test_runner`: whether the site loads `bun:test`. `is_module_object`: whether the name stands for the object of a module.
pub(crate) fn spies_on_unknown_objects<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    analysis: &FileAnalysis<'s>,
    builtins: &ResolvedBuiltins,
    is_test_runner: &dyn Fn(usize) -> bool,
    is_module_object: &dyn Fn(ExprId) -> bool,
) -> bool {
    let mut loads_test_runner = false;
    for (index, site) in analysis.import_sites.iter().enumerate() {
        if !is_test_runner(index) {
            continue;
        }
        loads_test_runner = true;
        // Whoever gets the object of `bun:test`, or imports from this file what it exports from there, has `spyOn` under a name that stands for nothing.
        match site.kind {
            ImportSiteKind::Import(import) if hir[import].namespace.is_none() => {}
            ImportSiteKind::MockModule(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaResolve(_) => {}
            _ => return true,
        }
    }
    if !loads_test_runner {
        return false;
    }
    let exported =
        (0..hir.export_specs.len() as u32).map(|spec| bound.exported_binding(ExportSpecId(spec)));
    let is_exported = |binding: Binding| {
        matches!(binding, Binding::Symbol(symbol)
        if builtins.of_symbol(symbol).is_some_and(|path| leads_to_spy(path.id)))
    };
    if exported
        .chain(analysis.bindings_read_without_expression(hir, bound))
        .any(is_exported)
    {
        return true;
    }
    (0..hir.exprs.len() as u32).map(ExprId).any(|mention| {
        let Some(builtin) = builtins.builtin_of_expression(mention).filter(|&it| leads_to_spy(it)) else {
            return false;
        };
        if analysis.decisions.is_dead_expr(mention) {
            return false;
        }
        let mut outermost = mention;
        while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
            && hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        let Parent::Expr(user) = bound.parent_of_expr(outermost) else {
            return true;
        };
        if !is_spy(builtin) {
            // `jest.spyOn`
            return !matches!(hir.member_key(user), Some((object, MemberKey::Name(_))) if object == outermost);
        }
        let ExprKind::Call(call) = hir[user].kind else {
            return true;
        };
        let call = hir[call];
        if call.callee != outermost {
            return true;
        }
        let mut operands = hir.ids(call.args);
        if operands.clone().any(|operand: ExprId| matches!(hir[operand].kind, ExprKind::Spread(_))) {
            return true;
        }
        let (Some(object), Some(name)) = (operands.next(), operands.next()) else {
            return false;
        };
        let object = hir.skip_type_assertions(object);
        let name = analysis.decisions.constant(hir, hir.skip_type_assertions(name));
        match is_module_object(object) {
            true => !matches!(name, FoldedValue::Constant(Constant::String(_))),
            false => builtins.builtin_of_expression(object).is_none(),
        }
    })
}

struct Look<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    builtins: &'a ResolvedBuiltins,
    module_of: ModuleOf<'a>,
    found: ReplacedModules,
}

/// The module of Bun that a specifier names.
pub(super) type ModuleOf<'a> = &'a dyn Fn(ImportSpecifier) -> Option<RuntimeModule>;

/// `None`: the file does not spell it.
type Specifiers = Option<Vec<Atom>>;

pub(super) fn find_replaced_modules<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    analysis: &FileAnalysis<'s>,
    builtins: &ResolvedBuiltins,
    module_of: ModuleOf<'_>,
) -> ReplacedModules {
    let mut look = Look {
        hir,
        bound,
        analysis,
        builtins,
        module_of,
        found: ReplacedModules::default(),
    };
    look.run();
    look.found
}

impl Look<'_, '_> {
    fn specifiers_of(&self, specifier: &ImportSpecifier) -> Specifiers {
        let alternatives = self.analysis.alternatives_of(specifier).iter();
        alternatives
            .map(|alternative| match *alternative {
                ImportSpecifier::Constant(text) => Some(text),
                _ => None,
            })
            .collect()
    }

    fn replace_whole(&mut self, modules: &Specifiers) {
        match modules {
            Some(modules) => self.found.whole.extend_from_slice(modules),
            None => self.found.any = true,
        }
    }

    fn hand_on(&mut self, modules: &Specifiers) {
        match modules {
            Some(modules) => self.found.handed_on.extend_from_slice(modules),
            None => self.found.hands_on_any = true,
        }
    }

    fn replace_export(&mut self, modules: &Specifiers, name: Option<Atom>) {
        match (modules, name) {
            (Some(modules), Some(name)) => {
                let exports = modules.iter().map(|&module| (module, name));
                self.found.exports.extend(exports);
            }
            _ => self.replace_whole(modules),
        }
    }

    fn outermost_type_assertion(&self, operand: ExprId) -> ExprId {
        let mut outermost = operand;
        while let Parent::Expr(parent) = self.bound.parent_of_expr(outermost)
            && self.hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        outermost
    }

    fn constant_name(&self, key: ExprId) -> Option<Atom> {
        let key = self.hir.skip_type_assertions(key);
        match self.analysis.decisions.constant(self.hir, key) {
            FoldedValue::Constant(Constant::String(name)) => Some(name),
            _ => None,
        }
    }

    // `{ a, b: c }`
    fn reads_names_alone(&self, pattern: PatId) -> bool {
        let hir = self.hir;
        matches!(hir[pattern].kind, PatKind::Object(properties) if properties.iter().all(|it| {
            !hir[it].is_rest && matches!(hir[it].key, PropKey::Name(_))
        }))
    }

    fn is_spy(&self, callee: ExprId) -> bool {
        let callee = self.hir.skip_type_assertions(callee);
        self.builtins
            .builtin_of_expression(callee)
            .is_some_and(is_spy)
    }

    // `object.name = f`, `delete object.name`, `object.name++`
    fn is_written(&self, member: ExprId) -> bool {
        let hir = self.hir;
        let member = self.outermost_type_assertion(member);
        let Parent::Expr(user) = self.bound.parent_of_expr(member) else {
            return false;
        };
        match hir[user].kind {
            ExprKind::Assign { target, .. } => target == member,
            ExprKind::Unary { op, operand } => {
                operand == member
                    && matches!(
                        op,
                        UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
                    )
            }
            _ => false,
        }
    }

    /// `object`: an expression whose value is the object of one of `modules`.
    fn look_at_use(&mut self, object: ExprId, modules: &Specifiers) {
        let hir = self.hir;
        let object = self.outermost_type_assertion(object);
        match self.bound.parent_of_expr(object) {
            Parent::Expr(user) => match (hir.member_key(user), hir[user].kind) {
                (Some((accessed, key)), _) if accessed == object => {
                    if self.is_written(user) {
                        let name = match key {
                            MemberKey::Name(name) => Some(name),
                            MemberKey::Computed(key) => self.constant_name(key),
                            MemberKey::PrivateName(_) => None,
                        };
                        self.replace_export(modules, name);
                    }
                }
                (_, ExprKind::Call(call))
                    if hir[call].args.len() >= 2
                        && hir.id_at::<ExprId>(hir[call].args, 0) == object
                        && self.is_spy(hir[call].callee) =>
                {
                    let name = self.constant_name(hir.id_at::<ExprId>(hir[call].args, 1));
                    self.replace_export(modules, name);
                }
                _ => self.hand_on(modules),
            },
            Parent::VarInit(declaration) if self.reads_names_alone(hir[declaration].pat) => {}
            // `import("./a");` for what the module does.
            Parent::Stmt(_) => {}
            _ => self.hand_on(modules),
        }
    }

    // A `const`, `let` or `var` that is declared once, never stored to again, not exported and not seen by `eval`.
    fn find_holder(&self, value: ExprId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
            return None;
        };
        let declaration = hir[declaration];
        if !matches!(hir[declaration.pat].kind, PatKind::Ident(_))
            || declaration.flags.contains(Flags::EXPORT)
        {
            return None;
        }
        let holder = bound.declared_symbol(Decl::Var(declaration.pat));
        (holder.is_some() && bound.is_stable_binding(holder)).then_some(holder)
    }

    fn run(&mut self) {
        let (hir, bound, analysis) = (self.hir, self.bound, self.analysis);
        let mut held: Vec<(SymbolId, Specifiers)> = Vec::new();
        for site in analysis.import_sites {
            let is_dead = |call: ExprId| analysis.decisions.is_dead_expr(call);
            let modules = self.specifiers_of(&site.specifier);
            match site.kind {
                ImportSiteKind::MockModule(call) if !is_dead(call) => self.replace_whole(&modules),
                ImportSiteKind::Import(import)
                    if hir[import].namespace.is_some() && !hir[import].type_only =>
                {
                    held.push((
                        bound.declared_symbol(Decl::ImportNamespace(import)),
                        modules,
                    ));
                }
                // `export * as name`: whoever reads the name holds the object.
                ImportSiteKind::ExportStar(statement) if matches!(hir[statement].kind, StmtKind::ExportStar { alias, type_only: false, .. } if alias.is_some()) =>
                {
                    self.hand_on(&modules);
                }
                ImportSiteKind::ImportCall(call)
                | ImportSiteKind::Require(call)
                | ImportSiteKind::ImportMetaRequire(call)
                    if !is_dead(call) =>
                {
                    let mut value = self.outermost_type_assertion(call);
                    if matches!(site.kind, ImportSiteKind::ImportCall(_)) {
                        match bound.parent_of_expr(value) {
                            Parent::Expr(user) if matches!(hir[user].kind, ExprKind::Await(_)) => {
                                value = self.outermost_type_assertion(user);
                            }
                            Parent::Stmt(_) => continue,
                            // The promise goes somewhere.
                            _ => {
                                self.hand_on(&modules);
                                continue;
                            }
                        }
                    }
                    match self.find_holder(value) {
                        Some(holder) => held.push((holder, modules)),
                        None => self.look_at_use(value, &modules),
                    }
                }
                _ => {}
            }
        }
        let modules_held_by = |binding: Binding| match binding {
            Binding::Symbol(symbol) => held.iter().find(|it| it.0 == symbol).map(|it| &it.1),
            _ => None,
        };
        self.found.spies_on_unknown_objects = spies_on_unknown_objects(
            hir,
            bound,
            analysis,
            self.builtins,
            &|site| {
                (self.module_of)(analysis.import_sites[site].specifier)
                    == Some(RuntimeModule::BunTest)
            },
            &|object| {
                bound.is_evaluated_ident(object) && modules_held_by(bound.binding(object)).is_some()
            },
        );
        if held.is_empty() {
            return;
        }
        for (symbol, modules) in &held {
            if bound.is_visible_to_eval(*symbol) {
                self.hand_on(modules);
            }
        }
        let without_expression = analysis.bindings_read_without_expression(hir, bound);
        let exported = (0..hir.export_specs.len() as u32)
            .map(|spec| bound.exported_binding(ExportSpecId(spec)));
        for modules in without_expression
            .chain(exported)
            .filter_map(modules_held_by)
        {
            self.hand_on(modules);
        }
        for reference in (0..hir.exprs.len() as u32).map(ExprId) {
            if bound.is_evaluated_ident(reference)
                && !analysis.decisions.is_dead_expr(reference)
                && let Some(modules) = modules_held_by(bound.binding(reference))
            {
                self.look_at_use(reference, modules);
            }
        }
    }
}

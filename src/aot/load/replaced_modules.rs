//! Which modules a file of a test run mocks, which exports it spies on, and whose module objects it hands on. The file is read by itself,
//! so a module is what the file writes for it.
//! A spy on an object that is no module object by its binding counts for nothing: a module object gets there only from a file that hands it on, and that file says so.

use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, Decl, Parent, SymbolId};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    ExportSpecId, ExprId, ExprKind, File, Flags, MemberKey, PatId, PatKind, PropKey, StmtKind, UnOp,
};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, is_module_call_of_plugin};
use bun_sema::program::Files;

use crate::builtins::{BuiltinId, ResolvedBuiltins, RuntimeModule};
use crate::load::is_in_node_modules;
use crate::load::runtime_modules::find_module_named;
use crate::load::sources::parsed_source;
use crate::modules::evicted::{
    FileOfKey, find_file_of_key, find_files_named_with_query,
    find_names_that_unspelled_keys_may_be, find_paths_changed_on_disk,
    stands_where_a_throw_is_caught,
};

#[derive(Default)]
pub(super) struct ReplacedModules {
    /// Any export of them may be replaced.
    pub whole: Vec<Atom>,
    /// `build.module("dep", ..)` in the `setup` of a plugin. They are among `whole`. The loader answers for such a name as it is written.
    pub named_by_plugins: Vec<Atom>,
    pub exports: Vec<(Atom, Atom)>,
    /// As `whole`, of a module that the file does not spell.
    pub any: bool,
    /// Their objects go where the file does not follow them. A spy that takes an object from somewhere may get one.
    pub handed_on: Vec<Atom>,
    /// As `handed_on`, of a module that the file does not spell.
    pub hands_on_any: bool,
    pub spies_on_unknown_objects: SpiesOnUnknownObjects,
    /// `delete require.cache[require.resolve("./a")]`
    pub evicted: Vec<Atom>,
    /// `find_paths_changed_on_disk`
    pub changed_on_disk: Vec<(Atom, bool)>,
    /// As `evicted`, of a file that this one does not spell.
    pub evicts_any: bool,
    /// `ReplacedByTests::files_required_where_throws_are_caught`
    pub required_where_throws_are_caught: Vec<Atom>,
    /// `import("./a?again")`
    pub names_file_with_query: bool,
    /// `ReplacedByTests::files_imported_by_statements`, `files_imported_by_calls` and `files_required`
    pub imported_by_statements: Vec<Atom>,
    pub imported_by_calls: Vec<Atom>,
    pub required: Vec<Atom>,
}

fn is_spy(builtin: BuiltinId) -> bool {
    matches!(
        builtin,
        BuiltinId::BunTestSpyOn | BuiltinId::BunTestJestSpyOn | BuiltinId::BunTestViSpyOn
    )
}

/// `Bun.jest(path)` answers with what `bun:test` exports, under names that stand for nothing.
fn names_bun_jest(
    hir: &File<'_>,
    analysis: &FileAnalysis<'_>,
    builtins: &ResolvedBuiltins,
) -> bool {
    (0..hir.exprs.len() as u32).map(ExprId).any(|mention| {
        builtins.builtin_of_expression(mention) == Some(BuiltinId::BunJest)
            && !analysis.decisions.is_dead_expr(mention)
    })
}

/// `const { test, expect } = Bun.jest(path)` and `Bun.jest(path).test` take by name what mocks nothing.
fn gets_what_mocks_modules_from_bun_jest(
    hir: &File<'_>,
    bound: &Bound<'_>,
    analysis: &FileAnalysis<'_>,
    builtins: &ResolvedBuiltins,
) -> bool {
    let mocks = |name: Atom| name == known::mock || name == known::jest || name == known::vi;
    (0..hir.exprs.len() as u32).map(ExprId).any(|mention| {
        if builtins.builtin_of_expression(mention) != Some(BuiltinId::BunJest)
            || analysis.decisions.is_dead_expr(mention)
        {
            return false;
        }
        let Parent::Expr(answer) = bound.parent_of_expr(mention) else {
            return true;
        };
        if !matches!(hir[answer].kind, ExprKind::Call(call) if hir[call].callee == mention) {
            return true;
        }
        match bound.parent_of_expr(answer) {
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Object(properties) => properties.iter().any(|it| {
                    hir[it].is_rest || !matches!(hir[it].key, PropKey::Name(name) if !mocks(name))
                }),
                _ => true,
            },
            Parent::Expr(user) => !matches!(hir.member_key(user),
                Some((object, MemberKey::Name(name))) if object == answer && !mocks(name)),
            Parent::Stmt(_) => false,
            _ => true,
        }
    })
}

fn leads_to_spy(builtin: BuiltinId) -> bool {
    is_spy(builtin) || matches!(builtin, BuiltinId::BunTestJest | BuiltinId::BunTestVi)
}

/// The spies of a file that may take the object of a module where the file does not say so.
#[derive(Default)]
pub(crate) struct SpiesOnUnknownObjects {
    /// `spyOn(object, "name")`, with an object that is no module object by its binding and no built-in: it replaces what goes by that name and nothing else.
    pub names: Vec<Atom>,
    /// A `spyOn` that goes somewhere as a value: nobody sees what it is called with.
    pub is_any_name: bool,
    /// Such a spy under a name that the file does not spell, as in a helper that takes the name: whoever calls the helper spells it.
    /// A name that nobody spells opens nothing, and the spy that meets an export under it fails by name.
    pub takes_names_from_outside: bool,
    /// Such a spy under a name that is no constant where it is called, spelled or not: `for (const name of ["a", "b"]) spyOn(holder.it, name)`.
    pub has_name_that_is_no_constant: bool,
    /// A spy on an object for which the file spells built-ins and objects of modules alone, through a variable, a list or a parameter: the names that stand
    /// for the objects of modules there: `fs` in `const files = fs as Record<string, F>; spyOn(files, name)`.
    pub module_objects_behind_other_names: Vec<ExprId>,
}

/// `const { spyOn } = await import("bun:test")`, `(await import("bun:test")).spyOn(..)`: the names say what is taken, as in an import statement, and each
/// stands for what it names from then on. So too `const { test } = require("bun:test")` and `require("bun:test").test(..)`, where nothing is awaited.
/// `is_followed_from_require`: a `mock` that comes out of a require() makes no site of `mock.module(..)`, so whoever asks about mocks does not let it pass.
fn takes_names_alone<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    builtins: &ResolvedBuiltins,
    site: ImportSiteKind,
    is_followed_from_require: &dyn Fn(BuiltinId) -> bool,
) -> bool {
    let outermost_of = |operand: ExprId| {
        let mut outermost = operand;
        while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
            && hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        outermost
    };
    let answer = match site {
        ImportSiteKind::ImportCall(call) => {
            let Parent::Expr(awaited) = bound.parent_of_expr(outermost_of(call)) else {
                return false;
            };
            if !matches!(hir[awaited].kind, ExprKind::Await(_)) {
                return false;
            }
            outermost_of(awaited)
        }
        ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
            outermost_of(call)
        }
        _ => return false,
    };
    let is_followed = |builtin: BuiltinId| {
        matches!(site, ImportSiteKind::ImportCall(_)) || is_followed_from_require(builtin)
    };
    match bound.parent_of_expr(answer) {
        Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
            PatKind::Object(properties) => properties.iter().map(|it| hir[it]).all(|it| {
                let name = bound.declared_symbol(Decl::Var(it.value));
                !it.is_rest
                    && it.default.is_none()
                    && matches!(it.key, PropKey::Name(_))
                    && name.is_some()
                    && (builtins.of_symbol(name)).is_some_and(|path| is_followed(path.id))
            }),
            _ => false,
        },
        Parent::Expr(user) => {
            matches!(hir.member_key(user), Some((object, MemberKey::Name(_))) if object == answer)
                && (builtins.builtin_of_expression(user)).is_some_and(is_followed)
        }
        _ => false,
    }
}

/// `is_test_runner`: whether the site loads `bun:test`. `is_module_object`: whether the name stands for the object of a module: whoever asks looks at such a spy itself.
pub(crate) fn find_spies_on_unknown_objects<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    analysis: &FileAnalysis<'s>,
    builtins: &ResolvedBuiltins,
    is_test_runner: &dyn Fn(usize) -> bool,
    is_module_object: &dyn Fn(ExprId) -> bool,
) -> SpiesOnUnknownObjects {
    let under_any_name = SpiesOnUnknownObjects {
        is_any_name: true,
        ..SpiesOnUnknownObjects::default()
    };
    if names_bun_jest(hir, analysis, builtins) {
        return under_any_name;
    }
    let mut loads_test_runner = false;
    for (index, site) in analysis.import_sites.iter().enumerate() {
        if !is_test_runner(index) {
            continue;
        }
        loads_test_runner = true;
        // Whoever gets the object of `bun:test`, or imports from this file what it exports from there, has `spyOn` under a name that stands for nothing.
        match site.kind {
            ImportSiteKind::Import(import) if hir[import].namespace.is_none() => {}
            ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
                if takes_names_alone(hir, bound, builtins, site.kind, &|it| !leads_to_spy(it)) => {}
            ImportSiteKind::MockModule(_)
            | ImportSiteKind::RequireResolve(_)
            | ImportSiteKind::ImportMetaResolve(_) => {}
            _ => return under_any_name,
        }
    }
    if !loads_test_runner {
        return SpiesOnUnknownObjects::default();
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
        return under_any_name;
    }
    let mut names = Vec::new();
    let mut takes_names_from_outside = false;
    let mut has_name_that_is_no_constant = false;
    let mut module_objects_behind_other_names = Vec::new();
    for mention in (0..hir.exprs.len() as u32).map(ExprId) {
        let Some(builtin) = builtins
            .builtin_of_expression(mention)
            .filter(|&it| leads_to_spy(it))
        else {
            continue;
        };
        if analysis.decisions.is_dead_expr(mention) {
            continue;
        }
        let mut outermost = mention;
        while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
            && hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        let Parent::Expr(user) = bound.parent_of_expr(outermost) else {
            return under_any_name;
        };
        if !is_spy(builtin) {
            // `jest.spyOn`
            match hir.member_key(user) {
                Some((object, MemberKey::Name(_))) if object == outermost => continue,
                _ => return under_any_name,
            }
        }
        let call = match hir[user].kind {
            ExprKind::Call(call) if hir[call].callee == outermost => hir[call],
            _ => return under_any_name,
        };
        let mut operands = hir.ids(call.args);
        if operands
            .clone()
            .any(|operand: ExprId| matches!(hir[operand].kind, ExprKind::Spread(_)))
        {
            return under_any_name;
        }
        let (Some(object), Some(name)) = (operands.next(), operands.next()) else {
            continue;
        };
        let object = hir.skip_type_assertions(object);
        if is_module_object(object) || builtins.builtin_of_expression(object).is_some() {
            continue;
        }
        let name = hir.skip_type_assertions(name);
        let constant = match analysis.decisions.constant(hir, name) {
            FoldedValue::Constant(Constant::String(name)) => Some(name),
            _ => None,
        };
        has_name_that_is_no_constant |= constant.is_none();
        let objects = builtins.objects_spelled_for(name);
        if !objects.is_empty()
            && (objects.iter()).all(|it| it.is_builtin || is_module_object(it.object))
        {
            let modules = objects.iter().filter(|it| !it.is_builtin);
            module_objects_behind_other_names.extend(modules.map(|it| it.object));
            // Flow may lose the object on the way. It then goes by the names, and what it finds that is not open starts the build over.
            names.extend(builtins.keys_spelled_for(name));
            continue;
        }
        if let Some(name) = constant {
            names.push(name);
            continue;
        }
        let known_before = names.len();
        names.extend(builtins.keys_spelled_for(name));
        takes_names_from_outside |=
            names.len() == known_before || builtins.is_key_partly_read(name);
    }
    SpiesOnUnknownObjects {
        names,
        is_any_name: false,
        takes_names_from_outside,
        has_name_that_is_no_constant,
        module_objects_behind_other_names,
    }
}

/// The member of an export of `bun:test` that mocks modules.
fn member_that_mocks_modules(builtin: BuiltinId) -> Option<Atom> {
    match builtin {
        BuiltinId::BunTestMock => Some(known::module),
        BuiltinId::BunTestJest | BuiltinId::BunTestVi => Some(known::mock),
        _ => None,
    }
}

/// Whether the file may mock a module where it does not say so: `mock`, `jest` or `vi` goes somewhere as a value, `mock.module` does, or the
/// file gets `bun:test` in another way than by the names of an import statement. `mock.module(..)` where it stands is a site of the file.
/// `is_test_runner`: whether the site loads `bun:test`.
fn mocks_modules_out_of_sight<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    analysis: &FileAnalysis<'s>,
    builtins: &ResolvedBuiltins,
    is_test_runner: &dyn Fn(usize) -> bool,
) -> bool {
    if gets_what_mocks_modules_from_bun_jest(hir, bound, analysis, builtins) {
        return true;
    }
    let mut loads_test_runner = false;
    for (index, site) in analysis.import_sites.iter().enumerate() {
        if !is_test_runner(index) {
            continue;
        }
        loads_test_runner = true;
        match site.kind {
            ImportSiteKind::Import(import) if hir[import].namespace.is_none() => {}
            ImportSiteKind::ImportCall(_)
            | ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
                if takes_names_alone(hir, bound, builtins, site.kind, &|it| {
                    member_that_mocks_modules(it).is_none()
                }) => {}
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
        if builtins.of_symbol(symbol).is_some_and(|path| member_that_mocks_modules(path.id).is_some()))
    };
    if exported
        .chain(analysis.bindings_read_without_expression(hir, bound))
        .any(is_exported)
    {
        return true;
    }
    let outermost_of = |operand: ExprId| {
        let mut outermost = operand;
        while let Parent::Expr(parent) = bound.parent_of_expr(outermost)
            && hir.type_assertion_operand(parent) == Some(outermost)
        {
            outermost = parent;
        }
        outermost
    };
    let is_called = |callee: ExprId| {
        matches!(bound.parent_of_expr(callee), Parent::Expr(user)
            if matches!(hir[user].kind, ExprKind::Call(call) if hir[call].callee == callee))
    };
    (0..hir.exprs.len() as u32).map(ExprId).any(|mention| {
        let Some(member) = builtins
            .builtin_of_expression(mention)
            .and_then(member_that_mocks_modules)
        else {
            return false;
        };
        if analysis.decisions.is_dead_expr(mention) {
            return false;
        }
        let holder = outermost_of(mention);
        let Parent::Expr(user) = bound.parent_of_expr(holder) else {
            return true;
        };
        match hir.member_key(user) {
            Some((object, MemberKey::Name(name))) if object == holder => {
                name == member && !is_called(outermost_of(user))
            }
            Some((object, _)) if object == holder => true,
            // `mock(() => 1)`
            _ => !is_called(holder),
        }
    })
}

struct Look<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    builtins: &'a ResolvedBuiltins,
    module_of: ModuleOf<'a>,
    atoms: &'a Interner<'s>,
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
    atoms: &Interner<'s>,
) -> ReplacedModules {
    let mut look = Look {
        hir,
        bound,
        analysis,
        builtins,
        module_of,
        atoms,
        found: ReplacedModules::default(),
    };
    look.run();
    look.found
}

/// A package of test helpers: `exports.mockModule = (path, factory) => mock.module(path, factory)`. The look through the test files follows what they name beside them
/// and reads no installed package, so the build that holds the package finds it out. Few packages take anything from the test runner, and only those are looked at.
pub(crate) fn packages_mock_modules_that_they_do_not_spell(files: &Files<'_>) -> bool {
    find_what_packages_do_with_test_runner(files).mocks_any_module
}

/// What the installed packages of a program do with what they take from the test runner, where they do not spell on what.
#[derive(Default)]
pub(crate) struct TestRunnerInPackages {
    pub mocks_any_module: bool,
    /// `exports.spyAll = object => Object.keys(object).map(name => spyOn(object, name))`: an object that it is handed, under a name that it is handed or makes.
    /// Nobody has read who calls it with what, so any name.
    pub spies_on_unknown_objects: bool,
    /// `exports.silence = object => spyOn(object, "log")`
    pub names_spied_on_unknown_objects: Vec<Vec<u8>>,
}

pub(crate) fn find_what_packages_do_with_test_runner(files: &Files<'_>) -> TestRunnerInPackages {
    let atoms = &files.atoms;
    let module_of = |specifier: ImportSpecifier| match specifier {
        ImportSpecifier::Constant(text) => match atoms.bytes(text) {
            b"@jest/globals" | b"vitest" => Some(RuntimeModule::BunTest),
            text => find_module_named(text),
        },
        ImportSpecifier::Pattern { .. } | ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {
            None
        }
    };
    let mut all = TestRunnerInPackages::default();
    for &file in files.compiled_files() {
        let analysis = files.analysis(file);
        let mut sites = analysis.import_sites.iter();
        let takes_from_test_runner = is_in_node_modules(files.module(file).file_name())
            && sites.any(|site| module_of(site.specifier) == Some(RuntimeModule::BunTest));
        let Some(source) = parsed_source(files, file).filter(|_| takes_from_test_runner) else {
            continue;
        };
        let (hir, bound) = (files.hir(file), files.bound(file));
        let found =
            find_replaced_modules(hir, bound, analysis, &source.builtins, &module_of, atoms);
        let spies = found.spies_on_unknown_objects;
        all.mocks_any_module |= found.any;
        all.spies_on_unknown_objects |= spies.is_any_name || spies.takes_names_from_outside;
        let names = spies.names.iter().map(|&name| atoms.bytes(name).to_vec());
        all.names_spied_on_unknown_objects.extend(names);
    }
    all.names_spied_on_unknown_objects.sort_unstable();
    all.names_spied_on_unknown_objects.dedup();
    all
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
                // `tracker.watch(math, "twice")`: whatever the callee is and however it came here, the object of a module with a text behind it reads as a spy.
                // One export that is open for nothing costs less than a spy that is refused.
                (_, ExprKind::Call(call))
                    if hir[call].args.len() >= 2
                        && hir.id_at::<ExprId>(hir[call].args, 0) == object =>
                {
                    let name = self.constant_name(hir.id_at::<ExprId>(hir[call].args, 1));
                    // A guess opens a name of a module that the file spells, and nothing else.
                    if modules.is_some() && name.is_some() {
                        self.replace_export(modules, name);
                    }
                    self.hand_on(modules);
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

    fn find_evicted_modules(&mut self) {
        let (hir, bound, analysis) = (self.hir, self.bound, self.analysis);
        self.found.evicts_any = self.builtins.loses_sight_of_module_cache();
        self.found.names_file_with_query =
            !find_files_named_with_query(self.atoms, analysis).is_empty();
        for &key in self.builtins.keys_taken_out_of_module_cache() {
            match find_file_of_key(hir, bound, analysis, key) {
                FileOfKey::Path(path) => self.found.evicted.push(path),
                FileOfKey::Site(site) => {
                    match self.specifiers_of(&analysis.import_sites[site].specifier) {
                        Some(files) => self.found.evicted.extend(files),
                        None => self.found.evicts_any = true,
                    }
                }
                FileOfKey::Unknown => self.found.evicts_any = true,
            }
        }
        self.found.changed_on_disk = find_paths_changed_on_disk(analysis);
        let names =
            find_names_that_unspelled_keys_may_be(hir, bound, analysis, self.atoms, self.builtins);
        let names = names.into_iter().map(|name| self.atoms.intern(name));
        self.found.evicted.extend(names);
        for site in analysis.import_sites {
            if let ImportSiteKind::Require(call) = site.kind
                && stands_where_a_throw_is_caught(hir, bound, call)
            {
                let files = self.specifiers_of(&site.specifier).unwrap_or_default();
                let is_path = |file: &Atom| self.atoms.bytes(*file).starts_with(b".");
                let files = files.into_iter().filter(is_path);
                self.found.required_where_throws_are_caught.extend(files);
            }
        }
    }

    fn find_how_files_are_loaded(&mut self) {
        for site in self.analysis.import_sites {
            let loaded = match site.kind {
                ImportSiteKind::Import(_)
                | ImportSiteKind::ExportFrom(_)
                | ImportSiteKind::ExportStar(_) => &mut self.found.imported_by_statements,
                ImportSiteKind::ImportCall(_) => &mut self.found.imported_by_calls,
                ImportSiteKind::Require(_)
                | ImportSiteKind::ImportMetaRequire(_)
                | ImportSiteKind::ImportEquals(_) => &mut self.found.required,
                _ => continue,
            };
            let alternatives = self.analysis.alternatives_of(&site.specifier).iter();
            loaded.extend(alternatives.filter_map(|alternative| match *alternative {
                ImportSpecifier::Constant(text) => Some(text),
                _ => None,
            }));
        }
    }

    fn run(&mut self) {
        self.find_evicted_modules();
        self.find_how_files_are_loaded();
        let (hir, bound, analysis) = (self.hir, self.bound, self.analysis);
        let mut held: Vec<(SymbolId, Specifiers)> = Vec::new();
        for site in analysis.import_sites {
            let is_dead = |call: ExprId| analysis.decisions.is_dead_expr(call);
            let modules = self.specifiers_of(&site.specifier);
            match site.kind {
                ImportSiteKind::MockModule(call) if !is_dead(call) => {
                    self.replace_whole(&modules);
                    if is_module_call_of_plugin(hir, bound, call) {
                        let names = modules.iter().flatten().copied();
                        self.found.named_by_plugins.extend(names);
                    }
                }
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
        self.found.any |=
            mocks_modules_out_of_sight(hir, bound, analysis, self.builtins, &|site| {
                (self.module_of)(analysis.import_sites[site].specifier)
                    == Some(RuntimeModule::BunTest)
            });
        self.found.spies_on_unknown_objects = find_spies_on_unknown_objects(
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
        let behind_other_names = core::mem::take(
            &mut self
                .found
                .spies_on_unknown_objects
                .module_objects_behind_other_names,
        );
        for object in behind_other_names {
            if let Some(modules) = modules_held_by(bound.binding(object)) {
                self.replace_whole(modules);
            }
        }
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

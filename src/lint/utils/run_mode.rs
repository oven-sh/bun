//! Syntax-only checks of how Bun runs a file, for a fix that adds, removes or retypes an `import`, an `export` or a
//! `require()`. Bun picks CommonJS or ES module from a file's statements (`ExportsKind` in
//! `src/js_parser/parse/parse_entry.rs`), and `bun test` picks a file's globals from the test modules it loads
//! (`src/js_parser/lower/hoist_test_mocks.rs`). `test/cli/lint/run-mode.test.ts` runs both against the tables here.
//!
//! A function here answers for every `"type"` a package.json can have, and for every other fix that `--fix` can apply
//! in the same pass. It holds the fix back when only dead code could tell. Only call them from
//! [`Report::fix_where_safe`].
//!
//! [`Report::fix_where_safe`]: crate::context::Report::fix_where_safe

use crate::ast::{Expr, ExprTag, File, Flags, Ident, Import, ImportSpec, Name, Node, Stmt, StmtKind, StmtTag};
use crate::semantic::Reference;

/// `bun:test`, `vitest` and `@jest/globals`.
pub use bun_ast::import_record::is_test_module;

/// The names that `bun test` declares in a file that uses them as globals, if no script defined them on `globalThis`:
/// `Jest::GLOBALS` without the ones that only a file with the globals of `vitest` gets.
const GLOBALS: [&str; 17] = [
    "test",
    "it",
    "describe",
    "expect",
    "expectTypeOf",
    "beforeAll",
    "beforeEach",
    "afterEach",
    "afterAll",
    "jest",
    "vi",
    "xit",
    "xtest",
    "xdescribe",
    "onTestFinished",
    "aroundEach",
    "aroundAll",
];

/// `Jest::is_of_bun_only`: the [`GLOBALS`] that a file with the globals of `vitest` doesn't get.
const NOT_OF_VITEST: [&str; 4] = ["jest", "xit", "xtest", "xdescribe"];

/// `Jest::is_of_vitest_only`: the globals that only such a file gets.
const ONLY_OF_VITEST: [&str; 4] = ["suite", "vitest", "onTestFailed", "assertType"];

/// The exports of `bun:test` and `@jest/globals`, without `default`.
const EXPORTS: [&str; 21] = [
    "afterAll",
    "afterEach",
    "aroundAll",
    "aroundEach",
    "beforeAll",
    "beforeEach",
    "describe",
    "expect",
    "expectTypeOf",
    "it",
    "jest",
    "mock",
    "onTestFinished",
    "setDefaultTimeout",
    "setSystemTime",
    "spyOn",
    "test",
    "vi",
    "xdescribe",
    "xit",
    "xtest",
];

/// What `vitest` exports besides [`EXPORTS`].
const EXPORTS_OF_VITEST_ONLY: [&str; 7] = [
    "TestRunner",
    "assertType",
    "inject",
    "onTestFailed",
    "suite",
    "vi",
    "vitest",
];

/// True if a named import of `name` from the test module `source` links.
pub fn has_export(source: &[u8], name: &[u8]) -> bool {
    let is = |it: &&str| it.as_bytes() == name;
    EXPORTS.iter().any(is) || (source == b"vitest" && EXPORTS_OF_VITEST_ONLY.iter().any(is))
}

/// True if a file that loads `vitest` has `name` as a global.
pub fn is_global_of_vitest(name: &[u8]) -> bool {
    let is = |it: &&str| it.as_bytes() == name;
    (GLOBALS.iter().any(is) && !NOT_OF_VITEST.iter().any(is)) || ONLY_OF_VITEST.iter().any(is)
}

/// True for an `import` that Bun keeps when it runs the file, even if nothing uses its names: not `import type`, and
/// not braces that only have `type` names.
pub fn is_kept(import: Import<'_>) -> bool {
    let names = import.named();
    let binds_all = import.default().is_some() || import.namespace().is_some();
    !import.is_type_only() && (binds_all || names.is_empty() || names.iter().any(|it| !it.is_type_only()))
}

/// True for a use that needs the value when the file runs, so that neither a type import nor no import would do.
fn is_runtime_use(reference: Reference<'_>) -> bool {
    let Some(name) = reference.expr().filter(|_| reference.is_value() && !reference.is_type()) else {
        return false;
    };
    Node::Expr(name).ancestors().all(|it| match it {
        Node::Type(_) => false,
        Node::Member(member) => !member.flags().intersects(Flags::ABSTRACT | Flags::AMBIENT),
        Node::Stmt(statement) => {
            !statement.flags().contains(Flags::AMBIENT)
                && !matches!(statement.tag(), StmtTag::Interface | StmtTag::TypeAlias)
        }
        _ => true,
    })
}

/// True if something uses one of `names`, which `import` declares, in a way that `is_wanted` holds for.
fn any_use<'a>(
    import: Import<'a>,
    mut names: impl Iterator<Item = Ident<'a>>,
    is_wanted: fn(Reference<'a>) -> bool,
) -> bool {
    let scope = Node::Stmt(import.stmt()).scope();
    names.any(|it| scope.get_name(it.name()).is_some_and(|it| it.references().any(is_wanted)))
}

/// True if `import` still has a [runtime use](is_runtime_use) once a fix removes the names that `is_removed` holds for,
/// or if it's `import "a"`. Bun keeps such an import, and no fix of a type-only or unused import touches it.
pub fn has_runtime_use_without<'a>(
    import: Import<'a>,
    is_removed: impl Fn(&ImportSpec<'a>) -> bool,
) -> bool {
    if import.is_type_only() {
        return false;
    }
    let named = import.named().iter().filter(|it| !it.is_type_only() && !is_removed(it));
    let names = (import.default().into_iter()).chain(import.namespace());
    import.is_side_effect() || any_use(import, names.chain(named.map(|it| it.local())), is_runtime_use)
}

/// [`has_runtime_use_without`] for a fix that removes none of its names.
pub fn has_runtime_use(import: Import<'_>) -> bool {
    has_runtime_use_without(import, |_| false)
}

/// True for an import that no fix removes: something uses one of its names, or it's `import "a"`. A fix can still make
/// it type-only, or the reverse.
fn is_used(import: Import<'_>) -> bool {
    let names = (import.default().into_iter()).chain(import.namespace());
    let named = import.named().iter().map(|it| it.local());
    import.is_side_effect() || any_use(import, names.chain(named), |_| true)
}

/// The module that Bun loads for `statement` when it runs the file: the source of an `import` that it
/// [keeps](is_kept), or of an `export .. from` that isn't type-only.
pub fn loaded_by(statement: Stmt<'_>) -> Option<Name<'_>> {
    match statement.kind() {
        StmtKind::Import(import) => is_kept(import).then(|| import.spec()),
        StmtKind::ExportNamed(export) => {
            let names = export.items();
            let is_kept = names.is_empty() || names.iter().any(|it| !it.is_type_only());
            export.spec().filter(|_| !export.is_type_only() && is_kept)
        }
        StmtKind::ExportStar { spec, type_only, .. } => spec.filter(|_| !type_only),
        _ => None,
    }
}

/// True if a statement other than `except` certainly [loads](loaded_by) a module that `is_wanted` holds for. A
/// `require()` or an `import()` doesn't count, because Bun drops the ones in dead code.
pub fn loads_elsewhere<'a>(
    file: &'a File<'a>,
    except: Option<Stmt<'a>>,
    is_wanted: fn(&[u8]) -> bool,
) -> bool {
    let mut others = file.body().iter().filter(|it| Some(*it) != except);
    others.any(|it| loaded_by(it).is_some_and(|it| is_wanted(it.bytes())))
}

/// True if a statement other than `except` certainly loads `vitest`, which gives the file the globals of `vitest`.
pub fn loads_vitest_elsewhere<'a>(file: &'a File<'a>, except: Option<Stmt<'a>>) -> bool {
    loads_elsewhere(file, except, |it| it == b"vitest")
}

/// True unless the file certainly never loads `vitest`, by any statement or expression.
pub fn may_load_vitest(file: &File<'_>) -> bool {
    file.mentions("vitest")
}

/// True if the file uses a [global](GLOBALS) of `bun test` that `is_declared` doesn't hold for. A file with such a
/// name gets it from `bun:test` or `vitest`, but from `globalThis` if a script defined it there and the file loads a
/// test module. So the first or the last test module of a file can change what the name is.
pub fn uses_global_besides<'a>(file: &'a File<'a>, is_declared: impl Fn(&[u8]) -> bool) -> bool {
    let names = GLOBALS.iter().chain(&ONLY_OF_VITEST).map(|it| it.as_bytes());
    let mut used = names.filter(|it| file.unresolved_references_to(it).len() > 0);
    used.any(|it| !is_declared(it))
}

/// What a fix does to the statements that decide the module format.
#[derive(Copy, Clone)]
pub enum Edit<'a> {
    /// Inserts an `import` that Bun keeps.
    AddsImport,
    /// Inserts a `require()` into a file.
    AddsRequire,
    /// Turns a type-only import into one that Bun keeps.
    Keeps(Stmt<'a>),
    /// Leaves an `import` where Bun kept one. It can be type-only now, or have only names that nothing uses.
    Retypes(Stmt<'a>),
    /// Removes an `import` or an `export {}`.
    Removes(Stmt<'a>),
}

/// True for a statement with the `export` keyword that no fix removes. Bun runs a file that has one as an ES module,
/// whatever else it has. Not `export {}`, which two rules remove, and not `export =` or `export import a = b`.
fn is_export(statement: Stmt<'_>) -> bool {
    match statement.kind() {
        StmtKind::ExportNamed(export) => export.has_from() || !export.items().is_empty(),
        StmtKind::ExportStar { .. } | StmtKind::ExportDefault(_) => true,
        StmtKind::ImportEquals(_) | StmtKind::ExportAssign(_) | StmtKind::ExportAsNamespace(_) => false,
        _ => statement.is_exported(),
    }
}

fn is_global_used<'a>(file: &'a File<'a>, names: &[&str]) -> bool {
    let mut names = names.iter();
    names.any(|it| file.unresolved_references_to(it.as_bytes()).len() > 0)
}

/// True if the first statements have `"use strict"`, which makes a file without an `import` or `export` CommonJS.
fn has_use_strict<'a>(file: &'a File<'a>) -> bool {
    let mut directives = file.body().iter().map_while(Stmt::directive);
    directives.any(|it| it == b"use strict")
}

/// True if a statement at the top level calls `require()` or assigns to `module.exports`, so it runs, and a file
/// without an `import` or `export` is CommonJS.
fn has_commonjs_statement<'a>(file: &'a File<'a>) -> bool {
    let is_global = |name: &'static str| {
        move |it: Reference<'a>| it.expr().filter(|it| it.is_ident(name) && it.symbol().is_none())
    };
    let statement_of = |e: Expr<'a>| match e.parent() {
        Node::Stmt(statement) => Some(statement),
        Node::VarDecl(declarator) => match Node::VarDecl(declarator).parent() {
            Node::Stmt(statement) => Some(statement),
            _ => None,
        },
        _ => None,
    };
    let is_top_level = |e: Expr<'a>| {
        statement_of(e).is_some_and(|it| matches!(it.parent(), Node::File(_)))
    };
    // `require("a")` and `const a = require("a")`
    let mut requires = file.unresolved_references_to(b"require").filter_map(is_global("require"));
    let is_called = |it: Expr<'a>| match it.parent() {
        Node::Expr(call) => call.as_call().is_some_and(|call| call.callee() == it) && is_top_level(call),
        _ => false,
    };
    if requires.any(is_called) {
        return true;
    }
    // `module.exports = a` and `module.exports.a = b`
    let mut modules = file.unresolved_references_to(b"module").filter_map(is_global("module"));
    modules.any(|module| {
        let mut target = module;
        while let Node::Expr(member) = target.parent()
            && member.tag() == ExprTag::Dot
            && member.object() == Some(target)
        {
            target = member;
        }
        target != module
            && matches!(target.parent(), Node::Expr(it) if it.as_assign().is_some_and(|it| it.1 == target) && is_top_level(it))
    })
}

/// True if Bun runs the file in the same module format before and after `edit`: both times as an ES module, or both
/// times as CommonJS. An `import` in a CommonJS file makes it an ES module, which is strict and has no `module`, and
/// the reverse happens when the last one goes.
pub fn keeps_module_format<'a>(file: &'a File<'a>, edit: Edit<'a>) -> bool {
    let except = match edit {
        Edit::Keeps(it) | Edit::Retypes(it) | Edit::Removes(it) => Some(it),
        Edit::AddsImport | Edit::AddsRequire => None,
    };
    let others = || file.body().iter().filter(move |it| Some(*it) != except);
    if others().any(is_export) {
        return true;
    }
    let imports = || others().filter_map(Stmt::as_import);
    if let Edit::AddsRequire = edit {
        let has_module_syntax = imports().next().is_some() || file.has_stmts([StmtTag::ExportNamed]);
        return !has_module_syntax && (has_use_strict(file) || has_commonjs_statement(file));
    }
    // These make a file CommonJS whatever its package.json says. With an `import` that Bun keeps, it doesn't load.
    let is_top_level = |it: Stmt<'a>| Node::Stmt(it).enclosing_function().is_none();
    if is_global_used(file, &["module", "exports"])
        || file.has_with_statements()
        || file.stmts_of_kind(StmtTag::Return).any(is_top_level)
    {
        return false;
    }
    // These make it CommonJS unless it has an `import` that Bun keeps, or its package.json says `"type": "module"`.
    let asks_for_commonjs = is_global_used(file, &["require", "__dirname", "__filename"])
        || has_use_strict(file)
        || file.has_stmts([StmtTag::ImportEquals]);
    match edit {
        Edit::AddsRequire => false,
        // With `"type": "commonjs"`, a file is an ES module only if it has an `import` or an `export`.
        Edit::AddsImport => imports().next().is_some() && (imports().any(is_kept) || !asks_for_commonjs),
        Edit::Keeps(_) => imports().any(is_kept) || !asks_for_commonjs,
        Edit::Retypes(_) => imports().any(has_runtime_use) || !asks_for_commonjs,
        Edit::Removes(removed) => {
            let is_type_import = removed.as_import().is_some_and(|it| !is_kept(it));
            if is_type_import {
                return imports().any(is_used);
            }
            // A `this` outside of every function is `undefined` while the file has an `import` or an `export`.
            let has_this = || {
                let is_nested = |it: Node<'a>| it.as_func().is_some_and(|it| !it.is_arrow());
                let mut all = file.exprs_of_kind(ExprTag::This);
                all.any(|it| !Node::Expr(it).ancestors().any(is_nested))
            };
            imports().any(has_runtime_use)
                || (!asks_for_commonjs && !has_this() && imports().any(is_used))
        }
    }
}

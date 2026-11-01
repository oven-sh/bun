//! `bun test` hands every file the names of the test runner.

use bun_ast::import_record::is_test_module;
use bun_js_parser::Jest;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Parent};
use bun_sema::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, File, FileBuilder, Flags, IdList, Import,
    ImportId, ImportSpec, Keyword, ListAt, NameKind, PatKind, PatProp, PropKey, PropKind, Span,
    StmtId, StmtKind, TextRange, TypeNodeId, TypeNodeKind, UnOp, VarDecl, VarKind,
};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::{TransformRequest, TreeChange};
use bun_sema::session::Arena;

use crate::load::hoisted_mocks;
use crate::load::react_compiler::module_items::{
    POSITION, finish_file, put_around_body, write_constant, write_declaration, write_import,
};

const MODULE: &[u8] = b"bun:test";
const MODULE_OF_VITEST: &[u8] = b"vitest";
const MODULE_OF_CHAI: &[u8] = b"chai";
// No program can write such a name, so it meets no declaration of the file: `declare const test: ..` stands beside it.
const LOCAL_NAME_PREFIX: &[u8] = b"%test:";
const OWN_GLOBAL_PREFIX: &[u8] = b"%global:";
const NAME_OF_VITEST_PREFIX: &[u8] = b"%vitest:";
const LOADED_BELOW_VITEST: &[u8] = b"%loaded-below-vitest";
const LOADED_BY_WORKER: &[u8] = b"%loaded-by-worker";
// The object `Bun`, whatever the file itself calls `Bun`.
const MODULE_OF_BUN: &[u8] = b"bun";
const LOCAL_NAME_OF_BUN: &[u8] = b"%bun";

/// `jest` for the name that stands in its place in a file that got the import, as a message quotes it. Any other name unchanged.
pub(crate) fn written_name_of_local(name: &[u8]) -> &[u8] {
    name.strip_prefix(LOCAL_NAME_PREFIX).unwrap_or(name)
}

fn imports(
    request: &TransformRequest<'_, '_>,
    atoms: &Interner<'_>,
    is_wanted: fn(&[u8]) -> bool,
) -> bool {
    let mut sites = request.analysis.import_sites.iter();
    sites.any(|site| match site.specifier {
        ImportSpecifier::Constant(specifier) => is_wanted(atoms.bytes(specifier)),
        ImportSpecifier::Pattern { .. } | ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {
            false
        }
    })
}

/// TypeScript drops an import whose names nobody uses, and with it the site. The parser of `bun test` has seen the statement by then.
fn writes_import_of_values(hir: &File<'_>, module: Atom) -> bool {
    hir.imports.iter().any(|import| {
        import.spec == module
            && !import.type_only
            && (import.default != Atom::NONE
                || import.namespace != Atom::NONE
                || import.named.iter().any(|name| !hir[name].type_only))
    })
}

fn find_uses(request: &TransformRequest<'_, '_>, names: &[Atom]) -> Vec<(ExprId, usize)> {
    let bound = request.bound;
    let expressions = (0..).map(ExprId).zip(request.hir.exprs.iter());
    let uses = expressions.filter_map(|(expression, node)| {
        let ExprKind::Ident(written) = node.kind else {
            return None;
        };
        let name = names.iter().position(|&name| name == written)?;
        let is_free =
            bound.is_evaluated_ident(expression) && bound.binding(expression) == Binding::Free;
        is_free.then_some((expression, name))
    });
    uses.collect()
}

/// How a use of a name that "bun:test" alone has reads it, in a file that finds out at its load whether it has the name.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Reads {
    /// `jest` is `loadedBelowVitest ? jest : local`.
    Value,
    /// `typeof jest` is `loadedBelowVitest ? typeof jest : typeof local`: the name may stand for nothing.
    Type(ExprId),
}

fn find_how_use_reads(request: &TransformRequest<'_, '_>, expression: ExprId) -> Option<Reads> {
    let Parent::Expr(user) = request.bound.parent_of_expr(expression) else {
        return Some(Reads::Value);
    };
    match request.hir[user].kind {
        ExprKind::Unary {
            op: UnOp::Typeof, ..
        } => Some(Reads::Type(user)),
        ExprKind::Unary {
            op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => None,
        ExprKind::Assign { target, .. } if target == expression => None,
        _ => Some(Reads::Value),
    }
}

/// The variable that says whether the file has the names of "vitest", and the path that the file asks with.
#[derive(Copy, Clone)]
struct Flavor {
    variable: Atom,
    path: Atom,
}

/// What a file finds out at its load, in each realm that loads it, before it reads a name of the runner.
#[derive(Copy, Clone)]
struct Asked {
    /// The variable that says whether a Worker has loaded the file. `bun test` gives the names to what its own realm loads, and to nothing else.
    by_worker: Option<Atom>,
    flavor: Option<Flavor>,
}
/// `(loadedByWorker ??= ..) || (loadedBelowVitest ??= ..) ? yes : no`. A function of the file may run ahead of its body, while the file loads.
fn choose_by_flavor(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    chosen: ExprId,
    asked: Asked,
    branches: Branches,
) {
    let (pos, end) = (file[chosen].pos, file[chosen].end);
    let ask = |file: &mut FileBuilder, variable: Atom, value: ExprId| {
        let target = file.expr(ExprKind::Ident(variable), pos, end);
        let op = Some(BinOp::Nullish);
        file.expr(ExprKind::Assign { op, target, value }, pos, end)
    };
    let by_worker = asked.by_worker.map(|variable| {
        let value = write_question_of_realm(file, atoms);
        ask(file, variable, value)
    });
    let flavor = asked.flavor.map(|flavor| {
        let value = write_question(file, atoms, flavor.path);
        ask(file, flavor.variable, value)
    });
    let test = match (by_worker, flavor) {
        (Some(left), Some(right)) => {
            let op = BinOp::Or;
            file.expr(ExprKind::Binary { op, left, right }, pos, end)
        }
        (Some(test), None) | (None, Some(test)) => test,
        (None, None) => unreachable!("a use that asks nothing is written as it is"),
    };
    let branches = file.store_branches(branches);
    file[chosen].kind = ExprKind::Cond { test, branches };
}

fn write_use_by_flavor(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    expression: ExprId,
    (written, local, flavor): (Atom, Atom, Asked),
    reads: Reads,
) {
    let (pos, end) = (file[expression].pos, file[expression].end);
    let free = file.expr(ExprKind::Ident(written), pos, end);
    match reads {
        Reads::Value => {
            let of_runner = file.expr(ExprKind::Ident(written), pos, end);
            write_use(file, of_runner, written, local);
            let branches = Branches {
                yes: free,
                no: of_runner,
            };
            choose_by_flavor(file, atoms, expression, flavor, branches);
        }
        Reads::Type(user) => {
            write_use(file, expression, written, local);
            let (pos, end) = (file[user].pos, file[user].end);
            let type_of = |operand: ExprId| ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            };
            let yes = file.expr(type_of(free), pos, end);
            let no = file.expr(type_of(expression), pos, end);
            choose_by_flavor(file, atoms, user, flavor, Branches { yes, no });
        }
    }
}

/// Both runners have the name, and theirs behave differently: vitest runs `afterEach` hooks last laid first, runs what a `beforeAll` hook returns, ignores a hook laid by a running
/// test and hands a test its context. `vi` and `expect` stay "bun:test"'s: the build reads what is spied on and replaced by them.
fn differs_by_flavor(name: &str) -> bool {
    matches!(
        name,
        "test"
            | "it"
            | "describe"
            | "beforeAll"
            | "beforeEach"
            | "afterEach"
            | "afterAll"
            | "onTestFinished"
            | "aroundEach"
            | "aroundAll"
    )
}

/// `beforeEach` is `loadedBelowVitest ? ofVitest : ofBun`, and `loadedByWorker ? beforeEach : ..` around that where a Worker may load the file.
fn write_use_of_either_runner(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    expression: ExprId,
    (written, of_bun, of_vitest): (Atom, Atom, Atom),
    asked: Asked,
) {
    let (pos, end) = (file[expression].pos, file[expression].end);
    let yes = file.expr(ExprKind::Ident(written), pos, end);
    write_use(file, yes, written, of_vitest);
    let no = file.expr(ExprKind::Ident(written), pos, end);
    write_use(file, no, written, of_bun);
    let by_flavor = Asked {
        by_worker: None,
        ..asked
    };
    if asked.by_worker.is_none() {
        return choose_by_flavor(file, atoms, expression, by_flavor, Branches { yes, no });
    }
    let of_runner = file.expr(ExprKind::Ident(written), pos, end);
    choose_by_flavor(file, atoms, of_runner, by_flavor, Branches { yes, no });
    let branches = Branches {
        yes: file.expr(ExprKind::Ident(written), pos, end),
        no: of_runner,
    };
    let by_realm = Asked {
        flavor: None,
        ..asked
    };
    choose_by_flavor(file, atoms, expression, by_realm, branches);
}

/// `!Bun.isMainThread`
fn write_question_of_realm(file: &mut FileBuilder, atoms: &Interner<'_>) -> ExprId {
    let add = |file: &mut FileBuilder, kind: ExprKind| file.expr(kind, POSITION, POSITION);
    let mut bun = add(file, ExprKind::Ident(atoms.intern(LOCAL_NAME_OF_BUN)));
    if !file.is_js {
        let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), POSITION, POSITION);
        bun = add(file, ExprKind::As { expr: bun, ty });
    }
    let name = (atoms.intern(b"isMainThread"), POSITION);
    let member = file.dot((bun, Chain::No), name, POSITION);
    let operand = add(file, member);
    let op = UnOp::Not;
    add(file, ExprKind::Unary { op, operand })
}
/// `typeof Bun.jest(path, true).suite === "function"`: "vitest" alone has `suite`.
fn write_question(file: &mut FileBuilder, atoms: &Interner<'_>, path: Atom) -> ExprId {
    let add = |file: &mut FileBuilder, kind: ExprKind| file.expr(kind, POSITION, POSITION);
    let mut bun = add(file, ExprKind::Ident(atoms.intern(LOCAL_NAME_OF_BUN)));
    if !file.is_js {
        let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), POSITION, POSITION);
        bun = add(file, ExprKind::As { expr: bun, ty });
    }
    let callee = file.dot((bun, Chain::No), (known::jest, POSITION), POSITION);
    let callee = add(file, callee);
    let path = add(file, ExprKind::String(path));
    let by_who_loads = add(file, ExprKind::True);
    let args = file.list(&[path, by_who_loads]);
    let call = file.add_call(Call {
        callee,
        args,
        type_args: ListAt::EMPTY,
        close_pos: POSITION,
        chain: Chain::No,
        is_pure: false,
    });
    let module = add(file, ExprKind::Call(call));
    let member = file.dot(
        (module, Chain::No),
        (atoms.intern(b"suite"), POSITION),
        POSITION,
    );
    let operand = add(file, member);
    let op = UnOp::Typeof;
    let left = add(file, ExprKind::Unary { op, operand });
    let right = add(file, ExprKind::String(atoms.intern(b"function")));
    let op = BinOp::EqEqEq;
    add(file, ExprKind::Binary { op, left, right })
}

/// `var loadedBelowVitest = ..;`, so that the file asks while it loads, whenever its functions run.
fn write_flavor(file: &mut FileBuilder, atoms: &Interner<'_>, flavor: Flavor) -> StmtId {
    let init = write_question(file, atoms, flavor.path);
    write_answer(file, flavor.variable, init)
}
fn write_answer(file: &mut FileBuilder, variable: Atom, init: ExprId) -> StmtId {
    let pat = file.pat(PatKind::Ident(variable), POSITION, POSITION);
    let declarations = file.add_var_decls(&[VarDecl {
        pat,
        ty: TypeNodeId::NONE,
        init,
        kind: VarKind::Var,
        flags: Flags::empty(),
        loc: TextRange::default(),
    }]);
    file.stmt(StmtKind::Var(declarations), POSITION)
}

fn write_use(file: &mut FileBuilder, expression: ExprId, written: Atom, local: Atom) {
    if file.is_js {
        file[expression].kind = ExprKind::Ident(local);
        return;
    }
    let (pos, end) = (file[expression].pos, file[expression].end);
    let value = file.expr(ExprKind::Ident(local), pos, end);
    let any = file.ty(TypeNodeKind::Keyword(Keyword::Any), pos, end);
    let untyped = file.expr(
        ExprKind::As {
            expr: value,
            ty: any,
        },
        pos,
        end,
    );
    let queried = file.expr(ExprKind::Ident(written), pos, end);
    let name = file.entity_name([(written, pos)].into_iter());
    let query = TypeNodeKind::Typeof {
        name,
        args: IdList::EMPTY,
        has_type_arguments: false,
        expr: queried,
    };
    let query = file.ty(query, pos, end);
    file[expression].kind = ExprKind::As {
        expr: untyped,
        ty: query,
    };
}

fn write_require(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    module: &[u8],
    names: &[(Atom, Atom)],
) -> StmtId {
    let properties: Vec<PatProp> = names
        .iter()
        .map(|&(imported, local)| PatProp {
            key: PropKey::Name(imported),
            name_kind: NameKind::Identifier,
            value: file.pat(PatKind::Ident(local), POSITION, POSITION),
            default: ExprId::NONE,
            is_rest: false,
            pos: POSITION,
            key_pos: POSITION,
            end: POSITION,
        })
        .collect();
    let properties = file.add_pat_props(&properties);
    let pat = file.pat(PatKind::Object(properties), POSITION, POSITION);
    let callee = file.expr(ExprKind::Ident(known::require), POSITION, POSITION);
    write_constant(file, pat, callee, atoms.intern(module))
}

/// `import { default as %bun } from "bun";`, `const %bun = require("bun");`
fn write_bun(file: &mut FileBuilder, atoms: &Interner<'_>, format: ModuleFormat) -> StmtId {
    let local = atoms.intern(LOCAL_NAME_OF_BUN);
    match format {
        ModuleFormat::Esm => {
            let names = core::iter::once((known::default, local));
            write_import(file, atoms, MODULE_OF_BUN, names)
        }
        ModuleFormat::CommonJs => {
            let pat = file.pat(PatKind::Ident(local), POSITION, POSITION);
            let callee = file.expr(ExprKind::Ident(known::require), POSITION, POSITION);
            write_constant(file, pat, callee, atoms.intern(MODULE_OF_BUN))
        }
    }
}

/// `const { expect: %global:expect = %test:expect } = globalThis;`
fn write_own_globals(file: &mut FileBuilder, names: &[(Atom, Atom, Atom)]) -> StmtId {
    let properties: Vec<PatProp> = names
        .iter()
        .map(|&(name, local, of_runner)| PatProp {
            key: PropKey::Name(name),
            name_kind: NameKind::Identifier,
            value: file.pat(PatKind::Ident(local), POSITION, POSITION),
            default: file.expr(ExprKind::Ident(of_runner), POSITION, POSITION),
            is_rest: false,
            pos: POSITION,
            key_pos: POSITION,
            end: POSITION,
        })
        .collect();
    let properties = file.add_pat_props(&properties);
    let pat = file.pat(PatKind::Object(properties), POSITION, POSITION);
    let mut global = file.expr(ExprKind::Ident(known::globalThis), POSITION, POSITION);
    if !file.is_js {
        let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), POSITION, POSITION);
        global = file.expr(ExprKind::As { expr: global, ty }, POSITION, POSITION);
    }
    write_declaration(file, pat, global)
}

/// "vitest" hands on `assert` and `should` of chai. The parser gives `bun test` the project's chai for them: `ChaiImports`.
/// Asked by atom alone: an import in a text that only looks like code may have no name, and nobody can read the text of that.
#[derive(Copy, Clone)]
struct NamesOfChai {
    vitest: Atom,
    names: [Atom; 2],
}

impl NamesOfChai {
    fn new(atoms: &Interner<'_>) -> Self {
        Self {
            vitest: atoms.intern(MODULE_OF_VITEST),
            names: [atoms.intern(b"assert"), atoms.intern(b"should")],
        }
    }

    fn may_stand_in(self, import: &Import) -> bool {
        !import.type_only && import.spec == self.vitest
    }

    fn holds(self, name: &ImportSpec) -> bool {
        !name.type_only && self.names.contains(&name.imported)
    }

    fn are_imported_in(self, hir: &File<'_>) -> bool {
        (hir.imports.iter()).any(|import| {
            self.may_stand_in(import) && import.named.iter().any(|name| self.holds(&hir[name]))
        })
    }

    /// The statement stays where it is, without the two names, so the file still imports from "vitest".
    fn take_out_of(self, file: &mut FileBuilder, atoms: &Interner<'_>) -> Vec<StmtId> {
        let mut added = Vec::new();
        for index in 0..file.imports.len() {
            let import = file.imports[index];
            if !self.may_stand_in(&import) {
                continue;
            }
            let (start, len) = (import.named.start, import.named.len);
            let names = &mut file.import_specs[start as usize..(start + len) as usize];
            names.sort_by_key(|name| self.holds(name));
            let kept = names.partition_point(|name| !self.holds(name)) as u32;
            if kept == len {
                continue;
            }
            let of_chai = ImportId(file.imports.len() as u32);
            for name in &mut names[kept as usize..] {
                name.import = of_chai;
            }
            file.imports[index].named = Span::new(start, kept);
            file.add_import(Import {
                spec: atoms.intern(MODULE_OF_CHAI),
                default: Atom::NONE,
                namespace: Atom::NONE,
                named: Span::new(start + kept, len - kept),
                has_named_imports: true,
                stmt: StmtId::NONE,
                attributes: ExprId::NONE,
                ..import
            });
            added.push(file.stmt(StmtKind::Import(of_chai), POSITION));
        }
        added
    }
}

#[derive(Copy, Clone, Default)]
pub(crate) struct FileOfTestRun {
    pub has_globals_of_vitest: bool,
    pub is_entry_point: bool,
    /// A test file or a preload that imports "vitest" may be what loads the file first. `bun test` gives the file the names of that module then.
    pub may_load_below_vitest: bool,
    /// Nothing says that the realm of the tests alone loads the file.
    pub may_load_in_worker: bool,
    /// Of the look through the test files ahead of a build, which isn't told what the run has: whichever runner has a name, the file may mean it.
    pub has_names_of_every_runner: bool,
}

pub(crate) fn import_used_names<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
    file_of_run: FileOfTestRun,
) -> TreeChange {
    // The parser gives `bun test` the same names out of the same module.
    let is_of_vitest = file_of_run.has_globals_of_vitest
        || imports(request, atoms, |module| module == MODULE_OF_VITEST)
        || writes_import_of_values(request.hir, atoms.intern(MODULE_OF_VITEST));
    let module = if is_of_vitest {
        MODULE_OF_VITEST
    } else {
        MODULE
    };
    let given = Jest::GLOBALS.iter().filter(|name| match is_of_vitest {
        _ if file_of_run.has_names_of_every_runner => true,
        true => !Jest::is_of_bun_only(name),
        false => !Jest::is_of_vitest_only(name),
    });
    let given: Vec<&[u8]> = given.map(|name| name.as_bytes()).collect();
    let names: Vec<Atom> = given.iter().map(|name| atoms.intern(name)).collect();
    let uses = find_uses(request, &names);
    let is_entry_point = file_of_run.is_entry_point;
    let hoisting = hoisted_mocks::plan(request, atoms, is_of_vitest, is_entry_point);
    let names_of_chai = NamesOfChai::new(atoms);
    if uses.is_empty() && hoisting.is_none() && !names_of_chai.are_imported_in(request.hir) {
        return TreeChange::Unchanged;
    }
    let with_prefix = |prefix: &[u8]| -> Vec<Atom> {
        let locals = given
            .iter()
            .map(|name| atoms.intern(&[prefix, name].concat()));
        locals.collect()
    };
    let of_runner = with_prefix(LOCAL_NAME_PREFIX);
    // A file that imports a test module keeps any global that a script put on `globalThis` itself. Only the run knows which.
    let keeps_own_globals = imports(request, atoms, is_test_module);
    let locals = match keeps_own_globals {
        true => with_prefix(OWN_GLOBAL_PREFIX),
        false => of_runner.clone(),
    };
    let mut file = FileBuilder::from_file(request.hir);
    if let Some(hoisting) = &hoisting {
        hoisting.apply(&mut file, atoms);
    }
    let of_chai = names_of_chai.take_out_of(&mut file, atoms);
    if uses.is_empty() {
        put_around_body(&mut file, &of_chai, &[]);
        *request.hir = finish_file(file, arena, atoms);
        return TreeChange::Changed;
    }
    // Only the run knows who loads the file first.
    let flavor = (file_of_run.may_load_below_vitest && !is_of_vitest).then(|| Flavor {
        variable: atoms.intern(LOADED_BELOW_VITEST),
        path: atoms.intern(request.path),
    });
    let by_worker = (file_of_run.may_load_in_worker).then(|| atoms.intern(LOADED_BY_WORKER));
    let mut asks_flavor = false;
    let mut asks_realm = false;
    let of_vitest = with_prefix(NAME_OF_VITEST_PREFIX);
    let mut taken_from_vitest: Vec<usize> = Vec::new();
    for &(expression, name) in &uses {
        let text = core::str::from_utf8(given[name]).unwrap_or("");
        if flavor.is_some()
            && !keeps_own_globals
            && differs_by_flavor(text)
            && find_how_use_reads(request, expression) == Some(Reads::Value)
        {
            asks_flavor = true;
            asks_realm |= by_worker.is_some();
            taken_from_vitest.push(name);
            let atoms_of_use = (names[name], locals[name], of_vitest[name]);
            let asked = Asked { by_worker, flavor };
            write_use_of_either_runner(&mut file, atoms, expression, atoms_of_use, asked);
            continue;
        }
        let flavor = flavor.filter(|_| Jest::is_of_bun_only(text));
        let asked = Asked { by_worker, flavor };
        let reads = (by_worker.is_some() || flavor.is_some())
            .then(|| find_how_use_reads(request, expression))
            .flatten()
            .map(|reads| (asked, reads));
        match reads {
            Some((flavor, reads)) => {
                asks_flavor |= flavor.flavor.is_some();
                asks_realm |= by_worker.is_some();
                let atoms_of_use = (names[name], locals[name], flavor);
                write_use_by_flavor(&mut file, atoms, expression, atoms_of_use, reads);
            }
            None => write_use(&mut file, expression, names[name], locals[name]),
        }
    }
    // `{ test }` has the key `test` and the value of the import.
    for property in &mut file.props {
        let is_renamed = uses
            .iter()
            .any(|&(expression, _)| expression == property.value);
        if property.kind == PropKind::Shorthand && is_renamed {
            property.kind = PropKind::Init;
        }
    }
    let is_used = |name: usize| uses.iter().any(|&(_, used)| used == name);
    let used: Vec<usize> = (0..names.len()).filter(|&name| is_used(name)).collect();
    let imported = used.iter().map(|&name| (names[name], of_runner[name]));
    let imported: Vec<(Atom, Atom)> = imported.collect();
    let mut added = vec![match request.analysis.module_format {
        ModuleFormat::Esm => write_import(&mut file, atoms, module, imported.iter().copied()),
        ModuleFormat::CommonJs => write_require(&mut file, atoms, module, &imported),
    }];
    taken_from_vitest.sort_unstable();
    taken_from_vitest.dedup();
    if !taken_from_vitest.is_empty() {
        let imported = taken_from_vitest.iter();
        let imported: Vec<(Atom, Atom)> = imported
            .map(|&name| (names[name], of_vitest[name]))
            .collect();
        added.push(match request.analysis.module_format {
            ModuleFormat::Esm => {
                write_import(&mut file, atoms, MODULE_OF_VITEST, imported.iter().copied())
            }
            ModuleFormat::CommonJs => write_require(&mut file, atoms, MODULE_OF_VITEST, &imported),
        });
    }
    if keeps_own_globals {
        let own = used
            .iter()
            .map(|&name| (names[name], locals[name], of_runner[name]));
        let own: Vec<(Atom, Atom, Atom)> = own.collect();
        added.push(write_own_globals(&mut file, &own));
    }
    if asks_flavor || asks_realm {
        let format = request.analysis.module_format;
        added.push(write_bun(&mut file, atoms, format));
    }
    if let Some(flavor) = flavor.filter(|_| asks_flavor) {
        added.push(write_flavor(&mut file, atoms, flavor));
    }
    if let Some(variable) = by_worker.filter(|_| asks_realm) {
        let init = write_question_of_realm(&mut file, atoms);
        added.push(write_answer(&mut file, variable, init));
    }
    added.extend(of_chai);
    put_around_body(&mut file, &added, &[]);
    *request.hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::hir::{BinOp, ExprId, ExprKind, File, PatKind, StmtKind, TypeNodeKind, UnOp};

    use crate::compile::testing::{
        default_settings, with_loaded_test_run, with_loaded_test_run_of_vitest,
    };
    use crate::load::ProjectId;

    // `typeof a.b` holds `a` as an expression, and asks for its type alone.
    fn find_names_in_type_queries(hir: &File<'_>) -> Vec<ExprId> {
        let queried = hir.types.iter().filter_map(|node| match node.kind {
            TypeNodeKind::Typeof { expr, .. } => Some(expr),
            _ => None,
        });
        let mut names: Vec<ExprId> = queried
            .map(|mut expression| {
                while let Some((object, _)) = hir.member_key(expression) {
                    expression = object;
                }
                expression
            })
            .collect();
        names.sort_unstable();
        names
    }

    // The names that the first statement behind the directives takes out of "bun:test", how many names of the runner still stand for a value, and how many values have the type of a name of the runner.
    fn describe(name: &str, text: &str) -> String {
        with_loaded_test_run(&[(name, text)], &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files
                .by_path
                .get(path.as_bytes())
                .expect("the file is in the program");
            let hir = files.hir(file);
            let text_of = |atom| BStr::new(files.atoms.bytes(atom)).to_string();
            let is_directive = |kind| matches!(kind, StmtKind::Directive { .. });
            let first = hir
                .ids(hir.body)
                .find(|&statement| !is_directive(hir[statement].kind));
            let taken: Vec<String> = match first.map(|statement| hir[statement].kind) {
                Some(StmtKind::Import(import))
                    if matches!(text_of(hir[import].spec).as_str(), "bun:test" | "vitest") =>
                {
                    let items = hir[import].named.iter().map(|item| hir[item]);
                    let added = items.filter(|item| text_of(item.local).starts_with("%test:"));
                    added
                        .map(|item| {
                            format!("{} as {}", text_of(item.imported), text_of(item.local))
                        })
                        .collect()
                }
                Some(StmtKind::Var(declarations)) => {
                    let patterns = declarations
                        .iter()
                        .map(|declaration| hir[hir[declaration].pat].kind);
                    let properties = patterns.filter_map(|kind| match kind {
                        PatKind::Object(properties) => Some(properties),
                        _ => None,
                    });
                    let locals = properties
                        .flat_map(|properties| properties.iter())
                        .map(|it| hir[hir[it].value].kind);
                    let locals = locals.filter_map(|kind| match kind {
                        PatKind::Ident(local) => Some(text_of(local)),
                        _ => None,
                    });
                    locals
                        .filter(|local| local.starts_with("%test:"))
                        .map(|local| format!("require {local}"))
                        .collect()
                }
                _ => Vec::new(),
            };
            let in_type_queries = find_names_in_type_queries(hir);
            let written = (0..)
                .map(ExprId)
                .zip(hir.exprs.iter())
                .filter(|&(expression, node)| match node.kind {
                    ExprKind::Ident(name) => {
                        let name = files.atoms.bytes(name);
                        super::Jest::GLOBALS.iter().any(|it| it.as_bytes() == name)
                            && in_type_queries.binary_search(&expression).is_err()
                    }
                    _ => false,
                });
            let typed = hir.exprs.iter().filter(|node| match node.kind {
                ExprKind::As { ty, .. } => matches!(hir[ty].kind, TypeNodeKind::Typeof { .. }),
                _ => false,
            });
            format!(
                "{} | {} written | {} typed",
                taken.join(", "),
                written.count(),
                typed.count()
            )
        })
    }

    #[test]
    fn free_names_come_out_of_the_module() {
        let rows = [
            (
                "a.test.js",
                "test('a', () => { expect(1).toBe(1); });",
                "test as %test:test, expect as %test:expect | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "expect(1); expect(2);",
                "expect as %test:expect | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "typeof describe;",
                "describe as %test:describe | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "({ vi });",
                "vi as %test:vi | 0 written | 0 typed",
            ),
            (
                "a.test.ts",
                "declare const test: (name: string) => void; test('a');",
                "test as %test:test | 0 written | 1 typed",
            ),
            (
                "a.test.ts",
                "declare var vi: { answer: number }; vi.answer; vi.answer;",
                "vi as %test:vi | 0 written | 2 typed",
            ),
            (
                "a.test.ts",
                "let e: typeof expect; let f: typeof expect.extend; expect(1);",
                "expect as %test:expect | 0 written | 1 typed",
            ),
            (
                "a.test.ts",
                "({ vi });",
                "vi as %test:vi | 0 written | 1 typed",
            ),
            (
                "a.test.ts",
                "import type { Mock } from 'bun:test'; let m: Mock<() => void> | undefined; it('a', () => {});",
                "it as %test:it | 0 written | 1 typed",
            ),
            (
                "a.test.mjs",
                "'use strict'; it('a', () => {});",
                "it as %test:it | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "'use strict'; it('a', () => {});",
                "require %test:it | 0 written | 0 typed",
            ),
            (
                "a.test.cjs",
                "module.exports = 1; test('a', () => {});",
                "require %test:test | 0 written | 0 typed",
            ),
            (
                "a.test.cjs",
                "'use strict'; exports.a = 1; jest.fn();",
                "require %test:jest | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "import { test } from 'bun:test'; test('a', () => {}); describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "import { test } from 'vitest'; test('a', () => {}); describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "import { test } from '@jest/globals'; test('a', () => {}); describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "import 'bun:test'; describe;",
                "describe as %test:describe | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "onTestFinished; aroundEach; aroundAll;",
                "onTestFinished as %test:onTestFinished, aroundEach as %test:aroundEach, aroundAll as %test:aroundAll | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "import 'vitest'; suite; vitest; onTestFailed; assertType;",
                "suite as %test:suite, vitest as %test:vitest, onTestFailed as %test:onTestFailed, assertType as %test:assertType | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "export * from 'bun:test'; describe;",
                "describe as %test:describe | 0 written | 0 typed",
            ),
            (
                "a.test.js",
                "await import('bun:test'); describe;",
                "describe as %test:describe | 0 written | 0 typed",
            ),
            (
                "a.test.cjs",
                "require('bun:test'); describe;",
                "require %test:describe | 0 written | 0 typed",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe(name, text), expected, "{text}");
        }
    }

    // What the file takes off `globalThis`, each with the name that it has where `globalThis` lacks it.
    fn describe_own_globals(name: &str, text: &str) -> String {
        with_loaded_test_run(&[(name, text)], &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files
                .by_path
                .get(path.as_bytes())
                .expect("the file is in the program");
            let hir = files.hir(file);
            let text_of = |atom| BStr::new(files.atoms.bytes(atom)).to_string();
            let properties = hir.pat_props.iter().filter(|it| it.default != ExprId::NONE);
            let taken =
                properties.filter_map(|it| match (hir[it.value].kind, hir[it.default].kind) {
                    (PatKind::Ident(local), ExprKind::Ident(of_runner)) => {
                        Some(format!("{} = {}", text_of(local), text_of(of_runner)))
                    }
                    _ => None,
                });
            taken.collect::<Vec<String>>().join(", ")
        })
    }

    #[test]
    fn a_file_that_imports_a_runner_asks_global_this_first() {
        let rows = [
            ("a.test.js", "describe;", ""),
            (
                "a.test.js",
                "import { test } from 'bun:test'; test('a', () => {}); describe; expect;",
                "%global:describe = %test:describe, %global:expect = %test:expect",
            ),
            (
                "a.test.ts",
                "import { test } from 'vitest'; test('a', () => {}); suite;",
                "%global:suite = %test:suite",
            ),
            (
                "a.test.cjs",
                "require('@jest/globals'); it;",
                "%global:it = %test:it",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe_own_globals(name, text), expected, "{text}");
        }
    }

    // Of a file that the test file imports: how often it asks who loads it, how many names of the runner still stand for a value, and how many of them
    // stand under `typeof`.
    fn describe_questions(test_file: &str, name: &str, text: &str) -> String {
        let files = [("a.test.js", test_file), (name, text)];
        with_loaded_test_run_of_vitest(&files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files
                .by_path
                .get(path.as_bytes())
                .expect("the file is in the program");
            let hir = files.hir(file);
            let is_named = |expression: ExprId, names: &[&[u8]]| match hir[expression].kind {
                ExprKind::Ident(name) => names.contains(&files.atoms.bytes(name)),
                _ => false,
            };
            // The file asks for its realm first: `(loadedByWorker ??= ..) || (loadedBelowVitest ??= ..)`.
            let asks = |test: ExprId| {
                matches!(hir[test].kind, ExprKind::Assign { target, .. }
                    if is_named(target, &[super::LOADED_BELOW_VITEST]))
            };
            let asked = hir.exprs.iter().filter(|it| {
                matches!(it.kind, ExprKind::Cond { test, .. }
                    if matches!(hir[test].kind, ExprKind::Binary { op: BinOp::Or, right, .. } if asks(right)))
            });
            let of_bun: [&[u8]; 4] = [b"jest", b"xit", b"xtest", b"xdescribe"];
            let free = (0..hir.exprs.len() as u32)
                .map(ExprId)
                .filter(|&it| is_named(it, &of_bun));
            let under_typeof = hir.exprs.iter().filter(|it| {
                matches!(it.kind, ExprKind::Unary { op: UnOp::Typeof, operand } if is_named(operand, &of_bun))
            });
            format!(
                "{} asked | {} free | {} under typeof",
                asked.count(),
                free.count(),
                under_typeof.count()
            )
        })
    }

    #[test]
    fn a_file_asks_who_loads_it_for_the_names_that_vitest_lacks() {
        let of_vitest = "import { test } from 'vitest'; import './lib'; test('a', () => {});";
        let rows = [
            ("lib.js", "jest;", "1 asked | 1 free | 0 under typeof"),
            (
                "lib.js",
                "typeof jest;",
                "1 asked | 1 free | 1 under typeof",
            ),
            // The type of what is chosen is asked of the name as well.
            (
                "lib.ts",
                "typeof jest;",
                "1 asked | 2 free | 1 under typeof",
            ),
            (
                "lib.cjs",
                "typeof jest !== 'undefined' && jest.fn(); xit('a', () => {});",
                "3 asked | 3 free | 1 under typeof",
            ),
            (
                "lib.js",
                "({ xtest }); xdescribe``;",
                "2 asked | 2 free | 0 under typeof",
            ),
            // Nothing can be chosen where the name is stored to.
            (
                "lib.js",
                "jest = 1; jest++; delete jest;",
                "0 asked | 0 free | 0 under typeof",
            ),
            // Both modules have them.
            (
                "lib.js",
                "expect; vi; test; afterEach;",
                "0 asked | 0 free | 0 under typeof",
            ),
            (
                "lib.js",
                "function jest() {} jest(); typeof jest;",
                "0 asked | 2 free | 1 under typeof",
            ),
            // By itself the file is of "vitest", whoever loads it.
            (
                "lib.js",
                "import 'vitest'; jest; typeof xit;",
                "0 asked | 2 free | 1 under typeof",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(
                describe_questions(of_vitest, name, text),
                expected,
                "{text}"
            );
        }
    }

    #[test]
    fn a_test_file_has_the_names_of_what_it_imports() {
        let files = [(
            "a.test.js",
            "import { test } from 'bun:test'; jest; typeof xit;",
        )];
        with_loaded_test_run_of_vitest(&files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let file = files.by_path.get(&b"/project/a.test.js"[..]).unwrap();
            let conditions = files.hir(file).exprs.iter();
            let conditions = conditions.filter(|it| matches!(it.kind, ExprKind::Cond { .. }));
            assert_eq!(conditions.count(), 0);
        });
    }

    #[test]
    fn a_run_without_vitest_asks_for_the_realm_alone() {
        let files = [
            ("a.test.js", "import './lib'; test('a', () => {});"),
            ("lib.js", "jest; typeof xit;"),
        ];
        with_loaded_test_run(&files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let file = files.by_path.get(&b"/project/lib.js"[..]).unwrap();
            let hir = files.hir(file);
            assert!(hir.exprs.iter().all(|it| match it.kind {
                ExprKind::Cond { test, .. } => matches!(hir[test].kind, ExprKind::Assign { .. }),
                _ => true,
            }));
            let bytes_of = |atom| files.atoms.bytes(atom);
            assert!(!hir.exprs.iter().any(
                |it| matches!(it.kind, ExprKind::Ident(name) if bytes_of(name) == super::LOADED_BELOW_VITEST)
            ));
        });
    }

    // How often a file asks whether a Worker has loaded it.
    fn count_questions_of_realm(files: &[(&str, &str)], name: &str) -> usize {
        with_loaded_test_run(files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files.by_path.get(path.as_bytes()).unwrap();
            let hir = files.hir(file);
            let asks = |test: ExprId| match hir[test].kind {
                ExprKind::Assign { target, .. } => matches!(hir[target].kind,
                    ExprKind::Ident(name) if files.atoms.bytes(name) == super::LOADED_BY_WORKER),
                _ => false,
            };
            let asked = hir.exprs.iter();
            asked
                .filter(|it| matches!(it.kind, ExprKind::Cond { test, .. } if asks(test)))
                .count()
        })
    }

    #[test]
    fn a_file_that_the_runner_does_not_start_reads_the_names_by_its_realm() {
        let rows = [
            ("expect(1); typeof jest; describe;", 3),
            // Nothing can be chosen where the name is stored to.
            ("expect = 1; delete jest;", 0),
            ("const expect = 1; expect; (jest => jest)(2);", 0),
            ("console.log(1);", 0),
        ];
        for (text, expected) in rows {
            let test_file = "import './lib'; test('a', () => { expect(1); typeof jest; });";
            let files = [("a.test.js", test_file), ("lib.js", text)];
            assert_eq!(
                count_questions_of_realm(&files, "lib.js"),
                expected,
                "{text}"
            );
            assert_eq!(count_questions_of_realm(&files, "a.test.js"), 0, "{text}");
        }
    }

    #[test]
    fn names_of_the_file_stay_as_written() {
        let rows = [
            ("js", "console.log(1);", 0),
            ("ts", "let e: typeof expect;", 0),
            ("js", "function test() {} test();", 1),
            ("js", "(expect => expect)(1);", 1),
            ("js", "x.test; ({ test: 1 });", 0),
            ("js", "suite; vitest; onTestFailed; assertType;", 4),
            ("js", "import 'vitest'; jest; xit; xtest; xdescribe;", 4),
        ];
        for (extension, text, written) in rows {
            let described = describe(&format!("a.test.{extension}"), text);
            let expected = format!(" | {written} written | 0 typed");
            assert_eq!(described, expected, "{text}");
        }
    }
}

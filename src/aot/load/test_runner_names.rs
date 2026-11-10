use bun_ast::import_record::is_test_module;
use bun_js_parser::Jest;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, BindingKind, Bound, Parent};
use bun_sema::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, File, FileBuilder, Flags, IdList, Import,
    ImportId, ImportSpec, Keyword, ListAt, NameKind, PatKind, PatProp, PropKey, PropKind, Span,
    StmtId, StmtKind, TextRange, TypeNodeId, TypeNodeKind, UnOp, VarDecl, VarKind,
};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::{TransformRequest, TreeChange};
use bun_sema::session::Arena;

use crate::builtins::resolve::{
    BUN_OF_TEST_FILE as LOCAL_NAME_OF_BUN, GLOBALS_LEFT_ALONE, LOADED_BELOW_VITEST,
    LOADED_BY_WORKER,
};
use crate::load::hoisted_mocks;
use crate::load::react_compiler::module_items::{
    POSITION, finish_file, put_around_body, write_constant, write_import,
};

const MODULE: &[u8] = b"bun:test";
const MODULE_OF_VITEST: &[u8] = b"vitest";
const MODULE_OF_CHAI: &[u8] = b"chai";
const LOCAL_NAME_PREFIX: &[u8] = b"%test:";
const NAME_OF_VITEST_PREFIX: &[u8] = b"%vitest:";
const MODULE_OF_BUN: &[u8] = b"bun";

#[inline]
pub(crate) fn written_name_of_local(name: &[u8]) -> &[u8] {
    match name.first() {
        Some(b'%') => written_name_of_marked_local(name),
        _ => name,
    }
}

fn written_name_of_marked_local(name: &[u8]) -> &[u8] {
    name_asked_of_scope_objects(name)
        .or_else(|| crate::load::react_compiler::module_items::name_of_outlined_function(name))
        .unwrap_or(name)
}

pub(crate) fn skip_to_written_use<'a>(
    hir: &File<'_>,
    bytes_of: impl Fn(Atom) -> &'a [u8],
    expression: ExprId,
) -> ExprId {
    let is_asked_by_build = |mut test: ExprId| {
        while let ExprKind::Binary {
            op: BinOp::Or | BinOp::BitAnd,
            left: first,
            ..
        }
        | ExprKind::Unary {
            op: UnOp::Not,
            operand: first,
        } = hir[test].kind
        {
            test = first;
        }
        let ExprKind::Assign {
            op: Some(BinOp::Nullish),
            target,
            ..
        } = hir[test].kind
        else {
            return false;
        };
        matches!(hir[target].kind, ExprKind::Ident(name) if bytes_of(name).starts_with(b"%"))
    };
    let mut written = hir.skip_type_assertions(expression);
    while let ExprKind::Cond { test, branches } = hir[written].kind
        && is_asked_by_build(test)
    {
        written = hir.skip_type_assertions(hir.branches(branches).yes);
    }
    written
}

pub(crate) fn name_asked_of_scope_objects(name: &[u8]) -> Option<&[u8]> {
    if name.first() != Some(&b'%') {
        return Some(name);
    }
    let prefixes = [LOCAL_NAME_PREFIX, NAME_OF_VITEST_PREFIX];
    prefixes
        .iter()
        .find_map(|prefix| name.strip_prefix(*prefix))
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

#[derive(Copy, Clone, PartialEq, Eq)]
enum Reads {
    Value,
    Type(ExprId),
}

fn find_how_use_reads(request: &TransformRequest<'_, '_>, expression: ExprId) -> Option<Reads> {
    if request.bound.is_stored_to(request.hir, expression) {
        return None;
    }
    let Parent::Expr(user) = request.bound.parent_of_expr(expression) else {
        return Some(Reads::Value);
    };
    match request.hir[user].kind {
        ExprKind::Unary {
            op: UnOp::Typeof, ..
        } => Some(Reads::Type(user)),
        ExprKind::Unary {
            op: UnOp::Delete, ..
        } => None,
        _ => Some(Reads::Value),
    }
}

#[derive(Copy, Clone)]
struct Flavor {
    variable: Atom,
    lacks_name: Runner,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Runner {
    Bun,
    Vitest,
}

#[derive(Copy, Clone)]
struct OwnGlobal {
    variable: Atom,
    bit: u32,
}

#[derive(Copy, Clone)]
struct Asked {
    by_worker: Option<Atom>,
    flavor: Option<Flavor>,
    own_global: Option<OwnGlobal>,
}
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
        let value = write_question(file, atoms);
        let operand = ask(file, flavor.variable, value);
        let op = UnOp::Not;
        match flavor.lacks_name {
            Runner::Vitest => operand,
            Runner::Bun => file.expr(ExprKind::Unary { op, operand }, pos, end),
        }
    });
    let own_global = asked.own_global.map(|own| {
        let value = write_question_of_own_globals(file, atoms);
        let left = ask(file, own.variable, value);
        let bit = file.number(f64::from(own.bit));
        let right = file.expr(ExprKind::Number(bit), pos, end);
        let op = BinOp::BitAnd;
        file.expr(ExprKind::Binary { op, left, right }, pos, end)
    });
    let questions = [by_worker, flavor, own_global].into_iter().flatten();
    let test = questions.reduce(|left, right| {
        let op = BinOp::Or;
        file.expr(ExprKind::Binary { op, left, right }, pos, end)
    });
    let test = test.expect("a use that asks nothing is written as it is");
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
            | "vi"
    )
}

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
        own_global: None,
        ..asked
    };
    if asked.by_worker.is_none() && asked.own_global.is_none() {
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
fn write_call_of_jest(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    asks_for_own_globals: bool,
) -> ExprId {
    let add = |file: &mut FileBuilder, kind: ExprKind| file.expr(kind, POSITION, POSITION);
    let mut bun = add(file, ExprKind::Ident(atoms.intern(LOCAL_NAME_OF_BUN)));
    if !file.is_js {
        let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), POSITION, POSITION);
        bun = add(file, ExprKind::As { expr: bun, ty });
    }
    let callee = file.dot((bun, Chain::No), (known::jest, POSITION), POSITION);
    let callee = add(file, callee);
    let own_globals = add(
        file,
        match asks_for_own_globals {
            true => ExprKind::True,
            false => ExprKind::False,
        },
    );
    let args = file.list(&[own_globals]);
    let call = file.add_call(Call {
        callee,
        args,
        type_args: ListAt::EMPTY,
        close_pos: POSITION,
        chain: Chain::No,
        is_pure: false,
    });
    add(file, ExprKind::Call(call))
}

fn write_question_of_own_globals(file: &mut FileBuilder, atoms: &Interner<'_>) -> ExprId {
    let left = write_call_of_jest(file, atoms, true);
    let zero = file.number(0.0);
    let right = file.expr(ExprKind::Number(zero), POSITION, POSITION);
    let op = BinOp::BitOr;
    file.expr(ExprKind::Binary { op, left, right }, POSITION, POSITION)
}

fn write_question(file: &mut FileBuilder, atoms: &Interner<'_>) -> ExprId {
    let left = write_call_of_jest(file, atoms, false);
    let one = file.number(1.0);
    let right = file.expr(ExprKind::Number(one), POSITION, POSITION);
    let op = BinOp::EqEqEq;
    file.expr(ExprKind::Binary { op, left, right }, POSITION, POSITION)
}

fn write_flavor(file: &mut FileBuilder, atoms: &Interner<'_>, flavor: Flavor) -> StmtId {
    let init = write_question(file, atoms);
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

fn write_require_of_file(file: &mut FileBuilder, bound: &Bound<'_>) -> ExprId {
    let declared = bound.lookup(bound.scopes[0].locals, known::require);
    let is_declared = declared.is_some_and(|it| bound.binding_kind(it) != BindingKind::NoBinding);
    if !is_declared {
        return file.expr(ExprKind::Ident(known::require), POSITION, POSITION);
    }
    let module = file.expr(ExprKind::Ident(known::module), POSITION, POSITION);
    let member = file.dot((module, Chain::No), (known::require, POSITION), POSITION);
    file.expr(member, POSITION, POSITION)
}

fn write_require(
    file: &mut FileBuilder,
    (atoms, bound): (&Interner<'_>, &Bound<'_>),
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
    let callee = write_require_of_file(file, bound);
    write_constant(file, pat, callee, atoms.intern(module))
}

fn write_bun(
    file: &mut FileBuilder,
    (atoms, bound): (&Interner<'_>, &Bound<'_>),
    format: ModuleFormat,
) -> StmtId {
    let local = atoms.intern(LOCAL_NAME_OF_BUN);
    match format {
        ModuleFormat::Esm => {
            let names = core::iter::once((known::default, local));
            write_import(file, atoms, MODULE_OF_BUN, names)
        }
        ModuleFormat::CommonJs => {
            let pat = file.pat(PatKind::Ident(local), POSITION, POSITION);
            let callee = write_require_of_file(file, bound);
            write_constant(file, pat, callee, atoms.intern(MODULE_OF_BUN))
        }
    }
}

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
    pub may_load_below_vitest: bool,
    pub may_load_in_worker: bool,
}

pub(crate) fn import_used_names<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
    file_of_run: FileOfTestRun,
) -> TreeChange {
    let is_of_vitest = file_of_run.has_globals_of_vitest
        || imports(request, atoms, |module| module == MODULE_OF_VITEST)
        || writes_import_of_values(request.hir, atoms.intern(MODULE_OF_VITEST));
    let module = if is_of_vitest {
        MODULE_OF_VITEST
    } else {
        MODULE
    };
    let given = (0u32..).zip(Jest::GLOBALS);
    let asks_flavor_of_run = file_of_run.may_load_below_vitest && !is_of_vitest;
    let given = given.filter(|(_, name)| match is_of_vitest {
        true => !Jest::is_of_bun_only(name),
        false => asks_flavor_of_run || !Jest::is_of_vitest_only(name),
    });
    let (bits, given): (Vec<u32>, Vec<&[u8]>) = given
        .map(|(index, name)| (1u32 << index, name.as_bytes()))
        .unzip();
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
    let keeps_own_globals = imports(request, atoms, is_test_module);
    let mut file = FileBuilder::from_file(request.hir);
    if let Some(hoisting) = &hoisting {
        hoisting.apply(&mut file, atoms);
    }
    let mut added = Vec::new();
    if hoisting.is_some_and(|it| it.calls_vi_of_hoisted_factories()) {
        let vi = [(
            known::vi,
            atoms.intern(hoisted_mocks::VI_OF_HOISTED_FACTORIES),
        )];
        added.push(match request.analysis.module_format {
            ModuleFormat::Esm => write_import(&mut file, atoms, MODULE, vi.into_iter()),
            ModuleFormat::CommonJs => write_require(&mut file, (atoms, request.bound), MODULE, &vi),
        });
    }
    let of_chai = names_of_chai.take_out_of(&mut file, atoms);
    if uses.is_empty() {
        added.extend(of_chai);
        put_around_body(&mut file, &added, &[]);
        *request.hir = finish_file(file, arena, atoms);
        return TreeChange::Changed;
    }
    let flavor = asks_flavor_of_run.then(|| Flavor {
        variable: atoms.intern(LOADED_BELOW_VITEST),
        lacks_name: Runner::Vitest,
    });
    let left_alone = atoms.intern(GLOBALS_LEFT_ALONE);
    let by_worker = (file_of_run.may_load_in_worker).then(|| atoms.intern(LOADED_BY_WORKER));
    let mut asks_flavor = false;
    let mut asks_realm = false;
    let mut asks_for_own_globals = false;
    let of_vitest = with_prefix(NAME_OF_VITEST_PREFIX);
    let mut taken_from_vitest: Vec<usize> = Vec::new();
    for &(expression, name) in &uses {
        let text = core::str::from_utf8(given[name]).unwrap_or("");
        let own_global = keeps_own_globals.then(|| OwnGlobal {
            variable: left_alone,
            bit: bits[name],
        });
        if flavor.is_some()
            && differs_by_flavor(text)
            && find_how_use_reads(request, expression) == Some(Reads::Value)
        {
            asks_flavor = true;
            asks_realm |= by_worker.is_some();
            asks_for_own_globals |= own_global.is_some();
            taken_from_vitest.push(name);
            let atoms_of_use = (names[name], of_runner[name], of_vitest[name]);
            let asked = Asked {
                by_worker,
                flavor,
                own_global,
            };
            write_use_of_either_runner(&mut file, atoms, expression, atoms_of_use, asked);
            continue;
        }
        let is_of_vitest_alone = !is_of_vitest && Jest::is_of_vitest_only(text);
        let lacks_name = match is_of_vitest_alone {
            true => Runner::Bun,
            false => Runner::Vitest,
        };
        let flavor = flavor
            .filter(|_| is_of_vitest_alone || Jest::is_of_bun_only(text))
            .map(|flavor| Flavor {
                lacks_name,
                ..flavor
            });
        let local = match is_of_vitest_alone {
            true => of_vitest[name],
            false => of_runner[name],
        };
        let asked = Asked {
            by_worker,
            flavor,
            own_global,
        };
        let reads = (by_worker.is_some() || flavor.is_some() || own_global.is_some())
            .then(|| find_how_use_reads(request, expression))
            .flatten()
            .map(|reads| (asked, reads));
        match reads {
            Some((flavor, reads)) => {
                asks_flavor |= flavor.flavor.is_some();
                asks_realm |= by_worker.is_some();
                asks_for_own_globals |= own_global.is_some();
                if is_of_vitest_alone {
                    taken_from_vitest.push(name);
                }
                let atoms_of_use = (names[name], local, flavor);
                write_use_by_flavor(&mut file, atoms, expression, atoms_of_use, reads);
            }
            None if is_of_vitest_alone => {}
            None => write_use(&mut file, expression, names[name], of_runner[name]),
        }
    }
    for property in &mut file.props {
        let is_renamed = uses
            .iter()
            .any(|&(expression, _)| expression == property.value);
        if property.kind == PropKind::Shorthand && is_renamed {
            property.kind = PropKind::Init;
        }
    }
    let is_used = |name: usize| uses.iter().any(|&(_, used)| used == name);
    let has_name = |name: usize| {
        let text = core::str::from_utf8(given[name]).unwrap_or("");
        is_of_vitest || !Jest::is_of_vitest_only(text)
    };
    let used = (0..names.len()).filter(|&name| is_used(name) && has_name(name));
    let used: Vec<usize> = used.collect();
    let imported = used.iter().map(|&name| (names[name], of_runner[name]));
    let imported: Vec<(Atom, Atom)> = imported.collect();
    let tables = (atoms, request.bound);
    if !imported.is_empty() {
        added.push(match request.analysis.module_format {
            ModuleFormat::Esm => write_import(&mut file, atoms, module, imported.iter().copied()),
            ModuleFormat::CommonJs => write_require(&mut file, tables, module, &imported),
        });
    }
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
            ModuleFormat::CommonJs => write_require(&mut file, tables, MODULE_OF_VITEST, &imported),
        });
    }
    if asks_flavor || asks_realm || asks_for_own_globals {
        let format = request.analysis.module_format;
        added.push(write_bun(&mut file, tables, format));
    }
    if let Some(flavor) = flavor.filter(|_| asks_flavor) {
        added.push(write_flavor(&mut file, atoms, flavor));
    }
    if let Some(variable) = by_worker.filter(|_| asks_realm) {
        let init = write_question_of_realm(&mut file, atoms);
        added.push(write_answer(&mut file, variable, init));
    }
    if asks_for_own_globals {
        let init = write_question_of_own_globals(&mut file, atoms);
        added.push(write_answer(&mut file, left_alone, init));
    }
    added.extend(of_chai);
    put_around_body(&mut file, &added, &[]);
    *request.hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::atom::Atom;
    use bun_sema::bind::{Binding, CommonJsVariable};
    use bun_sema::hir::{BinOp, ExprId, ExprKind, File, PatKind, StmtKind, TypeNodeKind, UnOp};

    use crate::compile::testing::{
        default_settings, with_loaded_test_run, with_loaded_test_run_of_vitest,
    };
    use crate::load::ProjectId;

    #[test]
    fn names_asked_of_scope_objects() {
        let asked = |name: &'static [u8]| super::name_asked_of_scope_objects(name);
        for name in [&b"%test:jest"[..], b"%vitest:jest", b"jest"] {
            assert_eq!(asked(name), Some(&b"jest"[..]), "{}", BStr::new(name));
            assert_eq!(
                super::written_name_of_local(name),
                b"jest",
                "{}",
                BStr::new(name)
            );
        }
        for name in [
            super::LOADED_BY_WORKER,
            super::LOADED_BELOW_VITEST,
            super::GLOBALS_LEFT_ALONE,
            super::LOCAL_NAME_OF_BUN,
        ] {
            assert_eq!(asked(name), None, "{}", BStr::new(name));
            assert_eq!(super::written_name_of_local(name), name);
        }
        assert_eq!(asked(b"%react:outlined:12:_temp2"), None);
        assert_eq!(
            super::written_name_of_local(b"%react:outlined:12:_temp2"),
            b"_temp2"
        );
        assert_eq!(
            super::written_name_of_local(b"%react:import:_c"),
            b"%react:import:_c"
        );
    }

    fn describe_quoted_arguments(
        loaded: &crate::compile::LoadedBuild<'_, '_>,
        name: &str,
    ) -> String {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let path = format!("/project/{name}");
        let file = files
            .by_path
            .get(path.as_bytes())
            .expect("the file is in the program");
        let hir = files.hir(file);
        let bytes_of = |atom| files.atoms.bytes(atom);
        let name_of = |expression: ExprId| match hir[expression].kind {
            ExprKind::Ident(name) => {
                BStr::new(super::written_name_of_local(bytes_of(name))).to_string()
            }
            _ => "?".to_owned(),
        };
        let mut calls = hir.exprs.iter().filter_map(|node| match node.kind {
            ExprKind::Call(call) if name_of(hir[call].callee) == "tell" => Some(hir[call]),
            _ => None,
        });
        let call = calls.next().expect("the file calls `tell`");
        let quoted = hir.ids(call.args).map(|argument| {
            let written = super::skip_to_written_use(hir, bytes_of, argument);
            match hir[written].kind {
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    operand,
                } => format!(
                    "typeof {}",
                    name_of(super::skip_to_written_use(hir, bytes_of, operand))
                ),
                _ => name_of(written),
            }
        });
        quoted.collect::<Vec<String>>().join(", ")
    }

    #[test]
    fn a_message_quotes_a_use_as_it_is_written() {
        let written = "expect, jest, vi, describe, test, it, beforeEach, typeof jest, typeof it";
        let call = format!("function tell() {{}} tell({written});");
        let settings = default_settings();
        for head in [
            "",
            "import { test } from 'bun:test'; ",
            "new Worker(import.meta.url); ",
        ] {
            for name in ["a.test.js", "a.test.ts"] {
                let text = format!("{head}{call}");
                let files = [(name, text.as_str())];
                let quoted = with_loaded_test_run(&files, &settings, |_, loaded| {
                    describe_quoted_arguments(loaded, name)
                });
                assert_eq!(quoted, written, "{name}: {text}");
                let quoted = with_loaded_test_run_of_vitest(&files, &settings, |_, loaded| {
                    describe_quoted_arguments(loaded, name)
                });
                assert_eq!(quoted, written, "under vitest: {name}: {text}");
            }
        }
        let files = [(
            "a.test.js",
            "function tell() {} let k; tell((k ??= 1) ? expect : jest);",
        )];
        let quoted = with_loaded_test_run(&files, &settings, |_, loaded| {
            describe_quoted_arguments(loaded, "a.test.js")
        });
        assert_eq!(quoted, "?");
    }

    fn find_loader_of_runner(text: &str) -> Binding {
        with_loaded_test_run(&[("a.test.cjs", text)], &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let file = files
                .by_path
                .get(&b"/project/a.test.cjs"[..])
                .expect("the file is in the program");
            let (hir, bound) = (files.hir(file), files.bound(file));
            let calls = hir.exprs.iter().filter_map(|node| match node.kind {
                ExprKind::Call(call) => Some(hir[call]),
                _ => None,
            });
            let mut loads = calls.filter(|call| match hir.ids(call.args).next() {
                Some(path) => matches!(hir[path].kind, ExprKind::String(path) if files.atoms.bytes(path) == b"bun:test"),
                None => false,
            });
            let callee = loads.next().expect("the file loads the runner").callee;
            let first = hir.member_key(callee).map_or(callee, |member| member.0);
            bound.binding(first)
        })
    }

    #[test]
    fn a_require_that_the_file_declares_does_not_load_the_runner() {
        let rows = [
            (
                "module.exports = 1; test('a', () => {});",
                CommonJsVariable::Require,
            ),
            (
                "function require() { return {}; } test('a', () => {});",
                CommonJsVariable::Module,
            ),
            (
                "var require = () => ({}); test('a', () => {});",
                CommonJsVariable::Module,
            ),
        ];
        for (text, variable) in rows {
            let loader = find_loader_of_runner(text);
            assert_eq!(loader, Binding::CommonJs(variable), "{text}");
        }
    }

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
                "test as %test:test, expect as %test:expect | 2 written | 0 typed",
            ),
            (
                "a.test.js",
                "expect(1); expect(2);",
                "expect as %test:expect | 2 written | 0 typed",
            ),
            (
                "a.test.js",
                "typeof describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "({ vi });",
                "vi as %test:vi | 1 written | 0 typed",
            ),
            (
                "a.test.ts",
                "declare const test: (name: string) => void; test('a');",
                "test as %test:test | 1 written | 1 typed",
            ),
            (
                "a.test.ts",
                "declare var vi: { answer: number }; vi.answer; vi.answer;",
                "vi as %test:vi | 2 written | 2 typed",
            ),
            (
                "a.test.ts",
                "let e: typeof expect; let f: typeof expect.extend; expect(1);",
                "expect as %test:expect | 1 written | 1 typed",
            ),
            (
                "a.test.ts",
                "({ vi });",
                "vi as %test:vi | 1 written | 1 typed",
            ),
            (
                "a.test.ts",
                "import type { Mock } from 'bun:test'; let m: Mock<() => void> | undefined; it('a', () => {});",
                "it as %test:it | 1 written | 1 typed",
            ),
            (
                "a.test.mjs",
                "'use strict'; it('a', () => {});",
                "it as %test:it | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "'use strict'; it('a', () => {});",
                "require %test:it | 1 written | 0 typed",
            ),
            (
                "a.test.cjs",
                "module.exports = 1; test('a', () => {});",
                "require %test:test | 1 written | 0 typed",
            ),
            (
                "a.test.cjs",
                "'use strict'; exports.a = 1; jest.fn();",
                "require %test:jest | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "import { test } from 'bun:test'; test('a', () => {}); describe;",
                "describe as %test:describe | 2 written | 0 typed",
            ),
            (
                "a.test.js",
                "import { test } from 'vitest'; test('a', () => {}); describe;",
                "describe as %test:describe | 2 written | 0 typed",
            ),
            (
                "a.test.js",
                "import { test } from '@jest/globals'; test('a', () => {}); describe;",
                "describe as %test:describe | 2 written | 0 typed",
            ),
            (
                "a.test.js",
                "import 'bun:test'; describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "onTestFinished; aroundEach; aroundAll;",
                "onTestFinished as %test:onTestFinished, aroundEach as %test:aroundEach, aroundAll as %test:aroundAll | 3 written | 0 typed",
            ),
            (
                "a.test.js",
                "import 'vitest'; suite; vitest; onTestFailed; assertType;",
                "suite as %test:suite, vitest as %test:vitest, onTestFailed as %test:onTestFailed, assertType as %test:assertType | 4 written | 0 typed",
            ),
            (
                "a.test.js",
                "export * from 'bun:test'; describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.js",
                "await import('bun:test'); describe;",
                "describe as %test:describe | 1 written | 0 typed",
            ),
            (
                "a.test.cjs",
                "require('bun:test'); describe;",
                "require %test:describe | 1 written | 0 typed",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe(name, text), expected, "{text}");
        }
    }

    fn describe_own_globals(name: &str, text: &str) -> String {
        with_loaded_test_run(&[(name, text)], &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files
                .by_path
                .get(path.as_bytes())
                .expect("the file is in the program");
            let hir = files.hir(file);
            let text_of = |it: ExprId| match hir[hir.skip_type_assertions(it)].kind {
                ExprKind::Ident(name) => BStr::new(files.atoms.bytes(name)).to_string(),
                _ => String::new(),
            };
            let asked = hir.exprs.iter().filter_map(|it| {
                let ExprKind::Cond { test, branches } = it.kind else {
                    return None;
                };
                let ExprKind::Binary {
                    op: BinOp::Or,
                    right,
                    ..
                } = hir[test].kind
                else {
                    return None;
                };
                let ExprKind::Binary {
                    op: BinOp::BitAnd,
                    left,
                    right: bit,
                } = hir[right].kind
                else {
                    return None;
                };
                let ExprKind::Assign { target, .. } = hir[left].kind else {
                    return None;
                };
                let ExprKind::Number(bit) = hir[bit].kind else {
                    return None;
                };
                let branches = hir.branches(branches);
                Some(format!(
                    "{} & {} ? {} : {}",
                    text_of(target),
                    hir.numbers[bit as usize],
                    text_of(branches.yes),
                    text_of(branches.no)
                ))
            });
            asked.collect::<Vec<String>>().join(", ")
        })
    }

    #[test]
    fn a_file_that_imports_a_runner_asks_the_run_which_names_it_leaves_alone() {
        let rows = [
            ("a.test.js", "describe;", ""),
            (
                "a.test.js",
                "import { test } from 'bun:test'; test('a', () => {}); describe; expect;",
                "%globals-left-alone & 4 ? describe : %test:describe, %globals-left-alone & 8 ? expect : %test:expect",
            ),
            (
                "a.test.ts",
                "import { test } from 'vitest'; test('a', () => {}); suite;",
                "%globals-left-alone & 32768 ? suite : %test:suite",
            ),
            (
                "a.test.cjs",
                "require('@jest/globals'); it;",
                "%globals-left-alone & 2 ? it : %test:it",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe_own_globals(name, text), expected, "{text}");
        }
    }

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
            (
                "lib.js",
                "jest = 1; jest++; delete jest;",
                "0 asked | 0 free | 0 under typeof",
            ),
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

    fn describe_choice(hir: &File<'_>, text_of: &dyn Fn(Atom) -> String, e: ExprId) -> String {
        let describe = |e: ExprId| describe_choice(hir, text_of, e);
        match hir[hir.skip_type_assertions(e)].kind {
            ExprKind::Ident(name) => text_of(name),
            ExprKind::Number(number) => hir.numbers[number as usize].to_string(),
            ExprKind::Assign { target, .. } => describe(target),
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not => format!("!{}", describe(operand)),
                UnOp::Typeof => format!("typeof {}", describe(operand)),
                _ => "?".to_string(),
            },
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Or => format!("{} || {}", describe(left), describe(right)),
                BinOp::BitAnd => format!("{} & {}", describe(left), describe(right)),
                _ => "?".to_string(),
            },
            ExprKind::Cond { test, branches } => {
                let (test, branches) = (describe(test), hir.branches(branches));
                let (yes, no) = (describe(branches.yes), describe(branches.no));
                format!("({test} ? {yes} : {no})")
            }
            _ => "?".to_string(),
        }
    }

    fn describe_last_statement(test_file: &str, name: &str, text: &str) -> String {
        let files = [("a.test.js", test_file), (name, text)];
        with_loaded_test_run_of_vitest(&files, &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files.by_path.get(path.as_bytes());
            let hir = files.hir(file.expect("the file is in the program"));
            let text_of = |atom| BStr::new(files.atoms.bytes(atom)).to_string();
            match hir.ids(hir.body).last().map(|it| hir[it].kind) {
                Some(StmtKind::Expr(e)) => describe_choice(hir, &text_of, e),
                _ => String::new(),
            }
        })
    }

    #[test]
    fn a_file_has_the_names_of_the_runner_that_loads_it() {
        let of_vitest = "import { test } from 'vitest'; import './lib'; test('a', () => {});";
        let rows = [
            (
                "lib.js",
                "jest;",
                "(%loaded-by-worker || %loaded-below-vitest ? jest : %test:jest)",
            ),
            (
                "lib.js",
                "suite;",
                "(%loaded-by-worker || !%loaded-below-vitest ? suite : %vitest:suite)",
            ),
            (
                "lib.ts",
                "vitest;",
                "(%loaded-by-worker || !%loaded-below-vitest ? vitest : %vitest:vitest)",
            ),
            (
                "lib.cjs",
                "typeof assertType;",
                "(%loaded-by-worker || !%loaded-below-vitest ? typeof assertType : typeof %vitest:assertType)",
            ),
            ("lib.js", "onTestFailed = 1;", "onTestFailed"),
            (
                "lib.js",
                "afterEach;",
                "(%loaded-by-worker ? afterEach : (%loaded-below-vitest ? %vitest:afterEach : %test:afterEach))",
            ),
            (
                "lib.js",
                "vi;",
                "(%loaded-by-worker ? vi : (%loaded-below-vitest ? %vitest:vi : %test:vi))",
            ),
            (
                "lib.js",
                "import 'bun:test'; afterEach;",
                "(%loaded-by-worker || %globals-left-alone & 128 ? afterEach : (%loaded-below-vitest ? %vitest:afterEach : %test:afterEach))",
            ),
            (
                "lib.js",
                "import 'bun:test'; suite;",
                "(%loaded-by-worker || !%loaded-below-vitest || %globals-left-alone & 32768 ? suite : %vitest:suite)",
            ),
            (
                "lib.js",
                "import 'vitest'; suite;",
                "(%loaded-by-worker || %globals-left-alone & 32768 ? suite : %test:suite)",
            ),
        ];
        for (name, text, expected) in rows {
            let described = describe_last_statement(of_vitest, name, text);
            assert_eq!(described, expected, "{text}");
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
            let hir = files.hir(file);
            let bytes_of = |atom| files.atoms.bytes(atom);
            assert!(!hir.exprs.iter().any(
                |it| matches!(it.kind, ExprKind::Ident(name) if bytes_of(name) == super::LOADED_BELOW_VITEST)
            ));
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
            ("expect = 1; delete jest;", 0),
            ("[expect] = []; ({ jest, a: vi = 1, ...test } = {});", 0),
            ("for (describe of []); for (it in {});", 0),
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

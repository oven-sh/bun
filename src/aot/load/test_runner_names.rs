//! `bun test` hands every file the names of the test runner.

use bun_ast::import_record::is_test_module;
use bun_js_parser::Jest;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Parent};
use bun_sema::hir::{
    BinOp, Chain, ExprId, ExprKind, File, FileBuilder, IdList, Keyword, NameKind, PatKind, PatProp,
    PropKey, PropKind, StmtId, TypeNodeKind, UnOp,
};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::{TransformRequest, TreeChange};
use bun_sema::session::Arena;

use crate::load::react_compiler::module_items::{
    POSITION, finish_file, put_around_body, write_constant, write_import,
};

const MODULE: &[u8] = b"bun:test";
const MODULE_OF_VITEST: &[u8] = b"vitest";
// No program can write such a name, so it meets no declaration of the file: `declare const test: ..` stands beside it.
const LOCAL_NAME_PREFIX: &[u8] = b"%test:";

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

// `expect = x`, `expect++`, `[expect] = x`, `for (expect of x)`, `delete expect`.
fn is_stored_or_deleted(request: &TransformRequest<'_, '_>, name: ExprId) -> bool {
    let (hir, bound) = (&*request.hir, request.bound);
    let mut target = name;
    while let Parent::Expr(parent) = bound.parent_of_expr(target)
        && hir.type_assertion_operand(parent) == Some(target)
    {
        target = parent;
    }
    let is_deleted = matches!(
        bound.parent_of_expr(target),
        Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. })
    );
    is_deleted || bound.get_assignment_target(hir, target).is_some()
}

fn find_uses(
    request: &TransformRequest<'_, '_>,
    names: &[Atom],
    reads_only: bool,
) -> Vec<(ExprId, usize)> {
    let in_type_queries = find_names_in_type_queries(request.hir);
    let expressions = (0..).map(ExprId).zip(request.hir.exprs.iter());
    let uses = expressions.filter_map(|(expression, node)| {
        let ExprKind::Ident(written) = node.kind else {
            return None;
        };
        let name = names.iter().position(|&name| name == written)?;
        let is_value = in_type_queries.binary_search(&expression).is_err();
        let is_free = request.bound.binding(expression) == Binding::Free;
        let is_wanted = !reads_only || !is_stored_or_deleted(request, expression);
        (is_value && is_free && is_wanted).then_some((expression, name))
    });
    uses.collect()
}

/// `globalThis.expect ?? %test:expect`
fn write_read_of_global(
    file: &mut FileBuilder,
    written: Atom,
    of_runner: Atom,
    (pos, end): (u32, u32),
) -> ExprKind {
    let mut global = file.expr(ExprKind::Ident(known::globalThis), pos, end);
    if !file.is_js {
        let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), pos, end);
        global = file.expr(ExprKind::As { expr: global, ty }, pos, end);
    }
    let own = file.dot((global, Chain::No), (written, pos), end);
    let own = file.expr(own, pos, end);
    let of_runner = file.expr(ExprKind::Ident(of_runner), pos, end);
    ExprKind::Binary {
        op: BinOp::Nullish,
        left: own,
        right: of_runner,
    }
}

fn write_use(
    file: &mut FileBuilder,
    expression: ExprId,
    written: Atom,
    local: Atom,
    reads_global_first: bool,
) {
    let (pos, end) = (file[expression].pos, file[expression].end);
    let value = match reads_global_first {
        true => write_read_of_global(file, written, local, (pos, end)),
        false => ExprKind::Ident(local),
    };
    if file.is_js {
        file[expression].kind = value;
        return;
    }
    let value = file.expr(value, pos, end);
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

pub(crate) fn import_used_names<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
    has_globals_of_vitest: bool,
) -> TreeChange {
    // The parser gives `bun test` the same names out of the same module.
    let is_of_vitest =
        has_globals_of_vitest || imports(request, atoms, |module| module == MODULE_OF_VITEST);
    let module = if is_of_vitest {
        MODULE_OF_VITEST
    } else {
        MODULE
    };
    let given = Jest::GLOBALS.iter().filter(|name| match is_of_vitest {
        true => !Jest::is_of_bun_only(name),
        false => !Jest::is_of_vitest_only(name),
    });
    let given: Vec<&[u8]> = given.map(|name| name.as_bytes()).collect();
    let names: Vec<Atom> = given.iter().map(|name| atoms.intern(name)).collect();
    // A file that imports a test module gets the function that a script put on `globalThis` under the name. A script
    // can do that at any time, so each read looks there when it runs. A store goes to `globalThis`, as written.
    let reads_global_first = imports(request, atoms, is_test_module);
    let uses = find_uses(request, &names, reads_global_first);
    if uses.is_empty() {
        return TreeChange::Unchanged;
    }
    let locals = given
        .iter()
        .map(|name| atoms.intern(&[LOCAL_NAME_PREFIX, name].concat()));
    let locals: Vec<Atom> = locals.collect();
    let mut file = FileBuilder::from_file(request.hir);
    for &(expression, name) in &uses {
        write_use(
            &mut file,
            expression,
            names[name],
            locals[name],
            reads_global_first,
        );
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
    let used = (0..names.len()).filter(|&name| is_used(name));
    let imported: Vec<(Atom, Atom)> = used.map(|name| (names[name], locals[name])).collect();
    let added = match request.analysis.module_format {
        ModuleFormat::Esm => write_import(&mut file, atoms, module, imported.iter().copied()),
        ModuleFormat::CommonJs => write_require(&mut file, atoms, module, &imported),
    };
    put_around_body(&mut file, &[added], &[]);
    *request.hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::hir::{BinOp, ExprId, ExprKind, PatKind, StmtKind, TypeNodeKind};

    use crate::compile::testing::{default_settings, with_loaded_test_run};
    use crate::load::ProjectId;

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
            let in_type_queries = super::find_names_in_type_queries(hir);
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

    // The reads that take a name off `globalThis`, each with what it takes where `globalThis` lacks the name.
    fn describe_reads_of_globals(name: &str, text: &str) -> String {
        with_loaded_test_run(&[(name, text)], &default_settings(), |_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let path = format!("/project/{name}");
            let file = files
                .by_path
                .get(path.as_bytes())
                .expect("the file is in the program");
            let hir = files.hir(file);
            let text_of = |atom| BStr::new(files.atoms.bytes(atom)).to_string();
            let reads = hir.exprs.iter().filter_map(|node| {
                let ExprKind::Binary {
                    op: BinOp::Nullish,
                    left,
                    right,
                } = node.kind
                else {
                    return None;
                };
                let (ExprKind::Dot { obj, name, .. }, ExprKind::Ident(of_runner)) =
                    (hir[left].kind, hir[right].kind)
                else {
                    return None;
                };
                let ExprKind::Ident(object) = hir[hir.skip_type_assertions(obj)].kind else {
                    return None;
                };
                Some(format!(
                    "{}.{} ?? {}",
                    text_of(object),
                    text_of(name),
                    text_of(of_runner)
                ))
            });
            reads.collect::<Vec<String>>().join(", ")
        })
    }

    #[test]
    fn a_file_that_imports_a_runner_asks_global_this_at_each_read() {
        let rows = [
            ("a.test.js", "describe;", ""),
            (
                "a.test.js",
                "import { test } from 'bun:test'; test('a', () => {}); describe; expect; expect;",
                "globalThis.describe ?? %test:describe, globalThis.expect ?? %test:expect, globalThis.expect ?? %test:expect",
            ),
            (
                "a.test.ts",
                "import { test } from 'vitest'; test('a', () => {}); suite;",
                "globalThis.suite ?? %test:suite",
            ),
            (
                "a.test.cjs",
                "require('@jest/globals'); it;",
                "globalThis.it ?? %test:it",
            ),
            (
                "a.test.js",
                "import 'bun:test'; typeof expect; ({ describe }); it.skip; new jest.fn();",
                "globalThis.expect ?? %test:expect, globalThis.describe ?? %test:describe, globalThis.it ?? %test:it, globalThis.jest ?? %test:jest",
            ),
            (
                "a.test.js",
                "import 'bun:test'; expect = 1; describe++; [it] = [1]; for (xit of []) {} vi;",
                "globalThis.vi ?? %test:vi",
            ),
            (
                "a.test.ts",
                "import 'bun:test'; (expect as any) = 1; vi;",
                "globalThis.vi ?? %test:vi",
            ),
            (
                "a.test.cjs",
                "require('bun:test'); delete jest; vi;",
                "globalThis.vi ?? %test:vi",
            ),
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe_reads_of_globals(name, text), expected, "{text}");
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
            (
                "js",
                "import 'bun:test'; expect = 1; describe++; [it] = [1]; for (xit of []) {}",
                4,
            ),
        ];
        for (extension, text, written) in rows {
            let described = describe(&format!("a.test.{extension}"), text);
            let expected = format!(" | {written} written | 0 typed");
            assert_eq!(described, expected, "{text}");
        }
    }
}

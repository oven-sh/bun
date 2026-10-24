//! `bun test` hands every file the names of the test runner.

use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::Binding;
use bun_sema::hir::{
    ExprId, ExprKind, File, FileBuilder, IdList, Keyword, NameKind, PatKind, PatProp, PropKey,
    PropKind, StmtId, TypeNodeKind,
};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::{TransformRequest, TreeChange};
use bun_sema::session::Arena;

use crate::load::react_compiler::module_items::{
    POSITION, finish_file, put_around_body, write_constant, write_import,
};
use crate::load::runtime_declarations::NAMES_OF_EVERY_TEST_FILE;

const MODULE: &[u8] = b"bun:test";
const MODULES_OF_TEST_RUNNERS: [&[u8]; 3] = [MODULE, b"@jest/globals", b"vitest"];
// No program can write such a name, so it meets no declaration of the file: `declare const test: ..` stands beside it.
const LOCAL_NAME_PREFIX: &[u8] = b"%test:";

fn loads_test_runner(request: &TransformRequest<'_, '_>, atoms: &Interner<'_>) -> bool {
    let mut sites = request.analysis.import_sites.iter();
    sites.any(|site| match site.specifier {
        ImportSpecifier::Constant(specifier) => {
            MODULES_OF_TEST_RUNNERS.contains(&atoms.bytes(specifier))
        }
        ImportSpecifier::Pattern { .. } | ImportSpecifier::Unknown => false,
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

fn find_uses(request: &TransformRequest<'_, '_>, names: &[Atom]) -> Vec<(ExprId, usize)> {
    let in_type_queries = find_names_in_type_queries(request.hir);
    let expressions = (0..).map(ExprId).zip(request.hir.exprs.iter());
    let uses = expressions.filter_map(|(expression, node)| {
        let ExprKind::Ident(written) = node.kind else {
            return None;
        };
        let name = names.iter().position(|&name| name == written)?;
        let is_value = in_type_queries.binary_search(&expression).is_err();
        let is_free = request.bound.binding(expression) == Binding::Free;
        (is_value && is_free).then_some((expression, name))
    });
    uses.collect()
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

fn write_require(file: &mut FileBuilder, atoms: &Interner<'_>, names: &[(Atom, Atom)]) -> StmtId {
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
    write_constant(file, pat, callee, atoms.intern(MODULE))
}

pub(crate) fn import_used_names<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
) -> TreeChange {
    if loads_test_runner(request, atoms) {
        return TreeChange::Unchanged;
    }
    let names = NAMES_OF_EVERY_TEST_FILE.map(|name| atoms.intern(name));
    let uses = find_uses(request, &names);
    if uses.is_empty() {
        return TreeChange::Unchanged;
    }
    let locals =
        NAMES_OF_EVERY_TEST_FILE.map(|name| atoms.intern(&[LOCAL_NAME_PREFIX, name].concat()));
    let mut file = FileBuilder::from_file(request.hir);
    for &(expression, name) in &uses {
        write_use(&mut file, expression, names[name], locals[name]);
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
    let used: Vec<(Atom, Atom)> = used.map(|name| (names[name], locals[name])).collect();
    let added = match request.analysis.module_format {
        ModuleFormat::Esm => write_import(&mut file, atoms, MODULE, used.iter().copied()),
        ModuleFormat::CommonJs => write_require(&mut file, atoms, &used),
    };
    put_around_body(&mut file, &[added], &[]);
    *request.hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_sema::hir::{ExprId, ExprKind, PatKind, StmtKind, TypeNodeKind};

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
                Some(StmtKind::Import(import)) if text_of(hir[import].spec) == "bun:test" => {
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
                        super::NAMES_OF_EVERY_TEST_FILE.contains(&files.atoms.bytes(name))
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
        ];
        for (name, text, expected) in rows {
            assert_eq!(describe(name, text), expected, "{text}");
        }
    }

    #[test]
    fn names_of_the_file_and_files_that_load_a_runner_stay_as_written() {
        let rows = [
            ("js", "console.log(1);", 0),
            ("ts", "let e: typeof expect;", 0),
            ("js", "function test() {} test();", 1),
            ("js", "(expect => expect)(1);", 1),
            ("js", "x.test; ({ test: 1 });", 0),
            (
                "js",
                "import { test } from 'bun:test'; test('a', () => {}); describe;",
                2,
            ),
            (
                "js",
                "import { test } from 'vitest'; test('a', () => {}); describe;",
                2,
            ),
            (
                "js",
                "import { test } from '@jest/globals'; test('a', () => {}); describe;",
                2,
            ),
            ("js", "import 'bun:test'; describe;", 1),
            ("js", "export * from 'bun:test'; describe;", 1),
            ("js", "await import('bun:test'); describe;", 1),
            ("cjs", "require('bun:test'); describe;", 1),
        ];
        for (extension, text, written) in rows {
            let described = describe(&format!("a.test.{extension}"), text);
            let expected = format!(" | {written} written | 0 typed");
            assert_eq!(described, expected, "{text}");
        }
    }
}

//! `bun test` hands every file the names of the test runner.

use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, CodeUnit, Parent};
use bun_sema::fold::Decision;
use bun_sema::hir::{
    Chain, ExprFlags, ExprId, ExprKind, File, FileBuilder, IdList, Keyword, MemberKey, NameKind,
    PatKind, PatProp, PropKey, PropKind, StmtId, TypeNodeKind, UnOp,
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

// The uses of a file of a build without a define whose value is a name or a path, each with the index of its name. Nothing is asked of the fold.
fn find_spelled_uses(request: &TransformRequest<'_, '_>, names: &[Atom]) -> Vec<(ExprId, usize)> {
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

// An expression in whose place the import is written. `name` is the index of the runner's name, and `members` is what a define path has behind it.
struct Use<'s> {
    expression: ExprId,
    name: usize,
    members: &'s [Atom],
    // `bun test` imports the name on account of this expression. Where it counts no use, what it writes there finds the name only if another use has it imported.
    is_counted: bool,
}

#[derive(Default)]
struct Uses<'s> {
    written: Vec<Use<'s>>,
    // The names that a define writes alone in a place where the define stays as it is. `bun test` imports each of them.
    kept: Vec<usize>,
}

// Whether the program stores to `site` or deletes it, below nothing but type syntax.
fn is_stored_to_or_deleted(hir: &File<'_>, bound: &Bound<'_>, site: ExprId) -> bool {
    let parent_of = |expression: ExprId| match bound.parent_of_expr(expression) {
        Parent::Expr(parent) => parent.some(),
        _ => None,
    };
    let mut outermost = site;
    while let Some(parent) = parent_of(outermost)
        && hir.type_assertion_operand(parent).is_some()
    {
        outermost = parent;
    }
    let is_deleted = parent_of(outermost).is_some_and(|parent| {
        matches!(
            hir[parent].kind,
            ExprKind::Unary {
                op: UnOp::Delete,
                ..
            }
        )
    });
    is_deleted || bound.get_assignment_target(hir, outermost).is_some()
}

// The uses of a file of a build with a define whose value is a name or a path, applied in the file or not.
fn find_uses<'s>(request: &TransformRequest<'_, 's>, names: &[Atom]) -> Uses<'s> {
    let hir: &File<'_> = request.hir;
    let bound = request.bound;
    let decisions = &request.analysis.decisions;
    let of_bun_run = decisions.as_folded_by_bun_run();
    let in_type_queries = find_names_in_type_queries(hir);
    let mut uses = Uses::default();
    for (expression, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
        // Nothing reads a name in code that the build and `bun run` both remove, nor below an expression that a define replaces: the key of the define stays there as the file has it.
        if decisions.is_dead_expr(expression) && of_bun_run.is_dead_expr(expression) {
            continue;
        }
        let (path, head) = match decisions.decision(expression) {
            Decision::Unknown => {
                if let ExprKind::Ident(written) = node.kind
                    && let Some(name) = names.iter().position(|&name| name == written)
                    && in_type_queries.binary_search(&expression).is_err()
                    && bound.binding(expression) == Binding::Free
                {
                    uses.written.push(Use {
                        expression,
                        name,
                        members: &[],
                        is_counted: true,
                    });
                }
                continue;
            }
            // A define writes a constant or data there, and neither reads the name that the file spells.
            Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => continue,
            Decision::GlobalPath(path) => (path, None),
            Decision::NamedPath(named) => (named.names, Some(named.head)),
        };
        let Some((&first, members)) = path.split_first() else {
            continue;
        };
        let Some(name) = names.iter().position(|&name| name == first) else {
            continue;
        };
        // The binder has a record of the first name where the file binds it, and where a `with` object or evaluated text may declare it: only there is the name of a record free.
        let is_looked_up_when_run = match head {
            None => false,
            Some(head) if head.binding == Binding::Free => true,
            Some(_) => continue,
        };
        // `bun test` counts a use where a define writes the name alone, but none where it finds the name behind a member of a namespace or an enum.
        let is_behind_member = head.is_some_and(|head| bound.is_define_head_behind_member(&head));
        let is_counted = members.is_empty() && !is_behind_member;
        // The import is written only for a read of the name as it is when the file is loaded: a store through the define throws where it runs.
        let stays = is_looked_up_when_run || is_stored_to_or_deleted(hir, bound, expression);
        match (stays, is_counted) {
            (false, _) => uses.written.push(Use {
                expression,
                name,
                members,
                is_counted,
            }),
            (true, true) => uses.kept.push(name),
            (true, false) => {}
        }
    }
    uses
}

// Whether the file can declare `name`, as `bun test` does. That binds every free identifier that spells it, so `written` must have them all.
fn can_declare_own_name(
    request: &TransformRequest<'_, '_>,
    name: Atom,
    written: &[Use<'_>],
) -> bool {
    let hir: &File<'_> = request.hir;
    let bound = request.bound;
    let meets_no_other_file = hir.is_js || request.analysis.module_format == ModuleFormat::Esm;
    let top = bound.scopes.get(bound.top_scope(hir, CodeUnit::File).idx());
    let is_declared = top.is_some_and(|scope| bound.lookup(scope.locals, name).is_some());
    if is_declared || !meets_no_other_file {
        return false;
    }
    let mut expressions = (0..).map(ExprId).zip(hir.exprs.iter());
    !expressions.any(|(expression, node)| {
        matches!(node.kind, ExprKind::Ident(spelled) if spelled == name)
            && bound.binding(expression) == Binding::Free
            && !written.iter().any(|used| used.expression == expression)
    })
}

// The names of `expression` where it is an identifier or members of one: `a.b.c`, which a type can ask the type of. Empty for any other expression.
fn find_written_names(hir: &File<'_>, expression: ExprId) -> Vec<Atom> {
    let mut names = Vec::new();
    let mut at = expression;
    while let Some((object, key)) = hir.member_key(at) {
        let MemberKey::Name(name) = key else {
            return Vec::new();
        };
        names.push(name);
        at = object;
    }
    let ExprKind::Ident(root) = hir[at].kind else {
        return Vec::new();
    };
    names.push(root);
    names.reverse();
    names
}

// `first.a.b` for the members `a` and `b`. Every expression but the outermost is added to the file, and the kind of the outermost is the answer.
fn write_path(
    file: &mut FileBuilder,
    first: Atom,
    members: &[Atom],
    pos: u32,
    end: u32,
) -> ExprKind {
    let mut kind = ExprKind::Ident(first);
    for &member in members {
        let object = file.expr(kind, pos, end);
        // The name is at the end of the expression, which needs no entry in `far_names`.
        kind = ExprKind::Dot {
            obj: object,
            name: member,
            chain: Chain::No,
            name_before_end: 0,
        };
    }
    kind
}

// Writes `local` in place of an identifier that spells `written`, a name of the runner.
fn write_spelled_use(file: &mut FileBuilder, expression: ExprId, written: Atom, local: Atom) {
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

// Writes `local`, with the members of `used` behind it, in place of the expression of `used`. `hir` is the file as it was parsed.
fn write_use(file: &mut FileBuilder, hir: &File<'_>, used: &Use<'_>, local: Atom) {
    let expression = used.expression;
    let (pos, end) = (file[expression].pos, file[expression].end);
    let value = write_path(file, local, used.members, pos, end);
    // Of what the parser noted about the expression, only its parentheses hold for what is written.
    if let Some(flags) = file.expr_flags.get_mut(expression.idx()) {
        *flags &= ExprFlags::PARENTHESIZED;
    }
    if file.is_js {
        file[expression].kind = value;
        return;
    }
    let value = file.expr(value, pos, end);
    let any = file.ty(TypeNodeKind::Keyword(Keyword::Any), pos, end);
    let untyped = ExprKind::As {
        expr: value,
        ty: any,
    };
    // The type stays that of what the file has there, which is another name where a define writes the name of the runner. No type asks the type of a member of `import.meta`.
    let written = find_written_names(hir, expression);
    let Some((&root, members)) = written.split_first() else {
        file[expression].kind = untyped;
        return;
    };
    let untyped = file.expr(untyped, pos, end);
    let queried = write_path(file, root, members, pos, end);
    let queried = file.expr(queried, pos, end);
    let name = file.entity_name(written.iter().map(|&name| (name, pos)));
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

// The tree of a file of a build without a define whose value is a name or a path: every use of a name of the runner is an identifier that spells it, in code that runs or not.
fn import_spelled_names<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
    names: &[Atom],
) -> TreeChange {
    let uses = find_spelled_uses(request, names);
    if uses.is_empty() {
        return TreeChange::Unchanged;
    }
    let locals =
        NAMES_OF_EVERY_TEST_FILE.map(|name| atoms.intern(&[LOCAL_NAME_PREFIX, name].concat()));
    let mut file = FileBuilder::from_file(request.hir);
    for &(expression, name) in &uses {
        write_spelled_use(&mut file, expression, names[name], locals[name]);
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

pub(crate) fn import_used_names<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut TransformRequest<'_, 's>,
) -> TreeChange {
    if loads_test_runner(request, atoms) {
        return TreeChange::Unchanged;
    }
    let names = NAMES_OF_EVERY_TEST_FILE.map(|name| atoms.intern(name));
    // A build with a define whose value is a name or a path asks the fold in every file, so that a define means the same in all of its files.
    if !request.analysis.decisions.is_built_with_define_paths() {
        return import_spelled_names(arena, atoms, request, &names);
    }
    let Uses { mut written, kept } = find_uses(request, &names);
    let mut is_imported = names.map(|_| false);
    for used in written.iter().filter(|used| used.is_counted) {
        is_imported[used.name] = true;
    }
    for &name in &kept {
        is_imported[name] = true;
    }
    written.retain(|used| is_imported[used.name]);
    let mut own = Vec::new();
    for name in 0..names.len() {
        if kept.contains(&name) && can_declare_own_name(request, names[name], &written) {
            own.push(name);
        }
    }
    if written.is_empty() && own.is_empty() {
        return TreeChange::Unchanged;
    }
    let locals =
        NAMES_OF_EVERY_TEST_FILE.map(|name| atoms.intern(&[LOCAL_NAME_PREFIX, name].concat()));
    let mut file = FileBuilder::from_file(request.hir);
    for used in &written {
        write_use(&mut file, request.hir, used, locals[used.name]);
    }
    // `{ test }` has the key `test` and the value of the import.
    for property in &mut file.props {
        let is_written = written.iter().any(|used| used.expression == property.value);
        if property.kind == PropKind::Shorthand && is_written {
            property.kind = PropKind::Init;
        }
    }
    let is_written = |name: usize| written.iter().any(|used| used.name == name);
    let under_locals = (0..names.len()).filter(|&name| is_written(name));
    let under_locals = under_locals.map(|name| (names[name], locals[name]));
    let under_own_names = own.iter().map(|&name| (names[name], names[name]));
    let imported: Vec<(Atom, Atom)> = under_locals.chain(under_own_names).collect();
    let added = match request.analysis.module_format {
        ModuleFormat::Esm => write_import(&mut file, atoms, MODULE, imported.iter().copied()),
        ModuleFormat::CommonJs => write_require(&mut file, atoms, &imported),
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

    // The build of these files has no define whose value is a name or a path, and nothing asks which of their code runs.
    #[test]
    fn names_in_code_that_never_runs_come_out_of_the_module_without_a_define() {
        let rows = [
            (
                "if (false) test('a', () => {});",
                "test as %test:test | 0 written | 0 typed",
            ),
            (
                "if (false) test('a', () => {}); else expect(1);",
                "test as %test:test, expect as %test:expect | 0 written | 0 typed",
            ),
        ];
        for (text, expected) in rows {
            assert_eq!(describe("a.test.js", text), expected, "{text}");
        }
    }
}

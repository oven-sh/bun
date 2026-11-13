use crate::jest::{self, is_vitest_import_source};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// The rule disallows importing any Vitest global functions.
pub struct NoImportingVitestGlobals;

const NO_IMPORTING_VITEST_GLOBALS: &Message = &Message::new("", "Do not `import`/`require` global functions from 'vitest'.");

const VITEST_GLOBALS: [&str; 17] = [
    "suite",
    "test",
    "chai",
    "describe",
    "it",
    "expectTypeOf",
    "assertType",
    "expect",
    "assert",
    "vitest",
    "vi",
    "beforeAll",
    "afterAll",
    "beforeEach",
    "afterEach",
    "onTestFailed",
    "onTestFinished",
];

impl Rule for NoImportingVitestGlobals {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-importing-vitest-globals", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Import, StmtTag::Var]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImportingVitestGlobals
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().stmts(&[StmtTag::Import]);
        if file.mentions("require") { on.stmts(&[StmtTag::Var]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::mentions_any(file, &const { jest::mention_bits(["vitest", "vite-plus/test", "@effect/vitest"]) }).then_some(())
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            StmtTag::Import => {
                if let StmtKind::Import(import_decl) = node.kind()
                    && is_vitest_import_source(import_decl.spec().bytes())
                {
                    check_import(node, import_decl, cx);
                }
            }
            StmtTag::Var => {
                if let StmtKind::Var(declarations) = node.kind() {
                    check_variable_declaration(node, declarations, cx);
                }
            }
            _ => {}
        }
    }
}

const REMOVE_THIS: &str = "Remove this global vitest import";

/// True if the global `local` is what `imported` of `source` is.
fn is_the_global<'a>(source: &[u8], imported: Name<'a>, local: Name<'a>) -> bool {
    // `@effect/vitest` declares some of the names itself: its `it` has `it.effect()`.
    imported == local && local.is_any(&VITEST_GLOBALS) && source != b"@effect/vitest"
}

/// True if the file has an `export { name }`, which needs `name` to stay declared.
fn is_exported_by_name<'a>(file: &'a File<'a>, name: Name<'a>) -> bool {
    let names_it = |it: ExportSpec<'a>| it.local().name() == name;
    let exports_it = |it: Stmt<'a>| match it.kind() {
        StmtKind::ExportNamed(export) => !export.has_from() && export.items().iter().any(names_it),
        _ => false,
    };
    file.body().iter().any(exports_it)
}

fn is_global_specifier(specifier: &ImportSpec) -> bool {
    !specifier.is_type_only() && !specifier.imported().is_string() && specifier.local().name().is_any(&VITEST_GLOBALS)
}

/// True for an import of Vitest that the fix removes whole.
fn goes_whole(statement: Stmt) -> bool {
    let StmtKind::Import(import) = statement.kind() else {
        return false;
    };
    let names = import.named();
    let is_all_globals = !names.is_empty() && names.iter().all(|it| is_global_specifier(&it));
    is_vitest_import_source(import.spec().bytes()) && import.default().is_none() && is_all_globals
}

/// True if TypeScript takes the file for a script once the imports that go whole are gone, and the file has what differs in a script.
fn becomes_a_script<'a>(file: &'a File<'a>) -> bool {
    // A script's names are global, and it can't have a top-level `await`. `tsconfig.json` can say that no file is a script.
    let is_plain = |it: Stmt<'a>| matches!(it.tag(), StmtTag::Expr | StmtTag::Empty | StmtTag::ExportNamed);
    let declares_names = || file.body().iter().any(|it| !is_plain(it) && !goes_whole(it));
    let awaits = || file.exprs_of_kind(ExprTag::Await).any(|it| Node::Expr(it).enclosing_function().is_none());
    !file.is_javascript() && !utils::visible::is_module_without(file, goes_whole) && (declares_names() || awaits())
}

fn check_import<'a>(node: Stmt<'a>, import_decl: Import<'a>, cx: &Cx<'a, NoImportingVitestGlobals>) {
    let Some(first_global) = import_decl.named().iter().find(is_global_specifier) else {
        return;
    };
    let report = cx.report(first_global, NO_IMPORTING_VITEST_GLOBALS).first_label(REMOVE_THIS);
    let others = import_decl.named().iter().filter(is_global_specifier).skip(1);
    // The fix writes these back. It drops specifiers imported under a string name.
    let is_kept = |it: &ImportSpec| !is_global_specifier(it) && (it.is_type_only() || !it.imported().is_string());
    // The fix is oxlint's, which goes by the local name alone.
    let is_safe = || {
        let (file, source) = (cx.file(), import_decl.spec().bytes());
        let is_unchanged = |it: ImportSpec<'a>| is_kept(&it) || is_the_global(source, it.imported().name(), it.local().name());
        import_decl.named().iter().all(is_unchanged) && !(goes_whole(node) && becomes_a_script(file))
    };
    others.fold(report, |report, it| report.label(it, REMOVE_THIS)).fix_where_safe(is_safe, |fixer| {
        // oxlint's text for names next to a default import is `import  } from "vitest"`.
        if import_decl.default().is_some() {
            return None;
        }
        // An `export { name }` of a name that goes would be left without it.
        let is_exported = |it: ImportSpec<'a>| !is_kept(&it) && is_exported_by_name(cx.file(), it.local().name());
        if import_decl.named().iter().any(is_exported) {
            return None;
        }
        if goes_whole(node) {
            return fixer.remove_statement(node);
        }
        let mut import_text = Vec::new();
        for specifier in import_decl.named().iter().filter(is_kept) {
            import_text.extend_from_slice(if import_text.is_empty() { "" } else { ", " }.as_bytes());
            import_text.extend_from_slice(specifier.text());
        }
        let specifiers = Span::new(import_decl.named().first()?.span().start, import_decl.named().last()?.span().end);
        Some(fixer.replace(specifiers, import_text)).filter(|it| fixer.keeps_comments(it))
    });
}

/// Matches `{ .. } = require("vitest")` with no rest element and no `default` key. Returns the properties and the
/// module name.
fn vitest_require<'a>(declaration: VarDecl<'a>) -> Option<(List<'a, PatProp<'a>>, Name<'a>)> {
    let init = declaration.init().filter(|it| !it.is_parenthesized() && !it.is_chain_root())?;
    let call_expr = init.as_call().filter(|it| it.callee().is_ident("require") && !it.callee().is_parenthesized())?;
    let require_import = call_expr.args().first().filter(|it| call_expr.args().len() == 1 && !it.is_parenthesized())?;
    let import_source = require_import.as_string().filter(|it| is_vitest_import_source(it.bytes()))?;
    let PatKind::Object(properties) = declaration.pat().kind() else {
        return None;
    };
    let is_kept = |it: PatProp| it.is_rest() || it.key().is_some_and(|key| key.is("default"));
    (!properties.iter().any(is_kept)).then_some((properties, import_source))
}

fn is_global_property(property: &PatProp) -> bool {
    property.key().and_then(|it| it.name()).is_some_and(|it| it.is_any(&VITEST_GLOBALS))
}

/// The fix writes these back. It drops properties with a computed key.
fn is_kept_property(property: &PatProp) -> bool {
    !is_global_property(property) && property.key().is_some_and(|key| key.name().is_some())
}

/// True if every name of the statement is the same thing after the fix, which is oxlint's and goes by the keys alone.
fn leaves_names_unchanged<'a>(node: Stmt<'a>, declarations: List<'a, VarDecl<'a>>) -> bool {
    let is_unchanged = |it: PatProp<'a>, source: Name<'a>| {
        let is_global = |key, local| is_the_global(source.bytes(), key, local);
        let names = (it.key().and_then(|key| key.name()), it.value().kind());
        // A default can be the value in use.
        is_kept_property(&it) || it.default().is_none() && matches!(names, (Some(key), PatKind::Ident(local)) if is_global(key, local))
    };
    // The fix writes a declaration back without its type annotation and without the type arguments of the call.
    let has_type_arguments = |it: VarDecl<'a>| it.init().and_then(|e| e.as_call()).is_some_and(|call| !call.type_args().is_empty());
    let is_typed = |it: VarDecl<'a>| it.ty().is_some() || has_type_arguments(it);
    let is_written_alike = |it: VarDecl<'a>| match vitest_require(it) {
        Some((properties, source)) => !is_typed(it) && properties.iter().all(|it| is_unchanged(it, source)),
        None => true,
    };
    // A `let` or a `var` can be assigned, and in a function the name can be an outer variable's.
    declarations.first().is_some_and(|it| it.var_kind() == VarKind::Const)
        && matches!(node.parent(), Node::File(_))
        && !node.is_exported()
        && declarations.iter().all(is_written_alike)
}

fn check_variable_declaration<'a>(
    node: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
    cx: &Cx<'a, NoImportingVitestGlobals>,
) {
    let Some((properties, _)) = declarations.iter().find_map(vitest_require) else {
        return;
    };
    // Reported even if none of the names is a global.
    let report = match properties.iter().find(is_global_property) {
        Some(first_global) => {
            let report = cx.report(first_global, NO_IMPORTING_VITEST_GLOBALS).first_label(REMOVE_THIS);
            let others = properties.iter().filter(is_global_property).skip(1);
            others.fold(report, |report, it| report.label(it, REMOVE_THIS))
        }
        None => cx.report_file(NO_IMPORTING_VITEST_GLOBALS),
    };
    report.fix_where_safe(|| leaves_names_unchanged(node, declarations), |fixer| {
        let variable_modifier = match declarations.first()?.var_kind() {
            VarKind::Const => "const",
            VarKind::Let => "let",
            VarKind::Var => "var",
            _ => return None,
        };
        let mut rendered: SmallVec<[Vec<u8>; 4]> = SmallVec::new();
        for declaration in declarations {
            let Some((properties, import_source)) = vitest_require(declaration) else {
                rendered.push(declaration.text().to_vec());
                continue;
            };
            // An `export { name }` of a name that goes would be left without it.
            let is_exported = |it: PatProp<'a>| match it.value().kind() {
                PatKind::Ident(local) => !is_kept_property(&it) && is_exported_by_name(cx.file(), local),
                _ => false,
            };
            if properties.iter().any(is_exported) {
                return None;
            }
            let non_global_imports: SmallVec<[&[u8]; 8]> = properties.iter().filter(is_kept_property).map(|it| it.text()).collect();
            if !non_global_imports.is_empty() {
                let names = non_global_imports.join(b", ".as_slice());
                rendered.push([b"{ ".as_slice(), &names, b" } = require('".as_slice(), import_source.bytes(), b"')".as_slice()].concat());
            }
        }
        if rendered.is_empty() {
            // oxlint's text leaves an `export` to the next statement.
            return if node.is_exported() { None } else { fixer.remove_statement(node) };
        }
        let declarations = rendered.join(b", ".as_slice());
        let code = [variable_modifier.as_bytes(), b" ".as_slice(), &declarations, b";".as_slice()].concat();
        Some(fixer.replace(node.span_without_export(), code)).filter(|it| fixer.keeps_comments(it))
    });
}

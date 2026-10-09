use crate::jest::is_vitest_import_source;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// The rule disallows importing any Vitest global functions.
pub struct NoImportingVitestGlobals;

const NO_IMPORTING_VITEST_GLOBALS: Message = Message::new("", "Do not `import`/`require` global functions from 'vitest'.");

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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImportingVitestGlobals
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["vitest", "vite-plus/test", "@effect/vitest"]) {
            return;
        }
        on.stmts([StmtTag::Import], |_, node, cx| {
            if let StmtKind::Import(import_decl) = node.kind()
                && is_vitest_import_source(import_decl.spec().bytes())
            {
                check_import(node, import_decl, cx);
            }
        });
        if file.mentions("require") {
            on.stmts([StmtTag::Var], |_, node, cx| {
                if let StmtKind::Var(declarations) = node.kind() {
                    check_variable_declaration(node, declarations, cx);
                }
            });
        }
    }
}

fn check_import<'a>(node: Stmt<'a>, import_decl: Import<'a>, cx: &Cx<'a, NoImportingVitestGlobals>) {
    let is_global = |it: &ImportSpec| !it.is_type_only() && !it.imported().is_string() && it.local().name().is_any(&VITEST_GLOBALS);
    let Some(first_global) = import_decl.named().iter().find(is_global) else {
        return;
    };
    cx.report(first_global, NO_IMPORTING_VITEST_GLOBALS).fix(|fixer| {
        let others = usize::from(import_decl.default().is_some()) + usize::from(import_decl.namespace().is_some());
        if others == 0 && import_decl.named().iter().all(|it| is_global(&it)) {
            return Some(fixer.remove(node));
        }
        let mut import_text = Vec::new();
        // What is imported under a name that is a string is lost.
        for specifier in import_decl.named().iter().filter(|it| !is_global(it) && (it.is_type_only() || !it.imported().is_string())) {
            import_text.extend_from_slice(if import_text.is_empty() { "" } else { ", " }.as_bytes());
            import_text.extend_from_slice(specifier.text());
        }
        let start = import_decl.default().map(|it| it.span()).or_else(|| import_decl.namespace_span());
        let start = start.or_else(|| import_decl.named().first().map(ImportSpec::span))?.start;
        Some(fixer.replace(Span::new(start, import_decl.named().last()?.span().end), import_text))
    });
}

/// `{ .. } = require("vitest")`, without a rest and without a `default`: the properties and the name of the module.
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

fn check_variable_declaration<'a>(
    node: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
    cx: &Cx<'a, NoImportingVitestGlobals>,
) {
    let Some((properties, _)) = declarations.iter().find_map(vitest_require) else {
        return;
    };
    // It is reported also if none of the names is that of a global.
    let report = match properties.iter().find(is_global_property) {
        Some(first_global) => cx.report(first_global, NO_IMPORTING_VITEST_GLOBALS),
        None => cx.report_file(NO_IMPORTING_VITEST_GLOBALS),
    };
    report.fix(|fixer| {
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
            // What has a key that is computed is lost.
            let non_global_imports: SmallVec<[&[u8]; 8]> = (properties.iter())
                .filter(|it| !is_global_property(it) && it.key().is_some_and(|key| key.name().is_some()))
                .map(|it| it.text())
                .collect();
            if !non_global_imports.is_empty() {
                let names = non_global_imports.join(b", ".as_slice());
                rendered.push([b"{ ".as_slice(), &names, b" } = require('".as_slice(), import_source.bytes(), b"')".as_slice()].concat());
            }
        }
        if rendered.is_empty() {
            return Some(fixer.remove(node.span_without_export()));
        }
        let declarations = rendered.join(b", ".as_slice());
        let code = [variable_modifier.as_bytes(), b" ".as_slice(), &declarations, b";".as_slice()].concat();
        Some(fixer.replace(node.span_without_export(), code))
    });
}

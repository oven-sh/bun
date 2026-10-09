use bun_lint_oxlint::import::{ImportImportName, import_entries};
use crate::jest::{HashOrder, OxlintOrder, is_vitest_import_source, parent_expression};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxBuildHasher;
use smallvec::SmallVec;
use std::hash::BuildHasher;

/// Enforces explicit imports from 'vitest' instead of using Vitest globals.
pub struct PreferImportingVitestGlobals;

const PREFER_IMPORTING_VITEST_GLOBALS: Message = Message::new("", "Do not use Vitest global functions");

const VITEST_GLOBALS: [&str; 17] = [
    "afterAll",
    "afterEach",
    "beforeAll",
    "beforeEach",
    "bench",
    "describe",
    "expect",
    "expectTypeOf",
    "fdescribe",
    "fit",
    "it",
    "pending",
    "test",
    "vi",
    "xdescribe",
    "xit",
    "xtest",
];

impl Rule for PreferImportingVitestGlobals {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-importing-vitest-globals", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferImportingVitestGlobals
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions_any(&VITEST_GLOBALS) {
            on.finish(|_, cx| run_once(cx));
        }
    }
}

fn run_once<'a>(cx: &Cx<'a, PreferImportingVitestGlobals>) {
    let file = cx.file();
    // What nothing declares, in the order in which oxlint has it. References in types count too.
    let mut missing_globals: SmallVec<[&str; 8]> = (VITEST_GLOBALS.into_iter())
        .filter(|name| file.mentions(name) && file.unresolved_references_to(name.as_bytes()).len() > 0)
        .collect();
    if missing_globals.len() > 1 {
        let order = OxlintOrder::new(file);
        utils::sort::sort_by_cached_key(&mut missing_globals, |name| order.rank(file.name_of(name)));
    }
    // The first label.
    let mut first_span: Option<Span> = None;
    for name in &missing_globals {
        for reference in file.unresolved_references_to(name.as_bytes()) {
            // What is called, also where it is an argument.
            if let Some(call_expr) = reference.expr().and_then(parent_expression).and_then(Expr::as_call) {
                first_span.get_or_insert_with(|| call_expr.callee().outer_span());
            }
        }
    }
    // What is imported from elsewhere, or as a type.
    for name in VITEST_GLOBALS.into_iter().filter(|name| file.mentions(name)) {
        if let Some(symbol) = file.top_level_scope().get(name)
            && let Some(import) = symbol.declarations().next().and_then(|it| match it {
                Declaration::ImportSpec(specifier) => Some(specifier.import()),
                Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) => Some(import),
                _ => None,
            })
            && (!is_vitest_import_source(import.spec().bytes()) || import.is_type_only())
        {
            for reference in symbol.references().filter_map(Reference::expr) {
                let is_callee = |it: &Expr<'a>| it.as_call().is_some_and(|it| it.callee() == reference);
                if let Some(call) = parent_expression(reference).filter(is_callee) {
                    first_span.get_or_insert_with(|| call.span());
                    if !missing_globals.contains(&name) {
                        missing_globals.push(name);
                    }
                }
            }
        }
    }
    if missing_globals.is_empty() {
        return;
    }
    let report = match first_span {
        Some(span) => cx.report(span, PREFER_IMPORTING_VITEST_GLOBALS),
        None => cx.report_file(PREFER_IMPORTING_VITEST_GLOBALS),
    };
    report.fix(|fixer| {
        // oxlint prints them in the order of an `FxHashSet`.
        let mut table = HashOrder::new();
        missing_globals.iter().for_each(|name| table.insert(FxBuildHasher.hash_one(*name), *name));
        let names: SmallVec<[&str; 8]> = table.iter().collect();
        build_fix(file, &names.join(", "), fixer)
    });
}

/// The calls of the global `require` with one argument, which is a string that names Vitest.
fn vitest_requires<'a>(file: &'a File<'a>) -> impl Iterator<Item = (Expr<'a>, Name<'a>)> {
    file.unresolved_references_to(b"require").filter_map(Reference::expr).filter_map(|reference| {
        let call = parent_expression(reference)?;
        let arguments = call.as_call()?.args();
        let source = arguments.first().filter(|it| arguments.len() == 1 && !it.is_parenthesized())?.as_string()?;
        is_vitest_import_source(source.bytes()).then_some((call, source))
    })
}

fn build_fix<'a>(file: &'a File<'a>, globals_imports: &str, fixer: Fixer<'a>) -> Fix {
    let vitest_esm_import =
        import_entries(file).find(|it| is_vitest_import_source(it.declaration.spec().bytes()) && !it.is_type());
    match vitest_esm_import.map(|it| (it, it.import_name)) {
        // `import { .. } from "vitest"`: after the last name.
        Some((entry, ImportImportName::Name(_))) => {
            let statement_span = entry.declaration.stmt().span();
            let mut source = file.slice(statement_span);
            while let Some(close_brace_pos) = strings::last_index_of_char(source, b'}') {
                source = source.get(..close_brace_pos).unwrap_or_default();
                if file.comment_around(statement_span.start + close_brace_pos as u32).is_some() {
                    continue;
                }
                let trimmed = trim_end(source);
                let comma = if trimmed.ends_with(b",") { "" } else { "," };
                let replaced = Span::new(statement_span.start + trimmed.len() as u32, statement_span.start + close_brace_pos as u32 + 1);
                return fixer.replace(replaced, format!("{comma} {globals_imports} }}"));
            }
        }
        // `import vitest from "vitest"`
        Some((_, ImportImportName::Default(local))) => return fixer.insert_after(local.span(), format!(", {{ {globals_imports} }}")),
        _ => {}
    }
    // `const { .. } = require("vitest")`
    for (call, _) in vitest_requires(file) {
        let Some(declarator) = Node::Expr(call).ancestors().find_map(|it| match it {
            Node::VarDecl(declarator) => Some(declarator),
            _ => None,
        }) else {
            break;
        };
        let PatKind::Object(properties) = declarator.pat().kind() else {
            continue;
        };
        let mut text = b"{ ".to_vec();
        for property in properties.iter().filter(|it| !it.is_rest()) {
            text.extend_from_slice(property.text());
            text.extend_from_slice(b", ");
        }
        text.extend_from_slice(globals_imports.as_bytes());
        if let Some(rest) = properties.iter().find(|it| it.is_rest()) {
            text.extend_from_slice(b", ");
            text.extend_from_slice(rest.text());
        }
        text.extend_from_slice(b" }");
        return fixer.replace(declarator.pat(), text);
    }
    let import_source = (vitest_esm_import.map(|it| it.declaration.spec())).or_else(|| vitest_requires(file).next().map(|it| it.1));
    let import_source = import_source.map_or(b"vitest".as_slice(), Name::bytes);
    let text = [b"import { ".as_slice(), globals_imports.as_bytes(), b" } from '".as_slice(), import_source, b"';\n".as_slice()];
    fixer.insert_before(Span::empty(0), text.concat())
}

/// `str::trim_end`
fn trim_end(text: &[u8]) -> &[u8] {
    std::str::from_utf8(text).map_or(text, |it| it.trim_end().as_bytes())
}

use crate::jest::{self, OxlintOrder, is_vitest_import_source, parent_expression};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::hash_order::HashOrder;
use bun_lint_oxlint::import::{ImportEntry, ImportImportName, import_entries};
use rustc_hash::FxBuildHasher;
use smallvec::SmallVec;
use std::cell::OnceCell;
use std::hash::BuildHasher;

/// Enforces explicit imports from 'vitest' instead of using Vitest globals.
pub struct PreferImportingVitestGlobals;

const VITEST_GLOBAL_BITS: [u32; 17] = jest::mention_bits(VITEST_GLOBALS);

const PREFER_IMPORTING_VITEST_GLOBALS: &Message =
    &Message::new("", "Do not use Vitest global functions");

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
    const META: Meta = Meta::oxlint(
        Plugin::Vitest,
        "prefer-importing-vitest-globals",
        Kind::Suggestion,
    )
    .fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferImportingVitestGlobals
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::mentions_any(file, &VITEST_GLOBAL_BITS).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        run_once(cx);
    }
}

fn run_once(cx: &Cx<'_, PreferImportingVitestGlobals>) {
    let file = cx.file();
    // The undeclared globals, in oxlint's order. References in types count too.
    // oxlint also reports a name that's imported from another package, and its fix declares it twice.
    let mut missing_globals: SmallVec<[&str; 8]> = VITEST_GLOBALS
        .into_iter()
        .zip(VITEST_GLOBAL_BITS)
        .filter(|it| file.mentions_bit(it.1))
        .map(|it| it.0)
        .filter(|name| file.unresolved_references_to(name.as_bytes()).len() > 0)
        .collect();
    if missing_globals.is_empty() {
        return;
    }
    if missing_globals.len() > 1 {
        let order = OxlintOrder::new(file);
        utils::sort::sort_by_cached_key(&mut missing_globals, |name| {
            order.rank(file.name_of(name))
        });
    }
    let mut globals_spans: Vec<Span> = Vec::new();
    for name in &missing_globals {
        for reference in file.unresolved_references_to(name.as_bytes()) {
            // Labels the callee, even if the reference is one of the call's arguments.
            if let Some(call_expr) = reference
                .expr()
                .and_then(parent_expression)
                .and_then(Expr::as_call)
            {
                globals_spans.push(call_expr.callee().outer_span());
            }
        }
    }
    const ADD_THIS: &str = "Add this global vitest import";
    let report = match globals_spans.split_first() {
        Some((first, others)) => {
            let report = cx
                .report(*first, PREFER_IMPORTING_VITEST_GLOBALS)
                .first_label(ADD_THIS);
            others
                .iter()
                .fold(report, |report, span| report.label(*span, ADD_THIS))
        }
        None => cx.report_file(PREFER_IMPORTING_VITEST_GLOBALS),
    };
    let globals_imports = || {
        // oxlint prints them in the order of an `FxHashSet`.
        let mut table = HashOrder::new();
        missing_globals
            .iter()
            .for_each(|name| table.insert(FxBuildHasher.hash_one(*name), *name));
        let names: SmallVec<[&str; 8]> = table.iter().collect();
        names.join(", ")
    };
    let target = OnceCell::new();
    let target = || *target.get_or_init(|| Target::of(file));
    report
        .help_with(|| {
            let globals_founds = globals_imports();
            format!("Import global functions `{globals_founds}` from `vitest` package instead of using globals.")
        })
        .fix_where_safe(
            || is_safe(file, &missing_globals, target()),
            |fixer| build_fix(file, &globals_imports(), fixer, target()),
        );
}

/// Calls to the global `require` whose only argument is a string naming Vitest.
fn vitest_requires<'a>(file: &'a File<'a>) -> impl Iterator<Item = (Expr<'a>, Name<'a>)> {
    file.unresolved_references_to(b"require")
        .filter_map(Reference::expr)
        .filter_map(|reference| {
            let call = parent_expression(reference)?;
            let arguments = call.as_call()?.args();
            let source = arguments
                .first()
                .filter(|it| arguments.len() == 1 && !it.is_parenthesized())?
                .as_string()?;
            is_vitest_import_source(source.bytes()).then_some((call, source))
        })
}

/// The first import from Vitest that isn't a type import.
fn vitest_import<'a>(file: &'a File<'a>) -> Option<ImportEntry<'a>> {
    import_entries(file)
        .find(|it| is_vitest_import_source(it.declaration.spec().bytes()) && !it.is_type())
}

/// True if the fix adds the names to `import`, an `import` statement that the file has.
fn adds_to_import(import: Option<ImportEntry<'_>>) -> bool {
    let kind = import.map(|it| it.import_name);
    matches!(kind, Some(ImportImportName::Name(_) | ImportImportName::Default(_)))
}

/// The declarator of the `const { .. } = require("vitest")` that the fix adds the names to if the file has no `import` for them, and its `{ .. }`.
fn required_pattern<'a>(file: &'a File<'a>) -> Option<(VarDecl<'a>, List<'a, PatProp<'a>>)> {
    for (call, _) in vitest_requires(file) {
        let declarator = Node::Expr(call).ancestors().find_map(|it| match it {
            Node::VarDecl(declarator) => Some(declarator),
            _ => None,
        })?;
        if let PatKind::Object(properties) = declarator.pat().kind() {
            return Some((declarator, properties));
        }
    }
    None
}

/// Where the fix writes the names. It keeps what is there.
#[derive(Copy, Clone)]
enum Target<'a> {
    /// An `import` from Vitest that [has names or a default](adds_to_import).
    Import(ImportEntry<'a>),
    /// [`required_pattern`]
    Require(VarDecl<'a>, List<'a, PatProp<'a>>),
    /// A new `import` as the first statement.
    Insert,
}

impl<'a> Target<'a> {
    fn of(file: &'a File<'a>) -> Self {
        match vitest_import(file).filter(|it| adds_to_import(Some(*it))) {
            Some(import) => Target::Import(import),
            None => required_pattern(file)
                .map_or(Target::Insert, |it| Target::Require(it.0, it.1)),
        }
    }
}

/// False if the fix can change what the file does: the file assigns to one of the names, or code of the file can run before the names have their values.
#[cold]
fn is_safe<'a>(file: &'a File<'a>, missing_globals: &[&str], target: Target<'a>) -> bool {
    if jest::assigns_to_global(file, missing_globals.iter().map(|it| it.as_bytes())) {
        return false;
    }
    match target {
        // An `import` below another one has its names once its module has run.
        Target::Import(_) => !jest::opens_early(file),
        Target::Require(declarator, _) => jest::takes_names(file, declarator),
        // A new first `import` has its names before all other code of the file.
        Target::Insert => true,
    }
}

fn build_fix<'a>(
    file: &'a File<'a>,
    globals_imports: &str,
    fixer: Fixer<'a>,
    target: Target<'a>,
) -> Fix {
    match target {
        Target::Import(entry) => match entry.import_name {
            // `import vitest from "vitest"`
            ImportImportName::Default(local) => {
                return fixer.insert_after(local.span(), format!(", {{ {globals_imports} }}"));
            }
            // `import { .. } from "vitest"`: insert after the last name.
            _ => {
                let statement_span = entry.declaration.stmt().span();
                let mut source = file.slice(statement_span);
                while let Some(close_brace_pos) = strings::last_index_of_char(source, b'}') {
                    source = source.get(..close_brace_pos).unwrap_or_default();
                    if file
                        .comment_containing(statement_span.start + close_brace_pos as u32)
                        .is_some()
                    {
                        continue;
                    }
                    let trimmed = strings::trim_unicode_whitespace_end(source);
                    let comma = if trimmed.ends_with(b",") { "" } else { "," };
                    let replaced = Span::new(
                        statement_span.start + trimmed.len() as u32,
                        statement_span.start + close_brace_pos as u32 + 1,
                    );
                    return fixer.replace(replaced, format!("{comma} {globals_imports} }}"));
                }
            }
        },
        // `const { .. } = require("vitest")`
        Target::Require(declarator, properties) => {
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
        Target::Insert => {}
    }
    let import_source = (vitest_import(file).map(|it| it.declaration.spec()))
        .or_else(|| vitest_requires(file).next().map(|it| it.1));
    let import_source = import_source.map_or(b"vitest".as_slice(), Name::bytes);
    let text = [
        b"import { ".as_slice(),
        globals_imports.as_bytes(),
        b" } from '".as_slice(),
        import_source,
        b"';".as_slice(),
    ];
    // oxlint inserts it on the first line, above `// @ts-nocheck` and `"use strict"`.
    fixer.insert_first_statement(&text.concat())
}

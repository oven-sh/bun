use crate::jest::{
    self, JestFnKind, JestGeneralFnKind, OxlintOrder, ParsedJestFnCall, parent_expression,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::bun_test;
use bun_lint::utils::oxlint::source_type;
use bun_lint_oxlint::import::{ImportEntry, ImportImportName, import_entries, import_entries_of};
use smallvec::SmallVec;
use std::collections::BTreeSet;

/// Prefer importing Jest globals from `@jest/globals` rather than relying on ambient globals.
pub struct PreferImportingJestGlobals {
    /// One flag each for `hook`, `describe`, `test`, `expect`, `jest` and `unknown`.
    types: [bool; 6],
}

const PREFER_IMPORTING_JEST_GLOBALS: &Message = &Message::new(
    "",
    "Import the following Jest functions from `@jest/globals`: {{globals}}",
);

const IMPORT_SOURCE: &str = "@jest/globals";

impl Rule for PreferImportingJestGlobals {
    const META: Meta = Meta::oxlint(
        Plugin::Jest,
        "prefer-importing-jest-globals",
        Kind::Suggestion,
    )
    .fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let types = config.strings("types");
        PreferImportingJestGlobals {
            types: ["hook", "describe", "test", "expect", "jest", "unknown"]
                .map(|it| !config.has("types") || types.contains(&it)),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.run_once(cx);
    }
}

type Names = BTreeSet<Vec<u8>>;

impl PreferImportingJestGlobals {
    fn run_once<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let mut functions_to_import = Names::new();
        let mut found = Vec::new();
        for jest_node in jest::iter_possible_jest_call_node(file, jest::Runner::Jest).filter(|it| it.original.is_none())
        {
            let Some(jest_fn_call) = jest::parse_jest_fn_call(file, jest_node) else {
                continue;
            };
            let fn_type = match jest_fn_call.kind() {
                JestFnKind::General(JestGeneralFnKind::Hook) => 0,
                JestFnKind::General(JestGeneralFnKind::Describe) => 1,
                JestFnKind::General(JestGeneralFnKind::Test) => 2,
                JestFnKind::Expect | JestFnKind::ExpectTypeOf => 3,
                JestFnKind::General(JestGeneralFnKind::Jest | JestGeneralFnKind::Vitest) => 4,
                JestFnKind::Unknown => 5,
                _ => continue,
            };
            if self.types.get(fn_type) != Some(&true) {
                continue;
            }
            let name = match &jest_fn_call {
                ParsedJestFnCall::GeneralJest(c) | ParsedJestFnCall::Fixture(c) => c.name,
                ParsedJestFnCall::Expect(c) | ParsedJestFnCall::ExpectTypeOf(c) => c.name,
            };
            if !functions_to_import.contains(name) {
                functions_to_import.insert(name.to_vec());
            }
            found.push(jest_node);
        }
        // Report the first one in oxlint's order.
        let Some(span) = OxlintOrder::first(file, &found)
            .and_then(|it| it.node.callee())
            .map(Expr::outer_span)
        else {
            return;
        };
        let is_added = |it: &&str| functions_to_import.contains(it.as_bytes());
        let added: SmallVec<[&str; 3]> = bun_test::MOCK_APIS.into_iter().filter(is_added).collect();
        (cx.report(span, PREFER_IMPORTING_JEST_GLOBALS)
            .data("globals", join(&functions_to_import)))
        .fix_where_safe(
            || !changes_module_mock_calls(file, &added),
            |fixer| build_fix(file, fixer, functions_to_import),
        );
    }
}

fn join(names: &Names) -> Vec<u8> {
    names
        .iter()
        .map(Vec::as_slice)
        .collect::<Vec<_>>()
        .join(b", ".as_slice())
}

/// oxlint's `ctx.source_type().is_module()`.
fn is_module<'a>(file: &'a File<'a>) -> bool {
    source_type(file) == SourceType::Module
}

fn create_import_text(is_module: bool, functions: &Names) -> Vec<u8> {
    let (start, end) = if is_module {
        ("import { ", " } from '@jest/globals';")
    } else {
        ("const { ", " } = require('@jest/globals');")
    };
    [start.as_bytes(), &join(functions), end.as_bytes()].concat()
}

/// The first `import .. from "@jest/globals"` that isn't a type import.
fn jest_import<'a>(file: &'a File<'a>) -> Option<ImportEntry<'a>> {
    import_entries(file).find(|it| it.declaration.spec().is(IMPORT_SOURCE) && !it.is_type())
}

/// The declarator of the first `.. = require("@jest/globals")`.
fn jest_require<'a>(file: &'a File<'a>) -> Option<VarDecl<'a>> {
    let mut requires = file
        .unresolved_references_to(b"require")
        .filter_map(Reference::expr);
    requires.find_map(|reference| {
        let call_node = parent_expression(reference)?;
        let arguments = call_node.as_call().map(Call::args);
        let is_jest_require = arguments
            .filter(|it| it.len() == 1)
            .and_then(List::first)
            .is_some_and(|it| {
                !it.is_parenthesized()
                    && match it.kind() {
                        ExprKind::String(value) => value.is(IMPORT_SOURCE),
                        ExprKind::Template(template) => {
                            template.exprs().is_empty()
                                && template.raw(0) == IMPORT_SOURCE.as_bytes()
                        }
                        _ => false,
                    }
            });
        let declarator = Node::Expr(call_node).ancestors().find_map(|it| match it {
            Node::VarDecl(declarator) => Some(declarator),
            _ => None,
        });
        declarator.filter(|_| is_jest_require)
    })
}

/// The properties of `const { .. } = require("@jest/globals")` that the fix keeps: the key, the name that it binds, the pattern.
fn kept_properties<'a>(
    declarator: VarDecl<'a>,
) -> impl Iterator<Item = (Name<'a>, Name<'a>, Pat<'a>)> {
    let properties = match declarator.pat().kind() {
        PatKind::Object(properties) => Some(properties),
        _ => None,
    };
    let kept = properties.into_iter().flat_map(|it| it.iter());
    kept.filter(|it| !it.is_rest() && it.default().is_none())
        .filter_map(|it| {
            let key = it.key().filter(|it| !it.is_computed())?.name()?;
            Some((key, it.value().as_ident()?, it.value()))
        })
}

/// The statement of `declarator`, which the fix replaces.
fn declaration_of(declarator: VarDecl<'_>) -> Node<'_> {
    Node::VarDecl(declarator).parent()
}

/// True if the fix changes what `bun test` does with a call on `jest` or `vi`: see [`bun_test`]. `added`: those globals that the fix imports.
#[cold]
fn changes_module_mock_calls<'a>(file: &'a File<'a>, added: &[&str]) -> bool {
    if let Some(first) = jest_import(file) {
        // `bun test` treats a global and a named import alike. A default import becomes a named one, a namespace's name a global.
        let scope = || Node::Stmt(first.declaration.stmt()).scope();
        return import_entries_of(first.declaration).any(|it| match it.import_name {
            ImportImportName::Name(_) => false,
            ImportImportName::Default(local) | ImportImportName::NamespaceObject(local) => {
                bun_test::is_mock_api(local.bytes())
                    && (scope().get_name(local.name())).is_some_and(bun_test::changes_as_global)
            }
        });
    }
    let is_module = is_module(file);
    let Some(declarator) = jest_require(file) else {
        // A global becomes a named import, or a name from `require()` in the first statement.
        return !is_module && bun_test::changes_once_required(file, added);
    };
    let is_kept = |symbol: Symbol<'a>| {
        kept_properties(declarator).any(|(_, _, value)| value.symbol() == Some(symbol))
    };
    // In a module, the names from `require()` that the fix keeps become named imports.
    let mut imported = kept_properties(declarator).filter(|(key, _, _)| {
        is_module && bun_test::is_known_import(IMPORT_SOURCE.as_bytes(), key.bytes())
    });
    imported.any(|(key, _, value)| {
        let calls = value.symbol().map(Symbol::references);
        calls.is_some_and(|it| bun_test::has_module_mock_call(it, key.bytes()))
    })
        // Otherwise a global becomes a name from `require()`.
        || (!is_module && added.iter().any(|it| bun_test::global_has_module_mock_call(file, it.as_bytes())))
        // A name that the fix doesn't keep becomes a global.
        || (declaration_of(declarator).declared_symbols().into_iter())
            .any(|it| !is_kept(it) && bun_test::changes_as_global(it))
}

fn build_fix<'a>(file: &'a File<'a>, fixer: Fixer<'a>, mut functions_to_import: Names) -> Fix {
    let is_module = is_module(file);
    // Merge into the first `import .. from "@jest/globals"`.
    if let Some(first) = jest_import(file) {
        for entry in import_entries_of(first.declaration).filter(|it| !it.is_type()) {
            let local = entry.local_name().bytes();
            match entry.import_name {
                ImportImportName::Name(specifier) => {
                    let imported = file.slice(specifier.imported().span());
                    functions_to_import.insert(match imported == local {
                        true => local.to_vec(),
                        false => [imported, b" as ".as_slice(), local].concat(),
                    });
                }
                ImportImportName::Default(_) => {
                    functions_to_import.insert(local.to_vec());
                }
                ImportImportName::NamespaceObject(_) => {}
            }
        }
        return fixer.replace(
            first.declaration.stmt(),
            create_import_text(true, &functions_to_import),
        );
    }
    // Merge into the first `const { .. } = require("@jest/globals")`.
    if let Some(declarator) = jest_require(file) {
        let alias_sep = if is_module { " as " } else { ": " };
        for (key_name, value_name, _) in kept_properties(declarator) {
            functions_to_import.insert(match key_name == value_name {
                true => key_name.bytes().to_vec(),
                false => [key_name.bytes(), alias_sep.as_bytes(), value_name.bytes()].concat(),
            });
        }
        let declaration = match declaration_of(declarator) {
            Node::Stmt(statement) => statement.span_without_export(),
            parent => parent.span(),
        };
        return fixer.replace(
            declaration,
            create_import_text(is_module, &functions_to_import),
        );
    }
    // oxlint only skips the `#!` line and the directives, so it inserts the import above `// @ts-nocheck`.
    fixer.insert_first_statement(&create_import_text(is_module, &functions_to_import))
}

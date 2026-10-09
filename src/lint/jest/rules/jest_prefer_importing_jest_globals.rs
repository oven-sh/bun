use bun_lint_oxlint::import::{ImportImportName, has_module_syntax, import_entries, import_entries_of};
use crate::jest::{self, JestFnKind, JestGeneralFnKind, OxlintOrder, ParsedJestFnCall, parent_expression};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::collections::BTreeSet;

/// Prefer importing Jest globals from `@jest/globals` rather than relying on ambient globals.
pub struct PreferImportingJestGlobals {
    /// For `hook`, `describe`, `test`, `expect`, `jest` and `unknown`.
    types: [bool; 6],
}

const PREFER_IMPORTING_JEST_GLOBALS: Message =
    Message::new("", "Import the following Jest functions from `@jest/globals`: {{globals}}");

const IMPORT_SOURCE: &str = "@jest/globals";

impl Rule for PreferImportingJestGlobals {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-importing-jest-globals", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let types = config.strings("types");
        PreferImportingJestGlobals {
            types: ["hook", "describe", "test", "expect", "jest", "unknown"].map(|it| !config.has("types") || types.contains(&it)),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|rule, cx| rule.run_once(cx));
        }
    }
}

type Names = BTreeSet<Vec<u8>>;

impl PreferImportingJestGlobals {
    fn run_once<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let mut functions_to_import = Names::new();
        let mut found = Vec::new();
        for jest_node in jest::iter_possible_jest_call_node(file).filter(|it| it.original.is_none()) {
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
            functions_to_import.insert(name.to_vec());
            found.push(jest_node);
        }
        if found.is_empty() {
            return;
        }
        // The first of oxlint's list is reported.
        let order = OxlintOrder::new(file);
        let Some(span) = found.iter().min_by_key(|it| order.key(**it)).and_then(|it| it.node.callee()).map(Expr::outer_span) else {
            return;
        };
        (cx.report(span, PREFER_IMPORTING_JEST_GLOBALS).data("globals", join(&functions_to_import)))
            .fix(|fixer| build_fix(file, fixer, functions_to_import));
    }
}

fn join(names: &Names) -> Vec<u8> {
    names.iter().map(Vec::as_slice).collect::<Vec<_>>().join(b", ".as_slice())
}

/// `ctx.source_type().is_module()`: by the extension, or else by what the file consists of.
fn is_module<'a>(file: &'a File<'a>) -> bool {
    match strings::rsplit_once_char(file.path(), b'.').map(|it| it.1) {
        Some(b"mjs" | b"mts") => true,
        Some(b"cjs" | b"cts") => false,
        _ => has_module_syntax(file),
    }
}

fn create_import_text(is_module: bool, functions: &Names) -> Vec<u8> {
    let (start, end) = if is_module { ("import { ", " } from '@jest/globals';") } else { ("const { ", " } = require('@jest/globals');") };
    [start.as_bytes(), &join(functions), end.as_bytes()].concat()
}

fn build_fix<'a>(file: &'a File<'a>, fixer: Fixer<'a>, mut functions_to_import: Names) -> Fix {
    let is_module = is_module(file);
    // With the first `import .. from "@jest/globals"`.
    if let Some(first) = import_entries(file).find(|it| it.declaration.spec().is(IMPORT_SOURCE) && !it.is_type()) {
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
        return fixer.replace(first.declaration.stmt(), create_import_text(true, &functions_to_import));
    }
    // With the first `const { .. } = require("@jest/globals")`.
    for reference in file.unresolved_references_to(b"require").filter_map(Reference::expr) {
        let Some(call_node) = parent_expression(reference) else {
            continue;
        };
        let arguments = call_node.as_call().map(Call::args);
        let is_jest_require = arguments.filter(|it| it.len() == 1).and_then(List::first).is_some_and(|it| {
            !it.is_parenthesized()
                && match it.kind() {
                    ExprKind::String(value) => value.is(IMPORT_SOURCE),
                    ExprKind::Template(template) => template.exprs().is_empty() && template.raw(0) == IMPORT_SOURCE.as_bytes(),
                    _ => false,
                }
        });
        let declarator = Node::Expr(call_node).ancestors().find_map(|it| match it {
            Node::VarDecl(declarator) => Some(declarator),
            _ => None,
        });
        let Some(declarator) = declarator.filter(|_| is_jest_require) else {
            continue;
        };
        if let PatKind::Object(properties) = declarator.pat().kind() {
            for prop in properties.iter().filter(|it| !it.is_rest() && it.default().is_none()) {
                if let Some(key_name) = prop.key().filter(|it| !it.is_computed()).and_then(|it| it.name())
                    && let Some(value_name) = prop.value().as_ident()
                {
                    let alias_sep = if is_module { " as " } else { ": " };
                    functions_to_import.insert(match key_name == value_name {
                        true => key_name.bytes().to_vec(),
                        false => [key_name.bytes(), alias_sep.as_bytes(), value_name.bytes()].concat(),
                    });
                }
            }
        }
        let declaration = match Node::VarDecl(declarator).parent() {
            Node::Stmt(statement) => statement.span_without_export(),
            parent => parent.span(),
        };
        return fixer.replace(declaration, create_import_text(is_module, &functions_to_import));
    }
    let text = create_import_text(is_module, &functions_to_import);
    if let Some(directive) = file.body().iter().take_while(|it| it.directive().is_some()).last() {
        return fixer.insert_after(directive, [b"\n".as_slice(), &text].concat());
    }
    if file.text().starts_with(b"#!") {
        let hashbang_end = strings::index_of_any(file.text(), b"\r\n").unwrap_or_else(|| file.text().len());
        return fixer.insert_after(Span::empty(hashbang_end as u32), [b"\n".as_slice(), &text].concat());
    }
    fixer.insert_before(Span::empty(0), [text.as_slice(), b"\n".as_slice()].concat())
}

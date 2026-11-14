use crate::jest::{
    self, JestFnKind, JestGeneralFnKind, OxlintOrder, ParsedJestFnCall, parent_expression,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::oxlint::source_type;
use bun_lint_oxlint::import::{
    ImportEntry, ImportImportName, import_entries, import_entries_of, is_require_call,
};
use std::borrow::Cow;
use std::cell::OnceCell;
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
        let target = OnceCell::new();
        let target = || *target.get_or_init(|| Target::of(file));
        (cx.report(span, PREFER_IMPORTING_JEST_GLOBALS)
            .data("globals", join(&functions_to_import)))
        .fix_where_safe(
            || is_safe(file, &functions_to_import, target()),
            |fixer| build_fix(file, fixer, &functions_to_import, target()),
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

/// Where the fix writes the names. It reprints the statement that it finds there.
#[derive(Copy, Clone)]
enum Target<'a> {
    /// [`jest_import`]
    Import(ImportEntry<'a>),
    /// [`jest_require`]. In a module the statement becomes an `import`.
    Require(VarDecl<'a>),
    /// A new first statement.
    Insert,
}

impl<'a> Target<'a> {
    fn of(file: &'a File<'a>) -> Self {
        match jest_import(file) {
            Some(first) => Target::Import(first),
            None => jest_require(file).map_or(Target::Insert, Target::Require),
        }
    }

    /// True if the new text has all that the statement has: an `import` of named values only, or a top-level `const` of only `{ key, key: name }` from the `require()` call itself. No attributes, no comment.
    fn keeps_statement(self, file: &'a File<'a>) -> bool {
        let statement = match self {
            Target::Import(first) => {
                let import = first.declaration;
                let is_named = |it: ImportEntry<'a>| {
                    matches!(it.import_name, ImportImportName::Name(_)) && !it.is_type()
                };
                if !import_entries_of(import).all(is_named) || import.attributes().is_some() {
                    return false;
                }
                import.stmt()
            }
            Target::Require(declarator) => {
                let Node::Stmt(statement) = Node::VarDecl(declarator).parent() else {
                    return false;
                };
                let PatKind::Object(properties) = declarator.pat().kind() else {
                    return false;
                };
                let is_only_const = declarator.var_kind() == VarKind::Const
                    && statement.as_var().is_some_and(|it| it.len() == 1)
                    && !statement.is_exported()
                    && matches!(statement.parent(), Node::File(_));
                let is_module_itself = (declarator.init().and_then(Expr::as_call))
                    .is_some_and(|it| is_require_call(it) && !it.callee().is_parenthesized());
                if !is_only_const
                    || !is_module_itself
                    || kept_properties(declarator).count() != properties.len()
                {
                    return false;
                }
                statement
            }
            Target::Insert => return true,
        };
        file.comments_in(statement.span()).next().is_none()
    }
}

/// False if the fix can change what the file does: the new text drops something, the file assigns to one of the names, or code of the file can run before the names have their values.
#[cold]
fn is_safe<'a>(file: &'a File<'a>, functions_to_import: &Names, target: Target<'a>) -> bool {
    let assigns = jest::assigns_to_global(file, functions_to_import.iter().map(Vec::as_slice));
    if assigns || !target.keeps_statement(file) {
        return false;
    }
    match target {
        // A `require()` line of a script gets the names when it runs.
        Target::Require(declarator) if !is_module(file) => jest::takes_names(file, declarator),
        // A new first statement has its names before all other code of the file.
        Target::Insert if is_module(file) => true,
        // An `import` below another one has its names once its module has run, and so has a new first `require()` line.
        Target::Import(_) | Target::Require(_) | Target::Insert => !jest::opens_early(file),
    }
}

fn build_fix<'a>(
    file: &'a File<'a>,
    fixer: Fixer<'a>,
    functions_to_import: &Names,
    target: Target<'a>,
) -> Fix {
    let mut functions_to_import = Cow::Borrowed(functions_to_import);
    let is_module = is_module(file);
    match target {
        Target::Import(first) => {
            for entry in import_entries_of(first.declaration).filter(|it| !it.is_type()) {
                let local = entry.local_name().bytes();
                match entry.import_name {
                    ImportImportName::Name(specifier) => {
                        let imported = file.slice(specifier.imported().span());
                        functions_to_import.to_mut().insert(match imported == local {
                            true => local.to_vec(),
                            false => [imported, b" as ".as_slice(), local].concat(),
                        });
                    }
                    ImportImportName::Default(_) => {
                        functions_to_import.to_mut().insert(local.to_vec());
                    }
                    ImportImportName::NamespaceObject(_) => {}
                }
            }
            fixer.replace(
                first.declaration.stmt(),
                create_import_text(true, &functions_to_import),
            )
        }
        Target::Require(declarator) => {
            let alias_sep = if is_module { " as " } else { ": " };
            for (key_name, value_name, _) in kept_properties(declarator) {
                functions_to_import.to_mut().insert(match key_name == value_name {
                    true => key_name.bytes().to_vec(),
                    false => [key_name.bytes(), alias_sep.as_bytes(), value_name.bytes()].concat(),
                });
            }
            let declaration = match Node::VarDecl(declarator).parent() {
                Node::Stmt(statement) => statement.span_without_export(),
                parent => parent.span(),
            };
            fixer.replace(
                declaration,
                create_import_text(is_module, &functions_to_import),
            )
        }
        // oxlint only skips the `#!` line and the directives, so it inserts the import above `// @ts-nocheck`.
        Target::Insert => fixer
            .insert_first_statement(&create_import_text(is_module, &functions_to_import)),
    }
}

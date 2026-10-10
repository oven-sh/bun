//! `bun-lint types ..`: the linter with types.
//!
//! - `bun-lint types dump <file> [--project=tsconfig.json] [--symbols] [--ts-nodes] [--profiles]`: the type (and
//!   the symbol) at every expression, pattern and type of a file, or at every node of TypeScript's
//!   tree, or what many functions of the checker say about the type of every expression, as JSON
//!   lines, to compare with TypeScript's.
//! - `bun-lint types dump-fixtures <fixtures> [--rule=r] [--out=file] [--ts-nodes] [--profiles] [--every-case]`:
//!   the same for the code of every type-aware test case, or of every test case.
//! - `bun-lint types run <rule> <file> [options as JSON] [--project=tsconfig.json]`: what one rule
//!   reports for one file of a project.
//! - `bun-lint types conformance <fixtures> [--all] [--rule=r] [--report=dir] [--verbose] [--jobs=n]`:
//!   runs the type-aware test cases of typescript-eslint. `--all`: every test case of ESLint and of
//!   typescript-eslint as a file of a checked program, which is how all rules run when some rule
//!   needs types. What fails there and not in `bun-lint conformance` is counted as failed.
//!
//! - `bun-lint types bench <tsconfig.json> [--threads=n] [--rules=a,b]`: what types cost.
//! - `bun-lint types smoke <directory> [--jobs=n]`: which files make a query panic.
//! - `bun-lint types time <files..> [--threads=n] [--rules=a,b]`: how long these files take.
//! - `bun-lint types typescript-tests ..`: TypeScript's own tests, as `bun check
//!   --run-typescript-tests` runs them (test/cli/check/typescript-go/conformance.ts). The types and
//!   the symbols that they compare are those that the linter is given.
//!
//! `BUN_SEMA_TS_LIB`: the directory of TypeScript's `lib.*.d.ts`. `BUN_LINT_TYPE_ROOTS`: the
//! `node_modules/@types` that the fixture project finds `node` and `react` in.
//! `BUN_LINT_FIXTURE_PROJECT`: `packages/eslint-plugin/tests/fixtures` of a checkout of
//! typescript-eslint, which is what `fixtures/typescript-eslint-project` is a copy of, where the few
//! cases that import a package find it.

use crate::host::{self, output, output_line};
use crate::{str_of, text};
use bun_lint::ast::{File, Node};
use bun_lint::language::LanguageOptions;
use bun_lint::linter::{LintOptions, Registry, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_lint::types::{
    ObjectFlags, SymbolFlags, SyntaxKind, TsNode, TsSymbol, Type, TypeFlags, tsutils, utils,
};
use bun_lint_conformance::{Counts, Outcome, Tally, config_of, expected_messages, problem_of};
use bun_sema::program::FileId;
use bun_threading::Guarded;
use std::fmt::Write as _;

/// A program to check, and the files of it to lint.
pub(crate) struct Project<'a> {
    /// The working directory.
    pub(crate) cwd: &'a str,
    /// The `tsconfig.json`.
    pub(crate) config: Option<&'a str>,
    /// The files to lint, as absolute paths. Empty: all the files of the project that are not
    /// declaration files and not in `node_modules`.
    pub(crate) files: &'a [String],
    /// Files that are not on the disk, or have another text there: absolute paths and texts.
    pub(crate) overlay: Vec<(String, Vec<u8>)>,
    pub(crate) threads: usize,
}

/// `BUN_LINT_CHECKS_LIKE_TSC`: what the named files import is checked too, and the projects that
/// theirs references are built, as `bun check` does. To measure what that costs.
fn checks_like_an_editor() -> bool {
    host::variable("BUN_LINT_CHECKS_LIKE_TSC").is_none()
}

type Linter = bun_lint::linter::Linter<bun_lint_driver::rules::Rules>;

fn linter() -> &'static Linter {
    static LINTER: std::sync::OnceLock<Linter> = std::sync::OnceLock::new();
    LINTER.get_or_init(|| {
        Linter::new(Registry::new(&[
            bun_lint_eslint::RULES,
            bun_lint_typescript::RULES,
        ]))
    })
}

fn find_rule(name: &str) -> Option<&'static RuleEntry> {
    linter().registry().get(Plugin::TypeScript, name.as_bytes())
}

/// The rule that the fixture `eslint/<rule>` or `typescript-eslint/<rule>` is for.
fn rule_of_fixture(name: &str) -> Option<&'static RuleEntry> {
    let (plugin, rule) = host::split_once(name, "/")?;
    let plugin = if plugin == "eslint" {
        Plugin::Eslint
    } else {
        Plugin::TypeScript
    };
    linter().registry().get(plugin, rule.as_bytes())
}

/// The configuration that the `RuleTester` of the plugin lints a case with: only that rule, as an
/// error.
/// What the rule `entry`, which is the one that `config` enables, reports for `file`.
fn lint_file<'a>(
    entry: &'static RuleEntry,
    file: &'a File<'a>,
    code: &[u8],
    config: &ResolvedConfig,
) -> Outcome {
    Outcome::new(
        entry,
        code,
        &linter()
            .lint(file, config, &LintOptions::default())
            .messages,
    )
}

fn lib_directory() -> String {
    host::variable("BUN_SEMA_TS_LIB")
        .expect("BUN_SEMA_TS_LIB: the directory of the lib.*.d.ts files")
}

/// Checks `project` and calls `then` with each of `Project::files` right after it is checked.
/// Returns what `then` returned for each, in no particular order, with the path.
pub(crate) fn lint_project<R: Send>(
    project: Project,
    language: &LanguageOptions,
    then: &(dyn for<'a> Fn(&'a File<'a>) -> R + Sync),
) -> Vec<(Vec<u8>, R)> {
    let mut results: Guarded<Vec<(Vec<u8>, R)>> = Guarded::new(Vec::new());
    check_project(project, language, &|path, file| {
        let result = then(file);
        let mut results = results.lock();
        // By path: the files can be in several programs, each with its own numbers.
        results.retain(|it| it.0 != path);
        results.push((path.to_vec(), result));
    });
    std::mem::take(results.get_mut())
}

/// Checks `project` and calls `then` with the path of each of `Project::files` and with the file,
/// right after it is checked.
///
/// This is what a `bun_lint_driver` has to do:
/// - `stops_like_tsc: false`, or a syntax error anywhere means that nothing is linted.
/// - The hook also runs for the files that the linted ones import, for `node_modules` and for
///   declaration files: it picks.
/// - A task of the checker can be run again, so a result replaces the one before.
fn check_project(
    project: Project,
    language: &LanguageOptions,
    then: &(dyn for<'a> Fn(&[u8], &'a File<'a>) + Sync),
) {
    let lib_directory = lib_directory();
    let mut args: Vec<Vec<u8>> = vec![b"--skipLibCheck".to_vec(), b"--allowJs".to_vec()];
    if let Some(type_roots) = host::variable("BUN_LINT_TYPE_ROOTS") {
        args.extend([b"--typeRoots".to_vec(), type_roots.into_bytes()]);
    }
    if let Some(config) = project.config {
        args.extend([b"--project".to_vec(), config.as_bytes().to_vec()]);
    }
    args.extend(project.files.iter().map(|it| it.as_bytes().to_vec()));
    let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
    let command_line = bun_sema_driver::parse_command_line(&args, project.cwd.as_bytes());

    let wanted: Vec<Vec<u8>> = (project.files.iter())
        .map(|it| bun_sema_driver::host::from_native(it.as_bytes()))
        .collect();
    let read_library = |path: &[u8], then: &mut dyn FnMut(&[u8])| {
        if let Ok(text) = host::read(text(bun_sema_driver::host::to_native(path))) {
            then(&text);
        }
    };
    let after_file = |checker: &mut bun_sema::check::Checker<'_, '_>, file: FileId| {
        let module = checker.p.files.module(file);
        let path = module.file_name();
        let is_wanted = match wanted.is_empty() {
            true => {
                !module.is_from_external_library
                    && module.hir.kind != bun_lint::ast::FileKind::Declaration
            }
            false => wanted.iter().any(|it| it == path),
        };
        if is_wanted {
            bun_lint::types::with_file(checker, file, language, Some(&read_library), |file| {
                then(path, file);
            });
        }
    };
    let request = bun_sema_driver::Request {
        compiler_options: &command_line.compiler_options,
        cwd: project.cwd.as_bytes(),
        project: command_line.project.as_deref(),
        listed_projects: None,
        build: false,
        errors: &[],
        paths: &command_line.paths,
        are_entry_points: false,
        threads: project.threads,
        libs: bun_sema_driver::Libs::Directory(lib_directory.as_bytes()),
        progress: None,
        only: None,
        order: 1,
        digests: false,
        task_clock: None,
        plan_options: bun_sema_driver::PlanOptions {
            after_file_is_for_checked_files: true,
            checks_only_named: checks_like_an_editor(),
            reads_sources_of_references: checks_like_an_editor(),
            current_directory_is_of_the_project: checks_like_an_editor(),
            warm_up_files: host::variable("BUN_LINT_WARM_UP_FILES")
                .and_then(|it| it.parse().ok())
                .unwrap_or_else(|| bun_sema_driver::PlanOptions::default().warm_up_files),
            ..Default::default()
        },
        retains_everything: false,
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        stops_like_tsc: false,
        uses_typescript_wording: true,
        loaded: None,
        checked: None,
        declaration_file_emitted: None,
        after_file: Some(&after_file),
    };
    let mut provided = bun_sema_driver::host::Provided::default();
    for (path, text) in project.overlay {
        provided
            .already_read
            .insert(bun_sema_driver::host::from_native(path.as_bytes()), text);
    }
    bun_sema_driver::check_provided_then(&request, provided, |report| {
        if host::variable("BUN_LINT_SHOWS_WHAT_IS_CHECKED").is_some() {
            let (loaded, checked, projects) = (
                report.files_loaded,
                report.files_checked,
                report.projects_checked,
            );
            output_line!(
                "{loaded} files loaded, {checked} checked, in {projects} projects: {:.3} s to load, {:.3} s to check",
                report.load_time.as_secs_f64(),
                report.check_time.as_secs_f64()
            );
        }
    });
}

fn absolute(path: &str) -> String {
    let path = std::path::Path::new(path);
    let path = host::real_path(path)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join(path));
    path.to_string_lossy().into_owned()
}

fn json_string(bytes: &[u8]) -> String {
    let mut out = Vec::new();
    Json::String(bytes.to_vec()).stringify(&mut out);
    text(&out)
}

/// One line for each expression, pattern and type of `file`: `[start, end, kind, type, symbol]`,
/// with offsets in bytes.
fn dump<'a>(file: &'a File<'a>, with_symbols: bool) -> String {
    let mut out = String::new();
    let mut lines: Vec<(u32, u32, &'static str, String)> = Vec::new();
    let mut work = vec![Node::File(file)];
    while let Some(node) = work.pop() {
        node.for_each_child(|child| work.push(child));
        let kind = match node {
            Node::Expr(_) => "expr",
            Node::Pat(_) => "pat",
            Node::Type(_) => "type",
            _ => continue,
        };
        let span = node.span();
        let mut line = json_string(&node.ty().to_text());
        if with_symbols {
            let symbol = node.ts_symbol().map(|it| json_string(&it.to_text()));
            let _ = write!(line, ", {}", symbol.as_deref().unwrap_or("null"));
        }
        lines.push((span.start, span.end, kind, line));
    }
    lines.sort();
    for (start, end, kind, line) in lines {
        let _ = writeln!(out, "[{start}, {end}, \"{kind}\", {line}]");
    }
    out
}

/// A symbol as `[name, flags, [[file, start], ..], deprecation]`, with the base name of the file of
/// each declaration. The start is -1 in the default library.
fn describe_symbol(symbol: TsSymbol) -> String {
    let declarations = symbol.declarations().map(|it| {
        let source_file = it.get_source_file();
        let name = source_file.file_name();
        let base = name.rsplit(|&c| c == b'/').next().unwrap_or(name);
        match source_file.is_default_library() {
            true => format!("[{}, -1]", json_string(base)),
            false => format!("[{}, {}]", json_string(base), it.span().start),
        }
    });
    let declarations: Vec<String> = declarations.collect();
    let deprecation = symbol.deprecation().map(json_string);
    format!(
        "[{}, {}, [{}], {}]",
        json_string(symbol.name()),
        symbol.flags().bits(),
        declarations.join(", "),
        deprecation.as_deref().unwrap_or("null")
    )
}

/// One line for each node of TypeScript's tree of `file`: `[start, end, kind, type, symbol]`.
fn dump_ts_nodes<'a>(file: &'a File<'a>) -> String {
    let mut lines: Vec<(u32, u32, String)> = Vec::new();
    let mut work: Vec<TsNode<'a>> = file
        .type_checker()
        .source_file()
        .node()
        .children()
        .collect();
    while let Some(node) = work.pop() {
        work.extend(node.children());
        let span = node.span();
        let symbol = node.get_symbol_at_location().map(describe_symbol);
        let line = format!(
            "\"{:?}\", {}, {}",
            node.kind(),
            json_string(&node.get_type_at_location().to_text()),
            symbol.as_deref().unwrap_or("null")
        );
        lines.push((span.start, span.end, line));
    }
    lines.sort();
    let mut out = String::new();
    for (start, end, line) in lines {
        let _ = writeln!(out, "[{start}, {end}, {line}]");
    }
    out
}

const TYPE_FLAGS: [(TypeFlags, &str); 29] = [
    (TypeFlags::ANY, "Any"),
    (TypeFlags::UNKNOWN, "Unknown"),
    (TypeFlags::STRING, "String"),
    (TypeFlags::NUMBER, "Number"),
    (TypeFlags::BOOLEAN, "Boolean"),
    (TypeFlags::ENUM, "Enum"),
    (TypeFlags::BIG_INT, "BigInt"),
    (TypeFlags::STRING_LITERAL, "StringLiteral"),
    (TypeFlags::NUMBER_LITERAL, "NumberLiteral"),
    (TypeFlags::BOOLEAN_LITERAL, "BooleanLiteral"),
    (TypeFlags::ENUM_LITERAL, "EnumLiteral"),
    (TypeFlags::BIG_INT_LITERAL, "BigIntLiteral"),
    (TypeFlags::ES_SYMBOL, "ESSymbol"),
    (TypeFlags::UNIQUE_ES_SYMBOL, "UniqueESSymbol"),
    (TypeFlags::VOID, "Void"),
    (TypeFlags::UNDEFINED, "Undefined"),
    (TypeFlags::NULL, "Null"),
    (TypeFlags::NEVER, "Never"),
    (TypeFlags::TYPE_PARAMETER, "TypeParameter"),
    (TypeFlags::OBJECT, "Object"),
    (TypeFlags::UNION, "Union"),
    (TypeFlags::INTERSECTION, "Intersection"),
    (TypeFlags::INDEX, "Index"),
    (TypeFlags::INDEXED_ACCESS, "IndexedAccess"),
    (TypeFlags::CONDITIONAL, "Conditional"),
    (TypeFlags::SUBSTITUTION, "Substitution"),
    (TypeFlags::NON_PRIMITIVE, "NonPrimitive"),
    (TypeFlags::TEMPLATE_LITERAL, "TemplateLiteral"),
    (TypeFlags::STRING_MAPPING, "StringMapping"),
];

const OBJECT_FLAGS: [(ObjectFlags, &str); 12] = [
    (ObjectFlags::CLASS, "Class"),
    (ObjectFlags::INTERFACE, "Interface"),
    (ObjectFlags::REFERENCE, "Reference"),
    (ObjectFlags::ANONYMOUS, "Anonymous"),
    (ObjectFlags::MAPPED, "Mapped"),
    (ObjectFlags::INSTANTIATED, "Instantiated"),
    (ObjectFlags::OBJECT_LITERAL, "ObjectLiteral"),
    (ObjectFlags::FRESH_LITERAL, "FreshLiteral"),
    (ObjectFlags::ARRAY_LITERAL, "ArrayLiteral"),
    (ObjectFlags::REVERSE_MAPPED, "ReverseMapped"),
    (ObjectFlags::OBJECT_REST_TYPE, "ObjectRestType"),
    (
        ObjectFlags::INSTANTIATION_EXPRESSION_TYPE,
        "InstantiationExpressionType",
    ),
];

/// One line for each expression of `file`: `[start, end, kind, { .. }]`, with what many functions
/// of the checker say about its type.
fn dump_profiles<'a>(file: &'a File<'a>) -> String {
    let text_of = |ty: Type| json_string(&ty.to_text());
    let optional = |ty: Option<Type>| ty.map_or_else(|| "null".to_owned(), text_of);
    let list =
        |all: &mut dyn Iterator<Item = String>| format!("[{}]", all.collect::<Vec<_>>().join(", "));
    let mut lines: Vec<(u32, u32, String)> = Vec::new();
    let mut work: Vec<TsNode<'a>> = file
        .type_checker()
        .source_file()
        .node()
        .children()
        .collect();
    while let Some(node) = work.pop() {
        work.extend(node.children());
        if !matches!(node.to_ast(), Some(Node::Expr(_)))
            || node.kind() == SyntaxKind::ParenthesizedExpression
        {
            continue;
        }
        let ty = node.get_type_at_location();
        let (flags, object_flags) = (ty.flags(), ty.object_flags());
        let mut fields: Vec<(&str, String)> = vec![
            ("type", text_of(ty)),
            (
                "flags",
                list(
                    &mut TYPE_FLAGS
                        .iter()
                        .filter(|it| flags.contains(it.0))
                        .map(|it| format!("\"{}\"", it.1)),
                ),
            ),
            (
                "objectFlags",
                list(
                    &mut OBJECT_FLAGS
                        .iter()
                        .filter(|it| object_flags.contains(it.0))
                        .map(|it| format!("\"{}\"", it.1)),
                ),
            ),
            (
                "symbol",
                ty.symbol()
                    .map_or_else(|| "null".to_owned(), |it| json_string(it.name())),
            ),
            (
                "aliasSymbol",
                ty.alias_symbol()
                    .map_or_else(|| "null".to_owned(), |it| json_string(it.name())),
            ),
            (
                "aliasTypeArguments",
                list(&mut ty.alias_type_arguments().iter().map(text_of)),
            ),
            ("types", list(&mut ty.types().iter().map(text_of))),
            (
                "typeArguments",
                list(&mut ty.get_type_arguments().iter().map(text_of)),
            ),
            ("isArray", ty.is_array_type().to_string()),
            ("isTuple", ty.is_tuple_type().to_string()),
            ("isArrayLike", ty.is_array_like_type().to_string()),
            (
                "intrinsicName",
                ty.intrinsic_name()
                    .map_or_else(|| "null".to_owned(), |it| format!("\"{it}\"")),
            ),
            ("apparent", text_of(ty.get_apparent_type())),
            ("baseConstraint", optional(ty.get_base_constraint_of_type())),
            ("awaited", optional(ty.get_awaited_type())),
            ("widened", text_of(ty.get_widened_type())),
            ("baseOfLiteral", text_of(ty.get_base_type_of_literal_type())),
            ("nonNullable", text_of(ty.get_non_nullable_type())),
            ("stringIndex", optional(ty.get_string_index_type())),
            ("numberIndex", optional(ty.get_number_index_type())),
            (
                "properties",
                list(
                    &mut ty
                        .get_properties()
                        .iter()
                        .take(40)
                        .map(|it| json_string(it.name())),
                ),
            ),
            (
                "propertyTypes",
                list(
                    &mut ty
                        .get_properties()
                        .iter()
                        .take(8)
                        .map(|it| text_of(it.get_type_at_location(node))),
                ),
            ),
            (
                "propertyFlags",
                list(
                    &mut ty
                        .get_properties()
                        .iter()
                        .take(8)
                        .map(|it| (it.flags() - SymbolFlags::TRANSIENT).bits().to_string()),
                ),
            ),
            (
                "call",
                list(
                    &mut ty
                        .get_call_signatures()
                        .iter()
                        .map(|it| json_string(&it.to_text())),
                ),
            ),
            (
                "construct",
                list(
                    &mut ty
                        .get_construct_signatures()
                        .iter()
                        .map(|it| json_string(&it.to_text())),
                ),
            ),
            (
                "returns",
                list(
                    &mut ty
                        .get_call_signatures()
                        .iter()
                        .map(|it| text_of(it.get_return_type())),
                ),
            ),
            (
                "parameters",
                list(&mut ty.get_call_signatures().iter().map(|signature| {
                    list(&mut signature.parameters().iter().map(|it| {
                        format!(
                            "[{}, {}]",
                            json_string(it.name()),
                            text_of(it.get_type_at_location(node))
                        )
                    }))
                })),
            ),
            (
                "baseTypes",
                list(&mut ty.get_base_types().iter().map(text_of)),
            ),
            ("contextual", optional(node.get_contextual_type())),
            ("thenable", tsutils::is_thenable_type(node, ty).to_string()),
            (
                "assignableToString",
                ty.is_assignable_to(file.type_checker().get_string_type())
                    .to_string(),
            ),
        ];
        // `@typescript-eslint/type-utils`, `eslint-plugin/src/util`
        let specifier = |json: &str| {
            bun_lint::json::parse(json.as_bytes())
                .and_then(|it| utils::TypeOrValueSpecifier::parse(&it))
        };
        let matches = |json: &str| {
            specifier(json)
                .is_some_and(|it| utils::type_matches_specifier(ty, &it))
                .to_string()
        };
        let utility_flags = utils::get_type_flags(ty);
        let constraint = utils::get_constraint_info(ty);
        fields.extend([
            ("isTypeAnyType", utils::is_type_any_type(ty).to_string()),
            ("isTypeUnknownType", utils::is_type_unknown_type(ty).to_string()),
            ("isTypeNeverType", utils::is_type_never_type(ty).to_string()),
            ("isNullableType", utils::is_nullable_type(ty).to_string()),
            ("isTypeArrayTypeOrUnionOfArrayTypes", utils::is_type_array_type_or_union_of_array_types(ty).to_string()),
            ("isTypeAnyArrayType", utils::is_type_any_array_type(ty).to_string()),
            ("isTypeUnknownArrayType", utils::is_type_unknown_array_type(ty).to_string()),
            ("isTypeReferenceType", utils::is_type_reference_type(ty).to_string()),
            ("isTypeBrandedLiteralLike", utils::is_type_branded_literal_like(ty).to_string()),
            ("getTypeFlags", list(&mut TYPE_FLAGS.iter().filter(|it| utility_flags.contains(it.0)).map(|it| format!("\"{}\"", it.1)))),
            ("getTypeName", json_string(&utils::get_type_name(ty))),
            ("isPromiseLike", utils::is_promise_like(ty).to_string()),
            ("isPromiseConstructorLike", utils::is_promise_constructor_like(ty).to_string()),
            ("isErrorLike", utils::is_error_like(ty).to_string()),
            ("isReadonlyErrorLike", utils::is_readonly_error_like(ty).to_string()),
            ("isBuiltinSymbolLike", utils::is_builtin_symbol_like(ty, &["Array", "Map", "Set", "Function", "RegExp"][..]).to_string()),
            ("isTypeReadonly", utils::is_type_readonly(ty, &utils::ReadonlynessOptions::default()).to_string()),
            ("containsAllTypesByName", utils::contains_all_types_by_name(ty, true, &["Promise", "Array"][..], false).to_string()),
            ("containsAllTypesByNameAny", utils::contains_all_types_by_name(ty, false, &["Promise", "Error"][..], true).to_string()),
            ("discriminateAnyType", format!("\"{:?}\"", utils::discriminate_any_type(ty, node))),
            ("needsToBeAwaited", format!("\"{:?}\"", utils::needs_to_be_awaited(node, ty))),
            ("getContextualType", optional(utils::get_contextual_type(node))),
            ("getConstrainedTypeAtLocation", text_of(utils::get_constrained_type_at_location(node))),
            ("getConstraintInfo", format!("[{}, {}]", optional(constraint.constraint_type), constraint.is_type_parameter)),
            ("isPossiblyFalsy", utils::is_possibly_falsy(ty).to_string()),
            ("isPossiblyTruthy", utils::is_possibly_truthy(ty).to_string()),
            ("isNumberLike", utils::is_number_like(ty).to_string()),
            ("isStringLike", utils::is_string_like(ty).to_string()),
            ("hasBaseTypes", utils::has_base_types(ty).to_string()),
            ("getEnumTypes", list(&mut utils::get_enum_types(ty).iter().map(|&it| text_of(it)))),
            ("matchesLib", matches(r#"{"from": "lib", "name": ["Promise", "Error", "Array", "string", "RegExp"]}"#)),
            ("matchesFile", matches(r#"{"from": "file", "name": ["Foo", "Bar", "A", "B", "T", "Test"]}"#)),
            ("matchesFilePath", matches(r#"{"from": "file", "name": ["Foo", "Bar", "A", "B", "T", "Test"], "path": "file.ts"}"#)),
            ("matchesPackage", matches(r#"{"from": "package", "name": ["Buffer", "URL", "ReactNode", "Element"], "package": "node:buffer"}"#)),
            ("matchesReact", matches(r#"{"from": "package", "name": ["ReactNode", "Element", "ReactElement", "FC"], "package": "react"}"#)),
            ("matchesName", matches(r#""Foo""#)),
            ("isUnsafeAssignment", match node.get_contextual_type() {
                Some(receiver) => {
                    let sender = match node.to_ast() {
                        Some(Node::Expr(e)) => Some(e),
                        _ => None,
                    };
                    match utils::is_unsafe_assignment(ty, receiver, sender) {
                        Some(found) => format!("[{}, {}]", text_of(found.sender), text_of(found.receiver)),
                        None => "false".to_owned(),
                    }
                }
                None => "null".to_owned(),
            }),
        ]);
        // `getSymbolsInScope`, without what other files declare.
        if node.kind() == SyntaxKind::Identifier {
            let here = file.type_checker().source_file();
            for (field, meaning) in [
                ("valuesInScope", SymbolFlags::VALUE),
                ("typesInScope", SymbolFlags::TYPE),
                ("namespacesInScope", SymbolFlags::NAMESPACE),
                ("variablesInScope", SymbolFlags::BLOCK_SCOPED_VARIABLE),
            ] {
                let in_scope = file.type_checker().get_symbols_in_scope(node, meaning);
                let declared_here = in_scope.filter(|it| {
                    it.declarations()
                        .any(|declaration| declaration.get_source_file() == here)
                });
                let mut names: Vec<String> = declared_here
                    .map(|it| {
                        let one = file
                            .type_checker()
                            .get_symbol_in_scope(node, meaning, it.name());
                        format!(
                            "{}{}",
                            json_string(it.name()),
                            if one == Some(it) { "" } else { "!" }
                        )
                    })
                    .collect();
                names.sort();
                fields.push((field, list(&mut names.into_iter())));
            }
        }
        if matches!(
            node.kind(),
            SyntaxKind::CallExpression
                | SyntaxKind::NewExpression
                | SyntaxKind::TaggedTemplateExpression
        ) {
            let signature = node.get_resolved_signature();
            fields.push((
                "resolved",
                signature.map_or_else(|| "null".to_owned(), |it| json_string(&it.to_text())),
            ));
            let declaration = signature
                .and_then(|it| it.declaration())
                .map(|it| format!("\"{:?}\"", it.kind()));
            fields.push((
                "resolvedDeclaration",
                declaration.unwrap_or_else(|| "null".to_owned()),
            ));
            let deprecation = signature.and_then(|it| it.deprecation()).map(json_string);
            fields.push((
                "resolvedDeprecation",
                deprecation.unwrap_or_else(|| "null".to_owned()),
            ));
            let predicate = signature.and_then(|it| it.get_type_predicate());
            fields.push((
                "predicate",
                predicate.map_or_else(
                    || "null".to_owned(),
                    |it| {
                        format!(
                            "[\"{:?}\", {}, {}]",
                            it.kind(),
                            it.parameter_index().map_or(-1, |index| index as i64),
                            optional(it.ty())
                        )
                    },
                ),
            ));
        }
        let fields: Vec<String> = fields
            .iter()
            .map(|(name, value)| format!("\"{name}\": {value}"))
            .collect();
        let span = node.span();
        lines.push((
            span.start,
            span.end,
            format!("\"{:?}\", {{{}}}", node.kind(), fields.join(", ")),
        ));
    }
    lines.sort();
    let mut out = String::new();
    for (start, end, line) in lines {
        let _ = writeln!(out, "[{start}, {end}, {line}]");
    }
    out
}

fn dump_file(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(path) = args.iter().find(|a| !a.starts_with("--")) else {
        return output_line!(
            "usage: bun-lint types dump <file> [--project=tsconfig.json] [--symbols]"
        );
    };
    let with_symbols = args.iter().any(|a| a == "--symbols");
    let as_ts_nodes = args.iter().any(|a| a == "--ts-nodes");
    let as_profiles = args.iter().any(|a| a == "--profiles");
    let files = [absolute(path)];
    let config = flag("--project=").map(absolute);
    let cwd = absolute(".");
    let project = Project {
        cwd: &cwd,
        config: config.as_deref(),
        files: &files,
        overlay: Vec::new(),
        threads: 1,
    };
    let dumped = lint_project(project, &LanguageOptions::default(), &|file| match (
        as_ts_nodes,
        as_profiles,
    ) {
        (true, _) => dump_ts_nodes(file),
        (_, true) => dump_profiles(file),
        _ => dump(file, with_symbols),
    });
    for (_, lines) in dumped {
        output!("{lines}");
    }
}

/// A type-aware test case as a project: the code is a file of the fixture project.
struct CaseProject<'a> {
    root: &'a str,
    config: String,
    files: [String; 1],
    code: &'a [u8],
}

impl<'a> CaseProject<'a> {
    fn new(root: &'a str, case: &'a Json) -> Self {
        let filename = str_of(case, "filename").unwrap_or("file.ts");
        CaseProject {
            root,
            config: format!(
                "{root}/{}",
                str_of(case, "tsconfig").unwrap_or("tsconfig.json")
            ),
            files: [match filename.starts_with('/') {
                true => filename.to_owned(),
                false => format!("{root}/{filename}"),
            }],
            code: case.get(b"code").and_then(Json::as_str).unwrap_or_default(),
        }
    }

    fn project(&self) -> Project<'_> {
        Project {
            cwd: self.root,
            config: Some(&self.config),
            files: &self.files,
            overlay: vec![(self.files[0].clone(), self.code.to_vec())],
            threads: 1,
        }
    }
}

struct Case<'j> {
    rule: usize,
    index: usize,
    json: &'j Json,
}

fn is_type_aware(case: &Json) -> bool {
    matches!(case.get(b"skip"), None | Some(Json::Null))
        && case.get(b"typeAware").and_then(Json::as_bool) == Some(true)
}

/// The fixtures in `root`, by `<plugin>/<rule>`. `with_eslint`: also those of ESLint's own rules.
fn read_fixtures(root: &str, only_rule: Option<&str>, with_eslint: bool) -> Vec<(String, Json)> {
    let mut fixtures = Vec::new();
    for plugin in ["eslint", "typescript-eslint"] {
        if !with_eslint && plugin == "eslint" {
            continue;
        }
        let mut paths = host::list(format!("{root}/{plugin}"));
        paths.sort();
        for path in paths {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if only_rule.is_some_and(|only| only != name) {
                continue;
            }
            if let Some(fixture) = host::read(&path)
                .ok()
                .and_then(|it| bun_lint::json::parse(&it))
            {
                fixtures.push((format!("{plugin}/{name}"), fixture));
            }
        }
    }
    fixtures
}

/// `every`: also those that are not type-aware.
fn cases_of(fixtures: &[(String, Json)], every: bool) -> Vec<Case<'_>> {
    let mut cases = Vec::new();
    for (rule, (_, fixture)) in fixtures.iter().enumerate() {
        let all = fixture
            .get(b"cases")
            .and_then(Json::as_array)
            .unwrap_or_default();
        let is_skipped = |case: &Json| !matches!(case.get(b"skip"), None | Some(Json::Null));
        let type_aware = all
            .iter()
            .enumerate()
            .filter(|it| is_type_aware(it.1) || every && !is_skipped(it.1));
        cases.extend(type_aware.map(|(index, json)| Case { rule, index, json }));
    }
    cases
}

/// Calls `then` with the file that the code of `case` is in the fixture project.
fn with_case<R: Send>(
    project_root: &str,
    case: &Json,
    language: &LanguageOptions,
    then: &(dyn for<'a> Fn(&'a File<'a>) -> R + Sync),
) -> Option<R> {
    let case = CaseProject::new(project_root, case);
    lint_project(case.project(), language, then)
        .pop()
        .map(|it| it.1)
}

fn jobs(args: &[String]) -> usize {
    let jobs = args
        .iter()
        .find_map(|a| a.strip_prefix("--jobs="))
        .and_then(|n| n.parse().ok());
    jobs.unwrap_or_else(|| std::thread::available_parallelism().map_or(8, |n| n.get()))
}

fn dump_fixtures(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return output_line!(
            "usage: bun-lint types dump-fixtures <fixtures> [--rule=r] [--out=file]"
        );
    };
    let root = absolute(root);
    let project_root = format!("{root}/typescript-eslint-project");
    let fixtures = read_fixtures(&root, flag("--rule="), false);
    let cases = cases_of(&fixtures, args.iter().any(|a| a == "--every-case"));
    let dumps: Vec<Guarded<String>> = cases.iter().map(|_| Guarded::new(String::new())).collect();
    let as_ts_nodes = args.iter().any(|a| a == "--ts-nodes");
    let as_profiles = args.iter().any(|a| a == "--profiles");
    std::panic::set_hook(Box::new(|_| {}));
    bun_sema_standalone::for_each_parallel(jobs(args), cases.len(), |i| {
        let dumped = std::panic::catch_unwind(|| {
            with_case(
                &project_root,
                cases[i].json,
                &LanguageOptions::default(),
                &|file| match (as_ts_nodes, as_profiles) {
                    (true, _) => dump_ts_nodes(file),
                    (_, true) => dump_profiles(file),
                    _ => dump(file, false),
                },
            )
        });
        let dumped = match dumped {
            Ok(dumped) => dumped.unwrap_or_else(|| "\"not checked\"\n".to_owned()),
            Err(_) => "\"panicked\"\n".to_owned(),
        };
        *dumps[i].lock() = dumped;
    });
    let mut out = String::new();
    for (case, dumped) in cases.iter().zip(&dumps) {
        let name = fixtures[case.rule]
            .0
            .strip_prefix("typescript-eslint/")
            .unwrap_or_default();
        let _ = writeln!(out, "# {name} {}", case.index);
        out.push_str(&dumped.lock());
    }
    match flag("--out=") {
        Some(path) => host::write(path, out).expect("the output file"),
        None => output!("{out}"),
    }
}

/// What is wrong with what the rule reports for `case`.
fn problem_of_case(entry: &'static RuleEntry, project_root: &str, case: &Json) -> Option<String> {
    let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
    let config = config_of(linter().registry(), entry, case);
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        with_case(project_root, case, &config.language, &|file| {
            lint_file(entry, file, code, &config)
        })
    }));
    problem_of_outcome(outcome, case)
}

/// What is wrong with it without types, in the way of `bun-lint conformance`.
fn problem_of_case_without_types(entry: &'static RuleEntry, case: &Json) -> Option<String> {
    let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
    let options = case
        .get(b"options")
        .and_then(Json::as_array)
        .unwrap_or_default();
    let language_options = case.get(b"languageOptions").unwrap_or(&Json::Null);
    let settings = case.get(b"settings").unwrap_or(&Json::Null);
    let path = str_of(case, "filename").unwrap_or("file.js");
    let outcome = std::panic::catch_unwind(|| {
        Some(crate::lint(
            entry,
            path,
            code,
            options,
            language_options,
            settings,
        ))
    });
    problem_of_outcome(outcome, case)
}

fn problem_of_outcome(
    outcome: std::thread::Result<Option<Outcome>>,
    case: &Json,
) -> Option<String> {
    match outcome {
        Err(_) => Some("panicked".to_owned()),
        Ok(outcome) => problem_of(outcome, case, &Counts::default()).map(|it| {
            format!("{}\n{}", it.summary, it.details)
                .trim_end()
                .to_owned()
        }),
    }
}

fn conformance(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return output_line!(
            "usage: bun-lint types conformance <fixtures> [--all] [--rule=r] [--report=dir] [--verbose] [--jobs=n]"
        );
    };
    let is_verbose = args.iter().any(|a| a == "--verbose");
    let runs_all = args.iter().any(|a| a == "--all");
    let root = absolute(root);
    let project_root = host::variable("BUN_LINT_FIXTURE_PROJECT")
        .unwrap_or_else(|| format!("{root}/typescript-eslint-project"));
    let fixtures = read_fixtures(&root, flag("--rule="), runs_all);
    let entries: Vec<Option<&'static RuleEntry>> =
        fixtures.iter().map(|it| rule_of_fixture(&it.0)).collect();
    let mut cases = cases_of(&fixtures, runs_all);
    cases.retain(|case| entries[case.rule].is_some());
    let problems: Vec<Guarded<Option<String>>> = cases.iter().map(|_| Guarded::new(None)).collect();
    std::panic::set_hook(Box::new(|_| {}));
    let started = std::time::Instant::now();
    bun_sema_standalone::for_each_parallel(jobs(args), cases.len(), |i| {
        if let Some(entry) = entries[cases[i].rule] {
            let mut problem = problem_of_case(entry, &project_root, cases[i].json);
            // What also fails without types is not about types.
            if problem.is_some()
                && !is_type_aware(cases[i].json)
                && problem_of_case_without_types(entry, cases[i].json).is_some()
            {
                problem = Some(String::new());
            }
            *problems[i].lock() = problem;
        }
    });
    let mut tallies: Vec<(Tally, String)> = fixtures.iter().map(|_| Default::default()).collect();
    for (case, problem) in cases.iter().zip(&problems) {
        let (tally, failures) = &mut tallies[case.rule];
        match &*problem.lock() {
            None => tally.passed += 1,
            Some(problem) if problem.is_empty() => tally.skipped += 1,
            Some(problem) => {
                tally.failed += 1;
                let mut options = Vec::new();
                case.json
                    .get(b"options")
                    .unwrap_or(&Json::Null)
                    .stringify(&mut options);
                let _ = writeln!(
                    failures,
                    "──── case {} ({}) {} {}\noptions: {}\ncode:\n{}\n{problem}\n",
                    case.index,
                    if expected_messages(case.json).is_empty() {
                        "valid"
                    } else {
                        "invalid"
                    },
                    str_of(case.json, "filename").unwrap_or_default(),
                    str_of(case.json, "tsconfig").unwrap_or_default(),
                    text(&options),
                    text(
                        case.json
                            .get(b"code")
                            .and_then(Json::as_str)
                            .unwrap_or_default()
                    ),
                );
            }
        }
    }
    let (mut passed, mut failed, mut fail_anyway, mut implemented, mut perfect) = (0, 0, 0, 0, 0);
    for ((name, _), (tally, failures)) in fixtures.iter().zip(&tallies) {
        if tally.passed + tally.failed + tally.skipped == 0 {
            continue;
        }
        fail_anyway += tally.skipped;
        implemented += 1;
        perfect += usize::from(tally.failed == 0);
        let verdict = if tally.failed == 0 { "ok  " } else { "FAIL" };
        if !runs_all || tally.failed > 0 {
            output_line!(
                "{verdict} {name}: {} passed, {} failed",
                tally.passed,
                tally.failed
            );
        }
        if is_verbose {
            output!("{failures}");
        }
        if let Some(report) = flag("--report=") {
            let _ = host::make_directories(format!("{report}/eslint"));
            let _ = host::make_directories(format!("{report}/typescript-eslint"));
            let _ = host::write(format!("{report}/{name}.types.txt"), failures);
        }
        passed += tally.passed;
        failed += tally.failed;
    }
    output_line!(
        "\n{implemented} rules, {perfect} without failures\n{passed} cases passed, {failed} failed, {fail_anyway} fail without types too, in {:.1} s",
        started.elapsed().as_secs_f64()
    );
}

/// `languageOptions` of a file that is linted with types.
fn with_the_parser_of_typescript_eslint() -> Json {
    Json::Object(vec![(
        b"parser".to_vec(),
        Json::String(b"typescript".to_vec()),
    )])
}

fn run_one(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let plain: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let [rule, path, rest @ ..] = &plain[..] else {
        return output_line!(
            "usage: bun-lint types run <rule> <file> [options as JSON] [--project=tsconfig.json]"
        );
    };
    let name = rule.strip_prefix("@typescript-eslint/").unwrap_or(rule);
    let Some(entry) = find_rule(name) else {
        return output_line!("no such rule: {rule}");
    };
    let code = host::read(path).expect("the file");
    let options = rest
        .first()
        .and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let options = options
        .as_ref()
        .and_then(Json::as_array)
        .unwrap_or_default();
    let (files, cwd, config) = (
        [absolute(path)],
        absolute("."),
        flag("--project=").map(absolute),
    );
    let project = Project {
        cwd: &cwd,
        config: config.as_deref(),
        files: &files,
        overlay: Vec::new(),
        threads: 1,
    };
    let case = Json::Object(vec![
        (b"options".to_vec(), Json::Array(options.to_vec())),
        (
            b"languageOptions".to_vec(),
            with_the_parser_of_typescript_eslint(),
        ),
    ]);
    let config = config_of(linter().registry(), entry, &case);
    let outcomes = lint_project(project, &config.language, &|file| {
        lint_file(entry, file, &code, &config)
    });
    for (_, outcome) in outcomes {
        if outcome.has_parse_errors {
            output_line!("the parser rejects the code");
        }
        for it in &outcome.messages {
            output_line!(
                "{path}:{}:{}: {} ({})",
                it.line,
                it.column,
                it.message,
                it.message_id
            );
        }
        if let Some(output) = outcome.output {
            output_line!("──── after fixes\n{}", text(&output));
        }
    }
}

/// The sum of `each` over the expressions of `file`.
fn expressions<'a>(file: &'a File<'a>, each: &dyn Fn(Node<'a>) -> usize) -> usize {
    let (mut work, mut total) = (vec![Node::File(file)], 0);
    while let Some(node) = work.pop() {
        node.for_each_child(|child| work.push(child));
        if matches!(node, Node::Expr(_)) {
            total += each(node);
        }
    }
    total
}

/// `bun-lint types bench <tsconfig.json> [--threads=n] [--rules=a,b]`: how long it takes to check a project, to make a
/// `File` of each of its files, to ask for the type of every expression, and to run rules.
fn bench(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(config) = args.iter().find(|a| !a.starts_with("--")) else {
        return output_line!(
            "usage: bun-lint types bench <tsconfig.json> [--threads=n] [--rules=a,b]"
        );
    };
    let config = absolute(config);
    let cwd = std::path::Path::new(&config)
        .parent()
        .map(|it| it.to_string_lossy().into_owned())
        .unwrap_or_default();
    let threads = flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(0);
    let project = || Project {
        cwd: &cwd,
        config: Some(&config),
        files: &[],
        overlay: Vec::new(),
        threads,
    };
    let language = LanguageOptions::default();
    let time = |what: &str, then: &(dyn for<'a> Fn(&'a File<'a>) -> usize + Sync)| {
        let started = std::time::Instant::now();
        let results = lint_project(project(), &language, then);
        let total: usize = results.iter().map(|it| it.1).sum();
        output_line!(
            "{:>8.3} s  {what}: {} files, {total}",
            started.elapsed().as_secs_f64(),
            results.len()
        );
    };
    time("only the files", &|_| 0);
    time("a walk over the expressions", &|file| {
        expressions(file, &|_| 1)
    });
    time("the type of every expression", &|file| {
        expressions(file, &|node| {
            usize::from(node.ty().flags().contains(TypeFlags::ANY))
        })
    });
    time("the type of every expression, printed", &|file| {
        expressions(file, &|node| node.ty().to_text().len())
    });
    time("the symbol of every expression", &|file| {
        expressions(file, &|node| usize::from(node.ts_symbol().is_some()))
    });
    if args.iter().any(|a| a == "--smoke") {
        std::panic::set_hook(Box::new(|_| {}));
        time("everything about every node (panics)", &|file| {
            let everything = || dump_ts_nodes(file).len() + dump_profiles(file).len();
            let has_panicked =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(everything)).is_err();
            if has_panicked {
                output_line!("panicked: {}", text(file.path()));
            }
            usize::from(has_panicked)
        });
    }
    if let Some(rules) = flag("--rules=") {
        let rules = host::split(rules, ",").map(|name| {
            (
                RuleId::Known(find_rule(name).expect("the rule").meta).to_vec(),
                Json::Number(2.0),
            )
        });
        let config = Json::Object(vec![
            (
                b"languageOptions".to_vec(),
                with_the_parser_of_typescript_eslint(),
            ),
            (b"rules".to_vec(), Json::Object(rules.collect())),
        ]);
        let config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
        time("the rules", &|file| {
            linter()
                .lint(file, &config, &LintOptions::default())
                .messages
                .len()
        });
    }
}

/// `bun-lint types smoke <directory> [--jobs=n]`: asks everything about every node of every TypeScript file in a directory, each as a
/// program of its own, and says which panic.
fn smoke(args: &[String]) {
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return output_line!("usage: bun-lint types smoke <directory> [--jobs=n]");
    };
    let mut paths = Vec::new();
    crate::collect(std::path::Path::new(&absolute(root)), &mut paths);
    let files: Vec<String> = paths
        .iter()
        .map(|it| it.to_string_lossy().into_owned())
        .filter(|it| it.ends_with(".ts") || it.ends_with(".tsx"))
        .collect();
    std::panic::set_hook(Box::new(|_| {}));
    let panicked = std::sync::atomic::AtomicUsize::new(0);
    bun_sema_standalone::for_each_parallel(jobs(args), files.len(), |i| {
        let directory = std::path::Path::new(&files[i])
            .parent()
            .map(|it| it.to_string_lossy().into_owned());
        let project = Project {
            cwd: directory.as_deref().unwrap_or("/"),
            config: None,
            files: &files[i..=i],
            overlay: Vec::new(),
            threads: 1,
        };
        let everything = || {
            lint_project(project, &LanguageOptions::default(), &|file| {
                dump_ts_nodes(file).len() + dump_profiles(file).len()
            })
        };
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(everything)).is_err() {
            panicked.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            output_line!("panicked: {}", files[i]);
        }
    });
    output_line!("{} files, {} panicked", files.len(), panicked.into_inner());
}

/// `bun-lint types time <files..> [--threads=n] [--rules=a,b]`: how long it takes to lint these files, each in the project that
/// has it.
fn time(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let files: Vec<String> = args
        .iter()
        .filter(|a| !a.starts_with("--"))
        .map(|it| absolute(it))
        .collect();
    let cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let rules = flag("--rules=")
        .unwrap_or("no-floating-promises,no-unsafe-member-access,no-unnecessary-condition");
    let rules = host::split(rules, ",").map(|name| {
        (
            RuleId::Known(find_rule(name).expect("the rule").meta).to_vec(),
            Json::Number(2.0),
        )
    });
    let config = Json::Object(vec![
        (
            b"languageOptions".to_vec(),
            with_the_parser_of_typescript_eslint(),
        ),
        (b"rules".to_vec(), Json::Object(rules.collect())),
    ]);
    let config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    let project = Project {
        cwd: &cwd,
        config: None,
        files: &files,
        overlay: Vec::new(),
        threads: flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(0),
    };
    let started = std::time::Instant::now();
    let results = lint_project(project, &config.language, &|file| {
        linter()
            .lint(file, &config, &LintOptions::default())
            .messages
            .len()
    });
    let messages: usize = results.iter().map(|it| it.1).sum();
    output_line!(
        "{:.3} s: {} of {} files linted, {messages} messages",
        started.elapsed().as_secs_f64(),
        results.len(),
        files.len()
    );
    if args.iter().any(|a| a == "--not-linted") {
        for file in files
            .iter()
            .filter(|file| !results.iter().any(|it| it.0 == file.as_bytes()))
        {
            output_line!("not linted: {file}");
        }
    }
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("dump") => dump_file(&args[1..]),
        Some("dump-fixtures") => dump_fixtures(&args[1..]),
        Some("conformance") => conformance(&args[1..]),
        Some("run") => run_one(&args[1..]),
        Some("bench") => bench(&args[1..]),
        Some("smoke") => smoke(&args[1..]),
        Some("time") => time(&args[1..]),
        Some("typescript-tests") => {
            let rest: Vec<&[u8]> = args[1..].iter().map(|arg| arg.as_bytes()).collect();
            if !bun_sema_standalone::baselines::run_from_command_line(&rest) {
                std::process::exit(1);
            }
        }
        _ => output_line!("usage: bun-lint types dump | dump-fixtures | conformance | run"),
    }
}

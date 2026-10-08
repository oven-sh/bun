//! `bun-lint types ..`: the linter with types.
//!
//! - `bun-lint types dump <file> [--project=tsconfig.json] [--symbols] [--ts-nodes] [--profiles]`: the type (and
//!   the symbol) at every expression, pattern and type of a file, or at every node of TypeScript's
//!   tree, or what many functions of the checker say about the type of every expression, as JSON
//!   lines, to compare with TypeScript's.
//! - `bun-lint types dump-fixtures <fixtures> [--rule=r] [--out=file] [--ts-nodes] [--profiles]`: the same for
//!   the code of every type-aware test case.
//! - `bun-lint types run <rule> <file> [options as JSON] [--project=tsconfig.json]`: what one rule
//!   reports for one file of a project.
//! - `bun-lint types conformance <fixtures> [--rule=r] [--report=dir] [--verbose] [--jobs=n]`: runs
//!   the type-aware test cases of typescript-eslint.
//!
//! - `bun-lint types typescript-tests ..`: TypeScript's own tests, as `bun check
//!   --run-typescript-tests` runs them (test/cli/check/typescript-go/conformance.ts). The types and
//!   the symbols that they compare are those that the linter is given.
//!
//! `BUN_SEMA_TS_LIB`: the directory of TypeScript's `lib.*.d.ts`. `BUN_LINT_TYPE_ROOTS`: the
//! `node_modules/@types` that the fixture project finds `node` and `react` in.

use crate::{Outcome, Reported, Tally, expected_messages, str_of, text};
use bun_lint::ast::{File, Node};
use bun_lint::context::Severity;
use bun_lint::language::LanguageOptions;
use bun_lint::linter::{LintOptions, Linter, Registry, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_lint::types::{ObjectFlags, SymbolFlags, SyntaxKind, TsNode, TsSymbol, Type, TypeFlags, tsutils, utils};
use bun_sema::program::FileId;
use std::fmt::Write as _;
use std::sync::Mutex;

/// A program to check, and the files of it to lint.
pub(crate) struct Project<'a> {
    /// The working directory.
    pub(crate) cwd: &'a str,
    /// The `tsconfig.json`.
    pub(crate) config: Option<&'a str>,
    /// The files to lint, as absolute paths.
    pub(crate) files: &'a [String],
    /// Files that are not on the disk, or have another text there: absolute paths and texts.
    pub(crate) overlay: Vec<(String, Vec<u8>)>,
    pub(crate) threads: usize,
}

fn linter() -> &'static Linter {
    static LINTER: std::sync::OnceLock<Linter> = std::sync::OnceLock::new();
    LINTER.get_or_init(|| Linter::new(Registry::new(&[bun_lint_eslint::RULES, bun_lint_typescript::RULES])))
}

fn find_rule(name: &str) -> Option<&'static RuleEntry> {
    linter().registry().get(Plugin::TypeScript, name.as_bytes())
}

/// The configuration that the `RuleTester` of typescript-eslint lints a case with: only that rule,
/// as an error.
fn config_of(entry: &'static RuleEntry, options: &[Json], language_options: &Json, settings: &Json) -> ResolvedConfig {
    let mut rule = vec![Json::Number(2.0)];
    rule.extend_from_slice(options);
    let config = Json::Object(vec![
        (b"languageOptions".to_vec(), language_options.clone()),
        (b"settings".to_vec(), settings.clone()),
        (b"rules".to_vec(), Json::Object(vec![(RuleId::Known(entry.meta).to_vec(), Json::Array(rule))])),
    ]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    config.linter.report_unused_disable_directives = Severity::Warn;
    config
}

/// What the rule `entry`, which is the one that `config` enables, reports for `file`.
fn lint_file<'a>(entry: &'static RuleEntry, file: &'a File<'a>, code: &[u8], config: &ResolvedConfig) -> Outcome {
    let messages = linter().lint(file, config, &LintOptions::default()).messages;
    let apply = |fix: &bun_lint::fix::Fix| bun_lint::fix::apply_fixes(code, &mut vec![fix]).unwrap_or_else(|| code.to_vec());
    let mut fixes: Vec<_> = messages.iter().filter_map(|it| it.fix.as_ref()).collect();
    Outcome {
        output: bun_lint::fix::apply_fixes(code, &mut fixes),
        has_parse_errors: messages.iter().any(|it| it.is_fatal && it.message.starts_with(b"Parsing error")),
        messages: (messages.iter())
            .map(|it| Reported {
                rule_id: match &it.rule_id {
                    Some(id) if *id == RuleId::Known(entry.meta) => None,
                    Some(id) => Some(text(&id.to_vec())),
                    None => Some(String::new()),
                },
                message_id: it.message_id.unwrap_or_default().to_owned(),
                message: text(&it.message),
                line: it.line,
                column: it.column,
                end: it.end,
                suggestions: it.suggestions.iter().map(|s| (s.message_id.to_owned(), text(&apply(&s.fix)))).collect(),
            })
            .collect(),
    }
}

fn in_order(mut messages: Vec<Reported>) -> Vec<Reported> {
    messages.sort_by(|a, b| {
        (a.line, a.column, a.end, &a.message_id, &a.message).cmp(&(b.line, b.column, b.end, &b.message_id, &b.message))
    });
    messages
}

fn lib_directory() -> String {
    std::env::var("BUN_SEMA_TS_LIB").expect("BUN_SEMA_TS_LIB: the directory of the lib.*.d.ts files")
}

/// Checks `project` and calls `then` with each of `Project::files` right after it is checked.
/// Returns what `then` returned for each, in no particular order, with the path.
///
/// This is what a `bun_lint_driver` has to do:
/// - `stops_like_tsc: false`, or a syntax error anywhere means that nothing is linted.
/// - The hook also runs for the files that the linted ones import, for `node_modules` and for
///   declaration files: it picks.
/// - A task of the checker can be run again, so a result replaces the one before.
pub(crate) fn lint_project<R: Send>(
    project: Project,
    language: &LanguageOptions,
    then: &(dyn for<'a> Fn(&'a File<'a>) -> R + Sync),
) -> Vec<(Vec<u8>, R)> {
    let lib_directory = lib_directory();
    let mut args: Vec<Vec<u8>> = vec![b"--skipLibCheck".to_vec()];
    if let Ok(type_roots) = std::env::var("BUN_LINT_TYPE_ROOTS") {
        args.extend([b"--typeRoots".to_vec(), type_roots.into_bytes()]);
    }
    if let Some(config) = project.config {
        args.extend([b"--project".to_vec(), config.as_bytes().to_vec()]);
    }
    args.extend(project.files.iter().map(|it| it.as_bytes().to_vec()));
    let args: Vec<&[u8]> = args.iter().map(Vec::as_slice).collect();
    let command_line = bun_sema_driver::parse_command_line(&args, project.cwd.as_bytes());

    let results: Mutex<Vec<(FileId, Vec<u8>, R)>> = Mutex::new(Vec::new());
    let wanted: Vec<Vec<u8>> = (project.files.iter()).map(|it| bun_sema_driver::host::from_native(it.as_bytes())).collect();
    let read_library = |path: &[u8], then: &mut dyn FnMut(&[u8])| {
        if let Ok(text) = std::fs::read(text(bun_sema_driver::host::to_native(path))) {
            then(&text);
        }
    };
    let after_file = |checker: &mut bun_sema::check::Checker<'_, '_>, file: FileId| {
        let path = checker.p.files.module(file).file_name();
        if !wanted.iter().any(|it| it == path) {
            return;
        }
        let Some(result) = bun_lint::types::with_file(checker, file, language, Some(&read_library), |file| then(file)) else {
            return;
        };
        let mut results = results.lock().unwrap_or_else(|it| it.into_inner());
        results.retain(|it| it.0 != file);
        results.push((file, path.to_vec(), result));
    };
    let request = bun_sema_driver::Request {
        compiler_options: &command_line.compiler_options,
        cwd: project.cwd.as_bytes(),
        project: command_line.project.as_deref(),
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
        provided.already_read.insert(bun_sema_driver::host::from_native(path.as_bytes()), text);
    }
    bun_sema_driver::check_provided_then(&request, provided, |_| ());
    let results = results.into_inner().unwrap_or_else(|it| it.into_inner());
    results.into_iter().map(|it| (it.1, it.2)).collect()
}

fn absolute(path: &str) -> String {
    let path = std::path::Path::new(path);
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| std::env::current_dir().unwrap_or_default().join(path));
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
    let mut work: Vec<TsNode<'a>> = file.type_checker().source_file().node().children().collect();
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
    (ObjectFlags::INSTANTIATION_EXPRESSION_TYPE, "InstantiationExpressionType"),
];

/// One line for each expression of `file`: `[start, end, kind, { .. }]`, with what many functions
/// of the checker say about its type.
fn dump_profiles<'a>(file: &'a File<'a>) -> String {
    let text_of = |ty: Type| json_string(&ty.to_text());
    let optional = |ty: Option<Type>| ty.map_or_else(|| "null".to_owned(), text_of);
    let list = |all: &mut dyn Iterator<Item = String>| format!("[{}]", all.collect::<Vec<_>>().join(", "));
    let mut lines: Vec<(u32, u32, String)> = Vec::new();
    let mut work: Vec<TsNode<'a>> = file.type_checker().source_file().node().children().collect();
    while let Some(node) = work.pop() {
        work.extend(node.children());
        if !matches!(node.to_ast(), Some(Node::Expr(_))) || node.kind() == SyntaxKind::ParenthesizedExpression {
            continue;
        }
        let ty = node.get_type_at_location();
        let (flags, object_flags) = (ty.flags(), ty.object_flags());
        let mut fields: Vec<(&str, String)> = vec![
            ("type", text_of(ty)),
            ("flags", list(&mut TYPE_FLAGS.iter().filter(|it| flags.contains(it.0)).map(|it| format!("\"{}\"", it.1)))),
            ("objectFlags", list(&mut OBJECT_FLAGS.iter().filter(|it| object_flags.contains(it.0)).map(|it| format!("\"{}\"", it.1)))),
            ("symbol", ty.symbol().map_or_else(|| "null".to_owned(), |it| json_string(it.name()))),
            ("aliasSymbol", ty.alias_symbol().map_or_else(|| "null".to_owned(), |it| json_string(it.name()))),
            ("aliasTypeArguments", list(&mut ty.alias_type_arguments().iter().map(text_of))),
            ("types", list(&mut ty.types().iter().map(text_of))),
            ("typeArguments", list(&mut ty.get_type_arguments().iter().map(text_of))),
            ("isArray", ty.is_array_type().to_string()),
            ("isTuple", ty.is_tuple_type().to_string()),
            ("isArrayLike", ty.is_array_like_type().to_string()),
            ("intrinsicName", ty.intrinsic_name().map_or_else(|| "null".to_owned(), |it| format!("\"{it}\""))),
            ("apparent", text_of(ty.get_apparent_type())),
            ("baseConstraint", optional(ty.get_base_constraint_of_type())),
            ("awaited", optional(ty.get_awaited_type())),
            ("widened", text_of(ty.get_widened_type())),
            ("baseOfLiteral", text_of(ty.get_base_type_of_literal_type())),
            ("nonNullable", text_of(ty.get_non_nullable_type())),
            ("stringIndex", optional(ty.get_string_index_type())),
            ("numberIndex", optional(ty.get_number_index_type())),
            ("properties", list(&mut ty.get_properties().iter().take(40).map(|it| json_string(it.name())))),
            ("propertyTypes", list(&mut ty.get_properties().iter().take(8).map(|it| text_of(it.get_type_at_location(node))))),
            ("propertyFlags", list(&mut ty.get_properties().iter().take(8).map(|it| (it.flags() - SymbolFlags::TRANSIENT).bits().to_string()))),
            ("call", list(&mut ty.get_call_signatures().iter().map(|it| json_string(&it.to_text())))),
            ("construct", list(&mut ty.get_construct_signatures().iter().map(|it| json_string(&it.to_text())))),
            ("returns", list(&mut ty.get_call_signatures().iter().map(|it| text_of(it.get_return_type())))),
            ("parameters", list(&mut ty.get_call_signatures().iter().map(|signature| {
                list(&mut signature.parameters().iter().map(|it| format!("[{}, {}]", json_string(it.name()), text_of(it.get_type_at_location(node)))))
            }))),
            ("baseTypes", list(&mut ty.get_base_types().iter().map(text_of))),
            ("contextual", optional(node.get_contextual_type())),
            ("thenable", tsutils::is_thenable_type(node, ty).to_string()),
            ("assignableToString", ty.is_assignable_to(file.type_checker().get_string_type()).to_string()),
        ];
        // `@typescript-eslint/type-utils`, `eslint-plugin/src/util`
        let specifier = |json: &str| bun_lint::json::parse(json.as_bytes()).and_then(|it| utils::TypeOrValueSpecifier::parse(&it));
        let matches = |json: &str| specifier(json).is_some_and(|it| utils::type_matches_specifier(ty, &it)).to_string();
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
        if matches!(node.kind(), SyntaxKind::CallExpression | SyntaxKind::NewExpression | SyntaxKind::TaggedTemplateExpression) {
            let signature = node.get_resolved_signature();
            fields.push(("resolved", signature.map_or_else(|| "null".to_owned(), |it| json_string(&it.to_text()))));
            let declaration = signature.and_then(|it| it.declaration()).map(|it| format!("\"{:?}\"", it.kind()));
            fields.push(("resolvedDeclaration", declaration.unwrap_or_else(|| "null".to_owned())));
            let deprecation = signature.and_then(|it| it.deprecation()).map(json_string);
            fields.push(("resolvedDeprecation", deprecation.unwrap_or_else(|| "null".to_owned())));
            let predicate = signature.and_then(|it| it.get_type_predicate());
            fields.push(("predicate", predicate.map_or_else(|| "null".to_owned(), |it| {
                format!("[\"{:?}\", {}, {}]", it.kind(), it.parameter_index().map_or(-1, |index| index as i64), optional(it.ty()))
            })));
        }
        let fields: Vec<String> = fields.iter().map(|(name, value)| format!("\"{name}\": {value}")).collect();
        let span = node.span();
        lines.push((span.start, span.end, format!("\"{:?}\", {{{}}}", node.kind(), fields.join(", "))));
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
        return println!("usage: bun-lint types dump <file> [--project=tsconfig.json] [--symbols]");
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
    let dumped = lint_project(project, &LanguageOptions::default(), &|file| match (as_ts_nodes, as_profiles) {
        (true, _) => dump_ts_nodes(file),
        (_, true) => dump_profiles(file),
        _ => dump(file, with_symbols),
    });
    for (_, lines) in dumped {
        print!("{lines}");
    }
}

/// A type-aware test case as a project: the code is a file of the fixture project.
fn project_of_case<'a>(root: &'a str, config: &'a str, files: &'a [String], code: &[u8]) -> Project<'a> {
    Project {
        cwd: root,
        config: Some(config),
        files,
        overlay: vec![(files[0].clone(), code.to_vec())],
        threads: 1,
    }
}

struct Case<'j> {
    rule: usize,
    index: usize,
    json: &'j Json,
}

fn is_type_aware(case: &Json) -> bool {
    matches!(case.get(b"skip"), None | Some(Json::Null)) && case.get(b"typeAware").and_then(Json::as_bool) == Some(true)
}

/// The fixtures of typescript-eslint in `root`, by the name of the rule.
fn read_fixtures(root: &str, only_rule: Option<&str>) -> Vec<(String, Json)> {
    let Ok(entries) = std::fs::read_dir(format!("{root}/typescript-eslint")) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries.flatten().map(|it| it.path()).collect();
    paths.sort();
    let mut fixtures = Vec::new();
    for path in paths {
        let name = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        if only_rule.is_some_and(|only| only != name) {
            continue;
        }
        if let Some(fixture) = std::fs::read(&path).ok().and_then(|it| bun_lint::json::parse(&it)) {
            fixtures.push((name, fixture));
        }
    }
    fixtures
}

fn type_aware_cases(fixtures: &[(String, Json)]) -> Vec<Case<'_>> {
    let mut cases = Vec::new();
    for (rule, (_, fixture)) in fixtures.iter().enumerate() {
        let all = fixture.get(b"cases").and_then(Json::as_array).unwrap_or_default();
        let type_aware = all.iter().enumerate().filter(|it| is_type_aware(it.1));
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
    let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
    let files = [format!("{project_root}/{}", str_of(case, "filename").unwrap_or("file.ts"))];
    let config = format!("{project_root}/{}", str_of(case, "tsconfig").unwrap_or("tsconfig.json"));
    let project = project_of_case(project_root, &config, &files, code);
    lint_project(project, language, then).pop().map(|it| it.1)
}

fn jobs(args: &[String]) -> usize {
    let jobs = args.iter().find_map(|a| a.strip_prefix("--jobs=")).and_then(|n| n.parse().ok());
    jobs.unwrap_or_else(|| std::thread::available_parallelism().map_or(8, |n| n.get()))
}

fn dump_fixtures(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return println!("usage: bun-lint types dump-fixtures <fixtures> [--rule=r] [--out=file]");
    };
    let root = absolute(root);
    let project_root = format!("{root}/typescript-eslint-project");
    let fixtures = read_fixtures(&root, flag("--rule="));
    let cases = type_aware_cases(&fixtures);
    let dumps: Vec<Mutex<String>> = cases.iter().map(|_| Mutex::new(String::new())).collect();
    let as_ts_nodes = args.iter().any(|a| a == "--ts-nodes");
    let as_profiles = args.iter().any(|a| a == "--profiles");
    std::panic::set_hook(Box::new(|_| {}));
    bun_sema_standalone::for_each_parallel(jobs(args), cases.len(), |i| {
        let dumped = std::panic::catch_unwind(|| {
            with_case(&project_root, cases[i].json, &LanguageOptions::default(), &|file| match (as_ts_nodes, as_profiles) {
                (true, _) => dump_ts_nodes(file),
                (_, true) => dump_profiles(file),
                _ => dump(file, false),
            })
        });
        let dumped = match dumped {
            Ok(dumped) => dumped.unwrap_or_else(|| "\"not checked\"\n".to_owned()),
            Err(_) => "\"panicked\"\n".to_owned(),
        };
        *dumps[i].lock().unwrap_or_else(|it| it.into_inner()) = dumped;
    });
    let mut out = String::new();
    for (case, dumped) in cases.iter().zip(&dumps) {
        let _ = writeln!(out, "# {} {}", fixtures[case.rule].0, case.index);
        out.push_str(&dumped.lock().unwrap_or_else(|it| it.into_inner()));
    }
    match flag("--out=") {
        Some(path) => std::fs::write(path, out).expect("the output file"),
        None => print!("{out}"),
    }
}

/// What is wrong with what the rule reports for `case`.
fn problem_of_case(entry: &'static RuleEntry, project_root: &str, case: &Json) -> Option<String> {
    let code = case.get(b"code").and_then(Json::as_str).unwrap_or_default();
    let options = case.get(b"options").and_then(Json::as_array).unwrap_or_default();
    let language_options = case.get(b"languageOptions").unwrap_or(&Json::Null);
    let config = config_of(entry, options, language_options, case.get(b"settings").unwrap_or(&Json::Null));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        with_case(project_root, case, &config.language, &|file| lint_file(entry, file, code, &config))
    }));
    let outcome = outcome.map(|outcome| {
        outcome.map(|mut outcome| {
            outcome.messages = in_order(std::mem::take(&mut outcome.messages));
            outcome
        })
    });
    let expected = in_order(expected_messages(case));
    let expected_output = case.get(b"output").and_then(Json::as_str);
    match &outcome {
        Err(_) => Some("panicked".to_owned()),
        Ok(None) => Some("the file is not part of the program".to_owned()),
        Ok(Some(Outcome { has_parse_errors: true, .. })) => Some("the parser rejects the code".to_owned()),
        Ok(Some(outcome)) if outcome.messages != expected => {
            Some(format!("messages differ\n  expected: {expected:#?}\n  actual: {:#?}", outcome.messages))
        }
        Ok(Some(outcome)) if outcome.output.as_deref() != expected_output => Some(format!(
            "output differs\n  expected: {:?}\n  actual: {:?}",
            expected_output.map(text),
            outcome.output.as_deref().map(text)
        )),
        Ok(Some(_)) => None,
    }
}

fn conformance(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let Some(root) = args.iter().find(|a| !a.starts_with("--")) else {
        return println!("usage: bun-lint types conformance <fixtures> [--rule=r] [--report=dir] [--verbose] [--jobs=n]");
    };
    let is_verbose = args.iter().any(|a| a == "--verbose");
    let root = absolute(root);
    let project_root = format!("{root}/typescript-eslint-project");
    let fixtures = read_fixtures(&root, flag("--rule="));
    let entries: Vec<Option<&'static RuleEntry>> = fixtures.iter().map(|it| find_rule(&it.0)).collect();
    let mut cases = type_aware_cases(&fixtures);
    cases.retain(|case| entries[case.rule].is_some());
    let problems: Vec<Mutex<Option<String>>> = cases.iter().map(|_| Mutex::new(None)).collect();
    std::panic::set_hook(Box::new(|_| {}));
    let started = std::time::Instant::now();
    bun_sema_standalone::for_each_parallel(jobs(args), cases.len(), |i| {
        if let Some(entry) = entries[cases[i].rule] {
            *problems[i].lock().unwrap_or_else(|it| it.into_inner()) = problem_of_case(entry, &project_root, cases[i].json);
        }
    });
    let mut tallies: Vec<(Tally, String)> = fixtures.iter().map(|_| Default::default()).collect();
    for (case, problem) in cases.iter().zip(&problems) {
        let (tally, failures) = &mut tallies[case.rule];
        match &*problem.lock().unwrap_or_else(|it| it.into_inner()) {
            None => tally.passed += 1,
            Some(problem) => {
                tally.failed += 1;
                let mut options = Vec::new();
                case.json.get(b"options").unwrap_or(&Json::Null).stringify(&mut options);
                let _ = writeln!(
                    failures,
                    "──── case {} ({}) {} {}\noptions: {}\ncode:\n{}\n{problem}\n",
                    case.index,
                    if expected_messages(case.json).is_empty() { "valid" } else { "invalid" },
                    str_of(case.json, "filename").unwrap_or_default(),
                    str_of(case.json, "tsconfig").unwrap_or_default(),
                    text(&options),
                    text(case.json.get(b"code").and_then(Json::as_str).unwrap_or_default()),
                );
            }
        }
    }
    let (mut passed, mut failed, mut implemented, mut perfect) = (0, 0, 0, 0);
    for ((name, _), (tally, failures)) in fixtures.iter().zip(&tallies) {
        if tally.passed + tally.failed == 0 {
            continue;
        }
        implemented += 1;
        perfect += usize::from(tally.failed == 0);
        let verdict = if tally.failed == 0 { "ok  " } else { "FAIL" };
        println!("{verdict} typescript-eslint/{name}: {} passed, {} failed", tally.passed, tally.failed);
        if is_verbose {
            print!("{failures}");
        }
        if let Some(report) = flag("--report=") {
            let _ = std::fs::create_dir_all(format!("{report}/typescript-eslint"));
            let _ = std::fs::write(format!("{report}/typescript-eslint/{name}.types.txt"), failures);
        }
        passed += tally.passed;
        failed += tally.failed;
    }
    println!(
        "\n{implemented} rules with type-aware cases, {perfect} without failures\n{passed} cases passed, {failed} failed, in {:.1} s",
        started.elapsed().as_secs_f64()
    );
}

fn run_one(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let plain: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let [rule, path, rest @ ..] = &plain[..] else {
        return println!("usage: bun-lint types run <rule> <file> [options as JSON] [--project=tsconfig.json]");
    };
    let name = rule.strip_prefix("@typescript-eslint/").unwrap_or(rule);
    let Some(entry) = find_rule(name) else {
        return println!("no such rule: {rule}");
    };
    let code = std::fs::read(path).expect("the file");
    let options = rest.first().and_then(|it| bun_lint::json::parse(it.as_bytes()));
    let options = options.as_ref().and_then(Json::as_array).unwrap_or_default();
    let (files, cwd, config) = ([absolute(path)], absolute("."), flag("--project=").map(absolute));
    let project = Project {
        cwd: &cwd,
        config: config.as_deref(),
        files: &files,
        overlay: Vec::new(),
        threads: 1,
    };
    let config = config_of(entry, options, &Json::Null, &Json::Null);
    let outcomes = lint_project(project, &config.language, &|file| lint_file(entry, file, &code, &config));
    for (_, outcome) in outcomes {
        if outcome.has_parse_errors {
            println!("the parser rejects the code");
        }
        for it in &outcome.messages {
            println!("{path}:{}:{}: {} ({})", it.line, it.column, it.message, it.message_id);
        }
        if let Some(output) = outcome.output {
            println!("──── after fixes\n{}", text(&output));
        }
    }
}

pub(crate) fn run(args: &[String]) {
    match args.first().map(String::as_str) {
        Some("dump") => dump_file(&args[1..]),
        Some("dump-fixtures") => dump_fixtures(&args[1..]),
        Some("conformance") => conformance(&args[1..]),
        Some("run") => run_one(&args[1..]),
        Some("typescript-tests") => {
            let rest: Vec<&[u8]> = args[1..].iter().map(|arg| arg.as_bytes()).collect();
            if !bun_sema_standalone::baselines::run_from_command_line(&rest) {
                std::process::exit(1);
            }
        }
        _ => println!("usage: bun-lint types dump | dump-fixtures | conformance | run"),
    }
}

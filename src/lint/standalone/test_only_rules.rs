//! The rules that upstream's test files define for themselves and turn on with a comment in the code:
//! `/*eslint custom/use-every-a:1*/`. What they do to a file is done here, around the linter.

use crate::linter_cmd::{CaseOutcome, linter, with_file};
use bun_lint::ast::{File, Node, StmtTag};
use bun_lint::context::Severity;
use bun_lint::fix::Fix;
use bun_lint::linter::{LintMessage, LintOptions, ResolvedConfig, RuleId};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_lint::span::Span;

/// The names of the rules, as the comments have them.
const RULES: [&str; 8] = [
    "custom/use-every-a",
    "@rule-tester/use-every-a",
    "custom/use-x",
    "test/use-a",
    "test/unknown-ref",
    "@rule-tester/collect-unused-vars",
    "custom/add-named-import",
    "@rule-tester/add-named-import",
];

/// Whether `skip`, the reason why a case is not for everybody, is a rule of this file.
pub(crate) fn is_known(skip: &str) -> bool {
    skip.starts_with("test-only plugin: ") || skip.starts_with("test-only rule: ")
}

/// ESLint's `sourceCode.markVariableAsUsed(name, node)` for each statement of the kinds `tags`.
fn mark_as_used<'a>(file: &'a File<'a>, name: &str, tags: &[StmtTag]) {
    for statement in tags.iter().flat_map(|tag| file.stmts_of_kind(*tag)) {
        if let Some(symbol) = Node::Stmt(statement).scope().resolve(name) {
            symbol.mark_used();
        }
    }
}

/// What the rule `name` does before the rules that look at the whole file in the end.
fn prepare<'a>(file: &'a File<'a>, name: &str) {
    match name {
        "custom/use-every-a" | "@rule-tester/use-every-a" => mark_as_used(file, "a", &[StmtTag::Var, StmtTag::Return]),
        "custom/use-x" => mark_as_used(file, "x", &[StmtTag::Var]),
        "test/use-a" => mark_as_used(file, "a", &[StmtTag::Var]),
        // It gives each variable a reference that is nowhere in the code, after which nothing is known about the variable.
        "test/unknown-ref" => file.symbols().for_each(|symbol| symbol.mark_used()),
        _ => {}
    }
}

/// `custom/add-named-import`: a fix at the end of the names of each import.
fn add_named_import<'a>(file: &'a File<'a>, id: &str, into: &mut Vec<LintMessage>) {
    for statement in file.stmts_of_kind(StmtTag::Import) {
        let span = statement.span();
        let text = &file.text()[span.start as usize..span.end as usize];
        let Some(brace) = text.iter().rposition(|it| *it == b'}') else {
            continue;
        };
        let has_comma = text[..brace].trim_ascii_end().ends_with(b",");
        let (start, end) = (file.position(span.start), file.position(span.end));
        let at = span.start + brace as u32;
        into.push(LintMessage {
            rule_id: Some(RuleId::Unknown(id.as_bytes().into())),
            severity: Severity::Warn,
            message: b"Add I18nManager.".to_vec(),
            message_id: Some(""),
            line: start.line,
            column: start.column + 1,
            end: Some((end.line, end.column + 1)),
            is_fatal: false,
            fix: Some(Fix {
                span: Span::new(at, at),
                text: if has_comma { b"I18nManager".to_vec() } else { b",I18nManager".to_vec() },
            }),
            suggestions: Vec::new(),
            suppressions: Vec::new(),
        });
    }
}

/// `linter_cmd::lint_case` for a case whose code turns on rules of this file.
pub(crate) fn lint_case(
    entry: &'static RuleEntry,
    code: &[u8],
    filename: &str,
    options: &[Json],
    language_options: &Json,
    settings: &Json,
) -> CaseOutcome {
    let mut rule = vec![Json::Number(2.0)];
    rule.extend_from_slice(options);
    let config = Json::Object(vec![
        (b"languageOptions".to_vec(), language_options.clone()),
        (b"settings".to_vec(), settings.clone()),
        (b"rules".to_vec(), Json::Object(vec![(RuleId::Known(entry.meta).to_vec(), Json::Array(rule))])),
    ]);
    let mut config = ResolvedConfig::from_json(linter().registry(), &config, &mut Vec::new());
    config.linter.report_unused_disable_directives = match entry.meta.plugin {
        Plugin::TypeScript => Severity::Warn,
        _ => Severity::Off,
    };
    let enabled = RULES.iter().filter(|name| bun_core::strings::contains(code, name.as_bytes()));
    with_file(filename, code, &config.language, |file| {
        enabled.clone().for_each(|name| prepare(file, name));
        let mut messages = linter().lint(file, &config, &LintOptions::default()).messages;
        // The linter does not know them.
        messages.retain(|it| !matches!(&it.rule_id, Some(RuleId::Unknown(id)) if RULES.iter().any(|name| name.as_bytes() == &id[..])));
        for name in enabled.filter(|name| name.ends_with("/add-named-import")) {
            add_named_import(file, name, &mut messages);
        }
        messages.sort_by_key(|it| (it.line, it.column));
        let mut fixes: Vec<_> = messages.iter().filter_map(|it| it.fix.as_ref()).collect();
        let output = bun_lint::fix::apply_fixes(code, &mut fixes);
        CaseOutcome { messages, output }
    })
}

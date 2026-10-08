//! The rules that upstream's test files define for themselves and turn on with a comment in the
//! code: `/*eslint custom/use-every-a:1*/`. What they do to a file is done here, around the linter.

use bun_core::strings;
use bun_lint::ast::{File, Node, StmtTag};
use bun_lint::context::Severity;
use bun_lint::fix::Fix;
use bun_lint::linter::{LintMessage, RuleId};
use bun_lint::span::Span;
use std::cell::RefCell;

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
pub(crate) fn is_known(skip: &[u8]) -> bool {
    skip.starts_with(b"test-only plugin: ") || skip.starts_with(b"test-only rule: ")
}

/// ESLint's `sourceCode.markVariableAsUsed(name, node)` for each statement of the kinds `tags`.
fn mark_as_used<'a>(file: &'a File<'a>, name: &str, tags: &[StmtTag]) {
    for statement in tags.iter().flat_map(|tag| file.stmts_of_kind(*tag)) {
        if let Some(symbol) = Node::Stmt(statement).scope().resolve(name) {
            symbol.mark_used();
        }
    }
}

/// `custom/add-named-import`: a fix at the end of the names of each import.
fn add_named_import<'a>(file: &'a File<'a>, id: &str, into: &mut Vec<LintMessage>) {
    for statement in file.stmts_of_kind(StmtTag::Import) {
        let span = statement.span();
        let text = file.slice(span);
        let Some(brace) = strings::last_index_of_char(text, b'}') else {
            continue;
        };
        let has_comma = text[..brace].trim_ascii_end().ends_with(b",");
        let (start, end) = (file.position(span.start), file.position(span.end));
        let at = span.start + brace as u32;
        into.push(LintMessage {
            rule_id: Some(RuleId::Unknown(id.as_bytes().into())),
            severity: Severity::Warn,
            message: b"Add I18nManager.".to_vec(),
            message_id: Some("".into()),
            line: start.line,
            column: start.column + 1,
            end: Some((end.line, end.column + 1)),
            fix: Some(Fix {
                span: Span::new(at, at),
                text: if has_comma { b"I18nManager".to_vec() } else { b",I18nManager".to_vec() },
            }),
            ..LintMessage::default()
        });
    }
}

/// The rules of this file that the code of a case turns on.
pub(crate) struct Enabled {
    names: Vec<&'static str>,
    /// What they report.
    messages: RefCell<Vec<LintMessage>>,
}

impl Enabled {
    pub(crate) fn in_code(code: &[u8]) -> Enabled {
        Enabled {
            names: RULES.into_iter().filter(|name| strings::contains(code, name.as_bytes())).collect(),
            messages: RefCell::default(),
        }
    }

    /// What they do before the rules that look at the whole file in the end.
    pub(crate) fn prepare<'a>(&self, file: &'a File<'a>) {
        for &name in &self.names {
            match name {
                "custom/use-every-a" | "@rule-tester/use-every-a" => mark_as_used(file, "a", &[StmtTag::Var, StmtTag::Return]),
                "custom/use-x" => mark_as_used(file, "x", &[StmtTag::Var]),
                "test/use-a" => mark_as_used(file, "a", &[StmtTag::Var]),
                // It gives each variable a reference that is nowhere in the code, after which nothing is known about the variable.
                "test/unknown-ref" => file.symbols().for_each(|symbol| symbol.mark_used()),
                "custom/add-named-import" | "@rule-tester/add-named-import" => {
                    add_named_import(file, name, &mut self.messages.borrow_mut());
                }
                _ => {}
            }
        }
    }

    /// `messages`: of the linter, which does not know these rules.
    pub(crate) fn finish(self, mut messages: Vec<LintMessage>) -> Vec<LintMessage> {
        messages.retain(|it| !matches!(&it.rule_id, Some(RuleId::Unknown(id)) if RULES.iter().any(|name| name.as_bytes() == &id[..])));
        messages.extend(self.messages.into_inner());
        messages.sort_by_key(|it| (it.line, it.column));
        messages
    }
}

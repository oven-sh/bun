use bun_lint_oxlint::ast_util::as_member_expression;
use bun_lint_oxlint::import::{ImportEntry, ImportImportName, import_entries_of};
use crate::jest::{self, JestFnKind, JestGeneralFnKind, PossibleJestNode};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// This rule triggers an error when an unexpected Vitest accessor is used.
pub struct ConsistentVitestVi {
    function: &'static str,
    opposite: &'static str,
}

const CONSISTENT_VITEST_VI: Message = Message::new("", "The vitest function accessor used is not allowed");

impl Rule for ConsistentVitestVi {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-vitest-vi", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        match options.object(0).str("fn") {
            Some("vitest") => ConsistentVitestVi { function: "vitest", opposite: "vi" },
            _ => ConsistentVitestVi { function: "vi", opposite: "vitest" },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions(self.opposite) {
            return;
        }
        on.stmts([StmtTag::Import], |rule, statement, cx| {
            if let StmtKind::Import(import) = statement.kind()
                && jest::is_vitest_import_source(import.spec().bytes())
            {
                rule.check_import(import, cx);
            }
        });
        on.exprs([ExprTag::Call], |rule, node, cx| {
            if let Some(member_expression) = node.callee().and_then(as_member_expression)
                && let Some(vitest_fn) = jest::parse_general_jest_fn_call(cx.file(), PossibleJestNode::new(node))
                && vitest_fn.kind == JestFnKind::General(JestGeneralFnKind::Vitest)
                && vitest_fn.name == rule.opposite.as_bytes()
                && let Some(object) = member_expression.object()
            {
                let function = rule.function;
                cx.report(object.outer_span(), CONSISTENT_VITEST_VI).fix(|fixer| fixer.replace(object.outer_span(), function));
            }
        });
    }
}

fn span_of(specifier: &ImportEntry) -> Span {
    match specifier.import_name {
        ImportImportName::Name(specifier) => specifier.span(),
        ImportImportName::Default(local) => local.span(),
        ImportImportName::NamespaceObject(local) => specifier.declaration.namespace_span().unwrap_or_else(|| local.span()),
    }
}

impl ConsistentVitestVi {
    fn check_import<'a>(&self, import: Import<'a>, cx: &Cx<'a, Self>) {
        let is_named = |specifier: &ImportEntry, name: &str| specifier.local_name().bytes() == name.as_bytes();
        let Some(vitest_import) = import_entries_of(import).find(|it| is_named(it, self.opposite)) else {
            return;
        };
        cx.report(span_of(&vitest_import), CONSISTENT_VITEST_VI).fix(|fixer| {
            let specifiers: SmallVec<[ImportEntry; 8]> = import_entries_of(import).collect();
            let mut import_text = Vec::new();
            for specifier in specifiers.iter().filter(|it| !is_named(it, self.opposite)) {
                import_text.extend_from_slice(if import_text.is_empty() { "" } else { ", " }.as_bytes());
                import_text.extend_from_slice(fixer.file().slice(span_of(specifier)));
            }
            if import_text.is_empty() {
                return Some(fixer.replace(vitest_import.local_name().span(), self.function));
            }
            if !specifiers.iter().any(|it| is_named(it, self.function)) {
                import_text.extend_from_slice(b", ");
                import_text.extend_from_slice(self.function.as_bytes());
            }
            Some(fixer.replace(Span::new(span_of(specifiers.first()?).start, span_of(specifiers.last()?).end), import_text))
        });
    }
}

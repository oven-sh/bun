use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces a non-empty attribute list in `import`/`export` statements and `import()` expressions.
pub struct RequireModuleAttributes;

const REQUIRE_MODULE_ATTRIBUTES: Message = Message::new("", "{{import_type}} with empty attribute list is not allowed.");
const REMOVE: Message = Message::new("", "Remove the unused import attribute.");

impl Rule for RequireModuleAttributes {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "require-module-attributes", Kind::Suggestion).has_suggestions();
    const ON: On =
        On::new().exprs(&[ExprTag::ImportCall]).stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar]);
    no_state!();

    fn new(_: &Options) -> Self {
        RequireModuleAttributes
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::ImportCall { args } = e.kind() else {
            return;
        };
        let (Some(source), Some(options)) = (args.first(), args.get(1)) else {
            return;
        };
        let obj_expr = get_inner_expression(options);
        let ExprKind::Object(properties) = obj_expr.kind() else {
            return;
        };
        let whole_argument = source.outer_span().between(Span::empty(options.outer_span().end));
        if properties.is_empty() {
            report(obj_expr.span(), "import expression", whole_argument, cx);
            return;
        }
        // `with: {}`
        let is_empty_with = |property: &Prop<'a>| {
            property.kind() == PropKind::Init
                && property.key().is_some_and(|key| !key.is_computed() && key.is("with"))
                && property.value().is_some_and(|it| is_empty_object_expression(get_inner_expression(it)))
        };
        let Some((index, empty_with_prop)) = properties.iter().enumerate().find(|it| is_empty_with(&it.1)) else {
            return;
        };
        let Some(value) = empty_with_prop.value() else {
            return;
        };
        let removed = match (index.checked_sub(1).and_then(|it| properties.get(it)), properties.get(1)) {
            (Some(prev_prop), _) => Span::new(prev_prop.span().end, empty_with_prop.span().end),
            (None, Some(next_prop)) => Span::new(empty_with_prop.span().start, next_prop.span().start),
            (None, None) => whole_argument,
        };
        report(value.outer_span(), "import expression", removed, cx);
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(with_clause) = statement.import_attributes().filter(|it| it.entries().is_empty())
            && let Some(source) = statement.module_specifier_span()
        {
            let import_type = if statement.tag() == StmtTag::Import { "import statement" } else { "export statement" };
            let braces = with_clause.braces_span();
            report(braces, import_type, Span::new(source.end, braces.end), cx);
        }
    }
}

fn report(span: Span, import_type: &'static str, removed: Span, cx: &Cx<RequireModuleAttributes>) {
    cx.report(span, REQUIRE_MODULE_ATTRIBUTES).data("import_type", import_type).suggest(REMOVE, |fixer| fixer.remove(removed));
}

fn is_empty_object_expression(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Object(properties) if properties.is_empty())
}

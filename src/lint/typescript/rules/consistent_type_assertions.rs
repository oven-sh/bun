use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{
    OperatorPrecedence, get_operator_precedence_for_node, get_operator_precedence_of_ts_parent,
    get_text_with_parentheses, get_wrapped_code,
};

/// Enforce consistent usage of type assertions.
pub struct ConsistentTypeAssertions {
    assertion_style: Style,
    object_literal_type_assertions: Literals,
    array_literal_type_assertions: Literals,
}

#[derive(Copy, Clone, PartialEq)]
enum Style {
    As,
    AngleBracket,
    Never,
}

#[derive(Copy, Clone, PartialEq)]
enum Literals {
    Allow,
    AllowAsParameter,
    Never,
}

impl Literals {
    fn parse(value: Option<&str>) -> Literals {
        match value {
            Some("allow-as-parameter") => Literals::AllowAsParameter,
            Some("never") => Literals::Never,
            _ => Literals::Allow,
        }
    }
}

const ANGLE_BRACKET: Message =
    Message::new("angle-bracket", "Use '<{{cast}}>' instead of 'as {{cast}}'.");
const AS: Message = Message::new("as", "Use 'as {{cast}}' instead of '<{{cast}}>'.");
const NEVER: Message = Message::new("never", "Do not use any type assertions.");
const REPLACE_ARRAY_TYPE_ASSERTION_WITH_ANNOTATION: Message = Message::new(
    "replaceArrayTypeAssertionWithAnnotation",
    "Use const x: {{cast}} = [ ... ] instead.",
);
const REPLACE_ARRAY_TYPE_ASSERTION_WITH_SATISFIES: Message = Message::new(
    "replaceArrayTypeAssertionWithSatisfies",
    "Use const x = [ ... ] satisfies {{cast}} instead.",
);
const REPLACE_OBJECT_TYPE_ASSERTION_WITH_ANNOTATION: Message = Message::new(
    "replaceObjectTypeAssertionWithAnnotation",
    "Use const x: {{cast}} = { ... } instead.",
);
const REPLACE_OBJECT_TYPE_ASSERTION_WITH_SATISFIES: Message = Message::new(
    "replaceObjectTypeAssertionWithSatisfies",
    "Use const x = { ... } satisfies {{cast}} instead.",
);
const UNEXPECTED_ARRAY_TYPE_ASSERTION: Message = Message::new(
    "unexpectedArrayTypeAssertion",
    "Always prefer const x: T[] = [ ... ].",
);
const UNEXPECTED_OBJECT_TYPE_ASSERTION: Message = Message::new(
    "unexpectedObjectTypeAssertion",
    "Always prefer const x: T = { ... }.",
);

/// Upstream's `isAsParameter`
fn is_as_parameter(node: Expr) -> bool {
    if node.jsx_container_span().is_some() {
        return true;
    }
    match node.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::New(_) | ExprKind::Call(_) => true,
            ExprKind::Assign { op: None, .. } => utils::is_assignment_target(parent),
            ExprKind::Template(_) => {
                matches!(parent.parent(), Node::Expr(it) if it.tag() == ExprTag::TaggedTemplate)
            }
            _ => false,
        },
        Node::Stmt(parent) => parent.tag() == StmtTag::Throw,
        Node::Param(parent) => parent.default() == Some(node),
        Node::PatProp(parent) => parent.default() == Some(node),
        Node::PatElem(parent) => parent.default() == Some(node),
        _ => false,
    }
}

/// oxlint's `needs_parens_for_parent`, for a `node` that is not in parentheses.
fn needs_parens_for_parent(node: Expr) -> bool {
    match node.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Unary { .. }
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::Assign { .. }
            | ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. } => true,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => call.callee() == node,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == node,
            _ => false,
        },
        Node::Func(func) => func.is_arrow(),
        _ => false,
    }
}

/// What oxlint makes of `<cast>expression`, which is `node`.
fn fix_as_oxlint<'a>(fixer: Fixer<'a>, node: Expr<'a>, expression: Expr<'a>, cast: &[u8]) -> Fix {
    let needs_parentheses = !node.is_parenthesized() && needs_parens_for_parent(node);
    let starts_a_statement = || match node.parent() {
        Node::Stmt(parent) => utils::is_expression_statement(parent),
        Node::Func(func) => func.is_arrow(),
        _ => false,
    };
    let wraps_expression = !expression.is_parenthesized()
        && match expression.kind() {
            ExprKind::Binary { op, .. } => op == BinOp::Comma,
            ExprKind::Fn(func) => func.is_arrow(),
            ExprKind::Object(_) => !needs_parentheses && starts_a_statement(),
            ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::Instantiation { .. } => true,
            _ => false,
        };
    let open = |is_needed: bool| -> &'static [u8] { if is_needed { b"(" } else { b"" } };
    let close = |is_needed: bool| -> &'static [u8] { if is_needed { b")" } else { b"" } };
    let text = [
        open(needs_parentheses),
        open(wraps_expression),
        fixer.file().slice(expression.outer_span()),
        close(wraps_expression),
        b" as ",
        cast,
        close(needs_parentheses),
    ];
    fixer.replace(node, text.concat())
}

impl ConsistentTypeAssertions {
    /// `ty` is `None` for `as const` and `<const>`.
    fn report_incorrect_assertion_type<'a>(
        &self,
        node: Expr<'a>,
        expression: Expr<'a>,
        ty: Option<TypeNode<'a>>,
        cx: &mut Cx<'a, Self>,
    ) {
        let cast = ty.map_or(&b"const"[..], |ty| ty.text());
        match self.assertion_style {
            Style::Never if ty.is_none() => {}
            Style::Never => {
                cx.report(node, NEVER);
            }
            Style::AngleBracket => {
                cx.report(node, ANGLE_BRACKET).data("cast", cast);
            }
            Style::As => {
                cx.report(node, AS).data("cast", cast).fix(|fixer| {
                    if fixer.file().language().is_oxlint {
                        return fix_as_oxlint(fixer, node, expression, cast);
                    }
                    let as_precedence = OperatorPrecedence::Relational;
                    let mut text = get_wrapped_code(
                        expression.text(),
                        get_operator_precedence_for_node(expression),
                        as_precedence,
                    )
                    .into_owned();
                    text.extend_from_slice(b" as ");
                    text.extend_from_slice(cast);
                    if node.is_parenthesized() {
                        return fixer.replace(node, text);
                    }
                    let parent_precedence = get_operator_precedence_of_ts_parent(node);
                    fixer.replace(node, get_wrapped_code(&text, as_precedence, parent_precedence))
                });
            }
        }
    }
}

impl Rule for ConsistentTypeAssertions {
    const META: Meta = Meta::typescript("consistent-type-assertions", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .presets(Presets::STYLISTIC);
    const ON: On = On::new().exprs(&[ExprTag::As, ExprTag::AsConst]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        ConsistentTypeAssertions {
            assertion_style: match options.str("assertionStyle") {
                Some("angle-bracket") => Style::AngleBracket,
                Some("never") => Style::Never,
                _ => Style::As,
            },
            object_literal_type_assertions: Literals::parse(options.str("objectLiteralTypeAssertions")),
            array_literal_type_assertions: Literals::parse(options.str("arrayLiteralTypeAssertions")),
        }
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (expression, ty) = match node.kind() {
            ExprKind::As { expr, ty } => (expr, Some(ty)),
            ExprKind::AsConst(expr) => (expr, None),
            _ => return,
        };
        let style = match node.is_angle_bracket_assertion() {
            true => Style::AngleBracket,
            false => Style::As,
        };
        if style != self.assertion_style {
            self.report_incorrect_assertion_type(node, expression, ty, cx);
            return;
        }

        let (allowed, unexpected, with_annotation, with_satisfies) = match expression.tag() {
            ExprTag::Object => (
                self.object_literal_type_assertions,
                UNEXPECTED_OBJECT_TYPE_ASSERTION,
                REPLACE_OBJECT_TYPE_ASSERTION_WITH_ANNOTATION,
                REPLACE_OBJECT_TYPE_ASSERTION_WITH_SATISFIES,
            ),
            ExprTag::Array => (
                self.array_literal_type_assertions,
                UNEXPECTED_ARRAY_TYPE_ASSERTION,
                REPLACE_ARRAY_TYPE_ASSERTION_WITH_ANNOTATION,
                REPLACE_ARRAY_TYPE_ASSERTION_WITH_SATISFIES,
            ),
            _ => return,
        };
        let Some(ty) = ty else {
            return;
        };
        if allowed == Literals::Allow
            || matches!(ty.kind(), TypeKind::Keyword(Keyword::Any | Keyword::Unknown))
            || (allowed == Literals::AllowAsParameter && is_as_parameter(node))
        {
            return;
        }

        let cast = ty.text();
        let data: [(&'static str, &[u8]); 1] = [("cast", cast)];
        let mut report = cx.report(node, unexpected);
        if let Node::VarDecl(declarator) = node.parent()
            && declarator.ty().is_none()
        {
            report = report.suggest_with(with_annotation, &data, |fixer| {
                [
                    fixer.insert_after(declarator.pat(), [&b": "[..], cast].concat()),
                    fixer.replace(node, get_text_with_parentheses(expression)),
                ]
            });
        }
        report.suggest_with(with_satisfies, &data, |fixer| {
            [
                fixer.replace(node, get_text_with_parentheses(expression)),
                fixer.insert_after(node, [&b" satisfies "[..], cast].concat()),
            ]
        });
    }
}

use bun_lint::prelude::*;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{NodeFlags, SymbolFlags, SyntaxKind, Type};
use bun_lint::utils::ts_utils::is_static_member_access_of_value;

/// Enforce using type parameter when calling `Array#reduce` instead of using a type assertion.
pub struct PreferReduceTypeParameter;

const PREFER_TYPE_PARAMETER: Message = Message::new(
    "preferTypeParameter",
    "Unnecessary assertion: Array#reduce accepts a type parameter for the default value.",
);

fn is_array_type(ty: Type) -> bool {
    union_constituents(ty).iter().all(|union_part| {
        intersection_constituents(union_part).iter().all(|t| t.is_array_type() || t.is_tuple_type())
    })
}

/// TypeScript's `isEntityNameExpression`, where parentheses are nodes.
fn is_entity_name_expression(mut node: Expr<'_>) -> bool {
    loop {
        if node.is_parenthesized() {
            return false;
        }
        match node.kind() {
            ExprKind::Ident(_) => return true,
            ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => node = obj,
            _ => return false,
        }
    }
}

/// typescript-go's `tryGetNameFromType`: whether the name is `reduce`. `None`: the type has no name.
fn try_get_name_from_type(ty: Type<'_>) -> Option<bool> {
    if let Some(value) = ty.string_value() {
        return Some(value == b"reduce");
    }
    ty.number_value().map(|_| false)
}

/// typescript-go's `tryGetNameFromEntityNameExpression`: the name that the declaration of a
/// `const` or of an enum member gives, by its type annotation, then by its initializer.
fn try_get_name_from_entity_name_expression(node: Expr<'_>) -> Option<bool> {
    let symbol = node.ts_symbol()?.skip_alias();
    let declaration = symbol.value_declaration()?;
    let is_constant_variable = symbol.has_flags(SymbolFlags::VARIABLE)
        && declaration.flags().intersects(NodeFlags::CONST | NodeFlags::USING);
    if !is_constant_variable && !symbol.has_flags(SymbolFlags::ENUM_MEMBER) {
        return None;
    }
    let from_type_node = declaration
        .type_node()
        .and_then(|type_node| try_get_name_from_type(type_node.get_type_from_type_node()));
    if from_type_node.is_some() {
        return from_type_node;
    }
    // Not a binding element: its initializer does not alone decide its type.
    match (declaration.kind(), declaration.initializer()) {
        (SyntaxKind::VariableDeclaration | SyntaxKind::EnumMember, Some(initializer)) => {
            try_get_name_from_type(initializer.get_type_at_location())
        }
        (SyntaxKind::EnumMember, None) => Some(symbol.name() == b"reduce"),
        _ => None,
    }
}

/// typescript-go's `tryGetElementAccessExpressionName`: whether the name is `reduce`.
fn try_get_element_access_expression_name(index: Expr<'_>) -> Option<bool> {
    if index.is_parenthesized() {
        return None;
    }
    match index.kind() {
        ExprKind::String(value) => Some(value.is("reduce")),
        ExprKind::Number(_) => Some(false),
        ExprKind::Template(template) if template.exprs().is_empty() => {
            Some(template.cooked(0).is_some_and(|value| value.is("reduce")))
        }
        _ if is_entity_name_expression(index) => try_get_name_from_entity_name_expression(index),
        _ => None,
    }
}

impl Rule for PreferReduceTypeParameter {
    const META: Meta = Meta::typescript("prefer-reduce-type-parameter", Kind::Problem)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferReduceTypeParameter
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let Some(second_arg) = call.args().get(1) else {
            return;
        };
        // `asserted_type` is `None` for `const`, which stands for the type of the expression.
        let (expression, type_annotation, asserted_type) = match second_arg.kind() {
            ExprKind::As { expr, ty } => (expr, ty.span(), Some(ty)),
            ExprKind::AsConst(expr) => match second_arg.const_keyword_span() {
                Some(keyword) => (expr, keyword, None),
                None => return,
            },
            _ => return,
        };
        let callee = call.callee();
        // ESLint has a `ChainExpression` around the callee of `(a?.reduce)()`.
        if callee.is_chain_root() {
            return;
        }
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // tsgolint has a `ParenthesizedExpression` there, which is neither an assertion nor an access.
        if is_oxlint && (second_arg.is_parenthesized() || callee.is_parenthesized()) {
            return;
        }
        let is_reduce = match callee.kind() {
            // tsgolint asks the checker's `getAccessedPropertyName`.
            ExprKind::Dot { name, .. } if is_oxlint => name.bytes() == b"reduce",
            ExprKind::Index { index, .. } if is_oxlint => {
                try_get_element_access_expression_name(index) == Some(true)
            }
            _ => is_static_member_access_of_value(callee, &["reduce"]),
        };
        if !is_reduce {
            return;
        }
        // The fix would be a type error.
        let is_assertion_necessary =
            asserted_type.is_some_and(|asserted| !expression.ty().is_assignable_to(asserted.ty()));
        if is_assertion_necessary || !is_array_type(get_constrained_type_at_location(obj)) {
            return;
        }
        cx.report(second_arg, PREFER_TYPE_PARAMETER).fix(|fixer| {
            let (mut outer, inner) = (second_arg.span(), expression.span());
            let mut type_annotation = type_annotation;
            // For tsgolint a node begins where the token before it ends.
            let file = fixer.file();
            if file.language().is_oxlint {
                type_annotation.start = file.end_of_token_before(type_annotation.start);
                if outer.start < inner.start {
                    outer.start = file.end_of_token_before(outer.start);
                }
            }
            let mut fixes = vec![
                fixer.remove(Span::new(outer.start, inner.start)),
                fixer.remove(Span::new(inner.end, outer.end)),
            ];
            if call.type_args().is_empty() {
                let type_argument = [&b"<"[..], fixer.file().slice(type_annotation), b">"].concat();
                fixes.push(fixer.insert_after(callee, type_argument));
            }
            fixes
        });
    }
}

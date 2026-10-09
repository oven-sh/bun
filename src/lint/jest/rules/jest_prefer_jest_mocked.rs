use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer the `jest.mocked()` helper over type assertions for typing mocked functions.
pub struct PreferJestMocked;

const USE_JEST_MOCKED: Message = Message::new("", "Prefer `jest.mocked()` over `fn as jest.Mock`.");

const MOCK_TYPES: [&str; 4] = ["Mock", "MockedFunction", "MockedClass", "MockedObject"];

impl Rule for PreferJestMocked {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-jest-mocked", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferJestMocked
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&MOCK_TYPES) {
            return;
        }
        on.exprs([ExprTag::As], |_, node, cx| {
            // `jest.Mock`, with or without type arguments
            if let ExprKind::As { expr, ty } = node.kind()
                && let TypeKind::Ref { name, .. } = ty.kind()
                && !ty.is_parenthesized()
                && name.len() == 2
                && name.first().is_some_and(|it| it.bytes().eq_ignore_ascii_case(b"jest"))
                && name.last().is_some_and(|it| it.name().is_any(&MOCK_TYPES))
                && (node.is_angle_bracket_assertion() || !is_operand_of_as(node))
            {
                let report = cx.report(node, USE_JEST_MOCKED);
                if can_fix(node) {
                    report.fix(|fixer| {
                        fixer.replace(node, [b"jest.mocked(".as_slice(), get_inner_expression(expr).text(), b")".as_slice()].concat())
                    });
                }
            }
        });
    }
}

/// `node as T`, without parentheses around `node`.
fn is_operand_of_as(node: Expr) -> bool {
    !node.is_parenthesized()
        && node.parent().as_expr().is_some_and(|parent| {
            matches!(parent.tag(), ExprTag::As | ExprTag::AsConst) && !parent.is_angle_bracket_assertion()
        })
}

/// Not what is assigned to, and not in `a[b]` or `a.#b`.
fn can_fix(node: Expr) -> bool {
    match node.parent().as_expr().map(|parent| (parent, parent.kind())) {
        Some((_, ExprKind::Assign { target, .. })) => target != node,
        Some((_, ExprKind::Index { .. })) => false,
        Some((parent, ExprKind::Dot { .. })) => !parent.is_private_member(),
        _ => true,
    }
}

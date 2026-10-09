use bun_lint::prelude::*;

/// Enforce the use of `as const` over literal type.
pub struct PreferAsConst;

const PREFER_CONST_ASSERTION: Message = Message::new(
    "preferConstAssertion",
    "Expected a `const` instead of a literal type assertion.",
);
const VARIABLE_CONST_ASSERTION: Message = Message::new(
    "variableConstAssertion",
    "Expected a `const` assertion instead of a literal type annotation.",
);
const VARIABLE_SUGGEST: Message = Message::new(
    "variableSuggest",
    "You should use `as const` instead of type annotation.",
);

/// oxlint compares the values of strings and of numbers, and knows no other literals.
fn oxlint_is_same_literal<'a>(value: Expr<'a>, ty: TypeNode<'a>) -> bool {
    match (value.kind(), ty.kind()) {
        (ExprKind::String(value), TypeKind::StringLit(ty_value)) => value == ty_value && !ty.text().starts_with(b"`"),
        (ExprKind::Number(value), TypeKind::NumberLit(ty_value)) => (value - ty_value).abs() < f64::EPSILON,
        _ => false,
    }
}

/// Whether `value` is a literal and `ty` is the type of that literal, written the same way.
fn is_same_literal<'a>(value: Expr<'a>, ty: TypeNode<'a>) -> bool {
    if value.file().language().is_oxlint {
        return oxlint_is_same_literal(value, ty);
    }
    matches!(
        ty.tag(),
        TypeTag::StringLit | TypeTag::NumberLit | TypeTag::BigIntLit | TypeTag::BoolLit
    ) && matches!(
        value.tag(),
        ExprTag::String | ExprTag::Number | ExprTag::BigInt | ExprTag::True | ExprTag::False
    ) && value.text() == ty.text()
}

/// `name: ty = value`
fn check_annotation<'a>(value: impl FnOnce() -> Option<Expr<'a>>, ty: Option<TypeNode<'a>>, cx: &Cx<'a, PreferAsConst>) {
    if let Some(ty) = ty
        && let Some(value) = value()
        && is_same_literal(value, ty)
    {
        let fix = |fixer: Fixer<'a>| {
            [
                fixer.remove(ty.annotation_span()),
                fixer.insert_after(value, " as const"),
            ]
        };
        // What typescript-eslint suggests is a fix in oxlint.
        match cx.language().is_oxlint {
            true => cx.report(ty, VARIABLE_CONST_ASSERTION).fix(fix),
            false => cx.report(ty, VARIABLE_CONST_ASSERTION).suggest(VARIABLE_SUGGEST, fix),
        };
    }
}

impl Rule for PreferAsConst {
    const META: Meta = Meta::typescript("prefer-as-const", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferAsConst
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::As], |_, e, cx| {
            if let ExprKind::As { expr, ty } = e.kind()
                && is_same_literal(expr, ty)
                // oxlint does not look at `<"a">"a"`.
                && !(cx.language().is_oxlint && e.is_angle_bracket_assertion())
            {
                cx.report(ty, PREFER_CONST_ASSERTION).fix(|fixer| fixer.replace(ty, "const"));
            }
        });
        on.var_decls(|_, declaration, cx| check_annotation(|| declaration.init(), declaration.ty(), cx));
        on.members(|_, member, cx| {
            if member.kind() == MemberKind::Property
                && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
                && !member.is_signature()
            {
                check_annotation(|| member.init(), member.ty(), cx);
            }
        });
    }
}

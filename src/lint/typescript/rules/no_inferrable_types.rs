use bun_lint::prelude::*;

/// Disallow explicit type declarations for variables or parameters initialized to a number, string, or boolean.
pub struct NoInferrableTypes {
    ignore_parameters: bool,
    ignore_properties: bool,
}

const NO_INFERRABLE_TYPE: Message = Message::new(
    "noInferrableType",
    "Type {{type}} trivially inferred from a {{type}} literal, remove type annotation.",
);

fn is_function_call(init: Expr<'_>, name: &str) -> bool {
    init.as_call().is_some_and(|call| call.callee().is_ident(name))
}

/// The operand, if `init` is a unary expression with one of `operators`. Otherwise `init`.
fn without_unary_prefix<'a>(init: Expr<'a>, operators: &[UnOp]) -> Expr<'a> {
    match init.kind() {
        ExprKind::Unary { op, operand } if operators.contains(&op) => operand,
        _ => init,
    }
}

/// typescript-eslint's `isInferrable`: the name of the type `annotation`, if that is what `init`
/// is inferred to be.
fn inferrable_type(annotation: TypeNode<'_>, init: Expr<'_>) -> Option<&'static str> {
    let (name, is_inferrable) = match annotation.kind() {
        TypeKind::Keyword(Keyword::BigInt) => {
            let unwrapped = without_unary_prefix(init, &[UnOp::Minus]);
            ("bigint", is_function_call(unwrapped, "BigInt") || ast_utils::is_literal(unwrapped))
        }
        TypeKind::Keyword(Keyword::Boolean) => (
            "boolean",
            matches!(
                init.kind(),
                ExprKind::Unary { op: UnOp::Not, .. } | ExprKind::True | ExprKind::False
            ) || is_function_call(init, "Boolean"),
        ),
        TypeKind::Keyword(Keyword::Number) => {
            let unwrapped = without_unary_prefix(init, &[UnOp::Plus, UnOp::Minus]);
            let is_number = match unwrapped.kind() {
                ExprKind::Number(_) => true,
                ExprKind::Ident(name) => name.is_any(&["Infinity", "NaN"]),
                _ => is_function_call(unwrapped, "Number"),
            };
            ("number", is_number)
        }
        TypeKind::Keyword(Keyword::Null) => ("null", matches!(init.kind(), ExprKind::Null)),
        TypeKind::Keyword(Keyword::String) => (
            "string",
            matches!(init.kind(), ExprKind::String(_) | ExprKind::Template(_))
                || is_function_call(init, "String"),
        ),
        TypeKind::Keyword(Keyword::Symbol) => ("symbol", is_function_call(init, "Symbol")),
        TypeKind::Keyword(Keyword::Undefined) => (
            "undefined",
            matches!(init.kind(), ExprKind::Unary { op: UnOp::Void, .. }) || init.is_ident("undefined"),
        ),
        TypeKind::Ref { name, .. } if name.is("RegExp") => {
            let is_regexp = match init.kind() {
                ExprKind::Regex(_) => true,
                ExprKind::New(call) | ExprKind::Call(call) => call.callee().is_ident("RegExp"),
                _ => false,
            };
            ("RegExp", is_regexp)
        }
        _ => return None,
    };
    is_inferrable.then_some(name)
}

/// `at`: the range of ESLint's node. `removes_token_before`: whether the fix also removes the `?` or
/// the `!` before the annotation.
fn check<'a>(
    at: impl FnOnce() -> Span,
    annotation: Option<TypeNode<'a>>,
    init: Option<Expr<'a>>,
    removes_token_before: bool,
    cx: &Cx<'a, NoInferrableTypes>,
) {
    let (Some(annotation), Some(init)) = (annotation, init) else {
        return;
    };
    let Some(name) = inferrable_type(annotation, init) else {
        return;
    };
    cx.report(at(), NO_INFERRABLE_TYPE).data("type", name).fix(|fixer| {
        let annotation = annotation.annotation_span();
        let mut fixes = vec![fixer.remove(annotation)];
        if removes_token_before && let Some(token) = fixer.file().token_before(annotation) {
            fixes.push(fixer.remove(token));
        }
        fixes
    });
}

impl Rule for NoInferrableTypes {
    const META: Meta = Meta::typescript("no-inferrable-types", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoInferrableTypes {
            ignore_parameters: object.bool_or("ignoreParameters", false),
            ignore_properties: object.bool_or("ignoreProperties", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.var_decls(|_, declaration, cx| {
            check(|| declaration.span(), declaration.ty(), declaration.init(), false, cx);
        });
        if !self.ignore_parameters {
            on.params(|_, param, cx| {
                if param.default().is_some()
                    && param.func().is_some_and(ast_utils::is_function_with_body)
                {
                    check(
                        || param.span_without_modifiers(),
                        param.ty(),
                        param.default(),
                        param.is_optional(),
                        cx,
                    );
                }
            });
        }
        if !self.ignore_properties {
            on.members(|_, member, cx| {
                // Without its annotation, the type of a `readonly` property is that of the literal.
                if member.kind() != MemberKind::Property
                    || member.init().is_none()
                    || member.flags().intersects(Flags::READONLY | Flags::OPTIONAL | Flags::ABSTRACT)
                {
                    return;
                }
                let is_definite_property = member.flags().contains(Flags::DEFINITE)
                    && !member.flags().contains(Flags::ACCESSOR);
                check(|| member.span(), member.ty(), member.init(), is_definite_property, cx);
            });
        }
    }
}

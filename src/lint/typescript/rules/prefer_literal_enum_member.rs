use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_static_string_value;

/// Require all enum members to be literal values.
pub struct PreferLiteralEnumMember {
    allow_bitwise_expressions: bool,
}

const NOT_LITERAL: Message = Message::new(
    "notLiteral",
    "Explicit enum value must only be a literal value (string or number).",
);
const NOT_LITERAL_OR_BITWISE_EXPRESSION: Message = Message::new(
    "notLiteralOrBitwiseExpression",
    "Explicit enum value must only be a literal value (string or number) or a bitwise expression.",
);

fn has_enum_member(declaration: Enum<'_>, name: &[u8]) -> bool {
    declaration.members().iter().any(|member| {
        member.key().and_then(Key::name).is_some_and(|it| it.bytes() == name)
    })
}

fn is_self_enum_member<'a>(declaration: Enum<'a>, e: Expr<'a>) -> bool {
    let is_the_enum = |obj: Expr<'a>| obj.as_ident() == Some(declaration.name().name());
    match e.kind() {
        ExprKind::Ident(name) => has_enum_member(declaration, name.bytes()),
        ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
        } => {
            is_the_enum(obj)
                && !name.bytes().starts_with(b"#")
                && has_enum_member(declaration, name.bytes())
        }
        ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } if is_the_enum(obj) => match index.kind() {
            ExprKind::Ident(name) => has_enum_member(declaration, name.bytes()),
            _ => get_static_string_value(index)
                .is_some_and(|name| !name.is_empty() && has_enum_member(declaration, &name)),
        },
        _ => false,
    }
}

impl PreferLiteralEnumMember {
    fn is_allowed_initializer<'a>(
        &self,
        declaration: Enum<'a>,
        e: Expr<'a>,
        is_part_of_bitwise_computation: bool,
    ) -> bool {
        // `C = B` is not allowed, `C = A | B` is.
        if is_part_of_bitwise_computation && is_self_enum_member(declaration, e) {
            return true;
        }
        match e.kind() {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Regex(_) => true,
            ExprKind::Template(template) => template.exprs().is_empty(),
            ExprKind::Unary {
                op: UnOp::Minus | UnOp::Plus,
                operand,
            } => self.is_allowed_initializer(declaration, operand, is_part_of_bitwise_computation),
            ExprKind::Unary {
                op: UnOp::BitNot,
                operand,
            } => {
                self.allow_bitwise_expressions
                    && self.is_allowed_initializer(declaration, operand, true)
            }
            ExprKind::Binary {
                op: BinOp::BitAnd | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitOr,
                left,
                right,
            } => {
                self.allow_bitwise_expressions
                    && self.is_allowed_initializer(declaration, left, true)
                    && self.is_allowed_initializer(declaration, right, true)
            }
            _ => false,
        }
    }

    fn check<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        let Some(initializer) = member.init() else {
            return;
        };
        let Node::Stmt(parent) = member.parent() else {
            return;
        };
        let StmtKind::Enum(declaration) = parent.kind() else {
            return;
        };
        if self.is_allowed_initializer(declaration, initializer, false) {
            return;
        }
        let Some(key) = member.key() else {
            return;
        };
        cx.report(
            key.inner_span(cx.file()),
            match self.allow_bitwise_expressions {
                true => NOT_LITERAL_OR_BITWISE_EXPRESSION,
                false => NOT_LITERAL,
            },
        );
    }
}

impl Rule for PreferLiteralEnumMember {
    const META: Meta =
        Meta::typescript("prefer-literal-enum-member", Kind::Suggestion).presets(Presets::STRICT);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferLiteralEnumMember {
            allow_bitwise_expressions: options.object(0).bool_or("allowBitwiseExpressions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.enum_members(Self::check);
    }
}

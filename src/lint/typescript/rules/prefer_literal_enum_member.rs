use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_static_string_value;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

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

/// The names of the members of the enums that have many, by where the enum starts.
type MemberNames<'a> = FxHashMap<u32, FxHashSet<&'a [u8]>>;

fn is_self_enum_member<'a>(declaration: Enum<'a>, e: Expr<'a>, names: &mut MemberNames<'a>) -> bool {
    let is_the_enum = |obj: Expr<'a>| obj.as_ident() == Some(declaration.name().name());
    let mut has_enum_member = |name: &[u8]| {
        let mut names_of_members = declaration.members().iter().filter_map(|member| Some(member.key()?.name()?.bytes()));
        let start = declaration.name().span().start;
        match !names.contains_key(&start) && declaration.members().len() <= 16 {
            true => names_of_members.any(|it| it == name),
            false => names.entry(start).or_insert_with(|| names_of_members.collect()).contains(name),
        }
    };
    match e.kind() {
        ExprKind::Ident(name) => has_enum_member(name.bytes()),
        ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
        } => {
            is_the_enum(obj)
                && !name.bytes().starts_with(b"#")
                && has_enum_member(name.bytes())
        }
        ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } if is_the_enum(obj) => match index.kind() {
            ExprKind::Ident(name) => has_enum_member(name.bytes()),
            _ => get_static_string_value(index)
                .is_some_and(|name| !name.is_empty() && has_enum_member(&name)),
        },
        _ => false,
    }
}

impl PreferLiteralEnumMember {
    fn is_allowed_initializer<'a>(&self, declaration: Enum<'a>, initializer: Expr<'a>, names: &mut MemberNames<'a>) -> bool {
        // What has to be allowed, each with whether it is part of a bitwise computation.
        let mut operands: SmallVec<[(Expr<'a>, bool); 8]> = smallvec::smallvec![(initializer, false)];
        while let Some((e, is_part_of_bitwise_computation)) = operands.pop() {
            // `C = B` is not allowed, `C = A | B` is.
            if is_part_of_bitwise_computation && is_self_enum_member(declaration, e, names) {
                continue;
            }
            let is_allowed = match e.kind() {
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
                } => {
                    operands.push((operand, is_part_of_bitwise_computation));
                    true
                }
                ExprKind::Unary {
                    op: UnOp::BitNot,
                    operand,
                } => {
                    operands.push((operand, true));
                    self.allow_bitwise_expressions
                }
                ExprKind::Binary {
                    op: BinOp::BitAnd | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitOr,
                    left,
                    right,
                } => {
                    operands.extend([(left, true), (right, true)]);
                    self.allow_bitwise_expressions
                }
                _ => false,
            };
            if !is_allowed {
                return false;
            }
        }
        true
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
        if self.is_allowed_initializer(declaration, initializer, &mut cx.state) {
            return;
        }
        let Some(key) = member.key() else {
            return;
        };
        cx.report(
            // oxlint points at the member.
            if cx.language().is_oxlint { member.span() } else { key.inner_span(cx.file()) },
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
    type State<'a> = MemberNames<'a>;

    fn new(options: &Options) -> Self {
        PreferLiteralEnumMember {
            allow_bitwise_expressions: options.object(0).bool_or("allowBitwiseExpressions", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> MemberNames<'a> {
        on.enum_members(Self::check);
        MemberNames::default()
    }
}

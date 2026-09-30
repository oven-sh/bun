// internal/ast/precedence.go: the precedence of expressions, of operators and of type nodes.
use crate::ast::*;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct OperatorPrecedence(pub i32);

impl OperatorPrecedence {
    // Expression: AssignmentExpression, or Expression `,` AssignmentExpression
    pub const COMMA: Self = Self(0);
    // SpreadElement: `...` AssignmentExpression. `Spread` is higher than `Comma` due to how it is parsed in |ElementList|
    pub const SPREAD: Self = Self(1);
    // AssignmentExpression: YieldExpression. AssignmentExpression is broken down into several precedences due to the requirements of the parenthesizer rules.
    pub const YIELD: Self = Self(2);
    // AssignmentExpression: LeftHandSideExpression `=` AssignmentExpression, or LeftHandSideExpression AssignmentOperator AssignmentExpression
    pub const ASSIGNMENT: Self = Self(3);
    // AssignmentExpression: ConditionalExpression. `Conditional` is considered higher than `Assignment` here, but in reality they have the same precedence.
    pub const CONDITIONAL: Self = Self(4);
    // LogicalORExpression: LogicalORExpression `||` LogicalANDExpression
    pub const LOGICAL_OR: Self = Self(5);
    // LogicalANDExpression: LogicalANDExpression `&&` BitwiseORExpression
    pub const LOGICAL_AND: Self = Self(6);
    // BitwiseORExpression: BitwiseORExpression `|` BitwiseXORExpression
    pub const BITWISE_OR: Self = Self(7);
    // BitwiseXORExpression: BitwiseXORExpression `^` BitwiseANDExpression
    pub const BITWISE_XOR: Self = Self(8);
    // BitwiseANDExpression: BitwiseANDExpression `&` EqualityExpression
    pub const BITWISE_AND: Self = Self(9);
    // EqualityExpression: EqualityExpression (`==` | `!=` | `===` | `!==`) RelationalExpression
    pub const EQUALITY: Self = Self(10);
    // RelationalExpression: RelationalExpression (`<` | `>` | `<=` | `>=` | `instanceof` | `in`) ShiftExpression, or [+TypeScript] RelationalExpression `as` Type
    pub const RELATIONAL: Self = Self(11);
    // ShiftExpression: ShiftExpression (`<<` | `>>` | `>>>`) AdditiveExpression
    pub const SHIFT: Self = Self(12);
    // AdditiveExpression: AdditiveExpression (`+` | `-`) MultiplicativeExpression
    pub const ADDITIVE: Self = Self(13);
    // MultiplicativeExpression: MultiplicativeExpression (`*` | `/` | `%`) ExponentiationExpression
    pub const MULTIPLICATIVE: Self = Self(14);
    // ExponentiationExpression: UpdateExpression `**` ExponentiationExpression
    pub const EXPONENTIATION: Self = Self(15);
    // UnaryExpression: `delete`, `void`, `typeof`, `+`, `-`, `~`, `!` UnaryExpression, AwaitExpression, and the prefix `++` and `--`
    pub const UNARY: Self = Self(16);
    // UpdateExpression: LeftHandSideExpression, LeftHandSideExpression `++`, LeftHandSideExpression `--`
    pub const UPDATE: Self = Self(17);
    // LeftHandSideExpression: NewExpression. NewExpression: MemberExpression, or `new` NewExpression
    pub const LEFT_HAND_SIDE: Self = Self(18);
    // LeftHandSideExpression: OptionalExpression. OptionalExpression: (MemberExpression | CallExpression | OptionalExpression) OptionalChain
    pub const OPTIONAL_CHAIN: Self = Self(19);
    // LeftHandSideExpression: CallExpression. MemberExpression: PrimaryExpression, element and property access, tagged template, SuperProperty, MetaProperty, `new` MemberExpression Arguments
    pub const MEMBER: Self = Self(20);
    // PrimaryExpression: `this`, IdentifierReference, Literal, ArrayLiteral, ObjectLiteral, function and class expressions, RegularExpressionLiteral, TemplateLiteral
    pub const PRIMARY: Self = Self(21);
    // PrimaryExpression: CoverParenthesizedExpressionAndArrowParameterList
    pub const PARENTHESES: Self = Self(22);
    pub const LOWEST: Self = Self::COMMA;
    pub const HIGHEST: Self = Self::PARENTHESES;
    pub const DISALLOW_COMMA: Self = Self::YIELD;
    // ShortCircuitExpression: LogicalORExpression, or CoalesceExpression. CoalesceExpression: CoalesceExpressionHead `??` BitwiseORExpression
    pub const COALESCE: Self = Self::LOGICAL_OR;
    // -1 is lower than all other precedences. Returning it will cause binary expression parsing to stop.
    pub const INVALID: Self = Self(-1);
}

fn get_operator(a: Ast<'_>, expression: NodeId) -> Kind {
    match a.kind(expression) {
        Kind::BinaryExpression => a.kind(a.as_binary_expression(expression).operator_token),
        Kind::PrefixUnaryExpression => a.as_prefix_unary_expression(expression).operator,
        Kind::PostfixUnaryExpression => a.as_postfix_unary_expression(expression).operator,
        kind => kind,
    }
}

// Gets the precedence of an expression
pub fn get_expression_precedence(a: Ast<'_>, expression: NodeId) -> OperatorPrecedence {
    let operator = get_operator(a, expression);
    let mut flags = OperatorPrecedenceFlags::NONE;
    if a.kind(expression) == Kind::NewExpression && a.argument_list(expression).is_nil() {
        flags = OperatorPrecedenceFlags::NEW_WITHOUT_ARGUMENTS;
    } else if is_optional_chain(a, expression) {
        flags = OperatorPrecedenceFlags::OPTIONAL_CHAIN;
    }
    get_operator_precedence(a.kind(expression), operator, flags)
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct OperatorPrecedenceFlags(pub i32);

impl OperatorPrecedenceFlags {
    pub const NONE: Self = Self(0);
    pub const NEW_WITHOUT_ARGUMENTS: Self = Self(1 << 0);
    pub const OPTIONAL_CHAIN: Self = Self(1 << 1);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
}

// Gets the precedence of an operator
pub fn get_operator_precedence(
    node_kind: Kind,
    operator_kind: Kind,
    flags: OperatorPrecedenceFlags,
) -> OperatorPrecedence {
    match node_kind {
        Kind::SpreadElement => OperatorPrecedence::SPREAD,
        Kind::YieldExpression => OperatorPrecedence::YIELD,
        // By necessity, this differs from the old compiler to better align with ParenthesizerRules.
        Kind::ArrowFunction => OperatorPrecedence::ASSIGNMENT,
        Kind::ConditionalExpression => OperatorPrecedence::CONDITIONAL,
        Kind::BinaryExpression => match operator_kind {
            Kind::CommaToken => OperatorPrecedence::COMMA,
            Kind::EqualsToken
            | Kind::PlusEqualsToken
            | Kind::MinusEqualsToken
            | Kind::AsteriskAsteriskEqualsToken
            | Kind::AsteriskEqualsToken
            | Kind::SlashEqualsToken
            | Kind::PercentEqualsToken
            | Kind::LessThanLessThanEqualsToken
            | Kind::GreaterThanGreaterThanEqualsToken
            | Kind::GreaterThanGreaterThanGreaterThanEqualsToken
            | Kind::AmpersandEqualsToken
            | Kind::CaretEqualsToken
            | Kind::BarEqualsToken
            | Kind::BarBarEqualsToken
            | Kind::AmpersandAmpersandEqualsToken
            | Kind::QuestionQuestionEqualsToken => OperatorPrecedence::ASSIGNMENT,
            _ => get_binary_operator_precedence(operator_kind),
        },
        Kind::TypeAssertionExpression
        | Kind::NonNullExpression
        | Kind::PrefixUnaryExpression
        | Kind::TypeOfExpression
        | Kind::VoidExpression
        | Kind::DeleteExpression
        | Kind::AwaitExpression => OperatorPrecedence::UNARY,
        Kind::PostfixUnaryExpression => OperatorPrecedence::UPDATE,
        // By necessity, this differs from the old compiler to better align with ParenthesizerRules.
        Kind::PropertyAccessExpression | Kind::ElementAccessExpression => {
            if flags.intersects(OperatorPrecedenceFlags::OPTIONAL_CHAIN) {
                return OperatorPrecedence::OPTIONAL_CHAIN;
            }
            OperatorPrecedence::MEMBER
        }
        Kind::CallExpression => {
            if flags.intersects(OperatorPrecedenceFlags::OPTIONAL_CHAIN) {
                return OperatorPrecedence::OPTIONAL_CHAIN;
            }
            OperatorPrecedence::MEMBER
        }
        // By necessity, this differs from the old compiler to better align with ParenthesizerRules.
        Kind::NewExpression => {
            if flags.intersects(OperatorPrecedenceFlags::NEW_WITHOUT_ARGUMENTS) {
                return OperatorPrecedence::LEFT_HAND_SIDE;
            }
            OperatorPrecedence::MEMBER
        }
        // By necessity, this differs from the old compiler to better align with ParenthesizerRules.
        Kind::TaggedTemplateExpression | Kind::MetaProperty | Kind::ExpressionWithTypeArguments => {
            OperatorPrecedence::MEMBER
        }
        Kind::AsExpression | Kind::SatisfiesExpression => OperatorPrecedence::RELATIONAL,
        Kind::ThisKeyword
        | Kind::SuperKeyword
        | Kind::ImportKeyword
        | Kind::Identifier
        | Kind::PrivateIdentifier
        | Kind::NullKeyword
        | Kind::TrueKeyword
        | Kind::FalseKeyword
        | Kind::NumericLiteral
        | Kind::BigIntLiteral
        | Kind::StringLiteral
        | Kind::ArrayLiteralExpression
        | Kind::ObjectLiteralExpression
        | Kind::FunctionExpression
        | Kind::ClassExpression
        | Kind::RegularExpressionLiteral
        | Kind::NoSubstitutionTemplateLiteral
        | Kind::TemplateExpression
        | Kind::OmittedExpression
        | Kind::JsxElement
        | Kind::JsxSelfClosingElement
        | Kind::JsxFragment
        | Kind::MissingDeclaration => OperatorPrecedence::PRIMARY,
        // By necessity, this differs from the old compiler to support emit.
        Kind::ParenthesizedExpression => OperatorPrecedence::PARENTHESES,
        _ => OperatorPrecedence::INVALID,
    }
}

// Gets the precedence of a binary operator
pub fn get_binary_operator_precedence(operator_kind: Kind) -> OperatorPrecedence {
    match operator_kind {
        Kind::QuestionQuestionToken => OperatorPrecedence::COALESCE,
        Kind::BarBarToken => OperatorPrecedence::LOGICAL_OR,
        Kind::AmpersandAmpersandToken => OperatorPrecedence::LOGICAL_AND,
        Kind::BarToken => OperatorPrecedence::BITWISE_OR,
        Kind::CaretToken => OperatorPrecedence::BITWISE_XOR,
        Kind::AmpersandToken => OperatorPrecedence::BITWISE_AND,
        Kind::EqualsEqualsToken
        | Kind::ExclamationEqualsToken
        | Kind::EqualsEqualsEqualsToken
        | Kind::ExclamationEqualsEqualsToken => OperatorPrecedence::EQUALITY,
        Kind::LessThanToken
        | Kind::GreaterThanToken
        | Kind::LessThanEqualsToken
        | Kind::GreaterThanEqualsToken
        | Kind::InstanceOfKeyword
        | Kind::InKeyword
        | Kind::AsKeyword
        | Kind::SatisfiesKeyword => OperatorPrecedence::RELATIONAL,
        Kind::LessThanLessThanToken
        | Kind::GreaterThanGreaterThanToken
        | Kind::GreaterThanGreaterThanGreaterThanToken => OperatorPrecedence::SHIFT,
        Kind::PlusToken | Kind::MinusToken => OperatorPrecedence::ADDITIVE,
        Kind::AsteriskToken | Kind::SlashToken | Kind::PercentToken => {
            OperatorPrecedence::MULTIPLICATIVE
        }
        Kind::AsteriskAsteriskToken => OperatorPrecedence::EXPONENTIATION,
        // -1 is lower than all other precedences. Returning it will cause binary expression parsing to stop.
        _ => OperatorPrecedence::INVALID,
    }
}

// Gets the leftmost expression of an expression, e.g. `a` in `a.b`, `a[b]`, `a++`, `a+b`, `a?b:c`, `a as B`, etc.
pub fn get_leftmost_expression(a: Ast<'_>, node: NodeId, stop_at_call_expressions: bool) -> NodeId {
    let mut node = node;
    loop {
        match a.kind(node) {
            Kind::PostfixUnaryExpression => {
                node = a.as_postfix_unary_expression(node).operand;
            }
            Kind::BinaryExpression => {
                node = a.as_binary_expression(node).left;
            }
            Kind::ConditionalExpression => {
                node = a.as_conditional_expression(node).condition;
            }
            Kind::TaggedTemplateExpression => {
                node = a.as_tagged_template_expression(node).tag;
            }
            Kind::CallExpression => {
                if stop_at_call_expressions {
                    return node;
                }
                node = a.expression(node);
            }
            Kind::AsExpression
            | Kind::ElementAccessExpression
            | Kind::PropertyAccessExpression
            | Kind::NonNullExpression
            | Kind::PartiallyEmittedExpression
            | Kind::SatisfiesExpression => {
                node = a.expression(node);
            }
            _ => return node,
        }
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct TypePrecedence(pub i32);

impl TypePrecedence {
    // Conditional precedence (lowest). Type[Extends]: ConditionalTypeNode[?Extends]
    pub const CONDITIONAL: Self = Self(0);
    // JSDoc precedence (optional and variadic types). JSDocType: `...`? Type `=`?
    pub const JSDOC: Self = Self(1);
    // Function precedence. FunctionTypeNode[Extends]: TypeParameters? ArrowParameters `=>` Type[?Extends], and ConstructorTypeNode
    pub const FUNCTION: Self = Self(2);
    // Union precedence. UnionTypeNode: `|`? UnionTypeNoBar
    pub const UNION: Self = Self(3);
    // Intersection precedence. IntersectionTypeNode: `&`? IntersectionTypeNoAmpersand
    pub const INTERSECTION: Self = Self(4);
    // TypeOperatorNode precedence. TypeOperatorNode: PostfixType, InferTypeNode, `keyof` TypeOperatorNode, `unique` TypeOperatorNode, `readonly` PostfixType
    pub const TYPE_OPERATOR: Self = Self(5);
    // Postfix precedence. PostfixType: NonArrayType, OptionalTypeNode, ArrayTypeNode, IndexedAccessTypeNode
    pub const POSTFIX: Self = Self(6);
    // NonArray precedence (highest). NonArrayType: KeywordType, LiteralTypeNode, ThisTypeNode, ImportType, TypeQueryNode, MappedTypeNode, TypeLiteralNode, TupleTypeNode, ParenthesizedTypeNode, TypePredicateNode, TypeReferenceNode, TemplateType
    pub const NON_ARRAY: Self = Self(7);
    pub const LOWEST: Self = Self::CONDITIONAL;
    pub const HIGHEST: Self = Self::NON_ARRAY;
}

// Gets the precedence of a TypeNode
pub fn get_type_node_precedence(a: Ast<'_>, n: NodeId) -> TypePrecedence {
    match a.kind(n) {
        Kind::ConditionalType => TypePrecedence::CONDITIONAL,
        Kind::JSDocOptionalType | Kind::JSDocVariadicType => TypePrecedence::JSDOC,
        Kind::FunctionType | Kind::ConstructorType => TypePrecedence::FUNCTION,
        Kind::UnionType => TypePrecedence::UNION,
        Kind::IntersectionType => TypePrecedence::INTERSECTION,
        Kind::TypeOperator => TypePrecedence::TYPE_OPERATOR,
        Kind::InferType => {
            let type_parameter = a.as_infer_type_node(n).type_parameter;
            if !a
                .as_type_parameter_declaration(type_parameter)
                .constraint
                .is_nil()
            {
                // `infer T extends U` must be treated as FunctionTypeNode precedence as the `extends` clause eagerly consumes TypeNode
                return TypePrecedence::FUNCTION;
            }
            TypePrecedence::TYPE_OPERATOR
        }
        Kind::IndexedAccessType | Kind::ArrayType | Kind::OptionalType => TypePrecedence::POSTFIX,
        // TypeQueryNode is actually a NonArrayType, but we treat it as TypeOperatorNode precedence so that it is parenthesized when used in a PostfixType context (e.g., `(typeof C)[]` instead of `typeof C[]`)
        Kind::TypeQuery => TypePrecedence::TYPE_OPERATOR,
        // PropertyAccessExpression and ExpressionWithTypeArguments occur in pseudo-types like `f<T>.C`, where `f` is a generic function and `C` is a local type
        Kind::AnyKeyword
        | Kind::UnknownKeyword
        | Kind::StringKeyword
        | Kind::NumberKeyword
        | Kind::BigIntKeyword
        | Kind::SymbolKeyword
        | Kind::BooleanKeyword
        | Kind::UndefinedKeyword
        | Kind::NeverKeyword
        | Kind::ObjectKeyword
        | Kind::IntrinsicKeyword
        | Kind::VoidKeyword
        | Kind::JSDocAllType
        | Kind::JSDocNullableType
        | Kind::JSDocNonNullableType
        | Kind::LiteralType
        | Kind::TypePredicate
        | Kind::TypeReference
        | Kind::TypeLiteral
        | Kind::TupleType
        | Kind::RestType
        | Kind::ParenthesizedType
        | Kind::ThisType
        | Kind::MappedType
        | Kind::NamedTupleMember
        | Kind::TemplateLiteralType
        | Kind::ImportType
        | Kind::PropertyAccessExpression
        | Kind::ExpressionWithTypeArguments => TypePrecedence::NON_ARRAY,
        // Upstream panics here: the lowest precedence keeps a printed type parenthesized.
        _ => a.unhandled("unhandled TypeNode", n),
    }
}

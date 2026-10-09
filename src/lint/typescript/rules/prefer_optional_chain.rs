use bun_lint::prelude::*;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::{
    get_constrained_type_at_location, get_type_flags, is_type_flag_set,
};
use bun_lint::types::{Literal as LiteralValue, Type, TypeFlags};
use bun_lint::utils::ts_scope::is_reference_to_global_function;
use bun_lint::utils::ts_utils::{
    FixOrSuggest, OperatorPrecedence, get_fix_or_suggest, get_operator_precedence,
    get_operator_precedence_for_node, ts_operator_kind, ts_syntax_kind,
};
use smallvec::{SmallVec, smallvec};

/// Enforce using concise optional chain expressions instead of chained logical ands, negated logical ors, or empty objects.
pub struct PreferOptionalChain {
    allow_potentially_unsafe_fixes_that_modify_the_return_type_i_know_what_im_doing: bool,
    /// The flags of the types that a "loose boolean" operand may have: what `checkAny`,
    /// `checkBigInt`, `checkBoolean`, `checkNumber`, `checkString` and `checkUnknown` say.
    allowed_flags: TypeFlags,
    require_nullish: bool,
}

const OPTIONAL_CHAIN_SUGGEST: Message =
    Message::new("optionalChainSuggest", "Change to an optional chain.");
const PREFER_OPTIONAL_CHAIN: Message = Message::new(
    "preferOptionalChain",
    "Prefer using an optional chain expression instead, as it's more concise and easier to read.",
);

const NULLISH_FLAGS: TypeFlags = TypeFlags::NULL.union(TypeFlags::UNDEFINED);
const MAYBE_UNDEFINED_FLAGS: TypeFlags = TypeFlags::ANY
    .union(TypeFlags::UNKNOWN)
    .union(TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
    .union(TypeFlags::UNDEFINED)
    .union(TypeFlags::VOID);

// ───────────────────────────── compareNodes.ts ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum NodeComparisonResult {
    /// The two nodes are comparably the same.
    Equal,
    /// The left node is a subset of the right node.
    Subset,
    /// The left node is not the same or is a superset of the right node.
    Invalid,
}
use NodeComparisonResult::{Equal, Invalid, Subset};

/// An expression of ESTree, which has two nodes for the root of an optional chain.
#[derive(Copy, Clone)]
enum Compared<'a> {
    /// The `ChainExpression` around the expression.
    Chain(Expr<'a>),
    /// The expression itself. For the root of a chain: what is in the `ChainExpression`.
    Expr(Expr<'a>),
}

/// ESTree's `node.type`, as far as it makes a difference for a comparison.
#[derive(Copy, Clone, PartialEq, Eq)]
enum EsType {
    /// One of those that are a new value each time they are evaluated, or change one. Comparing
    /// it with anything is `Invalid`.
    Incomparable,
    As,
    Await,
    Binary,
    Call,
    Chain,
    Conditional,
    Identifier,
    Import,
    Instantiation,
    Literal,
    Logical,
    Member,
    MetaProperty,
    NonNull,
    PrivateIdentifier,
    Satisfies,
    Sequence,
    Spread,
    Super,
    TaggedTemplate,
    Template,
    This,
    TypeAssertion,
    Unary,
}

impl<'a> Compared<'a> {
    /// `e` as the child of its parent.
    fn of(e: Expr<'a>) -> Self {
        match e.is_chain_root() {
            true => Compared::Chain(e),
            false => Compared::Expr(e),
        }
    }

    fn expr(self) -> Expr<'a> {
        match self {
            Compared::Chain(e) | Compared::Expr(e) => e,
        }
    }

    fn es_type(self) -> EsType {
        let e = match self {
            Compared::Chain(_) => return EsType::Chain,
            Compared::Expr(e) => e,
        };
        match e.kind() {
            ExprKind::Missing
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Assign { .. }
            | ExprKind::Yield { .. }
            | ExprKind::Jsx(_)
            | ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => EsType::Incomparable,
            ExprKind::Ident(_) => EsType::Identifier,
            ExprKind::PrivateIdentifier(_) => EsType::PrivateIdentifier,
            ExprKind::This => EsType::This,
            ExprKind::Super => EsType::Super,
            ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => EsType::Literal,
            ExprKind::Template(_) => EsType::Template,
            ExprKind::TaggedTemplate(_) => EsType::TaggedTemplate,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => EsType::Member,
            ExprKind::Call(_) => EsType::Call,
            ExprKind::Unary { .. } => EsType::Unary,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => EsType::Logical,
            ExprKind::Binary { op: BinOp::Comma, .. } => EsType::Sequence,
            ExprKind::Binary { .. } => EsType::Binary,
            ExprKind::Cond { .. } => EsType::Conditional,
            ExprKind::Spread(_) => EsType::Spread,
            ExprKind::Await(_) => EsType::Await,
            ExprKind::As { .. } | ExprKind::AsConst(_) => match e.is_angle_bracket_assertion() {
                true => EsType::TypeAssertion,
                false => EsType::As,
            },
            ExprKind::Satisfies { .. } => EsType::Satisfies,
            ExprKind::NonNull(_) => EsType::NonNull,
            ExprKind::Instantiation { .. } => EsType::Instantiation,
            ExprKind::ImportCall { .. } => EsType::Import,
            ExprKind::ImportMeta | ExprKind::NewTarget => EsType::MetaProperty,
        }
    }

    /// The `expression` of a `TSNonNullExpression`.
    fn non_null_operand(self) -> Option<Self> {
        match self {
            Compared::Expr(e) => match e.kind() {
                ExprKind::NonNull(operand) => Some(Compared::of(operand)),
                _ => None,
            },
            Compared::Chain(_) => None,
        }
    }
}

/// `isValidChainExpressionToLookThrough`, for the `ChainExpression` around `e`: not that of
/// `(a?.b).c` or `(a?.b)()`, where the parentheses mean something.
fn is_valid_chain_expression_to_look_through(e: Expr) -> bool {
    let Node::Expr(parent) = e.parent() else {
        return true;
    };
    match parent.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj != e,
        ExprKind::Call(call) => call.callee() != e,
        _ => true,
    }
}

#[derive(Copy, Clone)]
enum Property<'a> {
    Name(Ident<'a>),
    Computed(Expr<'a>),
}

/// The `object` and the `property` of a `MemberExpression`.
fn as_member_expression(e: Expr<'_>) -> Option<(Expr<'_>, Property<'_>)> {
    match e.kind() {
        ExprKind::Dot { obj, name, .. } => Some((obj, Property::Name(name))),
        ExprKind::Index { obj, index, .. } => Some((obj, Property::Computed(index))),
        _ => None,
    }
}

fn is_private_identifier(property: Property) -> bool {
    matches!(property, Property::Name(name) if name.bytes().starts_with(b"#"))
}

/// `compareArrays`
fn all_equal<T: Copy>(
    mut a: impl Iterator<Item = T>,
    mut b: impl Iterator<Item = T>,
    mut is_equal: impl FnMut(T, T) -> bool,
) -> bool {
    loop {
        match (a.next(), b.next()) {
            (None, None) => return true,
            (Some(a), Some(b)) if is_equal(a, b) => {}
            _ => return false,
        }
    }
}

fn compare_entity_names<'a>(a: EntityName<'a>, b: EntityName<'a>) -> bool {
    a.len() == b.len() && a.parts().zip(b.parts()).all(|(a, b)| a.name() == b.name())
}

/// For the `exprName` of two `TSTypeQuery`.
fn compare_type_query_names<'a>(mut a: Expr<'a>, mut b: Expr<'a>) -> bool {
    loop {
        match (a.kind(), b.kind()) {
            (ExprKind::Ident(a), ExprKind::Ident(b)) => return a == b,
            (ExprKind::This, ExprKind::This) => return true,
            (
                ExprKind::Dot {
                    obj: left_a,
                    name: right_a,
                    ..
                },
                ExprKind::Dot {
                    obj: left_b,
                    name: right_b,
                    ..
                },
            ) if right_a.name() == right_b.name() => (a, b) = (left_a, left_b),
            _ => return false,
        }
    }
}

/// Whether a number in a type has a `-`, which makes it a `UnaryExpression`, and its `raw`.
fn signed_literal(ty: TypeNode<'_>) -> (bool, &[u8]) {
    let text = ty.text();
    match text.strip_prefix(b"-") {
        Some(raw) => (true, raw.trim_ascii_start()),
        None => (false, text),
    }
}

/// The `typeAnnotation` of a `TSTypeOperator`. That of `unique symbol`, which is not a node here,
/// is `None`.
fn as_type_operator(ty: TypeNode<'_>) -> Option<Option<TypeNode<'_>>> {
    match ty.kind() {
        TypeKind::Keyof(operand) | TypeKind::Readonly(operand) => Some(Some(operand)),
        TypeKind::UniqueSymbol => Some(None),
        _ => None,
    }
}

/// How many member accesses and calls `node` consists of, down to what the first of them is applied to.
fn chain_length(node: Compared) -> u32 {
    let (mut e, mut length) = (node.expr(), 0);
    loop {
        e = match e.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) => call.callee(),
            ExprKind::NonNull(operand) => {
                e = operand;
                continue;
            }
            _ => return length,
        };
        length += 1;
    }
}

/// `compareNodes`
pub struct Comparer {
    stack: bun_core::StackCheck,
}

impl Comparer {
    /// Whether `a` is equal to or a subset of `b`.
    ///
    /// Upstream compares `a` with each of the chains that `b` begins with, and for each of these what the two begin with in
    /// turn. Two chains that are equal have the same [length](chain_length), and a subset is not longer than what it is a subset
    /// of. So the lengths tell which comparisons can succeed: one for each link of `b`, which a loop goes through.
    fn compare_nodes<'a>(&self, mut a: Compared<'a>, mut b: Compared<'a>) -> NodeComparisonResult {
        if !self.stack.is_safe_to_recurse() {
            return Invalid;
        }
        let (mut length_a, mut length_b) = (chain_length(a), chain_length(b));
        // Links have been taken off `b`: whatever `a` is of the rest, it is a subset of the whole.
        let mut is_shortened = false;
        // What is left of the two has to be equal, and if it is, what has been taken off both is `if_equal`.
        let (mut must_be_equal, mut if_equal) = (false, Equal);
        loop {
            if length_a > length_b || must_be_equal && length_a != length_b {
                return Invalid;
            }
            let (type_a, type_b) = (a.es_type(), b.es_type());
            if type_a == EsType::Incomparable || type_b == EsType::Incomparable {
                return Invalid;
            }

            if type_a != type_b {
                if let Compared::Chain(e) = a
                    && is_valid_chain_expression_to_look_through(e)
                {
                    a = Compared::Expr(e);
                    continue;
                }
                if let Compared::Chain(e) = b
                    && is_valid_chain_expression_to_look_through(e)
                {
                    b = Compared::Expr(e);
                    continue;
                }
                if let Some(expression) = a.non_null_operand() {
                    a = expression;
                    continue;
                }
                if let Some(expression) = b.non_null_operand() {
                    b = expression;
                    continue;
                }
                if must_be_equal
                    || !matches!(
                        type_a,
                        EsType::Call | EsType::Identifier | EsType::Member | EsType::MetaProperty
                    )
                {
                    return Invalid;
                }
                let Compared::Expr(longer) = b else {
                    return Invalid;
                };
                let shorter = match (as_member_expression(longer), longer.kind()) {
                    (Some((_, property)), _) if is_private_identifier(property) => return Invalid,
                    (Some((object, _)), _) => object,
                    (None, ExprKind::Call(call)) => call.callee(),
                    _ => return Invalid,
                };
                (b, length_b, is_shortened) = (Compared::of(shorter), length_b.saturating_sub(1), true);
                continue;
            }

            let (node_a, node_b) = match (a, b) {
                (Compared::Chain(_), Compared::Chain(e)) => {
                    b = Compared::Expr(e);
                    continue;
                }
                (Compared::Expr(node_a), Compared::Expr(node_b)) => (node_a, node_b),
                _ => return Invalid,
            };
            match (node_a.kind(), node_b.kind()) {
                (ExprKind::Call(call_a), ExprKind::Call(call_b)) => {
                    // `foo() && foo()(bar)`
                    if length_a < length_b {
                        (b, length_b, is_shortened) = (Compared::of(call_b.callee()), length_b - 1, true);
                        continue;
                    }
                    if !self.compare_arrays(call_a.args(), call_b.args())
                        || !self.compare_type_lists(call_a.type_args(), call_b.type_args())
                    {
                        return Invalid;
                    }
                    (a, b) = (Compared::of(call_a.callee()), Compared::of(call_b.callee()));
                }
                (ExprKind::Dot { .. } | ExprKind::Index { .. }, ExprKind::Dot { .. } | ExprKind::Index { .. }) => {
                    let (Some((object_a, property_a)), Some((object_b, property_b))) =
                        (as_member_expression(node_a), as_member_expression(node_b))
                    else {
                        return Invalid;
                    };
                    if is_private_identifier(property_b) {
                        return Invalid;
                    }
                    // `foo.bar && foo.bar.baz`
                    if length_a < length_b {
                        (b, length_b, is_shortened) = (Compared::of(object_b), length_b - 1, true);
                        continue;
                    }
                    match (property_a, property_b) {
                        (Property::Name(name_a), Property::Name(name_b)) if name_a.name() == name_b.name() => {}
                        (Property::Computed(index_a), Property::Computed(index_b)) => {
                            let result = self.compare_nodes(Compared::of(index_a), Compared::of(index_b));
                            if result == Invalid || must_be_equal && result != Equal {
                                return Invalid;
                            }
                            if !must_be_equal {
                                if_equal = result;
                            }
                        }
                        _ => return Invalid,
                    }
                    (a, b) = (Compared::of(object_a), Compared::of(object_b));
                }
                (ExprKind::NonNull(operand_a), ExprKind::NonNull(operand_b)) => {
                    (a, b, must_be_equal) = (Compared::of(operand_a), Compared::of(operand_b), true);
                    continue;
                }
                _ => {
                    return match (self.compare_same_type(node_a, node_b), is_shortened) {
                        (Invalid, _) => Invalid,
                        (_, true) => Subset,
                        (_, false) => if_equal,
                    };
                }
            }
            (length_a, length_b, must_be_equal) = (length_a.saturating_sub(1), length_b.saturating_sub(1), true);
        }
    }

    fn is_equal<'a>(&self, a: Expr<'a>, b: Expr<'a>) -> bool {
        self.compare_nodes(Compared::of(a), Compared::of(b)) == Equal
    }

    fn compare_arrays<'a>(&self, a: List<'a, Expr<'a>>, b: List<'a, Expr<'a>>) -> bool {
        all_equal(a.iter(), b.iter(), |a, b| self.is_equal(a, b))
    }

    /// For two nodes of the same type that is neither `ChainExpression` nor incomparable, and that are not links of a chain.
    fn compare_same_type<'a>(&self, a: Expr<'a>, b: Expr<'a>) -> NodeComparisonResult {
        use ExprKind as K;
        let is_equal = match (a.kind(), b.kind()) {
            (K::Ident(a), K::Ident(b)) | (K::PrivateIdentifier(a), K::PrivateIdentifier(b)) => a == b,
            // The `value` of each is an object of its own.
            (K::Regex(_), _) | (_, K::Regex(_)) => false,
            (K::Null | K::True | K::False | K::Number(_) | K::String(_) | K::BigInt(_), _) => {
                a.text() == b.text()
            }
            // The expressions are not compared.
            (K::Template(a), K::Template(b)) => {
                a.quasi_count() == b.quasi_count()
                    && (0..a.quasi_count()).all(|i| a.cooked(i) == b.cooked(i))
            }
            (K::This, K::This)
            | (K::Super, K::Super)
            | (K::ImportMeta, K::ImportMeta)
            | (K::NewTarget, K::NewTarget) => true,
            (K::Await(a), K::Await(b))
            | (K::Spread(a), K::Spread(b))
            | (K::AsConst(a), K::AsConst(b))
            // Nor are the operators.
            | (K::Unary { operand: a, .. }, K::Unary { operand: b, .. }) => self.is_equal(a, b),
            (K::Binary { op: BinOp::Comma, .. }, _) => {
                all_equal(a.sequence().into_iter(), b.sequence().into_iter(), |a, b| self.is_equal(a, b))
            }
            (
                K::Binary {
                    left: left_a,
                    right: right_a,
                    ..
                },
                K::Binary {
                    left: left_b,
                    right: right_b,
                    ..
                },
            ) => self.is_equal(left_a, left_b) && self.is_equal(right_a, right_b),
            (
                K::Cond {
                    test: test_a,
                    yes: yes_a,
                    no: no_a,
                },
                K::Cond {
                    test: test_b,
                    yes: yes_b,
                    no: no_b,
                },
            ) => self.is_equal(test_a, test_b) && self.is_equal(yes_a, yes_b) && self.is_equal(no_a, no_b),
            (K::ImportCall { args: a }, K::ImportCall { args: b }) => self.compare_arrays(a, b),
            (K::TaggedTemplate(a), K::TaggedTemplate(b)) => {
                self.is_equal(a.callee(), b.callee())
                    && self.compare_type_lists(a.type_args(), b.type_args())
                    && match (a.template(), b.template()) {
                        (Some(a), Some(b)) => self.is_equal(a, b),
                        _ => false,
                    }
            }
            (K::As { expr: a, ty: type_a }, K::As { expr: b, ty: type_b })
            | (K::Satisfies { expr: a, ty: type_a }, K::Satisfies { expr: b, ty: type_b }) => {
                self.is_equal(a, b) && self.compare_types(type_a, type_b)
            }
            (
                K::Instantiation {
                    expr: a,
                    type_args: type_args_a,
                },
                K::Instantiation {
                    expr: b,
                    type_args: type_args_b,
                },
            ) => self.is_equal(a, b) && self.compare_type_lists(type_args_a, type_args_b),
            _ => false,
        };
        if is_equal { Equal } else { Invalid }
    }

    /// Also for two `TSTypeParameterInstantiation` or `null`.
    fn compare_type_lists<'a>(&self, a: List<'a, TypeNode<'a>>, b: List<'a, TypeNode<'a>>) -> bool {
        all_equal(a.iter(), b.iter(), |a, b| self.compare_types(a, b))
    }

    fn compare_optional_types<'a>(&self, a: Option<TypeNode<'a>>, b: Option<TypeNode<'a>>) -> bool {
        match (a, b) {
            (None, None) => true,
            (Some(a), Some(b)) => self.compare_types(a, b),
            _ => false,
        }
    }

    /// `compareByVisiting` for types: only what is a node of ESTree is compared, so `keyof T` is
    /// `readonly T`, and `(a: A) => R` is `(a?: B) => R`.
    fn compare_types<'a>(&self, a: TypeNode<'a>, b: TypeNode<'a>) -> bool {
        use TypeKind as K;
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        if let (Some(operand_a), Some(operand_b)) = (as_type_operator(a), as_type_operator(b)) {
            return match (operand_a, operand_b) {
                (None, None) => true,
                (Some(a), Some(b)) => self.compare_types(a, b),
                (Some(operand), None) | (None, Some(operand)) => operand.is_keyword(Keyword::Symbol),
            };
        }
        match (a.kind(), b.kind()) {
            (K::Keyword(a), K::Keyword(b)) => a == b,
            (
                K::Ref {
                    name: name_a,
                    args: args_a,
                },
                K::Ref {
                    name: name_b,
                    args: args_b,
                },
            ) => compare_entity_names(name_a, name_b) && self.compare_type_lists(args_a, args_b),
            (K::StringLit(value_a), K::StringLit(value_b)) => {
                match (a.text().starts_with(b"`"), b.text().starts_with(b"`")) {
                    (true, true) => value_a == value_b,
                    (false, false) => a.text() == b.text(),
                    _ => false,
                }
            }
            (K::BoolLit(a), K::BoolLit(b)) => a == b,
            (K::NumberLit(_) | K::BigIntLit { .. }, K::NumberLit(_) | K::BigIntLit { .. }) => {
                signed_literal(a) == signed_literal(b)
            }
            // The types are not compared.
            (K::Template(_), K::Template(_)) => match (a.as_template(), b.as_template()) {
                (Some(a), Some(b)) => {
                    a.quasi_count() == b.quasi_count()
                        && (0..a.quasi_count()).all(|i| a.cooked(i) == b.cooked(i))
                }
                _ => false,
            },
            (K::Array(a), K::Array(b)) => self.compare_types(a, b),
            (K::Tuple(a), K::Tuple(b)) => {
                all_equal(a.iter(), b.iter(), |a, b| self.compare_tuple_elements(a, b))
            }
            (K::Union(a), K::Union(b)) | (K::Intersection(a), K::Intersection(b)) => {
                self.compare_type_lists(a, b)
            }
            (K::Fn(a), K::Fn(b)) => a.kind() == b.kind() && self.compare_function_types(a, b),
            (K::Object(a), K::Object(b)) => all_equal(a.iter(), b.iter(), |a, b| self.compare_members(a, b)),
            (
                K::Cond {
                    check: check_a,
                    extends: extends_a,
                    yes: yes_a,
                    no: no_a,
                },
                K::Cond {
                    check: check_b,
                    extends: extends_b,
                    yes: yes_b,
                    no: no_b,
                },
            ) => {
                self.compare_types(check_a, check_b)
                    && self.compare_types(extends_a, extends_b)
                    && self.compare_types(yes_a, yes_b)
                    && self.compare_types(no_a, no_b)
            }
            (K::Infer(a), K::Infer(b)) => self.compare_type_parameters(a, b),
            (K::Mapped(a), K::Mapped(b)) => {
                a.param().name().name() == b.param().name().name()
                    && self.compare_optional_types(a.param().constraint(), b.param().constraint())
                    && self.compare_optional_types(a.name_type(), b.name_type())
                    && self.compare_optional_types(a.ty(), b.ty())
            }
            (
                K::IndexedAccess {
                    obj: object_a,
                    index: index_a,
                },
                K::IndexedAccess {
                    obj: object_b,
                    index: index_b,
                },
            ) => self.compare_types(object_a, object_b) && self.compare_types(index_a, index_b),
            (
                K::Typeof {
                    expr: name_a,
                    args: args_a,
                },
                K::Typeof {
                    expr: name_b,
                    args: args_b,
                },
            ) => compare_type_query_names(name_a, name_b) && self.compare_type_lists(args_a, args_b),
            (
                K::Import {
                    name: name_a,
                    args: args_a,
                    is_typeof: is_typeof_a,
                    ..
                },
                K::Import {
                    name: name_b,
                    args: args_b,
                    is_typeof: is_typeof_b,
                    ..
                },
            ) => {
                let file = a.file();
                let source = |ty: TypeNode<'a>| ty.import_source_span().map(|span| file.slice(span));
                is_typeof_a == is_typeof_b
                    && source(a) == source(b)
                    // The `options` are an `ObjectExpression`.
                    && a.import_attributes().is_none()
                    && b.import_attributes().is_none()
                    && compare_entity_names(name_a, name_b)
                    && self.compare_type_lists(args_a, args_b)
            }
            (
                K::Predicate {
                    param: param_a,
                    ty: type_a,
                    ..
                },
                K::Predicate {
                    param: param_b,
                    ty: type_b,
                    ..
                },
            ) => param_a == param_b && self.compare_optional_types(type_a, type_b),
            _ => false,
        }
    }

    fn compare_tuple_elements<'a>(&self, a: TupleElem<'a>, b: TupleElem<'a>) -> bool {
        a.is_rest() == b.is_rest()
            && a.name().map(Ident::name) == b.name().map(Ident::name)
            && (a.name().is_some() || a.is_optional() == b.is_optional())
            && self.compare_types(a.ty(), b.ty())
    }

    fn compare_type_parameters<'a>(&self, a: TypeParam<'a>, b: TypeParam<'a>) -> bool {
        a.name().name() == b.name().name()
            && self.compare_optional_types(a.constraint(), b.constraint())
            && self.compare_optional_types(a.default(), b.default())
    }

    /// An `Identifier` is its name. Only a `RestElement` is compared with its type.
    fn compare_parameters<'a>(&self, a: Param<'a>, b: Param<'a>) -> bool {
        let (PatKind::Ident(name_a), PatKind::Ident(name_b)) = (a.pat().kind(), b.pat().kind()) else {
            return false;
        };
        name_a == name_b
            && a.is_rest() == b.is_rest()
            && (!a.is_rest() || self.compare_optional_types(a.ty(), b.ty()))
    }

    /// `typeParameters`, `params` and `returnType`.
    fn compare_function_types<'a>(&self, a: Func<'a>, b: Func<'a>) -> bool {
        all_equal(a.type_params().iter(), b.type_params().iter(), |a, b| self.compare_type_parameters(a, b))
            && all_equal(a.params_with_this(), b.params_with_this(), |a, b| self.compare_parameters(a, b))
            && self.compare_optional_types(a.return_type(), b.return_type())
    }

    /// `computed` is not compared.
    fn compare_keys<'a>(&self, file: &File<'a>, a: Key<'a>, b: Key<'a>) -> bool {
        match (a.kind(), b.kind()) {
            (KeyKind::Ident(a), KeyKind::Ident(b)) => a == b,
            (KeyKind::Computed(a), KeyKind::Computed(b)) => self.is_equal(a, b),
            (KeyKind::Ident(name), KeyKind::Computed(e)) | (KeyKind::Computed(e), KeyKind::Ident(name)) => {
                e.as_ident() == Some(name)
            }
            (KeyKind::Ident(_) | KeyKind::Computed(_), _) | (_, KeyKind::Ident(_) | KeyKind::Computed(_)) => false,
            _ => file.slice(a.inner_span(file)) == file.slice(b.inner_span(file)),
        }
    }

    /// For two members of a `TSTypeLiteral`.
    fn compare_members<'a>(&self, a: Member<'a>, b: Member<'a>) -> bool {
        // The three are a `TSMethodSignature`.
        let es_type = |member: Member| match member.kind() {
            MemberKind::Getter | MemberKind::Setter => MemberKind::Method,
            kind => kind,
        };
        es_type(a) == es_type(b)
            && match (a.key(), b.key()) {
                (None, None) => true,
                (Some(key_a), Some(key_b)) => self.compare_keys(a.file(), key_a, key_b),
                _ => false,
            }
            && match (a.func(), b.func()) {
                (None, None) => self.compare_optional_types(a.ty(), b.ty()),
                (Some(a), Some(b)) => self.compare_function_types(a, b),
                _ => false,
            }
    }
}

// ───────────────────────────── gatherLogicalOperands.ts ─────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
enum Yoda {
    Yes,
    No,
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ComparisonValueType {
    Null,
    Undefined,
    UndefinedStringLiteral,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum NullishComparisonType {
    /// `x != null`, `x != undefined`
    NotEqualNullOrUndefined,
    /// `x == null`, `x == undefined`
    EqualNullOrUndefined,
    /// `x !== null`
    NotStrictEqualNull,
    /// `x === null`
    StrictEqualNull,
    /// `x !== undefined`, `typeof x !== 'undefined'`
    NotStrictEqualUndefined,
    /// `x === undefined`, `typeof x === 'undefined'`
    StrictEqualUndefined,
    /// `!x`
    NotBoolean,
    /// `x`
    Boolean,
    /// None of these: the [`ComparisonType`] of a [`LastChainOperand`] that is reported.
    Other,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ComparisonType {
    NotEqual,
    Equal,
    NotStrictEqual,
    StrictEqual,
}

#[derive(Copy, Clone)]
struct ValidOperand<'a> {
    compared_name: Compared<'a>,
    comparison_type: NullishComparisonType,
    is_yoda: bool,
    node: Expr<'a>,
}

#[derive(Copy, Clone)]
struct LastChainOperand<'a> {
    compared_name: Expr<'a>,
    comparison_type: ComparisonType,
    comparison_value: Expr<'a>,
    yoda: Yoda,
    node: Expr<'a>,
}

enum Operand<'a> {
    Valid(ValidOperand<'a>),
    Last(LastChainOperand<'a>),
    Invalid,
}

type Operands<'a> = SmallVec<[ValidOperand<'a>; 8]>;

/// The operands of `left operator right`, through the operands with the same operator.
fn flatten_logical_operands<'a>(operator: BinOp, left: Expr<'a>, right: Expr<'a>) -> SmallVec<[Expr<'a>; 8]> {
    let mut operands = SmallVec::new();
    let mut stack: SmallVec<[Expr<'a>; 8]> = smallvec![right, left];
    while let Some(current) = stack.pop() {
        match current.kind() {
            ExprKind::Binary { op, left, right } if op == operator => {
                stack.push(right);
                stack.push(left);
            }
            _ => operands.push(current),
        }
    }
    operands
}

/// Whether `operand` tests a member access or a call. Nothing else can be what another operand is
/// a subset of.
fn tests_member_or_call(operand: Expr) -> bool {
    fn is_member_or_call(mut e: Expr) -> bool {
        if let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = e.kind()
        {
            e = operand;
        }
        while let ExprKind::NonNull(operand) = e.kind() {
            e = operand;
        }
        matches!(e.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::Call)
    }
    match operand.kind() {
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
            ..
        } => false,
        ExprKind::Binary { left, right, .. } => is_member_or_call(left) || is_member_or_call(right),
        ExprKind::Unary {
            op: UnOp::Not,
            operand,
        } => is_member_or_call(operand),
        _ => is_member_or_call(operand),
    }
}

fn get_comparison_value_type(node: Expr) -> Option<ComparisonValueType> {
    match node.kind() {
        ExprKind::Null => Some(ComparisonValueType::Null),
        ExprKind::String(value) if value.is("undefined") => Some(ComparisonValueType::UndefinedStringLiteral),
        ExprKind::Ident(name) if name.is("undefined") => Some(ComparisonValueType::Undefined),
        _ => None,
    }
}

/// A `MemberExpression`, which the root of an optional chain is not.
fn is_member_expression(node: Expr) -> bool {
    matches!(node.tag(), ExprTag::Dot | ExprTag::Index) && !node.is_chain_root()
}

fn is_member_based_expression(node: Expr) -> bool {
    is_member_expression(node)
        || matches!(node.kind(), ExprKind::Call(call) if is_member_expression(call.callee()) && !node.is_chain_root())
}

/// `false`, `''`, `0` or `0n`. `flags`: those of `ty`.
fn is_falsy_literal_type(ty: Type, flags: TypeFlags) -> bool {
    if flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
        return ty.intrinsic_name() == Some("false");
    }
    if !flags.intersects(TypeFlags::STRING_LITERAL | TypeFlags::NUMBER_LITERAL | TypeFlags::BIG_INT_LITERAL) {
        return false;
    }
    match ty.value() {
        Some(LiteralValue::String(value)) => value.is_empty(),
        Some(LiteralValue::Number(value)) => value == 0.0,
        Some(LiteralValue::BigInt { base10, .. }) => base10 == b"0",
        None => false,
    }
}

impl PreferOptionalChain {
    fn is_valid_false_boolean_check_type(&self, node: Expr, disallow_falsey_literal: bool) -> bool {
        let ty = node.ty();
        if ty.is_unresolved() {
            return false;
        }
        union_constituents(ty).iter().all(|ty| {
            intersection_constituents(ty).iter().all(|part| {
                let flags = get_type_flags(part);
                // The test narrows these out, which `?.` does not.
                !(disallow_falsey_literal && is_falsy_literal_type(part, flags))
                    && flags.intersects(self.allowed_flags)
            })
        })
    }

    /// What `gatherLogicalOperands` makes of the `BinaryExpression` `operand`, which is
    /// `left op right`.
    fn get_binary_operand<'a>(
        operator: BinOp,
        operand: Expr<'a>,
        op: BinOp,
        left: Expr<'a>,
        right: Expr<'a>,
    ) -> Operand<'a> {
        use NullishComparisonType as T;
        let is_negated = matches!(op, BinOp::NotEq | BinOp::NotEqEq);
        let (compared_expression, compared_value, is_yoda) = match get_comparison_value_type(right) {
            Some(value) => (left, Some(value), false),
            None => (right, get_comparison_value_type(left), true),
        };
        let valid = |compared_name: Expr<'a>, comparison_type: T| {
            Operand::Valid(ValidOperand {
                compared_name: Compared::of(compared_name),
                comparison_type,
                is_yoda,
                node: operand,
            })
        };

        if compared_value == Some(ComparisonValueType::UndefinedStringLiteral) {
            let ExprKind::Unary {
                op: UnOp::Typeof,
                operand: argument,
            } = compared_expression.kind()
            else {
                return Operand::Invalid;
            };
            // `typeof window === 'undefined'`
            if let ExprKind::Ident(name) = argument.kind()
                && is_reference_to_global_function(name, argument)
            {
                return Operand::Invalid;
            }
            return valid(
                argument,
                if is_negated { T::NotStrictEqualUndefined } else { T::StrictEqualUndefined },
            );
        }

        if is_negated != (operator == BinOp::Or) {
            let comparison_type = match (op, compared_value) {
                (BinOp::NotEq, Some(_)) => Some(T::NotEqualNullOrUndefined),
                (BinOp::EqEq, Some(_)) => Some(T::EqualNullOrUndefined),
                (BinOp::NotEqEq, Some(ComparisonValueType::Null)) => Some(T::NotStrictEqualNull),
                (BinOp::EqEqEq, Some(ComparisonValueType::Null)) => Some(T::StrictEqualNull),
                (BinOp::NotEqEq, Some(ComparisonValueType::Undefined)) => Some(T::NotStrictEqualUndefined),
                (BinOp::EqEqEq, Some(ComparisonValueType::Undefined)) => Some(T::StrictEqualUndefined),
                _ => None,
            };
            if let Some(comparison_type) = comparison_type {
                return valid(compared_expression, comparison_type);
            }
        }

        let comparison_type = match op {
            BinOp::EqEq => ComparisonType::Equal,
            BinOp::EqEqEq => ComparisonType::StrictEqual,
            BinOp::NotEq => ComparisonType::NotEqual,
            BinOp::NotEqEq => ComparisonType::NotStrictEqual,
            _ => return Operand::Invalid,
        };
        let (compared_name, comparison_value, yoda) =
            match (is_member_based_expression(left), is_member_based_expression(right)) {
                (true, false) => (left, right, Yoda::No),
                (false, true) => (right, left, Yoda::Yes),
                // tsgolint 7.0 leaves it alone: when the other side is evaluated would change.
                (true, true) if operand.file().language().is_oxlint => return Operand::Invalid,
                (true, true) => (left, right, Yoda::Unknown),
                (false, false) => return Operand::Invalid,
            };
        Operand::Last(LastChainOperand {
            compared_name,
            comparison_type,
            comparison_value,
            yoda,
            node: operand,
        })
    }

    /// What `gatherLogicalOperands` makes of one of the operands of `operator`.
    fn get_operand<'a>(&self, operator: BinOp, operand: Expr<'a>, are_more_operands: bool) -> Operand<'a> {
        let (compared_name, comparison_type) = match operand.kind() {
            // Mixed logical expressions are ignored.
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => return Operand::Invalid,
            ExprKind::Binary { op, left, right } if op != BinOp::Comma => {
                return Self::get_binary_operand(operator, operand, op, left, right);
            }
            ExprKind::Unary {
                op: UnOp::Not,
                operand: argument,
            } => (argument, NullishComparisonType::NotBoolean),
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Typeof | UnOp::Void | UnOp::Delete,
                ..
            } => return Operand::Invalid,
            _ => (operand, NullishComparisonType::Boolean),
        };
        let disallow_falsey_literal = match comparison_type {
            NullishComparisonType::NotBoolean => operator == BinOp::Or,
            _ => operator == BinOp::And,
        };
        if are_more_operands && !self.is_valid_false_boolean_check_type(compared_name, disallow_falsey_literal) {
            return Operand::Invalid;
        }
        Operand::Valid(ValidOperand {
            compared_name: Compared::of(compared_name),
            comparison_type,
            is_yoda: false,
            node: operand,
        })
    }
}

// ───────────────────────────── analyzeChain.ts ─────────────────────────────

fn includes_type(node: Expr, type_flag: TypeFlags) -> bool {
    let type_flag = type_flag | TypeFlags::ANY | TypeFlags::UNKNOWN;
    union_constituents(node.ty()).iter().any(|ty| is_type_flag_set(ty, type_flag))
}

/// tsgolint's `wouldChangeReturnType`: among the types of `node` is that of a literal, as in `boolean`, and neither
/// `null` nor `undefined`.
fn tsgolint_would_change_return_type(node: Expr) -> bool {
    let literal =
        TypeFlags::BOOLEAN_LITERAL | TypeFlags::NUMBER_LITERAL | TypeFlags::STRING_LITERAL | TypeFlags::BIG_INT_LITERAL;
    let types = union_constituents(node.ty());
    types.iter().any(|ty| is_type_flag_set(ty, literal)) && !types.iter().any(|ty| is_type_flag_set(ty, NULLISH_FLAGS))
}

/// Where the chain ends early, what follows it compares `undefined`. tsgolint 7.0 leaves the whole chain alone if that
/// decides otherwise than the chain did: `a && a.b && a.b.c == null`, `!a || !a.b || a.b.c != null`. `operand` goes on
/// where the chain ends and is not part of it. `first`: what the chain starts with.
fn tsgolint_leaves_chain_before(operator: BinOp, first: NullishComparisonType, operand: ValidOperand) -> bool {
    use NullishComparisonType as T;
    let is_typeof = |e: Expr| matches!(e.kind(), ExprKind::Unary { op: UnOp::Typeof, .. });
    if matches!(operand.node.kind(), ExprKind::Binary { left, right, .. } if is_typeof(left) || is_typeof(right)) {
        return false;
    }
    match (operator, operand.comparison_type) {
        (BinOp::And, T::EqualNullOrUndefined | T::StrictEqualUndefined | T::NotStrictEqualNull) => true,
        (BinOp::Or, T::NotEqualNullOrUndefined | T::NotStrictEqualUndefined | T::StrictEqualNull) => true,
        (BinOp::Or, T::Boolean) => first == T::NotBoolean,
        _ => false,
    }
}

/// tsgolint's `containsOptionalChain`, for what is tested.
fn tsgolint_contains_optional_chain(mut node: Expr) -> bool {
    loop {
        if node.is_optional() {
            return true;
        }
        node = match node.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) => call.callee(),
            _ => return false,
        };
    }
}

/// tsgolint's `compareNodes` takes nothing after `f()`, which is another call each time, and
/// `shouldAllowCallChainExtension` takes that back where both are tested in the same way: `f() && f().a`,
/// `!f() || !f().a`, `f() == null || f().a == null`.
fn tsgolint_takes_nothing_after(operator: BinOp, previous: ValidOperand, next: NullishComparisonType) -> bool {
    use NullishComparisonType as T;
    let e = previous.compared_name.expr();
    let is_nullish = |it: T| matches!(it, T::StrictEqualNull | T::StrictEqualUndefined | T::EqualNullOrUndefined);
    matches!(e.kind(), ExprKind::Call(call) if call.callee().as_ident().is_some())
        && !tsgolint_contains_optional_chain(e)
        && !match (operator, previous.comparison_type, next) {
            (BinOp::And, T::Boolean, T::Boolean) | (BinOp::Or, T::NotBoolean, T::NotBoolean) => true,
            (BinOp::Or, first, second) => is_nullish(first) && is_nullish(second),
            _ => false,
        }
}

/// tsgolint's `strictCheckRequiresSuggestion`: the chain tests for `null` only or for `undefined` only, with `===`, and
/// that is all that the types of what it tests have. An optional chain tests for both.
fn tsgolint_strict_check_requires_suggestion(chain: &[ValidOperand]) -> bool {
    use NullishComparisonType as T;
    let has = |types: [T; 2]| chain.iter().any(|it| types.contains(&it.comparison_type));
    let (tests_null, tests_undefined) =
        (has([T::StrictEqualNull, T::NotStrictEqualNull]), has([T::StrictEqualUndefined, T::NotStrictEqualUndefined]));
    if has([T::EqualNullOrUndefined, T::NotEqualNullOrUndefined]) || tests_null == tests_undefined {
        return false;
    }
    let mut is_any_nullable = false;
    for operand in chain {
        let types = union_constituents(operand.compared_name.expr().ty());
        let has = |flags: TypeFlags| types.iter().any(|ty| is_type_flag_set(ty, flags));
        if has(TypeFlags::ANY | TypeFlags::UNKNOWN) {
            return false;
        }
        match (has(TypeFlags::NULL), has(TypeFlags::UNDEFINED)) {
            (false, false) => {}
            (true, true) => return false,
            (has_null, _) if has_null == tests_null => is_any_nullable = true,
            _ => return false,
        }
    }
    is_any_nullable
}

/// tsgolint's `isOrChainComparisonSafe`, which goes by what is written and not by its type.
fn tsgolint_is_or_chain_comparison_safe(comparison_value: Expr, comparison_type: ComparisonType) -> bool {
    let tag = comparison_value.tag();
    let is_undefined = ast_utils::is_specific_id(comparison_value, "undefined");
    let is_literal = matches!(
        tag,
        ExprTag::Number | ExprTag::String | ExprTag::True | ExprTag::False | ExprTag::Object | ExprTag::Array
    );
    match comparison_type {
        ComparisonType::NotStrictEqual => is_literal || tag == ExprTag::Null,
        ComparisonType::StrictEqual => is_undefined,
        ComparisonType::NotEqual => is_literal,
        ComparisonType::Equal => is_undefined || tag == ExprTag::Null,
    }
}

/// `isValidAndLastChainOperand`, `isValidOrLastChainOperand`
fn is_valid_last_chain_operand(operator: BinOp, comparison_value: Expr, comparison_type: ComparisonType) -> bool {
    if operator == BinOp::Or && comparison_value.file().language().is_oxlint {
        return tsgolint_is_or_chain_comparison_safe(comparison_value, comparison_type);
    }
    let types = union_constituents(get_constrained_type_at_location(comparison_value));
    let some = |flags: TypeFlags| types.iter().any(|ty| is_type_flag_set(ty, flags));
    let every = |flags: TypeFlags| types.iter().all(|ty| is_type_flag_set(ty, flags));
    // An `||` chain ends with the negation of what an `&&` chain ends with.
    let is_equality = matches!(comparison_type, ComparisonType::Equal | ComparisonType::StrictEqual);
    let is_strict = matches!(comparison_type, ComparisonType::StrictEqual | ComparisonType::NotStrictEqual);
    match (is_equality == (operator == BinOp::And), is_strict) {
        (true, false) => !some(MAYBE_UNDEFINED_FLAGS | TypeFlags::NULL),
        (true, true) => !some(MAYBE_UNDEFINED_FLAGS),
        (false, true) => every(TypeFlags::UNDEFINED),
        (false, false) => every(NULLISH_FLAGS),
    }
}

/// `analyzeAndChainOperand`, `analyzeOrChainOperand`, for `chain[index]`: how many operands,
/// starting with it, are one unit of the chain. `None` if it cannot be part of a chain.
fn analyze_operand(comparer: &Comparer, operator: BinOp, index: usize, chain: &[ValidOperand]) -> Option<usize> {
    use NullishComparisonType as T;
    let operand = chain.get(index)?;
    let next_operand = chain.get(index + 1);
    let name = operand.compared_name.expr();
    // `x !== null && x !== undefined`
    let is_followed_by = |comparison_type: T| {
        next_operand.is_some_and(|next| {
            next.comparison_type == comparison_type
                && comparer.compare_nodes(operand.compared_name, next.compared_name) == Equal
        })
    };
    // Where the type includes the one of `null` and `undefined` that is not tested for, an
    // optional chain would behave differently.
    match (operator, operand.comparison_type) {
        (BinOp::And, T::Boolean | T::NotEqualNullOrUndefined) | (BinOp::Or, T::NotBoolean | T::EqualNullOrUndefined) => {
            Some(1)
        }
        (BinOp::And, T::NotStrictEqualNull) => match () {
            () if is_followed_by(T::NotStrictEqualUndefined) => Some(2),
            () if next_operand.is_some() && !includes_type(name, TypeFlags::UNDEFINED) => Some(1),
            () => None,
        },
        (BinOp::And, T::NotStrictEqualUndefined) => match () {
            () if is_followed_by(T::NotStrictEqualNull) => Some(2),
            () if includes_type(name, TypeFlags::NULL) => None,
            () => Some(1),
        },
        (BinOp::Or, T::StrictEqualNull) => match () {
            () if is_followed_by(T::StrictEqualUndefined) => Some(2),
            () if includes_type(name, TypeFlags::UNDEFINED) => None,
            () => Some(1),
        },
        (BinOp::Or, T::StrictEqualUndefined) => match () {
            () if is_followed_by(T::StrictEqualNull) => Some(2),
            () if includes_type(name, TypeFlags::NULL) => None,
            () => Some(1),
        },
        _ => None,
    }
}

/// `resolveOperandSubset`: the `comparedName`, the `comparisonValue` and `isYoda`. `None` if
/// `previous_operand` is not a subset of exactly one side of the comparison.
fn resolve_operand_subset<'a>(
    comparer: &Comparer,
    previous_operand: ValidOperand<'a>,
    last_chain_operand: LastChainOperand<'a>,
    takes_equal: bool,
) -> Option<(Expr<'a>, Expr<'a>, bool)> {
    let (name, value) = (last_chain_operand.compared_name, last_chain_operand.comparison_value);
    let is_subset_of = |e: Expr<'a>| {
        let result = comparer.compare_nodes(previous_operand.compared_name, Compared::of(e));
        result == Subset || (takes_equal && result == Equal)
    };
    let is_name_subset = is_subset_of(name);
    if last_chain_operand.yoda != Yoda::Unknown {
        return is_name_subset.then_some((name, value, last_chain_operand.yoda == Yoda::Yes));
    }
    match (is_name_subset, is_subset_of(value)) {
        (true, false) => Some((name, value, false)),
        (false, true) => Some((value, name, true)),
        _ => None,
    }
}

/// `getReportRange`: from the first operand of `chain` to the last, with the parentheses next to
/// them that are inside `boundary`.
fn get_report_range<'a>(file: &'a File<'a>, chain: &[ValidOperand<'a>], boundary: Span) -> Span {
    let (Some(first), Some(last)) = (chain.first(), chain.last()) else {
        return boundary;
    };
    let (mut start, mut end) = (first.node.span().start, last.node.span().end);
    for token in file.tokens_before(Span::empty(start)) {
        if !token.is_punctuator("(") || token.start() < boundary.start {
            break;
        }
        start = token.start();
    }
    for token in file.tokens_after(Span::empty(end)) {
        if !token.is_punctuator(")") || token.end() > boundary.end {
            break;
        }
        end = token.end();
    }
    Span::new(start, end)
}

enum PartText {
    Node(Span),
    /// In brackets.
    Computed(Span),
    Call {
        type_arguments: Option<Span>,
        arguments: Span,
    },
}

struct FlattenedChain {
    non_null: bool,
    optional: bool,
    precedence: OperatorPrecedence,
    requires_dot: bool,
    text: PartText,
}

/// `flattenChainExpression`. `None` if a call has no parentheses.
fn flatten_chain_expression(mut node: Expr, parts: &mut Vec<FlattenedChain>) -> Option<()> {
    let is_non_null = |object: Expr| object.tag() == ExprTag::NonNull && !object.is_chain_root();
    let first = parts.len();
    // From the last part to the first.
    loop {
        node = match node.kind() {
            ExprKind::Call(call) => {
                let type_arguments = call.type_args().angle_brackets_span();
                let closing_paren = Span::new(node.span().end.checked_sub(1)?, node.span().end);
                let after = type_arguments.unwrap_or_else(|| call.callee().span());
                let opening_paren =
                    node.file().tokens_between(after, closing_paren).find(|token| token.is_punctuator("("))?;
                parts.push(FlattenedChain {
                    non_null: false,
                    optional: call.is_optional(),
                    precedence: OperatorPrecedence::Invalid,
                    requires_dot: false,
                    text: PartText::Call {
                        type_arguments,
                        arguments: opening_paren.span().to(closing_paren),
                    },
                });
                call.callee()
            }
            ExprKind::Dot { obj, name, chain } => {
                parts.push(FlattenedChain {
                    non_null: is_non_null(obj),
                    optional: chain == Chain::Start,
                    precedence: OperatorPrecedence::Primary,
                    requires_dot: true,
                    text: PartText::Node(name.span()),
                });
                obj
            }
            ExprKind::Index { obj, index, chain } => {
                parts.push(FlattenedChain {
                    non_null: is_non_null(obj),
                    optional: chain == Chain::Start,
                    precedence: OperatorPrecedence::Invalid,
                    requires_dot: false,
                    text: PartText::Computed(index.span()),
                });
                obj
            }
            ExprKind::NonNull(expression) => expression,
            _ => {
                parts.push(FlattenedChain {
                    non_null: false,
                    optional: false,
                    precedence: get_operator_precedence_for_node(node),
                    requires_dot: false,
                    text: PartText::Node(node.span()),
                });
                break;
            }
        };
    }
    parts.get_mut(first..)?.reverse();
    Some(())
}

/// The operator of a `UnaryExpression`.
fn unary_operator(node: Expr) -> Option<&'static str> {
    match node.kind() {
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => None,
        ExprKind::Unary { op, .. } => Some(un_op_text(op)),
        _ => None,
    }
}

/// The optional chain that does what the operands of `chain` do.
fn get_new_code<'a>(file: &'a File<'a>, chain: &[ValidOperand<'a>]) -> Option<Vec<u8>> {
    // Each operand adds what it has more than those before it, after a `?.`.
    let mut parts: Vec<FlattenedChain> = Vec::new();
    let mut next_operand = Vec::new();
    let mut known = 0;
    for current in chain {
        flatten_chain_expression(current.compared_name.expr(), &mut next_operand)?;
        known = parts.len();
        for (i, mut part) in next_operand.drain(..).skip(known).enumerate() {
            part.optional |= i == 0 && known > 0;
            parts.push(part);
        }
    }
    // tsgolint 7.0: where only a name is tested, all of the access after it is optional, but for a call at its end:
    // `a && a.b.c()` is `a?.b?.c()`.
    let is_filled = file.language().is_oxlint
        && known == 1
        && chain.last().is_some_and(|it| it.comparison_type == NullishComparisonType::Boolean);
    let ends_with_call = matches!(parts.last(), Some(FlattenedChain { text: PartText::Call { .. }, .. }));
    let filled = if is_filled { 1..parts.len() - usize::from(ends_with_call) } else { 0..0 };

    let mut new_code = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        if part.optional {
            new_code.extend_from_slice(b"?.");
        } else if filled.contains(&i) {
            new_code.extend_from_slice(if part.non_null { &b"!?."[..] } else { &b"?."[..] });
        } else {
            if part.non_null {
                new_code.push(b'!');
            }
            if part.requires_dot {
                new_code.push(b'.');
            }
        }
        match part.text {
            PartText::Node(span)
                if part.precedence != OperatorPrecedence::Invalid
                    && part.precedence < OperatorPrecedence::Member =>
            {
                new_code.push(b'(');
                new_code.extend_from_slice(file.slice(span));
                new_code.push(b')');
            }
            PartText::Node(span) => new_code.extend_from_slice(file.slice(span)),
            PartText::Computed(span) => {
                new_code.push(b'[');
                new_code.extend_from_slice(file.slice(span));
                new_code.push(b']');
            }
            PartText::Call {
                type_arguments,
                arguments,
            } => {
                new_code.extend_from_slice(type_arguments.map_or(&b""[..], |span| file.slice(span)));
                new_code.extend_from_slice(file.slice(arguments));
            }
        }
    }

    let last_operand = chain.last()?;
    match last_operand.node.kind() {
        // The comparison at the end stays: `x && x.a != null`, `x && typeof x.a !== 'undefined'`
        ExprKind::Binary { op, left, right } if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) => {
            let (tested, other) = if last_operand.is_yoda { (right, left) } else { (left, right) };
            let mut tested_code = Vec::new();
            if let Some(operator) = unary_operator(tested) {
                tested_code.extend_from_slice(operator.as_bytes());
                tested_code.push(b' ');
            }
            tested_code.extend_from_slice(&new_code);
            let (left, right) = match last_operand.is_yoda {
                true => (other.text(), &tested_code[..]),
                false => (&tested_code[..], other.text()),
            };
            Some([left, b" ", bin_op_text(op).as_bytes(), b" ", right].concat())
        }
        _ if last_operand.comparison_type == NullishComparisonType::NotBoolean => {
            new_code.insert(0, b'!');
            Some(new_code)
        }
        _ => Some(new_code),
    }
}

/// `offset` as an index of ESLint's text.
fn index_of(file: &File, offset: u32) -> u32 {
    let start = if file.has_bom() { 3 } else { 0 };
    text::utf16_len(file.slice(Span::new(start, offset)))
}

/// Replaces `report_range`, which is in `node`, by `new_code`.
fn fix_chain<'a>(fixer: Fixer<'a>, node: Span, report_range: Span, new_code: Vec<u8>) -> Fix {
    let file = fixer.file();
    let mut unclosed_parens = 0i32;
    for token in file.tokens_in(report_range) {
        if token.is_punctuator("(") {
            unclosed_parens += 1;
        } else if token.is_punctuator(")") {
            unclosed_parens -= 1;
        }
    }
    if unclosed_parens <= 0 || report_range.end >= node.end {
        return fixer.replace(report_range, new_code);
    }

    let mut open_parens_outside_range = 0usize;
    let mut unmatched_close_parens: SmallVec<[u32; 4]> = SmallVec::new();
    for token in file.tokens_in(Span::new(report_range.end, node.end)) {
        if token.is_punctuator("(") {
            open_parens_outside_range += 1;
        } else if token.is_punctuator(")") {
            match open_parens_outside_range.checked_sub(1) {
                Some(rest) => open_parens_outside_range = rest,
                None => unmatched_close_parens.push(token.start()),
            }
        }
    }

    // As upstream, indices of the whole text are taken for indices of the text of the node, and
    // what is before the range in the node is dropped.
    let mut left_code = file.slice(node).to_vec();
    for &paren in unmatched_close_parens.iter().rev() {
        let index = index_of(file, paren);
        let from = text::utf16_offset_to_byte(&left_code, index);
        let to = text::utf16_offset_to_byte(&left_code, index + 1);
        left_code.drain(from..to);
    }
    let rest = text::utf16_offset_to_byte(&left_code, index_of(file, report_range.end));
    let mut code = new_code;
    code.extend_from_slice(left_code.get(rest..).unwrap_or_default());
    fixer.replace(node, code)
}

/// The operands that may become one optional chain.
#[derive(Default)]
struct SubChain<'a> {
    /// `subChain.flat()`
    operands: Operands<'a>,
    /// `subChain.length`: `x !== null && x !== undefined` at the start counts as one.
    len: usize,
    last_chain: Option<ValidOperand<'a>>,
}

impl<'a> SubChain<'a> {
    fn push(&mut self, operand: ValidOperand<'a>) {
        self.operands.push(operand);
        self.len += 1;
    }
}

/// Whether `null` or `undefined` is among the types of `node`.
fn is_maybe_nullish(node: Expr) -> bool {
    union_constituents(node.ty()).iter().any(|ty| is_type_flag_set(ty, NULLISH_FLAGS))
}

impl PreferOptionalChain {
    /// `checkNullishAndReport` of what `getReportDescriptor` returns. `chain`: the operands with
    /// `lastChain`, if there is one. `node`: the whole logical expression.
    fn report_chain<'a>(
        &self,
        cx: &Cx<'a, Self>,
        node: Expr<'a>,
        operator: BinOp,
        chain: &[ValidOperand<'a>],
        has_last_chain: bool,
    ) {
        use NullishComparisonType as T;
        let Some((last_operand, maybe_nullish)) = chain.split_last() else {
            return;
        };
        if self.require_nullish && !maybe_nullish.iter().any(|operand| is_maybe_nullish(operand.node)) {
            return;
        }
        // `!a || !a.b` with a `b` that is a `boolean`: tsgolint leaves it alone.
        if cx.language().is_oxlint
            && operator == BinOp::Or
            && !self.allow_potentially_unsafe_fixes_that_modify_the_return_type_i_know_what_im_doing
            && chain.iter().any(|operand| {
                matches!(operand.comparison_type, T::Boolean | T::NotBoolean)
                    && tsgolint_would_change_return_type(operand.compared_name.expr())
            })
        {
            return;
        }

        let is_oxlint = cx.language().is_oxlint;
        let first = chain.first().map_or(T::Other, |it| it.comparison_type);
        // `!a || a.b === null`: tsgolint leaves it alone.
        if is_oxlint
            && matches!((operator, first, last_operand.comparison_type), (BinOp::Or, T::NotBoolean, T::StrictEqualNull))
        {
            return;
        }
        // And what starts with an optional chain, but for `a?.b != null && a.b.c` and more than two operands of `||`.
        if is_oxlint
            && chain.first().is_some_and(|it| tsgolint_contains_optional_chain(it.compared_name.expr()))
            && match operator {
                BinOp::And => matches!(first, T::Boolean | T::NotStrictEqualNull | T::NotStrictEqualUndefined),
                _ => chain.len() == 2,
            }
        {
            return;
        }
        // And where `a!` is tested.
        if is_oxlint
            && !self.allow_potentially_unsafe_fixes_that_modify_the_return_type_i_know_what_im_doing
            && chain.iter().any(|it| it.node.tag() == ExprTag::NonNull)
        {
            return;
        }

        // An optional chain adds `undefined` to the type, which is safe only if nobody can tell.
        let use_suggestion_fixer = match last_operand.comparison_type {
            _ if self.allow_potentially_unsafe_fixes_that_modify_the_return_type_i_know_what_im_doing => false,
            // tsgolint fixes where a comparison follows the chain, but for `a === undefined || a.b === undefined`.
            T::StrictEqualUndefined if is_oxlint && operator == BinOp::Or => {
                tsgolint_strict_check_requires_suggestion(chain)
            }
            _ if is_oxlint && has_last_chain => {
                operator == BinOp::Or && tsgolint_strict_check_requires_suggestion(chain)
            }
            // It only suggests `a?.b` for `a != null && a.b`.
            T::Boolean
                if is_oxlint
                    && operator == BinOp::And
                    && matches!(first, T::NotEqualNullOrUndefined | T::NotStrictEqualNull | T::NotStrictEqualUndefined)
                    && !chain.first().is_some_and(|it| includes_type(it.compared_name.expr(), TypeFlags::empty())) =>
            {
                true
            }
            _ if has_last_chain => true,
            T::EqualNullOrUndefined
            | T::NotEqualNullOrUndefined
            | T::StrictEqualUndefined
            | T::NotStrictEqualUndefined => false,
            T::NotBoolean if operator == BinOp::Or => false,
            _ => !chain.iter().any(|operand| includes_type(operand.node, TypeFlags::UNDEFINED)),
        };

        let report_range = get_report_range(cx.file(), chain, node.span());
        // oxlint points at the whole logical expression.
        get_fix_or_suggest(
            cx.report(if is_oxlint { node.span() } else { report_range }, PREFER_OPTIONAL_CHAIN),
            if use_suggestion_fixer { FixOrSuggest::Suggest } else { FixOrSuggest::Fix },
            OPTIONAL_CHAIN_SUGGEST,
            |fixer| {
                let new_code = get_new_code(fixer.file(), chain)?;
                Some(fix_chain(fixer, node.span(), report_range, new_code))
            },
        );
    }

    /// `new_chain_seed`: what the next chain starts with.
    fn maybe_report_then_reset<'a>(
        &self,
        cx: &Cx<'a, Self>,
        node: Expr<'a>,
        operator: BinOp,
        sub_chain: &mut SubChain<'a>,
        new_chain_seed: &[ValidOperand<'a>],
    ) {
        let last_chain = sub_chain.last_chain.take();
        if sub_chain.len + usize::from(last_chain.is_some()) > 1 {
            sub_chain.operands.extend(last_chain);
            self.report_chain(cx, node, operator, &sub_chain.operands, last_chain.is_some());
        }
        sub_chain.operands.clear();
        sub_chain.operands.extend_from_slice(new_chain_seed);
        sub_chain.len = usize::from(!new_chain_seed.is_empty());
    }

    fn analyze_chain<'a>(
        &self,
        cx: &mut Cx<'a, Self>,
        node: Expr<'a>,
        operator: BinOp,
        chain: &[ValidOperand<'a>],
        last_chain_operand: Option<LastChainOperand<'a>>,
    ) {
        use NullishComparisonType as T;
        if chain.len() + usize::from(last_chain_operand.is_some()) <= 1 {
            return;
        }

        let is_oxlint = cx.language().is_oxlint;
        let stops_at_calls =
            is_oxlint && !self.allow_potentially_unsafe_fixes_that_modify_the_return_type_i_know_what_im_doing;
        let mut sub_chain = SubChain::default();
        let mut i = 0;
        while let Some(&operand) = chain.get(i) {
            let last_operand = sub_chain.operands.last().copied();
            let Some(count) = analyze_operand(&cx.state, operator, i, chain) else {
                let goes_on = last_operand.is_some_and(|last_operand| {
                    cx.state.compare_nodes(last_operand.compared_name, operand.compared_name) == Subset
                        && !(stops_at_calls
                            && tsgolint_takes_nothing_after(operator, last_operand, operand.comparison_type))
                });
                let first = sub_chain.operands.first().map_or(T::Other, |it| it.comparison_type);
                if goes_on && cx.language().is_oxlint && tsgolint_leaves_chain_before(operator, first, operand) {
                    sub_chain = SubChain::default();
                } else if goes_on
                    && match (operator, operand.comparison_type) {
                        // `a && a.b && typeof a.b.c === "undefined"`: for tsgolint the chain ends before it.
                        (BinOp::And, T::StrictEqualUndefined) | (BinOp::Or, T::NotStrictEqualUndefined) => {
                            !cx.language().is_oxlint
                        }
                        (_, comparison_type) => {
                            matches!(comparison_type, T::StrictEqualUndefined | T::NotStrictEqualUndefined)
                        }
                    }
                {
                    // `foo == null || foo.bar === undefined`: not an operand of a chain, but its end.
                    sub_chain.last_chain = Some(operand);
                }
                self.maybe_report_then_reset(cx, node, operator, &mut sub_chain, &[]);
                i += 1;
                continue;
            };
            let validated_operands = chain.get(i..i + count).unwrap_or_default();
            i += count;
            let Some(last_validated) = validated_operands.last() else {
                continue;
            };
            let Some(last_operand) = last_operand else {
                sub_chain.push(operand);
                continue;
            };
            let result = match stops_at_calls
                && tsgolint_takes_nothing_after(operator, last_operand, operand.comparison_type)
            {
                true => Invalid,
                false => cx.state.compare_nodes(last_operand.compared_name, last_validated.compared_name),
            };
            match result {
                Subset => sub_chain.push(operand),
                Invalid => self.maybe_report_then_reset(cx, node, operator, &mut sub_chain, validated_operands),
                // `foo && foo`
                Equal => {}
            }
        }

        // tsgolint 7.0 also takes a comparison of what the chain tests last: `a && a.b && a.b === 1`. After `||` only
        // where that is compared with `null` or `undefined`.
        let takes_equal = is_oxlint
            && sub_chain.operands.len() >= 2
            && sub_chain.operands.last().is_some_and(|it| {
                operator == BinOp::And
                    || matches!(
                        it.comparison_type,
                        T::StrictEqualNull | T::StrictEqualUndefined | T::EqualNullOrUndefined
                    )
            });
        if let Some(&last_operand) = sub_chain.operands.last()
            && let Some(last_chain_operand) = last_chain_operand
            && !(stops_at_calls && tsgolint_takes_nothing_after(operator, last_operand, T::Other))
            && let Some((compared_name, comparison_value, is_yoda)) =
                resolve_operand_subset(&cx.state, last_operand, last_chain_operand, takes_equal)
        {
            if is_valid_last_chain_operand(operator, comparison_value, last_chain_operand.comparison_type) {
                sub_chain.last_chain = Some(ValidOperand {
                    compared_name: Compared::of(compared_name),
                    comparison_type: T::Other,
                    is_yoda,
                    node: last_chain_operand.node,
                });
            } else if is_oxlint {
                // `a && a.b && a.b.c !== 1`: tsgolint leaves the whole chain alone.
                return;
            }
        }
        self.maybe_report_then_reset(cx, node, operator, &mut sub_chain, &[]);
    }

    /// `foo && foo.bar`, `!foo || !foo.bar`
    fn check_logical_chain<'a>(
        &self,
        node: Expr<'a>,
        operator: BinOp,
        left: Expr<'a>,
        right: Expr<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        // It is among the operands of its parent.
        if let Node::Expr(parent) = node.parent()
            && matches!(parent.kind(), ExprKind::Binary { op, .. } if op == operator)
        {
            return;
        }
        let operands = flatten_logical_operands(operator, left, right);
        if !operands.iter().skip(1).any(|operand| tests_member_or_call(*operand)) {
            return;
        }

        let mut current_chain = Operands::new();
        for (i, &operand) in operands.iter().enumerate() {
            let last_chain_operand = match self.get_operand(operator, operand, i + 1 < operands.len()) {
                Operand::Valid(operand) => {
                    current_chain.push(operand);
                    continue;
                }
                Operand::Last(operand) => Some(operand),
                Operand::Invalid => None,
            };
            self.analyze_chain(cx, node, operator, &current_chain, last_chain_operand);
            current_chain.clear();
        }
        self.analyze_chain(cx, node, operator, &current_chain, None);
    }

    /// `(foo ?? {}).bar`, `(foo || {}).bar`
    fn check_empty_object_fallback<'a>(&self, node: Expr<'a>, left: Expr<'a>, right: Expr<'a>, cx: &Cx<'a, Self>) {
        if !matches!(right.kind(), ExprKind::Object(properties) if properties.is_empty()) {
            return;
        }
        let Node::Expr(parent) = node.parent() else {
            return;
        };
        let (property, is_computed, chain) = match parent.kind() {
            ExprKind::Dot { name, chain, .. } => (name.span(), false, chain),
            ExprKind::Index { index, chain, .. } => (index.span(), true, chain),
            _ => return,
        };
        if chain == Chain::Start || self.require_nullish && !is_maybe_nullish(left) {
            return;
        }
        cx.report(parent, PREFER_OPTIONAL_CHAIN).suggest(OPTIONAL_CHAIN_SUGGEST, |fixer| {
            let left_precedence = get_operator_precedence(ts_syntax_kind(left), ts_operator_kind(node), false);
            let (open, close) = match left_precedence < OperatorPrecedence::LeftHandSide {
                true => (&b"("[..], &b")"[..]),
                false => (&b""[..], &b""[..]),
            };
            let (open_bracket, close_bracket) = match is_computed {
                true => (&b"["[..], &b"]"[..]),
                false => (&b""[..], &b""[..]),
            };
            let property = fixer.file().slice(property);
            fixer.replace(
                parent,
                [open, left.text(), close, b"?.", open_bracket, property, close_bracket].concat(),
            )
        });
    }
}

impl Rule for PreferOptionalChain {
    const META: Meta = Meta::typescript("prefer-optional-chain", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    type State<'a> = Comparer;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let mut allowed_flags = NULLISH_FLAGS | TypeFlags::OBJECT;
        for (option, flags) in [
            ("checkAny", TypeFlags::ANY),
            ("checkUnknown", TypeFlags::UNKNOWN),
            ("checkString", TypeFlags::STRING_LIKE),
            ("checkNumber", TypeFlags::NUMBER_LIKE),
            ("checkBoolean", TypeFlags::BOOLEAN_LIKE),
            ("checkBigInt", TypeFlags::BIG_INT_LIKE),
        ] {
            if options.bool_or(option, true) {
                allowed_flags |= flags;
            }
        }
        PreferOptionalChain {
            allow_potentially_unsafe_fixes_that_modify_the_return_type_i_know_what_im_doing: options.bool_or(
                "allowPotentiallyUnsafeFixesThatModifyTheReturnTypeIKnowWhatImDoing",
                false,
            ),
            allowed_flags,
            require_nullish: options.bool_or("requireNullish", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Comparer {
        on.exprs([ExprTag::Binary], |rule, node, cx| {
            let ExprKind::Binary { op, left, right } = node.kind() else {
                return;
            };
            if matches!(op, BinOp::And | BinOp::Or) {
                rule.check_logical_chain(node, op, left, right, cx);
            }
            if matches!(op, BinOp::Or | BinOp::Nullish) {
                rule.check_empty_object_fallback(node, left, right, cx);
            }
        });
        Comparer {
            stack: bun_core::StackCheck::init(),
        }
    }
}

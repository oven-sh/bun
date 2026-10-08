use bun_lint::prelude::*;

/// Disallow magic numbers.
pub struct NoMagicNumbers(Checker);

const USE_CONST: Message =
    Message::new("useConst", "Number constants declarations must use 'const'.");
const NO_MAGIC: Message = Message::new("noMagic", "No magic number: {{raw}}.");

/// The maximum length of an array by the specification.
const MAX_ARRAY_LENGTH: f64 = 4_294_967_295.0;

#[derive(Copy, Clone)]
enum Value<'a> {
    Number(f64),
    /// `digits` are decimal, without leading zeros. Zero is not negative.
    BigInt { is_negative: bool, digits: &'a [u8] },
}

impl Value<'_> {
    fn negated(self) -> Self {
        match self {
            Value::Number(value) => Value::Number(-value),
            Value::BigInt { is_negative, digits } => Value::BigInt {
                is_negative: !is_negative && digits != b"0",
                digits,
            },
        }
    }

    /// It coerces to the name of an element of an array: `"0"`, `"1"`, .. `"4294967294"`.
    fn is_array_index(self) -> bool {
        match self {
            Value::Number(value) => value.fract() == 0.0 && (0.0..MAX_ARRAY_LENGTH).contains(&value),
            Value::BigInt { is_negative, digits } => {
                !is_negative && (digits.len() < 10 || digits.len() == 10 && digits < &b"4294967295"[..])
            }
        }
    }
}

/// What ESLint's `fullNumberNode`, the literal with its sign, is a child of.
#[derive(Copy, Clone)]
enum Place<'a> {
    /// The `init` of a `VariableDeclarator`.
    Declarator(VarDecl<'a>),
    /// The `right` of an `AssignmentPattern`.
    DefaultValue,
    /// The `value` or the `key` of a `PropertyDefinition`.
    ClassField { is_value: bool, is_readonly: bool },
    EnumMember,
    /// A `TSLiteralType`.
    LiteralType(TypeNode<'a>),
    /// The second argument of `parseInt()` or `Number.parseInt()`.
    ParseIntRadix,
    Jsx,
    /// The `property` of a `MemberExpression`.
    Index,
    /// A `Property` of an object literal or an object pattern.
    Property,
    /// An `AssignmentExpression`.
    Assignment { is_to_identifier: bool },
    Other,
}

#[derive(Copy, Clone)]
struct Literal<'a> {
    /// With the sign.
    full: Span,
    /// Without the sign.
    unsigned: Span,
    sign: Option<u8>,
    value: Value<'a>,
}

fn is_jsx(node: Node) -> bool {
    matches!(node, Node::Expr(e) if e.tag() == ExprTag::Jsx)
}

fn place_of_member(member: Member<'_>, is_value: bool) -> Place<'_> {
    let flags = member.flags();
    let is_property_definition = member.kind() == MemberKind::Property
        && !flags.intersects(Flags::ACCESSOR | Flags::ABSTRACT)
        && !member.is_signature();
    match is_property_definition {
        true => Place::ClassField {
            is_value,
            is_readonly: flags.contains(Flags::READONLY),
        },
        false => Place::Other,
    }
}

fn place_of_expr(full: Expr<'_>) -> Place<'_> {
    let parent = match full.parent() {
        Node::Expr(parent) => parent,
        Node::VarDecl(declarator) => return Place::Declarator(declarator),
        Node::Param(_) | Node::PatElem(_) => return Place::DefaultValue,
        Node::PatProp(property) if property.default() == Some(full) => return Place::DefaultValue,
        Node::PatProp(_) => return Place::Property,
        Node::Member(member) => return place_of_member(member, member.init() == Some(full)),
        Node::EnumMember(_) => return Place::EnumMember,
        Node::Prop(property) if is_jsx(property.parent()) => return Place::Jsx,
        Node::Prop(property) if property.kind() != PropKind::Spread => return Place::Property,
        _ => return Place::Other,
    };
    match parent.kind() {
        ExprKind::Jsx(_) => Place::Jsx,
        ExprKind::Spread(_) if is_jsx(parent.parent()) => Place::Jsx,
        ExprKind::Assign { op: None, .. } if utils::is_assignment_target(parent) => Place::DefaultValue,
        ExprKind::Assign { target, .. } => Place::Assignment {
            is_to_identifier: target.tag() == ExprTag::Ident,
        },
        ExprKind::Index { index, .. } if index == full => Place::Index,
        ExprKind::Call(call)
            if call.args().get(1) == Some(full)
                && (ast_utils::is_specific_id(call.callee(), "parseInt")
                    || ast_utils::is_specific_member_access(call.callee(), Some("Number"), Some("parseInt"))) =>
        {
            Place::ParseIntRadix
        }
        _ => Place::Other,
    }
}

/// From a type up, out of the unions it is a constituent of, and the intersections if
/// `through_intersections`: the parent of the outermost.
fn parent_of_unions(ty: TypeNode<'_>, through_intersections: bool) -> Node<'_> {
    let mut parent = ty.parent();
    while let Node::Type(outer) = parent
        && (outer.tag() == TypeTag::Union || through_intersections && outer.tag() == TypeTag::Intersection)
    {
        parent = outer.parent();
    }
    parent
}

fn is_type_alias(node: Node) -> bool {
    matches!(node, Node::Stmt(statement) if statement.tag() == StmtTag::TypeAlias)
}

/// ESLint's `isTSNumericLiteralType`.
fn is_numeric_literal_type(ty: TypeNode) -> bool {
    is_type_alias(parent_of_unions(ty, false))
}

/// typescript-eslint's `isTSNumericLiteralType`, which looks through one union only.
fn is_numeric_literal_type_in_one_union(ty: TypeNode) -> bool {
    match ty.parent() {
        Node::Type(outer) => outer.tag() == TypeTag::Union && is_type_alias(outer.parent()),
        parent => is_type_alias(parent),
    }
}

/// `isAncestorTSIndexedAccessType` of both.
fn is_in_indexed_access_type(ty: TypeNode) -> bool {
    matches!(parent_of_unions(ty, true), Node::Type(outer) if outer.tag() == TypeTag::IndexedAccess)
}

/// The rule, and what typescript-eslint's rule of the same name adds to it.
pub struct Checker {
    detect_objects: bool,
    enforce_const: bool,
    ignore: Vec<f64>,
    /// Whether it is negative, and its decimal digits.
    ignore_bigints: Vec<(bool, Box<[u8]>)>,
    ignore_array_indexes: bool,
    ignore_default_values: bool,
    ignore_class_field_initial_values: bool,
    ignore_enums: bool,
    ignore_numeric_literal_types: bool,
    ignore_readonly_class_properties: bool,
    ignore_type_indexes: bool,
    is_typescript_eslint: bool,
}

/// A rule that is a [`Checker`].
pub trait Checks: Rule {
    fn checker(&self) -> &Checker;
}

impl Checker {
    pub fn new(options: &Options, is_typescript_eslint: bool) -> Self {
        let object = options.object(0);
        let (mut ignore, mut ignore_bigints) = (Vec::new(), Vec::new());
        for item in object.array("ignore") {
            match item {
                Json::Number(value) => ignore.push(*value),
                Json::String(text) => {
                    let (is_negative, digits) = match text.strip_suffix(b"n").unwrap_or(text) {
                        [b'-', digits @ ..] => (true, digits),
                        [b'+', digits @ ..] => (false, digits),
                        digits => (false, digits),
                    };
                    ignore_bigints.push((is_negative && digits != b"0", digits.into()));
                }
                _ => {}
            }
        }
        Checker {
            detect_objects: object.bool_or("detectObjects", false),
            enforce_const: object.bool_or("enforceConst", false),
            ignore,
            ignore_bigints,
            ignore_array_indexes: object.bool_or("ignoreArrayIndexes", false),
            ignore_default_values: object.bool_or("ignoreDefaultValues", false),
            ignore_class_field_initial_values: object.bool_or("ignoreClassFieldInitialValues", false),
            ignore_enums: object.bool_or("ignoreEnums", false),
            ignore_numeric_literal_types: object.bool_or("ignoreNumericLiteralTypes", false),
            ignore_readonly_class_properties: object.bool_or("ignoreReadonlyClassProperties", false),
            ignore_type_indexes: object.bool_or("ignoreTypeIndexes", false),
            is_typescript_eslint,
        }
    }

    /// ESTree has a `Literal` for a number in an expression, in a type and in the name of a
    /// property. Here only the first is an expression.
    pub fn register<R: Checks>(&self, on: &mut Listeners<'_, R>) {
        on.exprs([ExprTag::Number, ExprTag::BigInt], |rule, e, cx| rule.checker().check_expr(e, cx));
        on.types([TypeTag::NumberLit, TypeTag::BigIntLit], |rule, ty, cx| rule.checker().check_type(ty, cx));
        on.members(|rule, member, cx| {
            if member.flags().intersects(Flags::LITERAL_NAME | Flags::COMPUTED_NAME) {
                rule.checker().check_key(member.key(), place_of_member(member, false), cx);
            }
        });
        on.enum_members(|rule, member, cx| rule.checker().check_key(member.key(), Place::EnumMember, cx));
        // Nothing is reported in a `Property` otherwise.
        if self.detect_objects {
            on.props(|rule, property, cx| {
                if !property.is_jsx_attribute() {
                    rule.checker().check_key(property.key(), Place::Property, cx);
                }
            });
            on.pats([PatTag::Object], |rule, pattern, cx| {
                if let PatKind::Object(properties) = pattern.kind() {
                    for property in properties {
                        rule.checker().check_key(property.key(), Place::Property, cx);
                    }
                }
            });
        }
    }

    fn is_ignored_value(&self, value: Value) -> bool {
        match value {
            Value::Number(value) => self.ignore.contains(&value),
            Value::BigInt { is_negative, digits } => {
                self.ignore_bigints.iter().any(|ignored| ignored.0 == is_negative && *ignored.1 == *digits)
            }
        }
    }

    fn check_expr<'a, R: Rule>(&self, e: Expr<'a>, cx: &Cx<'a, R>) {
        let value = match e.kind() {
            ExprKind::Number(value) => Value::Number(value),
            ExprKind::BigInt(digits) => Value::BigInt {
                is_negative: false,
                digits: digits.bytes(),
            },
            _ => return,
        };
        let signed = e.parent().as_expr().and_then(|parent| match parent.kind() {
            ExprKind::Unary { op: UnOp::Minus, .. } => Some((parent, b'-', value.negated())),
            ExprKind::Unary { op: UnOp::Plus, .. } => Some((parent, b'+', value)),
            _ => None,
        });
        let (full, sign, value) = match signed {
            Some((full, sign, value)) => (full, Some(sign), value),
            None => (e, None, value),
        };
        if self.is_ignored_value(value) {
            return;
        }
        let literal = Literal {
            full: full.span(),
            unsigned: e.span(),
            sign,
            value,
        };
        self.check(literal, place_of_expr(full), cx);
    }

    fn check_type<'a, R: Rule>(&self, ty: TypeNode<'a>, cx: &Cx<'a, R>) {
        let value = match ty.kind() {
            TypeKind::NumberLit(value) => Value::Number(value),
            TypeKind::BigIntLit { text, negative } => Value::BigInt {
                is_negative: negative && text.bytes() != b"0",
                digits: text.bytes(),
            },
            _ => return,
        };
        if self.is_ignored_value(value) {
            return;
        }
        let full = ty.span();
        let is_signed = ty.text().starts_with(b"-");
        let literal = Literal {
            full,
            unsigned: match is_signed {
                true => Span::new(skip_trivia(cx.text(), full.start + 1), full.end),
                false => full,
            },
            sign: is_signed.then_some(b'-'),
            value,
        };
        self.check(literal, Place::LiteralType(ty), cx);
    }

    fn check_key<'a, R: Rule>(&self, key: Option<Key<'a>>, place: Place<'a>, cx: &Cx<'a, R>) {
        let Some(key) = key else {
            return;
        };
        let (KeyKind::Number(name) | KeyKind::ComputedNumber(name)) = key.kind() else {
            return;
        };
        let span = key.inner_span(cx.file());
        let value = match cx.slice(span).ends_with(b"n") {
            true => Value::BigInt {
                is_negative: false,
                digits: name.bytes(),
            },
            false => Value::Number(text::string_to_number(name.bytes())),
        };
        if self.is_ignored_value(value) {
            return;
        }
        let literal = Literal {
            full: span,
            unsigned: span,
            sign: None,
            value,
        };
        self.check(literal, place, cx);
    }

    /// `literal` is not an ignored value.
    fn check<'a, R: Rule>(&self, literal: Literal<'a>, place: Place<'a>, cx: &Cx<'a, R>) {
        if self.is_typescript_eslint {
            // Whether the option for it allows the number, if it is where one of the options
            // that typescript-eslint has added applies.
            let is_allowed = match place {
                Place::EnumMember => Some(self.ignore_enums),
                Place::LiteralType(ty) if is_numeric_literal_type_in_one_union(ty) => {
                    Some(self.ignore_numeric_literal_types)
                }
                Place::LiteralType(ty) if is_in_indexed_access_type(ty) => Some(self.ignore_type_indexes),
                Place::ClassField { is_readonly: true, .. } => Some(self.ignore_readonly_class_properties),
                _ => None,
            };
            match is_allowed {
                Some(true) => return,
                // A `+` is not part of what is reported here.
                Some(false) if literal.sign == Some(b'+') => {
                    return report_magic(literal.unsigned, None, literal.unsigned, cx);
                }
                Some(false) => return report_magic(literal.full, literal.sign, literal.unsigned, cx),
                None => {}
            }
        }
        let is_ignored = match place {
            Place::DefaultValue => self.ignore_default_values,
            Place::ClassField { is_value, is_readonly } => {
                self.ignore_class_field_initial_values && is_value
                    || self.ignore_readonly_class_properties && is_readonly
            }
            Place::EnumMember => self.ignore_enums,
            Place::LiteralType(ty) => {
                self.ignore_numeric_literal_types && is_numeric_literal_type(ty)
                    || self.ignore_type_indexes && is_in_indexed_access_type(ty)
            }
            Place::ParseIntRadix | Place::Jsx => true,
            Place::Index => self.ignore_array_indexes && literal.value.is_array_index(),
            Place::Property | Place::Assignment { is_to_identifier: false } => !self.detect_objects,
            Place::Declarator(_) | Place::Assignment { is_to_identifier: true } | Place::Other => false,
        };
        if is_ignored {
            return;
        }
        match place {
            Place::Declarator(declarator) => {
                if self.enforce_const && declarator.var_kind() != VarKind::Const {
                    cx.report(literal.full, USE_CONST);
                }
            }
            _ => report_magic(literal.full, literal.sign, literal.unsigned, cx),
        }
    }
}

fn report_magic<R: Rule>(at: Span, sign: Option<u8>, unsigned: Span, cx: &Cx<'_, R>) {
    let raw = cx.slice(unsigned);
    match sign {
        Some(sign) => cx.report(at, NO_MAGIC).data("raw", [&[sign][..], raw].concat()),
        None => cx.report(at, NO_MAGIC).data("raw", raw),
    };
}

impl Checks for NoMagicNumbers {
    fn checker(&self) -> &Checker {
        &self.0
    }
}

impl Rule for NoMagicNumbers {
    const META: Meta = Meta::eslint("no-magic-numbers", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoMagicNumbers(Checker::new(options, false))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        self.0.register(on);
    }
}

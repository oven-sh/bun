use bun_lint::prelude::*;
use std::borrow::Cow;

/// Disallow magic numbers.
pub struct NoMagicNumbers(Checker);

const USE_CONST: Message = Message::new(
    "useConst",
    "Number constants declarations must use 'const'.",
);
const NO_MAGIC: Message = Message::new("noMagic", "No magic number: {{raw}}.");

/// The specification's maximum array length.
const MAX_ARRAY_LENGTH: f64 = 4_294_967_295.0;

#[derive(Copy, Clone)]
enum Value<'a> {
    Number(f64),
    /// `digits` are decimal, without leading zeros. Zero is never negative.
    BigInt {
        is_negative: bool,
        digits: &'a [u8],
    },
}

impl Value<'_> {
    fn negated(self) -> Self {
        match self {
            Value::Number(value) => Value::Number(-value),
            Value::BigInt {
                is_negative,
                digits,
            } => Value::BigInt {
                is_negative: !is_negative && digits != b"0",
                digits,
            },
        }
    }

    /// True if it coerces to an array element's name: `"0"`, `"1"`, .. `"4294967294"`.
    fn is_array_index(self) -> bool {
        match self {
            Value::Number(value) => {
                value.fract() == 0.0 && (0.0..MAX_ARRAY_LENGTH).contains(&value)
            }
            Value::BigInt {
                is_negative,
                digits,
            } => {
                !is_negative
                    && (digits.len() < 10 || digits.len() == 10 && digits < &b"4294967295"[..])
            }
        }
    }
}

/// The parent of ESLint's `fullNumberNode`, which is the literal with its sign.
#[derive(Copy, Clone)]
enum ParentKind<'a> {
    /// The `init` of a `VariableDeclarator`.
    Declarator(VarDecl<'a>),
    /// The `right` of an `AssignmentPattern`.
    DefaultValue,
    /// The `value` or `key` of a `PropertyDefinition`.
    ClassField {
        is_value: bool,
        is_readonly: bool,
    },
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
    Assignment {
        is_to_identifier: bool,
    },
    Other,
}

fn is_number(key: Key) -> bool {
    matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
}

#[derive(Copy, Clone)]
struct Literal<'a> {
    /// Including the sign.
    full: Span,
    /// Without the sign.
    unsigned: Span,
    sign: Option<u8>,
    value: Value<'a>,
    /// The number without the sign, if it's an expression.
    number: Option<Expr<'a>>,
}

fn is_jsx(node: Node) -> bool {
    matches!(node, Node::Expr(e) if e.tag() == ExprTag::Jsx)
}

fn parent_kind_of_member(member: Member<'_>, is_value: bool) -> ParentKind<'_> {
    let flags = member.flags();
    let is_property_definition = member.kind() == MemberKind::Property
        && !flags.intersects(Flags::ACCESSOR | Flags::ABSTRACT)
        && !member.is_signature();
    match is_property_definition {
        true => ParentKind::ClassField {
            is_value,
            is_readonly: flags.contains(Flags::READONLY),
        },
        false => ParentKind::Other,
    }
}

/// `parent` is `full`'s parent.
fn parent_kind_of_expr<'a>(full: Expr<'a>, parent: Node<'a>) -> ParentKind<'a> {
    let parent = match parent {
        Node::Expr(parent) => parent,
        Node::VarDecl(declarator) => return ParentKind::Declarator(declarator),
        Node::Param(_) | Node::PatElem(_) => return ParentKind::DefaultValue,
        Node::PatProp(property) if property.default() == Some(full) => {
            return ParentKind::DefaultValue;
        }
        Node::PatProp(_) => return ParentKind::Property,
        Node::Member(member) => return parent_kind_of_member(member, member.init() == Some(full)),
        Node::EnumMember(_) => return ParentKind::EnumMember,
        Node::Prop(property) if is_jsx(property.parent()) => return ParentKind::Jsx,
        Node::Prop(property) if property.kind() != PropKind::Spread => return ParentKind::Property,
        _ => return ParentKind::Other,
    };
    match parent.tag() {
        ExprTag::Jsx => ParentKind::Jsx,
        ExprTag::Spread if is_jsx(parent.parent()) => ParentKind::Jsx,
        ExprTag::Assign
            if parent.assign_op() == Some(None) && utils::is_assignment_target(parent) =>
        {
            ParentKind::DefaultValue
        }
        ExprTag::Assign => ParentKind::Assignment {
            is_to_identifier: parent
                .left()
                .is_some_and(|target| target.tag() == ExprTag::Ident),
        },
        ExprTag::Index if parent.index() == Some(full) => ParentKind::Index,
        ExprTag::Call
            if parent.as_call().is_some_and(|call| {
                call.args().get(1) == Some(full)
                    && (ast_utils::is_specific_id(call.callee(), "parseInt")
                        || ast_utils::is_specific_member_access(
                            call.callee(),
                            Some("Number"),
                            Some("parseInt"),
                        ))
            }) =>
        {
            ParentKind::ParseIntRadix
        }
        _ => ParentKind::Other,
    }
}

/// Walks up from a type through the unions it's a constituent of, and through intersections with
/// `through_intersections`. Returns the parent of the outermost one.
fn parent_of_unions(ty: TypeNode<'_>, through_intersections: bool) -> Node<'_> {
    let mut parent = ty.parent();
    while let Node::Type(outer) = parent
        && (outer.tag() == TypeTag::Union
            || through_intersections && outer.tag() == TypeTag::Intersection)
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

/// typescript-eslint's `isTSNumericLiteralType`, which only looks through one union.
fn is_numeric_literal_type_in_one_union(ty: TypeNode) -> bool {
    match ty.parent() {
        Node::Type(outer) => outer.tag() == TypeTag::Union && is_type_alias(outer.parent()),
        parent => is_type_alias(parent),
    }
}

/// `isAncestorTSIndexedAccessType` in both tools.
fn is_in_indexed_access_type(ty: TypeNode) -> bool {
    matches!(parent_of_unions(ty, true), Node::Type(outer) if outer.tag() == TypeTag::IndexedAccess)
}

/// The rule, plus what typescript-eslint's rule of the same name adds to it.
pub struct Checker {
    detect_objects: bool,
    enforce_const: bool,
    ignore: Vec<f64>,
    /// For each: whether it's negative, and its decimal digits.
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
            ignore_class_field_initial_values: object
                .bool_or("ignoreClassFieldInitialValues", false),
            ignore_enums: object.bool_or("ignoreEnums", false),
            ignore_numeric_literal_types: object.bool_or("ignoreNumericLiteralTypes", false),
            ignore_readonly_class_properties: object
                .bool_or("ignoreReadonlyClassProperties", false),
            ignore_type_indexes: object.bool_or("ignoreTypeIndexes", false),
            is_typescript_eslint,
        }
    }

    /// ESTree has a `Literal` for a number in an expression, in a type and in a property name. Here only the first is
    /// an expression. A rule that uses this calls the methods below, each from its own method of the same name.
    pub const ON: On = On::new()
        .exprs(&[ExprTag::Number, ExprTag::BigInt])
        .types(&[TypeTag::NumberLit, TypeTag::BigIntLit])
        .members()
        .enum_members()
        .props()
        .pats(&[PatTag::Object]);

    pub fn narrow(&self, file: &File) -> On {
        let mut on = On::new()
            .exprs(&[ExprTag::Number, ExprTag::BigInt])
            .types(&[TypeTag::NumberLit, TypeTag::BigIntLit])
            .members()
            .enum_members();
        // Otherwise nothing in a `Property` is reported, except by oxlint, where a pattern's property isn't a
        // `Property`.
        if self.detect_objects || file.language().is_oxlint {
            on = on.props().pats(&[PatTag::Object]);
        }
        on
    }

    #[inline]
    pub fn expr<'a, R: Rule>(&self, e: Expr<'a>, cx: &mut Cx<'a, R>) {
        let parent = e.parent();
        // Positions where no number is reported.
        let is_allowed = match parent {
            Node::VarDecl(_) => !self.enforce_const,
            Node::Prop(property) => !self.detect_objects && property.kind() != PropKind::Spread,
            _ => false,
        };
        if !is_allowed {
            self.check_expr(e, parent, cx);
        }
    }

    pub fn ty<'a, R: Rule>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, R>) {
        self.check_type(ty, cx);
    }

    #[inline]
    pub fn member<'a, R: Rule>(&self, member: Member<'a>, cx: &mut Cx<'a, R>) {
        if member
            .flags()
            .intersects(Flags::LITERAL_NAME | Flags::COMPUTED_NAME)
        {
            self.check_key(member.key(), parent_kind_of_member(member, false), cx);
        }
    }

    pub fn enum_member<'a, R: Rule>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, R>) {
        self.check_key(member.key(), ParentKind::EnumMember, cx);
    }

    pub fn prop<'a, R: Rule>(&self, property: Prop<'a>, cx: &mut Cx<'a, R>) {
        let key = property.key();
        if property.is_jsx_attribute() || !key.is_some_and(is_number) {
            return;
        }
        let is_in_pattern =
            || matches!(property.parent(), Node::Expr(it) if it.is_assignment_target());
        let parent_kind = match cx.language().is_oxlint && is_in_pattern() {
            true => ParentKind::Other,
            false => ParentKind::Property,
        };
        self.check_key(key, parent_kind, cx);
    }

    pub fn pat<'a, R: Rule>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, R>) {
        let parent_kind = match cx.language().is_oxlint {
            true => ParentKind::Other,
            false => ParentKind::Property,
        };
        if let PatKind::Object(properties) = pattern.kind() {
            for property in properties {
                self.check_key(property.key(), parent_kind, cx);
            }
        }
    }

    fn is_ignored_value(&self, value: Value) -> bool {
        match value {
            Value::Number(value) => self.ignore.contains(&value),
            Value::BigInt {
                is_negative,
                digits,
            } => self
                .ignore_bigints
                .iter()
                .any(|ignored| ignored.0 == is_negative && *ignored.1 == *digits),
        }
    }

    /// `parent` is `e`'s parent.
    #[inline(never)]
    fn check_expr<'a, R: Rule>(&self, e: Expr<'a>, parent: Node<'a>, cx: &Cx<'a, R>) {
        let value = match e.as_number() {
            Some(value) => Value::Number(value),
            None => match e.as_bigint() {
                Some(digits) => Value::BigInt {
                    is_negative: false,
                    digits: digits.bytes(),
                },
                None => return,
            },
        };
        let is_oxlint = cx.language().is_oxlint;
        let (full, sign, value, parent) = match parent.as_expr().map(|it| (it, it.unary_op())) {
            // For oxc the operand is the parentheses.
            Some(_) if is_oxlint && e.is_parenthesized() => (e, None, value, parent),
            Some((full, Some(UnOp::Minus))) => (full, Some(b'-'), value.negated(), full.parent()),
            // oxlint also reports all of `void 0`, `+1` and `~1`, but prints only the number.
            Some((
                full,
                Some(
                    UnOp::Plus
                    | UnOp::BitNot
                    | UnOp::Not
                    | UnOp::Typeof
                    | UnOp::Void
                    | UnOp::Delete,
                ),
            )) if is_oxlint => (full, None, value, full.parent()),
            Some((full, Some(UnOp::Plus))) => (full, Some(b'+'), value, full.parent()),
            _ => (e, None, value, parent),
        };
        if self.is_ignored_value(value) {
            return;
        }
        let literal = Literal {
            full: full.span(),
            unsigned: e.span(),
            sign,
            value,
            number: Some(e),
        };
        self.check(literal, parent_kind_of_expr(full, parent), cx);
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
            number: None,
        };
        self.check(literal, ParentKind::LiteralType(ty), cx);
    }

    #[inline(never)]
    fn check_key<'a, R: Rule>(
        &self,
        key: Option<Key<'a>>,
        parent_kind: ParentKind<'a>,
        cx: &Cx<'a, R>,
    ) {
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
            false => Value::Number(bun_core::fmt::js_string_to_number(name.bytes())),
        };
        if self.is_ignored_value(value) {
            return;
        }
        let literal = Literal {
            full: span,
            unsigned: span,
            sign: None,
            value,
            number: None,
        };
        self.check(literal, parent_kind, cx);
    }

    /// `literal` isn't an ignored value.
    fn check<'a, R: Rule>(
        &self,
        literal: Literal<'a>,
        parent_kind: ParentKind<'a>,
        cx: &Cx<'a, R>,
    ) {
        if self.is_typescript_eslint {
            // If the number is in a position covered by one of typescript-eslint's added options, whether that option
            // allows it.
            let is_allowed = match parent_kind {
                ParentKind::EnumMember => Some(self.ignore_enums),
                ParentKind::LiteralType(ty) if is_numeric_literal_type_in_one_union(ty) => {
                    Some(self.ignore_numeric_literal_types)
                }
                ParentKind::LiteralType(ty) if is_in_indexed_access_type(ty) => {
                    Some(self.ignore_type_indexes)
                }
                ParentKind::ClassField {
                    is_readonly: true, ..
                } => Some(self.ignore_readonly_class_properties),
                _ => None,
            };
            match is_allowed {
                Some(true) => return,
                // Here a `+` isn't part of the report.
                Some(false) if literal.sign == Some(b'+') => {
                    return report_magic(literal.unsigned, None, literal, cx);
                }
                Some(false) => {
                    return report_magic(literal.full, literal.sign, literal, cx);
                }
                None => {}
            }
        }
        let is_ignored = match parent_kind {
            ParentKind::DefaultValue => self.ignore_default_values,
            ParentKind::ClassField {
                is_value,
                is_readonly,
            } => {
                self.ignore_class_field_initial_values && is_value
                    || self.ignore_readonly_class_properties && is_readonly
            }
            ParentKind::EnumMember => self.ignore_enums,
            ParentKind::LiteralType(ty) => {
                self.ignore_numeric_literal_types && is_numeric_literal_type(ty)
                    || self.ignore_type_indexes && is_in_indexed_access_type(ty)
            }
            ParentKind::ParseIntRadix | ParentKind::Jsx => true,
            ParentKind::Index => self.ignore_array_indexes && literal.value.is_array_index(),
            ParentKind::Property
            | ParentKind::Assignment {
                is_to_identifier: false,
            } => !self.detect_objects,
            ParentKind::Declarator(_)
            | ParentKind::Assignment {
                is_to_identifier: true,
            }
            | ParentKind::Other => false,
        };
        if is_ignored {
            return;
        }
        match parent_kind {
            ParentKind::Declarator(declarator) => {
                if self.enforce_const && declarator.var_kind() != VarKind::Const {
                    cx.report(literal.full, USE_CONST);
                }
            }
            _ => report_magic(literal.full, literal.sign, literal, cx),
        }
    }
}

fn report_magic<'a, R: Rule>(at: Span, sign: Option<u8>, literal: Literal<'a>, cx: &Cx<'a, R>) {
    let unsigned = literal.unsigned;
    let raw = match sign {
        Some(_) if at.start + 1 == unsigned.start && at.end == unsigned.end => {
            Cow::Borrowed(cx.slice(at))
        }
        Some(sign) => Cow::Owned([&[sign][..], cx.slice(unsigned)].concat()),
        None => Cow::Borrowed(cx.slice(unsigned)),
    };
    let report = match literal.number {
        Some(number) if at == unsigned => cx.report(number, NO_MAGIC),
        // oxlint's rule is called with the number.
        Some(number) => cx.report(at, NO_MAGIC).called_with(number),
        None => cx.report(at, NO_MAGIC),
    };
    report.data("raw", raw);
}

impl Rule for NoMagicNumbers {
    const META: Meta = Meta::eslint("no-magic-numbers", Kind::Suggestion);
    const ON: On = Checker::ON;
    no_state!();

    fn new(options: &Options) -> Self {
        NoMagicNumbers(Checker::new(options, false))
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        self.0.narrow(file)
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.0.expr(e, cx);
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.0.ty(ty, cx);
    }

    fn pat<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        self.0.pat(pattern, cx);
    }

    #[inline]
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.0.member(member, cx);
    }

    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.0.prop(property, cx);
    }

    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        self.0.enum_member(member, cx);
    }
}

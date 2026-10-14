use bun_lint::prelude::*;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::{is_builtin_symbol_like, is_builtin_symbol_like_recurser, is_symbol_from_default_library};
use bun_lint::types::{ModifierFlags, NameOf, SyntaxKind, TsNode, TsSymbol, Type};
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce unbound methods are called with their expected scope.
pub struct UnboundMethod {
    ignore_static: bool,
}

const UNBOUND: Message = Message::new(
    "unbound",
    "A method that is not declared with `this: void` may cause unintentional scoping of `this` when separated from its object.\nConsider using an arrow function or explicitly `.bind()`ing the method to avoid calling the method with an unintended `this` value. ",
);
const UNBOUND_WITHOUT_THIS_ANNOTATION: Message = Message::new(
    "unboundWithoutThisAnnotation",
    "A method that is not declared with `this: void` may cause unintentional scoping of `this` when separated from its object.\nConsider using an arrow function or explicitly `.bind()`ing the method to avoid calling the method with an unintended `this` value. \nIf a function does not access `this`, it can be annotated with `this: void`.",
);

/// `nativelyBoundMembers.has(`${object}.${property}`)`. Upstream computes the set from the globals
/// of the Node.js it runs in: the own properties of each that are functions.
fn is_natively_bound_member(object: &[u8], property: &[u8]) -> bool {
    let members: &[&str] = match object {
        b"Number" => &["isFinite", "isInteger", "isNaN", "isSafeInteger", "parseFloat", "parseInt"],
        b"Object" => &[
            "assign",
            "getOwnPropertyDescriptor",
            "getOwnPropertyDescriptors",
            "getOwnPropertyNames",
            "getOwnPropertySymbols",
            "hasOwn",
            "is",
            "preventExtensions",
            "seal",
            "create",
            "defineProperties",
            "defineProperty",
            "freeze",
            "getPrototypeOf",
            "setPrototypeOf",
            "isExtensible",
            "isFrozen",
            "isSealed",
            "keys",
            "entries",
            "fromEntries",
            "values",
            "groupBy",
        ],
        b"String" => &["fromCharCode", "fromCodePoint", "raw"],
        b"RegExp" => &["escape"],
        b"Symbol" => &["for", "keyFor"],
        b"Array" => &["isArray", "from", "fromAsync", "of"],
        b"Proxy" => &["revocable"],
        b"Date" => &["now", "parse", "UTC"],
        b"Atomics" => &[
            "load",
            "store",
            "add",
            "sub",
            "and",
            "or",
            "xor",
            "exchange",
            "compareExchange",
            "isLockFree",
            "wait",
            "waitAsync",
            "notify",
            "pause",
        ],
        b"Reflect" => &[
            "defineProperty",
            "deleteProperty",
            "apply",
            "construct",
            "get",
            "getOwnPropertyDescriptor",
            "getPrototypeOf",
            "has",
            "isExtensible",
            "ownKeys",
            "preventExtensions",
            "set",
            "setPrototypeOf",
        ],
        b"console" => &[
            "log",
            "info",
            "debug",
            "warn",
            "error",
            "dir",
            "time",
            "timeEnd",
            "timeLog",
            "trace",
            "assert",
            "clear",
            "count",
            "countReset",
            "group",
            "groupEnd",
            "table",
            "dirxml",
            "groupCollapsed",
            "Console",
            "profile",
            "profileEnd",
            "timeStamp",
            "context",
            "createTask",
        ],
        b"Math" => &[
            "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2", "ceil", "cbrt", "expm1", "clz32",
            "cos", "cosh", "exp", "floor", "fround", "hypot", "imul", "log", "log1p", "log2", "log10", "max", "min",
            "pow", "random", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc", "f16round",
        ],
        b"JSON" => &["parse", "stringify", "rawJSON", "isRawJSON"],
        b"Intl" => &[
            "getCanonicalLocales",
            "supportedValuesOf",
            "DateTimeFormat",
            "NumberFormat",
            "Collator",
            "PluralRules",
            "RelativeTimeFormat",
            "ListFormat",
            "Locale",
            "DisplayNames",
            "Segmenter",
            "DurationFormat",
        ],
        _ => return false,
    };
    members.iter().any(|member| member.as_bytes() == property)
}

const SUPPORTED_GLOBAL_TYPES: [&str; 12] = [
    "NumberConstructor",
    "ObjectConstructor",
    "StringConstructor",
    "SymbolConstructor",
    "ArrayConstructor",
    "Array",
    "ProxyConstructor",
    "Console",
    "DateConstructor",
    "Atomics",
    "Math",
    "JSON",
];

fn is_not_imported(symbol: TsSymbol) -> bool {
    symbol
        .value_declaration()
        .is_some_and(|value_declaration| !value_declaration.get_source_file().is_linted_file())
}

/// Whether `property_name` is a member of an instance of a built-in class that the specification
/// defines as bound to that instance, which TypeScript's library declares as a plain method:
/// upstream's `nativelyBoundInstanceMethods` is `Collator.compare`.
fn is_spec_bound_builtin_method(object_type: Type, property_name: &[u8], is_oxlint: bool) -> bool {
    if property_name != b"compare" {
        return false;
    }
    if !is_oxlint {
        return object_type
            .get_symbol()
            .is_some_and(|symbol| symbol.name() == b"Collator" && is_symbol_from_default_library(symbol));
    }
    // tsgolint's `isSpecBoundBuiltinMethod` asks where the property is declared: only in the library's `Collator`.
    let Some(symbol) = object_type.get_property(property_name) else {
        return false;
    };
    let mut declarations = symbol.declarations().peekable();
    declarations.peek().is_some()
        && declarations.all(|declaration| {
            declaration.get_source_file().is_default_library()
                && declaration.parent().is_some_and(|owner| {
                    owner.kind() == SyntaxKind::InterfaceDeclaration
                        && owner.name().is_some_and(|name| name.text() == b"Collator")
                })
        })
}

/// tsgolint's `IsAnyBuiltinSymbolLike`
fn is_any_builtin_symbol_like(ty: Type) -> bool {
    is_builtin_symbol_like_recurser(ty, |sub_type| match sub_type.get_symbol() {
        Some(symbol) => is_symbol_from_default_library(symbol).then_some(true),
        None => Some(false),
    })
}

/// The `object` of a `MemberExpression`, or what is destructured.
#[derive(Copy, Clone)]
struct ObjectNode<'a> {
    /// Its name, if it is an `Identifier`.
    identifier: Option<&'a [u8]>,
    node: TsNode<'a>,
}

impl<'a> From<Expr<'a>> for ObjectNode<'a> {
    fn from(object: Expr<'a>) -> Self {
        ObjectNode {
            identifier: object.as_ident().map(Name::bytes),
            node: object.ts_node(),
        }
    }
}

/// The `property` of a `MemberExpression`, or the `key` of a `Property`.
#[derive(Copy, Clone)]
struct PropertyNode<'a> {
    /// Its name, if it is an `Identifier`.
    identifier: Option<&'a [u8]>,
    node: TsNode<'a>,
}

fn is_natively_bound<'a>(object: ObjectNode<'a>, property: PropertyNode<'a>, is_oxlint: bool) -> bool {
    // The types alone do not tell: some declarations are not from the default library but from
    // `@types/node`, and the signature in an interface does not say whether a method is bound.
    if let (Some(object_name), Some(property_name)) = (object.identifier, property.identifier)
        && is_natively_bound_member(object_name, property_name)
        && object.node.get_symbol_at_location().is_some_and(is_not_imported)
    {
        return true;
    }
    let object_type = object.node.get_type_at_location();
    if property
        .identifier
        .is_some_and(|property_name| is_spec_bound_builtin_method(object_type, property_name, is_oxlint))
    {
        return true;
    }
    if !is_builtin_symbol_like(object_type, &SUPPORTED_GLOBAL_TYPES) {
        return false;
    }
    let property_type = property.node.get_type_at_location();
    match is_oxlint {
        true => is_any_builtin_symbol_like(property_type),
        false => is_symbol_from_default_library(property_type.get_symbol()),
    }
}

fn is_node_inside_type_declaration<'a>(node: Node<'a>, known: &mut AncestorMemo<'a, ()>, is_oxlint: bool) -> bool {
    let is_type_declaration = |parent: Node| match parent {
        Node::Class(class) => {
            matches!(class.owner(), Node::Stmt(_)) && class.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT)
        }
        Node::Member(member) => {
            member.flags().contains(Flags::ABSTRACT)
                && match member.kind() {
                    MemberKind::Method => true,
                    // tsgolint knows the abstract `MethodDeclaration` only.
                    MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor => !is_oxlint,
                    _ => false,
                }
        }
        Node::Func(func) => match func.kind() {
            FnKind::Decl => !func.has_body(),
            FnKind::FunctionType => true,
            _ => false,
        },
        Node::Stmt(statement) => match statement.tag() {
            StmtTag::Interface | StmtTag::TypeAlias => true,
            StmtTag::Var => statement.flags().contains(Flags::AMBIENT),
            _ => false,
        },
        _ => false,
    };
    known.find(node, |_, parent| is_type_declaration(parent).then_some(())).is_some()
}

/// The message to report, if the method is dangerous.
fn check_method(value_declaration: TsNode, ignore_static: bool) -> Option<Message> {
    let first_param = value_declaration.children().find(|child| child.kind() == SyntaxKind::Parameter);
    let first_param_is_this = first_param
        .and_then(|it| it.name())
        .is_some_and(|name| name.kind() == SyntaxKind::Identifier && name.text() == b"this");
    let this_arg_is_void = first_param_is_this
        && first_param.and_then(|it| it.type_node()).is_some_and(|ty| ty.kind() == SyntaxKind::VoidKeyword);
    if this_arg_is_void || (ignore_static && value_declaration.has_modifier(ModifierFlags::STATIC)) {
        return None;
    }
    Some(match first_param_is_this {
        true => UNBOUND,
        false => UNBOUND_WITHOUT_THIS_ANNOTATION,
    })
}

fn check_if_method(symbol: TsSymbol, ignore_static: bool) -> Option<Message> {
    let value_declaration = symbol.value_declaration()?;
    match value_declaration.kind() {
        SyntaxKind::PropertyAssignment | SyntaxKind::PropertyDeclaration => {
            let initializer = value_declaration.initializer()?;
            match initializer.kind() {
                SyntaxKind::FunctionExpression => check_method(initializer, ignore_static),
                _ => None,
            }
        }
        SyntaxKind::MethodDeclaration | SyntaxKind::MethodSignature => check_method(value_declaration, ignore_static),
        _ => None,
    }
}

/// [`check_if_method`]. tsgolint takes the first parameter of a function that is the value of a property of a class
/// for `this`.
fn message_of(symbol: TsSymbol, ignore_static: bool, is_oxlint: bool) -> Option<Message> {
    let message = check_if_method(symbol, ignore_static)?;
    let declaration = symbol.value_declaration().filter(|_| is_oxlint);
    Some(match declaration.is_some_and(|it| it.kind() == SyntaxKind::PropertyDeclaration) {
        true => UNBOUND,
        false => message,
    })
}

fn is_member_of(node: Expr, is_object: fn(ExprKind) -> bool) -> bool {
    match node.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => is_object(obj.kind()),
        _ => false,
    }
}

/// A `ChainExpression` has the answer of what is in it, so it makes no difference that it is not a
/// node here.
fn is_safe_use<'a>(node: Expr<'a>, known: &mut AncestorMemo<'a, bool>, is_oxlint: bool) -> bool {
    let decide = |node: Node<'a>, parent: Node<'a>| {
        let (node, parent) = match (node, parent) {
            (_, Node::Stmt(parent)) => {
                return Some(matches!(parent.tag(), StmtTag::If | StmtTag::For | StmtTag::Switch | StmtTag::While));
            }
            (Node::Expr(node), Node::Expr(parent)) => (node, parent),
            _ => return Some(false),
        };
        match parent.kind() {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => Some(true),
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => Some(call.callee() == node),
            ExprKind::Cond { test, .. } => Some(test == node),
            ExprKind::Unary { op, .. } => Some(!matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot)),
            ExprKind::Binary { op, left, .. } => match op {
                BinOp::NotEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::EqEqEq | BinOp::Instanceof => Some(true),
                // `&&` returns its left operand only if that is falsy.
                BinOp::And if left == node => Some(true),
                // tsgolint's `IsLogicalBinaryOperator` knows no `??`.
                BinOp::Nullish if is_oxlint => Some(false),
                // It is likely to return the method, so it is as safe as its own use.
                BinOp::And | BinOp::Or | BinOp::Nullish => None,
                _ => Some(false),
            },
            ExprKind::Assign { op, target, .. } => {
                // A default in a pattern is an `AssignmentPattern`, and for tsgolint an assignment like any other.
                let is_assignment = op.is_none() && (is_oxlint || !parent.is_assignment_target());
                // For tsgolint a `ParenthesizedExpression` is no access.
                let is_access = |it: Expr<'a>| !(is_oxlint && it.is_parenthesized());
                Some(
                    is_assignment
                        && (target == node
                            || (is_access(node)
                                && is_access(target)
                                && is_member_of(node, |object| matches!(object, ExprKind::Super))
                                && is_member_of(target, |object| matches!(object, ExprKind::This)))),
                )
            }
            ExprKind::NonNull(_) | ExprKind::As { .. } | ExprKind::AsConst(_) => None,
            _ => Some(false),
        }
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// The name of the property that a key names, and the key. typescript-eslint checks an `Identifier`, which a key also
/// is in `[key]`. tsgolint checks no key in brackets, and the string or the number of a `PropertyAssignment`.
fn property_of_key<'a>(
    key: Key<'a>,
    name_node: impl FnOnce() -> Option<TsNode<'a>>,
    is_oxlint: bool,
    is_property_assignment: bool,
) -> Option<(&'a [u8], PropertyNode<'a>)> {
    let (name, is_identifier, node) = match key.kind() {
        KeyKind::Ident(name) => (name, true, name_node()?),
        KeyKind::Computed(expression) if !is_oxlint => (expression.as_ident()?, true, expression.ts_node()),
        KeyKind::String(name) | KeyKind::Number(name) if is_oxlint && is_property_assignment => {
            (name, false, name_node()?)
        }
        _ => return None,
    };
    let name = name.bytes();
    let property = PropertyNode {
        identifier: is_identifier.then_some(name),
        node,
    };
    Some((name, property))
}

#[derive(Default)]
pub struct State<'a> {
    /// [`is_safe_use`]
    safe_uses: AncestorMemo<'a, bool>,
    /// [`is_node_inside_type_declaration`]
    type_declarations: AncestorMemo<'a, ()>,
}

/// An `ObjectPattern`.
#[derive(Copy, Clone)]
struct ObjectPattern<'a> {
    node: TsNode<'a>,
    /// What is destructured, or the default for that.
    init_node: Option<Expr<'a>>,
    is_in_assignment_pattern: bool,
}

impl UnboundMethod {
    fn check_if_method_and_report<'a>(&self, cx: &Cx<'a, Self>, node: Span, symbol: Option<TsSymbol<'a>>) -> bool {
        let is_oxlint = cx.language().is_oxlint;
        let Some(message) = symbol.and_then(|symbol| message_of(symbol, self.ignore_static, is_oxlint)) else {
            return false;
        };
        cx.report(node, message);
        true
    }

    /// tsgolint's diagnostic is for the whole `reference`. oxlint prints where its first label is, the name.
    fn report_reference(cx: &Cx<'_, Self>, name: Span, reference: Span, message: Message) {
        cx.report(name, message).comments_apply_at(reference).labels_with(|labels| {
            labels.first("This reference may be unbound and lose `this` context");
            labels.push(reference, "");
        });
    }

    /// `skips_spec_bound`: tsgolint's `TypeRecurser` over the type of a pattern passes over a constituent whose
    /// `compare` is bound.
    fn check_union_constituents_and_report<'a>(
        &self,
        cx: &mut Cx<'a, Self>,
        report_node: Span,
        property_name: &[u8],
        ty: Type<'a>,
        skips_spec_bound: bool,
    ) -> bool {
        let is_oxlint = cx.language().is_oxlint;
        let message = union_constituents(ty)
            .iter()
            .flat_map(intersection_constituents)
            .filter(|part| !(skips_spec_bound && is_spec_bound_builtin_method(*part, property_name, is_oxlint)))
            .find_map(|intersection_part| {
                message_of(intersection_part.get_property(property_name)?, self.ignore_static, is_oxlint)
            });
        if let Some(message) = message {
            cx.report(report_node, message);
        }
        message.is_some()
    }

    fn check_member_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // For tsgolint the name in a JSX tag is a `PropertyAccessExpression` like any other.
        if is_safe_use(node, &mut cx.state.safe_uses, is_oxlint)
            || (!is_oxlint && node.is_jsx_tag_name())
            || node.is_in_type_query()
        {
            return;
        }
        match node.kind() {
            ExprKind::Dot { obj: object, name, .. } => {
                // A `PrivateIdentifier`, which tsgolint checks.
                if !is_oxlint && name.bytes().starts_with(b"#") {
                    return;
                }
                let property = PropertyNode {
                    identifier: Some(name.bytes()),
                    node: NameOf(node).ts_node(),
                };
                if is_natively_bound(object.into(), property, is_oxlint) {
                    return;
                }
                // tsgolint 7.0 asks for the symbol of the member, which has no declaration if the parts of a union or
                // of an intersection declare it in different places, as in `window.print`. It points at the name.
                if is_oxlint {
                    let symbol = node.ts_symbol();
                    if let Some(message) = symbol.and_then(|it| message_of(it, self.ignore_static, is_oxlint)) {
                        Self::report_reference(cx, name.span(), node.span(), message);
                    }
                    return;
                }
                self.check_union_constituents_and_report(cx, node.span(), name.bytes(), object.ty(), false);
            }
            // tsgolint 7.0 does not look at `a[b]`.
            ExprKind::Index { .. } if is_oxlint => {}
            ExprKind::Index { obj: object, index, .. } => {
                let property = PropertyNode {
                    identifier: index.as_ident().map(Name::bytes),
                    node: index.ts_node(),
                };
                if is_natively_bound(object.into(), property, is_oxlint) {
                    return;
                }
                for part in union_constituents(index.ty()) {
                    let reported = if let Some(value) = part.string_value() {
                        self.check_union_constituents_and_report(cx, node.span(), value, object.ty(), false)
                    } else if let Some(value) = part.number_value() {
                        let property_name = text::number_to_string(value);
                        self.check_union_constituents_and_report(cx, node.span(), &property_name, object.ty(), false)
                    } else {
                        false
                    };
                    if reported {
                        break;
                    }
                }
            }
            _ => {}
        }
    }

    /// `implements a.b`, and `extends a.b` of an interface: a `MemberExpression` for ESLint, a type here.
    fn check_heritage<'a>(&self, heritage: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, .. } = heritage.kind() else {
            return;
        };
        let (Some(first), Some(property_name)) = (name.first(), name.last().filter(|_| name.len() > 1)) else {
            return;
        };
        let node = heritage.ts_node();
        let access = match node.kind() {
            SyntaxKind::PropertyAccessExpression => Some(node),
            _ => node.children().next().filter(|it| it.kind() == SyntaxKind::PropertyAccessExpression),
        };
        let mut children = access.into_iter().flat_map(TsNode::children);
        let (Some(object), Some(property)) = (children.next(), children.next()) else {
            return;
        };
        let object = ObjectNode {
            identifier: (name.len() == 2).then(|| first.bytes()),
            node: object,
        };
        let property = PropertyNode {
            identifier: Some(property_name.bytes()),
            node: property,
        };
        let is_oxlint = cx.language().is_oxlint;
        if is_natively_bound(object, property, is_oxlint) {
            return;
        }
        // tsgolint asks for the symbol of the `PropertyAccessExpression`, which names a type here.
        if is_oxlint {
            let symbol = access.and_then(TsNode::get_symbol_at_location);
            if let Some(message) = symbol.and_then(|it| message_of(it, self.ignore_static, is_oxlint)) {
                Self::report_reference(cx, property_name.span(), name.span(), message);
            }
            return;
        }
        let object_type = object.node.get_type_at_location();
        self.check_union_constituents_and_report(cx, name.span(), property_name.bytes(), object_type, false);
    }

    fn check_property<'a>(
        &self,
        cx: &mut Cx<'a, Self>,
        pattern: ObjectPattern<'a>,
        key: Span,
        property_name: &[u8],
        property: PropertyNode<'a>,
    ) {
        let is_oxlint = cx.language().is_oxlint;
        if let Some(init_node) = pattern.init_node {
            if !is_natively_bound(init_node.into(), property, is_oxlint) {
                if self.check_if_method_and_report(cx, key, init_node.ty().get_property(property_name)) {
                    return;
                }
            // A default is not all that can be destructured:
            // `function ({ nativelyBound }: Foo = NativeObject) {}`
            } else if !pattern.is_in_assignment_pattern {
                return;
            }
        }
        let pattern_type = pattern.node.get_type_at_location();
        let skips_spec_bound = is_oxlint && property.identifier.is_some();
        self.check_union_constituents_and_report(cx, key, property_name, pattern_type, skips_spec_bound);
    }

    fn check_binding_pattern<'a>(&self, node: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = node.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if properties.is_empty()
            || is_node_inside_type_declaration(Node::Pat(node), &mut cx.state.type_declarations, is_oxlint)
        {
            return;
        }
        let (init_node, is_in_assignment_pattern) = match node.parent() {
            Node::VarDecl(declarator) => (declarator.init(), false),
            Node::Param(it) => (it.default(), it.default().is_some()),
            Node::PatProp(it) => (it.default(), it.default().is_some()),
            Node::PatElem(it) => (it.default(), it.default().is_some()),
            _ => (None, false),
        };
        let pattern = ObjectPattern {
            node: node.ts_node(),
            init_node,
            is_in_assignment_pattern,
        };
        for property in properties {
            let name_node = || {
                let element = property.ts_node();
                element.property_name().or_else(|| element.name())
            };
            if let Some(key) = property.key()
                && let Some((property_name, property_node)) = property_of_key(key, name_node, is_oxlint, false)
            {
                let key = key.inner_span(cx.file());
                self.check_property(cx, pattern, key, property_name, property_node);
            }
        }
    }

    fn check_assignment_target<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = node.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if properties.is_empty()
            || !node.is_assignment_target()
            || is_node_inside_type_declaration(Node::Expr(node), &mut cx.state.type_declarations, is_oxlint)
        {
            return;
        }
        let (init_node, is_in_assignment_pattern) = match node.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, value, .. } if target == node => {
                    (Some(value), parent.is_assignment_target())
                }
                _ => (None, false),
            },
            _ => (None, false),
        };
        // tsgolint checks the pattern that is the left of an assignment, and not where that is a default in a pattern.
        if is_oxlint && (init_node.is_none() || is_in_assignment_pattern) {
            return;
        }
        let pattern = ObjectPattern {
            node: node.ts_node(),
            init_node,
            is_in_assignment_pattern,
        };
        for property in properties {
            let name_node = || Some(NameOf(property).ts_node());
            if let Some(key) = property.key()
                && let Some((property_name, property_node)) = property_of_key(key, name_node, is_oxlint, true)
            {
                let key = key.inner_span(cx.file());
                self.check_property(cx, pattern, key, property_name, property_node);
            }
        }
    }
}

impl Rule for UnboundMethod {
    const META: Meta = Meta::typescript("unbound-method", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new()
        .exprs(&[ExprTag::Dot, ExprTag::Index, ExprTag::Object])
        .pats(&[PatTag::Object])
        .classes()
        .stmts(&[StmtTag::Interface]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        UnboundMethod {
            ignore_static: options.object(0).bool_or("ignoreStatic", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Dot | ExprTag::Index => self.check_member_expression(node, cx),
            ExprTag::Object => self.check_assignment_target(node, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = statement.kind() {
            interface.extends().iter().for_each(|it| self.check_heritage(it, cx));
        }
    }

    fn pat<'a>(&self, node: Pat<'a>, cx: &mut Cx<'a, Self>) {
        self.check_binding_pattern(node, cx);
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        class.implements().iter().for_each(|it| self.check_heritage(it, cx));
    }
}

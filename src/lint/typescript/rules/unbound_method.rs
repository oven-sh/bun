use bun_lint::prelude::*;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::{is_builtin_symbol_like, is_symbol_from_default_library};
use bun_lint::types::{ModifierFlags, NameOf, SyntaxKind, TsNode, TsSymbol, Type};

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
fn is_spec_bound_builtin_method(object_type: Type, property_name: Name) -> bool {
    property_name.is("compare")
        && object_type
            .get_symbol()
            .is_some_and(|symbol| symbol.name() == b"Collator" && is_symbol_from_default_library(symbol))
}

/// The `property` of a `MemberExpression`, or the `key` of a `Property`.
#[derive(Copy, Clone)]
struct PropertyNode<'a> {
    /// Its name, if it is an `Identifier`.
    identifier: Option<Name<'a>>,
    node: TsNode<'a>,
}

fn is_natively_bound<'a>(object: Expr<'a>, property: PropertyNode<'a>) -> bool {
    // The types alone do not tell: some declarations are not from the default library but from
    // `@types/node`, and the signature in an interface does not say whether a method is bound.
    if let (Some(object_name), Some(property_name)) = (object.as_ident(), property.identifier)
        && is_natively_bound_member(object_name.bytes(), property_name.bytes())
        && object.ts_symbol().is_some_and(is_not_imported)
    {
        return true;
    }
    let object_type = object.ty();
    if property.identifier.is_some_and(|property_name| is_spec_bound_builtin_method(object_type, property_name)) {
        return true;
    }
    is_builtin_symbol_like(object_type, &SUPPORTED_GLOBAL_TYPES)
        && is_symbol_from_default_library(property.node.get_type_at_location().get_symbol())
}

fn is_node_inside_type_declaration(node: Node) -> bool {
    node.ancestors().any(|parent| match parent {
        Node::Class(class) => {
            matches!(class.owner(), Node::Stmt(_)) && class.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT)
        }
        Node::Member(member) => {
            member.flags().contains(Flags::ABSTRACT)
                && matches!(
                    member.kind(),
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
                )
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
    })
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

fn is_member_of(node: Expr, is_object: fn(ExprKind) -> bool) -> bool {
    match node.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => is_object(obj.kind()),
        _ => false,
    }
}

/// A `ChainExpression` has the answer of what is in it, so it makes no difference that it is not a
/// node here.
fn is_safe_use(mut node: Expr) -> bool {
    loop {
        let parent = match node.parent() {
            Node::Stmt(parent) => {
                return matches!(parent.tag(), StmtTag::If | StmtTag::For | StmtTag::Switch | StmtTag::While);
            }
            Node::Expr(parent) => parent,
            _ => return false,
        };
        match parent.kind() {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => return true,
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => return call.callee() == node,
            ExprKind::Cond { test, .. } => return test == node,
            ExprKind::Unary { op, .. } => return !matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot),
            ExprKind::Binary { op, left, .. } => match op {
                BinOp::NotEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::EqEqEq | BinOp::Instanceof => return true,
                // `&&` returns its left operand only if that is falsy.
                BinOp::And if left == node => return true,
                // It is likely to return the method, so it is as safe as its own use.
                BinOp::And | BinOp::Or | BinOp::Nullish => {}
                _ => return false,
            },
            ExprKind::Assign { op, target, .. } => {
                // A default in a pattern is an `AssignmentPattern`.
                return op.is_none()
                    && !parent.is_assignment_target()
                    && (target == node
                        || (is_member_of(node, |object| matches!(object, ExprKind::Super))
                            && is_member_of(target, |object| matches!(object, ExprKind::This))));
            }
            ExprKind::NonNull(_) | ExprKind::As { .. } | ExprKind::AsConst(_) => {}
            _ => return false,
        }
        node = parent;
    }
}

/// The name of a key that is an `Identifier`, which it also is in `[key]`, and the key as a node.
fn identifier_key<'a>(key: Key<'a>, name_node: impl FnOnce() -> Option<TsNode<'a>>) -> Option<(Name<'a>, TsNode<'a>)> {
    match key.kind() {
        KeyKind::Ident(name) => Some((name, name_node()?)),
        KeyKind::Computed(expression) => Some((expression.as_ident()?, expression.ts_node())),
        _ => None,
    }
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
        let Some(message) = symbol.and_then(|symbol| check_if_method(symbol, self.ignore_static)) else {
            return false;
        };
        cx.report(node, message);
        true
    }

    fn check_union_constituents_and_report<'a>(
        &self,
        cx: &Cx<'a, Self>,
        report_node: Span,
        property_name: &[u8],
        ty: Type<'a>,
    ) -> bool {
        union_constituents(ty).iter().flat_map(intersection_constituents).any(|intersection_part| {
            self.check_if_method_and_report(cx, report_node, intersection_part.get_property(property_name))
        })
    }

    fn check_member_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if is_safe_use(node) || node.is_jsx_tag_name() || node.is_in_type_query() {
            return;
        }
        match node.kind() {
            ExprKind::Dot { obj: object, name, .. } => {
                // A `PrivateIdentifier`.
                if name.bytes().starts_with(b"#") {
                    return;
                }
                let property = PropertyNode {
                    identifier: Some(name.name()),
                    node: NameOf(node).ts_node(),
                };
                if !is_natively_bound(object, property) {
                    self.check_union_constituents_and_report(cx, node.span(), name.bytes(), object.ty());
                }
            }
            ExprKind::Index { obj: object, index, .. } => {
                let property = PropertyNode {
                    identifier: index.as_ident(),
                    node: index.ts_node(),
                };
                if is_natively_bound(object, property) {
                    return;
                }
                for part in union_constituents(index.ty()) {
                    let reported = if let Some(value) = part.string_value() {
                        self.check_union_constituents_and_report(cx, node.span(), value, object.ty())
                    } else if let Some(value) = part.number_value() {
                        let property_name = text::number_to_string(value);
                        self.check_union_constituents_and_report(cx, node.span(), &property_name, object.ty())
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

    fn check_property<'a>(
        &self,
        cx: &Cx<'a, Self>,
        pattern: ObjectPattern<'a>,
        key: Span,
        key_name: Name<'a>,
        key_node: TsNode<'a>,
    ) {
        if let Some(init_node) = pattern.init_node {
            let property = PropertyNode {
                identifier: Some(key_name),
                node: key_node,
            };
            if !is_natively_bound(init_node, property) {
                if self.check_if_method_and_report(cx, key, init_node.ty().get_property(key_name.bytes())) {
                    return;
                }
            // A default is not all that can be destructured:
            // `function ({ nativelyBound }: Foo = NativeObject) {}`
            } else if !pattern.is_in_assignment_pattern {
                return;
            }
        }
        self.check_union_constituents_and_report(cx, key, key_name.bytes(), pattern.node.get_type_at_location());
    }

    fn check_binding_pattern<'a>(&self, node: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = node.kind() else {
            return;
        };
        if properties.is_empty() || is_node_inside_type_declaration(Node::Pat(node)) {
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
                && let Some((key_name, key_node)) = identifier_key(key, name_node)
            {
                self.check_property(cx, pattern, key.inner_span(cx.file()), key_name, key_node);
            }
        }
    }

    fn check_assignment_target<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = node.kind() else {
            return;
        };
        if properties.is_empty() || !node.is_assignment_target() || is_node_inside_type_declaration(Node::Expr(node)) {
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
        let pattern = ObjectPattern {
            node: node.ts_node(),
            init_node,
            is_in_assignment_pattern,
        };
        for property in properties {
            if let Some(key) = property.key()
                && let Some((key_name, key_node)) = identifier_key(key, || Some(NameOf(property).ts_node()))
            {
                self.check_property(cx, pattern, key.inner_span(cx.file()), key_name, key_node);
            }
        }
    }
}

impl Rule for UnboundMethod {
    const META: Meta = Meta::typescript("unbound-method", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        UnboundMethod {
            ignore_static: options.object(0).bool_or("ignoreStatic", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Dot, ExprTag::Index], Self::check_member_expression);
        on.pats([PatTag::Object], Self::check_binding_pattern);
        on.exprs([ExprTag::Object], Self::check_assignment_target);
    }
}
